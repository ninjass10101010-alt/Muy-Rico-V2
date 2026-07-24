# Printable Receipts & Manual Order Receipt Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add printable receipts (server-side HTML that auto-triggers the browser print dialog) and auto-generate receipts for manual/in-person paid orders (cash, Venmo, etc.) so every paid order gets a receipt — emailed if the customer has an email, print-only otherwise.

**Architecture:** The orders Worker extracts its inline email HTML into a shared `buildReceiptHtml(order, isEn)` function, adds `GET /api/receipts/:id/html` (returns the receipt as a printable HTML page) and `POST /api/orders/:id/generate-receipt` (creates a receipt row, emails if possible, logs as `sent`/`printed`/`failed`). The dashboard adds a `receiptHtmlUrl()` helper, "Print" buttons on the Receipts page and Orders detail, an email field on the New Order modal, and automatic `generateReceipt` calls after manual payment flows.

**Tech Stack:** Cloudflare Workers (module syntax), Cloudflare D1 (SQLite), Resend email API, React 19 + Vite + TypeScript + Tailwind v4, Vitest (jsdom).

## Global Constraints

- `/api/receipts/:id/html` and `/api/orders/:id/generate-receipt` are **admin-only** (behind Cloudflare Access). Do NOT add them to the `isPublic*` allowlist in `api.js:82-101`.
- The `receipts` table already has all needed columns — no D1 migration. The `'printed'` status is a string value.
- `buildReceiptHtml(order, isEn)` must produce identical HTML to the current email — no visual changes to the email.
- `sendCustomerConfirmation` must remain safe to call when `RESEND_API_KEY` is unset — returns `{ ok: false }`.
- The `order.html` website is unchanged — online orders still go through the checkout Worker → `mark-paid` → receipt logging.
- Commit after every task. Conventional commit format: `feat:`, `fix:`, `test:`, `chore:`, `refactor:`.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `orders/workers/api.js` | Modify | Extract `buildReceiptHtml()`; add `GET /api/receipts/:id/html`; add `POST /api/orders/:id/generate-receipt`; modify `logReceipt` for `printed` status; add route dispatch |
| `home-bakery-management-system/src/utils/api.ts` | Modify | Add `email` to `ApiOrderCreate`; add `generateReceipt()` + `receiptHtmlUrl()` functions |
| `home-bakery-management-system/src/context/StoreContext.tsx` | Modify | Add `generateReceipt` to context interface + value |
| `home-bakery-management-system/src/components/OrderModal.tsx` | Modify | Add email input field; call `generateReceipt` after creating paid order |
| `home-bakery-management-system/src/pages/Orders.tsx` | Modify | Call `generateReceipt` in `confirmPayment`; add "Print" buttons in receipt history |
| `home-bakery-management-system/src/pages/Receipts.tsx` | Modify | Add "Print" button; add "Print Only" badge for `printed` status |
| `home-bakery-management-system/src/types.ts` | Modify | Add `"printed"` to `Receipt.status` union |

---

### Task 1: Extract `buildReceiptHtml()` and add printable receipt endpoint

**Files:**
- Modify: `orders/workers/api.js` (extract HTML from `sendCustomerConfirmation` ~line 662-783; add `getReceiptHtml` function; add route dispatch ~line 217)

**Interfaces:**
- Produces: `buildReceiptHtml(order, isEn)` returns an HTML string. `GET /api/receipts/:id/html` returns `text/html`. `sendCustomerConfirmation` calls `buildReceiptHtml` instead of building HTML inline.

- [ ] **Step 1: Extract `buildReceiptHtml` from `sendCustomerConfirmation`**

In `orders/workers/api.js`, the `sendCustomerConfirmation` function (line 662) builds the `html` variable (lines 669-783). Extract everything from the `const isEn = ...` line through the `html = ...` template into a new function `buildReceiptHtml(order, isEn)` placed **before** `sendCustomerConfirmation` (before line 662).

The new function:

```js
function buildReceiptHtml(order, isEn) {
  const customer = order.customer_name.trim();
  const total = order.total_cents ? '$' + (order.total_cents / 100).toFixed(2) : '$0.00';
  const orderDate = (order.created_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  const methodLabel = buildMethodLabel(order, isEn);
  const statusLabel = order.status ? formatStatusLabel(order.status, isEn) : '—';

  // Itemized receipt rows: name, qty × unit, line total (right-aligned like a paper receipt)
  let itemRows = '';
  try {
    const items = JSON.parse(order.items_json);
    itemRows = items.map(i => {
      const line = (i.qty * i.price).toFixed(2);
      return `<tr>
        <td style="padding: 10px 0; border-bottom: 1px dashed #e3dcd2; color: #4a423d; font-size: 14px;">${i.name}</td>
        <td style="padding: 10px 0; border-bottom: 1px dashed #e3dcd2; color: #8a8078; font-size: 13px; text-align: center; white-space: nowrap;">${i.qty} × $${Number(i.price).toFixed(2)}</td>
        <td style="padding: 10px 0; border-bottom: 1px dashed #e3dcd2; color: #4a423d; font-size: 14px; text-align: right; font-weight: 600;">$${line}</td>
      </tr>`;
    }).join('');
  } catch {
    itemRows = `<tr><td style="padding: 10px 0; color: #4a423d; font-size: 14px;">${order.items_json}</td><td></td><td></td></tr>`;
  }

  const L = isEn ? {
    receipt: 'RECEIPT',
    thanks: 'Thank you for your order!',
    paidNote: 'Your payment was received and your order is being prepared.',
    date: 'Date',
    payment: 'Payment',
    statusLabel: 'Status',
    pickup: 'Pickup',
    item: 'Item',
    qty: 'Qty',
    amount: 'Amount',
    total: 'TOTAL PAID',
    contact: 'Questions about your order? Reply to this email or call/text us at (616) 218-3582.',
    footer: 'Muy Rico Bakery · Holland, Michigan · Familia · Tradición · Sabor',
  } : {
    receipt: 'RECIBO',
    thanks: '¡Gracias por tu pedido!',
    paidNote: 'Tu pago fue recibido y tu pedido se está preparando.',
    date: 'Fecha',
    payment: 'Pago',
    statusLabel: 'Estado',
    pickup: 'Recogida',
    item: 'Producto',
    qty: 'Cant.',
    amount: 'Importe',
    total: 'TOTAL PAGADO',
    contact: '¿Preguntas sobre tu pedido? Responde a este correo o llámanos al (616) 218-3582.',
    footer: 'Muy Rico Bakery · Holland, Michigan · Familia · Tradición · Sabor',
  };

  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #faf7f2; padding: 24px 12px; color: #333;">
<div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.07);">

  <div style="background: #1e4636; padding: 28px 32px 24px; text-align: center;">
    <img src="https://muy-rico.com/muy_rico_logo_email.png" alt="Muy Rico Bakery" width="180" style="width: 180px; max-width: 60%; height: auto; display: block; margin: 0 auto 10px;" />
    <div style="color: #d4edda; font-size: 12px; letter-spacing: 3px; font-weight: 600;">${L.receipt}</div>
  </div>

  <div style="padding: 28px 32px 8px;">
    <h2 style="margin: 0 0 6px; color: #2d7a46; font-size: 20px;">${L.thanks}</h2>
    <p style="margin: 0 0 20px; color: #6b615a; font-size: 14px; line-height: 1.5;">${customer} — ${L.paidNote}</p>

    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
      <tr>
        <td style="color: #8a8078; font-size: 13px; padding: 3px 0;">${L.date}</td>
        <td style="color: #4a423d; font-size: 13px; text-align: right; padding: 3px 0;">${orderDate}</td>
      </tr>
      <tr>
        <td style="color: #8a8078; font-size: 13px; padding: 3px 0;">${L.payment}</td>
        <td style="color: #4a423d; font-size: 13px; text-align: right; padding: 3px 0;">${methodLabel}</td>
      </tr>
      <tr>
        <td style="color: #8a8078; font-size: 13px; padding: 3px 0;">${L.statusLabel}</td>
        <td style="color: #4a423d; font-size: 13px; text-align: right; padding: 3px 0;">${statusLabel}</td>
      </tr>
      <tr>
        <td style="color: #8a8078; font-size: 13px; padding: 3px 0;">${L.pickup}</td>
        <td style="color: #4a423d; font-size: 13px; text-align: right; padding: 3px 0;">${order.pickup_date || '—'}${order.pickup_time ? ' ' + order.pickup_time : ''}</td>
      </tr>
      <tr>
        <td style="color: #8a8078; font-size: 13px; padding: 3px 0;">Order</td>
        <td style="color: #4a423d; font-size: 13px; text-align: right; padding: 3px 0; font-weight: 600;">#${order.id}</td>
      </tr>
    </table>

    <table style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr>
          <th style="text-align: left; color: #8a8078; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; padding-bottom: 8px; border-bottom: 2px solid #1e4636;">${L.item}</th>
          <th style="text-align: center; color: #8a8078; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; padding-bottom: 8px; border-bottom: 2px solid #1e4636;">${L.qty}</th>
          <th style="text-align: right; color: #8a8078; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; padding-bottom: 8px; border-bottom: 2px solid #1e4636;">${L.amount}</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
      <tfoot>
        <tr>
          <td colspan="2" style="padding: 14px 0 4px; color: #1e4636; font-size: 15px; font-weight: 700;">${L.total}</td>
          <td style="padding: 14px 0 4px; color: #1e4636; font-size: 18px; font-weight: 700; text-align: right;">${total}</td>
        </tr>
      </tfoot>
    </table>
  </div>

  <div style="padding: 20px 32px 28px;">
    <p style="color: #8a8078; font-size: 13px; line-height: 1.6; margin: 0 0 6px;">${L.contact}</p>
    <p style="color: #b8ada2; font-size: 12px; margin: 14px 0 0; text-align: center;">${L.footer}</p>
  </div>

</div>
</div>`;
}
```

Then in `sendCustomerConfirmation`, replace the extracted block (lines 669-783 — from `const isEn` through the `html = ...` template) with:

```js
  const isEn = order.language === 'en';
  const html = buildReceiptHtml(order, isEn);
```

The plain-text fallback (lines 785+) and the Resend fetch (lines 800+) remain in `sendCustomerConfirmation` — they use `isEn` and `L` from their own scope. But since `L` was moved into `buildReceiptHtml`, the plain-text section needs its own `L` object. Add a `subject`-only variable and reuse `buildReceiptHtml`'s `L` by extracting a small `receiptLabels(isEn)` helper. To keep the diff small, instead define a minimal `L` inline for the text fallback:

After the `const html = buildReceiptHtml(order, isEn);` line, add:

```js
  const L = isEn ? {
    subject: `Receipt — Muy Rico Order #${order.id}`,
    receipt: 'RECEIPT',
    thanks: 'Thank you for your order!',
    paidNote: 'Your payment was received and your order is being prepared.',
    date: 'Date',
    payment: 'Payment',
    statusLabel: 'Status',
    pickup: 'Pickup',
    total: 'TOTAL PAID',
    contact: 'Questions about your order? Reply to this email or call/text us at (616) 218-3582.',
    footer: 'Muy Rico Bakery · Holland, Michigan · Familia · Tradición · Sabor',
  } : {
    subject: `Recibo — Pedido Muy Rico #${order.id}`,
    receipt: 'RECIBO',
    thanks: '¡Gracias por tu pedido!',
    paidNote: 'Tu pago fue recibido y tu pedido se está preparando.',
    date: 'Fecha',
    payment: 'Pago',
    statusLabel: 'Estado',
    pickup: 'Recogida',
    total: 'TOTAL PAGADO',
    contact: '¿Preguntas sobre tu pedido? Responde a este correo o llámanos al (616) 218-3582.',
    footer: 'Muy Rico Bakery · Holland, Michigan · Familia · Tradición · Sabor',
  };
```

The plain-text fallback uses `L.subject`, `L.receipt`, `L.thanks`, `L.paidNote`, `L.date`, `L.payment`, `L.pickup`, `L.total`, `L.contact`, `L.footer` — all present in this `L` object. It also needs `methodLabel`, `statusLabel`, `orderDate`, `customer`, `total` — re-derive them after `L`:

```js
  const methodLabel = buildMethodLabel(order, isEn);
  const statusLabel = order.status ? formatStatusLabel(order.status, isEn) : '—';
  const customer = order.customer_name.trim();
  const total = order.total_cents ? '$' + (order.total_cents / 100).toFixed(2) : '$0.00';
  const orderDate = (order.created_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
```

- [ ] **Step 2: Add `getReceiptHtml` function**

After the `getReceipt` function (line 893-897), add:

```js
async function getReceiptHtml(id, env) {
  const receipt = await env.DB.prepare('SELECT * FROM receipts WHERE id = ?').bind(id).first();
  if (!receipt) return json({ error: 'Not found' }, 404);
  // Fetch the full order for pickup_date, pickup_time, language, created_at
  let order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(receipt.order_id).first();
  let isEn = true;
  if (order) {
    isEn = order.language === 'en';
  } else {
    // Order deleted — fall back to receipt snapshot (no pickup date/time)
    order = {
      id: receipt.order_id,
      customer_name: receipt.customer_name || '',
      items_json: receipt.items_json || '[]',
      total_cents: receipt.total_cents || 0,
      payment_method: receipt.payment_method || 'unknown',
      payment_sub_method: receipt.payment_sub_method || null,
      status: receipt.order_status || 'pending',
      pickup_date: null,
      pickup_time: null,
      created_at: receipt.created_at,
    };
  }
  const html = buildReceiptHtml(order, isEn);
  const printable = html.replace('</div>\n</div>', '</div>\n</div>\n<script>window.print();</script>');
  return new Response(printable, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS },
  });
}
```

Note: the `replace` targets the final closing `</div></div>` of the template. If the exact whitespace doesn't match, use a more robust approach — append the script by replacing the last `</div>` in the string. A safer version:

```js
  const printable = html + '\n<script>window.print();</script>';
  return new Response(printable, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS },
  });
```

Use the simpler `html + script` append — it's outside the styled container so it won't affect layout, and the browser will execute it after the DOM renders.

- [ ] **Step 3: Add route dispatch for `/api/receipts/:id/html`**

In the route dispatch block (around line 217), find:

```js
      if (path === '/api/receipts' && method === 'GET') return await listReceipts(request, env);
      const rm = path.match(/^\/api\/receipts\/([^/]+)$/);
      if (rm && method === 'GET') return await getReceipt(rm[1], env);
      const rsm = path.match(/^\/api\/receipts\/([^/]+)\/resend$/);
      if (rsm && method === 'POST') return await resendReceipt(rsm[1], request, env, ctx, actorName);
```

Add after the `rm` line:

```js
      const rhm = path.match(/^\/api\/receipts\/([^/]+)\/html$/);
      if (rhm && method === 'GET') return await getReceiptHtml(rhm[1], env);
```

- [ ] **Step 4: Verify syntax**

Run: `cd orders && node --check workers/api.js`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add orders/workers/api.js
git commit -m "feat: extract buildReceiptHtml and add printable receipt HTML endpoint"
```

---

### Task 2: Modify `logReceipt` + add `generate-receipt` endpoint

**Files:**
- Modify: `orders/workers/api.js` (`logReceipt` ~line 841; add `generateReceiptForOrder` function; add route dispatch)

**Interfaces:**
- Produces: `logReceipt` now supports `emailResult.skipped` → status `'printed'`. `POST /api/orders/:id/generate-receipt` returns `{ ok, receiptId, status, messageId }`.

- [ ] **Step 1: Modify `logReceipt` to support `printed` status**

In `orders/workers/api.js`, find `logReceipt` (line 841):

```js
async function logReceipt(env, order, emailResult, orderId) {
  const status = emailResult && emailResult.ok ? 'sent' : 'failed';
```

Replace the `status` line with:

```js
async function logReceipt(env, order, emailResult, orderId) {
  let status;
  if (emailResult && emailResult.ok) status = 'sent';
  else if (emailResult && emailResult.skipped) status = 'printed';
  else status = 'failed';
```

Then find the `order_events` INSERT inside `logReceipt`:

```js
    await env.DB.prepare(`
      INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, ?)
    `).bind(orderId, 'system', status === 'sent' ? 'receipt:sent' : 'receipt:failed').run();
```

Replace with:

```js
    const eventLabel = status === 'sent' ? 'receipt:sent' : status === 'printed' ? 'receipt:printed' : 'receipt:failed';
    await env.DB.prepare(`
      INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, ?)
    `).bind(orderId, 'system', eventLabel).run();
```

- [ ] **Step 2: Add `generateReceiptForOrder` function**

After `resendReceipt` (line 908), add:

```js
async function generateReceiptForOrder(id, request, env, ctx, actor) {
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  if (!order) return json({ error: 'Order not found' }, 404);

  let emailResult;
  if (order.email && env.RESEND_API_KEY) {
    emailResult = await sendCustomerConfirmation(env, order);
  } else {
    emailResult = { ok: false, messageId: null, skipped: true };
  }

  // logReceipt generates the receiptId internally; we need it for the response.
  // Refactor: capture the id by generating it here and passing it to logReceipt.
  const receiptId = `rcpt_${id}_${Date.now().toString(36)}`;
  await logReceiptWithId(env, order, emailResult, id, receiptId);

  await env.DB.prepare(`
    INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, 'receipt:generated')
  `).bind(id, actor || 'system').run();

  return json({
    ok: true,
    receiptId,
    status: emailResult.ok ? 'sent' : emailResult.skipped ? 'printed' : 'failed',
    messageId: emailResult.messageId || null,
  }, 200);
}
```

Then refactor `logReceipt` to accept an optional `receiptId` parameter. Rename the current `logReceipt` to `logReceiptWithId` and have it use the passed `receiptId`:

```js
async function logReceiptWithId(env, order, emailResult, orderId, receiptId) {
  let status;
  if (emailResult && emailResult.ok) status = 'sent';
  else if (emailResult && emailResult.skipped) status = 'printed';
  else status = 'failed';
  const messageId = (emailResult && emailResult.messageId) || null;
  try {
    await env.DB.prepare(`
      INSERT INTO receipts (id, order_id, order_number, customer_name, email, items_json, total_cents, payment_method, payment_sub_method, order_status, status, message_id, sent_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).bind(
      receiptId,
      orderId,
      `MR-${orderId}`,
      order.customer_name || '',
      order.email || null,
      order.items_json || '[]',
      Number(order.total_cents) || 0,
      order.payment_method || 'unknown',
      order.payment_sub_method || null,
      order.status || 'pending',
      status,
      messageId,
    ).run();
    const eventLabel = status === 'sent' ? 'receipt:sent' : status === 'printed' ? 'receipt:printed' : 'receipt:failed';
    await env.DB.prepare(`
      INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, ?)
    `).bind(orderId, 'system', eventLabel).run();
  } catch (e) {
    console.error('logReceipt failed:', e);
  }
}
```

Then update `logReceipt` to be a thin wrapper that generates the id and calls `logReceiptWithId`:

```js
async function logReceipt(env, order, emailResult, orderId) {
  const receiptId = `rcpt_${orderId}_${Date.now().toString(36)}`;
  await logReceiptWithId(env, order, emailResult, orderId, receiptId);
}
```

This keeps the existing `markOrderPaid` and `resendReceipt` callers working unchanged.

- [ ] **Step 3: Add route dispatch for `generate-receipt`**

In the route dispatch block, find the `mark-paid` route (around line 130):

```js
      const mpm = path.match(/^\/api\/orders\/(\d+)\/mark-paid$/);
      if (mpm && method === 'POST') {
        return await markOrderPaid(Number(mpm[1]), request, env, ctx);
      }
```

Add after it:

```js
      const grm = path.match(/^\/api\/orders\/(\d+)\/generate-receipt$/);
      if (grm && method === 'POST') {
        return await generateReceiptForOrder(Number(grm[1]), request, env, ctx, actorName);
      }
```

- [ ] **Step 4: Verify syntax**

Run: `cd orders && node --check workers/api.js`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add orders/workers/api.js
git commit -m "feat: add generate-receipt endpoint + printed receipt status"
```

---

### Task 3: Dashboard types + API client

**Files:**
- Modify: `home-bakery-management-system/src/types.ts` (Receipt interface ~line 289)
- Modify: `home-bakery-management-system/src/utils/api.ts` (`ApiOrderCreate` ~line 6; add functions after receipts section ~line 458)

**Interfaces:**
- Produces: `Receipt.status` includes `"printed"`. `ApiOrderCreate.email` is optional. `generateReceiptApi(orderId)` and `receiptHtmlUrl(id)` available for later tasks.

- [ ] **Step 1: Add `"printed"` to `Receipt.status`**

In `home-bakery-management-system/src/types.ts`, find the `Receipt` interface:

```typescript
  status: "sent" | "failed";
```

Change to:

```typescript
  status: "sent" | "failed" | "printed";
```

- [ ] **Step 2: Add `email` to `ApiOrderCreate`**

In `home-bakery-management-system/src/utils/api.ts`, find the `ApiOrderCreate` interface (line 6):

```typescript
interface ApiOrderCreate {
  customer_name: string;
  customer_id?: string | null;
  phone?: string | null;
  pickup_date: string;
```

Add `email` after `phone`:

```typescript
interface ApiOrderCreate {
  customer_name: string;
  customer_id?: string | null;
  phone?: string | null;
  email?: string | null;
  pickup_date: string;
```

- [ ] **Step 3: Add `generateReceiptApi` and `receiptHtmlUrl` functions**

In `home-bakery-management-system/src/utils/api.ts`, after the existing `resendReceiptApi` function (in the Receipts section, around line 458), add:

```typescript
export async function generateReceiptApi(orderId: number): Promise<{ ok: boolean; receiptId: string; status: string; messageId: string | null }> {
  return apiFetch(`/api/orders/${orderId}/generate-receipt`, { method: "POST" });
}

export function receiptHtmlUrl(receiptId: string): string {
  return `${API_BASE}/api/receipts/${encodeURIComponent(receiptId)}/html`;
}
```

Note: `API_BASE` is defined at the top of `api.ts` (line 4) as `isDev ? "http://localhost:8787" : ""`. In production it's `""`, so the URL becomes a relative path `/api/receipts/:id/html` — which works because the dashboard is served from the same Worker domain. In local dev it points to `localhost:8787`.

- [ ] **Step 4: Run typecheck**

Run: `cd home-bakery-management-system && npx tsc --noEmit`
Expected: No new type errors (pre-existing LabelDesigner/compliance.ts errors are OK).

- [ ] **Step 5: Commit**

```bash
git add home-bakery-management-system/src/types.ts home-bakery-management-system/src/utils/api.ts
git commit -m "feat: add printed receipt status + generateReceipt/receiptHtmlUrl API helpers"
```

---

### Task 4: StoreContext — add `generateReceipt`

**Files:**
- Modify: `home-bakery-management-system/src/context/StoreContext.tsx` (import ~line 22; interface ~line 50; implementation after `resendReceipt`)

**Interfaces:**
- Produces: `generateReceipt: (orderId: number) => Promise<void>` available from `useStore()`.

- [ ] **Step 1: Add `generateReceiptApi` to imports**

In `home-bakery-management-system/src/context/StoreContext.tsx`, find the import from `../utils/api` (line 22). Add `generateReceiptApi` to the import list. Find:

```typescript
import { fetchOrders, createOrder as apiCreateOrder, ... resendReceiptApi, type ApiProduct, ... } from "../utils/api";
```

Add `generateReceiptApi` after `resendReceiptApi`:

```typescript
... resendReceiptApi, generateReceiptApi, type ApiProduct, ...
```

- [ ] **Step 2: Add `generateReceipt` to the `StoreContextValue` interface**

Find the interface (around line 50):

```typescript
  receipts: Receipt[];
  refreshReceipts: () => Promise<void>;
  resendReceipt: (id: string) => Promise<void>;
```

Add after `resendReceipt`:

```typescript
  generateReceipt: (orderId: number) => Promise<void>;
```

- [ ] **Step 3: Add `generateReceipt` implementation**

After the `resendReceipt` callback (search for `resendReceipt = useCallback`), add:

```typescript
  const generateReceipt = useCallback(async (orderId: number) => {
    try {
      await generateReceiptApi(orderId);
      await refreshReceipts();
    } catch (err) {
      console.warn("Failed to generate receipt:", err);
    }
  }, [refreshReceipts]);
```

- [ ] **Step 4: Add `generateReceipt` to the value object**

Find the `value = useMemo` block (around line 526). Add `generateReceipt` after `resendReceipt`:

```typescript
      receipts,
      refreshReceipts,
      resendReceipt,
      generateReceipt,
```

- [ ] **Step 5: Add `generateReceipt` to the useMemo dependency array**

Find the dependency array (the line starting `[products, inventory, customers, orders, payments, receipts,`). Add `generateReceipt` to it:

```typescript
    [products, inventory, customers, orders, payments, receipts, labelTemplates, profile, loading, refreshOrders, refreshProducts, refreshInventory, handleApiCreateOrder, handleApiUpdateOrder, handleApiCancelOrder, handleApiDeleteOrder, handleApiCreateProduct, handleApiUpdateProduct, handleApiDeleteProduct, handleApiCreateInventoryItem, handleApiUpdateInventoryItem, handleApiDeleteInventoryItem, handleCreateCustomer, handleUpdateCustomer, handleDeleteCustomer, handleCreateLabel, handleUpdateLabel, handleDeleteLabel, handleUpdateProfile, refreshReceipts, resendReceipt, generateReceipt],
```

- [ ] **Step 6: Run typecheck**

Run: `cd home-bakery-management-system && npx tsc --noEmit`
Expected: No new type errors.

- [ ] **Step 7: Commit**

```bash
git add home-bakery-management-system/src/context/StoreContext.tsx
git commit -m "feat: add generateReceipt to StoreContext"
```

---

### Task 5: OrderModal — add email field + auto-generate receipt on paid

**Files:**
- Modify: `home-bakery-management-system/src/components/OrderModal.tsx` (state ~line 12; email input after phone ~line 226; `handleSubmit` ~line 139; `useStore` destructure ~line 9)

**Interfaces:**
- Consumes: `generateReceipt` from `useStore()` (Task 4).
- Produces: New Order modal has an optional email field. Paid orders auto-generate a receipt after creation.

- [ ] **Step 1: Add `generateReceipt` to `useStore` destructure**

In `home-bakery-management-system/src/components/OrderModal.tsx`, line 9:

```typescript
  const { products, customers, handleCreateCustomer, profile, apiCreateOrder } = useStore();
```

Change to:

```typescript
  const { products, customers, handleCreateCustomer, profile, apiCreateOrder, generateReceipt } = useStore();
```

- [ ] **Step 2: Add `email` state**

After line 12 (`const [phone, setPhone] = useState("");`), add:

```typescript
  const [email, setEmail] = useState("");
```

- [ ] **Step 3: Add email input field**

Find the phone input in the "New customer" section (around line 221-226):

```tsx
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Phone number"
                  className="w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-coral"
                />
              </div>
            )}
```

Add the email input after the phone input (before the closing `</div>`):

```tsx
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Phone number"
                  className="w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-coral"
                />
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email (for receipt)"
                  className="w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-coral"
                />
              </div>
            )}
```

- [ ] **Step 4: Pass `email` in the `apiCreateOrder` payload**

Find the `apiCreateOrder` call in `handleSubmit` (around line 139):

```typescript
    await apiCreateOrder({
      customer_name: finalCustomerName || "Walk-in Customer",
      customer_id: customerIdForOrder,
      phone: finalPhone || null,
      pickup_date: dueDate,
```

Add `email` after `phone`:

```typescript
    const result = await apiCreateOrder({
      customer_name: finalCustomerName || "Walk-in Customer",
      customer_id: customerIdForOrder,
      phone: finalPhone || null,
      email: email.trim() || null,
      pickup_date: dueDate,
```

Note: `apiCreateOrder` returns `{ id: number }` — capture it:

```typescript
    const result = await apiCreateOrder({
```

- [ ] **Step 5: Auto-generate receipt after creating a paid order**

After the `apiCreateOrder` call (which now returns `result`), before `resetForm()`, add:

```typescript
    if (result?.id && paymentStatus === "paid") {
      generateReceipt(result.id).catch(() => {});
    }
```

- [ ] **Step 6: Reset `email` in `resetForm`**

Find `resetForm()` (around line 76). Add `setEmail("");` after `setPhone("")`:

```typescript
    setPhone("");
    setEmail("");
```

- [ ] **Step 7: Run typecheck**

Run: `cd home-bakery-management-system && npx tsc --noEmit`
Expected: No new type errors.

- [ ] **Step 8: Commit**

```bash
git add home-bakery-management-system/src/components/OrderModal.tsx
git commit -m "feat: add email field to OrderModal and auto-generate receipt on paid"
```

---

### Task 6: Orders.tsx — generate receipt on Record Payment + Print buttons

**Files:**
- Modify: `home-bakery-management-system/src/pages/Orders.tsx` (`useStore` destructure line 18; `confirmPayment` line 62; receipt history section ~line 234)

**Interfaces:**
- Consumes: `generateReceipt` from `useStore()` (Task 4), `receiptHtmlUrl` from `api.ts` (Task 3).
- Produces: Record Payment auto-generates a receipt. Receipt history shows a "Print" button per receipt.

- [ ] **Step 1: Add `generateReceipt` to `useStore` destructure**

In `home-bakery-management-system/src/pages/Orders.tsx`, line 18:

```typescript
  const { orders, deductInventoryForOrder, recordPayment, profile, apiUpdateOrder, apiCancelOrder, apiDeleteOrder, refreshOrders, receipts, resendReceipt } = useStore();
```

Change to:

```typescript
  const { orders, deductInventoryForOrder, recordPayment, profile, apiUpdateOrder, apiCancelOrder, apiDeleteOrder, refreshOrders, receipts, resendReceipt, generateReceipt } = useStore();
```

- [ ] **Step 2: Add `receiptHtmlUrl` import**

At the top of the file, find the imports. Add:

```typescript
import { receiptHtmlUrl } from "../utils/api";
```

- [ ] **Step 3: Call `generateReceipt` in `confirmPayment`**

Find `confirmPayment` (line 62):

```typescript
  async function confirmPayment() {
    if (!payFor) return;
    const updated: Order = { ...payFor, paymentStatus: "paid", paymentMethod: payMethod };
    await apiUpdateOrder(Number(payFor.id), { payment_status: "paid", payment_method: payMethod });
    await recordPayment(updated);
    setPayFor(null);
  }
```

Change to:

```typescript
  async function confirmPayment() {
    if (!payFor) return;
    const updated: Order = { ...payFor, paymentStatus: "paid", paymentMethod: payMethod };
    await apiUpdateOrder(Number(payFor.id), { payment_status: "paid", payment_method: payMethod });
    await recordPayment(updated);
    generateReceipt(Number(payFor.id)).catch(() => {});
    setPayFor(null);
  }
```

- [ ] **Step 4: Add "Print" button to receipt history in order detail modal**

Find the receipt history section (around line 239-254):

```tsx
                  {receipts
                    .filter((r) => r.orderId === selected.id)
                    .map((r) => (
                      <li key={r.id} className="flex items-center justify-between">
                        <span>
                          {r.status === "sent" ? "✓" : "✗"} {formatDateTime(r.sentAt)}
                        </span>
                        <button
                          onClick={() => resendReceipt(r.id)}
                          className="text-xs text-coral hover:underline"
                        >
                          Resend
                        </button>
                      </li>
                    ))}
```

Replace with:

```tsx
                  {receipts
                    .filter((r) => r.orderId === selected.id)
                    .map((r) => (
                      <li key={r.id} className="flex items-center justify-between">
                        <span>
                          {r.status === "sent" ? "✓" : r.status === "printed" ? "🖨" : "✗"} {formatDateTime(r.sentAt)}
                        </span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => window.open(receiptHtmlUrl(r.id))}
                            className="text-xs text-cocoa-muted hover:underline"
                          >
                            Print
                          </button>
                          <button
                            onClick={() => resendReceipt(r.id)}
                            className="text-xs text-coral hover:underline"
                          >
                            Resend
                          </button>
                        </div>
                      </li>
                    ))}
```

- [ ] **Step 5: Run typecheck**

Run: `cd home-bakery-management-system && npx tsc --noEmit`
Expected: No new type errors.

- [ ] **Step 6: Commit**

```bash
git add home-bakery-management-system/src/pages/Orders.tsx
git commit -m "feat: auto-generate receipt on Record Payment + Print buttons in order detail"
```

---

### Task 7: Receipts.tsx — Print button + Print Only badge

**Files:**
- Modify: `home-bakery-management-system/src/pages/Receipts.tsx` (imports line 2-4; status badge ~line 90-99; action button ~line 103-112)

**Interfaces:**
- Consumes: `receiptHtmlUrl` from `api.ts` (Task 3), `Receipt.status` includes `"printed"` (Task 3).
- Produces: Receipts page shows a "Print" button per row and a "Print Only" badge for `printed` status.

- [ ] **Step 1: Add imports**

In `home-bakery-management-system/src/pages/Receipts.tsx`, find the imports (lines 2-5):

```tsx
import { MailCheck, MailX, RotateCw, Search } from "lucide-react";
import { useStore } from "../context/StoreContext";
import { formatCurrency, formatDateTime, PAYMENT_METHOD_LABELS, formatPaymentSubMethod } from "../utils/format";
import type { Receipt } from "../types";
```

Add `Printer` to the lucide-react import and `receiptHtmlUrl`:

```tsx
import { MailCheck, MailX, Printer, RotateCw, Search } from "lucide-react";
import { useStore } from "../context/StoreContext";
import { formatCurrency, formatDateTime, PAYMENT_METHOD_LABELS, formatPaymentSubMethod } from "../utils/format";
import { receiptHtmlUrl } from "../utils/api";
import type { Receipt } from "../types";
```

- [ ] **Step 2: Add "Print Only" badge for `printed` status**

Find the status badge section (around line 90-99):

```tsx
                  <td className="px-4 py-3">
                    {r.status === "sent" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-mid-green/10 px-2 py-0.5 text-xs font-medium text-mid-green">
                        <MailCheck size={12} /> Sent
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                        <MailX size={12} /> Failed
                      </span>
                    )}
                  </td>
```

Replace with a three-way conditional:

```tsx
                  <td className="px-4 py-3">
                    {r.status === "sent" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-mid-green/10 px-2 py-0.5 text-xs font-medium text-mid-green">
                        <MailCheck size={12} /> Sent
                      </span>
                    ) : r.status === "printed" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-sand-200 px-2 py-0.5 text-xs font-medium text-cocoa-muted">
                        <Printer size={12} /> Print Only
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                        <MailX size={12} /> Failed
                      </span>
                    )}
                  </td>
```

- [ ] **Step 3: Add "Print" button next to "Resend"**

Find the action cell (around line 103-112):

```tsx
                  <td className="px-4 py-3">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleResend(r); }}
                      disabled={resending === r.id}
                      className="inline-flex items-center gap-1 rounded-lg border border-sand-200 px-2 py-1 text-xs font-medium text-cocoa-muted transition hover:bg-sand-50 disabled:opacity-50"
                    >
                      <RotateCw size={12} className={resending === r.id ? "animate-spin" : ""} />
                      Resend
                    </button>
                  </td>
```

Replace with two buttons:

```tsx
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); window.open(receiptHtmlUrl(r.id)); }}
                        className="inline-flex items-center gap-1 rounded-lg border border-sand-200 px-2 py-1 text-xs font-medium text-cocoa-muted transition hover:bg-sand-50"
                      >
                        <Printer size={12} />
                        Print
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleResend(r); }}
                        disabled={resending === r.id}
                        className="inline-flex items-center gap-1 rounded-lg border border-sand-200 px-2 py-1 text-xs font-medium text-cocoa-muted transition hover:bg-sand-50 disabled:opacity-50"
                      >
                        <RotateCw size={12} className={resending === r.id ? "animate-spin" : ""} />
                        Resend
                      </button>
                    </div>
                  </td>
```

- [ ] **Step 4: Run typecheck**

Run: `cd home-bakery-management-system && npx tsc --noEmit`
Expected: No new type errors.

- [ ] **Step 5: Commit**

```bash
git add home-bakery-management-system/src/pages/Receipts.tsx
git commit -m "feat: add Print button and Print Only badge to Receipts page"
```

---

### Task 8: End-to-end verification

**Files:** None (verification only)

- [ ] **Step 1: Run all frontend tests**

Run: `cd home-bakery-management-system && npm test`
Expected: All tests pass (80 tests).

- [ ] **Step 2: Run typecheck**

Run: `cd home-bakery-management-system && npx tsc --noEmit`
Expected: No new type errors (pre-existing LabelDesigner/compliance.ts errors are OK).

- [ ] **Step 3: Build the dashboard**

Run: `cd home-bakery-management-system && npm run build`
Expected: Build succeeds, `dist/` produced.

- [ ] **Step 4: Verify Worker syntax**

Run: `cd orders && node --check workers/api.js`
Expected: No errors.

- [ ] **Step 5: Deploy to production (Workers + dashboard)**

Run: `cd orders && npx wrangler deploy --config wrangler.toml`
Expected: `muy-rico-orders-api` deployed.

Run: `cd workers && npx wrangler deploy --config wrangler.toml`
Expected: `muy-rico-checkout` deployed.

Run: `cd home-bakery-management-system && npm run build && cd .. && npx wrangler deploy`
Expected: `muyrico` deployed with updated dashboard.

- [ ] **Step 6: Smoke test the printable receipt endpoint**

Using the existing test receipt (Order #32, receipt id from the D1 query):

Run: `curl -s https://muy-rico-orders-api.bexgarcia0208.workers.dev/api/receipts/rcpt_32_mry82b7l/html | head -5`
Expected: HTML starting with `<div style="font-family: ...">`.

- [ ] **Step 7: Done**

The feature is complete:
1. Printable receipts work via `GET /api/receipts/:id/html` (auto-opens print dialog)
2. Manual orders auto-generate receipts when marked paid (OrderModal + Record Payment)
3. Email field on New Order modal allows emailing receipts for in-person orders
4. Receipts page shows Print buttons + Print Only badge for print-only receipts
