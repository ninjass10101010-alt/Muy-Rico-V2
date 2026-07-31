# Customer Match & Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent duplicate customer records via real-time detection at create-time, link website orders to existing customers via email backfill, and enable admin one-click merge of suspected duplicates with full audit trail.

**Architecture:** Add normalized email/phone columns to `customers`, a `customer_merges` audit ledger, and a `customer-match.js` normalizer module. Backfill logic in `createOrder` links website orders to existing customers by email. Real-time check in `createCustomer` blocks duplicates. New API endpoints for merge/reverse/duplicates. Admin UI adds merge badges, a MergeModal, email capture in OrderModal, and manual order re-linking.

**Tech Stack:** Cloudflare Workers (API), D1 (SQLite), React/TypeScript/Vite/Tailwind (admin SPA).

## Global Constraints

- API worker deploys via `npx wrangler deploy -c orders/wrangler.toml`.
- D1 migrations applied via `npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/NNNN_name.sql`.
- Admin SPA uses React 19 + TypeScript + Vite + Tailwind CSS v4.
- `muy-rico.com` does NOT resolve from this environment — verify via `.workers.dev` URLs.
- Existing customer CRUD: `POST /api/customers`, `GET /api/customers`, `PATCH /api/customers/:id`, `DELETE /api/customers/:id` — all require Cloudflare Access admin auth.
- `customers.id` is a TEXT primary key, client-generated (e.g. `cust_abc123`).
- `orders.customer_id` is nullable TEXT, no FK constraint.
- Cloudflare Access injects `cf-access-authenticated-user-email` header for admin requests.
- No formal test framework — verify via `wrangler dev` + curl smoke tests.

---

### Task 1: Migration 0035 — Add columns to customers + create audit ledger

**Files:**
- Create: `orders/migrations/0035_customer_match_and_merge.sql`
- Modify: None

**Interfaces:**
- Consumes: existing `customers` table (id, name, phone, email, notes, created_at, updated_at, active).
- Produces: `customers` gains `merged_into_id`, `email_normalized`, `phone_normalized` columns. New `customer_merges` table created. Backfill populates normalized columns.

- [ ] **Step 1: Write the migration file**

```sql
-- 0035_customer_match_and_merge.sql
-- Add normalized columns + merge audit ledger for customer dedup system.

-- Add columns to customers
ALTER TABLE customers ADD COLUMN merged_into_id TEXT;
ALTER TABLE customers ADD COLUMN email_normalized TEXT;
ALTER TABLE customers ADD COLUMN phone_normalized TEXT;

-- Indexes on normalized columns
CREATE INDEX IF NOT EXISTS idx_customers_email_norm ON customers(email_normalized);
CREATE INDEX IF NOT EXISTS idx_customers_phone_norm ON customers(phone_normalized);

-- Audit ledger (append-only)
CREATE TABLE IF NOT EXISTS customer_merges (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  surviving_id        TEXT NOT NULL,
  merged_id           TEXT NOT NULL,
  matched_by          TEXT NOT NULL,       -- 'email_exact' | 'phone_exact' | 'admin_manual'
  matched_fields_json TEXT,
  merged_by           TEXT NOT NULL,       -- admin actor email
  merged_at           TEXT NOT NULL DEFAULT (datetime('now')),
  reversed_by         TEXT,
  reversed_at         TEXT
);

CREATE INDEX IF NOT EXISTS idx_merges_surviving ON customer_merges(surviving_id);
CREATE INDEX IF NOT EXISTS idx_merges_merged    ON customer_merges(merged_id);

-- Backfill normalized columns from existing data (idempotent)
UPDATE customers SET
  email_normalized = LOWER(TRIM(email))
WHERE active = 1 AND email IS NOT NULL AND email_normalized IS NULL;

UPDATE customers SET
  phone_normalized = REGEXP_REPLACE(phone, '[^0-9]', '', 'g')
WHERE active = 1 AND phone IS NOT NULL AND phone_normalized IS NULL;
```

- [ ] **Step 2: Verify migration syntax**

Run: `cat orders/migrations/0035_customer_match_and_merge.sql | head -30`
Expected: SQL content displayed without errors.

- [ ] **Step 3: Commit migration file**

```bash
git add orders/migrations/0035_customer_match_and_merge.sql
git commit -m "feat(customers): add migration 0035 — normalized columns + merge audit ledger"
```

---

### Task 2: Migration 0036 — Deferred unique index (run only after dupes merged)

**Files:**
- Create: `orders/migrations/0036_customer_email_unique_index.sql`
- Modify: None

**Interfaces:**
- Consumes: `customers` table with `email_normalized` column populated by migration 0035, no remaining duplicate active emails.
- Produces: partial unique index on `email_normalized` for active non-merged customers.

- [ ] **Step 1: Write the migration file**

```sql
-- 0036_customer_email_unique_index.sql
-- Hard backstop: enforce one active customer per normalized email.
-- DO NOT run until all existing duplicate customers are merged via admin UI.

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email_unique
  ON customers(email_normalized)
  WHERE active = 1 AND merged_into_id IS NULL AND email_normalized IS NOT NULL;
```

- [ ] **Step 2: Commit migration file**

```bash
git add orders/migrations/0036_customer_email_unique_index.sql
git commit -m "feat(customers): add migration 0036 — deferred unique email index"
```

---

### Task 3: Customer matching module — normalizers + duplicate detection

**Files:**
- Create: `orders/workers/customer-match.js`
- Modify: None

**Interfaces:**
- Consumes: nothing (pure functions).
- Produces: `normalizeEmail`, `normalizePhone`, `normalizeName`, `nameSimilarity`, `findDuplicates`, `matchCustomer` exports.

- [ ] **Step 1: Write the normalizers and matching functions**

```js
// orders/workers/customer-match.js
// Pure functions for customer normalization and duplicate detection.

export function normalizeEmail(s) {
  if (!s || typeof s !== 'string') return null;
  const trimmed = s.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed;
}

export function normalizePhone(s) {
  if (!s || typeof s !== 'string') return null;
  const digits = s.replace(/[^0-9]/g, '');
  if (!digits) return null;
  // Strip leading US country code if 11 digits
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

export function normalizeName(s) {
  if (!s || typeof s !== 'string') return null;
  const trimmed = s.trim().toLowerCase();
  if (!trimmed) return null;
  // Strip diacritics (accents)
  const stripped = trimmed.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Collapse whitespace
  return stripped.replace(/\s+/g, ' ');
}

export function nameSimilarity(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  const tokensA = new Set(na.split(' '));
  const tokensB = new Set(nb.split(' '));
  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  let intersection = 0;
  for (const t of tokensA) { if (tokensB.has(t)) intersection++; }
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Check if a new customer matches an existing one.
// Returns null (no match) or { existingId, existingName, matchedBy }.
export function matchCustomer(newCust, existingCustomers) {
  const emailNorm = normalizeEmail(newCust.email);
  const phoneNorm = normalizePhone(newCust.phone);
  const nameNorm = normalizeName(newCust.name);

  for (const c of existingCustomers) {
    if (c.active !== 1) continue;

    // Rule 1: Exact email match
    if (emailNorm && c.emailNormalized && emailNorm === c.emailNormalized) {
      return { existingId: c.id, existingName: c.name, matchedBy: 'email_exact' };
    }

    // Rule 2: Phone match + name similarity ≥ 0.5
    if (phoneNorm && c.phoneNormalized && phoneNorm === c.phoneNormalized) {
      if (nameSimilarity(newCust.name, c.name) >= 0.5) {
        return { existingId: c.id, existingName: c.name, matchedBy: 'phone_exact' };
      }
    }

    // Rule 3: Exact name with no email and no phone on either
    if (nameNorm && !emailNorm && !phoneNorm && !c.emailNormalized && !c.phoneNormalized) {
      if (nameNorm === normalizeName(c.name)) {
        return { existingId: c.id, existingName: c.name, matchedBy: 'name_exact' };
      }
    }
  }
  return null;
}

// Find all suspected duplicate pairs among active customers.
// Returns array sorted by confidence: high (email) > medium (phone+name) > low (name-only).
export function findDuplicates(customers) {
  const active = customers.filter(c => c.active === 1 && !c.mergedIntoId);
  const pairs = [];
  const seen = new Set();

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      const key = [a.id, b.id].sort().join(':');
      if (seen.has(key)) continue;
      seen.add(key);

      const emailNormA = normalizeEmail(a.email);
      const emailNormB = normalizeEmail(b.email);
      const phoneNormA = normalizePhone(a.phone);
      const phoneNormB = normalizePhone(b.phone);

      // Rule 1: email exact
      if (emailNormA && emailNormB && emailNormA === emailNormB) {
        pairs.push({ survivingCandidate: a, mergedCandidate: b, matchedBy: 'email_exact', confidence: 'high' });
        continue;
      }

      // Rule 2: phone + name
      if (phoneNormA && phoneNormB && phoneNormA === phoneNormB) {
        if (nameSimilarity(a.name, b.name) >= 0.5) {
          pairs.push({ survivingCandidate: a, mergedCandidate: b, matchedBy: 'phone_exact', confidence: 'medium' });
          continue;
        }
      }

      // Rule 3: exact name, no email, no phone
      const nameA = normalizeName(a.name);
      const nameB = normalizeName(b.name);
      if (nameA && nameB && nameA === nameB && !emailNormA && !emailNormB && !phoneNormA && !phoneNormB) {
        pairs.push({ survivingCandidate: a, mergedCandidate: b, matchedBy: 'name_exact', confidence: 'low' });
      }
    }
  }

  // Sort: high confidence first
  const order = { high: 0, medium: 1, low: 2 };
  pairs.sort((x, y) => (order[x.confidence] ?? 3) - (order[y.confidence] ?? 3));
  return pairs;
}
```

- [ ] **Step 2: Commit the matching module**

```bash
git add orders/workers/customer-match.js
git commit -m "feat(customers): add customer-match.js — normalizers, matchCustomer, findDuplicates"
```

---

### Task 4: createOrder — harden website source + backfill customer_id

**Files:**
- Modify: `orders/workers/api.js:310-367` (createOrder function)
- Modify: `orders/workers/api.js:62-65` (import customer-match.js)

**Interfaces:**
- Consumes: `normalizeEmail`, `normalizePhone` from `customer-match.js`.
- Produces: website-sourced orders get `customer_id` via email-based backfill; client-provided `customer_id` ignored for website source.

- [ ] **Step 1: Add import for customer-match.js**

Find the import block at the top of `api.js` (around lines 1-10). Add after existing imports:

```js
import { normalizeEmail, normalizePhone } from './customer-match.js';
```

- [ ] **Step 2: Harden createOrder — ignore client customer_id for website source**

In the `createOrder` function, after line 329 (`const customerId = getBodyField(body, 'customer_id') || null;`), add:

```js
// Hardening: ignore client-provided customer_id for website orders.
// Website orders go through the email-based backfill below.
const isWebsite = (body.source || 'in-person') === 'website';
const rawCustomerId = isWebsite ? null : customerId;
```

Then change line 338 from `customerId,` to `rawCustomerId,` (the value inserted into the DB):

```js
    body.customer_name.trim(),
    rawCustomerId,
```

- [ ] **Step 3: Add website order backfill logic**

After the hardening block and before the `env.DB.prepare(INSERT INTO orders...)` call, add the backfill logic:

```js
  // Website backfill: link order to existing customer by email, or create one.
  let effectiveCustomerId = rawCustomerId;
  if (isWebsite && !effectiveCustomerId) {
    const emailNorm = normalizeEmail(body.email);
    if (emailNorm) {
      // Look up existing customer by normalized email
      const { results: existingCustomers } = await env.DB.prepare(
        'SELECT id, name, email_normalized FROM customers WHERE active = 1 AND email_normalized = ?'
      ).bind(emailNorm).all();

      if (existingCustomers.length > 0) {
        effectiveCustomerId = existingCustomers[0].id;
      } else {
        // Create a new customer from the website order data
        const custId = 'cust_web_' + Math.random().toString(36).slice(2, 9);
        const phoneNorm = normalizePhone(body.phone);
        await env.DB.prepare(`
          INSERT INTO customers (id, name, phone, email, email_normalized, phone_normalized, created_at, active)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'), 1)
        `).bind(
          custId,
          body.customer_name?.trim() || '',
          body.phone || null,
          body.email?.trim() || null,
          emailNorm,
          phoneNorm,
        ).run();
        effectiveCustomerId = custId;
      }
    } else {
      // No email on website order — log skip event (will happen after insert)
    }
  }
```

- [ ] **Step 4: Update the INSERT to use effectiveCustomerId**

Change the INSERT binding from `rawCustomerId` to `effectiveCustomerId`:

```js
    body.customer_name.trim(),
    effectiveCustomerId,
```

- [ ] **Step 5: Add customer_match_skipped event for website orders without email**

After the `order_events` insert for `order:created` (around line 357), add:

```js
  // Log when a website order couldn't be linked due to missing email
  if (isWebsite && !effectiveCustomerId && !rawCustomerId) {
    await env.DB.prepare(`
      INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, 'customer_match_skipped')
    `).bind(id, 'system').run();
  }
```

- [ ] **Step 6: Commit the changes**

```bash
git add orders/workers/api.js
git commit -m "feat(orders): harden website source + backfill customer_id by email"
```

---

### Task 5: createCustomer — real-time duplicate check

**Files:**
- Modify: `orders/workers/api.js:1735-1749` (createCustomer function)
- Modify: `orders/workers/api.js` (import — already added in Task 4)

**Interfaces:**
- Consumes: `matchCustomer`, `normalizeEmail`, `normalizePhone` from `customer-match.js`.
- Produces: returns `{ ok: false, duplicate: true, existingId, existingName, matchedBy }` on match; accepts `force: true` override.

- [ ] **Step 1: Rewrite createCustomer with duplicate check**

Replace the entire `createCustomer` function (lines 1735-1749) with:

```js
async function createCustomer(request, env, actor) {
  const body = await request.json();
  if (!body.id || !body.name) return json({ error: 'Missing required fields: id, name' }, 400);
  if (typeof body.id !== 'string' || body.id.length > 64) return json({ error: 'id must be a short string' }, 400);

  const emailNorm = normalizeEmail(body.email);
  const phoneNorm = normalizePhone(body.phone);

  // Real-time duplicate check (unless force: true)
  if (!body.force) {
    const { results: existing } = await env.DB.prepare(
      'SELECT id, name, email_normalized, phone_normalized FROM customers WHERE active = 1'
    ).all();

    const match = matchCustomer(
      { name: body.name, email: body.email, phone: body.phone },
      existing
    );

    if (match) {
      return json({
        ok: false,
        duplicate: true,
        existingId: match.existingId,
        existingName: match.existingName,
        matchedBy: match.matchedBy,
      }, 200);
    }
  }

  try {
    await env.DB.prepare(`
      INSERT INTO customers (id, name, phone, email, email_normalized, phone_normalized, notes, created_at, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), 1)
    `).bind(
      body.id, body.name, body.phone || null, body.email || null,
      emailNorm, phoneNorm, body.notes || null
    ).run();
  } catch (err) {
    return json({ error: String(err) }, 400);
  }

  if (body.force) {
    // Log forced creation despite match
    await env.DB.prepare(`
      INSERT INTO order_events (order_id, actor, event) VALUES (0, ?, 'customer_created_despite_match')
    `).bind(actor).run();
  }

  return json({ ok: true, id: body.id }, 201);
}
```

- [ ] **Step 2: Commit the changes**

```bash
git add orders/workers/api.js
git commit -m "feat(customers): add real-time duplicate check to createCustomer"
```

---

### Task 6: Merge, duplicates, and reverse endpoints

**Files:**
- Modify: `orders/workers/api.js` — add new route handlers
- Modify: `orders/workers/api.js:219-228` (router block — add new routes)

**Interfaces:**
- Consumes: `findDuplicates`, `matchCustomer`, `normalizeEmail`, `normalizePhone` from `customer-match.js`.
- Produces: `POST /api/customers/merge`, `POST /api/customers/merge/:mergeId/reverse`, `GET /api/customers/duplicates`.

- [ ] **Step 1: Add route entries to the router**

Find the existing customer routes block (around lines 219-228). Add three new route entries:

```js
  // Customer merge/duplicates
  if (req.method === 'POST' && path === '/api/customers/merge')             return mergeCustomers(request, env, ctx, actor);
  if (req.method === 'POST' && path.match(/^\/api\/customers\/merge\/([^/]+)\/reverse$/))
    return reverseMerge(path.match(/^\/api\/customers\/merge\/([^/]+)\/reverse$/)[1], request, env, actor);
  if (req.method === 'GET' && path === '/api/customers/duplicates')          return listDuplicates(env);
```

- [ ] **Step 2: Write the listDuplicates handler**

```js
async function listDuplicates(env) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM customers WHERE active = 1 ORDER BY created_at ASC'
  ).all();
  const customers = results.map(snakeToCamelObject);
  const pairs = findDuplicates(customers);
  return json({ duplicates: pairs }, 200);
}
```

- [ ] **Step 3: Write the mergeCustomers handler**

```js
async function mergeCustomers(request, env, ctx, actor) {
  const body = await request.json();
  const { survivingId, mergedId } = body;
  if (!survivingId || !mergedId) return json({ error: 'Missing survivingId or mergedId' }, 400);
  if (survivingId === mergedId) return json({ error: 'Cannot merge a customer with itself' }, 400);

  // Validate both exist, active, not already merged
  const surviving = await env.DB.prepare('SELECT id, name, active, merged_into_id FROM customers WHERE id = ?').bind(survivingId).first();
  const merged = await env.DB.prepare('SELECT id, name, active, merged_into_id FROM customers WHERE id = ?').bind(mergedId).first();
  if (!surviving || !merged) return json({ error: 'Customer not found' }, 404);
  if (surviving.active !== 1 || merged.active !== 1) return json({ error: 'Both customers must be active' }, 400);
  if (surviving.merged_into_id || merged.merged_into_id) return json({ error: 'Cannot merge an already-merged customer' }, 400);

  // Compute match reason
  const match = matchCustomer(
    { name: merged.name, email: null, phone: null },
    [surviving]
  );
  const matchedBy = match ? match.matchedBy : 'admin_manual';
  const matchedFields = JSON.stringify({ surviving: survivingId, merged: mergedId });

  // Count orders to be re-pointed
  const { results: ordersToRelink } = await env.DB.prepare(
    'SELECT id FROM orders WHERE customer_id = ?'
  ).bind(mergedId).all();
  const relinkedCount = ordersToRelink.length;

  // Atomic batch transaction
  const statements = [];

  // Re-point orders
  if (relinkedCount > 0) {
    statements.push(
      env.DB.prepare('UPDATE orders SET customer_id = ? WHERE customer_id = ?').bind(survivingId, mergedId)
    );
  }

  // Mark merged customer
  statements.push(
    env.DB.prepare("UPDATE customers SET active = 0, merged_into_id = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(survivingId, mergedId)
  );

  // Insert audit row
  statements.push(
    env.DB.prepare(`
      INSERT INTO customer_merges (surviving_id, merged_id, matched_by, matched_fields_json, merged_by)
      VALUES (?, ?, ?, ?, ?)
    `).bind(survivingId, mergedId, matchedBy, matchedFields, actor)
  );

  // Log order_events for each re-linked order
  for (const o of ordersToRelink) {
    statements.push(
      env.DB.prepare("INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, 'customer:relinked')")
        .bind(o.id, actor)
    );
  }

  await env.DB.batch(statements);

  return json({ ok: true, survivingId, relinkedOrderCount: relinkedCount }, 200);
}
```

- [ ] **Step 4: Write the reverseMerge handler**

```js
async function reverseMerge(mergeId, request, env, actor) {
  const mergeRow = await env.DB.prepare('SELECT * FROM customer_merges WHERE id = ?').bind(mergeId).first();
  if (!mergeRow) return json({ error: 'Merge record not found' }, 404);
  if (mergeRow.reversed_by) return json({ error: 'Merge already reversed' }, 400);

  // Restore the merged customer
  await env.DB.prepare(
    "UPDATE customers SET active = 1, merged_into_id = NULL, updated_at = datetime('now') WHERE id = ?"
  ).bind(mergeRow.merged_id).run();

  // Mark the merge as reversed (append-only — no deletion)
  await env.DB.prepare(
    "UPDATE customer_merges SET reversed_by = ?, reversed_at = datetime('now') WHERE id = ?"
  ).bind(actor, mergeId).run();

  return json({ ok: true, restoredId: mergeRow.merged_id }, 200);
}
```

- [ ] **Step 5: Commit the changes**

```bash
git add orders/workers/api.js
git commit -m "feat(customers): add merge, reverse, and duplicates endpoints"
```

---

### Task 7: updateOrder — add customer_id to allowlist

**Files:**
- Modify: `orders/workers/api.js:500` (updateOrder allowed fields list)

**Interfaces:**
- Consumes: existing `updateOrder` function.
- Produces: `customer_id` is now patchable via `PATCH /api/orders/:id`.

- [ ] **Step 1: Add customer_id to the allowed list**

Change line 500 from:

```js
  const allowed = ['status', 'payment_status', 'notes', 'pickup_date', 'pickup_time', 'payment_method', 'payment_sub_method', 'food_coloring'];
```

to:

```js
  const allowed = ['status', 'payment_status', 'notes', 'pickup_date', 'pickup_time', 'payment_method', 'payment_sub_method', 'food_coloring', 'customer_id'];
```

- [ ] **Step 2: Commit the change**

```bash
git add orders/workers/api.js
git commit -m "feat(orders): add customer_id to updateOrder allowlist for manual re-linking"
```

---

### Task 8: OrderModal — add Email field to New Customer mode

**Files:**
- Modify: `home-bakery-management-system/src/components/OrderModal.tsx:127-139` (new customer creation)

**Interfaces:**
- Consumes: existing `customerName`, `phone` state.
- Produces: `email` is captured when creating a new in-person customer.

- [ ] **Step 1: Add email state**

Find the existing state declarations (around line 20-30). Add after the `phone` state:

```tsx
  const [newCustomerEmail, setNewCustomerEmail] = useState("");
```

- [ ] **Step 2: Update the newCustomer object to include email**

At line 132, change `email: ""` to `email: newCustomerEmail.trim()`:

```tsx
      newCustomer = {
        id: `cust_${Math.random().toString(36).slice(2, 9)}`,
        name: customerName.trim(),
        phone: phone.trim(),
        email: newCustomerEmail.trim(),
        notes: "",
        createdAt: new Date().toISOString(),
      };
```

- [ ] **Step 3: Add email input to the New Customer form section**

Find the JSX where the "New customer" mode renders input fields (look for the phone input in the new-customer section). Add an Email field after the phone input:

```tsx
  <div className="space-y-1">
    <label className="text-xs font-medium text-cocoa-muted">Email</label>
    <input
      type="email"
      value={newCustomerEmail}
      onChange={(e) => setNewCustomerEmail(e.target.value)}
      placeholder="customer@email.com"
      className="input"
    />
  </div>
```

- [ ] **Step 4: Reset the email state in the resetForm function**

Find the `resetForm` function (around line 95-107). Add:

```tsx
    setNewCustomerEmail("");
```

- [ ] **Step 5: Commit the changes**

```bash
git add home-bakery-management-system/src/components/OrderModal.tsx
git commit -m "feat(admin): add email field to OrderModal new-customer mode"
```

---

### Task 9: api.ts — add typed wrappers for new endpoints

**Files:**
- Modify: `home-bakery-management-system/src/utils/api.ts` — add new functions

**Interfaces:**
- Consumes: existing `API_BASE` constant.
- Produces: `apiGetDuplicateCustomers`, `apiMergeCustomers`, `apiReverseMerge`, `apiRelinkOrder`.

- [ ] **Step 1: Add the new typed interfaces**

Find the existing `ApiCustomer` interface (around line 344). Add after it:

```ts
export interface DuplicatePair {
  survivingCandidate: ApiCustomer;
  mergedCandidate: ApiCustomer;
  matchedBy: string;
  confidence: string;
}
```

- [ ] **Step 2: Add the API wrapper functions**

Find the end of the existing customer API functions (around line 388). Add after them:

```ts
export async function apiGetDuplicateCustomers(): Promise<DuplicatePair[]> {
  const res = await fetch(`${API_BASE}/api/customers/duplicates`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch duplicates");
  const data = await res.json();
  return data.duplicates || [];
}

export async function apiMergeCustomers(
  survivingId: string,
  mergedId: string
): Promise<{ ok: boolean; survivingId: string; relinkedOrderCount: number }> {
  const res = await fetch(`${API_BASE}/api/customers/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ survivingId, mergedId }),
  });
  if (!res.ok) throw new Error("Failed to merge customers");
  return res.json();
}

export async function apiReverseMerge(mergeId: string): Promise<{ ok: boolean; restoredId: string }> {
  const res = await fetch(`${API_BASE}/api/customers/merge/${mergeId}/reverse`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to reverse merge");
  return res.json();
}

export async function apiRelinkOrder(
  orderId: number,
  customerId: string | null
): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/api/orders/${orderId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ customer_id: customerId }),
  });
  if (!res.ok) throw new Error("Failed to re-link order");
  return res.json();
}
```

- [ ] **Step 3: Commit the changes**

```bash
git add home-bakery-management-system/src/utils/api.ts
git commit -m "feat(admin): add API wrappers for merge, duplicates, reverse, re-link"
```

---

### Task 10: MergeModal — side-by-side comparison component

**Files:**
- Create: `home-bakery-management-system/src/components/MergeModal.tsx`
- Modify: None

**Interfaces:**
- Consumes: `Customer`, `DuplicatePair` types; `apiMergeCustomers` from api.ts.
- Produces: `MergeModal` component exported as default.

- [ ] **Step 1: Write the MergeModal component**

```tsx
// home-bakery-management-system/src/components/MergeModal.tsx
import { useState } from "react";
import { Mail, Phone, FileText } from "lucide-react";
import Modal from "./ui/Modal";
import { formatCurrency } from "../utils/format";
import { apiMergeCustomers } from "../utils/api";
import type { Customer } from "../types";
import type { DuplicatePair } from "../utils/api";

interface MergeModalProps {
  open: boolean;
  onClose: () => void;
  pair: DuplicatePair | null;
  stats: Record<string, { count: number; total: number }>;
  onMerged: () => void;
}

export default function MergeModal({ open, onClose, pair, stats, onMerged }: MergeModalProps) {
  const [survivingSide, setSurvivingSide] = useState<"left" | "right">("left");
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState("");

  if (!pair) return null;

  const left = pair.survivingCandidate;
  const right = pair.mergedCandidate;
  const surviving = survivingSide === "left" ? left : right;
  const merged = survivingSide === "left" ? right : left;
  const leftStats = stats[left.id] || { count: 0, total: 0 };
  const rightStats = stats[right.id] || { count: 0, total: 0 };

  const confidenceLabel = {
    high: "Email match",
    medium: "Phone + name match",
    low: "Name only",
  }[pair.confidence] || pair.matchedBy;

  async function handleMerge() {
    setMerging(true);
    setError("");
    try {
      await apiMergeCustomers(surviving.id, merged.id);
      onMerged();
      onClose();
    } catch (err: any) {
      setError(err.message || "Merge failed");
    } finally {
      setMerging(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Review Duplicate">
      <div className="space-y-4">
        {/* Confidence chip */}
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
            {confidenceLabel}
          </span>
        </div>

        {/* Side-by-side comparison */}
        <div className="grid grid-cols-2 gap-3">
          {[left, right].map((c, i) => {
            const side = i === 0 ? "left" : "right";
            const s = i === 0 ? leftStats : rightStats;
            const isSurviving = survivingSide === side;
            return (
              <div
                key={c.id}
                className={`rounded-xl border-2 p-4 transition ${
                  isSurviving ? "border-palm bg-palm/5" : "border-sand-200 bg-white"
                }`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-semibold text-cocoa">{c.name}</p>
                  <input
                    type="radio"
                    name="surviving"
                    checked={isSurviving}
                    onChange={() => setSurvivingSide(side)}
                    className="accent-palm"
                  />
                </div>
                <p className="text-xs text-cocoa-muted">
                  {isSurviving ? "Surviving record" : "Will be merged away"}
                </p>
                <div className="mt-3 space-y-1 text-xs text-cocoa-muted">
                  {c.phone && (
                    <p className="flex items-center gap-1.5">
                      <Phone size={12} /> {c.phone}
                    </p>
                  )}
                  {c.email && (
                    <p className="flex items-center gap-1.5">
                      <Mail size={12} /> {c.email}
                    </p>
                  )}
                  {c.notes && (
                    <p className="flex items-center gap-1.5">
                      <FileText size={12} /> {c.notes}
                    </p>
                  )}
                </div>
                <div className="mt-3 rounded-lg bg-sand-50 px-3 py-2 text-sm">
                  <span className="text-cocoa-muted">{s.count} orders</span>
                  <span className="mx-1.5 text-cocoa-muted">·</span>
                  <span className="font-semibold text-cocoa">{formatCurrency(s.total)}</span>
                </div>
              </div>
            );
          })}
        </div>

        {error && (
          <p className="rounded-lg bg-hibiscus-light/10 px-3 py-2 text-xs text-hibiscus">{error}</p>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-sand-200 py-2.5 text-sm font-medium text-cocoa-muted hover:bg-sand-50"
          >
            Dismiss
          </button>
          <button
            onClick={handleMerge}
            disabled={merging}
            className="flex-1 rounded-xl bg-palm py-2.5 text-sm font-semibold text-white transition hover:shadow-md disabled:opacity-50"
          >
            {merging ? "Merging..." : "Approve Merge"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Commit the MergeModal**

```bash
git add home-bakery-management-system/src/components/MergeModal.tsx
git commit -m "feat(admin): add MergeModal side-by-side comparison component"
```

---

### Task 11: Customers.tsx — duplicate badges, banner, and save-handler

**Files:**
- Modify: `home-bakery-management-system/src/pages/Customers.tsx`

**Interfaces:**
- Consumes: `DuplicatePair`, `apiGetDuplicateCustomers` from api.ts; `MergeModal` component.
- Produces: gold badges on duplicate cards, top banner, MergeModal integration, duplicate-blocked save prompt.

- [ ] **Step 1: Add imports and state**

Update the imports at the top of `Customers.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Mail, Pencil, Phone, Plus, Trash2 } from "lucide-react";
import { useStore } from "../context/StoreContext";
import Modal from "../components/ui/Modal";
import MergeModal from "../components/MergeModal";
import { formatCurrency, formatDate, newId } from "../utils/format";
import { apiGetDuplicateCustomers } from "../utils/api";
import type { Customer } from "../types";
import type { DuplicatePair } from "../utils/api";
```

- [ ] **Step 2: Add duplicates state and fetch on mount**

After the existing state declarations (around line 24), add:

```tsx
  const [duplicates, setDuplicates] = useState<DuplicatePair[]>([]);
  const [mergePair, setMergePair] = useState<DuplicatePair | null>(null);
  const [mergeModalOpen, setMergeModalOpen] = useState(false);
  const [duplicateError, setDuplicateError] = useState<{ existingId: string; existingName: string } | null>(null);
```

Add a `useEffect` to fetch duplicates on mount:

```tsx
  useEffect(() => {
    apiGetDuplicateCustomers().then(setDuplicates).catch(() => {});
  }, []);
```

- [ ] **Step 3: Add duplicate detection in the save handler**

Modify the `save` function to handle the new `{ ok: false, duplicate: true }` response. Replace the existing try/catch block:

```tsx
  async function save() {
    if (!draft.name.trim()) return;
    setSaving(true);
    setErrorMsg("");
    setDuplicateError(null);
    try {
      if (editingId) {
        await handleUpdateCustomer(editingId, {
          name: draft.name,
          phone: draft.phone,
          email: draft.email,
          notes: draft.notes,
        });
      } else {
        const result = await handleCreateCustomer({
          id: newId("cust"),
          name: draft.name,
          phone: draft.phone,
          email: draft.email,
          notes: draft.notes,
        });
        // Check if the API returned a duplicate block
        if (result && (result as any).duplicate) {
          setDuplicateError({
            existingId: (result as any).existingId,
            existingName: (result as any).existingName,
          });
          return; // Don't close modal
        }
      }
      setModalOpen(false);
      setDuplicateError(null);
    } catch (err: any) {
      console.error("Failed to save customer:", err);
      setErrorMsg(err.message || "Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }
```

- [ ] **Step 4: Add duplicate banner at the top of the page**

Before the existing grid (around line 97), add:

```tsx
      {duplicates.length > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <AlertTriangle size={16} />
          <span className="font-medium">{duplicates.length} possible duplicate customer{duplicates.length !== 1 ? "s" : ""} to review</span>
        </div>
      )}
```

- [ ] **Step 5: Add badge on duplicate cards**

Inside the customer card render (around line 102), add a badge after the customer name. Find the `<p className="font-semibold text-cocoa hover:underline">{c.name}</p>` line and add after it:

```tsx
                  {duplicates.some(
                    (d) => d.survivingCandidate.id === c.id || d.mergedCandidate.id === c.id
                  ) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const pair = duplicates.find(
                          (d) => d.survivingCandidate.id === c.id || d.mergedCandidate.id === c.id
                        );
                        if (pair) {
                          setMergePair(pair);
                          setMergeModalOpen(true);
                        }
                      }}
                      className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
                    >
                      <AlertTriangle size={10} /> Possible duplicate
                    </button>
                  )}
```

- [ ] **Step 6: Add duplicate-blocked prompt in the save modal**

Inside the modal, after the existing error message display and before the save button, add:

```tsx
          {duplicateError && (
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
              <p className="font-medium">{duplicateError.existingName} already uses this email.</p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => {
                    setDuplicateError(null);
                    setModalOpen(false);
                  }}
                  className="rounded-lg border border-amber-200 px-3 py-1.5 text-xs font-medium hover:bg-amber-100"
                >
                  Use existing
                </button>
                <button
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await handleCreateCustomer({
                        id: newId("cust"),
                        name: draft.name,
                        phone: draft.phone,
                        email: draft.email,
                        notes: draft.notes,
                        force: true,
                      } as any);
                      setModalOpen(false);
                      setDuplicateError(null);
                    } catch (err: any) {
                      setErrorMsg(err.message || "Failed");
                    } finally {
                      setSaving(false);
                    }
                  }}
                  disabled={saving}
                  className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  Create anyway
                </button>
              </div>
            </div>
          )}
```

- [ ] **Step 7: Add MergeModal render at the bottom of the component**

Before the closing `</div>` of the component return, add:

```tsx
      <MergeModal
        open={mergeModalOpen}
        onClose={() => {
          setMergeModalOpen(false);
          setMergePair(null);
        }}
        pair={mergePair}
        stats={stats}
        onMerged={() => {
          // Refresh duplicates and customers after merge
          apiGetDuplicateCustomers().then(setDuplicates).catch(() => {});
        }}
      />
```

- [ ] **Step 8: Commit the changes**

```bash
git add home-bakery-management-system/src/pages/Customers.tsx
git commit -m "feat(admin): add duplicate badges, banner, and MergeModal to Customers page"
```

---

### Task 12: StoreContext — add duplicates state and merge/relink handlers

**Files:**
- Modify: `home-bakery-management-system/src/context/StoreContext.tsx`

**Interfaces:**
- Consumes: `apiMergeCustomers`, `apiRelinkOrder` from api.ts.
- Produces: `handleMergeCustomers`, `handleRelinkOrder` actions exposed via context.

- [ ] **Step 1: Add the merge handler**

Find the `StoreContext` value object (the object returned from the provider, usually near the end of the component). Add to it:

```tsx
    handleMergeCustomers: async (survivingId: string, mergedId: string) => {
      await apiMergeCustomers(survivingId, mergedId);
      // Refresh customers and orders to reflect re-pointed customer_id
      await Promise.all([fetchCustomers(), fetchOrders()]);
    },
    handleRelinkOrder: async (orderId: number, customerId: string | null) => {
      await apiRelinkOrder(orderId, customerId);
      await fetchOrders();
    },
```

- [ ] **Step 2: Add the imports**

Add to the existing imports at the top of `StoreContext.tsx`:

```tsx
import { apiMergeCustomers, apiRelinkOrder } from "../utils/api";
```

- [ ] **Step 3: Commit the changes**

```bash
git add home-bakery-management-system/src/context/StoreContext.tsx
git commit -m "feat(admin): add merge and re-link handlers to StoreContext"
```

---

### Task 13: Orders page — manual re-link UI

**Files:**
- Modify: `home-bakery-management-system/src/pages/Orders.tsx` (order detail/edit view)

**Interfaces:**
- Consumes: `handleRelinkOrder` from StoreContext; `customers` list.
- Produces: "Change" link on the Customer row in the order detail view, with a dropdown to select a new customer.

- [ ] **Step 1: Add re-link state and UI to the order detail view**

Find the order detail/edit modal or expanded row in `Orders.tsx`. After the customer name display, add a "Change" link and a customer search dropdown:

```tsx
  const [relinkOrderId, setRelinkOrderId] = useState<number | null>(null);
  const [relinkSearch, setRelinkSearch] = useState("");
```

In the order detail JSX, after displaying the customer name:

```tsx
  {relinkOrderId === order.id ? (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={relinkSearch}
        onChange={(e) => setRelinkSearch(e.target.value)}
        placeholder="Search customer..."
        className="input text-xs"
        autoFocus
      />
      <select
        onChange={(e) => {
          if (e.target.value) {
            handleRelinkOrder(order.id, e.target.value);
            setRelinkOrderId(null);
            setRelinkSearch("");
          }
        }}
        className="input text-xs"
      >
        <option value="">Select...</option>
        {customers
          .filter((c) => c.name.toLowerCase().includes(relinkSearch.toLowerCase()))
          .map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
      </select>
      <button
        onClick={() => { setRelinkOrderId(null); setRelinkSearch(""); }}
        className="text-xs text-cocoa-muted hover:text-cocoa"
      >
        Cancel
      </button>
    </div>
  ) : (
    <button
      onClick={() => setRelinkOrderId(order.id)}
      className="text-xs text-palm hover:underline"
    >
      Change
    </button>
  )}
```

- [ ] **Step 2: Commit the changes**

```bash
git add home-bakery-management-system/src/pages/Orders.tsx
git commit -m "feat(admin): add manual re-link UI on Orders page"
```

---

### Task 14: Build and deploy verification

**Files:**
- None (verification only)

**Interfaces:**
- Consumes: all previous tasks complete.
- Produces: confirmed working system.

- [ ] **Step 1: Run the Vite build to check for TypeScript/compilation errors**

```bash
cd home-bakery-management-system && npm run build
```

Expected: Build succeeds with no errors. The `dist/` output is generated.

- [ ] **Step 2: Apply migration 0035 to dev D1**

```bash
npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0035_customer_match_and_merge.sql
```

Expected: Migration applied successfully.

- [ ] **Step 3: Verify migration columns exist**

```bash
npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --command "PRAGMA table_info(customers)"
```

Expected: `email_normalized`, `phone_normalized`, `merged_into_id` columns present.

- [ ] **Step 4: Verify customer_merges table exists**

```bash
npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --command "PRAGMA table_info(customer_merges)"
```

Expected: Table exists with all expected columns including `reversed_by`, `reversed_at`.

- [ ] **Step 5: Spot-check backfill on existing customers**

```bash
npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --command "SELECT id, name, email, email_normalized, phone, phone_normalized FROM customers WHERE active = 1 LIMIT 5"
```

Expected: `email_normalized` is lowercase trimmed email; `phone_normalized` is digits-only.

- [ ] **Step 6: Test createOrder website backfill**

```bash
curl -s -X POST "https://muy-rico-orders-api.bexgarcia0208.workers.dev/api/orders" \
  -H "Content-Type: application/json" \
  -d '{"customer_name":"Backfill Test","email":"backfill@test.com","phone":"555-1234","pickup_date":"2026-08-01","items_json":[{"name":"Test Cake","qty":1,"price":15}],"total_cents":1500,"payment_method":"cash","payment_status":"unpaid","status":"pending","source":"website"}'
```

Expected: Returns `{ ok: true, id: <new_order_id> }`. Then verify the order has `customer_id` set:

```bash
curl -s "https://muy-rico-orders-api.bexgarcia0208.workers.dev/api/orders/<new_order_id>" \
  -H "Authorization: Bearer <cf-access-token>"
```

Expected: `customer_id` is non-null, points to a customer with `email_normalized = 'backfill@test.com'`.

- [ ] **Step 7: Test createCustomer duplicate block**

First create a customer:
```bash
curl -s -X POST "https://muy-rico-orders-api.bexgarcia0208.workers.dev/api/customers" \
  -H "Content-Type: application/json" \
  -d '{"id":"cust_test_dup1","name":"Test Dup","email":"dup@test.com"}'
```

Then try to create another with the same email:
```bash
curl -s -X POST "https://muy-rico-orders-api.bexgarcia0208.workers.dev/api/customers" \
  -H "Content-Type: application/json" \
  -d '{"id":"cust_test_dup2","name":"Test Dup 2","email":"dup@test.com"}'
```

Expected: Returns `{ ok: false, duplicate: true, existingId: "cust_test_dup1", matchedBy: "email_exact" }`.

- [ ] **Step 8: Test force: true override**

```bash
curl -s -X POST "https://muy-rico-orders-api.bexgarcia0208.workers.dev/api/customers" \
  -H "Content-Type: application/json" \
  -d '{"id":"cust_test_dup3","name":"Test Dup 3","email":"dup@test.com","force":true}'
```

Expected: Returns `{ ok: true, id: "cust_test_dup3" }`.

- [ ] **Step 9: Test duplicates endpoint**

```bash
curl -s "https://muy-rico-orders-api.bexgarcia0208.workers.dev/api/customers/duplicates" \
  -H "Authorization: Bearer <cf-access-token>"
```

Expected: Returns array with the "Samantha" pair (or other seeded dupes) with correct `matchedBy`.

- [ ] **Step 10: Test merge endpoint**

```bash
curl -s -X POST "https://muy-rico-orders-api.bexgarcia0208.workers.dev/api/customers/merge" \
  -H "Content-Type: application/json" \
  -d '{"survivingId":"<older_id>","mergedId":"<newer_id>"}'
```

Expected: Returns `{ ok: true, survivingId, relinkedOrderCount }`. Verify:
- Merged customer has `active = 0`, `merged_into_id = survivingId`.
- Orders that had `customer_id = mergedId` now have `customer_id = survivingId`.
- `customer_merges` row exists with correct fields.

- [ ] **Step 11: Test reverse merge**

```bash
curl -s -X POST "https://muy-rico-orders-api.bexgarcia0208.workers.dev/api/customers/merge/<merge_id>/reverse" \
  -H "Content-Type: application/json"
```

Expected: Returns `{ ok: true, restoredId }`. Verify restored customer has `active = 1`, `merged_into_id = NULL`. Verify `customer_merges` row has `reversed_by` and `reversed_at` set.

- [ ] **Step 12: Final commit with all verification complete**

```bash
git add -A
git commit -m "feat(customers): customer match & merge system complete — verified"
```
