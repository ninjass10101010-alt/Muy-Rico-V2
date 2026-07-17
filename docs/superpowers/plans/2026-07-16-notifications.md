# Notifications Implementation Plan

> **For agentic workers:** This is a small scoped implementation. Inline execution is fine.

**Goal:** Configure email and Telegram notifications for new orders on Muy Rico bakery.

**Architecture:** The `orders-api` Worker already has notification code (`notifyOrderCreated`, `notifyTelegram`, `notifyEmail` in `api.js:279-327`). The email binding (`[[send_email]]`) is already in `wrangler.toml`. This plan onboards the email domain, sets 4 secrets, fixes one floating-promise bug, adds HTML email formatting, deploys, and tests.

**Tech Stack:** Cloudflare Workers, D1, Cloudflare Email Sending, Telegram Bot API

**Spec:** `docs/superpowers/specs/2026-07-16-notifications-design.md`

## Global Constraints

- Don't modify `checkout.js` or `order.html` — notifications are the orders-api Worker's responsibility
- Env vars go via `wrangler secret put` (sensitive like bot tokens and emails)
- Email `from` address must use `muy-rico.com` (the domain active on the Cloudflare account)
- Use `muy-rico.com` zone ID `c403121016ee27e759da2b11b4f0904b` for API calls

---

### Task 1: Onboard email sending domain

**Files:** None (Cloudflare infrastructure)

- [ ] **Step 1: Enable email sending on muy-rico.com**

```bash
npx wrangler email sending enable muy-rico.com
```

Expected: prints DNS records to add (MX record + TXT/SPF record)

- [ ] **Step 2: Add DNS records to muy-rico.com**

Read the DNS records from step 1 output and add them via the Cloudflare dashboard or API:

- **MX record:** `mx.cloudflare.net` (or as specified)
- **TXT record:** `v=spf1 include:_spf.mx.cloudflare.net ~all` (or as specified)

- [ ] **Step 3: Verify email sending is active**

```bash
npx wrangler email sending list
```

Expected: `muy-rico.com` appears with status `active`

---

### Task 2: Set Telegram + email secrets on orders-api Worker

**Files:** None (wrangler secrets)

- [ ] **Step 1: Set TELEGRAM_BOT_TOKEN**

```bash
printf '%s' "8138307676:AAHiMa965GkKsspxjA2dDBw1FQhnzwz-ZDw" | npx wrangler secret put TELEGRAM_BOT_TOKEN --name muy-rico-orders-api
```

Expected: `✨ Success! Uploaded secret TELEGRAM_BOT_TOKEN`

- [ ] **Step 2: Set TELEGRAM_CHAT_ID**

```bash
printf '%s' "-5331192033" | npx wrangler secret put TELEGRAM_CHAT_ID --name muy-rico-orders-api
```

Expected: `✨ Success! Uploaded secret TELEGRAM_CHAT_ID`

- [ ] **Step 3: Set EMAIL_RECIPIENT** (both emails, comma-separated)

```bash
printf '%s' "ninjass10101010@gmail.com,bexgarcia0208@gmail.com" | npx wrangler secret put EMAIL_RECIPIENT --name muy-rico-orders-api
```

Expected: `✨ Success! Uploaded secret EMAIL_RECIPIENT`

- [ ] **Step 4: Set EMAIL_FROM**

```bash
printf '%s' "orders@muy-rico.com" | npx wrangler secret put EMAIL_FROM --name muy-rico-orders-api
```

Expected: `✨ Success! Uploaded secret EMAIL_FROM`

---

### Task 3: Fix floating promise + add HTML email + improve message

**Files:**
- Modify: `orders/workers/api.js:269` (add `ctx.waitUntil`)
- Modify: `orders/workers/api.js:279-297` (improve message format)
- Modify: `orders/workers/api.js:317-326` (add HTML body)

Read the current file first:

```bash
sed -n '262,275p' orders/workers/api.js
sed -n '279,327p' orders/workers/api.js
```

- [ ] **Step 1: Wrap notifyOrderCreated in ctx.waitUntil**

Change line 269 from:
```javascript
notifyOrderCreated(env, body, id, actor);
```
to:
```javascript
ctx.waitUntil(notifyOrderCreated(env, body, id, actor));
```

- [ ] **Step 2: Improve notification message format**

In `notifyOrderCreated` (lines 279-297), update the message to include payment method label and order ID:

```javascript
async function notifyOrderCreated(env, body, id, actor) {
  const customer = body.customer_name.trim();
  const total = body.total_cents ? '$' + (body.total_cents / 100).toFixed(2) : '—';
  const items = typeof body.items_json === 'string' ? body.items_json : JSON.stringify(body.items_json);
  let itemsStr = '';
  try { itemsStr = JSON.parse(items).map(i => `${i.qty}× ${i.name}`).join(', '); } catch { itemsStr = items; }
  const date = body.pickup_date || '—';
  const time = body.pickup_time || '—';
  const paymentLabel = body.payment_method.charAt(0).toUpperCase() + body.payment_method.slice(1);
  const msg = [
    `🆕 Order #${id}`,
    `👤 ${customer}`,
    `📦 ${itemsStr}`,
    `💰 ${total}`,
    `📅 ${date} ${time}`,
    `💳 ${paymentLabel}`,
    `🆔 #${id}`,
  ].join('\n');

  // Telegram
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    notifyTelegram(env, msg);
  }

  // Email
  if (env.EMAIL_RECIPIENT && env.EMAIL && env.EMAIL.send) {
    notifyEmail(env, msg, id, { customer, itemsStr, total, date, time, paymentLabel, actor });
  }
}
```

- [ ] **Step 3: Add HTML email body in notifyEmail**

Replace the `notifyEmail` function (lines 317-327) to also send HTML:

```javascript
async function notifyEmail(env, msg, id, info = {}) {
  try {
    const emails = String(env.EMAIL_RECIPIENT).split(',').map(e => e.trim()).filter(Boolean);
    const html = `<div style="font-family: sans-serif; max-width: 480px; padding: 16px;">
  <h2 style="color: #333;">🆕 Order #${id}</h2>
  <table style="width: 100%; border-collapse: collapse;">
    <tr><td style="padding: 6px 0; color: #555; width: 100px;"><strong>Customer</strong></td><td style="padding: 6px 0;">${info.customer || ''}</td></tr>
    <tr><td style="padding: 6px 0; color: #555;"><strong>Items</strong></td><td style="padding: 6px 0;">${info.itemsStr || ''}</td></tr>
    <tr><td style="padding: 6px 0; color: #555;"><strong>Total</strong></td><td style="padding: 6px 0;">${info.total || ''}</td></tr>
    <tr><td style="padding: 6px 0; color: #555;"><strong>Pickup</strong></td><td style="padding: 6px 0;">${info.date || ''} ${info.time || ''}</td></tr>
    <tr><td style="padding: 6px 0; color: #555;"><strong>Payment</strong></td><td style="padding: 6px 0;">${info.paymentLabel || ''}</td></tr>
  </table>
  <p style="color: #999; font-size: 12px; margin-top: 16px;">Order #${id} · Muy Rico Bakery</p>
</div>`;
    await env.EMAIL.send({
      from: env.EMAIL_FROM || 'orders@muy-rico.com',
      to: emails,
      subject: `🆕 Order #${id} — New Muy Rico Order`,
      text: msg,
      html,
    });
  } catch (e) { console.error('Email notify failed:', e); }
}
```

- [ ] **Step 4: Commit the code changes**

```bash
git add orders/workers/api.js
git commit -m "feat: fix floating promise, add HTML email, improve notification message"
```

---

### Task 4: Deploy orders-api and test

**Files:** None (deployment)

- [ ] **Step 1: Deploy orders-api Worker**

```bash
VID=$(npx wrangler versions upload --config orders/wrangler.toml | grep -oE "Version ID: [a-f0-9-]+" | awk '{print $3}')
npx wrangler versions deploy --config orders/wrangler.toml "$VID@100%" -y
```

Expected: `SUCCESS Deployed muy-rico-orders-api version ... at 100%`

- [ ] **Step 2: Test with a test order**

```bash
curl -s -X POST "https://muy-rico-orders-api.bexgarcia0208.workers.dev/api/orders" -H "Content-Type: application/json" -d '{"customer_name":"Notification Test","phone":null,"pickup_date":"2026-07-17","pickup_time":"14:00","items_json":[{"name":"Test Cake","qty":1,"price":15,"emoji":"🎂"}],"total_cents":1500,"payment_method":"cash","payment_status":"unpaid","status":"pending","source":"website"}'
```

Expected: `{"ok":true,"id":NN}`

- [ ] **Step 3: Verify Telegram notification**

Check the "Muy Rico" Telegram group (`-5331192033`) for a message:
```
🆕 Order #NN
👤 Notification Test
📦 1× Test Cake
💰 $15.00
📅 2026-07-17 14:00
💳 Cash
🆔 #NN
```

- [ ] **Step 4: Verify email notification**

Check `ninjass10101010@gmail.com` and `bexgarcia0208@gmail.com` inboxes (check Spam/Promotions folders first time).

- [ ] **Step 5: Clean up test order**

```bash
npx wrangler d1 execute muy-rico-orders --remote --command "DELETE FROM order_events WHERE order_id=<ID>; DELETE FROM payments WHERE order_id=<ID>; DELETE FROM orders WHERE id=<ID> AND payment_status='unpaid';"
```

---

### Task 5: Merge notification branch (if on feat/ branch)

**Files:** None (git)

Only if the payment webhook branch is not yet merged:

- [ ] **Step 1: Check current branch**

```bash
git branch --show-current
```

If on `feat/payment-webhook-reconciliation`, commit the notification changes there.
If on `main`, commit directly to main.

- [ ] **Step 2: Push**

```bash
git push origin HEAD
```
