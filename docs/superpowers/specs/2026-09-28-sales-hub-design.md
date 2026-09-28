# Sales Hub — Quotes, Invoices, Payments & Receipts

**Date:** 2026-09-28
**Status:** Approved — amended 2026-09-28 after a deeper investigation invalidated part of §3
**Scope:** Dashboard cohesion and a work queue. Money correctness has been **split out** to `2026-09-28-payment-ledger-correctness-design.md`, which ships first.

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

Money is written to four places: `orders.payment_status`, `payments` rows, `cake_quotes.deposit_*`, `invoices.paid_*`. Nothing keeps them reconciled, and one of those writes is destructive — see `2026-09-28-payment-ledger-correctness-design.md`.

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
| **Unrecorded payments** | Orders with `paymentStatus === "unpaid"` that are `completed`, or whose `dueTier()` is `overdue`/`today`/`tomorrow` — i.e. almost certainly settled in cash | **Record payment** (see `RecordPaymentModal` below) | `#sales/payments` |
| **Receipt problems** | `receipts` where `status === "failed"`, plus orders with `paymentStatus === "paid"` and no receipt row | Resend / generate receipt | `#sales/receipts/failed` |
| **Deposits with no order** ⚠️ | `depositPaidCents > 0` and `convertedOrderId == null` | Open quote, reconcile or refund | `#sales/quotes` |

**On the "deposits with no order" card.** A quote deposit normally auto-converts to an order (`api.js:4371`), so this is a narrow state, not a common one. It is reached when the provider-signed payment lands **below the 50% minimum** — the `insufficient_amount` branch at `api.js:4342-4347`. The money moved, no order is created, and the customer is sent **no confirmation email**; only the owner gets a Telegram ping (`:4346`). This is the highest-severity item in the queue and the one that was most invisible: the SPA cannot compute it today because `rowToQuote` never maps the deposit fields at all (`api.js:3161-3187`), so they are write-only. The correctness spec fixes that as Fix 7.

**What this card does not do:** it surfaces the state to you. It does not stop the customer having been shown a false success screen, and it does not let them pay the remainder. Both are open — see "Known issues" below.

The other paths that return `duplicate` (`api.js:4323, 4333, 4346, 4367`) all have `convertedOrderId` set, so they correctly fall outside this card.

### 3. Money-accuracy fixes — MOVED OUT

The eight subsections that used to live here (the `createPayment` `replace` mode, `RecordPaymentModal`, the `recordPayment` resignature, the quote-deposit mapping, the Order → Invoice link, the `payments.order_number` fallback, the "Undo payment" copy, and the `QuoteConvertModal` deposit floor) have been **split into `2026-09-28-payment-ledger-correctness-design.md`**, which ships first.

That split happened after a deeper investigation found the premise of this section was wrong. These were not accuracy polish — the payment ledger was **losing data**, and the investigation turned up a third `createPayment` call site this spec had missed (`OrderModal.tsx:180-195`, the new-order 10% deposit) whose missing `refreshPayments()` makes the existing "Collect Balance" button collect the *full order total* instead of the balance. The local D1 store holds the proof: order 52 shows a `$1.30` deposit deactivated 85 seconds before a `$13.00` payment for a `$13.00` order — `$14.30` of real cash, `$13.00` recorded.

Shipping a dashboard that aggregates the ledger on top of that is building the reporting layer before the thing it reports on. The correctness spec goes first; this spec follows on trustworthy data.

**Two corrections to the text below, both material:**

1. **The original §3d was wrong.** It claimed "the server already returns them" for the quote deposit fields. It does not. `QUOTE_FIELDS` selects them (`api.js:3140-3149`) but `rowToQuote` (`api.js:3161-3187`) — the serializer behind both `listQuotes` and `getQuote` — drops them, along with `public_token`. The mapping is therefore a **server** change, not just a client one, and it lives in the correctness spec as Fix 7. The same omission means the Quotes tab has no pay-link button, which invoices do have.
2. **`RecordPaymentModal` is not blocked on the correctness work**, only on it shipping first. The modal itself stays here — the correctness spec only re-points the two existing `Orders.tsx` inline flows at a corrected `recordPayment` signature and preserves their current single-method-select UI.

**Still in scope for this spec**, because they are cohesion rather than correctness:

- The **Order → Invoice link** — a one-line mapping plus a rendered link, and the main reason the hub reads as one system.
- The **`payments.order_number` fallback** — a one-line derivation from `orderId`, so the Payments table's blank first column and its no-op search filter start working.
- The **"Undo payment" copy** — the label claims history is kept; it is deactivated. Correcting the words costs nothing, and the correctness spec adds the `include_voided` view that makes the corrected claim true.
- The **`QuoteConvertModal` deposit floor** — relaxing a 50% hard block so a small cash deposit is recordable. This is a capability, not a fix, and belongs with the cash-deposit feature below.

## Cash deposits, end to end

| Where | How it works | Status |
|---|---|---|
| Quote deposit, cash | `QuoteConvertModal` — already defaults to `cash` and excludes online-only methods (`:37`, `:46-48`), plus the deposit-floor relaxation described above | Exists; needs the floor change |
| **Order deposit or balance, cash** | **`RecordPaymentModal` with a partial amount and `replace: false`** | **New** |
| Invoice settled in cash | Convert the invoice to an order, then record the cash payment against the order | Exists |

**Invoice settled in cash is deliberately out of scope for the one-click path.** A direct `POST /api/invoices/:id/record-payment` would need a synthetic ref to satisfy the `X-Webhook-Secret` webauth on `invoicePaid` (`api.js:3994-3999`), *and* would need a new `partial` invoice status — because `classifyInvoicePayment` (`invoice-lib.js:31-43`) accepts only an amount exactly equal to `total` or exactly `ceil(total * 0.5)`, so a `$75` payment against a `$160` invoice is rejected as `unexpected-amount`. Converting the invoice to an order first reuses the existing atomic path and introduces no new state.

---

## Testing

Follows the existing convention: pure logic in `utils/*.ts`, unit-tested, no rendering required. The payment-ledger tests live in the correctness spec and are not repeated here.

**SPA — `src/utils/salesAttention.test.ts`** (new)
- Each of the five selectors, including the boundary cases: an invoice at `paidCents === totalCents` is *not* outstanding; a quote with a deposit **and** a `convertedOrderId` is *not* flagged; a `paid` order with a receipt is not flagged; `dueTier` overdue bucketing; the sidebar badge total equals the sum of the card counts.

**SPA — `src/components/RecordPaymentModal.test.tsx`** (new)
- Remaining-balance default; live remaining-after readout; min validation; **Record** sends `replace: false` and **Settle in full** sends `replace: true` with the full remaining amount; `ONLINE_ONLY` methods absent; not rendered when remaining is `0`.

**Regression**
- The correctness spec's suites must be green before this work starts — the hub's queue reads the same ledger.
- `npm run typecheck` must pass. The `ApiOrder` / `Order` additions ripple through `api.ts`, `types.ts`, and `StoreContext.tsx`.

---

## Dependency

**This spec is blocked on `2026-09-28-payment-ledger-correctness-design.md` shipping first.** The `Deposits with no order` card cannot be computed at all until the server maps the deposit fields (Fix 7), `Unrecorded payments` is meaningless while the ledger loses rows, and the `RecordPaymentModal` needs the corrected `recordPayment` signature and the `replace` flag that spec introduces.

---

## Implementation order

1. **Pure derivations** — `salesAttention.ts` with full tests. Nothing user-visible. Can start immediately, in parallel with the correctness spec.
2. **Mapping additions** — `ApiOrder.invoice_id` → `Order.invoiceId`, and the `payments.order_number` fallback. Two lines, no migration, trivially revertable.
3. **`RecordPaymentModal`** + retire both `Orders.tsx` inline flows.
4. **`Sales.tsx`** — sub-tab state, hash deep-links, queue, sidebar/topbar rewiring, `focus` props on the four pages.
5. **Copy and secondary polish** — "Undo payment" relabel, `QuoteConvertModal` floor relaxation, Quotes deposit badge, Receipts failure tile.

**Change surface:** `home-bakery-management-system/src/{App.tsx, types.ts}`, `src/utils/{api.ts, salesAttention.ts}`, `src/context/StoreContext.tsx`, `src/pages/{Sales.tsx (new), Orders.tsx, Quotes.tsx, Invoices.tsx, Payments.tsx, Receipts.tsx}`, `src/components/{Sidebar.tsx, Topbar.tsx, RecordPaymentModal.tsx (new)}`, plus tests.

**No migrations. No changes to `orders/workers/` beyond the `recordPayment` call sites — all worker-side work is in the correctness spec.**

---

## Known issues deliberately not addressed

Recorded so they are not lost. Items marked **[fixed elsewhere]** are handled by `2026-09-28-payment-ledger-correctness-design.md`; the rest are open and are candidates for the third spec.

- **The under-minimum deposit is a customer-facing lockout, not a visibility gap.** A customer who pays below the floor gets a green *"Your date is secured / We just emailed your confirmation"* screen (`pay-quote.html:122-123`) when no order exists and no email was sent; the PayPal path never verifies at all (`pay-quote.html:236-250`); and they cannot pay the remainder — the page shows the terminal "already paid" state, `checkout.js:763-765` returns 409, no second-payment endpoint exists. The sharpest case: a customer who paid **in full** whose quote is later revised upward trips `isDepositSufficient(10000, 25000)` and is classified as under-minimum with no order. **This spec's queue surfaces the state for the owner; it does not close the customer-facing loop.** The fifth queue card is the most it can do.
- **The owner cannot enter the true amount when converting.** The convert modal is pre-filled to 50%; the client disables the button below the floor and `api.js:4659-4663` returns 400. Accepting the prefill records a payment the customer never made, over-counting revenue.
- **`convertQuoteToOrder` drops the recorded deposit.** It never reads `quote.deposit_paid_cents`, so the true amount is neither carried onto the order nor double-counted — it is lost once the quote converts.
- **The under-minimum alert is mislabelled** — it fires `notifyDuplicateDeposit`, whose template (`api.js:4274`) reads "Duplicate deposit payment … refund needed" for what is a first, under-sized payment needing a top-up invitation.
- **The invoice path shares the under-payment bug with a stricter rule.** `matchedPayMode` (`invoice-lib.js:19-27`) demands exact equality, so *over*payment is rejected too. The invoice path self-heals on a provider retry (`api.js:4067-4072`); the quote path's claim-loser does not (`api.js:4360-4362`).
- **Nothing prevents a double charge.** A quote-deposit link and an invoice can both be sent for the same cake, producing two orders and two payment rows that both count toward revenue. No cross-check exists between the two conversion paths, and `convertQuoteToOrder` sets neither `invoice_id` nor `quote_id`. Detection is possible with a join on `cake_quotes.converted_order_id` and `invoices.converted_order_id`, but no such query exists in the product. **[fix requires the `orders.quote_id` migration]**
- **Neither conversion path sets `customer_id` on the order**, so `Quotes.tsx:192`'s "past orders" count reads 0 for converted quotes even when orders exist.
- **`orders.payment_status` can be flipped back to `unpaid` and then re-synced by a provider retry**, inserting a second payment row for the same money (`api.js:952` plus the `alreadyPaid` flag at `api.js:1080`). **[fixed elsewhere — status is now derived from the ledger]**
- **`convertQuoteToOrder` is not transactional** (`api.js:4596-4637`), unlike `convertInvoiceToOrder`. **[fixed elsewhere]**
- **`updateOrder` rewrites `method` on the newest active payment in place** with no audit event (`api.js:958-965`), so "Edit method" on a cash-deposit-plus-card-balance order relabels the cash row. **[fixed elsewhere — an audit event is added]**
- **`seedPayments` is `[]`** (`seedData.ts:406`), so a transient failure of `GET /api/payments` silently swaps in an empty array — blanking the Payments tab, both dashboard charts, revenue, and the owed total — with only a `console.warn` (`StoreContext.tsx:346-349`).
- **Deleting an order orphans its payments.** `payments.order_id` is `ON DELETE SET NULL` (`0006_server_storage.sql:22`) while `receipts` cascade (`0022_receipts.sql:5`). Orphaned payments remain in revenue totals, which is arguably correct — the money was real — but the distinction is invisible.
- **The 50% deposit rule is implemented four times** — `quote-deposit-lib.js:7`, `invoicePdf.ts:171`, `QuoteConvertModal.tsx:36,43`, and `invoice-lib.js:19`. Only the first two are unit-tested. Consolidating is a small, worthwhile follow-up.
- **`/api/stats` is dead code** (`api.js:1446-1466`); no SPA caller. All dashboard analytics is computed client-side.
- **A failed receipt send never alerts anyone.** `status: 'failed'` surfaces only as a red pill on the Receipts tab (`Receipts.tsx:98-102`). The queue improves visibility but does not notify.
- **`cake_quotes.status` accepts any string** (`api.js:3443-3446`), with no `CHECK` constraint and no `CHECK` anywhere in the schema. Not triggerable through the shipped UI — both call sites send hardcoded literals — but the client types are `status?: string`, so a future status editor passes through unchecked. Damage is fail-open and lands on the money paths. **[fixed elsewhere]**
- **There is no unique index on `cake_quotes.converted_order_id`,** so quote conversion is not serialized against itself. Two concurrent converts can both insert. The invoice conversion has `idx_orders_invoice_id` (`0048:8`) as its explicit serialization point (`api.js:3924`); the quote side has no equivalent. **[fix requires a migration]**
