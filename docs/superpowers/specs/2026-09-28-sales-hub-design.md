# Sales Hub — Quotes, Invoices, Payments & Receipts

**Date:** 2026-09-28
**Status:** Approved
**Scope:** Dashboard cohesion + money-accuracy fixes. No new business capabilities beyond cash deposit recording.

---

## Problem

The sidebar exposes four separate screens — Cake Quotes, Invoices, Payments, Receipts — that feel like four unrelated mini-CRM apps rather than one sales system. There is no queue telling the owner what needs attention, no way to see a customer's whole financial history in one place, and several silent data defects that make the numbers on those tabs untrustworthy.

### Structural findings that shape this design

| Relationship | Current reality |
|---|---|
| Quote → Invoice | **No link exists.** `cake_quotes` has no `invoice_id`; `invoices` has no `quote_id`. Two independent convert paths: `api.js:4517` (quote), `api.js:3899` (invoice) |
| Invoice → Order | Solid. Atomic `DB.batch`, unique-indexed (`api.js:3899-3967`, `0048:8`) |
| Order → Invoice | **Severed.** Server writes and returns `orders.invoice_id` (`0048:7`); `ApiOrder` (`api.ts:39-60`) and `apiToOrder` (`StoreContext.tsx:118-142`) both drop it. Not navigable |
| Payment → Order | Solid FK (`0006_server_storage.sql:22`) |
| Receipt → anything but Order | `receipts.order_id` is `NOT NULL` + `CASCADE` (`0022_receipts.sql:5`). **A paid, emailed invoice creates zero receipt rows** |

Money is written to four places: `orders.payment_status`, `payments` rows, `cake_quotes.deposit_*`, `invoices.paid_*`. Nothing keeps them reconciled, and one of those writes is destructive (§3a).

All analytics is client-side `useMemo` over the full in-memory store (`Dashboard.tsx:41-137`). `/api/stats` (`api.js:1446`) is dead code. This design adds no server aggregation — all five queue signals are derivable client-side from data the SPA already fetches.

### Goals

1. Make the four screens read as one system with one obvious entry point.
2. Give the owner a single "needs you" queue covering the five things that currently fall through cracks.
3. Make cash deposits and partial payments recordable without destroying payment history.
4. Repair the money-accuracy defects that make the existing tabs untrustworthy.
5. Restore the missing Order → Invoice link.

### Non-goals

- Quote → Invoice conversion ("send priced quote as invoice"). Explicitly deferred; requires a new `quote_id` on `invoices` and a new `source_quote_id` concept.
- A unified status vocabulary across the four entities. Deferred.
- Route-based navigation. The app is a `useState<Page>` shell (`App.tsx:46`) with no router; this design uses a sub-tab state machine instead.
- Margin/profit reporting, quote win-rate, invoice aging reports.
- Any change to the Stripe/PayPal checkout worker, `markOrderPaid`, or the invoice/quote conversion batch paths.

---

## Design

### 1. Shell

The `Page` union collapses `quotes | invoices | payments | receipts` into a single `sales` member. One sidebar entry opens a `Sales` page that renders an attention queue above a sub-tab bar above the active page body.

```
┌─────────────┬──────────────────────────────────────────┐
│  Sidebar    │  Sales — Quotes, invoices, payments &    │
│             │  receipts                                │
│  Dashboard  ├──────────────────────────────────────────┤
│  Orders     │  ⚠ 3 need you                    [ ▾ ]    │
│  Sales    5 ├──────────────────────────────────────────┤
│  Calendar   │  [Quotes 2] [Invoices 1] [Payments]      │
│  Menu & …   │  [Receipts]                              │
│             ├──────────────────────────────────────────┤
│             │  (active page body)                      │
└─────────────┴──────────────────────────────────────────┘
```

**`App.tsx`**
- `:27-42` — collapse four `Page` members into `"sales"`.
- `:145-146, 160-161` — replace four render branches with one `<Sales search={search} />`.
- `:57-60` — extend the existing hash deep-link pattern to `#sales/<tab>` and `#sales/<tab>/<focus>`. The calendar implementation is the reference; `Sales` reads the hash once on mount and clears it, same as `CalendarView` does.

**`Sidebar.tsx`**
- `:24-40` — one `{ id: "sales", label: "Sales", icon: Wallet }` entry, positioned where `quotes` sat (after Orders).
- `:53, 69-71` — badge becomes the **total attention count** across all five cards, replacing the quotes-only count. The count comes from the same pure selector the hub uses, so sidebar and hub can never disagree.

**`Topbar.tsx`**
- `:6-22` — four `TITLES` entries collapse to `sales: { title: "Sales", subtitle: "Quotes, invoices, payments & receipts" }`. Each sub-tab already renders its own filter row, so per-tab identity is carried by the sub-tab bar.

**Why the four pages need almost no change.** All four are already title-less content bodies taking only `{ search }` and rendering a bare `space-y-6` container — see `Payments.tsx:16,36`, `Invoices.tsx:24`, `Quotes.tsx:69`, `Receipts.tsx:9`. They embed inside the hub unchanged. The only addition is an optional `focus` prop used to deep-link a pre-filtered view from the queue.

**Search.** The `search` string is already lifted to `App.tsx:50` and passed down, so global search works across all four sub-tabs with no extra wiring.

### 2. Attention queue

Five cards rendered above the sub-tabs. Collapsed to a single summary strip by default; expanded shows all five. When all five are empty the strip collapses to a single line: *"All clear — nothing needs you."*

All five are pure derivations over the existing store — no new endpoints, no new tables. The selectors live in `src/utils/salesAttention.ts` as pure functions so they are testable without rendering, matching the existing `format.test.ts` / `lowStock.test.ts` convention.

| Card | Rule | Primary action | Deep link |
|---|---|---|---|
| **Quotes to answer** | `status === "new"`, or `status === "replied"` with no `convertedOrderId`. Days-since badge, red past 3 days | Open quote detail | `#sales/quotes` |
| **Invoices unpaid** | `status === "sent"` and `paidCents < totalCents`, sorted by `dueDate`. Urgency via `dueTier()` (`format.ts:110-124`) | Open invoice, copy pay link | `#sales/invoices/overdue` |
| **Unrecorded payments** | Orders with `paymentStatus === "unpaid"` that are `completed`, or whose `dueTier()` is `overdue`/`today`/`tomorrow` — i.e. almost certainly settled in cash | **Record payment** (§3b) | `#sales/payments` |
| **Receipt problems** | `receipts` where `status === "failed"`, plus orders with `paymentStatus === "paid"` and no receipt row | Resend / generate receipt | `#sales/receipts/failed` |
| **Deposits with no order** ⚠️ | `depositPaidCents > 0` and `convertedOrderId == null` | Open quote, reconcile or refund | `#sales/quotes` |

**On the "deposits with no order" card.** A quote deposit normally auto-converts to an order (`api.js:4371`), so this is a narrow state, not a common one. It is reached when the provider-signed payment lands **below the 50% minimum** — the `insufficient_amount` branch at `api.js:4342-4347`. The money moved, no order is created, and the customer is sent **no confirmation email**; only the owner gets a Telegram ping (`:4346`). This is the highest-severity item in the queue and the one that was most invisible: the SPA cannot compute it today because quote deposit fields never reach the client (§3d).

The other paths that return `duplicate` (`api.js:4323, 4333, 4346, 4367`) all have `convertedOrderId` set, so they correctly fall outside this card.

### 3. Money-accuracy fixes

#### 3a. `createPayment` gains a `replace` mode — prerequisite for deposits

**Today** (`api.js:2717-2721`) `createPayment` deactivates *every* active payment for the order before inserting. The stated intent (`api.js:2713-2716`) is to prevent double-counting when toggling paid → unpaid → paid. The side effect is that **a partial payment is destroyed by the next one**.

This is not theoretical. The existing **"Collect Balance"** button at `Orders.tsx:479-497` records the remaining balance — which means it deletes the deposit record it was meant to settle. Deposits cannot work correctly until this changes.

**New behaviour** (`api.js:2701-2740`):

| `replace` | Behaviour | Used by |
|---|---|---|
| `true` (default) | Current behaviour: deactivate all active payments for the order, then insert | Full settles; preserves every existing caller |
| `false` | Insert as a top-up; leave existing active payments alone | Deposits, partial/balance collection |

The default preserves current behaviour exactly, so `quote-deposit-lib.test.js` and `invoice-lib.test.js` stay green and no existing caller changes meaning.

**After any insert, `orders.payment_status` is recomputed server-side** from the sum of active payments, rather than trusting a client-supplied status:

- no active payments → `unpaid`
- active sum `> 0` and `< total_cents` → `partial`
- active sum `>= total_cents` → `paid` (overpayment counts as paid)

The recompute is a pure function in a new `orders/workers/payment-ledger-lib.js`, unit-tested per the existing `*-lib.js` convention. It runs **only** inside `createPayment`, so it cannot disturb `markOrderPaid` (`api.js:1060-1140`, which forces `paid` and flips `awaiting_payment` → `pending` at `:1116-1122`) or the conversion batch paths (`api.js:3946-3949`, `api.js:4620-4626`), which write payments with their own inserts.

**Cents vs dollars.** `payments.amount` is `REAL` dollars (`0006_server_storage.sql:25`) while every other monetary column is `INTEGER` cents. This is a pre-existing wart; changing it is a data migration and out of scope. The recompute converts with `Math.round(amount * 100)` and the SPA divides once at the write site, as `markOrderPaid` (`api.js:1109`) already does.

**`method_details` on insert.** `createPayment` currently omits `method_details` from its INSERT (`api.js:2725`) even though the column exists (`0021_payment_sub_method.sql:6`), `ApiPayment` reads it (`api.ts:692`), and `markOrderPaid` already writes it (`api.js:1111`). Only the owner-recorded path drops it. The modal needs it, so the insert gains it and `PaymentCreate` (`api.ts:698-706`) gains the field.

#### 3b. `RecordPaymentModal` — new component

`src/components/RecordPaymentModal.tsx`.

- **Amount** — defaults to the remaining balance. Min `$0.01`, step `0.01`. Live readout: *"Remaining after: $X"*.
- **Method** — radio grid from `profile.acceptedMethods` filtered to exclude `ONLINE_ONLY` (`format.ts:54`: `stripe`, `paypal`), matching `Orders.tsx:132-134` and `QuoteConvertModal.tsx:46-48`. Defaults to `cash`.
- **Sub-method** — optional free text (Venmo/CashApp handle, "who gave it to me"), shown only when a sub-method is meaningful. Rendered via `formatPaymentSubMethod` (`format.ts:56`) for the summary line.
- **Date** — defaults to today, editable. Backdating a cash payment is a real workflow.
- **Two buttons:**
  - **Record** — records `amount` as a top-up (`replace: false`). Partial/deposit.
  - **Settle in full** — sets amount to the remaining balance and records it (`replace: true`).
- Not offered when remaining is `0`.
- On success: toast via the app's `ToastProvider`, refresh orders + payments, close.

**Replaces the two duplicated inline flows** at `Orders.tsx:466-517` and `Orders.tsx:530-570`, both of which become `setRecordPayFor(order)`. Also invoked from the queue's "Unrecorded payments" card.

#### 3c. `recordPayment` signature change

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

The modal and the three call sites (`Orders.tsx:113, 485, 548`) stop calling `apiUpdateOrder({ payment_status })` before recording. The server recompute from §3a is authoritative, which removes the double-write and the ordering hazard in the current code, where `Orders.tsx:484` marks the order `paid` and `:485` then records whatever it recorded.

`recordPayment` returns the server-computed status and remaining balance so callers can show an accurate confirmation instead of guessing.

**Unit handling.** `recordPayment` takes `amountCents` because that is what the modal's balance math uses — `Order.total` is dollars (`StoreContext.tsx:139`, `total_cents / 100`) but `Invoice.totalCents` is cents, and the modal is shared. The single division to dollars happens inside `recordPayment` when it calls `createPayment`, whose wire field `amount` is dollars (`api.ts:702`) to match the `REAL` column — exactly as `markOrderPaid` does at `api.js:1109`.

#### 3d. Quote deposits reach the SPA

The server already returns them — `QUOTE_FIELDS` at `api.js:3147` includes `deposit_paid_cents`, `deposit_paid_at`, `deposit_method`, `deposit_ref` — but `ApiQuote` (`api.ts:~1055-1081`), the `Quote` type (`types.ts:297-325`), and `apiToQuote` (`StoreContext.tsx:364-391`) all drop them.

Add `depositPaidCents: number | null`, `depositPaidAt: string | null`, `depositMethod: string | null` to the `Quote` type (`types.ts:299`); add the three snake_case fields to `ApiQuote` (`api.ts:1056`); map them in `apiToQuote`. **No migration** — the columns exist since `0044_quote_deposit.sql`.

This unlocks queue card 5 and lets the Quotes tab show a deposit badge on any quote that has been paid down.

#### 3e. Restore the Order → Invoice link

- Add `invoice_id?: number | null` to `ApiOrder` (`api.ts:39-60`).
- Add `invoiceId: number | null` to the `Order` type (`types.ts:119`).
- Map it in `apiToOrder` (`StoreContext.tsx:118-142`).
- Resolve `invoiceId` → `INV-####` client-side against the already-loaded `invoices` array, and render a link in the order detail modal plus in any order row shown in the hub.

**No migration** — the column and its unique index exist (`0048_orders_invoice_id.sql:7-8`); the SPA simply discards the value. The reverse direction (invoice → order) already renders at `Invoices.tsx:242-244`; this completes the pair.

#### 3f. `payments.order_number` fallback

The `orders` table has no `order_number` column, so every `payments` row stores `NULL` — `api.js:1105` states this explicitly. `apiToPayment` (`StoreContext.tsx:313`) reads the column directly and yields `""`, so the first column of the Payments table is always blank and the search filter on it (`Payments.tsx:30`) is a no-op.

`Order.orderNumber` is already derived client-side as `MR-${id}` (`StoreContext.tsx:123`). Change `apiToPayment` to fall back to the same derivation. **No migration.** Existing `NULL` rows immediately display correctly.

#### 3g. Honest copy on "Undo payment"

`Orders.tsx:518-528` labels the action *"Mark this order as unpaid"* with the body *"The payment history will be kept for your records."* It does the opposite: `updateOrder` with `payment_status: 'unpaid'` deactivates **all** payments for the order (`api.js:950-953`), and `listPayments` filters `WHERE active = 1` (`api.js:2696`), so the history disappears from the UI.

Behaviour is intentional as an explicit undo and is left unchanged. The copy is corrected to state that payment history is cleared, with a confirm dialog. Low risk, and it stops the app from claiming something it does not do.

#### 3h. `QuoteConvertModal` deposit floor

`QuoteConvertModal.tsx:42,44` hard-blocks any deposit below 50% of the quoted price. That floor enforces a business rule — *is this job firmly booked?* — but it is wrong for cash, where a customer handing over `$20` against a `$150` quote is a real event that should be recordable.

- Floor relaxes to `$0.01`.
- The 50% figure remains the prefill (`:36`).
- Below 50%, show a non-blocking warning that the job is not yet firmly booked and the balance is due before baking.

---

## Cash deposits, end to end

| Where | How it works | Status |
|---|---|---|
| Quote deposit, cash | `QuoteConvertModal` — already defaults to `cash` and excludes online-only methods (`:37`, `:46-48`), plus the §3h floor relaxation | Exists, needs 3h |
| **Order deposit or balance, cash** | **`RecordPaymentModal` with a partial amount and `replace: false`** | **New** |
| Invoice settled in cash | Convert the invoice to an order, then record the cash payment against the order | Exists |

**Invoice settled in cash is deliberately out of scope for the one-click path.** A direct `POST /api/invoices/:id/record-payment` would need a synthetic ref to satisfy the `X-Webhook-Secret` webauth on `invoicePaid` (`api.js:3994-3999`), *and* would need a new `partial` invoice status — because `classifyInvoicePayment` (`invoice-lib.js:31-43`) accepts only an amount exactly equal to `total` or exactly `ceil(total * 0.5)`, so a `$75` payment against a `$160` invoice is rejected as `unexpected-amount`. Converting the invoice to an order first reuses the existing atomic path and introduces no new state.

---

## Testing

Follows the existing convention: pure logic in `*-lib.js` / `utils/*.ts`, unit-tested, no rendering required.

**Worker — `orders/tests/payment-ledger-lib.test.js`** (new)
- Recompute matrix: no payments → `unpaid`; partial sum → `partial`; exact total → `paid`; overpayment → `paid`; zero-amount total.
- Cents conversion: `amount` is `REAL` dollars, `total_cents` is an integer — `12.34` dollars must equal `1234` cents, no float drift.
- `replace: true` deactivates prior active rows; `replace: false` leaves them.
- Multiple `replace: false` top-ups accumulate to the correct sum.

**SPA — `src/utils/salesAttention.test.ts`** (new)
- Each of the five selectors, including the boundary cases: an invoice at `paidCents === totalCents` is *not* outstanding; a quote with a deposit and a `convertedOrderId` is *not* flagged; a `paid` order with a receipt is not flagged; `dueTier` overdue bucketing.

**SPA — `src/components/RecordPaymentModal.test.tsx`** (new)
- Remaining-balance default; live remaining-after readout; min validation; **Record** sends `replace: false` and **Settle in full** sends `replace: true` with the full remaining amount; `ONLINE_ONLY` methods absent; not rendered when remaining is `0`.

**Regression**
- `orders/tests/quote-deposit-lib.test.js` and `orders/tests/invoice-lib.test.js` must stay green. The `replace` default is what guarantees this.
- `npm run typecheck` must pass — `ApiQuote` / `ApiOrder` / `Quote` / `Order` / `Payment` type changes ripple through `api.ts`, `types.ts`, and `StoreContext.tsx`.

---

## Implementation order

1. **Pure derivations + lib extraction** — `payment-ledger-lib.js` and `salesAttention.ts`, with full tests. Nothing user-visible.
2. **Worker `createPayment` `replace` mode** + status recompute + `method_details` on insert. Tests green.
3. **Mapping fixes** — `ApiOrder.invoice_id`, quote deposit fields, `payments.order_number` fallback. No migration, so trivially revertable.
4. **`RecordPaymentModal`** + `recordPayment` resignature + retire both `Orders.tsx` inline flows.
5. **`Sales.tsx`** — sub-tab state, hash deep-links, queue, sidebar/topbar rewiring, `focus` props on the four pages.
6. **Copy and secondary polish** — §3g relabel, §3h floor relaxation, Quotes deposit badge, Receipts failure tile.

Steps 1–3 are independently shippable and touch no UI. If the queue turns out to be wrong, nothing has been spent that can't be discarded.

**Change surface:** `orders/workers/api.js` (one handler + one new lib), `home-bakery-management-system/src/{App.tsx, types.ts}`, `src/utils/{api.ts, salesAttention.ts}`, `src/context/StoreContext.tsx`, `src/pages/{Sales.tsx (new), Orders.tsx, Quotes.tsx, Invoices.tsx, Payments.tsx, Receipts.tsx}`, `src/components/{Sidebar.tsx, Topbar.tsx, RecordPaymentModal.tsx (new)}`, plus tests.

**No migrations. No changes to `workers/checkout.js`, `markOrderPaid`, `convertInvoiceToOrder`, or `convertQuoteToOrder`.**

---

## Known issues deliberately not addressed

Recorded so they are not lost, and explicitly out of scope for this pass:

- **`cake_quotes.status` has no server-side whitelist.** `updateQuote` writes any string the client sends (`api.js:3443-3446`). `invoices` is guarded by `assertInvoiceEditable` (`api.js:3133`); quotes are not. Worth fixing, but it is a validation bug rather than money accuracy, and the fix belongs with a status-vocabulary pass.
- **Nothing prevents a double charge.** A quote-deposit link and an invoice can both be sent for the same cake, producing two payment rows and two orders. The only safeguard is a Telegram "refund needed" alert (`api.js:4273`, `api.js:3969`). A true fix needs the quote → invoice link this design defers.
- **Deleting an order orphans its payments.** `payments.order_id` is `ON DELETE SET NULL` (`0006_server_storage.sql:22`) while `receipts` cascade (`0022_receipts.sql:5`). Orphaned payments remain on the Payments tab and in the revenue totals, which is arguably correct — the money was real — but the distinction is invisible.
- **The 50% deposit rule is implemented four times** — `quote-deposit-lib.js:7`, `invoicePdf.ts:171`, `QuoteConvertModal.tsx:36,43`, and now a fifth in the `salesAttention` reasoning. The first is the only unit-tested one. Consolidating is a small, worthwhile follow-up.
- **`DELETE /api/payments/:id` is unrouted.** The handler exists (`api.js:2742`) but no route reaches it, and the client wrapper (`api.ts:720-724`) calls a 404 and is never invoked. Payments are effectively immutable.
- **`/api/stats` is dead code** (`api.js:1446-1466`); no SPA caller. All dashboard analytics is computed client-side.
- **A failed receipt send never alerts anyone.** `status: 'failed'` surfaces only as a red pill on the Receipts tab (`Receipts.tsx:98-102`). The attention queue improves visibility but does not notify.
- **In the `insufficient_amount` branch the customer gets no confirmation email** (`api.js:4342-4347`) — money has left their account and the only notification goes to the owner. The queue surfaces the state for the owner but does not close the customer-facing loop.
