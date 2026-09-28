# Payment Ledger Correctness

**Date:** 2026-09-28
**Status:** Approved
**Predecessor:** Split out of `2026-09-28-sales-hub-design.md` §3. That spec assumed the payment ledger was trustworthy; it is not.
**Scope:** Bug fixes only. No new user-facing features.

---

## Problem

The `payments` table is the sole basis for every revenue figure in the dashboard, and the write path that records owner-taken payments destroys data. Three distinct defects, all confirmed by reading the source and by query against the local D1 store.

### 1. `createPayment` deactivates every prior payment, and commits that before the insert

`api.js:2717-2721` runs `UPDATE payments SET active = 0 WHERE order_id = ? AND active = 1` before inserting the new row.

**Defect A — partial payments are erased.** The stated intent (`api.js:2713-2716`) is de-duplicating full payments during a paid → unpaid → paid toggle. It applies unconditionally, so recording a balance destroys the deposit it was settling.

**Defect B — the deactivate is not in the transaction.** It is a separate committed statement, outside the `try`/`catch` that wraps the insert (`api.js:2723-2738`). If the insert throws on a duplicate primary key, `api.js:2737` returns 400 **after** every payment for the order has already been deactivated. The client swallows it (`StoreContext.tsx:698-700`, `OrderModal.tsx:191-193` both `console.warn`), so the UI looks normal and the order is left with zero active payments.

**Defect C — deactivated rows are permanently unreachable.** The only two read paths both filter `WHERE active = 1` (`api.js:2696`, `api.js:958`). `deletePayment` exists (`api.js:2742-2746`) but has no route — the route table (`api.js:345-346`) has only `GET` and `POST` on `/api/payments` — and the client wrapper (`api.ts:720-724`) is never called. **There is no way to un-deactivate a payment from the application.** Rows survive in D1 and are invisible everywhere.

### 2. The new-order deposit path never refreshes payments, so "Collect Balance" over-collects

`OrderModal.tsx:180-195` records the 10% deposit by calling `createPayment` **directly from `utils/api`**, bypassing the store, and never calls `refreshPayments()` afterwards. The resulting row exists in D1 but is absent from the client `payments` array until a reload.

`Orders.tsx:480-483` then computes the remaining balance from that stale array:

```ts
const totalPaid = payments.filter((p) => p.orderId === selected.id).reduce((s, p) => s + p.amount, 0);
const remaining = Math.max(0, selected.total - totalPaid);
```

`totalPaid` reads `$0`, so `remaining` is the **full order total**, and the click records the full total — then destroys the deposit. Confirmed in `orders/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/85810f21….sqlite`:

```
order_id  amount  method  active  created_at
52          1.3   cash    0       2026-08-03 10:31:36   ← 10% deposit, deactivated
52         13.0   cash    1       2026-08-03 10:33:01   ← 85s later: full total, not balance
```

`$14.30` of real cash collected; `$13.00` recorded. Order 50 shows the residual case: a `$6.00` deposit on a now-`unpaid` `$60` order, so `Dashboard.tsx:63-66` counts `$60` owed and credits the `$6` nowhere.

There is a **second, unlabelled route to the same destruction**: the row-level wallet icon opens `confirmPayment()` (`Orders.tsx:105-130`), which is gated only on `o.paymentStatus !== "paid"` (`Orders.tsx:270`) — so it is reachable from a `partial` order too, and because it does not override `total`, it writes the full order total.

### 3. `orders.payment_status` is never derived from the ledger

Four places write it as a client-supplied literal (`Orders.tsx:112`, `:484`, `:547`, `OrderModal.tsx:157`). Nothing recomputes it from what was actually collected, so it can disagree with the sum of active payments in either direction.

### 4. `cake_quotes.status` accepts any string

`api.js:3443-3446` binds `body.status` straight into the UPDATE. No allow-list, no column allow-list, no `CHECK` constraint on the column (`0024_cake_quotes.sql:2` is `status TEXT NOT NULL DEFAULT 'new'` with a plain comment; the schema contains zero `CHECK` constraints and zero triggers).

**Not currently triggerable through the dashboard** — the only two call sites send hardcoded literals (`Quotes.tsx:166` sends `"archived"`, `Quotes.tsx:692` echoes a previously-server-returned value). But the client types are `status?: string` (`api.ts:1090`, `StoreContext.tsx:77`), so any future status `<select>` passes through unchecked, and the field is one authenticated `PATCH` away.

The damage profile is **fail-open**: every consumer is an equality test against specific literals, so an unknown value does not error, it falls through to the permissive branch. The worst cases are the money paths — `api.js:4328`, `:4354`, `:4363` guard duplicates with `status NOT IN ('converted','archived')`, and `api.js:4650` blocks manual reconversion with `if (status === 'converted')`. An unrecognised status makes all four stop matching, turning a would-be-flagged duplicate payment into a silently created second order.

For contrast, `orders.status` **is** allow-listed (`ALLOWED_STATUS` at `api.js:53`, checked at `:588` and `:890`). `invoices.status` has no allow-list but is structurally safe: every write is a server-side literal (`api.js:3646`, `:3940`, `:4144`, `:4164`) and `updateInvoice`'s column allow-list (`api.js:3734-3738`) omits `status` entirely, so a `PATCH` with a bad status is ignored rather than stored.

### 5. `cake_quotes` deposit fields never leave the server

`QUOTE_FIELDS` selects `deposit_paid_cents`, `deposit_paid_at`, `deposit_method`, `deposit_ref` and `public_token` (`api.js:3140-3149`), but `rowToQuote` (`api.js:3161-3187`) — the serializer used by both `listQuotes` and `getQuote` — **does not map them**. Grep across the repository finds `deposit_paid_cents` referenced only in the migration, the `QUOTE_FIELDS` select, and three `UPDATE`s (`api.js:4330`, `:4343`, `:4352`). It is **write-only**.

Consequence: the dashboard cannot display a quote deposit, cannot filter by one, and the Quotes tab has no pay-link button. This also means a quote deposit that was taken but did not produce an order is invisible in the UI — see the follow-up spec.

### 6. `convertQuoteToOrder` is not atomic

`api.js:4596-4637` performs four separate `await`s: insert order, insert payment, insert `order_events`, update quote. None are in a `DB.batch` — unlike `convertInvoiceToOrder`, which batches all five statements at `api.js:3923-3954` precisely so the conversion is all-or-nothing. A crash between statements leaves an order created but the quote still `status = 'new'`, which is the exact partial state the crash-heal branch (`api.js:4310-4319`) exists to repair.

**Note on residual risk:** batching gives atomicity, not serialization. Two concurrent `POST /api/quotes/:id/convert` calls can still both insert, because there is no unique index on `cake_quotes.converted_order_id` (contrast `idx_orders_invoice_id`, `0048:8`, which is the invoice conversion's explicit serialization point at `api.js:3924`). Closing that requires a `quote_id` column and a unique index, which belongs with the double-charge work in the follow-up spec.

### Test coverage

**Zero.** No test in `orders/tests/` (13 files) or the SPA suite (19 files) references the `payments` table, `createPayment`, `listPayments`, `recordPayment`, or any `active` flag. `updateQuote` is never invoked by any test. The closest file, `orders/tests/mark-paid.test.js`, asserts only on `calls[].sql` strings matching `/UPDATE orders SET payment_status/` — it cannot detect whether a payment row was written or whether prior rows were deactivated, because its D1 stub returns `{results: []}` from `.all()` (`mark-paid.test.js:20,24`).

---

## Design

### Fix 1 — `createPayment`: batched, mode-aware, audited

New pure module `orders/workers/payment-ledger-lib.js`, following the existing `*-lib.js` convention:

```js
// Derive orders.payment_status from the ledger. Never trust a client-supplied status.
export function derivePaymentStatus(activePaymentsCents, totalCents) {
  if (activePaymentsCents <= 0) return 'unpaid';
  if (activePaymentsCents >= totalCents) return 'paid';
  return 'partial';
}

export function activePaymentsCents(paymentRows) {
  return paymentRows.reduce((sum, p) => sum + Math.round(Number(p.amount) * 100), 0);
}
```

`Math.round(amount * 100)` is required because `payments.amount` is `REAL` dollars (`0006_server_storage.sql:25`) while `orders.total_cents` is an integer — `$12.34` must equal `1234`, with no float drift. `markOrderPaid` already performs the same division at `api.js:1109`.

`api.js:2701-2740` is rewritten:

- `replace` body field, **defaulting to `true`** so every existing caller keeps its exact current meaning and `quote-deposit-lib.test.js` / `invoice-lib.test.js` stay green.
  - `true` — deactivate all active payments for the order, then insert. Used for full re-records and by the paid/unpaid toggle.
  - `false` — insert as a top-up; leave existing active payments active. Used for deposits and balance collection.
- Deactivate and insert go into **one `env.DB.batch`**, so a failed insert can no longer leave the order with zero payments.
- `method_details` is added to the INSERT. The column exists (`0021_payment_sub_method.sql:6`), `ApiPayment` reads it (`api.ts:692`), and `markOrderPaid` already writes it (`api.js:1111`) — only this path drops it. `PaymentCreate` (`api.ts:698-706`) gains the field.
- After the batch, re-read the order's active payments, call `derivePaymentStatus`, and `UPDATE orders SET payment_status = ?`. This runs **only** here, so it cannot disturb `markOrderPaid` (which forces `paid` and additionally flips `awaiting_payment` → `pending` at `api.js:1116-1122`) or the conversion paths (which write their own status at `api.js:3940` and `api.js:4518`).
- An `order_events` row is written on every insert and every deactivation. `actor` is already passed into the function and currently unused (`api.js:2701`). These render in the order detail modal at `Orders.tsx:630-641`.

**Ordering constraint:** the derived status must land *after* the batch, and the batch must not include the `orders` update — the status depends on the post-insert sum.

**Dead code removed in the same change.** `api.js:4620-4622` and `api.js:3936-3938` both deactivate payments for an order inserted seconds earlier in the same function, so they are always zero-row no-ops. They are removed.

### Fix 2 — `OrderModal` refreshes payments

One line after the `createPayment` call at `OrderModal.tsx:193`: call the store's `refreshPayments()`. `OrderModal` currently imports `createPayment` from `utils/api` directly (`OrderModal.tsx:6`) to avoid a circular import through the context — it must keep doing that, but it now also needs a refresh. Resolve by having `handleApiCreateOrder` (`StoreContext.tsx:582-586`) refresh payments alongside orders when the created order had a deposit collected; that keeps the store as the single place that owns `payments` state.

This alone stops the over-collection, because the deposit will be in the array before "Collect Balance" is reachable.

### Fix 3 — `recordPayment` signature, and both Orders.tsx flows retired

`StoreContext.tsx:685-701` changes from `(order: Order) => Promise<void>` to:

```ts
recordPayment(input: {
  orderId: number;
  amountCents: number;
  method: PaymentMethod;
  subMethod?: string | null;
  date?: string;
  replace?: boolean;
}): Promise<{ ok: boolean; paymentStatus: PaymentStatus; balanceCents: number }>
```

This deletes the object-forging hack at `Orders.tsx:485`, which passes `{ ...selected, total: remaining }` — a fake `Order` whose `total` is silently the balance — so that `recordPayment` records the right figure.

The three call sites (`Orders.tsx:112-113`, `:484-485`, `:547-548`) stop calling `apiUpdateOrder({ payment_status })` before recording. The derived status from Fix 1 is authoritative, which removes the double-write and the ordering hazard where the order is marked `paid` before the payment that justifies it is recorded.

`recordPayment` takes `amountCents` and divides once at the `createPayment` call, whose `amount` field is dollars (`api.ts:702`) to match the `REAL` column.

**Scope note:** the full `RecordPaymentModal` (amount entry, method radio, live balance readout, Record vs Settle-in-full) is a **feature** and belongs to the Sales Hub spec, where the "Unrecorded payments" queue card lives. This spec only re-points the existing two inline flows at the new signature, preserving their current single-method-select UI.

### Fix 4 — `DELETE /api/payments/:id` is routed, and becomes restore

Route `DELETE /api/payments/:id` to the already-written `deletePayment` (`api.js:2742-2746`), which already sets `active = 0`. It needs no `assertInvoiceEditable`-style guard — payments are owner-managed, not customer-facing.

This is the first time a payment can be **reactivated**, because nothing else in the application can un-deactivate one. Keep it a soft-delete: the row is never removed from D1.

`api.js:958-965` additionally rewrites `method` on the newest active payment **in place** with no audit event, triggered by the "Edit method" button (`Orders.tsx:427` → `Orders.tsx:768`). If a deposit was cash and the balance was card, "correcting" the method relabels the cash row. Add an `order_events` entry so the rewrite is at least auditable; leave the behaviour.

### Fix 5 — Deactivated payments become visible

`GET /api/payments` **keeps returning `active = 1` only.** This is deliberate: eleven frontend consumers (`Dashboard.tsx:45,50,46-51,63-66,91-101,105-120`, `Payments.tsx:22,26,28-31`, `Orders.tsx:449-452,480-483,584-596`) currently assume the array is already active-only, and none of them filter on `active`. Widening the default response would silently change revenue, both charts, the owed total, and the remaining-balance math all at once. Zero consumers change meaning in this spec.

Instead, add **`GET /api/payments?include_voided=1`**, used only by an admin view in the Payments tab that lists voided rows with their amount, method, date, and a Restore action. The tab already computes per-method totals (`Payments.tsx:20-24`) and a grand total (`Payments.tsx:26`) from the active array; the new view is additive and defaults to closed.

### Fix 6 — `cake_quotes.status` allow-list

Add `QUOTE_STATUSES = ['new', 'replied', 'converted', 'archived']` beside `ALLOWED_STATUS` (`api.js:52-55`), and replace `api.js:3443-3446` with a validating branch that mirrors `api.js:888-891`, returning 400 on an unknown value. It must be placed **above** the `sets.length === 0` early return at `api.js:3448` so a bad status is never swallowed into a successful no-op.

No `CHECK` migration. SQLite would need a full table rebuild (there is no `ALTER TABLE … ADD CONSTRAINT`) against a live table with a foreign key pointing at it from `cake_quote_items`, and a `CHECK` violation surfaces as a 500 through the generic handler at `api.js:3462-3464` — worse UX than a 400. The app-layer allow-list closes the hole; the constraint is defence in depth for a later migration.

**While in `updateQuote`:** add the `assertQuoteEditable` guard (`api.js:3479-3484`) that `updateInvoice` has at `api.js:3722`, so `quoted_price` can no longer be overwritten on a converted or archived quote. Same house rule, same existing helper.

### Fix 7 — `rowToQuote` maps the deposit fields

Add to `api.js:3161-3187`: `public_token`, `deposit_paid_cents`, `deposit_paid_at`, `deposit_method`. No migration — the columns exist since `0044_quote_deposit.sql` and are already selected.

Mirror them into `ApiQuote` (`api.ts:1056`), the `Quote` type (`types.ts:299`), and `apiToQuote` (`StoreContext.tsx:364-391`) as `publicToken`, `depositPaidCents`, `depositPaidAt`, `depositMethod`. `public_token` is included because it gives the Quotes tab a pay-link button, which invoices already have.

This is the enabling change for the Sales Hub's "deposits with no order" queue card, and it is additive — the fields are simply displayed, and no new UI consumes them in this spec.

### Fix 8 — `convertQuoteToOrder` becomes atomic

Wrap the four statements at `api.js:4596-4637` in a single `env.DB.batch`, matching `convertInvoiceToOrder` (`api.js:3923-3954`). The order id is needed as a bind value for the payment and event inserts, so the insert must run first via `.run()` to obtain `meta.last_row_id`, and the dependent statements follow in the batch — D1 batches execute in order.

The existing `catch`/`UNIQUE constraint failed` handling at `api.js:3957-3964` has no equivalent to copy here, because there is no unique index on the quote side. That remains open and is documented in the follow-up spec.

---

## Testing

**`orders/tests/payment-ledger-lib.test.js`** (new) — the pure module, exhaustively:
- `derivePaymentStatus`: zero payments → `unpaid`; sum below total → `partial`; sum exactly equal → `paid`; sum above total → `paid`; zero total with a payment → `paid`; negative sum → `unpaid`.
- `activePaymentsCents`: dollars-to-cents conversion with float safety — `12.34 → 1234`, `0.1 + 0.2 → 30`, `19.99 → 1999`; rows summing to exactly a `total_cents` target must not land on `partial` through float drift. This is the test that would have caught the dollars/cents class of bug.
- Inactive rows excluded from the sum.

**`orders/tests/create-payment.test.js`** (new) — the handler, using the `makeEnv` mock D1 pattern from `mark-paid.test.js`:
- `replace: true` (the default) emits the deactivate + insert in **one** `DB.batch`, preserving today's behaviour.
- `replace: false` emits no deactivate.
- A throwing insert does **not** produce a committed deactivate — assert the deactivate is a batch member, not a standalone statement.
- `method_details` appears in the INSERT column list.
- An `order_events` row is emitted on both insert and deactivate.
- The derived status matches the post-insert sum for each of `unpaid` / `partial` / `paid`.
- Omitting `replace` behaves as `true` (backward compatibility).

**`orders/tests/quote-status.test.js`** (new):
- A valid status updates and returns 200.
- An invalid status returns 400 **and** issues no UPDATE.
- A bad status alone (`sets.length === 0` after validation) does not return a successful no-op.
- `assertQuoteEditable` now blocks `quoted_price` writes on a `converted` quote.

**`orders/tests/row-to-quote.test.js`** (new) — `rowToQuote` maps all four previously-dropped fields, including `deposit_paid_cents: 0` versus `null` (falsy-but-present values must survive).

**SPA — `src/utils/payments.test.ts`** (new) — `recordPayment` converts cents to dollars exactly once and sends the right `replace` per call site.

**Regression**
- `orders/tests/quote-deposit-lib.test.js`, `invoice-lib.test.js`, `mark-paid.test.js`, `auth-hardening.test.js` must stay green. The `replace` default and the fact that `GET /api/payments` keeps its current contract are what guarantee this.
- `npm run typecheck` must pass. The `Quote` / `ApiQuote` additions ripple through `api.ts`, `types.ts`, and `StoreContext.tsx`.

**Verification against the local D1 store.** The store at `orders/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/` contains 33 payment rows, 8 deactivated, and includes the order-52 over-collection as live evidence. After the fixes, a script should confirm that `orders.payment_status` agrees with the sum of active payments for every order — the eight currently-divergent rows are the regression baseline. Note this is dev data; the same query should be run against production before and after, since the production ledger's divergence count is unknown and is the real measure of how long this bug has been live.

---

## Implementation order

1. **`payment-ledger-lib.js` + full unit tests.** Pure, no integration.
2. **`createPayment` rewrite** (Fix 1) + `create-payment.test.js`. Remove the two dead deactivates in the same change.
3. **`rowToQuote` + client mapping** (Fix 7) + `row-to-quote.test.js`. Independent, unblocks the hub later.
4. **Status allow-list + `assertQuoteEditable`** (Fix 6) + `quote-status.test.js`. Four lines plus one guard.
5. **`OrderModal` refresh** (Fix 2) + `recordPayment` resignature and both `Orders.tsx` call sites (Fix 3) + `payments.test.ts`.
6. **`DELETE /api/payments/:id` route + `include_voided` + admin view** (Fix 4, 5). The only step with new UI.
7. **`convertQuoteToOrder` batching** (Fix 8).

Steps 1–5 touch no new UI and are independently shippable. Step 6 is additive and can be deferred without blocking anything.

---

## Not addressed here

Deferred to the third spec (customer-facing truth + double-charge), and tracked in the Sales Hub spec's "known issues" section:

- **The under-minimum deposit path is a customer-facing lockout.** A customer who pays under the floor gets a green "Your date is secured / We just emailed your confirmation" screen (`pay-quote.html:122-123`) when no order exists and no email was sent; the PayPal path never verifies at all (`pay-quote.html:236-250`); and they cannot pay the remainder — the page shows the terminal "already paid" state, `checkout.js:763-765` returns 409, and no second-payment endpoint exists. The sharpest case is a customer who paid **in full** whose quote is then revised upward: `isDepositSufficient(10000, 25000)` is false, so a 100%-in-full payment is classified as under-minimum with no order. The owner also cannot enter the true amount on conversion — the modal is pre-filled to 50%, the client disables the button, and `api.js:4659-4663` returns 400 — so accepting the prefill records a payment the customer never made.
- **Double-charge.** Nothing links `cake_quotes` to `invoices`. Both conversions create orders with no cross-check, and `convertQuoteToOrder` sets neither `invoice_id` nor `quote_id`. Two payment rows survive and both count toward revenue. Needs `orders.quote_id` + a unique index (also closes the residual serialization gap noted in Fix 8), plus an advisory warning in `createInvoice`.
- **The under-minimum alert is mislabelled** — it fires `notifyDuplicateDeposit`, whose template (`api.js:4274`) says "Duplicate deposit payment … refund needed" for what is a first, under-sized payment needing a top-up invitation.
- **`convertQuoteToOrder` drops the recorded deposit.** It never reads `quote.deposit_paid_cents`, so the true amount is neither carried onto the order nor double-counted — it is simply lost once the quote is converted.
- **The invoice path shares the under-payment bug with a stricter rule.** `matchedPayMode` (`invoice-lib.js:19-27`) requires exact equality to `total` or `ceil(total*0.5)`, so overpayment is *also* rejected. Unlike the quote path, the invoice path self-heals on a provider retry (`api.js:4067-4072`); the quote path's claim-loser does not (`api.js:4360-4362`).
- **`orders.payment_status` can be flipped back to `unpaid` and then re-synced by a provider retry**, inserting a second payment row for the same money (`api.js:952` plus the `alreadyPaid` flag at `api.js:1080`).
- **`convertQuoteToOrder` and `convertInvoiceToOrder` do not set `customer_id` on the order**, so `Quotes.tsx:192`'s "past orders" count reads 0 for converted quotes even when orders exist.
- **`seedPayments` is `[]`** (`seedData.ts:406`), so a transient failure of `GET /api/payments` silently swaps in an empty array — blanking the Payments tab, both dashboard charts, revenue, and the owed total — with only a `console.warn` (`StoreContext.tsx:346-349`).
