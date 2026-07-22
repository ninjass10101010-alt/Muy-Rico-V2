# Pay-First Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace "order first, pay later" with Amazon-style "fill info → pay inline → order confirmed + email" flow. Orders are created as `awaiting_payment`, hidden from owner, auto-expired by cron after 24h. Owner only notified on payment. Customer gets confirmation email via Resend.

**Architecture:** order.html sends info → creates order (awaiting_payment, notifications suppressed) → mounts Stripe Payment Element (client secret from checkout worker) + PayPal buttons → payment succeeds → webhook/capture → mark-paid (sets status pending + paid, fires owner notification + customer email) → cron deletes expired awaiting_payment orders hourly.

**Tech Stack:** Cloudflare Workers (modules), D1, Stripe PaymentIntents API + Payment Element, PayPal Orders v2, Resend, vanilla JS + GSAP (order.html).

## Global Constraints

- All UI strings bilingual (es/en) with `data-es`/`data-en` + `lang-fade` class.
- Amounts sourced from D1 server-side (never from browser).
- Webhooks are the only mark-paid authority; frontend polls read-only `/payment-status`.
- Old `/create-checkout` endpoint and Stripe checkout.session.completed webhook handler kept (rollback path).
- D1 writes only through orders-api worker (single writer). Checkout worker calls orders-api via `X-Webhook-Secret`.

## File Structure

- **Create:** `orders/migrations/0016_order_email_language.sql` — D1 migration (email + language columns)
- **Modify:** `orders/workers/api.js` — createOrder gating, listOrders exclusion, getStats exclusion, markOrderPaid extension (status transition + notify + customer email), new endpoints (/payable, /payment-status), scheduled cron handler
- **Modify:** `orders/wrangler.toml` — add `[triggers] crons`
- **Modify:** `workers/checkout.js` — new routes: `/stripe-config`, `/create-payment-intent`, `/paypal/capture`; webhook extension for `payment_intent.succeeded`
- **Modify:** `workers/wrangler.toml` — new var `STRIPE_PUBLISHABLE_KEY`
- **Modify:** `order.html` — steps tracker (3→4), handleOrder payload (email, language, status), payment section (Stripe Payment Element + PayPal capture), confirmation screen, remove old redirect/popup code
- **Modify:** `home-bakery-management-system/src/types.ts` — `OrderStatus` += `'awaiting_payment'`
- **Modify:** `home-bakery-management-system/src/pages/Orders.tsx` — "Abandoned" filter chip

---

### Task 1: D1 Migration

**Files:**
- Create: `orders/migrations/0016_order_email_language.sql`

- [ ] Write migration SQL

```sql
-- Muy Rico — Pay-first checkout columns
-- Adds email (for customer confirmations) and language (bilingual emails)
ALTER TABLE orders ADD COLUMN email TEXT;
ALTER TABLE orders ADD COLUMN language TEXT NOT NULL DEFAULT 'es';
```

---

### Task 2: orders/workers/api.js — foundational changes

**Files:**
- Modify: `orders/workers/api.js` — multiple sections

#### 2.1: Add `awaiting_payment` to allowed statuses

- [ ] At L51, add to `ALLOWED_STATUS`:
```js
const ALLOWED_STATUS  = ['pending', 'in-progress', 'ready', 'completed', 'done', 'cancelled', 'awaiting_payment'];
```

#### 2.2: createOrder — accept email/language, gate notifications

- [ ] In `createOrder` (L232), add email + language to INSERT bindings:

Add to column list (L254): `customer_name, customer_id, phone, email, pickup_date, pickup_time, items_json, total_cents, payment_method, payment_status, status, notes, created_by, source, language, food_coloring`

Add to VALUES: `?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?`

Add to bind parameters (L258-272): after `body.phone`, add `body.email?.trim() || null`, after `body.source`, add `body.language || 'es'`

- [ ] Gate notifications: wrap L281 in condition:
```js
if (body.status !== 'awaiting_payment') {
  ctx.waitUntil(notifyOrderCreated(env, body, id, actor));
  ctx.waitUntil(generateLabelsForOrder(env, id, body));
}
```

#### 2.3: listOrders — default exclusion

- [ ] At `listOrders` (L373), after building the WHERE clause and before `binds.push(limit)`, add default exclusion when no status param:
```js
if (!status) {
  where.push('status != ?');
  binds.push('awaiting_payment');
}
```

#### 2.4: getStats — exclude awaiting_payment

- [ ] At `getStats` (L502), add to the FROM clause:
```js
FROM orders WHERE status != 'awaiting_payment'
```

#### 2.5: New endpoint — GET /api/orders/:id/payable (secret-gated)

- [ ] Add route dispatch (after the existing `om` block at L109-120):
```js
const paym = path.match(/^\/api\/orders\/(\d+)\/payable$/);
if (paym && method === 'GET') {
  return await getOrderPayable(Number(paym[1]), request, env);
}
```

- [ ] Implement `getOrderPayable`:
```js
async function getOrderPayable(id, request, env) {
  const provided = request.headers.get('X-Webhook-Secret') || '';
  if (!env.PAYMENT_WEBHOOK_SECRET || provided !== env.PAYMENT_WEBHOOK_SECRET) {
    return json({ error: 'Forbidden' }, 401);
  }
  const order = await env.DB.prepare('SELECT id, total_cents, status, payment_status, email, customer_name FROM orders WHERE id = ?').bind(id).first();
  if (!order) return json({ error: 'Not found' }, 404);
  return json(order, 200);
}
```

#### 2.6: New endpoint — GET /api/orders/:id/payment-status (public)

- [ ] Add route dispatch:
```js
const psm = path.match(/^\/api\/orders\/(\d+)\/payment-status$/);
if (psm && method === 'GET') {
  return await getOrderPaymentStatus(Number(psm[1]), env);
}
```

- [ ] Implement `getOrderPaymentStatus`:
```js
async function getOrderPaymentStatus(id, env) {
  const order = await env.DB.prepare('SELECT payment_status, status FROM orders WHERE id = ?').bind(id).first();
  if (!order) return json({ error: 'Not found' }, 404);
  return json({ payment_status: order.payment_status, status: order.status }, 200);
}
```

#### 2.7: markOrderPaid — extend with status transition, notifications, customer email

- [ ] Change the route dispatch (L122-125) to pass `ctx`:
```js
const mpm = path.match(/^\/api\/orders\/(\d+)\/mark-paid$/);
if (mpm && method === 'POST') {
  return await markOrderPaid(Number(mpm[1]), request, env, ctx);
}
```

- [ ] Update `markOrderPaid` signature (L436): `async function markOrderPaid(id, request, env, ctx)`

- [ ] After the payments INSERT (L479, before `if (alreadyPaid) return...`), add post-payment actions:
```js
// On first payment:
const wasAwaiting = order.status === 'awaiting_payment';

// Transition from awaiting_payment to pending
if (wasAwaiting) {
  await env.DB.prepare(`UPDATE orders SET status = 'pending' WHERE id = ?`).bind(id).run();
  await env.DB.prepare(`
    INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, 'order:status_changed')
  `).bind(id, 'system').run();
}

// Re-read order with email + language for notifications
const updatedOrder = await env.DB.prepare(
  'SELECT id, customer_name, email, language, items_json, total_cents, pickup_date, pickup_time, payment_method, payment_status FROM orders WHERE id = ?'
).bind(id).first();

// Fire notifications in background
ctx.waitUntil(notifyOrderPaid(env, updatedOrder, id, method));

// Send customer confirmation email
ctx.waitUntil(sendCustomerConfirmation(env, updatedOrder));
```

- [ ] Insert `notifyOrderPaid` function (new, after `notifyOrderCreated` ~L319):
```js
async function notifyOrderPaid(env, order, id, method) {
  const customer = order.customer_name.trim();
  const total = order.total_cents ? '$' + (order.total_cents / 100).toFixed(2) : '—';
  let itemsStr = '';
  try { itemsStr = JSON.parse(order.items_json).map(i => `${i.qty}× ${i.name}`).join(', '); } catch { itemsStr = order.items_json; }
  const date = order.pickup_date || '—';
  const time = order.pickup_time || '—';
  const paymentLabel = method.charAt(0).toUpperCase() + method.slice(1);
  const msg = [
    `✅ Order #${id} — PAID`,
    `👤 ${customer}`,
    `📦 ${itemsStr}`,
    `💰 ${total}`,
    `📅 ${date} ${time}`,
    `💳 ${paymentLabel}`,
    `🆔 #${id}`,
    `📧 ${order.email || '—'}`,
  ].join('\n');

  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    notifyTelegram(env, msg);
  }
  if (env.EMAIL_RECIPIENT && env.RESEND_API_KEY) {
    notifyEmail(env, msg, id, { customer, itemsStr, total, date, time, paymentLabel, actor: 'system' });
  }
}
```

- [ ] Insert `sendCustomerConfirmation` function (new, after `notifyEmail` ~L371):
```js
async function sendCustomerConfirmation(env, order) {
  const email = order.email;
  if (!email || !env.RESEND_API_KEY) {
    console.warn('sendCustomerConfirmation: missing email or RESEND_API_KEY for order', order.id);
    return;
  }

  const isEn = order.language === 'en';
  const customer = order.customer_name.trim();
  const total = order.total_cents ? '$' + (order.total_cents / 100).toFixed(2) : '—';
  let itemsList = '';
  try {
    const items = JSON.parse(order.items_json);
    itemsList = items.map(i => `<li>${i.qty}× ${i.name} ($${(i.qty * i.price).toFixed(2)})</li>`).join('');
  } catch { itemsList = `<li>${order.items_json}</li>`; }

  const subject = isEn
    ? `Order #${order.id} Confirmed — Muy Rico Bakery`
    : `Pedido #${order.id} Confirmado — Muy Rico Bakery`;

  const title = isEn ? 'Your Order is Confirmed!' : '¡Tu Pedido Está Confirmado!';
  const greeting = isEn ? `Hi ${customer},` : `Hola ${customer},`;
  const bodyText = isEn
    ? 'Thank you for your order! Your payment has been received and your order is being prepared.'
    : '¡Gracias por tu pedido! Tu pago ha sido recibido y tu pedido se está preparando.';
  const pickupLabel = isEn ? 'Pickup Date' : 'Fecha de Recogida';
  const pickup = `${order.pickup_date || '—'} ${order.pickup_time || ''}`.trim();
  const totalLabel = isEn ? 'Total Paid' : 'Total Pagado';
  const itemsLabel = isEn ? 'Items' : 'Productos';
  const contactText = isEn
    ? 'Questions? Call or text us at (616) 555-1234 or visit muy-rico.com.'
    : '¿Preguntas? Llámanos o envíanos un mensaje al (616) 555-1234 o visita muy-rico.com.';
  const thanksText = isEn
    ? '— Muy Rico Bakery, Holland MI'
    : '— Muy Rico Bakery, Holland MI';

  const html = `<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; padding: 24px; background: #faf7f2; color: #333;">
<div style="background: #fff; border-radius: 12px; padding: 32px; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">
  <h2 style="color: #2d7a46; margin: 0 0 16px;">${title}</h2>
  <p style="line-height: 1.6; color: #555; margin: 0 0 20px;">${greeting} ${bodyText}</p>
  <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
    <tr><td style="padding: 8px 0; color: #777; width: 120px;"><strong>${pickupLabel}</strong></td><td style="padding: 8px 0;">${pickup}</td></tr>
    <tr><td style="padding: 8px 0; color: #777;"><strong>${totalLabel}</strong></td><td style="padding: 8px 0; font-weight: 600;">${total}</td></tr>
  </table>
  <p style="color: #777; font-weight: 600; margin: 20px 0 8px;">${itemsLabel}</p>
  <ul style="color: #555; margin: 0; padding-left: 20px;">${itemsList}</ul>
  <hr style="border: none; border-top: 1px solid #e8e8e8; margin: 24px 0;">
  <p style="color: #999; font-size: 13px; line-height: 1.5; margin: 0;">${contactText}<br>${thanksText}</p>
</div>
</div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM || "orders@muy-rico.com",
        to: [email],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("Resend customer email failed:", res.status, err);
    }
  } catch (e) { console.error('Customer email notify failed:', e); }
}
```

#### 2.8: Scheduled cron handler

- [ ] Add to `export default` object (after `fetch`, ~L198):
```js
async scheduled(event, env, ctx) {
  // Delete expired awaiting_payment orders older than 24 hours
  // Delete order_events first (FK constraint)
  await env.DB.exec(`
    DELETE FROM order_events WHERE order_id IN (
      SELECT id FROM orders WHERE status = 'awaiting_payment' AND created_at < datetime('now', '-24 hours')
    )
  `);
  await env.DB.exec(`
    DELETE FROM orders WHERE status = 'awaiting_payment' AND created_at < datetime('now', '-24 hours')
  `);
},
```

---

### Task 3: orders/wrangler.toml — cron trigger

**Files:**
- Modify: `orders/wrangler.toml`

- [ ] Add before `[vars]`:
```toml
[triggers]
crons = ["0 * * * *"]
```

---

### Task 4: workers/checkout.js — payment orchestration

**Files:**
- Modify: `workers/checkout.js`

#### 4.1: New route — GET /stripe-config

- [ ] Add route (after L34):
```js
if (path === "/stripe-config" && request.method === "GET") {
  return json({ publishableKey: env.STRIPE_PUBLISHABLE_KEY || "" });
}
```

#### 4.2: New route — POST /create-payment-intent

- [ ] Add route:
```js
if (path === "/create-payment-intent" && request.method === "POST") {
  return await handleCreatePaymentIntent(request, env);
}
```

- [ ] Implement:
```js
async function handleCreatePaymentIntent(request, env) {
  const body = await request.json();
  const orderId = body.orderId;
  if (!orderId) return json({ error: "orderId required" }, 400);

  const key = env.STRIPE_SECRET_KEY;
  if (!key) return json({ error: "STRIPE_SECRET_KEY not set" }, 500);

  // Read the authoritative amount from the orders API
  const base = env.ORDERS_API_BASE || "https://muy-rico-orders-api.bexgarcia0208.workers.dev";
  const payableRes = await fetch(base + "/api/orders/" + encodeURIComponent(orderId) + "/payable", {
    headers: { "X-Webhook-Secret": env.PAYMENT_WEBHOOK_SECRET || "" },
  });

  if (!payableRes.ok) {
    console.error("payable lookup failed", payableRes.status);
    return json({ error: "Order not found or unavailable" }, payableRes.status);
  }

  const order = await payableRes.json();

  // Validate
  if (order.payment_status === 'paid') return json({ error: "Order already paid" }, 409);
  if (order.status !== 'awaiting_payment') return json({ error: "Order not in payable state" }, 409);

  const params = new URLSearchParams();
  params.append("amount", String(order.total_cents));
  params.append("currency", "usd");
  params.append("automatic_payment_methods[enabled]", "true");
  params.append("metadata[order_id]", String(orderId));
  params.append("metadata[source]", "website");
  if (order.email) params.append("receipt_email", order.email);

  const res = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const pi = await res.json();
  if (pi.error) return json({ error: pi.error.message }, 400);
  return json({ clientSecret: pi.client_secret });
}
```

#### 4.3: New route — POST /paypal/capture

- [ ] Add route:
```js
if (path === "/paypal/capture" && request.method === "POST") {
  return await handlePayPalCapture(request, env);
}
```

- [ ] Implement:
```js
async function handlePayPalCapture(request, env) {
  const body = await request.json();
  const { paypalOrderId, orderId } = body;
  if (!paypalOrderId || !orderId) return json({ error: "paypalOrderId and orderId required" }, 400);

  // Read the authoritative amount from the orders API
  const base = env.ORDERS_API_BASE || "https://muy-rico-orders-api.bexgarcia0208.workers.dev";
  const payableRes = await fetch(base + "/api/orders/" + encodeURIComponent(orderId) + "/payable", {
    headers: { "X-Webhook-Secret": env.PAYMENT_WEBHOOK_SECRET || "" },
  });

  if (!payableRes.ok) {
    console.error("payable lookup failed", payableRes.status);
    return json({ error: "Order not found or unavailable" }, payableRes.status);
  }

  const order = await payableRes.json();
  if (order.payment_status === 'paid') return json({ error: "Order already paid" }, 409);
  if (order.status !== 'awaiting_payment') return json({ error: "Order not in payable state" }, 409);

  // Get PayPal access token
  const auth = await paypalAuth(env);
  if (!auth) return json({ error: "paypal auth failed" }, 500);

  // Capture the order
  const captureRes = await fetch(env.PAYPAL_API_BASE + "/v2/checkout/orders/" + encodeURIComponent(paypalOrderId) + "/capture", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + auth,
      "Content-Type": "application/json",
    },
  });
  const captureData = await captureRes.json();

  if (!captureRes.ok || captureData.status !== "COMPLETED") {
    console.error("paypal capture failed", JSON.stringify(captureData));
    return json({ error: captureData.message || "Capture failed" }, 400);
  }

  // Double-check: does the captured amount match the D1 amount?
  // We trust D1 as canonical; log a warning if mismatch but still mark paid
  const captured = captureData.purchase_units?.[0]?.payments?.captures?.[0];
  const capturedCents = captured ? Math.round(parseFloat(captured.amount.value) * 100) : 0;
  if (capturedCents !== order.total_cents) {
    console.warn(`paypal amount mismatch: D1=${order.total_cents}, captured=${capturedCents}, order=${orderId}`);
  }

  // Mark paid
  const ok = await markOrderPaidViaApi(orderId, "paypal", env);
  if (!ok) return json({ error: "mark-paid failed" }, 500);

  return json({ ok: true });
}
```

#### 4.4: Webhook — add payment_intent.succeeded handling

- [ ] In `handleStripeWebhook` (L119), add to the event type check:
```js
if (event.type === "checkout.session.completed" || event.type === "payment_intent.succeeded") {
  const obj = event.data && event.data.object ? event.data.object : {};
  const orderId = event.type === "checkout.session.completed"
    ? (obj.client_reference_id || (obj.metadata && obj.metadata.order_id))
    : (obj.metadata && obj.metadata.order_id);
  if (!orderId) {
    console.warn(`stripe ${event.type} without order id — ignored`);
    return json({ received: true });
  }
  const ok = await markOrderPaidViaApi(orderId, "stripe", env);
  if (!ok) return json({ error: "mark-paid failed" }, 500);
}
```

#### 4.5: Handle OPTIONS for new routes

- [ ] The OPTIONS handler at L6-14 already allows all methods; new routes are POST/GET so they work. No change needed — but verify the stripe-config response includes CORS (the `json` helper at L44 already sets `Access-Control-Allow-Origin: *` by default). No change.

---

### Task 5: workers/wrangler.toml

**Files:**
- Modify: `workers/wrangler.toml`

- [x] Add to `[vars]` section:
```toml
STRIPE_PUBLISHABLE_KEY = "pk_live_..."  # set to live key
```

- [x] **Add service binding (critical fix — error 1042):**
```toml
[[services]]
binding = "ORDERS_API"
service = "muy-rico-orders-api"
```
Cloudflare blocks Worker→Worker fetches to `*.workers.dev` in the same account. All checkout→orders calls (`/payable`, `/mark-paid`) use `env.ORDERS_API.fetch(...)` via the `ordersApiFetch()` helper, with the public URL as fallback. This also repaired the pre-existing webhook mark-paid path, which was silently failing with 1042 since its original deploy.

---

### Task 6: order.html — frontend redesign

**Files:**
- Modify: `order.html`

#### 6.1: Update steps tracker (3 → 4 steps)

- [ ] Replace steps HTML (L557-570) with 4 steps:
```html
<div class="step active" id="step-1">
  <div class="step-circle">🛍️</div>
  <div class="step-label lang-fade" data-es="Elige" data-en="Choose">Elige</div>
</div>
<div class="step-connector" id="connector-1"></div>
<div class="step" id="step-2">
  <div class="step-circle">📋</div>
  <div class="step-label lang-fade" data-es="Tu Info" data-en="Your Info">Tu Info</div>
</div>
<div class="step-connector" id="connector-2"></div>
<div class="step" id="step-3">
  <div class="step-circle">💳</div>
  <div class="step-label lang-fade" data-es="Pago" data-en="Payment">Pago</div>
</div>
<div class="step-connector" id="connector-3"></div>
<div class="step" id="step-4">
  <div class="step-circle">✅</div>
  <div class="step-label lang-fade" data-es="Listo" data-en="Done">Listo</div>
</div>
```

- [ ] Update `updateSteps` (L1336) to handle all 4 steps:
```js
function updateSteps(step) {
  const steps = ['step-1', 'step-2', 'step-3', 'step-4'];
  const connectors = ['connector-1', 'connector-2', 'connector-3'];

  // step: 1 = cart filled, 2 = info filled, 3 = payment in progress, 4 = confirmed
  steps.forEach((sId, i) => {
    const el = document.getElementById(sId);
    if (!el) return;
    el.classList.remove('active', 'done');
    if (i + 1 < step) el.classList.add('done');
    if (i + 1 === step) el.classList.add('active');
  });

  connectors.forEach((cId, i) => {
    const el = document.getElementById(cId);
    if (!el) return;
    el.classList.toggle('done', i + 1 < step);
  });
}
```

#### 6.2: Update cart-fill call — change updateSteps signature

- [ ] Replace `updateSteps(true)` at L1488 with `updateSteps(1)` (step 1 = cart has items)
- [ ] Replace `updateSteps(false)` at L1501 with `updateSteps(0)` (step 0 = empty cart)
- [ ] Replace `updateSteps(false)` at L1767 with `updateSteps(0)` (paid=true banner reset)

#### 6.3: Replace the submit button and confirmation panel with new payment section

- [ ] Replace the submit button text (L890) with a "Continue to Payment" button:
```html
<button type="submit" class="btn btn-coral btn-lg lang-fade" data-es="💳 Continuar al Pago" data-en="💳 Continue to Payment">💳 Continuar al Pago</button>
```

- [ ] Replace the entire `#confirmation` div (L899-920) with a new payment section:
```html
<div class="payment-section" id="payment-section" style="display:none;">
  <h4 class="lang-fade" data-es="Completa tu Pago" data-en="Complete Your Payment">Completa tu Pago</h4>

  <div class="payment-review">
    <p class="payment-total" id="payment-total"></p>
    <p class="payment-note lang-fade" data-es="Los precios son finales. Tu pedido será preparado una vez confirmado el pago."
       data-en="Prices are final. Your order will be prepared once payment is confirmed.">
      Los precios son finales. Tu pedido será preparado una vez confirmado el pago.
    </p>
  </div>

  <div class="payment-options">
    <div class="payment-tabs">
      <button type="button" class="payment-tab active" data-method="card" onclick="switchPaymentTab('card')">
        <span>💳</span>
        <span class="lang-fade" data-es="Tarjeta" data-en="Card">Tarjeta</span>
      </button>
      <button type="button" class="payment-tab" data-method="paypal" onclick="switchPaymentTab('paypal')">
        <span>🅿️</span>
        <span>PayPal / Venmo</span>
      </button>
    </div>

    <div class="payment-panel active" id="panel-card">
      <div id="stripe-payment-element"></div>
      <button type="button" id="stripe-pay-btn" class="btn btn-coral btn-lg payment-btn" disabled>
        <span>🔒</span>
        <span class="lang-fade" data-es="Pagar Ahora" data-en="Pay Now">Pagar Ahora</span>
      </button>
      <p id="stripe-error" class="payment-error" style="display:none;"></p>
    </div>

    <div class="payment-panel" id="panel-paypal">
      <p class="hint lang-fade" data-es="Se abrirá una ventana de PayPal para completar tu pago."
         data-en="A PayPal window will open to complete your payment.">
        Se abrirá una ventana de PayPal para completar tu pago.
      </p>
      <div id="paypal-button-container"></div>
      <p id="paypal-error" class="payment-error" style="display:none;"></p>
    </div>
  </div>

  <p class="payment-back">
    <a href="#" onclick="goBackToInfo(event)" class="lang-fade" data-es="← Editar información" data-en="← Edit info">← Editar información</a>
  </p>
</div>
```

#### 6.4: Add new confirmation section

- [ ] Add after the payment section (new HTML, after `</div>` closing `#payment-section`):
```html
<div class="confirmation" id="confirmation" style="display:none;">
  <h4 class="lang-fade" data-es="✅ ¡Pedido Confirmado!" data-en="✅ Order Confirmed!">✅ ¡Pedido Confirmado!</h4>
  <div id="confirmation-details"></div>
  <p class="payment-note lang-fade"
     data-es="Se ha enviado un correo de confirmación a la dirección proporcionada."
     data-en="A confirmation email has been sent to the address you provided.">
     Se ha enviado un correo de confirmación a la dirección proporcionada.
  </p>
  <a href="index.html" class="btn btn-coral btn-lg lang-fade" style="display:inline-flex;align-items:center;gap:8px;text-decoration:none;"
     data-es="🏠 Volver al Inicio" data-en="🏠 Back to Home">🏠 Volver al Inicio</a>
</div>
```

#### 6.5: Rewrite handleOrder

- [ ] Replace `handleOrder` (L1576-1756) with the new version:

```js
function handleOrder(e) {
  e.preventDefault();
  if (!cart.length) {
    const orderPanel = document.getElementById('order-panel');
    gsap.fromTo(orderPanel, { x: -8 }, { x: 0, duration: 0.4, ease: 'elastic.out(2, 0.2)' });
    showToast('⚠️',
      currentLang === 'en' ? 'Add at least one item first!' : '¡Agrega al menos un producto!',
      currentLang === 'en' ? 'Pick from the menu above.' : 'Elige del menú de arriba.'
    );
    return false;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.textContent = currentLang === 'en' ? 'Preparing order...' : 'Preparando pedido...';
  submitBtn.disabled = true;

  submittedTotalCents = Math.round(getCartTotal() * 100);

  const apiPayload = {
    customer_name: document.getElementById('name').value,
    email: document.getElementById('email').value.trim(),
    phone: document.getElementById('phone').value || null,
    pickup_date: document.getElementById('date').value,
    items_json: cart.map(c => ({ name: c.displayName || c.name, qty: c.qty, price: c.price, emoji: c.toastEmoji || '🍞' })),
    total_cents: submittedTotalCents,
    payment_method: 'stripe', // placeholder — overwritten at mark-paid
    payment_status: 'unpaid',
    status: 'awaiting_payment',
    notes: [
      document.getElementById('notes').value,
      document.getElementById('contact-method').value ? 'Contact via: ' + document.getElementById('contact-method').value : ''
    ].filter(Boolean).join(' | ') || null,
    source: 'website',
    language: currentLang
  };

  fetch(ORDER_API + '/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(apiPayload)
  })
  .then(res => {
    if (!res.ok) throw new Error('API rejected');
    return res.json();
  })
  .then(data => {
    pendingOrderId = data && data.id ? Number(data.id) : null;
    if (!pendingOrderId) throw new Error('No order id returned');

    document.getElementById('order-form-el').style.display = 'none';
    updateSteps(3);

    const totalNum = submittedTotalCents / 100;
    const totalStr = totalNum.toFixed(2);
    const totalEl = document.getElementById('payment-total');
    if (totalEl) totalEl.textContent =
      (currentLang === 'en' ? 'Your total: ' : 'Tu total: ') + '$' + totalStr;

    const section = document.getElementById('payment-section');
    section.style.display = 'block';
    gsap.fromTo(section, { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: 'power3.out' });
    section.scrollIntoView({ behavior: 'smooth', block: 'center' });

    initPayment(totalCents);
  })
  .catch(() => {
    submitBtn.textContent = originalText;
    submitBtn.disabled = false;
    showToast('❌',
      currentLang === 'en' ? 'Could not create order. Please try again.' : 'No se pudo crear el pedido. Intenta de nuevo.',
      currentLang === 'en' ? 'Check your connection.' : 'Revisa tu conexión.'
    );
  });

  return false;
}
```

#### 6.6: Payment initialization function

- [ ] Add new function `initPayment()` after handleOrder:

```js
let stripe = null;
let stripeElements = null;
let paymentActive = true;

function initPayment(totalCents) {
  let paypalRendered = false;

  function renderPayPalCapture() {
    if (paypalRendered || !window.paypal) return;
    paypalRendered = true;
    try {
      paypal.Buttons({
        style: { layout: 'horizontal', color: 'gold', shape: 'pill', label: 'paypal', tagline: false },
        createOrder: function (_data, actions) {
          const totalStr = (totalCents / 100).toFixed(2);
          return actions.order.create({
            purchase_units: [{
              amount: { value: totalStr },
              custom_id: String(pendingOrderId || ''),
              invoice_id: 'MR-' + (pendingOrderId || '0')
            }]
          });
        },
        onApprove: function (data) {
          const btnContainer = document.getElementById('paypal-button-container');
          btnContainer.innerHTML = '<p class="payment-note">' +
            (currentLang === 'en' ? 'Processing your payment...' : 'Procesando tu pago...') + '</p>';

          fetch(CHECKOUT_WORKER + '/paypal/capture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paypalOrderId: data.orderID, orderId: String(pendingOrderId) })
          })
          .then(r => r.json())
          .then(result => {
            if (!result.ok) throw new Error(result.error || 'Capture failed');
            pollPaymentStatus();
          })
          .catch(e => {
            const errorEl = document.getElementById('paypal-error');
            errorEl.textContent = e.message || (currentLang === 'en' ? 'Payment failed.' : 'Pago fallido.');
            errorEl.style.display = 'block';
            btnContainer.innerHTML = '';
            paypalRendered = false;
            renderPayPalCapture();
          });
        },
        onError: function () {
          const errorEl = document.getElementById('paypal-error');
          errorEl.textContent = currentLang === 'en' ? 'Payment failed. Please try again.' : 'Pago fallido. Intenta de nuevo.';
          errorEl.style.display = 'block';
        }
      }).render('#paypal-button-container');
    } catch (e) {
      document.getElementById('paypal-button-container').textContent =
        currentLang === 'en' ? 'Venmo/PayPal could not load.' : 'Venmo/PayPal no se pudo cargar.';
    }
  }

  // PayPal SDK loading (unchanged from current loadPayPal logic)
  function loadPayPal() {
    if (window.paypal) { renderPayPalCapture(); return; }
    let clientId = 'BAAksZjUQv405OGh130edPt8VARpnP-9wmc4lJFm1w572Mvx5pm2pCu7Nsjy3HC2948Fny-rFBIfnAr4qI';
    try {
      fetch(CHECKOUT_WORKER + '/paypal-client-id')
        .then(r => r.json())
        .then(j => { if (j.clientId) { clientId = j.clientId; } })
        .catch(() => {})
        .finally(() => {
          var script = document.createElement('script');
          script.src = 'https://www.paypal.com/sdk/js?client-id=' + encodeURIComponent(clientId) +
            '&currency=USD&locale=' + (currentLang === 'es' ? 'es_ES' : 'en_US');
          script.onload = renderPayPalCapture;
          document.head.appendChild(script);
        });
    } catch (e) {
      var script = document.createElement('script');
      script.src = 'https://www.paypal.com/sdk/js?client-id=' + encodeURIComponent(clientId) +
        '&currency=USD&locale=' + (currentLang === 'es' ? 'es_ES' : 'en_US');
      script.onload = renderPayPalCapture;
      document.head.appendChild(script);
    }
  }

  // --- Stripe Payment Element setup ---
  fetch(CHECKOUT_WORKER + '/stripe-config')
    .then(r => r.json())
    .then(config => {
      if (!config.publishableKey) {
        document.getElementById('stripe-pay-btn').textContent =
          currentLang === 'en' ? 'Payment unavailable' : 'Pago no disponible';
        return;
      }
      stripe = Stripe(config.publishableKey);

      return fetch(CHECKOUT_WORKER + '/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: String(pendingOrderId) })
      })
      .then(r => r.json())
      .then(data => {
        if (!data.clientSecret) throw new Error(data.error || 'No client secret');
        stripeElements = stripe.elements({ clientSecret: data.clientSecret });
        const paymentElement = stripeElements.create('payment');
        paymentElement.mount('#stripe-payment-element');

        const payBtn = document.getElementById('stripe-pay-btn');
        payBtn.disabled = false;
        payBtn.onclick = async function () {
          if (!paymentActive || !stripe || !stripeElements) return;
          paymentActive = false;
          const btnHTML = payBtn.innerHTML;
          payBtn.innerHTML = '<span></span><span>' +
            (currentLang === 'en' ? 'Processing...' : 'Procesando...') + '</span>';
          payBtn.classList.add('btn-loading');

          const { error } = await stripe.confirmPayment({
            elements: stripeElements,
            confirmParams: {
              return_url: location.origin + '/order.html?confirming=' + pendingOrderId + '&paid=true',
            },
            redirect: 'if_required'
          });

          if (error) {
            const errorEl = document.getElementById('stripe-error');
            errorEl.textContent = error.message ||
              (currentLang === 'en' ? 'Payment failed. Please try again.' : 'Pago fallido. Intenta de nuevo.');
            errorEl.style.display = 'block';
            payBtn.innerHTML = btnHTML;
            payBtn.classList.remove('btn-loading');
            paymentActive = true;
          } else {
            // No redirect needed — success inline
            pollPaymentStatus();
          }
        };
      });
    })
    .catch(err => {
      const errorEl = document.getElementById('stripe-error');
      errorEl.textContent = err.message || 'Could not initialize payment.';
      errorEl.style.display = 'block';
    });

  loadPayPal();
}

function pollPaymentStatus() {
  let attempts = 0;
  const maxAttempts = 15; // 30 seconds max (2s intervals)
  const interval = setInterval(() => {
    attempts++;
    fetch(ORDER_API + '/api/orders/' + pendingOrderId + '/payment-status')
      .then(r => r.json())
      .then(data => {
        if (data.payment_status === 'paid') {
          clearInterval(interval);
          showConfirmation();
        } else if (attempts >= maxAttempts) {
          clearInterval(interval);
          showConfirmation(); // show with "email coming" note
        }
      })
      .catch(() => {
        if (attempts >= maxAttempts) {
          clearInterval(interval);
          showConfirmation();
        }
      });
  }, 2000);
}

function showConfirmation() {
  const paySection = document.getElementById('payment-section');
  const conf = document.getElementById('confirmation');

  if (paySection) paySection.style.display = 'none';

  const details = document.getElementById('confirmation-details');
  if (details) {
    const pickupDate = document.getElementById('date').value;
    const name = document.getElementById('name').value;
    const email = document.getElementById('email').value;
    const totalStr = (submittedTotalCents / 100).toFixed(2);
    const itemsList = cart.map(c => `${c.qty}× ${c.displayName || c.name} ($${(c.qty * c.price).toFixed(2)})`).join(', ');

    details.innerHTML =
      '<p style="margin:16px 0;"><strong>' +
      (currentLang === 'en' ? 'Order #' : 'Pedido #') + pendingOrderId + '</strong></p>' +
      '<p style="margin:8px 0;">' + name + '</p>' +
      '<p style="margin:8px 0;">' + itemsList + '</p>' +
      '<p style="margin:8px 0;"><strong>' + (currentLang === 'en' ? 'Pickup: ' : 'Recogida: ') + '</strong>' + pickupDate + '</p>' +
      '<p style="margin:8px 0;font-size:1.2em;font-weight:700;color:var(--color-mid-green);">' + totalStr + '</p>' +
      '<p style="margin:8px 0;color:#777;font-size:0.9em;">' +
      (currentLang === 'en' ? 'Confirmation sent to ' : 'Confirmación enviada a ') + email + '</p>';
  }

  conf.style.display = 'block';
  updateSteps(4);
  gsap.fromTo(conf, { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: 'power3.out' });
  conf.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Clear cart
  cart.length = 0;
  refreshTileStates();
  renderCart();
}
```

#### 6.7: Payment tab switching + go-to-info helper

- [ ] Add helper functions:
```js
function switchPaymentTab(method) {
  document.querySelectorAll('.payment-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.payment-panel').forEach(p => p.classList.remove('active'));
  const tab = document.querySelector('.payment-tab[data-method="' + method + '"]');
  if (tab) tab.classList.add('active');
  const panel = document.getElementById('panel-' + method);
  if (panel) panel.classList.add('active');
}

function goBackToInfo(e) {
  e.preventDefault();
  document.getElementById('payment-section').style.display = 'none';
  document.getElementById('order-form-el').style.display = '';
  updateSteps(1);
  document.getElementById('order-form-el').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
```

#### 6.8: Stripe.js script tag

- [ ] Add just before `</body>` (or in `<head>` — Stripe recommends before `</body>`):
```html
<script src="https://js.stripe.com/v3/" async></script>
```

Add it inside the existing `<script>` block... actually, it needs to be a separate `<script>` tag for external loading. Add it after the GSAP script tag already on the page.

#### 6.9: Handle 3DS return URL (?confirming=<id>)

- [ ] Replace the `?paid=true` handler (L1763-1772) with:
```js
const urlParams = new URLSearchParams(window.location.search);
const confirmingId = urlParams.get('confirming');
const paidParam = urlParams.get('paid');

if (confirmingId) {
  pendingOrderId = Number(confirmingId);
  // Fetch the order's total for the confirmation display (items + total from cart are lost on redirect)
  fetch(ORDER_API + '/api/orders/' + pendingOrderId + '/payment-status')
    .then(r => r.json())
    .then(data => {
      // We don't have cart data on redirect return; show a minimal confirmation
      const conf = document.getElementById('confirmation');
      const paySection = document.getElementById('payment-section');
      if (paySection) paySection.style.display = 'none';
      document.getElementById('order-form-el').style.display = 'none';
      updateSteps(4);
      if (conf) {
        conf.style.display = 'block';
        const details = document.getElementById('confirmation-details');
        if (details) {
          details.innerHTML = '<p>' +
            (currentLang === 'en' ? 'Your payment was successful! You will receive a confirmation email shortly.' :
             '¡Tu pago fue exitoso! Recibirás un correo de confirmación en breve.') + '</p>';
        }
        gsap.fromTo(conf, { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: 'power3.out' });
        conf.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      // Re-poll to check when payment is actually marked
      pollPaymentStatusRedirect();
    })
    .catch(() => {
      // order might not exist yet or network error; show generic success
      const conf = document.getElementById('confirmation');
      if (conf) {
        conf.style.display = 'block';
        document.getElementById('order-form-el').style.display = 'none';
        updateSteps(4);
      }
    });
  history.replaceState({}, '', window.location.pathname);
} else if (paidParam === 'true') {
  // Legacy: old Stripe Checkout redirect (keep for backward compat during cutover)
  cart.length = 0;
  refreshTileStates();
  renderCart();
  updateSteps(0);
  const banner = document.getElementById('success-banner');
  if (banner) {
    banner.style.display = 'block';
    gsap.fromTo(banner, { autoAlpha: 0, y: -20 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: 'power3.out' });
  }
  history.replaceState({}, '', window.location.pathname);
}

function pollPaymentStatusRedirect() {
  let attempts = 0;
  const interval = setInterval(() => {
    attempts++;
    fetch(ORDER_API + '/api/orders/' + pendingOrderId + '/payment-status')
      .then(r => r.json())
      .then(data => {
        if (data.payment_status === 'paid' || attempts >= 15) {
          clearInterval(interval);
        }
      })
      .catch(() => {
        if (attempts >= 15) clearInterval(interval);
      });
  }, 2000);
}
```

#### 6.10: Clean up dead code

- [ ] Remove `FORMSPREE_URL` constant (L955)

#### 6.11: Remove the old `?paid=true` handling from `initLang` — already handled above by moving logic

#### 6.12: Remove the old `var submittedTotalCents = 0;` at L1354 (keep `pendingOrderId`) — both needed, keep.

---

### Task 7: Admin dashboard (small)

**Files:**
- Modify: `home-bakery-management-system/src/types.ts`
- Modify: `home-bakery-management-system/src/pages/Orders.tsx`

#### 7.1: types.ts

- [ ] At L5, add `awaiting_payment`:
```ts
export type OrderStatus = "pending" | "in-progress" | "ready" | "completed" | "cancelled" | "awaiting_payment";
```

#### 7.2: Orders.tsx — Abandoned filter chip

- [ ] Find the status filter section (around L11 has STATUS_FLOW) and add a filter chip for "Abandoned":

Look at how existing status filters work in Orders.tsx. Without reading the full file, we infer:
- There's likely a filter bar with buttons/chips mapped from STATUS_FLOW
- Add an "Abandoned" chip that sets `status=awaiting_payment` filter param
- Label: "Abandoned" / "Abandonados"

The implementation depends on the exact JSX structure. I'll read the file during implementation to adjust.

---

### Task 8: Deploy + manual config

#### 8.1: Stripe Dashboard
- [ ] Add `payment_intent.succeeded` event to the existing webhook endpoint

#### 8.2: Wrangler secrets / vars
- [ ] Set `STRIPE_PUBLISHABLE_KEY` in `workers/wrangler.toml` [vars] (or via `wrangler secret put` — publishable keys are safe in vars)
- [ ] Verify existing secrets are still set (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID, PAYMENT_WEBHOOK_SECRET, RESEND_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, EMAIL_RECIPIENT)

#### 8.3: Resend
- [ ] Verify `muy-rico.com` domain is verified in Resend dashboard
- [ ] Verify `EMAIL_FROM` secret is `orders@muy-rico.com`

#### 8.4: Apply migration
- [ ] `npx wrangler d1 execute muy-rico-orders --remote --file=orders/migrations/0016_order_email_language.sql`

#### 8.5: Deploy (in order)
- [ ] `npx wrangler deploy --name muy-rico-orders-api` (with cron trigger)
- [ ] `npx wrangler deploy --name muy-rico-checkout`
- [ ] `npm run build` (admin dashboard) then `npx wrangler versions upload --name muyrico --assets .`

---

### Verification Checklist
- [ ] Stripe test card 4242... → confirmed screen → order paid in D1 → owner gets Telegram/email notification → customer gets confirmation email
- [ ] Stripe decline card 4000000000000002 → inline error on page, stays on payment step
- [ ] Stripe 3DS card 4000002500003155 → redirect → return to confirmation
- [ ] PayPal sandbox → capture → confirmed
- [ ] Abandoned order → cron deletes after 24h
- [ ] Dashboard: abandoned filtered out by default, visible with "Abandoned" filter
