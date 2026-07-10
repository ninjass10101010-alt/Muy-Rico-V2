# Dashboard server-side persistence — design

**Date:** 2026-07-10
**Author:** opencode brainstorming session
**Status:** Approved (transitions to writing-plans)
**Scope:** `orders/` worker, `home-bakery-management-system/src/` dashboard

---

## 1. Problem

Logging in from a second browser shows a dashboard missing customer, payment,
label-design, and business-profile data entered from the first browser. The
dashboard's `orders`, `products`, and `inventory` collections already persist
to Cloudflare D1 via the `orders/workers/api.js` Worker and survive cross-browser
— those are unaffected. Four other collections are still stored only in browser
`localStorage` via the `useLocalStorage` hook in `src/hooks/useLocalStorage.ts`:

| localStorage key       | TS interface        | Source line                            |
|------------------------|---------------------|----------------------------------------|
| `muyrico_customers`    | `Customer`          | `src/context/StoreContext.tsx:62`      |
| `muyrico_payments`     | `Payment`           | `src/context/StoreContext.tsx:64`      |
| `muyrico_labels`       | `LabelTemplate[]`   | `src/context/StoreContext.tsx:65`      |
| `muyrico_profile`      | `BusinessProfile`   | `src/context/StoreContext.tsx:69`      |

`StoreContext` currently has two storage strategies in the same file: server-backed
`useState + apiFetch + refresh*` for orders/products/inventory, and `useLocalStorage`
for the four collections above. This design finishes the migration by moving the
remaining four collections to the same Cloudflare D1 database that already hosts
orders/products/inventory.

## 2. Goals

- All dashboard data persists server-side in D1, so it is identical across browsers
  and devices.
- Existing dashboard UX (create/edit/delete flows, "Reset all data" button) is preserved
  — the four collections behave the same as products/inventory do today.
- Existing patterns in the Worker (`PRODUCT_FIELDS` allowlist, soft-delete via `active`,
  `parseFlavors` JSON helpers, `cf-access-authenticated-user-email` admin gate) are reused.
- No new infrastructure bindings. D1 is the only persistence layer.
- Existing read-only pages (`Dashboard.tsx`, `Orders.tsx`, `Payments.tsx`, `Inventory.tsx`,
  `LabelDesigner.tsx`, `PublicOrder.tsx`) do not change.
- `localStorage` is no longer a source of truth for any dashboard data — `useLocalStorage`
  is deleted.

## 3. Non-goals

- No new public endpoints. All four new collections are admin-only (and naturally fall
  under the existing Cloudflare Access check at `orders/workers/api.js:64-68`).
- No KV migration, no Durable Objects, no separate "cloudbase" product — these would
  reintroduce eventual-consistency surprises or split the data model.
- No migration of existing browser-local rows to D1. Users have very little real data in
  localStorage (recent build, single shop, two users). On first deploy they re-enter it
  or click "Reset to demo content" to seed D1 from the migration's `INSERT OR IGNORE`
  block. The seed inserts in the migration make the dashboard visibly unchanged after
  deploy.
- No password/auth refactor.

## 4. Architecture

Same architecture as products/inventory: D1 table → Worker endpoint → `src/utils/api.ts`
client function → `StoreContext` refresher + handler wrappers → page caller refactors.

```
D1  ──▶  orders/workers/api.js  ──▶  src/utils/api.ts  ──▶  StoreContext.tsx  ──▶  pages
                          (existing)                  (existing)            (existing)
```

The only new piece is four more tables in the same D1 database (`muy-rico-orders`,
id `ca6cb20b-8884-4cb2-a51e-aff8f7be8502` from `orders/wrangler.toml:8`) and four
more route groups in the same Worker.

## 5. D1 schema

New file: `orders/migrations/0006_server_storage.sql`. Follows the conventions of
`migrations/0004_inventory.sql` — `id TEXT PRIMARY KEY`, `active INTEGER NOT NULL DEFAULT 1`,
`created_at` default `datetime('now')`, `updated_at TEXT` (set on PATCH), `INSERT OR IGNORE`
seed rows.

### 5.1 `customers`

```sql
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
```

Soft-deletes (via `active = 0`) — preserves audit trail and avoids dangling order
references if a customer has historical orders. The `Customer` TS type (`src/types.ts:69-76`)
gets an `active?: boolean` field added.

### 5.2 `payments`

```sql
CREATE TABLE IF NOT EXISTS payments (
  id            TEXT PRIMARY KEY,
  order_id      INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  order_number  TEXT,
  customer_name TEXT,
  amount        REAL NOT NULL DEFAULT 0,    -- decimal dollars; matches TS `Payment.amount`
  method        TEXT NOT NULL,              -- one of ALLOWED_PAYMENT (server validates)
  date          TEXT NOT NULL DEFAULT (datetime('now')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  active        INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_payments_order   ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_active  ON payments(active);
```

Why `amount` in dollars (not cents, like `orders.total_cents`): the existing `Payment`
TS interface (`src/types.ts:106-114`) already stores `amount` in decimal dollars and
the dashboard displays it directly. Storing dollars here means zero conversion between
API and dashboard. It's a separate concern from `orders.total_cents`, which stores cents
intentionally to avoid float math on order totals.

`order_id` is nullable (`ON DELETE SET NULL`) so ad-hoc payments (no associated order)
work, and cancelling an order does not erase payment history.

There is no `PATCH /api/payments/:id` endpoint — `recordPayment` today only ever creates
new rows. Deletions go through `DELETE /api/payments/:id` for soft-delete.

### 5.3 `label_templates`

```sql
CREATE TABLE IF NOT EXISTS label_templates (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  shape            TEXT,                      -- 'rounded' | 'circle' | 'square' | 'oval'
  bg_color         TEXT,
  accent_color     TEXT,
  text_color       TEXT,
  business_name    TEXT,
  product_name     TEXT,
  details          TEXT,
  ingredients       TEXT,
  allergens        TEXT,
  net_weight       TEXT,
  price            TEXT,                       -- TEXT: a label can show "$4.00" or "Ask"
  show_price       INTEGER,                    -- 0/1
  show_best_by     INTEGER,                    -- 0/1
  best_by_days     INTEGER,
  logo_emoji       TEXT,
  logo_image       TEXT,                       -- R2 URL (data URLs uploaded to R2 on save)
  font             TEXT,
  business_id_mode TEXT,                       -- 'address' | 'registration'
  address          TEXT,
  phone_number     TEXT,
  registration_number TEXT,
  show_disclaimer  INTEGER,                    -- 0/1
  label_width      REAL,
  label_height     REAL,
  display_order    INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT,
  active           INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_labels_active  ON label_templates(active);
CREATE INDEX IF NOT EXISTS idx_labels_display ON label_templates(display_order);
```

One row = one saved `LabelTemplate`. Soft-delete preserves the design history.
`logo_image` stores an R2 URL; if the client posts a data URL the Worker uploads it to
the existing `IMAGES_BUCKET` (same handler used by `POST /api/upload`, lines 374-397) and
stores the returned URL.

### 5.4 `business_profile`

```sql
CREATE TABLE IF NOT EXISTS business_profile (
  id                  TEXT PRIMARY KEY DEFAULT 'singleton',
  name                TEXT,
  tagline             TEXT,
  address             TEXT,
  phone               TEXT,
  email               TEXT,
  registration_number TEXT,
  accepted_methods    TEXT,                     -- JSON: Record<PaymentMethod, boolean>
  cashtag             TEXT,
  venmo_handle        TEXT,
  apple_pay_enabled   INTEGER,                   -- 0/1
  stripe_connected    INTEGER,                  -- 0/1
  updated_at          TEXT
);
```

A single row, forced to `id = 'singleton'`. `GET /api/profile` returns the row (or the
seed profile if the row does not exist — offline-first fallback matching
`getProfile`'s pattern in `api.ts`). `PUT /api/profile` upserts via
`INSERT ... ON CONFLICT(id) DO UPDATE`. No `DELETE` — there is always exactly one profile.

### 5.5 Seeds

The migration ends with `INSERT OR IGNORE` blocks seeding all four tables from the
current values in `src/data/seedData.ts` (`seedCustomers`, `seedPayments`,
`seedLabelTemplates`, `seedProfile`). `seedData.ts` itself stays as the client-side
fallback for when the API is unreachable. Like the existing inventory migration
(`migrations/0004_inventory.sql:37-64`), keeping the SQL seeds and TS seeds in lock-step
is by convention.

### 5.6 A `POST /api/seed/reset` endpoint

The Settings page's "Reset all data" button (`src/pages/Settings.tsx:72`) needs a
server-side equivalent. `POST /api/seed/reset` re-runs the four `INSERT OR IGNORE`
blocks (so it only restores rows that were deleted; it does not overwrite existing
data) and returns `{ ok: true }`. The client then calls `refreshAll()` which re-fetches
the four collections.

## 6. Worker endpoints (`orders/workers/api.js`)

All four new route groups land inside the existing `try` block (lines 76-110),
protected by the same Cloudflare Access check. None go in the public allowlist at
lines 64-68 — they are admin-only.

```
GET    /api/customers          → listCustomers
POST   /api/customers          → createCustomer
GET    /api/customers/:id      → getCustomer
PATCH  /api/customers/:id      → updateCustomer
DELETE /api/customers/:id      → deleteCustomer     (soft delete)

GET    /api/payments           → listPayments
POST   /api/payments           → createPayment
DELETE /api/payments/:id      → deletePayment       (soft delete)

GET    /api/labels             → listLabelTemplates
POST   /api/labels             → createLabelTemplate
PATCH  /api/labels/:id         → updateLabelTemplate (R2 upload if logoImage is data URL)
DELETE /api/labels/:id         → deleteLabelTemplate (soft delete)

GET    /api/profile            → getProfile
PUT    /api/profile            → updateProfile        (upsert)

POST   /api/seed/reset         → resetSeed           (re-runs INSERT OR IGNORE)
```

A `CUSTOMER_FIELDS` allowlist mirrors `PRODUCT_FIELDS` (lines 448-453) — only listed
columns can be PATCHed. Same for `PAYMENT_FIELDS` and `LABEL_FIELDS`. `createPayment`
validates `method` against `ALLOWED_PAYMENT` (line 32) — same validation as orders
(line 155-157). `createCustomer` and `createLabelTemplate` validate that `id` exists and
is a short string — same as `createProduct` (lines 460-462).

List endpoints return `active = 1` rows ordered in the same order their client pages
render today (`customers` by `created_at DESC`, `payments` by `date DESC`, `labels` by
`display_order ASC, name ASC`).

## 7. API client (`src/utils/api.ts`)

Add typed functions mirroring the existing products/inventory blocks. No type
conversions — `amount` stays decimal dollars, `active` stays integer-from-DB-boolean-to-
TS-boolean at the boundary (same `Boolean(r.active)` coercion already used by
`listProducts`, line 426).

```ts
// customers
export interface ApiCustomer {
  id: string; name: string; phone: string | null; email: string | null;
  notes: string | null; created_at: string; updated_at: string | null; active: boolean;
}
export interface CustomerCreate { id: string; name: string; phone?: string; email?: string; notes?: string; }
export type CustomerUpdate = Partial<CustomerCreate>;
export async function fetchCustomers(): Promise<ApiCustomer[]>;
export async function createCustomer(c: CustomerCreate): Promise<{ ok: boolean; id: string }>;
export async function updateCustomer(id: string, patch: CustomerUpdate): Promise<{ ok: boolean }>;
export async function deleteCustomer(id: string): Promise<{ ok: boolean }>;

// payments
export interface ApiPayment {
  id: string; order_id: number | null; order_number: string | null;
  customer_name: string; amount: number; method: PaymentMethod;
  date: string; created_at: string; active: boolean;
}
export interface PaymentCreate {
  id: string; order_id?: number | null; order_number?: string | null;
  customer_name: string; amount: number; method: PaymentMethod; date?: string;
}
export async function fetchPayments(): Promise<ApiPayment[]>;
export async function createPayment(p: PaymentCreate): Promise<{ ok: boolean; id: string }>;
export async function deletePayment(id: string): Promise<{ ok: boolean }>;

// label templates
export interface ApiLabelTemplate { /* scalar LabelTemplate fields + active + logo_image */ }
export interface LabelTemplateCreate { id: string; name: string; /* all LabelTemplate scalar fields */ }
export type LabelTemplateUpdate = Partial<LabelTemplateCreate>;
export async function fetchLabelTemplates(): Promise<ApiLabelTemplate[]>;
export async function createLabelTemplate(t: LabelTemplateCreate): Promise<{ ok: boolean; id: string }>;
export async function updateLabelTemplate(id: string, patch: LabelTemplateUpdate): Promise<{ ok: boolean }>;
export async function deleteLabelTemplate(id: string): Promise<{ ok: boolean }>;

// business profile (singleton)
export interface ApiBusinessProfile { /* all BusinessProfile fields + updated_at */ }
export async function fetchProfile(): Promise<ApiBusinessProfile>;
export async function updateProfile(p: BusinessProfile): Promise<{ ok: boolean }>;

// reset
export async function resetSeedData(): Promise<{ ok: boolean }>;
```

These are added below the existing inventory block (lines 226-254), keeping the file's
ordering (orders → products → inventory → customers → payments → labels → profile → reset).

## 8. TS types (`src/types.ts`)

- Add `active?: boolean` to `Customer` (interface at lines 69-76). Soft-delete surfaces
  on the type so the context helper can filter `active === true` if needed; pages only
  render server rows so they never see `active=false`.
- Add `active?: boolean` to `Payment` (lines 106-114) and `LabelTemplate`
  (lines 120-147) for symmetry — read-only from server; pages ignore it.

## 9. `StoreContext` rewrite (`src/context/StoreContext.tsx`)

Five concrete changes to the file.

### 9.1 Remove `useLocalStorage` wiring
- Remove the import at line 2.
- Replace the four `useLocalStorage(...)` calls (lines 62-69) with `useState`:
  - `const [customers, setCustomers] = useState<Customer[]>([]);`
  - `const [payments, setPayments] = useState<Payment[]>([]);`
  - `const [labelTemplates, setLabelTemplates] = useState<LabelTemplate[]>([]);`
  - `const [profile, setProfile] = useState<BusinessProfile | null>(null);`
- Initial state is empty / null — server is the source of truth.

### 9.2 Add refreshers
Mirror `refreshProducts` (lines 145-153) and `refreshInventory` (lines 185-197):

```ts
const refreshCustomers = useCallback(async () => {
  try {
    const rows = await fetchCustomers();
    setCustomers(rows.map(apiToCustomer));
  } catch (err) {
    console.warn("Failed to fetch customers from API, falling back to seeds:", err);
    setCustomers(seedCustomers);
  }
}, []);

const refreshPayments = useCallback(async () => {
  try {
    const rows = await fetchPayments();
    setPayments(rows.map(apiToPayment));
  } catch (err) {
    console.warn("Failed to fetch payments from API, falling back to seeds:", err);
    setPayments(seedPayments);
  }
}, []);

const refreshLabelTemplates = useCallback(async () => {
  try {
    const rows = await fetchLabelTemplates();
    setLabelTemplates(rows.map(apiToLabelTemplate));
  } catch (err) {
    console.warn("Failed to fetch label templates from API, falling back to seeds:", err);
    setLabelTemplates(seedLabelTemplates);
  }
}, []);

const refreshProfile = useCallback(async () => {
  try {
    const p = await fetchProfile();
    setProfile(apiToProfile(p));
  } catch (err) {
    console.warn("Failed to fetch profile from API, falling back to seed:", err);
    setProfile(seedProfile);
  }
}, []);
```

`apiToCustomer`, `apiToPayment`, `apiToLabelTemplate`, `apiToProfile` are private mappers
in the file (no field conversion; they just normalize nulls to fits TS interface, like
`apiToProduct` does at lines 110-143).

Add a `useEffect` per refresher (same shape as lines 104-106, 155-157, 195-197).

### 9.3 Loading flag

```ts
const [loading, setLoading] = useState(true);

useEffect(() => {
  let cancelled = false;
  (async () => {
    setLoading(true);
    await Promise.all([
      refreshOrders(),
      refreshProducts(),
      refreshInventory(),
      refreshCustomers(),
      refreshPayments(),
      refreshLabelTemplates(),
      refreshProfile(),
    ]);
    if (!cancelled) setLoading(false);
  })();
  return () => { cancelled = true; };
}, []);
```

`loading: boolean` is added to `StoreContextValue` (lines 25-55) and the `useMemo`
deps (line 326). When `loading === true`, the dashboard shows a spinner / "Loading…"
state instead of zeros (small conditional in `Dashboard.tsx` or `Topbar.tsx`).

### 9.4 Handler wrappers (mirror `handleApiCreateProduct` at lines 215-245)

Each handler writes through the API and then refreshes state, following the existing
pattern:

```ts
const handleCreateCustomer = useCallback(async (c: CustomerCreate) => {
  const result = await createCustomer(c);
  await refreshCustomers();
  return result;
}, [refreshCustomers]);

const handleUpdateCustomer = useCallback(async (id: string, patch: CustomerUpdate) => {
  await updateCustomer(id, patch);
  await refreshCustomers();
}, [refreshCustomers]);

const handleDeleteCustomer = useCallback(async (id: string) => {
  await deleteCustomer(id);
  await refreshCustomers();
}, [refreshCustomers]);

const recordPayment = useCallback(async (order: Order) => {
  if (!order.paymentMethod) return;
  await createPayment({
    id: newId("pay"),
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    amount: order.total,
    method: order.paymentMethod,
    date: new Date().toISOString(),
  });
  await refreshPayments();
}, [refreshPayments]);

const handleCreateLabel = useCallback(async (t: LabelTemplateCreate) => {
  const result = await createLabelTemplate(t);
  await refreshLabelTemplates();
  return result;
}, [refreshLabelTemplates]);

const handleUpdateLabel = useCallback(async (id: string, patch: LabelTemplateUpdate) => {
  await updateLabelTemplate(id, patch);
  await refreshLabelTemplates();
}, [refreshLabelTemplates]);

const handleDeleteLabel = useCallback(async (id: string) => {
  await deleteLabelTemplate(id);
  await refreshLabelTemplates();
}, [refreshLabelTemplates]);

const handleUpdateProfile = useCallback(async (draft: BusinessProfile) => {
  await updateProfile(draft);
  await refreshProfile();
}, [refreshProfile]);
```

`recordPayment` becomes `async` — callers in `Orders.tsx` await it.

### 9.5 `resetAllData` rewrite

```ts
const resetAllData = useCallback(async () => {
  await resetSeedData();
  await refreshAll();
}, [refreshAll]);
```

Where `refreshAll` is the same `Promise.all([...])` used by the loading effect.
The "Reset all data" button in `Settings.tsx:72` becomes `await resetAllData()`.

### 9.6 Context surface changes
Update `StoreContextValue` (lines 25-55):
- Add `loading: boolean`.
- Add `handleCreateCustomer`, `handleUpdateCustomer`, `handleDeleteCustomer`.
- Add `handleCreateLabel`, `handleUpdateLabel`, `handleDeleteLabel`.
- Add `handleUpdateProfile`.
- Keep `setCustomers`, `setPayments`, `setLabelTemplates`, `setProfile` only if
  any page uses them directly; otherwise remove from the public surface to enforce
  using the handlers. (Grep at design time shows the only direct setters today are the
  page calls listed in §10, all of which get refactored — so the setters can be removed
  from the public surface.)

## 10. Page refactor (caller sites only)

Read-only page logic is unchanged. Only the callers of `setCustomers` / `setPayments` /
`setLabelTemplates` / `setProfile` get refactored to use the new handlers.

| File | Lines | Change |
|------|-------|--------|
| `src/pages/Customers.tsx` | 52, 54, 60 | `setCustomers(prev => ...)` → `await handleCreateCustomer()` / `handleUpdateCustomer()` / `handleDeleteCustomer()` |
| `src/components/OrderModal.tsx` | 114 | `setCustomers((prev) => [newCustomer, ...prev])` → `await handleCreateCustomer(newCustomer)` |
| `src/pages/LabelDesigner.tsx` | 71, 74, 85, 90 | `setLabelTemplates((prev) => ...)` → `handleUpdateLabel()` / `handleCreateLabel()` / duplicate-via-create / `handleDeleteLabel()` |
| `src/pages/Settings.tsx` | 21 | `setProfile(draft)` → `await handleUpdateProfile(draft)` |
| `src/pages/Settings.tsx` | 72 | `resetAllData()` → `await resetAllData()` |
| `src/pages/Orders.tsx` | 56 | `recordPayment(updated)` → `await recordPayment(updated)` (now async) |
| `src/pages/Dashboard.tsx` or `src/components/Topbar.tsx` | — | Gate on `loading === true` (spinner / placeholder) |

For the LabelDesigner "duplicate" path (line 85), the new flow is: clone the current
label, give it a fresh `newId("label")`, then `await handleCreateLabel(fresh)`.

## 11. `useLocalStorage` cleanup

- Delete `src/hooks/useLocalStorage.ts`.
- Remove the import line in `StoreContext.tsx` (covered in §9.1).

The only consumer of `useLocalStorage` is `StoreContext` (grep confirms: 6 matches
total, 5 in `StoreContext.tsx`, 1 in the hook file itself).

## 12. Build & deploy

### 12.1 Apply the migration (local + remote D1)
```bash
npx wrangler d1 execute muy-rico-orders --file=migrations/0006_server_storage.sql
npx wrangler d1 execute muy-rico-orders --remote --file=migrations/0006_server_storage.sql
```

### 12.2 Deploy the Worker
```bash
npx wrangler deploy
```
Run from `orders/`. Same Worker, four new route groups.

### 12.3 Build the dashboard
```bash
cd home-bakery-management-system
npm run build           # vite build → outputs dist/
bash postbuild.sh       # copies dist/ to ../admin/index.html
```

The single-file `admin/index.html` (the deployed dashboard UI) is regenerated.

## 13. Verification

Per the verification-before-completion skill.

1. **Typecheck the dashboard:**
   ```bash
   cd home-bakery-management-system
   npx tsc --noEmit
   ```
   No explicit `typecheck` script exists in `package.json:6-11` — use `tsc` directly.

2. **Production build:**
   ```bash
   npm run build
   ```
   Should succeed; if Vite errors, fix before claiming done.

3. **Local Worker smoke test:**
   ```bash
   cd orders && npx wrangler dev
   ```
   `curl localhost:8787/api/profile` should return the seeded profile. `curl -X POST
   localhost:8787/api/profile -d '{...}'` should upsert and a follow-up GET should
   return the new values.

4. **Two-browser persistence test (the bug this fixes):**
   - Browser A: log in, change business profile address, save. Verify `PUT /api/profile`
     returns `{ ok: true }`.
   - Browser B: log in, navigate to Settings. Address from Browser A should appear.

5. **Reset button test:** In `Settings`, click "Reset all data" → confirm. Verify the
   four collections reset to demo content and `loading` goes `true` briefly then
   `false`.

6. **Existing flows unaffected:** Orders/products/inventory create/update/delete behave
   exactly as before (their code paths are untouched).
