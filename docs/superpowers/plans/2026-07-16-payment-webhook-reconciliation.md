# Payment Webhook Reconciliation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically mark D1 orders `paid` when a customer pays via Stripe Checkout or PayPal Smart Buttons, verified by server-side webhooks, so paid orders no longer stay `unpaid` in the dashboard.

**Architecture:** The `muy-rico-checkout` Worker (already holds `STRIPE_SECRET_KEY`) gains two public webhook endpoints (`/webhook/stripe`, `/webhook/paypal`) plus a `/paypal-client-id` endpoint and an `orderId`-tagged `/create-checkout`. On a verified payment event it calls a new internal `POST /api/orders/:id/mark-paid` endpoint on the orders API Worker, authenticated by a shared `PAYMENT_WEBHOOK_SECRET`. `order.html` captures the order `id` and threads it through to both payment providers as `client_reference_id` / `custom_id`.

**Tech Stack:** Cloudflare Workers (module syntax), Cloudflare D1 (SQLite), Stripe Checkout + Webhooks, PayPal Orders v2 + Webhooks, vanilla JS (`order.html`), TypeScript (admin SPA).

## Global Constraints

- All webhook signatures MUST be verified before any DB write. No trust-the-payload shortcuts.
- `STRIPE_WEBHOOK_SECRET` (`whsec_...`), `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, and `PAYMENT_WEBHOOK_SECRET` are stored as Cloudflare Worker **secrets** via `wrangler secret put` — never in `wrangler.toml` `[vars]`.
- `PAYPAL_CLIENT_ID` (public) goes in `workers/wrangler.toml` `[vars]` (it is currently hardcoded in `order.html:1521`).
- Webhook endpoints are **public** (no Cloudflare Access) because Stripe/PayPal can't carry Access cookies. The internal `/api/orders/:id/mark-paid` is protected by the shared `X-Webhook-Secret` header, NOT Access.
- The checkout Worker has **no D1 binding** — it calls the orders API Worker over HTTP for all DB writes (single-writer principle; reuses existing `order_events` audit + `payments` logic).
- Webhook handlers MUST be idempotent: a payment already marked `paid` with the same method returns `{ ok: true, skipped: 'already-paid' }`.
- Stripe test mode first (separate `sk_test_...` key + local `whsec_` via Stripe CLI), then cutover to live. The fallback Payment Link `buy.stripe.com/6oUdR93Zn2tQb9lgek3wQ00` is removed.
- The `confirmPayment` fix in `Orders.tsx` is bundled (2-line change) because it fixes the same in-person desync the webhook flow doesn't cover.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `orders/workers/api.js` | Modify | New public `POST /api/orders/:id/mark-paid` route + `markOrderPaid()` handler (calls existing `createPayment` logic inline for the `payments` row). |
| `orders/wrangler.toml` | Modify | Document new `PAYMENT_WEBHOOK_SECRET` secret. |
| `workers/checkout.js` | Modify | `client_reference_id` on create-checkout; new `/webhook/stripe`, `/webhook/paypal`, `/paypal-client-id` routes. |
| `workers/wrangler.toml` | Modify | Add `ORDERS_API_BASE`, `PAYPAL_API_BASE`, `PAYPAL_CLIENT_ID` vars. |
| `order.html` | Modify | Capture order `id` from `POST /api/orders`; thread it into Stripe + PayPal payloads; remove fallback Payment Link; load PayPal client id from `/paypal-client-id`. |
| `home-bakery-management-system/src/utils/api.ts` | Modify | `updateOrder` signature accepts `payment_method`. |
| `home-bakery-management-system/src/pages/Orders.tsx` | Modify | `confirmPayment` awaits PATCH and sends `payment_method`. |

---

### Task 1: Add internal `mark-paid` endpoint to the orders API Worker

**Files:**
- Modify: `orders/workers/api.js:104-115` (route dispatch), `orders/workers/api.js:359-381` (near `updateOrder`), `orders/workers/api.js:769-795` (near `createPayment`)
- Modify: `orders/wrangler.toml:18-26`

**Interfaces:**
- Produces: `POST /api/orders/:id/mark-paid` (public, header `X-Webhook-Secret: <env.PAYMENT_WEBHOOK_SECRET>`, body `{ method }`) → `{ ok: true }` / `{ ok: true, skipped: 'already-paid' }` / `{ error, ... }` with 401/404/400.
- Consumes: `createPayment`'s INSERT SQL pattern (inline, not the function, because `createPayment` requires `actor` and `body.id`; we generate the payment id internally).

- [ ] **Step 1: Add the route dispatch entry** — in `fetch`, inside the `om` order-id block (after the `DELETE` case at line 114), add a `mark-paid` sub-route:

```js
const mpm = path.match(/^\/api\/orders\/(\d+)\/mark-paid$/);
if (mpm && method === 'POST') {
  return await markOrderPaid(Number(mpm[1]), request, env);
}
```

Place this block **before** the existing `om` block (line 104) so it isn't shadowed, OR inside the `om` block as a new `if (method === 'POST' && path.endsWith('/mark-paid'))`. Recommended: add a standalone match right after line 115 (after the `om` block closes), since the `om` regex `^\/api\/orders\/(\d+)$` won't match the `/mark-paid` suffix.

- [ ] **Step 2: Implement `markOrderPaid`** — append after `updateOrder` (line 381):

```js
async function markOrderPaid(id, request, env) {
  // Authenticate via shared secret (no Cloudflare Access on this public route)
  const provided = request.headers.get('X-Webhook-Secret') || '';
  if (!env.PAYMENT_WEBHOOK_SECRET || provided !== env.PAYMENT_WEBHOOK_SECRET) {
    return json({ error: 'Forbidden — invalid webhook secret' }, 401);
  }

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const method = body.method;
  if (!method || !ALLOWED_PAYMENT.includes(method)) {
    return json({ error: `Invalid or missing method. Must be one of: ${ALLOWED_PAYMENT.join(', ')}` }, 400);
  }

  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  if (!order) return json({ error: 'Not found' }, 404);

  // Idempotent: already paid with the same method → no-op (still log the event below)
  const alreadyPaid = order.payment_status === 'paid' && order.payment_method === method;

  if (!alreadyPaid) {
    await env.DB.prepare(`
      UPDATE orders SET payment_status = 'paid', payment_method = ?, updated_at = datetime('now') WHERE id = ?
    `).bind(method, id).run();
  }

  // Audit trail (additive — always record the webhook fired)
  await env.DB.prepare(`
    INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, 'order:paid')
  `).bind(id, 'system').run();

  // Mirror the dashboard's recordPayment: insert a payments row so the Payments page shows it.
  // Guard against double-counting on replay: only insert when not already paid.
  if (!alreadyPaid) {
    const payId = `pay_${id}_${Date.now().toString(36)}`;
    const orderNumber = order.order_number || null;
    const customerName = order.customer_name || '';
    const amount = Number(order.total_cents) || 0;
    await env.DB.prepare(`
      INSERT INTO payments (id, order_id, order_number, customer_name, amount, method, date, created_at, active)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 1)
    `).bind(payId, id, orderNumber, customerName, amount, method).run();
  }

  if (alreadyPaid) return json({ ok: true, skipped: 'already-paid' }, 200);
  return json({ ok: true }, 200);
}
```

Note: `order_number` column — verify the `orders` table has `order_number`. If it does NOT exist, drop `order_number` from the SELECT and the INSERT binds (use `null`). See Task 1 Step 4 verification.

- [ ] **Step 3: Document the secret** in `orders/wrangler.toml` after line 26:

```toml
# Payment webhook reconciliation (set via `wrangler secret put PAYMENT_WEBHOOK_SECRET --name muy-rico-orders-api`)
# Shared with muy-rico-checkout so it can call POST /api/orders/:id/mark-paid
# PAYMENT_WEBHOOK_SECRET = "***"
```

- [ ] **Step 4: Verify the `orders` table has `order_number`** Run:

```bash
npx wrangler d1 execute muy-rico-orders --remote --command "SELECT sql FROM sqlite_master WHERE type='table' AND name='orders';" --json 2>/dev/null | head -40
```

Expected: schema includes `order_number`. If absent, remove `order_number` references in the INSERT/SELECT above (bind `null` for `order_number` and don't read `order.order_number`).

- [ ] **Step 5: Deploy and smoke-test the endpoint with a fake secret** (local dry run; real secret set in Task 6):

```bash
npx wrangler versions upload --name muy-rico-orders-api
```

Then after deploy (Task 6 will set the secret), test:

```bash
curl -X POST "https://muy-rico-orders-api.bexgarcia0208.workers.dev/api/orders/999999/mark-paid" \
  -H "Content-Type: application/json" -H "X-Webhook-Secret: wrong" \
  -d '{"method":"stripe"}'
```

Expected: `{"error":"Forbidden — invalid webhook secret"}` with HTTP 401.

- [ ] **Step 6: Commit**

```bash
git add orders/workers/api.js orders/wrangler.toml
git commit -m "feat(api): add internal mark-paid endpoint for payment webhooks"
```

---

### Task 2: Capture order ID and thread it through `order.html` payments

**Files:**
- Modify: `order.html:1471-1480` (capture `id`), `order.html:1480-1516` (Stripe payload + remove fallback), `order.html:1518-1558` (PayPal `custom_id` + client-id load)

**Interfaces:**
- Consumes: `POST /api/orders` response `{ ok, id }` (already returns `id` per `api.js:265`).
- Produces: `module-local let pendingOrderId` used by Stripe fetch body and PayPal `createOrder`.
- Produces: Stripe fetch body `{ amount, items, origin, orderId }`; PayPal `purchase_units[0].custom_id = String(orderId)`.

- [ ] **Step 1: Capture the order id** — replace the `.then(() => {` at line 1480 with capturing the response:

Find:
```js
      .then(res => {
        if (!res.ok) throw new Error('API rejected');
        return res.json();
      })
      .then(() => {
```
Replace with:
```js
      .then(res => {
        if (!res.ok) throw new Error('API rejected');
        return res.json();
      })
      .then(data => {
        pendingOrderId = data && data.id ? Number(data.id) : null;
        if (!pendingOrderId) throw new Error('No order id returned');
```

And add at the top level of the script (near the `let cart = []` declaration, search for `let cart` in `order.html`):
```js
    let pendingOrderId = null;
```

- [ ] **Step 2: Pass `orderId` to Stripe and remove the fallback Payment Link** — replace the Stripe button wiring (lines 1493-1516). Find:
```js
        const stripeBtn = document.getElementById('stripe-pay-btn');
        if (stripeBtn) {
          const stripeOriginalHTML = stripeBtn.innerHTML;
          const stripeFallback = 'https://buy.stripe.com/6oUdR93Zn2tQb9lgek3wQ00';
          stripeBtn.onclick = async function () {
            this.innerHTML = (currentLang === 'en' ? 'Opening...' : 'Abriendo...');
            this.disabled = true;
            try {
              const res = await fetch(CHECKOUT_WORKER + '/create-checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount: totalCents, items: itemList, origin: window.location.origin })
              });
              const data = await res.json();
              if (data.url) {
                window.location.href = data.url;
                return;
              }
            } catch (e) {}
            window.open(stripeFallback, '_blank');
            this.innerHTML = stripeOriginalHTML;
            this.disabled = false;
          };
        }
```
Replace with:
```js
        const stripeBtn = document.getElementById('stripe-pay-btn');
        if (stripeBtn) {
          const stripeOriginalHTML = stripeBtn.innerHTML;
          stripeBtn.onclick = async function () {
            if (!pendingOrderId) {
              showToast('❌',
                currentLang === 'en' ? 'Order not created yet.' : 'Orden no creada.',
                currentLang === 'en' ? 'Submit the order again.' : 'Envía la orden de nuevo.');
              return;
            }
            this.innerHTML = (currentLang === 'en' ? 'Opening...' : 'Abriendo...');
            this.disabled = true;
            try {
              const res = await fetch(CHECKOUT_WORKER + '/create-checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount: totalCents, items: itemList, origin: window.location.origin, orderId: pendingOrderId })
              });
              const data = await res.json();
              if (data.url) {
                window.location.href = data.url;
                return;
              }
              throw new Error(data.error || 'No checkout url');
            } catch (e) {
              showToast('❌',
                currentLang === 'en' ? 'Could not start payment.' : 'No se pudo iniciar el pago.',
                currentLang === 'en' ? String(e.message || e) : String(e.message || e));
              this.innerHTML = stripeOriginalHTML;
              this.disabled = false;
            }
          };
        }
```

- [ ] **Step 3: Tag the PayPal order with `custom_id` and load client id from the Worker** — replace `renderPayPal`/`loadPayPal` (lines 1518-1558). Find the block starting at `function loadPayPal() {` (line 1518) through the end of `renderPayPal` (line 1558). Replace with:
```js
        async function loadPayPal() {
          if (window.paypal) { renderPayPal(); return; }
          let clientId = 'AT5cA2qVyupShHwAp9_u-tXINUCTYSVLbc1zVSwyhj1GYB5U3mg6nMiS2TSwjidRqz4_H20eFGpJQkSn';
          try {
            const r = await fetch(CHECKOUT_WORKER + '/paypal-client-id');
            const j = await r.json();
            if (j.clientId) clientId = j.clientId;
          } catch (e) {}
          var script = document.createElement('script');
          script.src = 'https://www.paypal.com/sdk/js?client-id=' + encodeURIComponent(clientId) + '&currency=USD&locale=' + (currentLang === 'es' ? 'es_ES' : 'en_US');
          script.onload = renderPayPal;
          document.head.appendChild(script);
        }

        function renderPayPal() {
          var container = document.getElementById('paypal-button-container');
          if (!container) return;
          try {
            paypal.Buttons({
            style: { layout: 'horizontal', color: 'gold', shape: 'pill', label: 'paypal', tagline: false },
            createOrder: function (_data, actions) {
              return actions.order.create({
                purchase_units: [{
                  amount: { value: totalStr },
                  custom_id: String(pendingOrderId || ''),
                  invoice_id: 'MR-' + (pendingOrderId || '0')
                }]
              });
            },
            onApprove: function (_data, actions) {
              return actions.order.capture().then(function () {
                var statusEl = document.getElementById('payment-status');
                if (statusEl) {
                  statusEl.textContent =
                    currentLang === 'en' ? 'Payment successful! Thank you!' : '¡Pago exitoso! ¡Gracias!';
                  statusEl.style.color = 'var(--color-mid-green)';
                  statusEl.style.fontWeight = '600';
                }
              });
            },
            onError: function () {
              var statusEl = document.getElementById('payment-status');
              if (statusEl) statusEl.textContent =
                currentLang === 'en' ? 'Payment failed. Please try again.' : 'Pago fallido. Intenta de nuevo.';
            }
          }).render('#paypal-button-container');
          } catch (e) {
            container.textContent =
              currentLang === 'en' ? 'Venmo/PayPal could not load.' : 'Venmo/PayPal no se pudo cargar.';
          }
        }
```

- [ ] **Step 4: Verify `CHECKOUT_WORKER` constant exists** in `order.html`. Grep for `CHECKOUT_WORKER`. If undefined, it is likely defined near `ORDER_API`. Confirm both resolve to the deployed Worker URL. Leave their values as-is.

- [ ] **Step 5: Manual local check (no server)** — open `order.html` via a local static server, submit an order, and confirm the browser console shows `pendingOrderId` set and the Stripe fetch body includes `orderId`. (Full end-to-end needs Tasks 3-6 + secrets.)

- [ ] **Step 6: Commit**

```bash
git add order.html
git commit -m "feat(order): capture order id, tag Stripe/PayPal with orderId, remove fallback link"
```

---

### Task 3: Stripe webhook + PayPal client-id endpoint on the checkout Worker

**Files:**
- Modify: `workers/checkout.js` (full rewrite of `fetch` with new routes)
- Modify: `workers/wrangler.toml:5-6` (add vars)

**Interfaces:**
- Consumes: `env.STRIPE_SECRET_KEY`, `env.STRIPE_WEBHOOK_SECRET`, `env.ORDERS_API_BASE`, `env.PAYMENT_WEBHOOK_SECRET` (set as secrets in Task 6), `env.PAYPAL_CLIENT_ID` (var, Task 3 step 1).
- Produces: `POST /create-checkout` now accepts `orderId` and sets `client_reference_id`.
- Produces: `GET /paypal-client-id` → `{ clientId }`.
- Produces: `POST /webhook/stripe` (Task 4), `POST /webhook/paypal` (Task 5) — stubbed here, implemented next tasks.

- [ ] **Step 1: Add vars to `workers/wrangler.toml`** — replace the whole file content:

```toml
name = "muy-rico-checkout"
main = "checkout.js"
compatibility_date = "2024-01-01"

[vars]
# Public PayPal client id (safe to expose in the browser). Set via `wrangler secret put` for secrets.
PAYPAL_CLIENT_ID = "AT5cA2qVyupShHwAp9_u-tXINUCTYSVLbc1zVSwyhj1GYB5U3mg6nMiS2TSwjidRqz4_H20eFGpJQkSn"
# Where the orders API Worker lives (checkout Worker calls it to mark orders paid)
ORDERS_API_BASE = "https://muy-rico-orders-api.bexgarcia0208.workers.dev"
# PayPal REST API base (live)
PAYPAL_API_BASE = "https://api-m.paypal.com"
# The following are SECRETS — set via `wrangler secret put`:
#   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID, PAYMENT_WEBHOOK_SECRET
```

- [ ] **Step 2: Rewrite `workers/checkout.js`** with `client_reference_id` + `/paypal-client-id` + webhook stubs. Replace the entire file:

```js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Stripe-Signature, X-Webhook-Secret",
        },
      });
    }

    try {
      if (path === "/create-checkout" && request.method === "POST") {
        return await handleCreateCheckout(request, env);
      }
      if (path === "/paypal-client-id" && request.method === "GET") {
        return json({ clientId: env.PAYPAL_CLIENT_ID || "" });
      }
      if (path === "/webhook/stripe" && request.method === "POST") {
        return await handleStripeWebhook(request, env);
      }
      if (path === "/webhook/paypal" && request.method === "POST") {
        return await handlePayPalWebhook(request, env);
      }
    } catch (err) {
      console.error("checkout worker error:", err);
      return json({ error: String(err && err.message || err) }, 500);
    }

    return new Response("Not found", { status: 404 });
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

async function handleCreateCheckout(request, env) {
  const { amount, items, origin, orderId } = await request.json();
  const key = env.STRIPE_SECRET_KEY;
  if (!key) return json({ error: "STRIPE_SECRET_KEY not set" }, 500);

  const params = new URLSearchParams();
  params.append("line_items[0][price_data][currency]", "usd");
  params.append("line_items[0][price_data][product_data][name]", "Muy Rico Order");
  params.append("line_items[0][price_data][product_data][description]", items || "Bakery order");
  params.append("line_items[0][price_data][unit_amount]", String(amount));
  params.append("line_items[0][quantity]", "1");
  params.append("mode", "payment");
  if (orderId) {
    params.append("client_reference_id", String(orderId));
    params.append("metadata[order_id]", String(orderId));
  }
  const base = origin || "";
  params.append("success_url", base + "/order.html?paid=true&order=" + (orderId || ""));
  params.append("cancel_url", base + "/order.html?order=" + (orderId || ""));

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const session = await res.json();
  if (session.error) return json({ error: session.error.message }, 400);
  return json({ url: session.url });
}

async function handleStripeWebhook(request, env) {
  // Implemented in Task 4
  return json({ received: true });
}

async function handlePayPalWebhook(request, env) {
  // Implemented in Task 5
  return json({ received: true });
}
```

- [ ] **Step 3: Deploy and verify the new public routes respond** — upload and deploy:

```bash
npx wrangler versions upload --name muy-rico-checkout
npx wrangler versions deploy --name muy-rico-checkout "$(npx wrangler versions list --name muy-rico-checkout --json | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["id"])')@100%" -y
```

Then:
```bash
curl "https://muy-rico-checkout.bexgarcia0208.workers.dev/paypal-client-id"
```
Expected: `{"clientId":"AT5cA2qVyupShHwAp9_u-tXINUCTYSVLbc1zVSwyhj1GYB5U3mg6nMiS2TSwjidRqz4_H20eFGpJQkSn"}`.

```bash
curl -X POST "https://muy-rico-checkout.bexgarcia0208.workers.dev/webhook/stripe" -H "Content-Type: application/json" -d '{}'
```
Expected: `{"received":true}` (stub).

- [ ] **Step 4: Commit**

```bash
git add workers/checkout.js workers/wrangler.toml
git commit -m "feat(checkout): tag Stripe with client_reference_id, add paypal-client-id + webhook stubs"
```

---

### Task 4: Implement Stripe webhook handler

**Files:**
- Modify: `workers/checkout.js` — replace `handleStripeWebhook` (stub from Task 3)

**Interfaces:**
- Consumes: `env.STRIPE_WEBHOOK_SECRET`, `env.ORDERS_API_BASE`, `env.PAYMENT_WEBHOOK_SECRET`.
- Consumes: `POST /api/orders/:id/mark-paid` (Task 1) with header `X-Webhook-Secret`.
- Produces: returns 200 to Stripe on handled/ignored events; 400 on bad signature.

- [ ] **Step 1: Replace `handleStripeWebhook`** with signature verification + mark-paid call:

```js
async function handleStripeWebhook(request, env) {
  const sig = request.headers.get("Stripe-Signature") || "";
  const rawBody = await request.text();
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return json({ error: "webhook secret not configured" }, 500);

  // Verify signature: t=<ts>,v1=<hmac>
  const parts = {};
  sig.split(",").forEach((p) => {
    const [k, v] = p.split("=");
    if (k && v !== undefined) parts[k] = v;
  });
  if (!parts.t || !parts.v1) return new Response("Invalid signature", { status: 400 });

  const signedPayload = parts.t + "." + rawBody;
  const expected = await hmacSha256(secret, signedPayload);
  const got = parts.v1;
  // constant-time compare
  let diff = expected.length ^ got.length;
  for (let i = 0; i < Math.max(expected.length, got.length); i++) {
    diff |= (expected[i] || "").charCodeAt(0) ^ (got[i] || "").charCodeAt(0);
  }
  if (diff !== 0) return new Response("Invalid signature", { status: 400 });

  let event;
  try { event = JSON.parse(rawBody); } catch { return new Response("Bad JSON", { status: 400 }); }

  // Only reconcile completed checkout sessions
  if (event.type === "checkout.session.completed") {
    const obj = event.data && event.data.object ? event.data.object : {};
    const orderId = obj.client_reference_id || (obj.metadata && obj.metadata.order_id);
    if (!orderId) {
      console.warn("stripe checkout.session.completed without order id — ignored");
      return json({ received: true });
    }
    const ok = await markOrderPaidViaApi(orderId, "stripe", env);
    if (!ok) return json({ error: "mark-paid failed" }, 500);
  } else {
    // Acknowledge but ignore other event types (e.g. checkout.session.async_payment_*)
    console.log("stripe event ignored:", event.type);
  }

  return json({ received: true });
}

async function hmacSha256(secret, payload) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function markOrderPaidViaApi(orderId, method, env) {
  const base = env.ORDERS_API_BASE || "https://muy-rico-orders-api.bexgarcia0208.workers.dev";
  try {
    const res = await fetch(base + "/api/orders/" + encodeURIComponent(orderId) + "/mark-paid", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": env.PAYMENT_WEBHOOK_SECRET || "",
      },
      body: JSON.stringify({ method }),
    });
    if (res.status === 404) {
      console.error("mark-paid 404 for order", orderId);
      return true; // don't retry; order missing
    }
    if (!res.ok) {
      console.error("mark-paid failed", res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("mark-paid network error", e);
    return false;
  }
}
```

- [ ] **Step 2: Test with the Stripe CLI (test mode)** — install the CLI if needed, then forward a fixture event. First set a **test** signing secret locally for the dry run (do NOT use the production `whsec_`):

```bash
# In test: use sk_test_...+ a local whsec_ from `stripe listen`
stripe listen --forward-to localhost:8787/webhook/stripe
```

`stripe listen` prints a `whsec_...` for local testing. Set it as `STRIPE_WEBHOOK_SECRET` on a **local** dev Worker (e.g., run `wrangler dev` with `--var` or a `.dev.vars` file) — do not put test secrets in the live Worker.

Then trigger a fixture:
```bash
stripe trigger checkout.session.completed
```

Expected: the local Worker logs the verified event and calls the API's `mark-paid` (point `ORDERS_API_BASE` at the live API or a local mock returning 200). On the live API, an order with that `client_reference_id` gets `payment_status='paid'`.

- [ ] **Step 3: Deploy the live Worker** (secrets set in Task 6) and re-run a test event against the live URL once `STRIPE_WEBHOOK_SECRET` is live.

- [ ] **Step 4: Commit**

```bash
git add workers/checkout.js
git commit -m "feat(checkout): verify + reconcile Stripe webhook events"
```

---

### Task 5: Implement PayPal webhook handler

**Files:**
- Modify: `workers/checkout.js` — replace `handlePayPalWebhook` (stub from Task 3)

**Interfaces:**
- Consumes: `env.PAYPAL_CLIENT_ID`, `env.PAYPAL_CLIENT_SECRET`, `env.PAYPAL_WEBHOOK_ID`, `env.ORDERS_API_BASE`, `env.PAYMENT_WEBHOOK_SECRET`.
- Consumes: `markOrderPaidViaApi` (Task 4).
- Produces: 200 to PayPal on verified/ignored events; 400 on failed verification.

- [ ] **Step 1: Replace `handlePayPalWebhook`** with PayPal signature verification + mark-paid call:

```js
async function handlePayPalWebhook(request, env) {
  const body = await request.text();
  const headers = {
    authAlg: request.headers.get("PAYPAL-AUTH-ALGO") || "",
    certUrl: request.headers.get("PAYPAL-CERT-URL") || "",
    transmissionId: request.headers.get("PAYPAL-TRANSMISSION-ID") || "",
    transmissionSig: request.headers.get("PAYPAL-TRANSMISSION-SIG") || "",
    transmissionTime: request.headers.get("PAYPAL-TRANSMISSION-TIME") || "",
  };
  const webhookId = env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return json({ error: "PAYPAL_WEBHOOK_ID not configured" }, 500);

  // Get OAuth token
  const auth = await paypalAuth(env);
  if (!auth) return json({ error: "paypal auth failed" }, 500);

  const verifyRes = await fetch(env.PAYPAL_API_BASE + "/v1/notifications/verify-webhook-signature", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      auth_algorithm: headers.authAlg,
      cert_url: headers.certUrl,
      transmission_id: headers.transmissionId,
      transmission_sig: headers.transmissionSig,
      transmission_time: headers.transmissionTime,
      webhook_id: webhookId,
      webhook_event: JSON.parse(body),
    }),
  });
  const verify = await verifyRes.json();
  if (verify.verification_status !== "SUCCESS") {
    console.warn("paypal webhook verification failed:", verify.verification_status);
    return new Response("Invalid signature", { status: 400 });
  }

  let event;
  try { event = JSON.parse(body); } catch { return new Response("Bad JSON", { status: 400 }); }

  const handled = ["CHECKOUT.ORDER.APPROVED", "PAYMENT.CAPTURE.COMPLETED"];
  if (handled.includes(event.event_type)) {
    const resource = event.resource || {};
    const orderId =
      resource.custom_id ||
      (resource.supplementary_data &&
        resource.supplementary_data.related_ids &&
        resource.supplementary_data.related_ids.order_id);
    if (!orderId) {
      console.warn("paypal event without order id — ignored");
      return json({ received: true });
    }
    const ok = await markOrderPaidViaApi(orderId, "paypal", env);
    if (!ok) return json({ error: "mark-paid failed" }, 500);
  } else {
    console.log("paypal event ignored:", event.event_type);
  }

  return json({ received: true });
}

async function paypalAuth(env) {
  const basic = btoa(env.PAYPAL_CLIENT_ID + ":" + env.PAYPAL_CLIENT_SECRET);
  try {
    const res = await fetch(env.PAYPAL_API_BASE + "/v1/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: "Basic " + basic,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const j = await res.json();
    return j.access_token || null;
  } catch (e) {
    console.error("paypal auth error", e);
    return null;
  }
}
```

- [ ] **Step 2: Test with PayPal sandbox** — create a sandbox app in the PayPal Developer dashboard, set `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` on a **local** dev Worker (`.dev.vars` or `wrangler dev --var`), point `PAYPAL_API_BASE` to `https://api-m.sandbox.paypal.com` for the test. Use the PayPal webhook simulator (Developer Dashboard → Webhooks → Send Test Event) with event `CHECKOUT.ORDER.APPROVED` and a `custom_id` payload.

Expected: the local Worker verifies the signature (`verification_status: SUCCESS`), extracts `custom_id`, and calls `mark-paid`.

- [ ] **Step 3: Deploy the live Worker** (secrets set in Task 6) and run a sandbox test event against the live URL once secrets are live.

- [ ] **Step 4: Commit**

```bash
git add workers/checkout.js
git commit -m "feat(checkout): verify + reconcile PayPal webhook events"
```

---

### Task 6: Set secrets + register webhook endpoints

**Files:**
- `workers/wrangler.toml` (vars already in Task 3), `orders/wrangler.toml` (doc already in Task 1)
- Cloudflare Dashboard / `wrangler secret put` (no file changes)

**Interfaces:**
- Consumes: nothing in code — operator action.
- Produces: live Worker secrets so Tasks 1/3/4/5 function in production.

- [ ] **Step 1: Set the shared secret on BOTH Workers** (same value):

```bash
# Generate a high-entropy secret once
SECRET=$(openssl rand -hex 32)
echo "Generated PAYMENT_WEBHOOK_SECRET: $SECRET"
printf '%s' "$SECRET" | npx wrangler secret put PAYMENT_WEBHOOK_SECRET --name muy-rico-orders-api
printf '%s' "$SECRET" | npx wrangler secret put PAYMENT_WEBHOOK_SECRET --name muy-rico-checkout
```

- [ ] **Step 2: Set Stripe secret (after creating the webhook endpoint in Stripe Dashboard)**

1. In Stripe Dashboard → Developers → Webhooks → Add endpoint.
2. URL: `https://muy-rico-checkout.bexgarcia0208.workers.dev/webhook/stripe`
3. Events: select `checkout.session.completed` (and optionally `checkout.session.async_payment_succeeded`).
4. After save, copy the **Signing secret** (`whsec_...`) from the endpoint's "Signing secret" reveal.
5. Set it:

```bash
printf '%s' "whsec_XXXXXXXXXXXXXXXX" | npx wrangler secret put STRIPE_WEBHOOK_SECRET --name muy-rico-checkout
```

Note: If planning test-mode validation first (per spec), repeat this with a `sk_test_...` key + test webhook secret on a separate staging Worker or a local `wrangler dev` before touching live.

- [ ] **Step 3: Set PayPal secrets (after creating the webhook in PayPal Developer)**

1. In PayPal Developer Dashboard → Your App → Webhooks → Add Webhook.
2. URL: `https://muy-rico-checkout.bexgarcia0208.workers.dev/webhook/paypal`
3. Events: `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`.
4. Copy the Webhook ID (`WH-...`) and set it + the app's client secret:

```bash
printf '%s' "WH-XXXXXXXXXXXXXXXX" | npx wrangler secret put PAYPAL_WEBHOOK_ID --name muy-rico-checkout
printf '%s' "your_paypal_client_secret" | npx wrangler secret put PAYPAL_CLIENT_SECRET --name muy-rico-checkout
```

- [ ] **Step 4: Re-deploy both Workers** so the new secrets are bound (upload + deploy 100%):

```bash
npx wrangler versions upload --name muy-rico-orders-api
npx wrangler versions upload --name muy-rico-checkout
npx wrangler versions deploy --name muy-rico-orders-api "$(npx wrangler versions list --name muy-rico-orders-api --json | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["id"])')@100%" -y
npx wrangler versions deploy --name muy-rico-checkout "$(npx wrangler versions list --name muy-rico-checkout --json | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["id"])')@100%" -y
```

- [ ] **Step 5: Verify secrets are set** (lists secret *names* only, not values):

```bash
npx wrangler secret list --name muy-rico-checkout
npx wrangler secret list --name muy-rico-orders-api
```

Expected: `muy-rico-checkout` shows `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYMENT_WEBHOOK_SECRET`. `muy-rico-orders-api` shows `PAYMENT_WEBHOOK_SECRET`.

- [ ] **Step 6: Commit** (no file changes here; if you added a `.dev.vars` for local testing, make sure it is gitignored and NOT committed)

```bash
git status --short
```
Expected: no secrets files staged. If `.dev.vars` appears, add it to `.gitignore` and do NOT commit it.

---

### Task 7: Fix dashboard `confirmPayment` desync

**Files:**
- Modify: `home-bakery-management-system/src/utils/api.ts:90-98`
- Modify: `home-bakery-management-system/src/pages/Orders.tsx:62-68`

**Interfaces:**
- Consumes: `POST /api/orders/:id` PATCH already supports `payment_method` (api.js:361).
- Produces: `updateOrder(id, { payment_status, payment_method })` awaited before `recordPayment`.

- [ ] **Step 1: Extend `updateOrder` signature** in `api.ts` — replace lines 90-98:

Find:
```ts
export async function updateOrder(
  id: number,
  patch: { status?: string; payment_status?: string; notes?: string }
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/orders/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}
```
Replace with:
```ts
export async function updateOrder(
  id: number,
  patch: {
    status?: string;
    payment_status?: string;
    payment_method?: string;
    notes?: string;
  }
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/orders/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}
```

- [ ] **Step 2: Fix `confirmPayment` in `Orders.tsx`** — replace lines 62-68:

Find:
```ts
  async function confirmPayment() {
    if (!payFor) return;
    const updated: Order = { ...payFor, paymentStatus: "paid", paymentMethod: payMethod };
    apiUpdateOrder(Number(payFor.id), { payment_status: "paid" });
    await recordPayment(updated);
    setPayFor(null);
  }
```
Replace with:
```ts
  async function confirmPayment() {
    if (!payFor) return;
    const updated: Order = { ...payFor, paymentStatus: "paid", paymentMethod: payMethod };
    await apiUpdateOrder(Number(payFor.id), { payment_status: "paid", payment_method: payMethod });
    await recordPayment(updated);
    setPayFor(null);
  }
```

- [ ] **Step 3: Type-check the SPA** (run from `home-bakery-management-system/`):

```bash
cd home-bakery-management-system && npx tsc --noEmit && cd ..
```
Expected: no type errors.

- [ ] **Step 4: Build the SPA** to confirm it compiles:

```bash
cd home-bakery-management-system && npm run build && cd ..
```
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add home-bakery-management-system/src/utils/api.ts home-bakery-management-system/src/pages/Orders.tsx
git commit -m "fix(dashboard): await payment PATCH and send payment_method on confirm"
```

---

### Task 8: End-to-end live validation

**Files:** none (operator validation)

**Interfaces:**
- Consumes: everything from Tasks 1-7 deployed.

- [ ] **Step 1: Stripe live smoke test** — place a real small ($1) order through `order.html`, open Stripe Checkout with test card `4242 4242 4242 4242` (if still in test mode) or a real card, complete payment, return to `order.html?paid=true&order=<ID>`.

Verify via D1:
```bash
npx wrangler d1 execute muy-rico-orders --remote --command "SELECT id, payment_status, payment_method FROM orders WHERE id = (SELECT MAX(id) FROM orders);" --json
```
Expected: `payment_status = "paid"`, `payment_method = "stripe"`.

- [ ] **Step 2: PayPal sandbox/live smoke test** — place an order, pay via PayPal Smart Button, confirm the dashboard order flips to `paid` / `paypal`.

- [ ] **Step 3: Verify audit trail + payments row** exist:
```bash
npx wrangler d1 execute muy-rico-orders --remote --command "SELECT id, order_id, actor, event FROM order_events WHERE event = 'order:paid' ORDER BY id DESC LIMIT 10;" --json
npx wrangler d1 execute muy-rico-orders --remote --command "SELECT id, order_id, method, amount FROM payments ORDER BY created_at DESC LIMIT 10;" --json
```
Expected: at least one `order:paid` event and a matching `payments` row for the tested order.

- [ ] **Step 4: Idempotency check** — re-POST the same Stripe webhook payload (captured from the Stripe Dashboard "Recent deliveries" → copy raw body + signature headers) via `curl` to `/webhook/stripe`. Re-run Step 1's D1 query. Expected: `payment_status` still `paid`, **no extra** `payments` row for that order (a second `order_events` `order:paid` row is expected and fine).

- [ ] **Step 5: Dashboard manual-record path** — open the dashboard, find an `unpaid` order, click the wallet/confirm icon, pick a method, confirm. Verify the order table updates `paymentMethod` within one refresh and a `payments` row is added. (Confirms Task 7.)

- [ ] **Step 6: Final commit + push** (only if any files changed during validation, e.g., wrangler tweaks):
```bash
git add -A && git status --short
```
If clean, no commit needed. Otherwise commit with a descriptive message and `git push`.

---

## Self-Review Notes (author check)

- **Spec coverage:** Payment flow (Stripe + PayPal) → Tasks 3,4,5. Order ID threading → Task 2. Internal mark-paid → Task 1. Secrets + endpoint registration → Task 6. Dashboard desync → Task 7. Validation → Task 8. Email/productId bugs explicitly out of scope (flagged in spec).
- **Placeholder scan:** No "TBD"/"implement later". All code steps show full code. Stripe CLI and PayPal simulator referenced with concrete commands.
- **Type consistency:** `markOrderPaidViaApi(orderId, method, env)` defined in Task 4 and reused in Task 5. `markOrderPaid(id, request, env)` (API Worker) distinct from `markOrderPaidViaApi` (checkout Worker) — names differ intentionally, both referenced consistently. `updateOrder` signature extended in Task 7 matches the PATCH handler in `api.js:361` (`payment_method` already allowed). `pendingOrderId` declared once (Task 2 Step 1) and used in Steps 2-3.
- **Schema caveat:** Task 1 Step 4 guards `order_number` existence; if absent, the INSERT drops it. This is the one environment-dependent branch — verified against live DB before deploy.
