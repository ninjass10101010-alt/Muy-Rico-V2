# Notifications System Design

**Date:** 2026-07-16
**Status:** Design Approved

## Problem

When a customer places an order on the Muy Rico website (`order.html`), the bakery team needs to be notified in real time so they can start preparing. Currently there is no notification system — orders are only visible by manually checking the dashboard.

## Scope

Send email + Telegram notifications when a new order is created. Notify on order creation only (not on payment confirmation or status changes).

## Solution

The `orders-api` Worker (`orders/workers/api.js`) already has notification code (`notifyOrderCreated`, `notifyTelegram`, `notifyEmail` at lines 268–327) that fires after `INSERT INTO orders`. This needs configuration (secrets/vars) and two code fixes.

### Architecture

```
Customer order.html
       │
       ▼
POST /api/orders (orders-api Worker)
       │
       ├─ D1: INSERT INTO orders
       ├─ D1: INSERT INTO order_events (order:created)
       ├─ ctx.waitUntil(notifyOrderCreated)
       │      ├── notifyTelegram (POST api.telegram.org)
       │      └── notifyEmail (env.EMAIL.send)
       └─ Response: { ok: true, id }
```

### Configuration

| Variable | Value | Set Via |
|----------|-------|---------|
| `TELEGRAM_BOT_TOKEN` | `8138307676:AAHiMa965GkKsspxjA2dDBw1FQhnzwz-ZDw` | `wrangler secret put` |
| `TELEGRAM_CHAT_ID` | `-5331192033` | `wrangler secret put` |
| `EMAIL_RECIPIENT` | `ninjass10101010@gmail.com,bexgarcia0208@gmail.com` | `wrangler secret put` |
| `EMAIL_FROM` | `orders@muy-rico.com` | `wrangler secret put` |
| Email Sending domain | `muy-rico.com` (currently `unconfigured`) | `wrangler email sending enable` |

### Code Changes

**Change 1: Fix floating promise (line 269, blocking)**

Current code:
```javascript
notifyOrderCreated(env, body, id, actor);
```

This is a floating Promise — the Cloudflare Worker runtime can terminate before the notifications finish sending. Must wrap in `ctx.waitUntil()`:

```javascript
ctx.waitUntil(notifyOrderCreated(env, body, id, actor));
```

**Change 2: Add HTML email body (in `notifyEmail`, line 317)**

Current code sends only `text`. Add `html` field for better rendering in email clients. Construct a minimal HTML document with inline styles for readability.

**Change 3: Improve notification message**

Add pickup time, formatted total, payment method to the Telegram + email message.

### Notification Message Format

Plain text (Telegram + email text body):

```
🆕 Order #42
👤 Jane Smith
📦 2× Chocolate Cake, 1× Vanilla Cupcakes
💰 $35.50
📅 2026-07-17 14:00
💳 stripe
🆔 #42
```

HTML (email body):

```
<div style="font-family: sans-serif; max-width: 480px; padding: 16px;">
  <h2>🆕 Order #42</h2>
  <table>
    <tr><td><strong>Customer:</strong></td><td>Jane Smith</td></tr>
    <tr><td><strong>Items:</strong></td><td>2× Chocolate Cake, 1× Vanilla Cupcakes</td></tr>
    <tr><td><strong>Total:</strong></td><td>$35.50</td></tr>
    <tr><td><strong>Pickup:</strong></td><td>2026-07-17 14:00</td></tr>
    <tr><td><strong>Payment:</strong></td><td>Stripe</td></tr>
  </table>
  <p style="color: #888; font-size: 12px;">Order #42 · Muy Rico Bakery</p>
</div>
```

### Delivery

Both Telegram and email are fire-and-forget — failures are logged via `console.error` and do not affect the order response.

## Setup Steps

1. Onboard `muy-rico.com` for Email Sending: `wrangler email sending enable muy-rico.com`
2. Add Cloudflare Email DNS records (TXT, MX) as instructed by the CLI
3. Set 4 secrets via `wrangler secret put`
4. Deploy `orders-api` Worker (`wrangler versions upload + deploy`)
5. Verify: place test order → check Telegram group → check both Gmail inboxes

## Future Considerations (Not In Scope)

- Notifications on payment confirmation (Stripe/PayPal webhook mark-paid)
- Notifications on status changes (ready, completed, cancelled)
- SMS via Twilio
- Dashboard notification history log
