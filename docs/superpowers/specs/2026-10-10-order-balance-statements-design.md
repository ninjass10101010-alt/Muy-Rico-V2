# Order Balance Statements — payable overdue-balance reminders — Design

**Date:** 2026-10-10
**Status:** Approved by owner (Approach 1 — dedicated order-balance pay link)
**Branch:** main (repo deploys from main per owner pattern)

## Problem

Orders frequently carry a remaining balance after the pickup date: deposit-only quotes,
late-pickup credits, or payments that were collected but recorded later. Today there is no
customer-facing document that shows **what the customer already paid** and **what remains**, and
no admin workflow to request overdue balances.

The only payable documents that exist are quotes (deposit rails, auto-convert on payment) and
invoices (standalone bills that **auto-create a stub order when paid**). Sending an invoice for a
balance produces a phantom $20 order plus a lingering balance on the real order — a reconciliation
mess the team hit live on order MR-65 (2026-10-07). Balance collection needs its own rail.

## Goals

1. Admin **one-click "Send balance statement"** per order, plus a **"Remind all overdue"** bulk
   action. No automatic sends without a human (v1).
2. The statement email is explicit: **payments made** (date · method · amount), subtotal/discount/
   total, **paid to date**, and **balance due** — bilingual (EN/ES, per order language).
3. A secure **public pay page** (token link) collects the **full remaining balance** by card /
   Apple Pay / Cash App (Stripe) or PayPal / Venmo (PayPal Smart Buttons).
4. Online payment is recorded **on the order's own ledger** (no stub orders); `payment_status`
   re-derives (partial → paid); the customer receives an updated paid confirmation.
5. Payments are idempotent (webhook retries cannot double-record) and amounts are always
   recomputed server-side — the client can never influence what is charged.

## Owner requirements (gathered during brainstorming)

- **Trigger:** admin one-click + bulk. Scheduled/automatic sending is explicitly out of scope v1.
- **Eligibility:** pickup date has passed · balance > $0 · not cancelled. Includes
  completed-but-unpaid orders; requires an email on file.
- **Pay amount:** full remaining balance only (no partial entry on the pay page).
- **Transparency:** the statement must show every payment recorded plus the remaining balance.
- **Process:** this ships with the pending deploy batch (repo is ahead of production; migration
  0050 must be applied before this feature's migration).

## Non-goals

- No scheduled/automatic statement sending (possible follow-up; cron infrastructure exists).
- No partial online payments — unusual cases keep using invoices or manual recording.
- No SMS, no PDF attachment, no customer portal or statement history page.
- No changes to quote/invoice payment rails (additive only).
- No automatic refunds — duplicate/odd payments are flagged to the owner, same policy as quotes.

---

## 1. Data model — migration `orders/migrations/0051_order_balance_statements.sql`

```sql
-- Stable, unguessable pay link for an order's balance (generated on first statement send).
ALTER TABLE orders ADD COLUMN pay_token TEXT;

-- Gateway transaction reference (Stripe session / PayPal capture id) so webhook
-- retries and double-captures cannot record the same payment twice.
ALTER TABLE payments ADD COLUMN ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_ref ON payments(ref) WHERE ref IS NOT NULL;

-- One row per statement send attempt (audit + "last reminded" + bulk 24h skip).
CREATE TABLE IF NOT EXISTS order_statements (
  id            TEXT PRIMARY KEY,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  email         TEXT,
  language      TEXT NOT NULL DEFAULT 'es',
  total_cents   INTEGER NOT NULL,
  paid_cents    INTEGER NOT NULL,
  balance_cents INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'sent',          -- 'sent' | 'failed'
  message_id    TEXT,
  sent_by       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_order_statements_order
  ON order_statements(order_id, created_at DESC);
```

Notes:
- `pay_token` is 32 hex chars (128-bit), same generation style as `invoices.public_token` /
  `cake_quotes.public_token`. Generated lazily on first statement send and never rotated in v1, so
  links in older emails keep working.
- `payments.amount` stays in dollars (existing schema); `ref` is additive.
- Statements are logged whether the email succeeded or failed; only `status='sent'` rows count
  toward the bulk 24h skip.

## 2. Eligibility & balance — `orders/workers/order-statements-lib.js` (new, pure)

Single source of truth, unit-tested without D1:

```js
balanceCents(order, activePayments)       // total_cents - sum(active payments), floored at 0
isStatementEligible(order, balanceCents, today)
  // status !== 'cancelled'
  // && pickup_date exists and pickup_date < today   (YYYY-MM-DD string compare)
  // && !!order.email
  // && balanceCents > 0
selectStatementRecipients(orders, paymentsByOrder, statementsByOrder, { today, cooldownHours = 24, cap = 50 })
  // returns { send: [...], skipped: {recent, noEmail, notOverdue, cancelled} }
```

- Bulk scans all orders, computes per-order balances from the live payments ledger, and skips any
  order with a `status='sent'` statement newer than `cooldownHours`. Cap protects Worker
  subrequest limits (one Resend call per order).
- "Overdue" intentionally **includes completed orders** (handed over but unpaid) and excludes
  cancelled — different from the dashboard reminder tiers by design.

## 3. Orders API (worker `orders/workers/api.js`)

### `POST /api/orders/:id/send-statement` (admin)
1. Load order + active payments; recompute eligibility and balance server-side.
2. 409 when not eligible (already paid / not overdue / cancelled), 400 when no email.
3. Generate `pay_token` if missing; build the statement email (section 4) with pay URL
   `https://muy-rico.com/pay-order.html?o=<id>&t=<token>`.
4. Send via Resend; insert `order_statements` row (`sent` or `failed`); append order event
   `statement:sent`.
5. Respond `{ ok, status, balanceCents, lastSentAt }`. Email failure → 502 with the failed row
   logged; safe to retry.

### `POST /api/orders/send-statements` (admin, bulk)
- Runs `selectStatementRecipients` and sends one statement per order.
- Respond `{ sent, skipped, failed, results: [{orderId, outcome}] }` so the UI can toast
  "Sent 3 · Skipped 1 (reminded today) · Failed 0".

### `GET /api/public/orders/:id/balance?t=<token>` (public)
- Token check (`t` equals `orders.pay_token`); 403 otherwise, even for valid order ids.
- Returns only what the pay page renders:
  `{ orderId, customerName, pickupDate, language, items, subtotalCents, discountCents,
     totalCents, paidCents, balanceCents, paid, payments: [{ date, amountCents, methodLabel }] }`
- `paid` true when balance is 0 (already paid page state). Items use existing `name_en/name_es`
  resolution. No notes, no contact details, no tokens echoed.

### `POST /api/orders/:id/balance-paid` (webhook-secret only)
- Body `{ amount_cents, method, sub_method?, ref }`.
- Idempotency: if a payment with this `ref` exists → `{ ok: true, already: true }` (200).
- Recompute balance; require `amount_cents === balanceCents` (400 + Telegram alert otherwise —
  mirrors the invoice `unexpected-amount` policy).
- Record the payment on the order ledger using existing createPayment semantics
  (`replace: false`, active row), re-derive `payment_status` via `payment-ledger-lib`, add order
  event `payment:balance_online`, and send the customer the updated paid confirmation (the same
   receipt renderer, now showing balance $0).
- Respond `{ ok, paymentStatus, balanceCents }`.

## 4. Statement email — extend `orders/workers/receipt-html.js` (pure)

Extend `buildReceiptHtml(order, isEn, opts)` with `opts = { payments, balanceCents, payUrl, mode }`:

- `mode='statement'` (balance > 0):
  - Title **BALANCE REMINDER / RECORDATORIO DE SALDO** (replaces RECEIPT/INVOICE).
  - Existing order meta + items + subtotal/discount/total (unchanged rows).
  - **Payments table**: each payment `date · method · amount` (uses `buildMethodLabel`).
  - Summary rows: **Paid to date** and a highlighted **Balance due**.
  - Note (bilingual): *"Our records show a balance of $X on your order from <pickup date>. If you
    already paid, just reply and we'll fix it right away."*
  - CTA button **"Pay $X" → payUrl**.
- `mode='receipt'` (paid, default for existing callers): unchanged title/wording; gains the same
  payments breakdown for transparency; no button.
- Language and item names follow `order.language` exactly like receipts today.

Sender: extend the existing customer-confirmation path with a statement options object
(`sendStatementEmail`) so Resend plumbing, from-address, and failure logging stay shared. The
statement send records an `order_statements` row instead of a `receipts` row.

## 5. Pay page — `pay-order.html` (new static page)

Modeled on `pay-invoice.html` (same design system, checkout worker calls, PayPal SDK usage):

- URL: `https://muy-rico.com/pay-order.html?o=<id>&t=<token>`.
- Shows: Muy Rico header, **Order #id — customer name**, pickup date, item summary, payments made,
  Total / Paid / **Balance due**.
- Pay controls: Stripe button (card / Apple Pay / Cash App Pay) for the exact balance; PayPal +
  Venmo Smart Buttons. Checkout worker verifies token + recomputes amount for every session.
- States: `ready` → `processing` → **"Payment received — thank you!"**; `already-paid` (balance 0)
  shows the paid state with no button; `balance-changed` (balance differs from what the page
  loaded) re-renders with the current amount and explains the refresh; invalid token / cancelled
  order → neutral contact message.
- Bilingual EN/ES toggle (like receipt HTML), mobile-first, `noindex` meta (private link).
- Success/cancel redirects return to the page; final status comes from
  re-fetching the public balance endpoint (same polling pattern as the invoice page).

## 6. Checkout worker (`workers/checkout.js`)

Mirrors the invoice handlers exactly, with an `order_balance` payment kind:

- `GET /order/:id/payable?t=` → proxies the orders API public balance endpoint.
- `POST /order/checkout` `{ id, token, origin }` → Stripe Checkout Session:
  `client_reference_id = o<id>:<token>`, `metadata[kind]=order_balance`, `metadata[order_id]`,
  `metadata[token]`; single line item "Muy Rico — Order #<id> Balance"; success/cancel URLs back
  to `pay-order.html`.
- `POST /order/paypal-capture` `{ id, token, paypalOrderId }` → verify captured amount equals the
  server-computed balance, then call `balance-paid` with the capture id as `ref`.
- Stripe webhook: branch on `metadata.kind === 'order_balance'` (existing branch pattern) →
  `markOrderBalancePaidViaApi(order_id, amount_total, 'stripe', ref = session.id)`.
- PayPal webhook: parse `o<id>:<token>` custom ids (new `parseOrderPayCustomId`, same shape as
  `parseInvoiceCustomId`) → capture event → `balance-paid` with the capture id.
- Failures and amount mismatches follow the existing `notifyDuplicateInvoicePayment` / Telegram
  alert pattern.

## 7. Admin UI (React dashboard + StoreContext/api client)

- **Order detail** (Orders.tsx payment section):
  - When balance > $0 and email present: **"Send balance statement"** button (prominent/red-tinted
    when the order is past pickup). Shows `Last reminder: <date>` when an
    `order_statements` row exists.
  - No email → button disabled with hint "Add an email to send a statement".
  - Resend within 24h → confirmation dialog ("Reminded 6 hours ago. Send again?").
- **Orders list**: banner when overdue balances exist —
  `"N overdue balances · $X — Remind all"` → confirm modal (count + total) → bulk call → result
  toast with sent/skipped/failed. Data comes from a selector over already-loaded orders +
  payments, reusing the existing `remainingBalanceCents` and `dueTier` helpers.
- API client additions: `sendOrderStatement`, `sendOverdueStatements`,
  `fetchOrderStatementInfo` (last sent) in `utils/api.ts`; passthroughs in `StoreContext`.

## 8. Error handling & edge cases

| Case | Behavior |
|---|---|
| No email on order | Single: disabled + hint. Bulk: skipped, counted in toast. |
| Resend money email fails | Statement row `failed`, 502, toast; retry allowed (only `sent` rows count for cooldown). |
| Balance changed between email and pay | Pay page re-fetches; checkout re-validates and rejects with "balance changed — refresh" (409) instead of charging stale amount. |
| Already paid before opening link | Pay page shows paid state; checkout returns 409 "already settled". |
| Double webhook / capture retry | `payments.ref` unique index + `already` response; no double record. |
| Order cancelled after send | Pay page shows not-payable message; bulk excludes cancelled. |
| Amount mismatch at webhook | Rejected + Telegram alert to owner; no ledger write. |
| Void/refund after online payment | Existing void/restore flows; balance recomputes from active payments. |
| Token leak concern | Tokens are 128-bit random and only expose that one order's balance breakdown. |

## 9. Security

- `pay_token`: 128-bit random, generated lazily, never exposed in list APIs.
- Public balance endpoint requires the token and returns read-only, minimal data.
- All writes (`balance-paid`) require the webhook secret; statement sends require admin auth
  (Cloudflare Access / device token), consistent with every other admin route.
- Charge amounts are always recomputed server-side from the ledger — client-supplied amounts are
  ignored.
- Bulk send capped per run (default 50) to stay inside Worker subrequest limits.

## 10. Testing

- **Pure lib** (`orders/tests/order-statements-lib.test.js`): balance math; eligibility matrix
  (cancelled / future pickup / paid / no email / completed-but-unpaid); bulk selection with 24h
  cooldown, cap, and skip buckets.
- **Receipt rendering** (extend `orders/tests/receipt-html.test.js`): statement mode shows payments
  rows, paid-to-date, balance due, CTA URL, EN/ES; receipt mode unchanged minus button; balance 0
  renders paid state.
- **API handlers** (new test files, existing fake-DB pattern): send-statement eligibility + token
  creation + failed-email logging; bulk counts/skips; `balance-paid` idempotency by ref, amount
  mismatch rejection, partial→paid derivation; public balance token gate.
- **Checkout worker**: changes mirror invoice handlers 1:1; verified end-to-end locally
  (`wrangler dev` + Playwright) — statement link → pay page → Stripe test payment → webhook →
  ledger, plus the paid-state reload.
- **Admin UI**: Playwright pass over single send (with/without email, cooldown dialog) and bulk
  banner flow against the local dev harness.

## 11. Deployment / rollout

1. Apply migration `0050_orders_quote_id.sql` (already pending), then
   `0051_order_balance_statements.sql`.
2. Deploy orders API worker (`npx wrangler deploy -c orders/wrangler.toml`).
3. Deploy checkout worker (`cd workers && npx wrangler deploy`).
4. Build + deploy assets (admin bundle + `pay-order.html`) via the documented
   `wrangler versions upload/deploy` flow.
5. No feature flag needed: endpoints are inert until the admin UI ships; the pay page only works
   for orders whose token has been generated by a statement send.

## 12. Out of scope (v1)

- Scheduled automatic sends (cron exists for a future opt-in).
- Partial online payments, SMS, PDF attachments, customer statement history page.
- Token rotation/revocation UI.
- Payment-plan installments.
