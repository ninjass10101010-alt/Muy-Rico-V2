# Dashboard Server-Side Persistence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the dashboard's customer, payment, label-template, and business-profile data out of browser `localStorage` and into the existing Cloudflare D1 database, so all dashboard data is identical across browsers.

**Architecture:** Extend the existing Cloudflare Worker (`orders/workers/api.js`) + D1 pattern used by orders/products/inventory. Add four D1 tables, four new REST route groups, a typed client in `src/utils/api.ts`, and a `StoreContext` rewrite that refreshes/persists these collections through the API instead of `useLocalStorage`. A `loading` flag gates the UI briefly on mount.

**Tech Stack:** Cloudflare Workers (module syntax), Cloudflare D1 (SQLite), TypeScript, React 19 (Vite SPA built to a single-file `admin/index.html`).

## Global Constraints

- All new collections stay admin-only (protected by the existing Cloudflare Access check at `orders/workers/api.js:64-68`); none go in the public allowlist.
- Reuse existing Worker patterns: `PRODUCT_FIELDS`/`INVENTORY_FIELDS` allowlist style, soft-delete via `active = 0`, `parseFlavors`/`safeJsonParse` JSON helpers, `ALLOWED_PAYMENT` validation (line 32), R2 upload via the existing `uploadImage` (lines 374-397).
- `amount` stored as decimal dollars in `payments` (matches TS `Payment.amount`; no cents math).
- `customers`/`payments`/`label_templates` use soft-delete (`active INTEGER DEFAULT 1`); `business_profile` is a single `id = 'singleton'` row (upsert).
- `label_templates.logo_image` stores an R2 URL (data URLs uploaded to R2 on save, same as product `image_url`).
- `resetAllData()` re-seeds server-side via `POST /api/seed/reset` then refreshes (no local writes).
- `localStorage` is deleted entirely (`src/hooks/useLocalStorage.ts` removed).
- TS client boundary uses camelCase; API functions map to snake_case request bodies (matching `createOrder` at `api.ts:6-18`).
- Keep `src/data/seedData.ts` as the client-side fallback for when the API is unreachable; mirror its values into SQL `INSERT OR IGNORE` in the migration.

---

### Task 1: D1 migration — four tables + seeds + reset

**Files:**
- Create: `orders/migrations/0006_server_storage.sql`

**Interfaces:**
- Produces: tables `customers`, `payments`, `label_templates`, `business_profile`; seed rows consumed by the migration's own `resetSeed` reuse.

- [x] **Step 1: Write the migration file**

```sql
-- Muy Rico — server-side storage for customers, payments, labels, profile
-- Run:
--   npx wrangler d1 execute muy-rico-orders --file=migrations/0006_server_storage.sql
--   npx wrangler d1 execute muy-rico-orders --remote --file=migrations/0006_server_storage.sql

CREATE TABLE IF NOT EXISTS customers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT,
  email       TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT,
  active      INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_customers_active ON customers(active);

CREATE TABLE IF NOT EXISTS payments (
  id            TEXT PRIMARY KEY,
  order_id      INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  order_number  TEXT,
  customer_name TEXT,
  amount        REAL NOT NULL DEFAULT 0,
  method        TEXT NOT NULL,
  date          TEXT NOT NULL DEFAULT (datetime('now')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  active        INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_payments_order   ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_active  ON payments(active);

CREATE TABLE IF NOT EXISTS label_templates (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  shape            TEXT,
  bg_color         TEXT,
  accent_color     TEXT,
  text_color       TEXT,
  business_name    TEXT,
  product_name     TEXT,
  details          TEXT,
  ingredients      TEXT,
  allergens        TEXT,
  net_weight       TEXT,
  price            TEXT,
  show_price       INTEGER,
  show_best_by     INTEGER,
  best_by_days     INTEGER,
  logo_emoji       TEXT,
  logo_image       TEXT,
  font             TEXT,
  business_id_mode TEXT,
  address          TEXT,
  phone_number     TEXT,
  registration_number TEXT,
  show_disclaimer  INTEGER,
  label_width      REAL,
  label_height     REAL,
  display_order    INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT,
  active           INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_labels_active  ON label_templates(active);
CREATE INDEX IF NOT EXISTS idx_labels_display ON label_templates(display_order);

CREATE TABLE IF NOT EXISTS business_profile (
  id                  TEXT PRIMARY KEY DEFAULT 'singleton',
  name                TEXT,
  tagline             TEXT,
  address             TEXT,
  phone               TEXT,
  email               TEXT,
  registration_number TEXT,
  accepted_methods    TEXT,
  cashtag             TEXT,
  venmo_handle        TEXT,
  apple_pay_enabled   INTEGER,
  stripe_connected    INTEGER,
  updated_at          TEXT
);

-- Seed from src/data/seedData.ts (kept in lock-step for offline fallback).
-- INSERT OR IGNORE so re-running never clobbers rows the user created.
INSERT OR IGNORE INTO customers (id, name, phone, email, notes, created_at)
VALUES
  ('cust_1','Maria Gonzalez','(616) 555-0142','maria.g@example.com','Regular — allergic to nuts.',datetime('now','-120 days')),
  ('cust_2','James Whitfield','(616) 555-0290','jwhitfield@example.com','Prefers pickup after 5pm.',datetime('now','-88 days')),
  ('cust_3','Aisha Thompson','(616) 555-0345','aisha.t@example.com','Orders birthday cakes monthly.',datetime('now','-64 days')),
  ('cust_4','Kevin Park','(616) 555-0321','kevin.park@example.com','',datetime('now','-30 days')),
  ('cust_5','Sophie Nguyen','(616) 555-0098','sophie.n@example.com','Found us via Instagram.',datetime('now','-14 days'));

INSERT OR IGNORE INTO label_templates
  (id, name, shape, bg_color, accent_color, text_color, business_name, product_name,
   details, ingredients, allergens, net_weight, price, show_price, show_best_by,
   best_by_days, logo_emoji, font, business_id_mode, address, phone_number,
   registration_number, show_disclaimer, label_width, label_height, display_order)
VALUES
  ('label_default','Classic Kraft Round','circle','#FBF3E7','#d93d59','#2c2523','Muy Rico',
   'Chocolate Chip Cookie','Made fresh with real butter & love',
   'Enriched flour (wheat flour, niacin, reduced iron, thiamine mononitrate, riboflavin, folic acid), butter (cream, salt), chocolate chips (sugar, chocolate liquor, cocoa butter, butterfat, soy lecithin), sugar, brown sugar, eggs, vanilla extract, baking soda, salt.',
   'Contains: wheat, milk, eggs, soy.','Net Wt. 3 oz','$4.00',1,1,3,'\u{1F36A}',
   '''Cormorant Garamond'', serif','registration','','(616) 218-3582','',1,3,4,0);

INSERT OR IGNORE INTO business_profile
  (id, name, tagline, address, phone, email, registration_number,
   accepted_methods, cashtag, venmo_handle, apple_pay_enabled, stripe_connected)
VALUES
  ('singleton','Muy Rico','Familia · Tradición · Sabor','Holland, MI','(616) 218-3582',
   'hello@muy-rico.com','',
   '{"stripe":false,"cashapp":true,"venmo":true,"applepay":true,"cash":true}',
   '$MuyRicoBakery','@Muy-Rico',1,0);
```

Note: `payments` are intentionally NOT seeded — `seedPayments` in `seedData.ts` is derived from `seedOrders`, but real payments only exist after orders are marked paid in the live DB (orders are not seeded into D1 either). Seeding payments here would create orphan rows the user didn't enter.

- [x] **Step 2: Apply migration to local D1 (verify it runs)**

Run: `cd /Users/garciafam/Documents/website/Muy-Rico-V2/orders && npx wrangler d1 execute muy-rico-orders --file=migrations/0006_server_storage.sql`

Expected: output showing the SQL executed with no errors.

- [x] **Step 3: Commit**

```bash
git add orders/migrations/0006_server_storage.sql
git commit -m "feat(db): add customers, payments, label_templates, business_profile tables"
```

---

### Task 2: Worker endpoints — customers, payments, labels, profile, seed/reset

**Files:**
- Modify: `orders/workers/api.js` (add route matches after line 108; add handler functions before the closing `};` at line 116)

**Interfaces:**
- Consumes: existing `env.DB`, `json()`, `ALLOWED_PAYMENT` (line 32), `emailFromAccessCookie`, `uploadImage` (lines 374-397).
- Produces: endpoints `GET/POST /api/customers`, `GET /api/customers/:id`, `PATCH/DELETE /api/customers/:id`, `GET/POST /api/payments`, `DELETE /api/payments/:id`, `GET/POST /api/labels`, `PATCH/DELETE /api/labels/:id`, `GET/PUT /api/profile`, `POST /api/seed/reset`.

- [x] **Step 1: Add route matches**

In the `try` block, after the inventory match (line 108), add:

```js
      const lm = path.match(/^\/api\/labels\/([A-Za-z0-9_-]+)$/);
      if (lm) {
        const id = lm[1];
        if (method === 'GET')    return await getLabelTemplate(id, env);
        if (method === 'PATCH')  return await updateLabelTemplate(id, request, env, actorName);
        if (method === 'DELETE') return await deleteLabelTemplate(id, env, actorName);
      }

      const cm = path.match(/^\/api\/customers\/([A-Za-z0-9_-]+)$/);
      if (cm) {
        const id = cm[1];
        if (method === 'GET')    return await getCustomer(id, env);
        if (method === 'PATCH')  return await updateCustomer(id, request, env, actorName);
        if (method === 'DELETE') return await deleteCustomer(id, env, actorName);
      }

      if (path === '/api/customers' && method === 'GET') return await listCustomers(env);
      if (path === '/api/customers' && method === 'POST') return await createCustomer(request, env, actorName);
      if (path === '/api/payments' && method === 'GET') return await listPayments(env);
      if (path === '/api/payments' && method === 'POST') return await createPayment(request, env, actorName);
      if (path === '/api/labels' && method === 'GET') return await listLabelTemplates(env);
      if (path === '/api/labels' && method === 'POST') return await createLabelTemplate(request, env, actorName);
      if (path === '/api/profile' && method === 'GET') return await getProfile(env);
      if (path === '/api/profile' && method === 'PUT') return await updateProfile(request, env, actorName);
      if (path === '/api/seed/reset' && method === 'POST') return await resetSeed(env, actorName);
```

- [x] **Step 2: Add handler functions** (before the closing `};` of the default export, after `deleteInventoryItem` at line 625)

```js
// ─── Customers ──────────────────────────────────────────────────────────────

const CUSTOMER_FIELDS = ['name', 'phone', 'email', 'notes'];

async function listCustomers(env) {
  const { results } = await env.DB.prepare(`
    SELECT * FROM customers WHERE active = 1 ORDER BY created_at DESC
  `).all();
  return json({ customers: results }, 200);
}

async function getCustomer(id, env) {
  const row = await env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'Not found' }, 404);
  return json({ customer: row }, 200);
}

async function createCustomer(request, env, actor) {
  const body = await request.json();
  if (!body.id || !body.name) return json({ error: 'Missing required fields: id, name' }, 400);
  if (typeof body.id !== 'string' || body.id.length > 64) return json({ error: 'id must be a short string' }, 400);
  try {
    await env.DB.prepare(`
      INSERT INTO customers (id, name, phone, email, notes, created_at, active)
      VALUES (?, ?, ?, ?, ?, datetime('now'), 1)
    `).bind(
      body.id, body.name, body.phone || null, body.email || null, body.notes || null
    ).run();
  } catch (err) {
    return json({ error: String(err) }, 400);
  }
  return json({ ok: true, id: body.id }, 201);
}

async function updateCustomer(id, request, env, actor) {
  const body = await request.json();
  const sets = [], binds = [];
  for (const f of CUSTOMER_FIELDS) {
    if (body[f] === undefined) continue;
    sets.push(`${f} = ?`); binds.push(body[f]);
  }
  if (!sets.length) return json({ error: 'Nothing to update' }, 400);
  sets.push("updated_at = datetime('now')");
  binds.push(id);
  const r = await env.DB.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  if (!r.meta.changes) return json({ error: 'Not found' }, 404);
  return json({ ok: true }, 200);
}

async function deleteCustomer(id, env, actor) {
  const r = await env.DB.prepare(`UPDATE customers SET active = 0, updated_at = datetime('now') WHERE id = ?`).bind(id).run();
  if (!r.meta.changes) return json({ error: 'Not found' }, 404);
  return json({ ok: true }, 200);
}

// ─── Payments ───────────────────────────────────────────────────────────────

async function listPayments(env) {
  const { results } = await env.DB.prepare(`
    SELECT * FROM payments WHERE active = 1 ORDER BY date DESC, created_at DESC
  `).all();
  return json({ payments: results }, 200);
}

async function createPayment(request, env, actor) {
  const body = await request.json();
  if (!body.id || !body.customer_name || !body.method) {
    return json({ error: 'Missing required fields: id, customer_name, method' }, 400);
  }
  if (!ALLOWED_PAYMENT.includes(body.method)) {
    return json({ error: `Invalid method. Must be one of: ${ALLOWED_PAYMENT.join(', ')}` }, 400);
  }
  try {
    await env.DB.prepare(`
      INSERT INTO payments (id, order_id, order_number, customer_name, amount, method, date, created_at, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), 1)
    `).bind(
      body.id,
      body.order_id ?? null,
      body.order_number || null,
      body.customer_name,
      Number(body.amount) || 0,
      body.method,
      body.date || null,
    ).run();
  } catch (err) {
    return json({ error: String(err) }, 400);
  }
  return json({ ok: true, id: body.id }, 201);
}

async function deletePayment(id, env, actor) {
  const r = await env.DB.prepare(`UPDATE payments SET active = 0 WHERE id = ?`).bind(id).run();
  if (!r.meta.changes) return json({ error: 'Not found' }, 404);
  return json({ ok: true }, 200);
}

// ─── Label templates ─────────────────────────────────────────────────────────

const LABEL_FIELDS = [
  'name', 'shape', 'bg_color', 'accent_color', 'text_color', 'business_name',
  'product_name', 'details', 'ingredients', 'allergens', 'net_weight', 'price',
  'show_price', 'show_best_by', 'best_by_days', 'logo_emoji', 'logo_image',
  'font', 'business_id_mode', 'address', 'phone_number', 'registration_number',
  'show_disclaimer', 'label_width', 'label_height', 'display_order',
];

function parseLabelLogo(v) {
  if (v == null || v === '') return null;
  // data: URLs are uploaded to R2 by the Worker before insert; plain URLs pass through.
  return typeof v === 'string' ? v : null;
}

async function listLabelTemplates(env) {
  const { results } = await env.DB.prepare(`
    SELECT * FROM label_templates WHERE active = 1 ORDER BY display_order ASC, name ASC
  `).all();
  return json({ labelTemplates: results }, 200);
}

async function getLabelTemplate(id, env) {
  const row = await env.DB.prepare('SELECT * FROM label_templates WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'Not found' }, 404);
  return json({ labelTemplate: row }, 200);
}

async function createLabelTemplate(request, env, actor) {
  const body = await request.json();
  if (!body.id || !body.name) return json({ error: 'Missing required fields: id, name' }, 400);
  if (typeof body.id !== 'string' || body.id.length > 64) return json({ error: 'id must be a short string' }, 400);
  if (body.logo_image && typeof body.logo_image === 'string' && body.logo_image.startsWith('data:')) {
    try {
      const url = await uploadDataUrlToR2(body.logo_image, env);
      body.logo_image = url;
    } catch (e) { return json({ error: 'logo upload failed: ' + String(e) }, 400); }
  }
  const cols = ['id', ...LABEL_FIELDS];
  const placeholders = cols.map(() => '?').join(', ');
  const binds = [body.id];
  for (const f of LABEL_FIELDS) {
    let val = body[f] ?? null;
    if (f === 'show_price' || f === 'show_best_by' || f === 'show_disclaimer' || f === 'apple_pay_enabled') val = val ? 1 : 0;
    if (f === 'best_by_days' || f === 'label_width' || f === 'label_height' || f === 'display_order') val = val === null || val === '' ? 0 : Number(val);
    binds.push(val);
  }
  try {
    await env.DB.prepare(`INSERT INTO label_templates (${cols.join(', ')}) VALUES (${placeholders})`).bind(...binds).run();
  } catch (err) {
    return json({ error: String(err) }, 400);
  }
  return json({ ok: true, id: body.id }, 201);
}

async function updateLabelTemplate(id, request, env, actor) {
  const body = await request.json();
  if (body.logo_image && typeof body.logo_image === 'string' && body.logo_image.startsWith('data:')) {
    try {
      body.logo_image = await uploadDataUrlToR2(body.logo_image, env);
    } catch (e) { return json({ error: 'logo upload failed: ' + String(e) }, 400); }
  }
  const sets = [], binds = [];
  for (const f of LABEL_FIELDS) {
    if (body[f] === undefined) continue;
    let val = body[f];
    if (f === 'show_price' || f === 'show_best_by' || f === 'show_disclaimer') val = val ? 1 : 0;
    if (f === 'best_by_days' || f === 'label_width' || f === 'label_height' || f === 'display_order') val = val === null || val === '' ? null : Number(val);
    sets.push(`${f} = ?`); binds.push(val);
  }
  if (!sets.length) return json({ error: 'Nothing to update' }, 400);
  sets.push("updated_at = datetime('now')");
  binds.push(id);
  const r = await env.DB.prepare(`UPDATE label_templates SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  if (!r.meta.changes) return json({ error: 'Not found' }, 404);
  return json({ ok: true }, 200);
}

async function deleteLabelTemplate(id, env, actor) {
  const r = await env.DB.prepare(`UPDATE label_templates SET active = 0, updated_at = datetime('now') WHERE id = ?`).bind(id).run();
  if (!r.meta.changes) return json({ error: 'Not found' }, 404);
  return json({ ok: true }, 200);
}

async function uploadDataUrlToR2(dataUrl, env) {
  const [meta, b64] = dataUrl.split(',');
  const mimeMatch = meta.match(/data:(.*?);base64/);
  const ext = (mimeMatch ? mimeMatch[1].split('/')[1] : 'png').replace('jpeg', 'jpg');
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const key = `labels/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  await env.IMAGES_BUCKET.put(key, bin, { httpMetadata: { contentType: mimeMatch ? mimeMatch[1] : 'image/png' } });
  return `https://pub-${env.R2_PUBLIC_ID || '71c703c51efd43de8dde4439bd02a8af'}.r2.dev/${key}`;
}

// ─── Business profile (singleton) ────────────────────────────────────────────

const PROFILE_FIELDS = [
  'name', 'tagline', 'address', 'phone', 'email', 'registration_number',
  'accepted_methods', 'cashtag', 'venmo_handle', 'apple_pay_enabled', 'stripe_connected',
];

async function getProfile(env) {
  const row = await env.DB.prepare("SELECT * FROM business_profile WHERE id = 'singleton'").first();
  if (!row) return json({ profile: null }, 200);
  return json({ profile: row }, 200);
}

async function updateProfile(request, env, actor) {
  const body = await request.json();
  const cols = ['id', ...PROFILE_FIELDS];
  const vals = { id: 'singleton' };
  const sets = ['id = ?'], binds = ['singleton'];
  for (const f of PROFILE_FIELDS) {
    let val = body[f];
    if (f === 'apple_pay_enabled' || f === 'stripe_connected') val = val ? 1 : 0;
    if (f === 'accepted_methods' && typeof val === 'object') val = JSON.stringify(val);
    sets.push(`${f} = ?`); binds.push(val ?? null);
    vals[f] = val ?? null;
  }
  sets.push("updated_at = datetime('now')");
  const r = await env.DB.prepare(`
    INSERT INTO business_profile (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
    ON CONFLICT(id) DO UPDATE SET ${PROFILE_FIELDS.map((f) => `${f} = excluded.${f}`).join(', ')}, updated_at = datetime('now')
  `).bind('singleton', ...binds.slice(1)).run();
  if (!r.meta.changes && r.meta.success !== false) return json({ ok: true }, 200);
  return json({ ok: true }, 200);
}

// ─── Seed reset (re-runs INSERT OR IGNORE blocks) ───────────────────────────

async function resetSeed(env, actor) {
  const seed = `
    INSERT OR IGNORE INTO customers (id, name, phone, email, notes, created_at)
    VALUES
      ('cust_1','Maria Gonzalez','(616) 555-0142','maria.g@example.com','Regular — allergic to nuts.',datetime('now','-120 days')),
      ('cust_2','James Whitfield','(616) 555-0290','jwhitfield@example.com','Prefers pickup after 5pm.',datetime('now','-88 days')),
      ('cust_3','Aisha Thompson','(616) 555-0345','aisha.t@example.com','Orders birthday cakes monthly.',datetime('now','-64 days')),
      ('cust_4','Kevin Park','(616) 555-0321','kevin.park@example.com','',datetime('now','-30 days')),
      ('cust_5','Sophie Nguyen','(616) 555-0098','sophie.n@example.com','Found us via Instagram.',datetime('now','-14 days'));

    INSERT OR IGNORE INTO label_templates
      (id, name, shape, bg_color, accent_color, text_color, business_name, product_name,
       details, ingredients, allergens, net_weight, price, show_price, show_best_by,
       best_by_days, logo_emoji, font, business_id_mode, address, phone_number,
       registration_number, show_disclaimer, label_width, label_height, display_order)
    VALUES
      ('label_default','Classic Kraft Round','circle','#FBF3E7','#d93d59','#2c2523','Muy Rico',
       'Chocolate Chip Cookie','Made fresh with real butter & love',
       'Enriched flour (wheat flour, niacin, reduced iron, thiamine mononitrate, riboflavin, folic acid), butter (cream, salt), chocolate chips (sugar, chocolate liquor, cocoa butter, butterfat, soy lecithin), sugar, brown sugar, eggs, vanilla extract, baking soda, salt.',
       'Contains: wheat, milk, eggs, soy.','Net Wt. 3 oz','$4.00',1,1,3,'\u{1F36A}',
       '''Cormorant Garamond'', serif','registration','','(616) 218-3582','',1,3,4,0);

    INSERT OR IGNORE INTO business_profile
      (id, name, tagline, address, phone, email, registration_number,
       accepted_methods, cashtag, venmo_handle, apple_pay_enabled, stripe_connected)
    VALUES
      ('singleton','Muy Rico','Familia · Tradición · Sabor','Holland, MI','(616) 218-3582',
       'hello@muy-rico.com','',
       '{"stripe":false,"cashapp":true,"venmo":true,"applepay":true,"cash":true}',
       '$MuyRicoBakery','@Muy-Rico',1,0);
  `;
  try {
    await env.DB.exec(seed);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
  return json({ ok: true }, 200);
}
```

- [x] **Step 3: Verify the Worker parses** by running `npx wrangler deploy --dry-run` (from `orders/`) or `node --check workers/api.js`.

Run: `cd /Users/garciafam/Documents/website/Muy-Rico-V2/orders && node --check workers/api.js`
Expected: no syntax error output.

- [x] **Step 4: Commit**

```bash
git add orders/workers/api.js
git commit -m "feat(api): add customers, payments, labels, profile, seed/reset endpoints"
```

---

### Task 3: TS types — add `active` flag

**Files:**
- Modify: `home-bakery-management-system/src/types.ts` (`Customer` at lines 69-76; `Payment` at lines 106-114; `LabelTemplate` at lines 120-147)

**Interfaces:**
- Produces: `active?: boolean` on `Customer`, `Payment`, `LabelTemplate` (read-only from server; pages ignore it).

- [x] **Step 1: Add `active?` to `Customer`**

In `home-bakery-management-system/src/types.ts`, change:
```ts
export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
  createdAt: string;
}
```
to:
```ts
export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
  createdAt: string;
  active?: boolean;
}
```

- [x] **Step 2: Add `active?` to `Payment`**

Change:
```ts
export interface Payment {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  amount: number;
  method: PaymentMethod;
  date: string;
}
```
to:
```ts
export interface Payment {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  amount: number;
  method: PaymentMethod;
  date: string;
  active?: boolean;
}
```

- [x] **Step 3: Add `active?` to `LabelTemplate`**

In the `LabelTemplate` interface (ends at line 147, `}`), add `active?: boolean;` after `labelHeight: number;`. The interface currently ends:
```ts
  labelWidth: number;
  labelHeight: number;
}
```
Change to:
```ts
  labelWidth: number;
  labelHeight: number;
  active?: boolean;
}
```

- [x] **Step 4: Commit**

```bash
git add home-bakery-management-system/src/types.ts
git commit -m "feat(types): add optional active flag to Customer/Payment/LabelTemplate"
```

---

### Task 4: API client functions — `src/utils/api.ts`

**Files:**
- Modify: `home-bakery-management-system/src/utils/api.ts` (append after the inventory block, after line 254)

**Interfaces:**
- Consumes: `API_BASE`, `apiFetch` (lines 47-61).
- Produces: `fetchCustomers`, `createCustomer`, `updateCustomer`, `deleteCustomer`, `fetchPayments`, `createPayment`, `deletePayment`, `fetchLabelTemplates`, `createLabelTemplate`, `updateLabelTemplate`, `deleteLabelTemplate`, `fetchProfile`, `updateProfile`, `resetSeedData`.

- [x] **Step 1: Append client functions**

At the end of `home-bakery-management-system/src/utils/api.ts`, add:

```ts
// ─── Customers ───────────────────────────────────────────────────────────────

export interface ApiCustomer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string | null;
  active: boolean;
}

export interface CustomerCreate {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
}

export type CustomerUpdate = Partial<CustomerCreate>;

export async function fetchCustomers(): Promise<ApiCustomer[]> {
  const data = await apiFetch<{ customers: ApiCustomer[] }>("/api/customers");
  return data.customers;
}

export async function createCustomer(c: CustomerCreate): Promise<{ ok: boolean; id: string }> {
  return apiFetch("/api/customers", {
    method: "POST",
    body: JSON.stringify(c),
  });
}

export async function updateCustomer(id: string, patch: CustomerUpdate): Promise<{ ok: boolean }> {
  return apiFetch(`/api/customers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteCustomer(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/customers/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// ─── Payments ─────────────────────────────────────────────────────────────────

export interface ApiPayment {
  id: string;
  orderId: number | null;
  orderNumber: string | null;
  customerName: string;
  amount: number;
  method: PaymentMethod;
  date: string;
  createdAt: string;
  active: boolean;
}

export interface PaymentCreate {
  id: string;
  orderId?: number | null;
  orderNumber?: string | null;
  customerName: string;
  amount: number;
  method: PaymentMethod;
  date?: string;
}

export async function fetchPayments(): Promise<ApiPayment[]> {
  const data = await apiFetch<{ payments: ApiPayment[] }>("/api/payments");
  return data.payments;
}

export async function createPayment(p: PaymentCreate): Promise<{ ok: boolean; id: string }> {
  return apiFetch("/api/payments", {
    method: "POST",
    body: JSON.stringify(p),
  });
}

export async function deletePayment(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/payments/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// ─── Label templates ──────────────────────────────────────────────────────────

export interface ApiLabelTemplate {
  id: string;
  name: string;
  shape: string | null;
  bgColor: string | null;
  accentColor: string | null;
  textColor: string | null;
  businessName: string | null;
  productName: string | null;
  details: string | null;
  ingredients: string | null;
  allergens: string | null;
  netWeight: string | null;
  price: string | null;
  showPrice: number | null;
  showBestBy: number | null;
  bestByDays: number | null;
  logoEmoji: string | null;
  logoImage: string | null;
  font: string | null;
  businessIdMode: string | null;
  address: string | null;
  phoneNumber: string | null;
  registrationNumber: string | null;
  showDisclaimer: number | null;
  labelWidth: number | null;
  labelHeight: number | null;
  displayOrder: number;
  active: boolean;
}

export interface LabelTemplateCreate {
  id: string;
  name: string;
  shape?: string | null;
  bgColor?: string | null;
  accentColor?: string | null;
  textColor?: string | null;
  businessName?: string | null;
  productName?: string | null;
  details?: string | null;
  ingredients?: string | null;
  allergens?: string | null;
  netWeight?: string | null;
  price?: string | null;
  showPrice?: boolean | null;
  showBestBy?: boolean | null;
  bestByDays?: number | null;
  logoEmoji?: string | null;
  logoImage?: string | null;
  font?: string | null;
  businessIdMode?: string | null;
  address?: string | null;
  phoneNumber?: string | null;
  registrationNumber?: string | null;
  showDisclaimer?: boolean | null;
  labelWidth?: number | null;
  labelHeight?: number | null;
  displayOrder?: number | null;
}

export type LabelTemplateUpdate = Partial<LabelTemplateCreate>;

export async function fetchLabelTemplates(): Promise<ApiLabelTemplate[]> {
  const data = await apiFetch<{ labelTemplates: ApiLabelTemplate[] }>("/api/labels");
  return data.labelTemplates;
}

export async function createLabelTemplate(t: LabelTemplateCreate): Promise<{ ok: boolean; id: string }> {
  return apiFetch("/api/labels", {
    method: "POST",
    body: JSON.stringify(t),
  });
}

export async function updateLabelTemplate(id: string, patch: LabelTemplateUpdate): Promise<{ ok: boolean }> {
  return apiFetch(`/api/labels/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteLabelTemplate(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/labels/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// ─── Business profile (singleton) ─────────────────────────────────────────────

export interface ApiBusinessProfile {
  id: string;
  name: string | null;
  tagline: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  registrationNumber: string | null;
  acceptedMethods: string | null;
  cashtag: string | null;
  venmoHandle: string | null;
  applePayEnabled: number | null;
  stripeConnected: number | null;
  updatedAt: string | null;
}

export async function fetchProfile(): Promise<ApiBusinessProfile | null> {
  const data = await apiFetch<{ profile: ApiBusinessProfile | null }>("/api/profile");
  return data.profile;
}

export async function updateProfile(p: BusinessProfile): Promise<{ ok: boolean }> {
  return apiFetch("/api/profile", {
    method: "PUT",
    body: JSON.stringify(p),
  });
}

// ─── Seed reset ────────────────────────────────────────────────────────────────

export async function resetSeedData(): Promise<{ ok: boolean }> {
  return apiFetch("/api/seed/reset", {
    method: "POST",
  });
}
```

- [x] **Step 2: Commit**

```bash
git add home-bakery-management-system/src/utils/api.ts
git commit -m "feat(api): add client functions for customers, payments, labels, profile"
```

---

### Task 5: StoreContext rewrite

**Files:**
- Modify: `home-bakery-management-system/src/context/StoreContext.tsx` (imports line 1-2; state lines 59-69; refreshers; `recordPayment` lines 247-261; `resetAllData` lines 284-292; context value lines 294-327)

**Interfaces:**
- Consumes: client functions from Task 4; `newId` from `utils/format`; seeds from `seedData`.
- Produces: `loading`, `handleCreateCustomer`, `handleUpdateCustomer`, `handleDeleteCustomer`, `handleCreateLabel`, `handleUpdateLabel`, `handleDeleteLabel`, `handleUpdateProfile`, async `recordPayment`, async `resetAllData`. Removes public `setCustomers`/`setPayments`/`setLabelTemplates`/`setProfile`.

- [x] **Step 1: Remove `useLocalStorage` import**

Change line 2:
```ts
import { useLocalStorage } from "../hooks/useLocalStorage";
```
to remove it (delete the line). Keep line 1:
```ts
import { createContext, useCallback, useEffect, useContext, useMemo, useState, type ReactNode } from "react";
```

- [x] **Step 2: Replace the four `useLocalStorage` state calls**

Replace lines 62-69:
```ts
  const [customers, setCustomers] = useLocalStorage<Customer[]>("muyrico_customers", seedCustomers);
  const [orders, setOrders] = useState<Order[]>([]);
  const [payments, setPayments] = useLocalStorage<Payment[]>("muyrico_payments", seedPayments);
  const [labelTemplates, setLabelTemplates] = useLocalStorage<LabelTemplate[]>(
    "muyrico_labels",
    seedLabelTemplates,
  );
  const [profile, setProfile] = useLocalStorage<BusinessProfile>("muyrico_profile", seedProfile);
```
with:
```ts
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [labelTemplates, setLabelTemplates] = useState<LabelTemplate[]>([]);
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [loading, setLoading] = useState(true);
```

Also add the API imports to line 23. Change:
```ts
import { fetchOrders, createOrder as apiCreateOrder, updateOrder as apiUpdateOrder, cancelOrder as apiCancelOrder, fetchProducts, createProduct as apiCreateProduct, updateProduct as apiUpdateProduct, deleteProduct as apiDeleteProduct, fetchInventory, createInventoryItem as apiCreateInventoryItem, updateInventoryItem as apiUpdateInventoryItem, deleteInventoryItem as apiDeleteInventoryItem, type ApiProduct, type ApiInventoryItem } from "../utils/api";
```
to:
```ts
import { fetchOrders, createOrder as apiCreateOrder, updateOrder as apiUpdateOrder, cancelOrder as apiCancelOrder, fetchProducts, createProduct as apiCreateProduct, updateProduct as apiUpdateProduct, deleteProduct as apiDeleteProduct, fetchInventory, createInventoryItem as apiCreateInventoryItem, updateInventoryItem as apiUpdateInventoryItem, deleteInventoryItem as apiDeleteInventoryItem, fetchCustomers, createCustomer as apiCreateCustomer, updateCustomer as apiUpdateCustomer, deleteCustomer as apiDeleteCustomer, fetchPayments, createPayment as apiCreatePayment, deletePayment as apiDeletePayment, fetchLabelTemplates, createLabelTemplate as apiCreateLabelTemplate, updateLabelTemplate as apiUpdateLabelTemplate, deleteLabelTemplate as apiDeleteLabelTemplate, fetchProfile, updateProfile as apiUpdateProfile, resetSeedData, type ApiProduct, type ApiInventoryItem } from "../utils/api";
```

- [x] **Step 3: Add private mappers + refreshers**

After `refreshInventory` (ends line 197), add:

```ts
  function apiToCustomer(row: ApiCustomer): Customer {
    return {
      id: row.id,
      name: row.name,
      phone: row.phone || "",
      email: row.email || "",
      notes: row.notes || "",
      createdAt: row.createdAt,
      active: Boolean(row.active),
    };
  }

  const refreshCustomers = useCallback(async () => {
    try {
      const rows = await fetchCustomers();
      setCustomers(rows.map(apiToCustomer));
    } catch (err) {
      console.warn("Failed to fetch customers from API, falling back to seeds:", err);
      setCustomers(seedCustomers);
    }
  }, []);

  function apiToPayment(row: ApiPayment): Payment {
    return {
      id: row.id,
      orderId: row.orderId ? String(row.orderId) : "",
      orderNumber: row.orderNumber || "",
      customerName: row.customerName,
      amount: Number(row.amount) || 0,
      method: row.method,
      date: row.date,
      active: Boolean(row.active),
    };
  }

  const refreshPayments = useCallback(async () => {
    try {
      const rows = await fetchPayments();
      setPayments(rows.map(apiToPayment));
    } catch (err) {
      console.warn("Failed to fetch payments from API, falling back to seeds:", err);
      setPayments(seedPayments);
    }
  }, []);

  function apiToLabelTemplate(row: ApiLabelTemplate): LabelTemplate {
    return {
      id: row.id,
      name: row.name,
      shape: (row.shape as LabelTemplate["shape"]) || "rounded",
      bgColor: row.bgColor || "#FBF3E7",
      accentColor: row.accentColor || "#C17A3F",
      textColor: row.textColor || "#4A3222",
      businessName: row.businessName || "",
      productName: row.productName || "",
      details: row.details || "",
      ingredients: row.ingredients || "",
      allergens: row.allergens || "",
      netWeight: row.netWeight || "",
      price: row.price || "",
      showPrice: Boolean(row.showPrice),
      showBestBy: Boolean(row.showBestBy),
      bestByDays: Number(row.bestByDays) || 0,
      logoEmoji: row.logoEmoji || "",
      logoImage: row.logoImage || undefined,
      font: row.font || "'Cormorant Garamond', Georgia, serif",
      businessIdMode: (row.businessIdMode as LabelTemplate["businessIdMode"]) || "address",
      address: row.address || "",
      phoneNumber: row.phoneNumber || "",
      registrationNumber: row.registrationNumber || "",
      showDisclaimer: Boolean(row.showDisclaimer),
      labelWidth: Number(row.labelWidth) || 3,
      labelHeight: Number(row.labelHeight) || 4,
      active: Boolean(row.active),
    };
  }

  const refreshLabelTemplates = useCallback(async () => {
    try {
      const rows = await fetchLabelTemplates();
      setLabelTemplates(rows.map(apiToLabelTemplate));
    } catch (err) {
      console.warn("Failed to fetch label templates from API, falling back to seeds:", err);
      setLabelTemplates(seedLabelTemplates);
    }
  }, []);

  function apiToProfile(row: ApiBusinessProfile): BusinessProfile {
    let accepted = seedProfile.acceptedMethods;
    try {
      if (row.acceptedMethods) accepted = JSON.parse(row.acceptedMethods) as BusinessProfile["acceptedMethods"];
    } catch { /* keep seed */ }
    return {
      name: row.name || seedProfile.name,
      tagline: row.tagline || seedProfile.tagline,
      address: row.address || seedProfile.address,
      phone: row.phone || seedProfile.phone,
      email: row.email || seedProfile.email,
      registrationNumber: row.registrationNumber || seedProfile.registrationNumber,
      acceptedMethods: accepted,
      cashtag: row.cashtag || seedProfile.cashtag,
      venmoHandle: row.venmoHandle || seedProfile.venmoHandle,
      applePayEnabled: Boolean(row.applePayEnabled),
      stripeConnected: Boolean(row.stripeConnected),
    };
  }

  const refreshProfile = useCallback(async () => {
    try {
      const p = await fetchProfile();
      if (p) setProfile(apiToProfile(p));
      else setProfile(seedProfile);
    } catch (err) {
      console.warn("Failed to fetch profile from API, falling back to seed:", err);
      setProfile(seedProfile);
    }
  }, []);
```

- [x] **Step 4: Add a single `refreshAll` + loading effect**

After the last `useEffect` (the `refreshInventory` one, line 197), add:

```ts
  const refreshAll = useCallback(async () => {
    await Promise.all([
      refreshOrders(),
      refreshProducts(),
      refreshInventory(),
      refreshCustomers(),
      refreshPayments(),
      refreshLabelTemplates(),
      refreshProfile(),
    ]);
  }, [refreshOrders, refreshProducts, refreshInventory, refreshCustomers, refreshPayments, refreshLabelTemplates, refreshProfile]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await refreshAll();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [refreshAll]);
```

- [x] **Step 5: Rewrite `recordPayment` to async + persist**

Replace lines 247-261:
```ts
  const recordPayment = (order: Order) => {
    if (!order.paymentMethod) return;
    setPayments((prev) => [
      {
        id: newId("pay"),
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        amount: order.total,
        method: order.paymentMethod!,
        date: new Date().toISOString(),
      },
      ...prev,
    ]);
  };
```
with:
```ts
  const recordPayment = useCallback(async (order: Order) => {
    if (!order.paymentMethod) return;
    try {
      await apiCreatePayment({
        id: newId("pay"),
        orderId: Number(order.id) || null,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        amount: order.total,
        method: order.paymentMethod,
        date: new Date().toISOString(),
      });
      await refreshPayments();
    } catch (err) {
      console.warn("Failed to record payment to API:", err);
    }
  }, [refreshPayments]);
```

- [x] **Step 6: Rewrite `resetAllData`**

Replace lines 284-292:
```ts
  const resetAllData = () => {
    setCustomers(seedCustomers);
    setPayments(seedPayments);
    setLabelTemplates(seedLabelTemplates);
    setProfile(seedProfile);
    refreshOrders();
    refreshProducts();
    refreshInventory();
  };
```
with:
```ts
  const resetAllData = useCallback(async () => {
    try {
      await resetSeedData();
    } catch (err) {
      console.warn("Failed to reset seed data on API:", err);
    }
    await refreshAll();
  }, [refreshAll]);
```

- [x] **Step 7: Add handler wrappers**

After `handleApiDeleteInventoryItem` (ends line 245), add:

```ts
  const handleCreateCustomer = useCallback(async (c: Parameters<typeof apiCreateCustomer>[0]) => {
    const result = await apiCreateCustomer(c);
    await refreshCustomers();
    return result;
  }, [refreshCustomers]);

  const handleUpdateCustomer = useCallback(async (id: string, patch: Parameters<typeof apiUpdateCustomer>[1]) => {
    await apiUpdateCustomer(id, patch);
    await refreshCustomers();
  }, [refreshCustomers]);

  const handleDeleteCustomer = useCallback(async (id: string) => {
    await apiDeleteCustomer(id);
    await refreshCustomers();
  }, [refreshCustomers]);

  const handleCreateLabel = useCallback(async (t: Parameters<typeof apiCreateLabelTemplate>[0]) => {
    const result = await apiCreateLabelTemplate(t);
    await refreshLabelTemplates();
    return result;
  }, [refreshLabelTemplates]);

  const handleUpdateLabel = useCallback(async (id: string, patch: Parameters<typeof apiUpdateLabelTemplate>[1]) => {
    await apiUpdateLabelTemplate(id, patch);
    await refreshLabelTemplates();
  }, [refreshLabelTemplates]);

  const handleDeleteLabel = useCallback(async (id: string) => {
    await apiDeleteLabelTemplate(id);
    await refreshLabelTemplates();
  }, [refreshLabelTemplates]);

  const handleUpdateProfile = useCallback(async (draft: BusinessProfile) => {
    await apiUpdateProfile(draft);
    await refreshProfile();
  }, [refreshProfile]);
```

- [x] **Step 8: Update the context interface + value**

In `StoreContextValue` (lines 25-55), replace the `setCustomers`/`setPayments`/`setLabelTemplates`/`setProfile`/`recordPayment`/`resetAllData` declarations:

```ts
  customers: Customer[];
  setCustomers: React.Dispatch<React.SetStateAction<Customer[]>>;
```
→
```ts
  customers: Customer[];
  handleCreateCustomer: (c: Parameters<typeof apiCreateCustomer>[0]) => Promise<{ ok: boolean; id: string }>;
  handleUpdateCustomer: (id: string, patch: Parameters<typeof apiUpdateCustomer>[1]) => Promise<void>;
  handleDeleteCustomer: (id: string) => Promise<void>;
```
```ts
  payments: Payment[];
  setPayments: React.Dispatch<React.SetStateAction<Payment[]>>;
```
→
```ts
  payments: Payment[];
```
```ts
  labelTemplates: LabelTemplate[];
  setLabelTemplates: React.Dispatch<React.SetStateAction<LabelTemplate[]>>;
```
→
```ts
  labelTemplates: LabelTemplate[];
  handleCreateLabel: (t: Parameters<typeof apiCreateLabelTemplate>[0]) => Promise<{ ok: boolean; id: string }>;
  handleUpdateLabel: (id: string, patch: Parameters<typeof apiUpdateLabelTemplate>[1]) => Promise<void>;
  handleDeleteLabel: (id: string) => Promise<void>;
```
```ts
  profile: BusinessProfile;
  setProfile: React.Dispatch<React.SetStateAction<BusinessProfile>>;
  recordPayment: (order: Order) => void;
```
→
```ts
  profile: BusinessProfile | null;
  handleUpdateProfile: (draft: BusinessProfile) => Promise<void>;
  recordPayment: (order: Order) => Promise<void>;
  loading: boolean;
```

Also change `resetAllData: () => void;` → `resetAllData: () => Promise<void>;`.

In the `value` useMemo (lines 294-327), replace the old `setCustomers`/`setPayments`/`setLabelTemplates`/`setProfile`/`recordPayment`/`resetAllData` entries with the new handlers:
```ts
      customers,
      setCustomers,
```
→
```ts
      customers,
      handleCreateCustomer,
      handleUpdateCustomer,
      handleDeleteCustomer,
```
```ts
      payments,
      setPayments,
```
→
```ts
      payments,
```
```ts
      labelTemplates,
      setLabelTemplates,
```
→
```ts
      labelTemplates,
      handleCreateLabel,
      handleUpdateLabel,
      handleDeleteLabel,
```
```ts
      profile,
      setProfile,
      recordPayment,
```
→
```ts
      profile,
      handleUpdateProfile,
      recordPayment,
      loading,
```
and `resetAllData,` stays (now async). Also add the new callbacks to the useMemo deps array (line 326): append `handleCreateCustomer, handleUpdateCustomer, handleDeleteCustomer, handleCreateLabel, handleUpdateLabel, handleDeleteLabel, handleUpdateProfile, loading`.

- [x] **Step 9: Typecheck**

Run: `cd /Users/garciafam/Documents/website/Muy-Rico-V2/home-bakery-management-system && npx tsc --noEmit`
Expected: errors about `setCustomers`/`setPayments`/`setLabelTemplates`/`setProfile` usage in pages (expected — fixed in Task 6). Errors about `profile` being possibly null where it was non-null before — fix call sites in Task 6.

- [x] **Step 10: Commit**

```bash
git add home-bakery-management-system/src/context/StoreContext.tsx
git commit -m "refactor(store): move customers/payments/labels/profile to D1-backed state"
```

---

### Task 6: Page refactors (caller sites)

**Files:**
- Modify: `home-bakery-management-system/src/pages/Customers.tsx` (lines 18, 49-61)
- Modify: `home-bakery-management-system/src/components/OrderModal.tsx` (lines 9, 113-115)
- Modify: `home-bakery-management-system/src/pages/LabelDesigner.tsx` (lines 41, 68-94)
- Modify: `home-bakery-management-system/src/pages/Settings.tsx` (lines 16-24, 67-77)
- Modify: `home-bakery-management-system/src/pages/Orders.tsx` (line 56)

**Interfaces:**
- Consumes: handlers from Task 5 (`handleCreateCustomer`, `handleUpdateCustomer`, `handleDeleteCustomer`, `handleCreateLabel`, `handleUpdateLabel`, `handleDeleteLabel`, `handleUpdateProfile`, async `recordPayment`, async `resetAllData`, `loading`).

- [x] **Step 1: Customers.tsx**

Change line 18:
```ts
  const { customers, setCustomers, orders } = useStore();
```
to:
```ts
  const { customers, handleCreateCustomer, handleUpdateCustomer, handleDeleteCustomer, orders } = useStore();
```

Change `save()` (lines 49-57):
```ts
  function save() {
    if (!draft.name.trim()) return;
    if (editingId) {
      setCustomers((prev) => prev.map((c) => (c.id === editingId ? draft : c)));
    } else {
      setCustomers((prev) => [{ ...draft, id: newId("cust") }, ...prev]);
    }
    setModalOpen(false);
  }
```
to:
```ts
  async function save() {
    if (!draft.name.trim()) return;
    try {
      if (editingId) {
        await handleUpdateCustomer(editingId, {
          name: draft.name,
          phone: draft.phone,
          email: draft.email,
          notes: draft.notes,
        });
      } else {
        await handleCreateCustomer({
          id: newId("cust"),
          name: draft.name,
          phone: draft.phone,
          email: draft.email,
          notes: draft.notes,
        });
      }
    } catch (err) {
      console.error("Failed to save customer:", err);
    }
    setModalOpen(false);
  }
```

Change `remove()` (lines 59-61):
```ts
  function remove(id: string) {
    setCustomers((prev) => prev.filter((c) => c.id !== id));
  }
```
to:
```ts
  function remove(id: string) {
    handleDeleteCustomer(id);
  }
```

Note: `newId` is still imported (line 5) and used in `save()`. Keep it.

- [x] **Step 2: OrderModal.tsx**

Change line 9:
```ts
  const { products, customers, setCustomers, profile, apiCreateOrder } = useStore();
```
to:
```ts
  const { products, customers, handleCreateCustomer, profile, apiCreateOrder } = useStore();
```

Change lines 112-115:
```ts
      // Only add customer if the order succeeds
      if (newCustomer) {
        setCustomers((prev) => [newCustomer, ...prev]);
      }
```
to:
```ts
      // Only add customer if the order succeeds
      if (newCustomer) {
        await handleCreateCustomer({
          id: newCustomer.id,
          name: newCustomer.name,
          phone: newCustomer.phone,
          email: newCustomer.email,
          notes: newCustomer.notes,
        });
      }
```

Check the enclosing function is `async` (it must be — it already `await`s `apiCreateOrder` at line 100). Verify the `try` block wraps this. It does (lines 95-124). Note: after `await handleCreateCustomer`, the `customers` list in context refreshes; the local `customers` prop won't update synchronously, but the next render after the context refresh will include it. No further change needed.

- [x] **Step 3: LabelDesigner.tsx**

Change line 41:
```ts
  const { labelTemplates, setLabelTemplates, products, profile } = useStore();
```
to:
```ts
  const { labelTemplates, handleCreateLabel, handleUpdateLabel, handleDeleteLabel, products, profile } = useStore();
```

Change `saveTemplate()` (lines 68-77):
```ts
  function saveTemplate() {
    const exists = labelTemplates.find((t) => t.id === label.id);
    if (exists) {
      setLabelTemplates((prev) => prev.map((t) => (t.id === label.id ? label : t)));
    } else {
      const saved = { ...label, id: newId("label") };
      setLabelTemplates((prev) => [saved, ...prev]);
      setLabel(saved);
    }
  }
```
to:
```ts
  async function saveTemplate() {
    const exists = labelTemplates.find((t) => t.id === label.id);
    if (exists) {
      await handleUpdateLabel(label.id, label);
    } else {
      const saved = { ...label, id: newId("label") };
      await handleCreateLabel(saved);
      setLabel(saved);
    }
  }
```

Change `newTemplate()` (lines 79-87):
```ts
  function newTemplate() {
    const fresh: LabelTemplate = {
      ...label,
      id: newId("label"),
      name: "Untitled Label",
    };
    setLabelTemplates((prev) => [fresh, ...prev]);
    setLabel(fresh);
  }
```
to:
```ts
  async function newTemplate() {
    const fresh: LabelTemplate = {
      ...label,
      id: newId("label"),
      name: "Untitled Label",
    };
    await handleCreateLabel(fresh);
    setLabel(fresh);
  }
```

Change `removeTemplate()` (lines 89-94):
```ts
  function removeTemplate(id: string) {
    setLabelTemplates((prev) => prev.filter((t) => t.id !== id));
    if (label.id === id && labelTemplates.length > 1) {
      setLabel(labelTemplates.find((t) => t.id !== id)!);
    }
  }
```
to:
```ts
  function removeTemplate(id: string) {
    handleDeleteLabel(id);
    if (label.id === id && labelTemplates.length > 1) {
      setLabel(labelTemplates.find((t) => t.id !== id)!);
    }
  }
```

Note: `saveTemplate`/`newTemplate` are referenced by `onClick={saveTemplate}` / `onClick={newTemplate}` — these become async but the click handlers don't await, which is fine. The `+ Duplicate as new` button calls `newTemplate` (line 586). Good.

- [x] **Step 4: Settings.tsx**

Change line 16:
```ts
  const { profile, setProfile, resetAllData } = useStore();
```
to:
```ts
  const { profile, handleUpdateProfile, resetAllData } = useStore();
```

Change lines 17-24:
```ts
  const [draft, setDraft] = useState(profile);
```
to:
```ts
  const [draft, setDraft] = useState<BusinessProfile | null>(profile);
```
(keeps `draft` nullable to match the new `profile` type).

Change `save()` (lines 20-24):
```ts
  function save() {
    setProfile(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }
```
to:
```ts
  async function save() {
    if (!draft) return;
    try {
      await handleUpdateProfile(draft);
    } catch (err) {
      console.error("Failed to save profile:", err);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }
```

Change the Data management copy + reset button (lines 67-77):
```tsx
          <p className="mb-3 text-xs text-hibiscus">
            All information is stored locally in this browser. Resetting will restore the original demo data.
          </p>
          <button
            onClick={() => {
              if (confirm("Reset all data to the original demo content? This cannot be undone.")) resetAllData();
            }}
            className="rounded-xl border border-hibiscus bg-white px-4 py-2 text-xs font-medium text-hibiscus hover:bg-hibiscus-light/10"
          >
            Reset to demo data
          </button>
```
to:
```tsx
          <p className="mb-3 text-xs text-hibiscus">
            All information is stored on the server and shared across your devices. Resetting will restore the original demo data.
          </p>
          <button
            onClick={async () => {
              if (confirm("Reset all data to the original demo content? This cannot be undone.")) await resetAllData();
            }}
            className="rounded-xl border border-hibiscus bg-white px-4 py-2 text-xs font-medium text-hibiscus hover:bg-hibiscus-light/10"
          >
            Reset to demo data
          </button>
```

Note: `draft.name` etc. are now possibly null — `Settings.tsx` inputs use `value={draft.name}` which is fine for controlled inputs (null renders as empty). If a null-safety lint/TS check complains, the `value={draft?.name ?? ""}` form is acceptable, but `useState<BusinessProfile | null>(profile)` plus `value={draft.name}` will surface as "Object is possibly null" on `draft.name`. To avoid that, change the `value` bindings from `value={draft.xxx}` to `value={draft?.xxx ?? ""}` for every `draft.` field in the file (lines 37-54, 85-127). Use `draft?.name ?? ""`, `draft?.tagline ?? ""`, `draft?.address ?? ""`, `draft?.phone ?? ""`, `draft?.email ?? ""`, `draft?.registrationNumber ?? ""`, `draft?.cashtag ?? ""`, `draft?.venmoHandle ?? ""`, `draft?.acceptedMethods?.[m] ?? false`, `draft?.stripeConnected ?? false`, `draft?.applePayEnabled ?? false`.

- [x] **Step 5: Orders.tsx**

Change line 56:
```ts
    recordPayment(updated);
```
to:
```ts
    await recordPayment(updated);
```
(`confirmPayment` is already `async`? No — it's `function confirmPayment()` at line 52. Make it `async function confirmPayment()` so `await` is valid.)

Change line 52:
```ts
  function confirmPayment() {
```
to:
```ts
  async function confirmPayment() {
```

- [x] **Step 6: Typecheck**

Run: `cd /Users/garciafam/Documents/website/Muy-Rico-V2/home-bakery-management-system && npx tsc --noEmit`
Expected: PASS (no type errors).

- [x] **Step 7: Commit**

```bash
git add home-bakery-management-system/src/pages/Customers.tsx home-bakery-management-system/src/components/OrderModal.tsx home-bakery-management-system/src/pages/LabelDesigner.tsx home-bakery-management-system/src/pages/Settings.tsx home-bakery-management-system/src/pages/Orders.tsx
git commit -m "refactor(pages): route customer/payment/label/profile mutations through API"
```

---

### Task 7: Delete `useLocalStorage` + loading flag UI

**Files:**
- Delete: `home-bakery-management-system/src/hooks/useLocalStorage.ts`
- Modify: `home-bakery-management-system/src/pages/Dashboard.tsx` (add loading guard)

**Interfaces:**
- Consumes: `loading` from `useStore`.

- [x] **Step 1: Delete the hook file**

Run:
```bash
cd /Users/garciafam/Documents/website/Muy-Rico-V2 && rm home-bakery-management-system/src/hooks/useLocalStorage.ts
```

- [x] **Step 2: Add loading guard to Dashboard**

Open `home-bakery-management-system/src/pages/Dashboard.tsx`. Add `loading` to the `useStore()` destructure (find the `const { ... } = useStore();` line at the top of the `Dashboard` component) and add a guard before the main return:

```tsx
  const { loading, ...rest } = useStore();
  // (keep existing destructure names in `rest` or add `loading` alongside them)
```

Simplest: add `loading` to the existing destructure, then wrap the top of the `return (...)`:

```tsx
  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="animate-spin h-8 w-8 rounded-full border-2 border-palm border-t-transparent" />
      </div>
    );
  }
```

Insert this `if (loading)` block as the first statement inside the component body after the hooks, before the existing `return`. Match the file's existing class names (`palm`, `cocoa`) which are already used throughout.

- [x] **Step 3: Typecheck + build**

Run: `cd /Users/garciafam/Documents/website/Muy-Rico-V2/home-bakery-management-system && npx tsc --noEmit && npm run build`
Expected: typecheck PASS, `vite build` succeeds, `postbuild.sh` regenerates `admin/index.html`.

- [x] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete useLocalStorage hook, add dashboard loading guard"
```

---

### Task 8: Deploy + verify

**Files:**
- None (build/deploy/verify only)

- [x] **Step 1: Apply migration to remote D1**

Run: `cd /Users/garciafam/Documents/website/Muy-Rico-V2/orders && npx wrangler d1 execute muy-rico-orders --remote --file=migrations/0006_server_storage.sql`
Expected: migration applied to remote DB.

- [x] **Step 2: Deploy Worker**

Run: `cd /Users/garciafam/Documents/website/Muy-Rico-V2/orders && npx wrangler deploy`
Expected: Worker deployed; new endpoints live.

- [x] **Step 3: Publish dashboard**

Copy the freshly built `admin/index.html` to your Pages project (or whatever deploy step you use for `admin/`). Confirm `home-bakery-management-system/dist/` was rebuilt in Task 7.

- [ ] **Step 4: Two-browser persistence test (manual — see note)**

1. Browser A: log in, open Settings, change the business address, click Save.
2. Browser B: log in (different browser/session), open Settings. The changed address must appear.
This confirms the bug is fixed.

- [ ] **Step 5: Reset test (manual — see note)**

In Settings, click "Reset to demo data", confirm. The four collections revert to demo content and `loading` flashes false→true→false.
