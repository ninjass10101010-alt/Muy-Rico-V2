# Quote Deposit Payment — 50% Online Deposit from Quote Emails — Design

**Date:** 2026-09-03
**Status:** Approved by owner (Option A — hosted pay page, Stripe + PayPal), pending spec review
**Branch:** main (repo deploys from main per owner pattern)

## Problem

The priced quote email shows the customer "Total / Deposit (50%) / Balance at pickup" but offers no way to pay the deposit — the only call to action is "reply to this email or call us and we will set up your deposit." Customers must therefore pay by reply/manual coordination, costing time and bookings.

## Goals

1. Every priced quote email includes a working **Pay 50% Deposit** button.
2. The button opens a branded, bilingual pay page offering **card (Stripe Checkout)** and **PayPal** — the same rails as `order.html`.
3. A successful deposit payment **auto-converts the quote to an order** (reusing the existing conversion logic), records the payment, and notifies owner (Telegram) + customer (confirmation email).
4. Manual flows (cash/Venmo/CashApp via the dashboard Convert button) remain untouched.

## Owner requirements (gathered)

- **Auto-convert to order** on successful deposit payment — no owner review step; deposit = date secured.
- **Stripe + PayPal** payment methods on the deposit page.
- **Always include** the deposit payment option in priced quote emails — no per-send toggle.

## Non-goals

- No changes to the manual Convert flow (offline payments work exactly as today).
- No online collection of the remaining balance (still collected at pickup; possible follow-up).
- No automatic refunds — duplicate payments are flagged to the owner for manual refund.
- No admin dashboard UI changes (auto-converted quotes use the existing `converted` state/display).
- No new secrets or payment-provider dashboard changes (existing Stripe/PayPal webhook endpoints, `PAYMENT_WEBHOOK_SECRET`, and the `ORDERS_API` service binding are reused).

---

## 1. Migration — `orders/migrations/0044_quote_deposit.sql`

```sql
ALTER TABLE cake_quotes ADD COLUMN public_token TEXT;
ALTER TABLE cake_quotes ADD COLUMN deposit_paid_cents INTEGER;
ALTER TABLE cake_quotes ADD COLUMN deposit_paid_at TEXT;
ALTER TABLE cake_quotes ADD COLUMN deposit_method TEXT;
ALTER TABLE cake_quotes ADD COLUMN deposit_ref TEXT;
UPDATE cake_quotes SET public_token = lower(hex(randomblob(16))) WHERE public_token IS NULL;
CREATE UNIQUE INDEX idx_cake_quotes_public_token ON cake_quotes(public_token);
```

- `public_token`: 128-bit random hex making pay links unguessable (quote ids are sequential).
- `deposit_ref`: Stripe Checkout Session id or PayPal capture id — the idempotency key.
- Column naming/order follows existing migration conventions (e.g. `0040_quote_inspiration.sql`).

## 2. Orders API (`orders/workers/api.js`)

### 2a. Quote fields + token generation

- Append `public_token`, `deposit_paid_cents`, `deposit_paid_at`, `deposit_method`, `deposit_ref` to `QUOTE_FIELDS` (all SELECTs of this list then include them).
- In `createQuote`, generate the token at insert time:
  `[...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,'0')).join('')` and add it to the INSERT column list/binds. Website- and admin-created quotes both get tokens automatically.

### 2b. Fix the admin-created quote email row (scan finding)

`createQuote` builds an inline synthetic `quoteRow` object for the admin-created priced-email send (`sendQuoteAutoReply(..., includePrice=true)`). It does **not** read back `QUOTE_FIELDS`, so the token must be added to this literal object (`public_token: <generated token>`), or the deposit button is missing from admin-sent quotes.

### 2c. New shared lib — `orders/workers/quote-deposit-lib.js`

Pure functions (single source of truth, unit-tested):

- `depositCentsFor(quotedPriceCents)` → `Math.ceil(quotedPriceCents * 0.5)` — matches the existing email breakdown (`buildQuoteDocumentHtml`).
- `isDepositSufficient(paidCents, quotedPriceCents)` → `paidCents >= depositCentsFor(quotedPriceCents)`.
- `buildPayUrl(quoteId, token)` → `https://muy-rico.com/pay-quote.html?quote=${quoteId}&t=${encodeURIComponent(token)}`.
- `encodeQuoteCustomId(quoteId, token)` → `q${quoteId}:${token}`.
- `parseQuoteCustomId(s)` → `{ id, token }` or `null` (regex `^q(\d+):([0-9a-f]{32})$`; rejects order-style numeric ids and garbage).

### 2d. Email template button (`buildQuoteDocumentHtml`)

In the priced branch (`quoted_price != null`), when `quote.public_token` is present, render directly after the price table:

```html
<a href="{payUrl}" style="display:block;background:#2d7a46;color:#fff;text-align:center;
   padding:14px;border-radius:8px;font-size:16px;font-weight:600;text-decoration:none;margin:16px 0 4px;">
  {isEn ? `Pay 50% Deposit — $X.XX` : `Pagar depósito (50%) — $X.XX`}
</a>
```

And change `proceedLine` to reflect the new option:
- EN: `Pay your deposit online above to secure your date — or reply to this email / call us and we'll set it up for you.`
- ES: `Paga tu depósito en línea arriba para apartar tu fecha — o responde a este correo / llámanos y con gusto te ayudamos.`

No button when `quoted_price == null` (ack email) or token missing. The printable HTML (`getQuoteDocumentHtml`) reuses the same builder, so it gets the same button — harmless and useful.

### 2e. Extract shared conversion — `convertQuoteToOrder`

Extract the body of `convertQuote` after its input validation into:

```js
async function convertQuoteToOrder({ env, id, quote, depositCents, method, actor })
// → { orderId, paymentStatus }
```

Contains unchanged: items fetch, flavor note, order notes, single-line order insert (`status 'pending'`, `source 'website'`), payments row insert, `order:created` event, quote → `converted` + `converted_order_id` update. The HTTP `convertQuote` handler keeps its own guards (already-converted, price set, min deposit, ALLOWED_PAYMENT) then calls it — zero behavior change for the manual flow.

### 2f. New internal endpoint — `GET /api/quotes/:id/payable-deposit?t=<token>`

Called by the checkout worker (shared-secret header, see auth below). Steps:

1. Load quote by id → 404 if missing.
2. Token missing or !== `public_token` → 403 `{ error: 'Invalid token' }`.
3. Respond:

```json
{
  "ok": true,
  "id": 123,
  "customer_name": "Maria Lopez",
  "total_cents": 18000,
  "deposit_cents": 9000,
  "balance_cents": 9000,
  "language": "es",
  "status": "replied",
  "deposit_paid": false,
  "deposit_paid_at": null,
  "items": [{ "name": "Custom Cake — Vainilla", "qty": 1 }]
}
```

- `deposit_paid` = `deposit_paid_at != null`. Items via existing `getQuoteItems` + `quoteItemDisplayName`/`quoteItemQty`.
- `deposit_cents`/`balance_cents` recomputed from the **current** `quoted_price` on every request, so editing the price after sending the email still charges the correct amount.
- If `quoted_price == null` → 409 `{ error: 'Quote not yet priced' }`.

### 2g. New internal endpoint — `POST /api/quotes/:id/deposit-paid`

Body: `{ token, method, sub_method?, ref, amount_cents }`. Steps, in order:

1. Shared-secret check: `X-Webhook-Secret` header must equal `env.PAYMENT_WEBHOOK_SECRET` — reuse the exact comparison pattern used by `markOrderPaid`.
2. Load quote → 404. Token mismatch → 403.
3. **Idempotency:** if `deposit_ref` is already set:
   - Same `ref` → 200 `{ ok: true, already: true, order_id }` (webhook replay; no-op).
   - Different `ref` → genuine duplicate payment: fire Telegram alert `"⚠️ Duplicate deposit payment on Quote #id (ref …) — refund needed"`, return 200 `{ ok: true, duplicate: true }`. No conversion, no field overwrite.
4. **Already converted** (e.g. owner manually converted to cash before the customer paid): record the deposit fields for the paper trail, fire the same refund-needed Telegram alert, return 200 `{ ok: true, duplicate: true, reason: 'already_converted' }`.
5. `quoted_price == null` → 422 `{ error: 'Quote not priced' }`.
6. `method` must be in `ALLOWED_PAYMENT` → 400.
7. `isDepositSufficient(amount_cents, quoted_price)` false → 400 `{ error: 'Deposit amount below 50% minimum' }`.
8. UPDATE deposit fields: `deposit_paid_cents = amount_cents`, `deposit_paid_at = datetime('now')`, `deposit_method = method`, `deposit_ref = ref`.
9. `await convertQuoteToOrder({ env, id, quote, depositCents: amount_cents, method, actor: 'online-deposit' })` → `{ orderId, paymentStatus }` (`partial` for 50%, `paid` if a full-price payment arrives).
10. `ctx.waitUntil(notifyQuoteConverted(env, id, quote.customer_name, orderId, amount_cents, quote.quoted_price, method))` — existing Telegram ping.
11. `ctx.waitUntil(sendDepositConfirmationEmail(env, quote, orderId, amount_cents))` — see §2i.
12. Return `{ ok: true, order_id }`.

### 2h. Routing + auth bypass (scan finding)

- Route regexes registered alongside the other quote routes:
  `^\/api\/quotes\/(\d+)\/payable-deposit$` (GET) and `^\/api\/quotes\/(\d+)\/deposit-paid$` (POST).
- Both must be added to the public-bypass condition list (`isPublicMarkPaid`-style: `isPublicQuoteDepositGet`, `isPublicQuoteDepositPaid`) — otherwise Cloudflare Access returns 401 before the handlers' own shared-secret check runs. Both endpoints remain protected by the shared secret and/or link token.

### 2i. Customer confirmation email — `sendDepositConfirmationEmail(env, quote, orderId, depositCents)`

Bilingual by `quote.language`, same visual shell as the quote document (logo header, cream/green palette, footer):

- Subject ES: `¡Depósito recibido! Pedido #${orderId} confirmado — Muy Rico Bakery`; EN: `Deposit received! Order #${orderId} confirmed — Muy Rico Bakery`.
- Body: greeting, summary rows — deposit paid `$X.XX`, balance due at pickup `$Y.YY`, pickup date (`desired_date`, shown if present), "we'll reach out to confirm final details / te contactaremos para confirmar los detalles", standard footer + cottage-law disclaimer line.
- Sent via Resend exactly like `sendQuoteAutoReply`; failure logged, never throws.

## 3. Checkout worker (`workers/checkout.js`)

Workers don't share code, so the two tiny helpers from `quote-deposit-lib.js` (`encodeQuoteCustomId`, `parseQuoteCustomId`) are re-declared inline here — same one-line implementations, kept in sync by their shared spec definition and unit tests on the orders side.

### 3a. `GET /quote/:id/payable?t=<token>` (public)

Thin proxy: `ordersApiFetch(env, `/api/quotes/${id}/payable-deposit?t=${encodeURIComponent(token)}`)`, pass through status + JSON. Existing global CORS (`Access-Control-Allow-Origin: *`) already covers the static pay page.

### 3b. `POST /quote-deposit/checkout` (public)

Body `{ id, token, origin? }`:

1. Fetch payable-deposit via `ordersApiFetch`; non-200 → forward status/error. If `deposit_paid` or `status === 'converted'` → 409 `{ error: "Deposit already paid" }`.
2. Create Stripe Checkout Session (form-encoded, same as `handleCreateCheckout`):
   - `line_items[0][price_data][unit_amount] = deposit_cents`, name `Muy Rico — Quote #${id} Deposit (50%)`.
   - `metadata[kind]=quote_deposit`, `metadata[quote_id]=id`, `metadata[token]=token`; `client_reference_id = q${id}`.
   - `success_url = ${origin || 'https://muy-rico.com'}/pay-quote.html?quote=${id}&t=${token}&paid=stripe`; `cancel_url` same without `paid`.
3. Return `{ url: session.url }`.

### 3c. `POST /quote-deposit/paypal-capture` (public)

Body `{ id, token, paypalOrderId }` — mirrors `handlePayPalCapture`:

1. Payable check as 3b (incl. 409 when already paid).
2. Fetch PayPal order; verify **both** `purchase_units[0].amount.value` == `deposit_cents` (cent-exact) **and** `custom_id === encodeQuoteCustomId(id, token)` (exact string match — stronger than the order flow’s numeric compare).
3. Capture; require `COMPLETED` else 400.
4. `markQuoteDepositPaid(...)` with `method='paypal'`, `sub_method` from `extractPayPalSubMethod`, `ref` = capture id, `amount_cents` = captured cents.
5. Return `{ ok: true }`.

### 3d. Stripe webhook branch

Inside the existing `checkout.session.completed` handling in `handleStripeWebhook`, before the order logic:

```js
if (obj.metadata && obj.metadata.kind === 'quote_deposit') {
  const subMethod = await extractStripeSubMethod(event, obj, env);
  const ok = await markQuoteDepositPaid(env, {
    id: obj.metadata.quote_id, token: obj.metadata.token,
    method: 'stripe', subMethod, ref: obj.id, amountCents: obj.amount_total,
  });
  return ok ? json({ received: true }) : json({ error: 'deposit-paid failed' }, 500);
}
```

`payment_intent.succeeded` is ignored for deposits (checkout sessions only).

### 3e. PayPal webhook branch

In `handlePayPalWebhook`, when the extracted custom id parses via `parseQuoteCustomId`, route to `markQuoteDepositPaid` instead of `markOrderPaidViaApi` (ref = capture id, amount = resource amount). Extend the existing order-fetch used by `extractPayPalWebhookSubMethod` to also return the PayPal order's `custom_id` (one API call, reused). This covers the disconnect-before-capture-confirm edge.

### 3f. `markQuoteDepositPaid(env, { id, token, method, subMethod, ref, amountCents })`

`ordersApiFetch` POST `/api/quotes/${id}/deposit-paid` with the JSON body. Mirrors `markOrderPaidViaApi` semantics: 404/409 → log + treat as final (return true, no retry storm); other non-2xx → false so the webhook 500s and Stripe/PayPal retry.

## 4. Pay page — `pay-quote.html` (new, site root)

Static page in house style (inline `<style>`, cream `#faf7f2` background, green `#2d7a46` accents, logo `muy_rico_logo_transparent.webp`, system sans font — consistent with the checkout worker's success/cancel pages). Worker base constant `https://muy-rico-checkout.bexgarcia0208.workers.dev` (same as `order.html`).

**Load:** parse `?quote` + `?t` → `GET /quote/{id}/payable?t=…` → render one of:

| State | Condition | UI |
|---|---|---|
| Invalid / unavailable | missing params, 403/404, 409 (not priced), or `status === 'archived'` | "This link is invalid or no longer active / Este enlace no es válido o ya no está activo" |
| Already handled | `deposit_paid` \|\| `status === 'converted'` | "Deposit already received — thank you! / Depósito ya recibido — ¡gracias!" |
| Confirming | `?paid=stripe` present | "Confirming your payment…" + poll payable every 2.5s (max ~30s) → success state when `deposit_paid`; on timeout: "Payment received — you'll get a confirmation email shortly." |
| Payable | otherwise | Summary + buttons (below) |

**Payable view:** greeting (`Hi {name}` / `Hola {name}`), "Quote #N", items list (name × qty), price rows (Total / Deposit due now / Balance at pickup), then:

- **Pay by card** button → `POST /quote-deposit/checkout { id, token, origin: location.origin }` → `window.location = url`.
- **PayPal buttons**: inject SDK `https://www.paypal.com/sdk/js?client-id=${clientId}&currency=USD` (client id from existing `GET /paypal-client-id`); `createOrder` uses `amount.value = (deposit_cents/100).toFixed(2)` and `custom_id = q${id}:${token}`; `onApprove` → `POST /quote-deposit/paypal-capture` → success state; `onError` → inline error message.

**Language:** default from the payable response's `language`; EN/ES toggle buttons (same pattern as the printable quote header). Strings live in one small dict object.

## 5. Edge cases

| Case | Handling |
|---|---|
| Customer opens link days later | Works — links never expire; amounts fetched live |
| Price edited after email sent | Deposit computed from current `quoted_price` at payment time |
| Webhook replay / double-submit | `deposit_ref` idempotency → `already: true` no-op |
| Two sessions both paid | Second payment → duplicate path: Telegram "refund needed" alert, no double conversion, fields preserved |
| Manual cash convert races online payment | `already_converted` path: recorded + refund alert, no double order |
| Deposit < 50% (tampered) | 400 rejected before any write |
| Quote archived after email | payable returns status → pay page shows not-payable state (no payment possible) |
| Email re-sent | Same token/link; still valid |

## 6. Testing

**Unit** — `orders/tests/quote-deposit-lib.test.js` (vitest, matching existing `*-lib.test.js` style):

- `depositCentsFor`: `18000→9000`, `9999→5000` (rounds up), `1→1`, `0→0`.
- `isDepositSufficient` boundary: exactly-half true, one cent under false.
- `encode/parseQuoteCustomId` round-trip; `parse` rejects `''`, `'q12'`, `'x12:…'`, `'q12:xyz'`, numeric order ids.
- `buildPayUrl` shape + token encoding.

Run: `cd orders && npx vitest run` (with the existing suites).

**Manual E2E (production, on a real small quote):**

1. Apply migration 0044; deploy orders API, checkout worker, static site.
2. Admin: create a priced test quote → auto-sent priced email contains the deposit button.
3. Open link in incognito → summary + both payment options render (EN/ES toggle).
4. Tamper `t` param → invalid-link state.
5. Card: pay → redirect back → confirming → success; verify dashboard order (partial, 50% payment row), Telegram ping, confirmation email; revisit link → "already received".
6. PayPal: second test quote, full button flow → same verifications.
7. Cash regression: third quote → manual Convert with cash → works as before.
8. Re-send email; link still works.

## 7. Deploy order (per `orders/DEPLOY.md`)

1. `npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0044_quote_deposit.sql`
2. `npx wrangler deploy -c orders/wrangler.toml`
3. `cd workers && npx wrangler deploy`
4. `npx wrangler versions upload --name muyrico --assets . --compatibility-date 2025-03-21` → `npx wrangler versions deploy --name muyrico <VERSION_ID>@100%`

No new secrets; no Stripe/PayPal dashboard changes.

## Explicitly deferred

- Refunding duplicates automatically, balance payment links, deposit percentage configurability, link expiry/revocation, per-send opt-out toggle.
