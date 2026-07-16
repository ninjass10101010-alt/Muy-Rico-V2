# Payment Webhook Reconciliation — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to create an implementation plan from this spec. The plan produces tasks with checkbox `- [ ]` steps.

**Goal:** When a customer pays for an order on the public order page (via Stripe Checkout, Apple Pay/Google Pay via Stripe, or PayPal Smart Buttons), the matching order row in D1 is automatically marked `payment_status = 'paid'` and its `payment_method` is updated — without manual intervention from the dashboard owner. Both Stripe and PayPal flows must be server-verified (webhook signature).

**Why this matters today:** Orders are created with `payment_method: 'cash'`, `payment_status: 'unpaid'` (hardcoded at `order.html:1461-1462`). Stripe Checkout redirects away with `?paid=true` in the URL but never calls back. PayPal `onApprove` (`order.html:1537-1546`) only mutates a DOM `<p>` — never informs the server. Paid orders stay `unpaid` in the dashboard forever.

**Scope (in this plan):**

- Link public order ID to Stripe Checkout Session and PayPal order at creation time.
- Add server-verified Stripe webhook handler that marks the order paid.
- Add server-verified PayPal webhook handler that marks the order paid.
- Move the PayPal client ID out of `order.html` into the API so it isn't hardcoded in markup.
- Audit trail via existing `order_events` table.
- Keep manual "record payment" in dashboard as a fallback but fix its `payment_method` desync.

**Out of scope:**

- Refund handling (`payment_intent.payment_failed`, `charge.refunded`) — only `checkout.session.completed` (Stripe) and `CHECKOUT.ORDER.APPROVED` (PayPal) are reconciled. Refunds can be added later.
- Subscriptions / recurring billing — bakery only sells one-time orders.
- Per-item line items in Stripe Checkout — keep single lump-sum `unit_amount` (existing behaviour) to avoid a SKU import into Stripe. Only `client_reference_id` + metadata is added.
- Apple Pay / Google Pay via Stripe — already flow through the same Stripe Checkout Session, so they're covered by the same webhook.
- Inventory deduction on payment — inventory deduction is tied to order status `completed` (`Orders.tsx:40-49`), not payment status. Leave that gap for a separate plan.

**Tech Stack:** Cloudflare Workers (module syntax), Cloudflare D1 (SQLite), Stripe Checkout + Webhooks, PayPal Orders v2 + Webhooks, TypeScript (admin SPA), vanilla JS (order.html).

---

## Global Constraints

- The `muy-rico-checkout` Worker (`workers/checkout.js`) gets the Stripe webhook endpoint AND the PayPal webhook endpoint. It already has a `[[d1_databases]]` binding missing — this plan adds one. The orders API Worker (`orders/workers/api.js`) stays the source of truth for order creation and exposes a new internal endpoint the checkout Worker can call.
- Webhook signatures MUST be verified before any DB write. No trust-the-payload shortcuts.
- The Stripe webhook signing secret (`STRIPE_WEBHOOK_SECRET`, `whsec_...`) and PayPal webhook ID (`PAYPAL_WEBHOOK_ID`) and PayPal client secret (`PAYPAL_CLIENT_SECRET`) are stored as Cloudflare Worker secrets via `wrangler secret put` — NOT in `wrangler.toml` `[vars]`.
- The public order page (`order.html`) tracks the order ID returned by `POST /api/orders` and passes it as `client_reference_id` to Stripe and `custom_id` to PayPal. Without an order ID, payment buttons are disabled.
- Webhook endpoints must be idempotent: replayed Stripe events (same `event.id`) and PayPal events (same `TRANSACTION-...` ID) must not double-write events or corrupt state.
- All new routes added to `muy-rico-checkout` are **public** (no Cloudflare Access) because Stripe and PayPal webhook servers are external services that won't carry Access cookies.
- The existing `success_url` of `/order.html?paid=true` becomes `/order.html?paid=true&order=<ORDER_ID>`. This is **in scope** — the new URL lets the customer-side UI display a more precise confirmation and lets us correlate the redirect to the just-paid order. Note: the **webhook is the source of truth**, not the URL param; the URL is for UX only.
- Public endpoints in the API Worker (`orders/workers/api.js`) already allow `POST /api/orders`. The API Worker will remain read-from-public / write-from-admin. The **checkout Worker**, not the API Worker, receives webhooks — it's the payments-specialised Worker and can call into the API Worker over HTTP to mark orders paid.
- D1 writes from the checkout Worker happen against the **same** `muy-rico-orders` database. Rather than duplicate order-update logic, the checkout Worker will call a new internal API endpoint on the orders API Worker: `POST /api/orders/:id/mark-paid` (admin-only via a shared secret, since the checkout Worker has no Access cookie).

---

## Architecture

```
order.html "Submit"
   → POST /api/orders  (existing)
     ← { ok: true, id }  (order.html NOW captures this `id`)

order.html wires Stripe button
   → POST checkout-worker./create-checkout  with { amount, items, orderId, origin }
     ← { url }  (Stripe Checkout URL tagged with client_reference_id=orderId)

order.html PayPal buttons render with `custom_id: orderId` set in createOrder payload.

Stripe checkout success
   → Stripe POST to checkout-worker./webhook/stripe
     → verify signature with STRIPE_WEBHOOK_SECRET
     → extract client_reference_id (= order ID)
     → POST orders-api./api/orders/:id/mark-paid  { method: 'stripe' }
        + X-Webhook-Secret header (shared secret stored as Worker secret)

PayPal approval
   → PayPal POST to checkout-worker./webhook/paypal
     → verify webhook signature via PayPal API: /v1/notifications/verify-webhook-signature
     → extract custom_id from resource.sale_tracker_id or resource.supplementary_data.related_ids.order_id
     → POST /api/orders/:id/mark-paid { method: 'paypal' }
        + X-Webhook-Secret header
```

### Why two webhook handlers on the checkout Worker (not the API Worker)

- The API Worker was built for admin Access-gated order CRUD. Stripe and PayPal webhook servers cannot carry Access cookies; putting the webhook endpoints there would require widening public routes, making Access protection fuzzy.
- The checkout Worker already handles Stripe credentials and is small + focused (one file today). It's the right place for all payment-specific secrets.
- Keeping webhook endpoints off the API Worker also means webhook traffic never queues behind the larger admin-API call volume — in the worst case Stripe retries on a 5xx and we don't want a slow `POST /api/orders` hogGING the webhook path.

### Why the API Worker gets a new internal endpoint instead of giving the checkout Worker its own D1 binding

I considered binding D1 to the checkout Worker so it can `UPDATE orders SET payment_status = 'paid'` directly. Rejected because:

- The API Worker is the only thing that writes to `order_events` today, and it logs `event: 'order:updated'` after a status change (`api.js:376-378`). Bypassing it loses the audit-trail row and will desync the dashboard's belief about who changed what.
- The orders API already has all the validation logic (`ALLOWED_PAYSTAT`, `ALLOWED_PAYMENT`). Duplicating it in the checkout Worker is a maintenance trap.
- Authentication: both Workers live in the same Cloudflare account. A shared `PAYMENT_WEBHOOK_SECRET` Worker secret on each Worker makes the internal channel trustworthy; no Access cookie required.

Trade-off: one extra subrequest from checkout to API per webhook (fast, in-account). Worth it for the single-writer principle.

---

## Components

### 1. `order.html` — capture the order ID, pass it through to payments

Currently `order.html:1480` does `.then(() => { ... })` and discards the API response. We need the `id`.

**Changes to `handleOrder` (`order.html:1425-1483`):**

- Capture `const { id: orderId } = await firstRes.json();` and store it in a `module-local` `let pendingOrderId = null;` (reset on every new submit).
- Pass `orderId` into the Stripe button wiring (line 1504): change the `fetch` body to `{ amount, items, origin, orderId }`.
- In `renderPayPal`'s `createOrder` callback (line 1533) add `custom_id: String(orderId)` and `purchase_units[0].invoice_id: 'MR-' + orderId`. Pass `application_context` if needed for Venmo.
- If `!orderId` (the POST silently failed but the UI proceeded — defensive), disable the payment buttons and surface a red error toast explaining the order couldn't be created.

**Changes to the Stripe fallback button** (`order.html:1512`):
- The fallback URL `https://buy.stripe.com/6oUdR93Zn2tQb9lgek3wQ00` is a Stripe-hosted Payment Link with no order ID linkage. Replace the fallback path with: if Worker fails, reload `order.html` with `?retry=1` and show a "Try the payment button again" toast. The fallback link is being removed — the dashboard won't be able to reconcile orders paid through that link without an ID.

### 2. `workers/checkout.js` — Stripe webhook + PayPal webhook + PayPal client secret exposure

Add four public routes:

1. `POST /create-checkout` — existing, extend body to accept `orderId` and set Stripe Checkout `client_reference_id`.
2. `POST /webhook/stripe` — receive Stripe events. Verify sig, react to `checkout.session.completed`, mark the order paid.
3. `POST /webhook/paypal` — receive PayPal events. Verify sig via PayPal's `/v1/notifications/verify-webhook-signature` API using stored `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`. React to `CHECKOUT.ORDER.APPROVED`, mark the order paid.
4. `GET /paypal-client-id` — returns the public client ID JSON for `order.html` to load the SDK. Unauthenticated, since the client ID is already public (it's currently hardcoded in the HTML; we're just moving it to a server-controlled endpoint so we can rotate without a redeploy of `order.html`).

**New environment bindings** in `workers/wrangler.toml`:

- D1 binding is **not** added (decided above; we POST to the API Worker).
- `[[send_email]]` — not needed.
- `[vars]` get:
  - `ORDERS_API_BASE` = `https://muy-rico-orders-api.bexgarcia0208.workers.dev` (or production domain if behind one).
  - `PAYPAL_API_BASE` = `https://api-m.paypal.com` (live) or `https://api-m.sandbox.paypal.com` (we're using live per `order.html:1521`).
  - `PAYPAL_CLIENT_ID` = the existing `AT5cA2qVyupShHw...` (this is public, fine in vars; only the secret and webhook ID need to be real secrets).

**Secrets** set via `wrangler secret put --name muy-rico-checkout`:

- `STRIPE_SECRET_KEY` (already set).
- `STRIPE_WEBHOOK_SECRET` — `whsec_...` revealed in Stripe Dashboard after webhook endpoint creation.
- `PAYPAL_CLIENT_SECRET` — paired with the public `PAYPAL_CLIENT_ID`.
- `PAYPAL_WEBHOOK_ID` — the webhook's ID (`WH-...`) shown in PayPal Developer dashboard after webhook registration.
- `PAYMENT_WEBHOOK_SECRET` — a high-entropy random string shared with the API Worker so the checkout Worker can authenticate its internal call to `POST /api/orders/:id/mark-paid`.

### 3. `orders/workers/api.js` — new internal `mark-paid` endpoint

- New public-route dispatch entry in `fetch`: `POST /api/orders/:id/mark-paid` with header check `X-Webhook-Secret: env.PAYMENT_WEBHOOK_SECRET`. No Cloudflare Access; the shared secret authenticates. Returns 401 if mismatched.
- Body: `{ method: 'stripe' | 'paypal' | 'applepay' | 'cashapp' | 'venmo' | 'cash' }`.
- Logic:
  - `UPDATE orders SET payment_status = 'paid', payment_method = ?, updated_at = datetime('now') WHERE id = ?`.
  - Insert an `order_events` row with `actor = 'system'`, `event = 'order:paid'` (new event type; append to the existing list in the code comments).
  - Insert a `payments` row mirroring the existing `recordPayment` logic in `StoreContext.tsx:445-461` (id, order_id, order_number, customer_name, amount, method, date). This ensures the dashboard's existing Payments page shows webhook-confirmed payments without needing a GET to the payment provider.
  - Return `{ ok: true }` or 404 if the order isn't found.
- Idempotency: if the order is already `paid` and the method matches, return `{ ok: true, skipped: 'already-paid' }` (HTTP 200). Always insert the `order_events` row, because the dashboard counts/audit may need proof the webhook fired.
- New secret on `muy-rico-orders-api`: `PAYMENT_WEBHOOK_SECRET` (same value as set on `muy-rico-checkout`).

### 4. `home-bakery-management-system/src/pages/Orders.tsx` — fix the `confirmPayment` desync (small)

Already exists at `Orders.tsx:62-68`. Fix:

- `await` the `apiUpdateOrder` call before `recordPayment`. Currently it's fire-and-forget; if it fails the order row is `unpaid` in D1 but a payment row exists.
- Change the PATCH body from `{ payment_status: 'paid' }` to `{ payment_status: 'paid', payment_method: payMethod }`. To send `payment_method`, we need to extend the `api.ts` `updateOrder` TypeScript signature (`api.ts:90-98`) to accept `payment_method` — the API already accepts it (`api.js:361`). Optional improvement only — until the admin clicks "Record payment", the webhook flow handles this for online payments; manual recording is for in-person cases.
- This change is the only dashboard admin SPA change in the plan; everything webhook-related runs server-side.

### 5. Existing `order_events` audit-trail reuse

No schema change to `order_events` — its `event` column is a free-form string. We add a new convention `order:paid`. Document the new event string in a comment near `api.js:376-378`.

### 6. Migration: customers.email column bug

**Note (out of this payment plan's scope but flagged):** The form's required `email` field is dropped on submit (`order.html:1455-1469`). This payment plan does NOT add an `email` column to `orders` — that's a separate fix from the previous analysis. Mentioning it here only so the plan stays focused: the payment webhook plan does not block on the email fix.

---

## Data Flow (end-to-end)

```
1. Customer clicks Submit on order.html form
2. POST /api/orders (public) → insert order with payment_status='unpaid', payment_method='cash', source='website'
   Response: { ok: true, id: 42 }  → captured as pendingOrderId in order.html
3. Show payment buttons
4a. Customer clicks Stripe button
    POST checkout-worker./create-checkout { amount: totalCents, items: summary, orderId: 42, origin }
    checkout-worker calls Stripe Checkout Sessions create with:
       client_reference_id: '42'
       metadata: { order_id: '42', source: 'website' }
       success_url: origin + '/order.html?paid=true&order=42'
       cancel_url:  origin + '/order.html?order=42'
    Customer completes Stripe Checkout (hosted page).
    Stripe POST /webhook/stripe { type: 'checkout.session.completed', data.object: { client_reference_id: '42', payment_method: 'card' } }
    checkout-worker:
       1. Verify Stripe-Signature header using STRIPE_WEBHOOK_SECRET (HMAC SHA256 with timestamp tolerance).
       2. Extract order_id = client_reference_id (fall back to metadata.order_id).
       3. POST orders-api./api/orders/42/mark-paid { method: 'stripe' } with X-Webhook-Secret header.
          Response: { ok: true }. (If 409 'already-paid', treat as success.)
    Customer returns to order.html?paid=true&order=42 → "Payment successful!" banner.

4b. Customer clicks PayPal Smart Button
    order.html paypal.Buttons.createOrder:
       actions.order.create({ purchase_units: [{ amount, custom_id: '42', invoice_id: 'MR-42' }] })
    Customer approves payment in PayPal popup.
    PayPal POST /webhook/paypal { event_type: 'CHECKOUT.ORDER.APPROVED', resource: { ... custom_id: '42' } }
    checkout-worker:
       1. Fetch PayPal access token from /v1/oauth2/token using PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET.
       2. POST /v1/notifications/verify-webhook-signature with received headers + body + PAYPAL_WEBHOOK_ID.
          Verify response.status == 'SUCCESS' and verification_status == 'SUCCESS'. Reject otherwise.
       3. Extract order_id = resource.custom_id (use resource.supplementary_data.related_ids.order_id as fallback).
       4. POST orders-api./api/orders/42/mark-paid { method: 'paypal' } with X-Webhook-Secret header.
       5. Optionally also call PayPal /v2/checkout/orders/42/capture to capture the funds if capture is not already immediate; PayPal Smart Buttons' default intent is 'CAPTURE' so the order is auto-captured on approval. (default behaviour for our existing script tag is capture.)
    Customer sees PayPal's on-screen success; no page reload required.

5. Dashboard fetches orders (existing flow). Order #42 now has payment_status='paid', payment_method='stripe' or 'paypal'. A new payment row appears on the Payments page. A new order_events row 'order:paid' appears in the audit trail (for any future event log UI).
```

---

## Error Handling

| Failure | Detection | Recovery |
|---|---|---|
| Stripe webhook signature invalid | Stripe SDK verify throws or returns false | Return 400 to Stripe. No state change. Stripe will retry (up to ~3 days); retried events with valid sig will succeed. |
| Stripe webhook event type != `checkout.session.completed` | Check `event.type` | Return 200 OK to stop Stripe retrying. Log `console.warn('ignored stripe event type', event.type)` for visibility. |
| Stripe event with no `client_reference_id` (rare: legacy Payment Link, manual API call) | Neither `client_reference_id` nor `metadata.order_id` present | Return 200 OK + `console.warn`. No DB write. The order stays `unpaid` — admin resolves manually. |
| PayPal webhook verification fails | `verify-webhook-signature` returns `status != SUCCESS` | Return 400. PayPal will retry up to its retry limit; if it keeps failing, PayPal Dashboard shows the failed delivery — manual intervention. |
| PayPal webhook event type we don't care about | `event_type not in [CHECKOUT.ORDER.APPROVED, PAYMENT.CAPTURE.COMPLETED]` | Return 200 OK + log. |
| Mark-paid target order 404 | Internal POST to `/api/orders/:id/mark-paid` returns 404 | Log `console.error('mark-paid 404 for order', orderId)`. Return 200 to the webhook provider anyway — retrying won't make the order appear. |
| Mark-paid auth secret mismatch | API Worker returns 401 from mark-paid | Log `console.error`. Return 500 to the webhook — Stripe/PayPal will retry after the operator fixes the secret rotation. |
| Duplicate webhook delivery | DB query: order already `payment_status='paid'` AND `payment_method` matches | Return 200 OK + insert a fresh `order_events` `order:paid` row (additive, no UPDATE). Idempotent. |
| Stripe secret is unset | `env.STRIPE_WEBHOOK_SECRET` falsy at verify time | Return 500 with JSON `{ error: 'webhook secret not configured' }`. Operator runs `wrangler secret put STRIPE_WEBHOOK_SECRET`. |
| PayPal secret unset | `env.PAYPAL_CLIENT_SECRET` or `PAYPAL_WEBHOOK_ID` falsy | Same — 500 with descriptive error. |
| Network call `verify-webhook-signature` 5xx | PayPal API itself is down | Return 500 to PayPal. PayPal retries. |
| Internal `mark-paid` network failure (checkout → orders-api) | `fetch` rejects or returns 5xx | Return 500 to the webhook — providers retry. The payments row and status update only happen after success. |

---

## Testing

Manual / live-test strategy (no local mocks):

1. **Stripe end-to-end (real test mode):**
   - Use a Stripe TEST-mode key (`sk_test_...`) as `STRIPE_SECRET_KEY` on this Worker OR a staging Worker. The dashboard's LIVE key stays untouched.
   - Place a test order through `order.html` using Stripe's test card `4242 4242 4242 4242`.
   - Verify the webhook endpoint logs the payment event and the dashboard's order page shows the order as `paid` with `payment_method: 'stripe'`.
   - Use the Stripe CLI: `stripe listen --forward-to http://localhost:8787/webhook/stripe` for local dev. The CLI prints a `whsec_...` exclusively for local testing — don't reuse it in production; production signs events with the real production secret.
2. **PayPal end-to-end (sandbox):**
   - Spin up a temporary sandbox app in PayPal Developer dashboard to get sandbox client ID + secret + webhook ID.
   - Point the Worker at sandbox PayPal API (`api-m.sandbox.paypal.com`).
   - Place a sandbox order and capture the Smart Button flow with a sandbox buyer account.
   - Verify the dashboard shows the order as `paid` with `payment_method: 'paypal'`.
3. **Idempotency test:** manually re-POST the same Stripe webhook payload via `curl` to `/webhook/stripe` with a forged (but locally-valid) signature. Verify the dashboard doesn't grow an extra `payments` row for the same delivery. (The second `order_events` row is expected — it's the audit trail.)
4. **Dashboard post-fix (`Orders.tsx`):** open an unpaid order, click the wallet icon, choose a method, click confirm. Verify the order's `paymentMethod` updates in the table within one refresh and the dashboard's Payment page shows the new row. This is for the manual-recording path, not the webhook path.
5. **Production cutover:** after staging green, run `wrangler secret put STRIPE_WEBHOOK_SECRET` against the LIVE `muy-rico-checkout` Worker with the production `whsec_...`. Do one real small-amount live purchase ($1) and confirm reconciliation.
6. **Verify event trail:** after testing, run `wrangler d1 execute muy-rico-orders --remote --command "SELECT id, order_id, actor, event FROM order_events WHERE event = 'order:paid' ORDER BY id DESC LIMIT 10"` to confirm audit-trail entries exist.

---

## Out-of-scope follow-ups (pool for later)

- Adding the `email` column to `orders` and persisting customer email from `order.html`. (This is the #1 bug from the deep code analysis, separate plan.)
- Adding `productId` to `items_json` from `order.html` so dashboard React keys and inventory deduction work for website orders. (Bug #2 from analysis.)
- Providing a min date for the date input.
- Reconciling refunds via `charge.refunded` Stripe events.
- Per-line-item Stripe Checkout (requires importing products as Stripe prices) — current lump-sum approach is intentional.
- Surfacing `order_events` audit trail in the dashboard UI (today the events are written but not displayed).
