# Dashboard Payment Methods & Manual Entry Design

## Problem

1. PayPal orders from website checkout show undefined labels/colors in the dashboard
2. Stripe/card appears in manual order entry and Record Payment flows, but the business cannot accept cards in person
3. No clean separation between online-only payment methods (Stripe, PayPal) and in-person methods (Venmo, Cash App, Apple Pay, Cash)
4. Stripe and PayPal payments don't show what specific instrument the customer used (e.g., Visa credit card, PayPal wallet)
5. Customer receipt emails don't include the specific card brand or order status
6. No stored history of sent receipts — if a customer loses their email, there's no way to retrieve it

## Design

### 1. Add PayPal to the type system and display code

Extend `PaymentMethod` union type to include `"paypal"`. Add corresponding label, color, and icon entries everywhere payment methods are rendered.

### 2. Online-only vs in-person separation

Create a derived list `getInPersonMethods(profile)` that returns enabled methods minus `"stripe"` and `"paypal"`:

```typescript
function getInPersonMethods(profile: BusinessProfile): PaymentMethod[] {
  return (Object.entries(profile.acceptedMethods) as [PaymentMethod, boolean][])
    .filter(([m, enabled]) => enabled && m !== 'stripe' && m !== 'paypal')
    .map(([m]) => m);
}
```

- **OrderModal.tsx** (manual order creation) — use `getInPersonMethods` for payment dropdown
- **Orders.tsx** Record Payment modal — use `getInPersonMethods` for payment dropdown
- **Settings.tsx** — keep Stripe and PayPal toggles visible (they control the `acceptedMethods` record), but they won't leak into manual flows
- **Payments.tsx** method summary cards — keep using the full `acceptedMethods` so all methods with payments show up

### 3. Payment sub-method details (Stripe & PayPal)

**Storage:**
- New migration (0021): `ALTER TABLE orders ADD COLUMN payment_sub_method TEXT; ALTER TABLE payments ADD COLUMN method_details TEXT;`
- Sub-method stored as JSON string:
  ```json
  // Stripe card
  {"type":"card","brand":"visa","funding":"credit","last4":"4242"}
  // PayPal wallet
  {"type":"paypal_wallet"}
  // PayPal card
  {"type":"card","brand":"VISA","funding":"CREDIT"}
  ```

**Checkout Worker (workers/checkout.js):**
- Stripe webhook: on `payment_intent.succeeded`, fetch the Charge via `GET /v1/charges/{latest_charge}`, extract `payment_method_details`, pass sub-method to `markOrderPaidViaApi`
- PayPal capture (`handlePayPalCapture`): extract `payment_source` from the capture response body, pass sub-method to `markOrderPaidViaApi`
- PayPal webhook: fetch capture details from PayPal API to get `payment_source`

**API Worker (orders/workers/api.js):**
- `markOrderPaid`: accept new `sub_method` field in body, store in `orders.payment_sub_method` and `payments.method_details`
- Order/Payment responses: include `payment_sub_method` / `method_details` fields
- StoreContext mapping: extract these fields when refreshing orders and payments

**Dashboard display:**
- Add `formatPaymentSubMethod(details)` in format.ts — formats JSON into readable string (e.g., "Visa Credit (…4242)", "PayPal Wallet")
- Show sub-method in order detail and payment rows alongside the main method

### 4. Receipt history logging

**Migration (0022):** Create `receipts` table
```sql
CREATE TABLE IF NOT EXISTS receipts (
  id                  TEXT PRIMARY KEY,
  order_id            INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_number        TEXT,
  customer_name       TEXT NOT NULL,
  email               TEXT,
  items_json          TEXT NOT NULL,
  total_cents         INTEGER NOT NULL DEFAULT 0,
  payment_method      TEXT NOT NULL,
  payment_sub_method  TEXT,
  order_status        TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'sent',   -- 'sent' | 'failed'
  message_id          TEXT,                             -- Resend email ID for traceability
  sent_at             TEXT NOT NULL DEFAULT (datetime('now')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_receipts_order   ON receipts(order_id);
CREATE INDEX IF NOT EXISTS idx_receipts_email   ON receipts(email);
CREATE INDEX IF NOT EXISTS idx_receipts_created ON receipts(created_at DESC);
```

**Receipt email flow changes (api.js `sendCustomerConfirmation`):**
- Change return type from `void` to `{ ok: boolean, messageId?: string }`
- Capture Resend API response: on success, parse `res.json()` to get `id` (Resend message ID)
- On failure, return `{ ok: false }`

**Receipt logging in `markOrderPaid` (after the email call):**
- Call `sendCustomerConfirmation` and await its result (currently fire-and-forget via `ctx.waitUntil`)
- INSERT a row into `receipts` table with: order snapshot, payment method + sub-method, order status, send status ('sent' or 'failed'), Resend message_id if available
- Also INSERT an `order_events` row with event `receipt:sent` or `receipt:failed` for audit trail consistency

**API Worker endpoints (behind Cloudflare Access, same as /api/payments):**
- `GET /api/receipts` — list receipts (filterable by order_id, email, date range, search)
- `GET /api/receipts/:id` — single receipt detail
- `POST /api/receipts/:id/resend` — re-trigger `sendCustomerConfirmation`, insert new receipt row
- Receipt responses include mapped field names (camelCase on frontend)

**Dashboard:**
- New `Receipts` page (separate nav item in sidebar)
  - Table with columns: Order#, Customer, Email, Payment Method (with sub-method), Order Status, Send Status, Total, Sent Date
  - Search/filter by order number, customer name, email, date range
  - Status badge: green "Sent", red "Failed"
  - Click row to expand/view full receipt content (items table, payment method, order status)
  - "Resend" button on each row (re-sends the email, creates a new receipt row)
- Add Receipts tab/section inside the Orders detail modal showing all receipts for that order

**Receipt email content update:**
- Include `payment_sub_method` in the method label (e.g., "Visa Credit" instead of just "Card")
- Include order status in the summary table
- These fields come from the already-updated order table (section 3)

### 5. Files changed

| File | Change |
|---|---|
| `orders/migrations/0021_payment_sub_method.sql` | Add columns to orders + payments tables |
| `orders/migrations/0022_receipts.sql` | Create receipts table with status + message_id + indexes |
| `workers/checkout.js` | Fetch Stripe charge details; extract PayPal payment_source; pass to mark-paid |
| `orders/workers/api.js` | Accept `sub_method` in mark-paid; store receipt on send (with Resend message_id + status); add GET /api/receipts + GET /api/receipts/:id + POST /api/receipts/:id/resend endpoints; log receipt:sent/failed in order_events; include sub-method in order/payment responses; update receipt email template with sub-method label + order status |
| `src/types.ts` | Add `"paypal"` to `PaymentMethod`; add `paymentSubMethod` to `Order`; add `methodDetails` to `Payment`; add `Receipt` interface |
| `src/utils/format.ts` | Add `PAYMENT_METHOD_LABELS/COLORS` for paypal; add `formatPaymentSubMethod()` |
| `src/pages/Payments.tsx` | Add PayPal icon; show method_details in rows |
| `src/pages/Settings.tsx` | Add PayPal icon and toggle |
| `src/components/OrderModal.tsx` | Replace `getEnabledMethods()` with in-person-only filter |
| `src/pages/Orders.tsx` | Replace method filter in Record Payment with in-person-only filter; add Receipts section in order detail modal |
| `src/context/StoreContext.tsx` | Map `payment_sub_method` → `paymentSubMethod` in order refresh; map `method_details` → `methodDetails` in payment refresh; map receipt fields in new receipt refresh |
| `src/data/seedData.ts` | Add `paypal: false` to default accepted methods |
| `src/pages/Receipts.tsx` | **New** — Receipt history list with search, status badges, receipt detail expansion, and Resend button |
| `src/components/Sidebar.tsx` | Add Receipts nav item |
| `src/App.tsx` | Add `"receipts"` to `Page` type union; add Receipts route in main content switch |
