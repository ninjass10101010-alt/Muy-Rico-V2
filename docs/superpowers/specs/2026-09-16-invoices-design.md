# Invoices — customer-payable invoices with deposit/full options, PDF, and iPhone share — Design

**Date:** 2026-09-16
**Status:** Approved by owner (Approach A — standalone invoices mirroring the quote-deposit flow)
**Branch:** main (repo deploys from main per owner pattern)

## Problem

The bakery has no way to bill a customer outside the quote/order flow. Quotes cover custom-cake
inquiries that auto-convert on deposit, and receipts render as an "invoice" only *after* an order
exists. There is no first-class, payable document for work that starts as a bill: catering,
wholesale, deposits held without a quote, or any agreement the owner prices and sends directly.

Customers therefore pay by reply/phone coordination, and the owner has no professional document
to hand someone from the phone.

## Goals

1. The owner can **create a standalone invoice** for any customer with free-form line items.
2. The customer can **pay online** — by card (Stripe Checkout) or PayPal — choosing **in full** or
   **50% deposit** according to the options the owner enabled on that invoice.
3. A successful payment **auto-converts the invoice to an order** (reusing the quote conversion
   logic), records the payment, and notifies owner (Telegram) + customer (confirmation email).
4. The owner can **download a branded PDF** of any invoice, and **share a pay link** from the
   iPhone home-screen app (`/app/`) via the native iOS Share Sheet.
5. Sequential, professional invoice numbers (`INV-1001`, `INV-1002`…).

## Owner requirements (gathered)

- **Standalone invoices** — a new entity, not a view on quotes or orders.
- **Per-invoice payment options** chosen by the owner at create/edit time: **full only**,
  **deposit only**, or **both** (customer picks). Default `both` — matches today's quote page.
- **Download** as **both** printable HTML and a real PDF file.
- **Share** from the iPhone app = share a **link** to the pay page via the iOS Share Sheet.
- **Auto-convert to an order** on payment — no owner review step; payment = invoice settled.
- **Sequential `INV-####` numbers** shown to the customer.

## Non-goals

- No changes to the manual quote Convert flow or the existing quote deposit rails (additive only).
- No online collection of the remaining balance (still collected at pickup; possible follow-up).
- No automatic refunds — duplicate payments are flagged to the owner for manual refund, same
  policy as quotes.
- No tax handling. Cottage-food sales; a `tax_cents` column is trivially added later if ever needed.
- No recurring/scheduled invoices; no customer-facing invoice list portal (each invoice is reached
  only via its unguessable pay link).
- No Service Worker / offline support — the dashboard needs live data.

---

## 1. Data model — migration `orders/migrations/0047_invoices.sql`

Mirrors the `cake_quotes` / `0044_quote_deposit` conventions.

```sql
CREATE TABLE IF NOT EXISTS invoices (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  number             TEXT NOT NULL,                  -- 'INV-1001', set from id after insert
  status             TEXT NOT NULL DEFAULT 'draft',  -- 'draft' | 'sent' | 'converted' | 'void'
  customer_name      TEXT NOT NULL,
  email              TEXT NOT NULL,
  phone              TEXT,
  language           TEXT NOT NULL DEFAULT 'es',     -- 'en' | 'es' — drives doc + pay page + share text
  customer_id        TEXT,                           -- optional link to customers(id)
  issue_date         TEXT NOT NULL DEFAULT (datetime('now')),
  due_date           TEXT,
  payment_options    TEXT NOT NULL DEFAULT 'both',   -- 'full' | 'deposit' | 'both'
  total_cents        INTEGER NOT NULL DEFAULT 0,     -- sum of line items, store in cents
  notes              TEXT,                           -- customer-facing note
  admin_notes        TEXT,
  public_token       TEXT NOT NULL,                  -- 128-bit hex; makes pay links unguessable
  paid_cents         INTEGER NOT NULL DEFAULT 0,
  paid_at            TEXT,
  payment_method     TEXT,                           -- 'stripe' | 'paypal'
  payment_sub_method TEXT,                           -- JSON: card brand/last4, paypal wallet
  payment_ref        TEXT,                           -- Stripe Checkout Session id / PayPal capture id (idempotency key)
  converted_order_id INTEGER,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  created_by         TEXT NOT NULL DEFAULT 'jeff'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_public_token ON invoices(public_token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number        ON invoices(number);
CREATE INDEX IF NOT EXISTS idx_invoices_status    ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_created   ON invoices(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_customer  ON invoices(customer_id);

CREATE TABLE IF NOT EXISTS invoice_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id       INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description      TEXT NOT NULL,
  qty              INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
```

Notes:

- **Numbering**: insert the row, read `meta.last_row_id`, then
  `UPDATE invoices SET number = 'INV-' || printf('%04d', id + 1000) WHERE id = ?`. First invoice is
  `INV-1001`; gaps from voided/deleted invoices are normal for sequential invoice numbers. The
  UNIQUE index on `number` is the safety net.
- **`payment_options`** is the three-way per-invoice toggle (see §2 and §4 for enforcement).
- **Separate `invoice_items` table** (not a JSON blob): matches `cake_quote_items`, supports a clean
  per-line editor, and conversion serializes them into the order's `items_json` shape
  (`[{name, qty, price}]`).

## 2. Shared lib — `orders/workers/invoice-lib.js`

Pure, unit-tested functions (single source of truth), mirroring `quote-deposit-lib.js`:

- `depositCentsFor(totalCents)` → `Math.ceil(totalCents * 0.5)` — same 50% rule as quotes.
- `balanceCentsFor(totalCents, paidCents)` → `max(0, total - paid)`.
- `allowedPayModes(paymentOptions)` → the modes the customer may use:
  `'full'` → `['full']`; `'deposit'` → `['deposit']`; `'both'` → `['deposit','full']`.
  This is the server-side enforcer, called by both checkout routes and the pay page builder.
- `buildPayUrl(invoiceId, token)` → `https://muy-rico.com/pay-invoice.html?inv=${invoiceId}&t=${encodeURIComponent(token)}`.
- `encodeInvoiceCustomId(invoiceId, token)` → `i${invoiceId}:${token}`.
- `parseInvoiceCustomId(s)` → `{ id, token }` or `null` (regex `^i(\d+):([0-9a-f]{32})$`).
  The `i-` prefix is how the webhooks tell an invoice from a quote (`q-`).
- `generateInvoiceToken()` → 16 random bytes as hex, via `crypto.getRandomValues`.

## 3. Orders API — `orders/workers/api.js`

All endpoints funnel through the existing single auth gate (Access header → Access cookie → Bearer
device token), so one change covers them; the internal endpoints use the shared-secret header like
`mark-paid` does today.

**Admin (Access or device token):**

| Method + path | Purpose |
|---|---|
| `GET /api/invoices` | List; filter `?status=`, search `?q=` across number / customer_name / email |
| `POST /api/invoices` | Create invoice + items; optional `send: true` emails the doc immediately (status → `sent`) |
| `GET /api/invoices/:id` | Detail incl. items |
| `PATCH /api/invoices/:id` | Edit fields + total recompute; **locked once `converted`**; `void` invoices locked |
| `DELETE /api/invoices/:id` | Delete (`draft` only) |
| `POST /api/invoices/:id/items` | Add line item |
| `PATCH /api/invoices/:id/items/:itemId` | Edit line item |
| `DELETE /api/invoices/:id/items/:itemId` | Remove line item |
| `POST /api/invoices/:id/send` | Email the invoice document → status `sent` |
| `POST /api/invoices/:id/void` | Void (allowed from `draft`/`sent`) |
| `GET /api/invoices/:id/html` | Branded printable invoice HTML (admin-auth) |

**Internal (shared secret, called only by the checkout worker):**

| `GET /api/invoices/:id/payable?t=<token>` | Payable payload for the pay page |
| `POST /api/invoices/:id/paid` | Record payment + convert to order + notify |

`GET /api/invoices/:id/payable` steps (mirrors `/payable-deposit`):

1. Load invoice by id → `404` if missing.
2. Token missing or `!== public_token` → `403 { error: 'Invalid token' }`.
3. `status === 'void'` or `status === 'converted'` → `409` (pay page shows the settled state).
4. Respond:
```json
{
  "ok": true,
  "id": 7,
  "number": "INV-1007",
  "customer_name": "Maria Lopez",
  "total_cents": 18000,
  "deposit_cents": 9000,
  "balance_cents": 9000,
  "payment_options": "both",
  "language": "es",
  "status": "sent",
  "paid": false,
  "items": [{ "description": "Tres leches — 10\"", "qty": 1, "unit_price_cents": 18000 }]
}
```
`deposit_cents` / `balance_cents` are recomputed from the **current** `total_cents` on every
request, so editing the total after sending still charges the correct amount.

`POST /api/invoices/:id/paid` body: `{ token, method, sub_method?, ref, amount_cents }`.
Steps, in order: token check → idempotency on `payment_ref` (return `409` if already recorded) →
transactional convert (§5) → fire-and-forget notifications.

## 4. Checkout worker — `workers/checkout.js`

New routes, structurally identical to the quote ones so behavior transfers:

| Method + path | Purpose |
|---|---|
| `GET /invoice/:id/payable?t=` | Proxy to the internal payable endpoint (CORS-open, like `/quote/:id/payable`) |
| `POST /invoice/checkout` | Create a Stripe Checkout Session |
| `POST /invoice/paypal-capture` | Verify + capture a PayPal order |

`POST /invoice/checkout` (mirrors `handleQuoteDepositCheckout`):

- Validates `mode` against `allowedPayModes(payment_options)` — a `full` invoice rejects
  `mode:'deposit'` and vice versa. **The amount charged is always one the admin authorized.**
- `line_items[0]` price_data name: `Muy Rico — INV-1007 Full Payment` or `… Deposit (50%)`.
- `client_reference_id = i<id>:<token>`, `metadata[kind]="invoice"`, `metadata[invoice_id]`,
  `metadata[token]`, `metadata[mode]`, success/cancel URLs back to `pay-invoice.html`.

Webhook dispatch — `handleStripeWebhook` and `handlePayPalWebhook` each gain a branch: when
`metadata.kind === 'invoice'` (Stripe) or the `custom_id` parses as an invoice custom-id (PayPal),
call `markInvoicePaid(env, { id, token, method, subMethod, ref, amountCents })` instead of the
order/quote path. Same 404/409-are-final semantics as `markQuoteDepositPaid`.

`POST /invoice/paypal-capture` verifies the PayPal order amount **and** `custom_id` against D1
before capturing (amount-mismatch and quote/invoice mismatch both rejected pre-capture).

## 5. Conversion — `convertInvoiceToOrder`

Mirrors `convertQuoteToOrder`:

1. Fetch items, serialize to order `items_json` `[{ name: description, qty, price: unit_price_cents }]`.
2. Insert order: `status 'pending'`, `source 'website'`, `total_cents` from the invoice,
   `created_by` from actor, `order:created` event.
3. Insert the payments row with `method_details` (same insert shape `markOrderPaid` uses) so online
   payments record card brand/last4 or PayPal wallet.
4. Invoice → `status 'converted'`, `converted_order_id`, `paid_cents`, `paid_at`,
   `payment_method`, `payment_sub_method`, `payment_ref`.
5. Order `payment_status`: `'paid'` when `paid_cents >= total_cents`, else `'partial'`.
6. Fire-and-forget: owner Telegram ping + customer confirmation email.

The whole conversion runs inside one D1 batch/transaction so an invoice can never be marked paid
without its order existing.

## 6. Customer pay page — `pay-invoice.html`

A focused clone of `pay-quote.html` (same structure, styling, states, and i18n object shape):

- Loads the payable payload from `${WORKER}/invoice/${ID}/payable?t=${TOKEN}`.
- Renders `number`, customer greeting, items table, totals.
- Pay controls driven by `payment_options`:
  - `both` → radio group "Pay 50% deposit · $X" / "Pay in full · $Y" (exactly the quote page UX).
  - `full` or `deposit` → single button with the correct amount; no radio group rendered.
- Card → `POST ${WORKER}/invoice/checkout` → redirect to Stripe.
- PayPal → SDK buttons with `custom_id = i<id>:<token>`, `onApprove` →
  `POST ${WORKER}/invoice/paypal-capture`.
- States: `loading` / `invalid` (bad or missing token) / `already` (settled) / `confirming` +
  polling loop / `confirm-timeout` ("still confirming — email coming") / `success` / `pay-error`.
- Bilingual EN/ES via the lang bar, defaulting from `invoice.language`.
- Deliberate difference from quotes: no "reply to this email" CTA — invoices are payable
  documents, so the only CTA is the pay button.

## 7. Invoice document (HTML) — `orders/workers/invoice-html.js`

New module (mirrors `receipt-html.js`), exporting `buildInvoiceDocumentHtml(invoice, items, isEn)`
plus `invoiceEmailMeta(...)` for subject + plain-text part. Used both as the **email body** on Send
and the **`/api/invoices/:id/html`** view (admin-authenticated, printable).

- Branded and bilingual from `invoice.language`; editorial styling matching the site
  (cream `#FAF6EC`, forest `#1E4636`, hairline rules, no gradients).
- Header: business name + Holland, MI; `INVOICE` wordmark; `number`, issue date, due date.
- Bill-to block (name, email, phone).
- Line-items table + totals; when `payment_options !== 'full'`, the
  "Deposit due (50%) / Balance at pickup" breakdown.
- When unpaid and payable, the green **Pay** button → `buildPayUrl(...)`; when settled, the payment
  method label (reusing the `buildMethodLabel` approach from `receipt-html.js`) + reference.

## 8. Branded PDF — `home-bakery-management-system/src/utils/invoicePdf.ts`

Uses the already-bundled **pdf-lib** + `@pdf-lib/fontkit` and the brand fonts, following the
`labelExport.ts` / `labelRasterPdf.ts` pattern. **Zero new dependencies.**

- `buildInvoicePdf(invoice, items): Promise<Uint8Array>` → Letter page, vector text.
- Design matches the Editorial Panadería system: cream background, forest `#1E4636` headings,
  hairline rules, no gradients.
- **Typographic wordmark** — "Muy Rico" in Cormorant Garamond + "Authentic Mexican Bakery ·
  Holland, MI" in Quicksand — rather than embedding the `.webp` logo (pdf-lib embeds JPG/PNG only;
  a type-led mark is more on-brand for this design system).
- Line-items table (description / qty / unit price / amount), totals block, and — when
  `payment_options !== 'full'` — the deposit/balance breakdown.
- Caller turns the bytes into a Blob and downloads via an anchor; runs identically on `/app/`
  (iPhone) and `/admin/` (desktop), with no worker CPU cost.

## 9. iPhone share — Web Share API

From the Invoices page row actions / detail (works in the `/app/` standalone PWA and `/admin/`):

```js
if (navigator.share) {
  await navigator.share({
    title: `Muy Rico — ${invoice.number}`,
    text: invoice.language === 'es'
      ? `Tu factura ${invoice.number}. Paga en línea:`
      : `Your invoice ${invoice.number}. Pay online:`,
    url: buildPayUrl(invoice.id, invoice.public_token),
  });
} else {
  // Fallback: copy the pay link + toast; plus a mailto: option
}
```

- Native iOS Share Sheet from the standalone app → Messages / Mail / WhatsApp.
- **Fallback** where `navigator.share` is absent: copy the pay link to clipboard with a
  "Link copied" toast, plus a `mailto:` option — sharing never dead-ends.
- Share and Download sit side-by-side in the row actions, so from the phone the owner can either
  hand someone a link or save the PDF.

## 10. Dashboard (SPA) — `home-bakery-management-system/src/`

- `types.ts`: `InvoiceStatus = 'draft'|'sent'|'converted'|'void'`;
  `PaymentOptions = 'full'|'deposit'|'both'`; `InvoiceItem` and `Invoice` interfaces.
- `App.tsx`: register `Page` type `"invoices"`, render `Invoices`.
- `components/Sidebar.tsx`: nav entry with a `FileText` icon (both `/admin/` and `/app/`).
- `pages/Invoices.tsx`: list (number, customer, total, status badge, payment-options chip, created
  date), search + status filter; row actions Share / Download PDF / Open / Void; detail view with
  items, status timeline, payment record.
- `components/InvoiceModal.tsx`: create/edit — customer picker against the `customers` table
  (with match/merge) or free-text name/email/phone, language EN/ES, `payment_options` segmented
  control (Full only / Deposit only / Customer chooses), optional due date, notes.
- `components/InvoiceItemComposer.tsx`: line-item editor (description / qty / unit price) with
  live line totals + grand total.
- `utils/api.ts`: invoice CRUD client mirroring the quote client; `invoicePdf.ts` as above.
- `context/StoreContext.tsx`: load invoices into the shared store like quotes.
- `pages/Dashboard.tsx`: new **"Invoices outstanding"** stat (count of `sent` + unpaid), linking to
  the page.

## 11. Notifications

Reuse the existing Telegram + email machinery:

- **On Send** → customer email with the invoice document HTML + Pay button (bilingual).
- **On payment** → owner Telegram ping (`notifyInvoicePaid`, mirroring `notifyQuoteConverted`) +
  customer confirmation email (mirroring the quote deposit confirmation).

## 12. Error handling & edge cases

- **Idempotency**: `payment_ref` (Stripe session id / PayPal capture id) is the dedup key — a
  replayed webhook hits `409` and never double-converts. Same for the `POST .../paid` internal
  endpoint.
- **Voided / converted** invoices return `409` from `payable`, so the pay page shows the settled
  state and no payment can be taken.
- **Amount mismatch** (PayPal) and **custom_id mismatch** → rejected **before** any capture.
- **Mode enforcement**: checkout routes reject any `mode` outside `allowedPayModes(payment_options)`.
- **Edit guards**: `PATCH`/delete locked once `converted`; delete only allowed for `draft`.
- Pay-page states and the "still confirming" timeout fallback identical to quotes.
- **Duplicate payments** flagged to the owner for manual refund (no auto-refunds — same as quotes).

## 13. Testing

Matching the existing `orders/tests/` + `*.test.ts(x)` suites:

- `orders/tests/invoice-lib.test.js` — deposit math, custom-id parse/reject, `allowedPayModes`
  enforcement matrix.
- `orders/tests/invoice-html.test.js` — document rendering + pay-button presence logic per
  `payment_options` and per status.
- `orders/tests/invoice-pdf.test.js` — PDF bytes well-formed; `number`, totals, and item text
  present in extracted text.
- Worker tests for `payable` / `paid` (token, idempotency, void/converted `409`) and the new
  webhook dispatch branch (invoice vs quote, both providers).
- SPA tests: `Invoices` page create/list, `InvoiceModal` validation, and the share fallback to
  clipboard when `navigator.share` is absent.

## 14. Phasing & rollout

Repo deploys from main; the same built bundle serves `/admin/` and `/app/` via `postbuild.sh`.

1. Migration `0047` (local + remote) + `invoice-lib` + API endpoints + lib/worker tests.
2. Checkout worker (`/invoice/*` routes + webhook branches) + `pay-invoice.html`.
3. SPA Invoices page + `invoicePdf.ts` + share (rebuild SPA → `postbuild.sh` copies the bundle to
   `admin/index.html` and `app/index.html`).
4. Notifications + Dashboard "Invoices outstanding" widget + full deploy (redeploy the `muyrico`
   assets worker, `muy-rico-orders-api`, and the checkout worker).

## Security considerations

- Pay links carry a 128-bit random `public_token`; invoice ids are sequential and never used alone.
- The `payable` endpoint rejects on missing/mismatched token (`403`) and on settled invoices (`409`).
- All payment creation is server-side and amount-verified against D1 before capture; the client can
  only request a mode the admin authorized.
- Invoice documents (`/html`) are admin-authenticated; customers reach payment only through the
  tokenized pay page.
- Bearer device tokens are only ever sent over HTTPS; the auth gate resolution order
  (Access header → Access cookie → device token) is unchanged.
