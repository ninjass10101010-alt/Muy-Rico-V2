# Customer Match & Merge Design

## Problem

1. The same human can become multiple `customers` rows because there is no uniqueness constraint and no create-time match check. This is how "Samantha Wleringa" and "Samantha" ended up as two separate records.
2. Website-sourced orders never set `orders.customer_id` (the public form at `order.html:2126` sends no `customer_id`), so a customer's dashboard stats silently ignore everything they ever ordered through the public site.
3. `updateOrder` (`api.js:500`) deliberately omits `customer_id` from its allowlist, so even a known-mis-linked order can't currently be re-attached from the dashboard.
4. The public `POST /api/orders` accepts a client-provided `customer_id` (`api.js:329`). A public caller can attach an order to an arbitrary customer id — not a data-read leak, but a stat-pollution risk, and the merge feature makes it slightly more interesting.

## Design

### 1. Architecture & data model

**Migration 0035** adds columns to `customers` and creates the audit ledger:

```sql
-- Add columns to customers
ALTER TABLE customers ADD COLUMN merged_into_id TEXT;
ALTER TABLE customers ADD COLUMN email_normalized TEXT;
ALTER TABLE customers ADD COLUMN phone_normalized TEXT;

CREATE INDEX idx_customers_email_norm ON customers(email_normalized);
CREATE INDEX idx_customers_phone_norm ON customers(phone_normalized);

-- Audit ledger (append-only)
CREATE TABLE IF NOT EXISTS customer_merges (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  surviving_id      TEXT NOT NULL,
  merged_id         TEXT NOT NULL,
  matched_by        TEXT NOT NULL,       -- 'email_exact' | 'phone_exact' | 'admin_manual'
  matched_fields_json TEXT,
  merged_by         TEXT NOT NULL,       -- admin actor email
  merged_at         TEXT NOT NULL DEFAULT (datetime('now')),
  reversed_by       TEXT,
  reversed_at       TEXT
);
CREATE INDEX idx_merges_surviving ON customer_merges(surviving_id);
CREATE INDEX idx_merges_merged    ON customer_merges(merged_id);
```

One-off backfill (runs in migration, not in application code):

```sql
UPDATE customers SET
  email_normalized = LOWER(TRIM(email)),
  phone_normalized = REGEXP_REPLACE(phone, '[^0-9]', '', 'g')
WHERE active = 1;
```

**Migration 0036** (deferred until existing dupes are merged via the admin UI) adds the hard DB-level backstop:

```sql
CREATE UNIQUE INDEX idx_customers_email_unique
  ON customers(email_normalized)
  WHERE active = 1 AND merged_into_id IS NULL AND email_normalized IS NOT NULL;
```

### 2. Matching & detection logic

New file `orders/workers/customer-match.js` — no third-party dependencies, < 80 LOC.

**Normalizers:**

- `normalizeEmail(s)` — lowercase, trim, strip surrounding spaces/punctuation. `null`/empty → `null`.
- `normalizePhone(s)` — digits only, strip leading country code `1` if 11 digits (US-centric). `null`/empty → `null`.
- `normalizeName(s)` — lowercase, trim, collapse whitespace, strip diacritics.
- `nameSimilarity(a, b)` — token-based Jaccard on the normalized name. Threshold for "name likely same person" = **0.5**.

**Three matching rules, applied in order:**

| Rule | Condition | Confidence |
|------|-----------|------------|
| 1 | Exact `email_normalized` match (both non-null) | High — definite duplicate |
| 2 | Exact `phone_normalized` match + name Jaccard ≥ 0.5 (both non-null) | Medium — likely duplicate |
| 3 | Exact normalized name with no email and no phone on either record | Low — possible duplicate |

**How rules attach to the two flows:**

**(a) `createOrder` website backfill** (`api.js:329`): when `customer_id` is null and `source === 'website'` and email is present:

1. Look up `customers` by `email_normalized = normalizeEmail(body.email)` where `active = 1`.
2. If found → use that customer's id as `orders.customer_id`.
3. If not found → create a `cust_web_<rand>` customer row from the order's name/email/phone and use it.
4. If email is missing → log `customer_match_skipped` event with reason `no_email`, leave `customer_id = null`.

**(b) `createCustomer` real-time check** (`api.js:1735`): before insert:

1. Compute `email_normalized` and `phone_normalized` from the body.
2. If `email_normalized` matches an existing active customer → return `{ ok: false, duplicate: true, existingId, existingName, matchedBy: 'email_exact' }`.
3. If no email match but phone matches AND name Jaccard ≥ 0.5 → return same shape with `matchedBy: 'phone+name'`.
4. Admin can override with `force: true` → insert succeeds + log `customer_created_despite_match`.
5. No match → insert normally.

**Hardening**: in `createOrder`, ignore client-provided `customer_id` when `source === 'website'` (one added server-side validation line). Honored only for `source === 'in-person'`.

**Suspected-dupe new orders** link to the **older** customer (post-merge-correct by default).

### 3. Merge operation & endpoints

**`POST /api/customers/merge`** (admin-only, behind Cloudflare Access):

Body: `{ survivingId, mergedId }`. Atomic `env.DB.batch()` transaction:

1. Validate both rows exist, `active = 1`, `merged_into_id IS NULL`, `survivingId !== mergedId`.
2. Compute `matchedBy` by re-running rules 1–3 in code → store in `matched_fields_json`. If admin is initiating manually, `matchedBy = 'admin_manual'`.
3. Re-point orders:
   ```sql
   UPDATE orders SET customer_id = ? WHERE customer_id = ?
   ```
   (survivingId, mergedId).
4. Leave `payments.customer_name` and `receipts.customer_name` historical snapshots untouched. Admin UI overlays the surviving name via the join.
5. Mark merged customer:
   ```sql
   UPDATE customers SET active = 0, merged_into_id = ?, updated_at = datetime('now') WHERE id = ?
   ```
6. Append audit row to `customer_merges`.
7. Append `order_events` rows `customer:relinked` for each affected order.

Returns `{ ok: true, survivingId, relinkedOrderCount }`.

Note on D1 batch: the merge transaction uses `env.DB.batch()` which supports multiple statements in one atomic call. The batch contains at most ~5 fixed statements (validate, re-point orders, mark merged, insert audit, log events) plus N `order_events` inserts for each re-linked order. For typical bakery-scale merges (tens of orders per customer), this is well within D1 batch limits. If a customer has hundreds of orders, split the `order_events` inserts into a separate `ctx.waitUntil()` call and keep the core merge atomic.

**`POST /api/customers/merge/:mergeId/reverse`** (admin-only):

Restores the merged customer (`active = 1, merged_into_id = NULL`) and marks the ledger row with `reversed_by` / `reversed_at`. Append-only — no row deletion. Does **not** move orders back; admin re-merges in the correct direction if needed.

**`GET /api/customers/duplicates`** (admin-only):

Computes suspected pairs in-memory at request time (no stale-flag table). Returns `[{ survivingCandidate, mergedCandidate, matchedBy, confidence }]` sorted by confidence. Customer table is small; O(n²) in-memory pass is fine.

**`PATCH /api/orders/:id` `updateOrder`**: add `customer_id` to the `allowed` allowlist (`api.js:500`) so orphan orders can be retroactively re-linked from the dashboard.

### 4. Admin dashboard UI

**`Customers.tsx`** additions:

- On mount: fetch `GET /api/customers/duplicates`, store in `duplicates` state.
- Per-card gold "Possible duplicate" pill (`bg-amber-50 text-amber-700`) with "Review" link opening the MergeModal preloaded with the pair.
- Top-of-page "N possible duplicate customers to review →" banner when `duplicates.length > 0`.
- Existing stats logic, order-history modal, Add/Edit/Delete row: untouched. Website orders will start appearing in stats automatically once the backend backfill lands.

**New `MergeModal.tsx`:**

Side-by-side comparison showing, for each customer:
- Name (full), phone (full), email (full), notes
- Order count + total spent (from existing `stats` logic)

Plus:
- "Surviving record: Left / Right" radio (defaults to older `created_at`).
- Match-reason chip ("Email match", "Phone + name match", "Admin manual").
- "Approve merge" button → calls `apiMergeCustomers`, refreshes customers/orders/duplicates, removes merged card from list.
- "Dismiss" button → removes the pair from in-memory `duplicates` array for the session only. No persisted dismissals table. Reappears on next page load if still matched.

**`OrderModal.tsx`** (lines 127–139):

Add an Email input to the "New customer" mode (currently `email: ""` hardcoded at line 132). Unlocks Rule 1 for in-person orders.

**`Customers.tsx` save handler:**

Detect `{ ok: false, duplicate: true }` response and show *"{existingName} already uses this email — use existing?"* with "Use existing" / "Create anyway (`force: true`)" buttons.

**`StoreContext.tsx`** additions:

- `duplicates` state, `refreshDuplicates()` action.
- `handleMergeCustomers(survivingId, mergedId)` → calls endpoint, refetches customers + orders + duplicates.
- `handleRelinkOrder(orderId, customerId)` → calls `PATCH /api/orders/:id` with `{ customer_id: customerId }`, refetches orders.

**`api.ts`** new typed wrappers: `apiMergeCustomers`, `apiGetDuplicateCustomers`, `apiReverseMerge`, `apiRelinkOrder`.

**Manual re-link UI**: On the Orders page (existing order detail/edit modal), add a "Customer" row showing the current `customerName` with a "Change" link. Clicking opens a small search dropdown (filtering `customers` by name, same as OrderModal's existing-customer select). Selecting a customer and confirming calls `handleRelinkOrder`. This handles orphan orders that the backfill missed (e.g. orders created before migration 0035 with no email).

### 5. Privacy on the public website

Today no leak risk exists. The duplicate detection, backfill, and merge are all server-side. Guardrails introduced by this design:

1. Website backfill is silent and returns nothing new to the public caller — `createOrder` response stays `{ ok, id }`.
2. `GET /api/customers/duplicates` and `POST /api/customers/merge` are admin-only. **No public `/api/customers/lookup` or `/api/customers/by-email` endpoint is added.**
3. `createOrder` ignores client-provided `customer_id` for `source === 'website'` — blocks the pre-existing stat-pollution vector.
4. Order lookup stays keyed by order id, never customer identity.

### 6. Testing & rollout

No formal test harness in repo; verify via `wrangler dev` + remote dev D1 + curl smoke tests.

**Verification matrix (8 scenarios):**

1. Migration sanity — confirm new columns + `customer_merges` table exist via `PRAGMA table_info`.
2. Backfill — spot-check 5 rows for correct `email_normalized`/`phone_normalized`.
3. `createOrder` website backfill — (a) email matches existing → linked; (b) email new → customer created + linked; (c) no email + spoofed customer_id → null + order creates; (d) in-person with customer_id → honored (regression).
4. `createCustomer` real-time block — (a) email match → blocked with `duplicate: true`; (b) `force: true` → inserted.
5. Duplicates endpoint — seed "Samantha" pair, verify pair returned with correct `matchedBy`.
6. Merge endpoint — verify atomic re-point, ledger row, `order_events`, merged customer state.
7. Reverse merge — verify restored customer, ledger reversal, orders NOT moved back.
8. Admin UI smoke — badge visible, MergeModal side-by-side correct, dismiss in-memory, OrderModal email field, duplicate-blocked prompt on save, manual re-link control on Orders page.

**Rollout sequence:**

1. Deploy migration 0035 (columns + ledger; no unique constraint).
2. Deploy Worker code (createOrder hardening + backfill + createCustomer check + merge/duplicates/reverse endpoints + updateOrder customer_id allowlist).
3. Deploy admin UI (Customers badges + MergeModal + OrderModal email field + save-handler duplicate prompt + StoreContext additions + api.ts wrappers + manual re-link control on Orders page).
4. Use admin UI to merge existing duplicates until `/api/customers/duplicates` returns empty.
5. Apply migration 0036 (partial unique index on `email_normalized`). DB enforces uniqueness as hard backstop from here on.
