# Printable Receipts & Manual Order Receipt Generation — Design Spec

**Date:** 2026-07-23
**Status:** Approved

## Goal

Add two capabilities to the Muy Rico dashboard:

1. **Printable receipts** — view and print a receipt from the dashboard (for customers who want a printed copy), using the same branded layout as the email receipt.
2. **Auto-generate receipts for manual orders** — when an in-person order is marked paid (cash, Venmo, etc.), automatically create a receipt row. If the customer has an email, also email it. This makes the dashboard behave like a store POS — every paid order gets a receipt, not just online payments.

## Architecture

Two new admin-only endpoints on the orders Worker:

- `GET /api/receipts/:id/html` — returns the receipt as a standalone HTML page that auto-triggers `window.print()`. Shares a single `buildReceiptHtml(order, isEn)` function with the email path so there's one receipt template.
- `POST /api/orders/:id/generate-receipt` — fetches the order, sends the email if an email address exists, logs the receipt row, and returns the receipt info. Called by the dashboard after recording a manual payment or creating a paid order.

The dashboard gains:
- "Print" buttons on the Receipts page and Orders detail modal
- An optional email field on the New Order modal
- Automatic `generateReceipt` calls after manual payment flows

## Component Design

### 1. Receipt HTML template extraction (`orders/workers/api.js`)

The inline HTML currently built inside `sendCustomerConfirmation` (lines ~662-839) is extracted into a standalone function:

```js
function buildReceiptHtml(order, isEn) { ... }
```

This function takes an order object (with `customer_name`, `items_json`, `total_cents`, `payment_method`, `payment_sub_method`, `status`, `pickup_date`, `pickup_time`, `id`, `created_at`) and a boolean `isEn`, and returns an HTML string. Both `sendCustomerConfirmation` and the new `/html` endpoint call it. No visual changes to the email.

The existing `buildMethodLabel(order, isEn)` and `formatStatusLabel(status, isEn)` helpers remain — `buildReceiptHtml` calls them internally.

### 2. Printable receipt endpoint (`GET /api/receipts/:id/html`)

- **Route:** `GET /api/receipts/:id/html`
- **Auth:** Admin-only (behind Cloudflare Access — NOT added to `isPublic*` allowlist)
- **Returns:** `text/html` content type
- **Behavior:**
  1. Fetch the receipt row by ID
  2. Reconstruct an order-like object from the receipt's snapshot fields (`customer_name`, `items_json`, `total_cents`, `payment_method`, `payment_sub_method`, `order_status`, `pickup_date` stored as `sent_at` for display)
  3. Call `buildReceiptHtml(order, isEn)` — language defaults to `'en'` since receipts don't store language; the order's original language is not snapshotted (acceptable — receipts print in English)
  4. Append `<script>window.print()</script>` before `</body>` so the browser auto-opens the print dialog
  5. Return the HTML as a `Response` with `Content-Type: text/html`

### 3. Generate-receipt endpoint (`POST /api/orders/:id/generate-receipt`)

- **Route:** `POST /api/orders/:id/generate-receipt`
- **Auth:** Admin-only (behind Cloudflare Access — uses `actorEmail` from the request)
- **Returns:** JSON `{ ok, receiptId, status, messageId }`
- **Behavior:**
  1. Fetch the order by ID (`SELECT * FROM orders WHERE id = ?`)
  2. If order has `email` and `env.RESEND_API_KEY` is set → call `sendCustomerConfirmation(env, order)` which returns `{ ok, messageId }`
  3. If no email → set `emailResult = { ok: false, messageId: null }` (no email sent)
  4. Call `logReceipt(env, order, emailResult, orderId)` — but pass `status: 'printed'` instead of `'failed'` when there was no email to send (see `logReceipt` change below)
  5. Log an `order_events` row: `receipt:generated`
  6. Return `{ ok: true, receiptId, status: emailResult.ok ? 'sent' : 'printed', messageId: emailResult.messageId || null }`

### 4. `logReceipt` modification (`orders/workers/api.js`)

The `logReceipt(env, order, emailResult, orderId)` function currently sets status to `'sent'` or `'failed'`. Add a third case:

- If `emailResult.ok` is `true` → `status = 'sent'`
- If `emailResult` has a `skipped` flag (no email available) → `status = 'printed'`
- Otherwise → `status = 'failed'`

The `generateReceipt` endpoint passes `{ ok: false, messageId: null, skipped: true }` when there's no email, so `logReceipt` stores `'printed'` instead of `'failed'`.

### 5. Dashboard API client (`home-bakery-management-system/src/utils/api.ts`)

Add two functions:

```typescript
export async function generateReceipt(orderId: number): Promise<{ ok: boolean; receiptId: string; status: string; messageId: string | null }> {
  return apiFetch(`/api/orders/${orderId}/generate-receipt`, { method: "POST" });
}

export function receiptHtmlUrl(receiptId: string): string {
  return `${ORDERS_API_BASE}/api/receipts/${encodeURIComponent(receiptId)}/html`;
}
```

`ORDERS_API_BASE` is already defined in the api.ts module (used by other fetch calls).

### 6. StoreContext (`home-bakery-management-system/src/context/StoreContext.tsx`)

- Add `generateReceipt: (orderId: number) => Promise<void>` to the context interface and value
- Implementation calls `generateReceiptApi(orderId)`, then `refreshReceipts()`
- Existing `resendReceipt` and `refreshReceipts` remain unchanged

### 7. OrderModal email field (`home-bakery-management-system/src/components/OrderModal.tsx`)

- Add `email` state (`useState("")`)
- Add an email `<input>` in the "New customer" section, between the phone input and the date field. Labeled "Email (for receipt)" with placeholder "customer@email.com"
- Pass `email: email.trim() || null` in the `apiCreateOrder` payload
- After `apiCreateOrder` returns `{ id }`, if `paymentStatus === 'paid'` → call `generateReceipt(id)` (fire-and-forget, no await needed — the receipt generates in the background)
- Add `generateReceipt` to the `useStore()` destructure

### 8. Orders.tsx — Record Payment + Print buttons (`home-bakery-management-system/src/pages/Orders.tsx`)

**Record Payment flow (`confirmPayment`):**
- After `apiUpdateOrder` + `recordPayment`, call `generateReceipt(Number(payFor.id))`
- Then call `refreshReceipts()` (already in the store's `generateReceipt` implementation)

**Print Receipt in order detail modal:**
- In the existing receipt history section, add a "Print" button next to each receipt's "Resend" button
- Uses `window.open(receiptHtmlUrl(r.id))` to open the printable receipt in a new tab

### 9. Receipts.tsx — Print button + Print Only badge (`home-bakery-management-system/src/pages/Receipts.tsx`)

- Add a "Print" button next to the existing "Resend" button in each receipt row
- Uses `window.open(receiptHtmlUrl(r.id))`
- Add a "Print Only" badge (printer icon) for receipts with `status === 'printed'` — distinct from "Sent" (green) and "Failed" (red)
- Import `Printer` icon from lucide-react

### 10. Types (`home-bakery-management-system/src/types.ts`)

Update the `Receipt` interface `status` field:

```typescript
status: "sent" | "failed" | "printed";
```

## Data Flow

### Manual order (New Order modal, paid):
```
OrderModal.handleSubmit()
  → apiCreateOrder (payment_status: 'paid', email: optional)
  → if paid: generateReceipt(orderId)
    → POST /api/orders/:id/generate-receipt
    → fetch order → sendCustomerConfirmation (if email) → logReceipt
  → refreshReceipts()
```

### Record Payment (Orders.tsx):
```
confirmPayment()
  → apiUpdateOrder (payment_status: 'paid')
  → recordPayment (creates payment row)
  → generateReceipt(orderId)
    → POST /api/orders/:id/generate-receipt
    → fetch order → sendCustomerConfirmation (if email) → logReceipt
  → refreshReceipts()
```

### Print receipt:
```
User clicks "Print" (Receipts page or Orders detail)
  → window.open(receiptHtmlUrl(receiptId))
  → GET /api/receipts/:id/html
  → fetch receipt → buildReceiptHtml() → HTML + window.print()
  → browser opens print dialog
```

## Edge Cases

- **No email on the order**: receipt created with `status: 'printed'`, no email sent. Still printable.
- **Order already has a receipt**: generating again creates a new receipt row (same as resend behavior — history preserves all attempts).
- **RESEND_API_KEY not set**: `sendCustomerConfirmation` returns `{ ok: false }`, receipt logged as `failed`. Still printable.
- **Existing customer with email**: when "Existing customer" is selected in OrderModal, the customer's email from the `customers` table is passed to `apiCreateOrder`. (The OrderModal already has access to the customer object — just needs to pass `email` from it.)
- **Online orders**: unchanged — still go through checkout Worker → `mark-paid` → receipt logging (status `'sent'` or `'failed'`).

## No Changes To

- The website (`order.html`) — online orders still use the checkout Worker flow
- D1 schema — the existing `receipts` table has all needed columns. The `'printed'` status is a string value, no migration needed.
- The `markOrderPaid` webhook flow — it already logs receipts

## Files

| File | Action | Responsibility |
|---|---|---|
| `orders/workers/api.js` | Modify | Extract `buildReceiptHtml()`; add `GET /api/receipts/:id/html`; add `POST /api/orders/:id/generate-receipt`; modify `logReceipt` for `printed` status; add route dispatch |
| `home-bakery-management-system/src/utils/api.ts` | Modify | Add `generateReceipt()` + `receiptHtmlUrl()` functions |
| `home-bakery-management-system/src/context/StoreContext.tsx` | Modify | Add `generateReceipt` to context + value |
| `home-bakery-management-system/src/components/OrderModal.tsx` | Modify | Add email input field; call `generateReceipt` after creating paid order |
| `home-bakery-management-system/src/pages/Orders.tsx` | Modify | Call `generateReceipt` in `confirmPayment`; add "Print" buttons in receipt history |
| `home-bakery-management-system/src/pages/Receipts.tsx` | Modify | Add "Print" button; add "Print Only" badge for `printed` status |
| `home-bakery-management-system/src/types.ts` | Modify | Add `"printed"` to `Receipt.status` union |
