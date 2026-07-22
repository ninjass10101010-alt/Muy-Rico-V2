# Pay-First Checkout — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to create an implementation plan from this spec. The plan produces tasks with checkbox `- [ ]` steps.

**Goal:** Replace the current "order first, pay later" checkout flow with an Amazon-style "fill info, pay directly, order only exists after payment" flow. Customers must pay before an order is created as a real, actionable order. The owner is only notified of paid orders. A customer confirmation email is sent automatically on successful payment.

**Why this matters today:** Currently `order.html` POSTs the order to D1 with `payment_status: 'unpaid'`, then shows a payment panel with Stripe (redirect) and PayPal buttons. If the customer closes the tab without paying, an unpaid order is sent to the owner via Telegram/Resend — and the customer may believe they paid. There is no customer-facing confirmation email.

**Scope (in this plan):**

- Redesign the checkout page flow: Cart → Info → Payment (inline) → Confirmation.
- Create order with `status='awaiting_payment'`; auto-expire after 24h via Workers cron.
- Add `email` and `language` columns to the orders table so the email field is actually saved and bilingual confirmation emails are possible.
- Stripe Payment Element (inline card fields, no redirect off-site).
- PayPal server-side capture (more reliable than client-side capture).
- Customer confirmation email via existing Resend integration.
- Owner notifications fire at payment time, not order-creation time.
- Dashboard default view hides `awaiting_payment` orders; optional "Abandoned" filter.
- All amounts pulled server-side from D1 (tamper-proof).

**Out of scope:**

- Refund handling — unchanged, handled via Stripe/PayPal dashboards or manual admin flow.
- Cash-at-pickup — removed entirely; every order is prepaid online. (Per user decision.)
- Inventory deduction on payment — unchanged; tied to status `completed`.
- Per-item line items in Stripe — keep lump-sum PaymentIntent (matching current behaviour).
- Revamping the admin label generation — labels already fire on order creation; for awaiting_payment orders they fire on mark-paid together with the notification.
- Surfacing `order_events` audit trail in dashboard UI.

**Tech Stack:** Static HTML/CSS/vanilla JS (order.html), Cloudflare Workers (muy-rico-orders-api, muy-rico-checkout), Cloudflare D1 (muy-rico-orders), Stripe Payment Element + PaymentIntents API, PayPal Orders v2 + Smart Buttons, Resend (email), GSAP (animations).

---

## Global Constraints

- **Amounts must come from D1, never from the browser.** The checkout worker reads the order total from the orders API (secret-gated endpoint) to create PaymentIntents and capture PayPal orders.
- **Webhooks remain the source of truth for mark-paid.** The browser never calls mark-paid directly. The frontend polls a read-only `/payment-status` endpoint.
- All new UI text is bilingual (es/en) using the existing `data-es`/`data-en` + `lang-fade` pattern.
- `order.html` remains a single-file vanilla JS page — no build step, no framework added to the marketing site.
- Old `/create-checkout` endpoint (Stripe redirect) is kept deployed but no longer called — instant rollback path.
- D1 writes happen only through the orders API Worker (single-writer principle). The checkout Worker calls the orders API via shared `X-Webhook-Secret`.
- **Service Binding required:** the checkout Worker reaches the orders API through a `[[services]]` binding (`ORDERS_API` → `muy-rico-orders-api`), NOT the public `workers.dev` URL. Cloudflare blocks Worker→Worker subrequests to `*.workers.dev` hostnames in the same account (error 1042). All internal calls go through `env.ORDERS_API.fetch(...)`.

---

## Architecture

```
order.html                                checkout worker                    orders-api worker
  ────                                     ──────                            ──────
  Cart → Info → "Continue to Payment"
  
  POST /api/orders                          ────────────────────────────────→  createOrder(status:'awaiting_payment')
    { email, language, status:'awaiting_payment' }                                ← { ok, id }
  
  GET  checkout-worker./stripe-config  ──→  { publishableKey }
  POST checkout-worker./create-payment-intent { orderId }
                                          ──→  GET orders-api./api/orders/:id/payable (X-Webhook-Secret)
                                                 ← { total_cents, status, email }
                                          ←──  PaymentIntent created (amount from D1)
                                            →  { clientSecret }
  
  Mount Stripe Payment Element (clientSecret)
  User clicks Pay → stripe.confirmPayment({redirect:'if_required'})
    *Inline* success (no 3DS) → poll /payment-status → confirmed screen
    *Redirect* (3DS required) → return to ?confirming=<id> → poll → confirmed
  
  OR: PayPal Smart Button onApprove
                                          ──→  POST /paypal/capture { paypalOrderId, orderId }
                                                 → verify payable amount (D1)
                                                 → PayPal capture API
                                                 → POST orders-api./mark-paid
    ← poll /payment-status → confirmed screen
  
  Stripe webhook payment_intent.succeeded
                                          ←──  Stripe POST /webhook/stripe
                                            →  markOrderPaidViaApi(orderId,'stripe')
  
  PayPal webhook CHECKOUT.ORDER.APPROVED / PAYMENT.CAPTURE.COMPLETED
                                          ←──  PayPal POST /webhook/paypal
                                            →  markOrderPaidViaApi(orderId,'paypal')
  
  markOrderPaid                                →  flip status awaiting_payment→pending + paid
                                                 →  owner notification (Telegram+Resend)
                                                 →  customer confirmation email (Resend)
  
  CRON (hourly)                                →  DELETE awaiting_payment >24h old
```

---

## Components

### 1. `order.html` — Checkout page redesign

**Steps tracker**: extend from 3 steps to 4: 🛍️ Elige/Choose → 📋 Tu Info/Your Info → 💳 Pago/Payment → ✅ Confirmado/Confirmed. The `updateSteps()` function increments.

**Form submission** (`handleOrder`, ~L1576): 
- Payload gains `email`, `language: currentLang`, `status: 'awaiting_payment'` (payment_method placeholder, overwritten by mark-paid).
- On success: hide form, show payment section, mount Stripe Payment Element + PayPal buttons.
- No longer fires `notifyOrderCreated` (skip in the API when status is awaiting_payment).

**Payment section** (replaces `#confirmation` panel, ~L899):
- Order summary (cart items read-only, total).
- Stripe Payment Element mount point + Pay button with loading/disabled states.
- PayPal Smart Button mount point (PayPal/Venmo).
- "Edit info" back link to go back to form.
- Inline bilingual error display for declined cards / PayPal failures.

**Stripe Payment Element lifecycle:**
1. Page load: include Stripe.js v3 via `<script src="https://js.stripe.com/v3/">`.
2. On entering payment step: fetch `/stripe-config` (publishable key) + `/create-payment-intent` (client secret).
3. `const stripe = Stripe(publishableKey); const elements = stripe.elements({clientSecret}); elements.create('payment').mount('#stripe-payment-element');`
4. Pay button click: `stripe.confirmPayment({elements, confirmParams: {return_url: location.origin + '/order.html?confirming=' + pendingOrderId + '&paid=true'}, redirect: 'if_required'})`.
   - Success on-page → poll payment status → confirmed screen.
   - 3DS redirect → return URL → page load detects `?confirming=<id>` → poll.
   - Error → inline error (card declined, insufficient funds, etc.), re-enable button.
5. Polling: `GET /api/orders/:id/payment-status` every 2s, max 30s. On `paid` → confirmed. On timeout → "Payment received — your confirmation email will arrive shortly" state.

**PayPal (unchanged SDK loading, changed onApprove):**
- `loadPayPal()` / `renderPayPal()` exist (~L1681-1731). Keep SDK loading.
- `onApprove`: POST `/paypal/capture` { paypalOrderId: details.orderID, orderId: pendingOrderId } → poll payment status → confirmed.
- `onError`: inline bilingual error.

**Confirmed screen** (new, replaces old success banner):
- Shows: order number, pickup date/time, customer name, items summary, total, "a confirmation email was sent to [email]".
- Clears cart, resets steps.
- Legacy `?paid=true` banner path kept as fallback but simplified.

**Removed code:**
- `FORMSPREE_URL` dead constant (L955).
- Old Stripe redirect button wiring (L1647-1679 — current `stripeBtn.onclick` that calls `/create-checkout` and does `window.location.href`).
- `payment_method: 'cash'` hardcode (L1613).

### 2. `orders/workers/api.js` — backend foundation

**New migration `0016_order_email_language.sql`:**
```sql
ALTER TABLE orders ADD COLUMN email TEXT;
ALTER TABLE orders ADD COLUMN language TEXT NOT NULL DEFAULT 'es';
```

**`ALLOWED_STATUS`** (L51): add `'awaiting_payment'`.

**`createOrder`** (L232):
- Accept `email` (trim, validate `@` presence) and `language` from body.
- Store both in INSERT.
- When `status === 'awaiting_payment'`: **skip** `notifyOrderCreated` (L281) and `generateLabelsForOrder` (L284). Labels fire on mark-paid instead.
- Payment method placeholder: accept `payment_method` as-is (will be 'stripe' or 'paypal' eventually but we don't know at creation — the frontend sends a placeholder that gets overwritten at mark-paid).

**`listOrders`** (L373):
- When no `status` query param is provided, add `status != 'awaiting_payment'` to the WHERE clause. Explicit `?status=awaiting_payment` still works (for dashboard "Abandoned" filter).

**`getStats`** (L502):
- Wrap the entire query in `WHERE status != 'awaiting_payment'` to exclude abandoned orders from all dashboard chips.

**`markOrderPaid`** (L436) — extended:
- **Signature change**: receives `ctx` parameter for `ctx.waitUntil()` calls (pass through from route dispatcher).
- On first payment transition (existing `alreadyPaid` guard):
  - If `order.status === 'awaiting_payment'`: UPDATE status to `'pending'`.
  - Fire `notifyOrderPaid(env, order, id)` — owner Telegram + Resend notification (similar to `notifyOrderCreated` but with "✅ Paid" label).
  - Call `sendCustomerConfirmation(env, order)` — Resend email to `order.email` with bilingual content driven by `order.language`.

**New endpoint `GET /api/orders/:id/payable`** (route dispatch L109 area):
- Gated by `X-Webhook-Secret` header (same as mark-paid).
- Returns `{ id, total_cents, status, payment_status, email, customer_name }`.
- Used by the checkout worker to get the authoritative order amount.

**New endpoint `GET /api/orders/:id/payment-status`** (route dispatch L109 area):
- Public (no Access, no secret). Returns only `{ payment_status, status }`.
- Used by the frontend for post-payment polling.
- Trade-off: order ID is enumerable but only payment_status/status are disclosed — low risk.

**`sendCustomerConfirmation(env, order)`** (new function, ~L370 area):
- `from`: `env.EMAIL_FROM || "orders@muy-rico.com"`.
- `to`: `order.email`.
- `subject` bilingual: "Order #X Confirmed — Muy Rico" / "Pedido #X Confirmado — Muy Rico".
- `html`: baked template with customer name, items, total, pickup date/time, contact info.
- Skips silently if `RESEND_API_KEY` or email is missing (logs warning).

**Cron `scheduled()` handler** (new export):
- Runs hourly: `DELETE FROM order_events WHERE order_id IN (SELECT id FROM orders WHERE status='awaiting_payment' AND created_at < datetime('now','-24 hours'))`
- Then: `DELETE FROM orders WHERE status='awaiting_payment' AND created_at < datetime('now','-24 hours')`
- (Order events deleted first due to FK constraint.)

### 3. `orders/wrangler.toml` — cron trigger

Add:
```toml
[triggers]
crons = ["0 * * * *"]
```

### 4. `workers/checkout.js` — payment orchestration

**New route `GET /stripe-config`:**
- Returns `{ publishableKey: env.STRIPE_PUBLISHABLE_KEY || "" }`.
- New non-secret var in `workers/wrangler.toml` `[vars]`: `STRIPE_PUBLISHABLE_KEY`.

**New route `POST /create-payment-intent`:**
- Body: `{ orderId }`.
- Calls `GET orders-api./api/orders/:id/payable` with `X-Webhook-Secret`.
- Validates: order exists, status is `awaiting_payment`, not already paid.
- Creates Stripe PaymentIntent:
  ```
  amount: total_cents,
  currency: 'usd',
  automatic_payment_methods: { enabled: true },
  metadata: { order_id: String(orderId), source: 'website' },
  receipt_email: email || undefined
  ```
- Returns `{ clientSecret }`.

**Webhook handler** (L84) — extended:
- Add handling for `payment_intent.succeeded` alongside existing `checkout.session.completed`.
- Extract `order_id` from `event.data.object.metadata.order_id` → `markOrderPaidViaApi(orderId, 'stripe')`.

**New route `POST /paypal/capture`:**
- Body: `{ paypalOrderId, orderId }`.
- Calls `GET orders-api./api/orders/:id/payable` → validate payable.
- Gets PayPal auth token (existing `paypalAuth`).
- Calls PayPal `POST /v2/checkout/orders/:paypalOrderId/capture`.
- Verifies captured amount matches D1 total (or >= within tolerance — accept the full PayPal capture).
- Calls `markOrderPaidViaApi(orderId, 'paypal')`.
- Returns `{ ok: true }`.

**Workers wrangler.toml changes:**
- New `[vars]`: `STRIPE_PUBLISHABLE_KEY` (public, safe in vars).

### 5. `home-bakery-management-system/src/` — Admin dashboard

**`types.ts:5`**: `OrderStatus` type adds `'awaiting_payment'`.
```ts
export type OrderStatus = "pending" | "in-progress" | "ready" | "completed" | "cancelled" | "awaiting_payment";
```

**`Orders.tsx`**:
- Add an "Abandoned" filter chip next to the existing status flow chips (it's not part of `STATUS_FLOW` since it's not a production status — it's a pre-order waiting room).
- The chip queries `?status=awaiting_payment` and displays a count if available.

### 6. `orders/` tests (vitest)

New `orders/package.json` with vitest devDep. Tests:

- **createOrder**: with `status='awaiting_payment'` → no notification + no label generation called.
- **createOrder**: with `status='pending'` → notification + labels fire (unchanged admin created orders).
- **listOrders**: default excludes `awaiting_payment`; explicit `?status=awaiting_payment` includes them.
- **getStats**: `awaiting_payment` orders don't appear in counts.
- **markOrderPaid**: flips `awaiting_payment` → `pending`, fires notification + customer email.
- **markOrderPaid**: already-paid orders return skipped, no duplicate emails.
- **payable endpoint**: returns correct total; missing secret → 401.
- **payment-status endpoint**: public; returns status.
- **scheduled**: deletes expired orders + events; fresh ones untouched.

---

## Data Flow (end-to-end)

```
1. Customer fills cart, enters info (name, email, phone, pickup date, notes), clicks "Continue to Payment"
2. POST /api/orders (public)
   Body: { customer_name, email, phone, pickup_date, items_json, total_cents,
           payment_method:'stripe', payment_status:'unpaid', status:'awaiting_payment',
           notes, source:'website', language:'es'|'en' }
   → D1 INSERT (notifications SKIPPED for awaiting_payment)
   ← { ok: true, id: 42 }   → frontend stores pendingOrderId = 42

3. Payment section shows:
   a) Stripe flow:
      - GET /stripe-config → publishableKey
      - POST /create-payment-intent { orderId: 42 }
        → checkout worker calls GET /api/orders/42/payable (secret-gated)
        → Stripe PaymentIntent created with amount from D1
      - PaymentElement mounted, customer enters card, clicks Pay
      - stripe.confirmPayment → success (inline) → poll GET /api/orders/42/payment-status
        → webhook payment_intent.succeeded → mark-paid → { payment_status: 'paid' }
      - Confirmed screen shown. Email sent.

   b) PayPal flow:
      - paypal.Buttons.createOrder → client-side order creation with custom_id='42'
      - Customer approves in popup
      - onApprove → POST /paypal/capture { paypalOrderId, orderId: 42 }
        → checkout worker verifies amount from D1, captures via PayPal API
        → markOrderPaidViaApi(42, 'paypal')
      - Poll /payment-status → confirmed. Email sent.

4. Cron (hourly): DELETE awaiting_payment orders >24h old + their events.

5. Dashboard: awaiting_payment hidden by default. Abandoned filter chip shows them.
```

---

## Error Handling

| Failure | Detection | Recovery |
|---|---|---|
| Create-order API fails | fetch to /api/orders rejects | Show error toast, keep form enabled. No D1 row — no abandoned order. |
| PaymentIntent creation fails | POST /create-payment-intent returns error | Show inline error in payment section, re-enable pay button. Order is awaiting_payment → will be cleaned by cron. |
| Card declined | confirmPayment rejects with error | Inline bilingual error, re-enable Pay button. Order stays awaiting_payment. |
| 3DS required timeout / abandon | Customer doesn't complete 3DS | Will never mark-paid → cron cleans up awaiting_payment order. |
| PayPal capture fails | POST /paypal/capture returns error | Inline error, PayPal popup dismissed. Order stays awaiting_payment. |
| Webhook delayed (Stripe) | confirmPayment succeeds but poll returns 'unpaid' | Poll up to 30s. If timeout → show "Payment received — confirmation email will arrive. You can reach us at..." message. Webhook still processes server-side; email sent later. |
| Webhook delayed (PayPal) | Post-capture poll returns 'unpaid' | Same as above — capture completed server-side; webhook dual-path (capture + webhook both call mark-paid, idempotent). |
| Mark-paid server-side fails (transient) | checkout worker returns 500 to Stripe/PayPal webhook | Stripe/PayPal retry webhook (3 days). mark-paid is idempotent. |
| Customer email bounce | Resend returns non-2xx | Logged; no customer-facing effect. Owner can resend manually. |
| Abandoned order not cleaned | Cron fails or is misconfigured | Stale rows in D1 are invisible to owner (excluded from dashboard). Harmless DB bloat; fixed by deploying correct cron. |
| RESEND_API_KEY missing | sendCustomerConfirmation skipped | Logged as warning. Customer email not sent — owner email still fires via Telegram (different path). |

---

## Testing

1. **Vitest unit tests** (`orders/test/`) — TDD: write before implementations change code.
   - createOrder: awaiting_payment gating, email/language storage, notification suppression.
   - listOrders: default exclusion, explicit inclusion.
   - getStats: awaiting_payment exclusion.
   - markOrderPaid: status transition, notification firing, customer email call, idempotency.
   - payable endpoint: auth, correct data.
   - payment-status endpoint: public access, data shape.
   - scheduled cron: expired deletion, fresh preservation.

2. **Manual E2E** (wrangler dev + Stripe test mode + PayPal sandbox):
   - Happy path: Stripe test card 4242 → confirmed screen → email arrives.
   - Declined: card 4000 0000 0000 0002 → inline error.
   - 3DS: card 4000 0025 0000 3155 → redirect return → confirmed.
   - PayPal: sandbox buyer → capture → confirmed.
   - Abandonment: create order, wait, cron cleanup (wrangler dev --test-scheduled).
   - Dashboard: verify abandoned hidden, paid visible.

3. **Playwright** (`webapp-testing` skill): frontend flow verification.

4. **Production cutover**: deploy in order → migration → orders worker → checkout worker → admin build → static site. Old flow works until site deploys due to `/create-checkout` still deployed.

---

## Deploy / config checklist (manual steps)

1. Stripe Dashboard → webhook endpoint → add `payment_intent.succeeded` event.
2. `wrangler secret put STRIPE_PUBLISHABLE_KEY` (checkout worker) — `pk_live_...`
3. `wrangler secret put STRIPE_SECRET_KEY` (checkout worker) — already set; verify.
4. `wrangler secret put STRIPE_WEBHOOK_SECRET` (checkout worker) — already set; verify.
5. `wrangler secret put PAYPAL_CLIENT_SECRET` (checkout worker) — already set; verify.
6. `wrangler secret put PAYPAL_WEBHOOK_ID` (checkout worker) — already set; verify.
7. `wrangler secret put PAYMENT_WEBHOOK_SECRET` (both workers) — already set; verify.
8. `wrangler secret put RESEND_API_KEY` (orders-api worker) — already set; verify.
9. `wrangler secret put EMAIL_RECIPIENT` (orders-api worker) — already set; verify.
10. Resend dashboard → verify `muy-rico.com` domain (DNS records) so `orders@muy-rico.com` is a verified sender.
11. `wrangler secret put EMAIL_FROM` (orders-api worker) — already set as `orders@muy-rico.com`; verify.
12. Apply migration: `npx wrangler d1 execute muy-rico-orders --remote --file=orders/migrations/0016_order_email_language.sql`
13. Deploy: `npx wrangler deploy --name muy-rico-orders-api`, `npx wrangler deploy --name muy-rico-checkout`, `npm run build` (admin), `npx wrangler versions upload --name muyrico`
