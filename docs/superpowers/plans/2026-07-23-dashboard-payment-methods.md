# Dashboard Payment Methods, Sub-Method Details & Receipt Logging — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display PayPal orders in the dashboard, separate online-only payment methods (Stripe/PayPal) from in-person ones (Venmo/Cash App/Apple Pay/Cash) in manual entry flows, capture and display the specific payment instrument the customer used (e.g., "Visa Credit (…4242)", "PayPal Wallet"), log every customer receipt email to a `receipts` table with send status + Resend message ID, and add a Receipts page for browsing/resending receipt history.

**Architecture:** Three layers of change: (1) D1 schema adds `payment_sub_method` to `orders` + `method_details` to `payments`, plus a new `receipts` table; (2) the checkout Worker fetches Stripe Charge / PayPal `payment_source` details and passes them through the existing `mark-paid` endpoint; (3) the dashboard SPA adds a `Receipts` page, a `formatPaymentSubMethod()` helper, and an `ONLINE_ONLY` constant that filters Stripe/PayPal out of in-person dropdowns. The API Worker's `sendCustomerConfirmation` gains a return value (`{ ok, messageId }`) so the new receipt-logging code in `markOrderPaid` can record sent-vs-failed and the Resend message ID.

**Tech Stack:** Cloudflare Workers (module syntax), Cloudflare D1 (SQLite), Stripe Payments API (`GET /v1/charges/:id`), PayPal Orders v2 (`payment_source`), Resend email API, React 19 + Vite + TypeScript + Tailwind v4, Vitest (jsdom).

## Global Constraints

- The `PaymentMethod` union type (`src/types.ts:1`) MUST include `"paypal"` after Task 1 — every downstream file relies on it.
- All new D1 columns are nullable `TEXT` — no `NOT NULL` on `payment_sub_method`, `method_details`, or `message_id`. Existing rows must remain valid.
- Migrations are applied with: `npx wrangler d1 execute muy-rico-orders --file=migrations/NNNN_name.sql` (local) and `--remote` (production). Both MUST be run for each migration.
- `/api/receipts` endpoints are **admin-only** (behind Cloudflare Access), same auth pattern as `/api/payments`. Do NOT add them to the `isPublic*` allowlist in `api.js:82-101`.
- `sendCustomerConfirmation` MUST remain safe to call when `RESEND_API_KEY` is unset — it returns `{ ok: false }` (not throws).
- Sub-method JSON is stored as a JSON-encoded **string** in TEXT columns. The dashboard parses it with `JSON.parse` inside `formatPaymentSubMethod` (guarded by try/catch).
- No changes to `order.html` or the website — the website still sends `payment_method: 'stripe'` at order creation; the checkout Worker upgrades it to the real method + sub-method on `mark-paid`.
- Commit after every task. Conventional commit format: `feat:`, `fix:`, `test:`, `chore:`, `refactor:`.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `orders/migrations/0021_payment_sub_method.sql` | Create | Add `payment_sub_method` to `orders`, `method_details` to `payments` |
| `orders/migrations/0022_receipts.sql` | Create | Create `receipts` table with indexes |
| `home-bakery-management-system/src/utils/format.test.ts` | Create | Vitest tests for `formatPaymentSubMethod` |
| `home-bakery-management-system/src/utils/format.ts` | Modify | Add `paypal` to labels/colors; add `formatPaymentSubMethod()` + `ONLINE_ONLY` |
| `home-bakery-management-system/src/types.ts` | Modify | Add `"paypal"` to `PaymentMethod`; add `paymentSubMethod` to `Order`; add `methodDetails` to `Payment`; add `Receipt` interface |
| `home-bakery-management-system/src/data/seedData.ts` | Modify | Add `paypal: false` to default `acceptedMethods` |
| `orders/workers/api.js` | Modify | Store/return `payment_sub_method` + `method_details`; `sendCustomerConfirmation` returns result; receipt logging in `markOrderPaid`; add `GET /api/receipts`, `GET /api/receipts/:id`, `POST /api/receipts/:id/resend`; update receipt email template (sub-method + status) |
| `workers/checkout.js` | Modify | Fetch Stripe Charge details; extract PayPal `payment_source`; pass `sub_method` to `markOrderPaidViaApi` |
| `home-bakery-management-system/src/utils/api.ts` | Modify | Add `ApiReceipt` interface; add `fetchReceipts`, `resendReceipt`; add `payment_sub_method` to `ApiOrder` |
| `home-bakery-management-system/src/context/StoreContext.tsx` | Modify | Map `payment_sub_method`→`paymentSubMethod` in orders; map `method_details`→`methodDetails` in payments; add receipts state + `refreshReceipts` + `resendReceipt` |
| `home-bakery-management-system/src/components/OrderModal.tsx` | Modify | Filter Stripe/PayPal out of payment method dropdown |
| `home-bakery-management-system/src/pages/Orders.tsx` | Modify | Filter Stripe/PayPal out of Record Payment dropdown; show sub-method in order detail; add Receipts section in order detail modal |
| `home-bakery-management-system/src/pages/Payments.tsx` | Modify | Add PayPal to `METHOD_ICONS`; show sub-method in rows |
| `home-bakery-management-system/src/pages/Settings.tsx` | Modify | Add PayPal to `METHOD_ICONS` + toggle |
| `home-bakery-management-system/src/pages/Receipts.tsx` | Create | Receipt history list + detail + Resend button |
| `home-bakery-management-system/src/components/Sidebar.tsx` | Modify | Add Receipts nav item |
| `home-bakery-management-system/src/App.tsx` | Modify | Add `"receipts"` to `Page` union; add Receipts route |

---

### Task 1: Add `paypal` to the type system and display labels

**Files:**
- Modify: `home-bakery-management-system/src/types.ts:1` (PaymentMethod), `:103-122` (Order), `:124-133` (Payment), append `Receipt` interface
- Modify: `home-bakery-management-system/src/utils/format.ts:34-48` (labels/colors), append `formatPaymentSubMethod` + `ONLINE_ONLY`
- Modify: `home-bakery-management-system/src/data/seedData.ts:418` (acceptedMethods)
- Create: `home-bakery-management-system/src/utils/format.test.ts`

**Interfaces:**
- Produces: `PaymentMethod` now includes `"paypal"`. `PAYMENT_METHOD_LABELS["paypal"] === "PayPal"`. `PAYMENT_METHOD_COLORS["paypal"] === "#0070BA"`. `formatPaymentSubMethod(jsonString | null | undefined): string` returns readable labels. `ONLINE_ONLY: PaymentMethod[]` equals `["stripe", "paypal"]`. `Order.paymentSubMethod?: string | null`. `Payment.methodDetails?: string | null`. `Receipt` interface available for Task 10.

- [ ] **Step 1: Write the failing tests for `formatPaymentSubMethod`**

Create `home-bakery-management-system/src/utils/format.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { formatPaymentSubMethod, PAYMENT_METHOD_LABELS, PAYMENT_METHOD_COLORS } from "./format";

describe("PAYMENT_METHOD_LABELS", () => {
  it("includes paypal", () => {
    expect(PAYMENT_METHOD_LABELS.paypal).toBe("PayPal");
  });
});

describe("PAYMENT_METHOD_COLORS", () => {
  it("includes paypal", () => {
    expect(PAYMENT_METHOD_COLORS.paypal).toBe("#0070BA");
  });
});

describe("formatPaymentSubMethod", () => {
  it("returns empty string for null/undefined/empty", () => {
    expect(formatPaymentSubMethod(null)).toBe("");
    expect(formatPaymentSubMethod(undefined)).toBe("");
    expect(formatPaymentSubMethod("")).toBe("");
  });

  it("returns empty string for invalid JSON", () => {
    expect(formatPaymentSubMethod("not-json")).toBe("");
  });

  it("formats Stripe card with last4", () => {
    const json = JSON.stringify({ type: "card", brand: "visa", funding: "credit", last4: "4242" });
    expect(formatPaymentSubMethod(json)).toBe("Visa Credit (…4242)");
  });

  it("formats Stripe card without last4", () => {
    const json = JSON.stringify({ type: "card", brand: "mastercard", funding: "debit" });
    expect(formatPaymentSubMethod(json)).toBe("Mastercard Debit");
  });

  it("formats PayPal wallet", () => {
    const json = JSON.stringify({ type: "paypal_wallet" });
    expect(formatPaymentSubMethod(json)).toBe("PayPal Wallet");
  });

  it("formats PayPal card (uppercase brand/funding)", () => {
    const json = JSON.stringify({ type: "card", brand: "VISA", funding: "CREDIT" });
    expect(formatPaymentSubMethod(json)).toBe("Visa Credit");
  });

  it("formats unknown card brand", () => {
    const json = JSON.stringify({ type: "card", brand: "unknown", funding: "unknown" });
    expect(formatPaymentSubMethod(json)).toBe("Card");
  });

  it("formats link type", () => {
    const json = JSON.stringify({ type: "link" });
    expect(formatPaymentSubMethod(json)).toBe("Link");
  });

  it("capitalizes brand and funding", () => {
    const json = JSON.stringify({ type: "card", brand: "AMEX", funding: "CREDIT", last4: "0001" });
    expect(formatPaymentSubMethod(json)).toBe("Amex Credit (…0001)");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd home-bakery-management-system && npm test -- src/utils/format.test.ts`
Expected: FAIL — `formatPaymentSubMethod` is not exported, `paypal` label is undefined.

- [ ] **Step 3: Update `types.ts`**

Edit `home-bakery-management-system/src/types.ts:1`:

```typescript
export type PaymentMethod = "stripe" | "paypal" | "cashapp" | "venmo" | "applepay" | "cash";
```

Edit the `Order` interface (line 103-122) — add `paymentSubMethod` after `paymentMethod`:

```typescript
export interface Order {
  id: string;
  orderNumber: string;
  customerId: string | null;
  customerName: string;
  phone: string;
  items: OrderItem[];
  source: OrderSource;
  status: OrderStatus;
  paymentMethod: PaymentMethod | null;
  paymentSubMethod?: string | null;
  paymentStatus: PaymentStatus;
  subtotal: number;
  discount: number;
  total: number;
  dueDate: string;
  createdAt: string;
  notes: string;
  inventoryDeducted: boolean;
  foodColoring?: string | null;
}
```

Edit the `Payment` interface (line 124-133) — add `methodDetails`:

```typescript
export interface Payment {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  amount: number;
  method: PaymentMethod;
  methodDetails?: string | null;
  date: string;
  active?: boolean;
}
```

Append the `Receipt` interface at the end of the file (after `ComplianceResult`):

```typescript
export interface Receipt {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  email: string | null;
  itemsJson: string;
  totalCents: number;
  paymentMethod: string;
  paymentSubMethod: string | null;
  orderStatus: string;
  status: "sent" | "failed";
  messageId: string | null;
  sentAt: string;
  createdAt: string;
}
```

- [ ] **Step 4: Update `format.ts`**

Edit `home-bakery-management-system/src/utils/format.ts` — replace the `PAYMENT_METHOD_LABELS` and `PAYMENT_METHOD_COLORS` blocks (lines 34-48) and append the new helpers:

```typescript
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  stripe: "Card (Stripe)",
  paypal: "PayPal",
  cashapp: "Cash App",
  venmo: "Venmo",
  applepay: "Apple Pay",
  cash: "Cash",
};

export const PAYMENT_METHOD_COLORS: Record<string, string> = {
  stripe: "#635BFF",
  paypal: "#0070BA",
  cashapp: "#00D632",
  venmo: "#3D95CE",
  applepay: "#111111",
  cash: "#2E7D32",
};

export const ONLINE_ONLY: PaymentMethod[] = ["stripe", "paypal"];

export function formatPaymentSubMethod(details: string | null | undefined): string {
  if (!details) return "";
  let parsed: { type?: string; brand?: string; funding?: string; last4?: string };
  try {
    parsed = JSON.parse(details);
  } catch {
    return "";
  }
  if (!parsed || typeof parsed !== "object") return "";
  const type = parsed.type || "";
  if (type === "paypal_wallet") return "PayPal Wallet";
  if (type === "link") return "Link";
  if (type === "card") {
    const brand = (parsed.brand || "").toLowerCase();
    const funding = (parsed.funding || "").toLowerCase();
    const brandLabel = BRAND_LABELS[brand] || (brand ? capitalize(brand) : "Card");
    const fundingLabel = FUNDING_LABELS[funding] || "";
    const last4 = parsed.last4 ? ` (…${parsed.last4})` : "";
    const parts = [brandLabel, fundingLabel].filter(Boolean).join(" ");
    return `${parts}${last4}`;
  }
  return capitalize(type) || "";
}

const BRAND_LABELS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "Amex",
  american_express: "Amex",
  discover: "Discover",
  diners: "Diners",
  jcb: "JCB",
  unionpay: "UnionPay",
  union_pay: "UnionPay",
  link: "Link",
  eftpos_au: "EFTPOS",
  cartes_bancaires: "Cartes Bancaires",
  unknown: "",
};

const FUNDING_LABELS: Record<string, string> = {
  credit: "Credit",
  debit: "Debit",
  prepaid: "Prepaid",
  unknown: "",
};

function capitalize(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
```

You also need to add the `PaymentMethod` import at the top of `format.ts`:

```typescript
import type { PaymentMethod } from "../types";
```

- [ ] **Step 5: Update `seedData.ts`**

Find the `seedProfile` object's `acceptedMethods` (around line 418) and add `paypal: false`:

```typescript
acceptedMethods: { stripe: false, paypal: false, cashapp: true, venmo: true, applepay: true, cash: true }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd home-bakery-management-system && npm test -- src/utils/format.test.ts`
Expected: PASS — all 11 tests green.

- [ ] **Step 7: Run typecheck**

Run: `cd home-bakery-management-system && npx tsc --noEmit`
Expected: No new type errors (existing ones in the codebase are OK).

- [ ] **Step 8: Commit**

```bash
git add home-bakery-management-system/src/types.ts home-bakery-management-system/src/utils/format.ts home-bakery-management-system/src/utils/format.test.ts home-bakery-management-system/src/data/seedData.ts
git commit -m "feat: add paypal to PaymentMethod type and formatPaymentSubMethod helper"
```

---

### Task 2: D1 migration — add `payment_sub_method` columns

**Files:**
- Create: `orders/migrations/0021_payment_sub_method.sql`

**Interfaces:**
- Produces: `orders.payment_sub_method TEXT` (nullable) and `payments.method_details TEXT` (nullable). Existing rows keep working (NULL values).

- [ ] **Step 1: Write the migration**

Create `orders/migrations/0021_payment_sub_method.sql`:

```sql
-- Add payment_sub_method to orders and method_details to payments.
-- Both store a JSON string describing the specific instrument the customer used
-- (e.g. {"type":"card","brand":"visa","funding":"credit","last4":"4242"}).
-- Nullable so existing rows remain valid.
ALTER TABLE orders   ADD COLUMN payment_sub_method TEXT;
ALTER TABLE payments ADD COLUMN method_details    TEXT;
```

- [ ] **Step 2: Apply migration locally**

Run: `cd orders && npx wrangler d1 execute muy-rico-orders --file=migrations/0021_payment_sub_method.sql`
Expected: Both ALTER statements succeed.

- [ ] **Step 3: Apply migration to remote (production)**

Run: `cd orders && npx wrangler d1 execute muy-rico-orders --remote --file=migrations/0021_payment_sub_method.sql`
Expected: Both ALTER statements succeed.

- [ ] **Step 4: Commit**

```bash
git add orders/migrations/0021_payment_sub_method.sql
git commit -m "feat: migration 0021 — add payment_sub_method + method_details columns"
```

---

### Task 3: API Worker — store and return `payment_sub_method`

**Files:**
- Modify: `orders/workers/api.js:484-555` (`markOrderPaid`), `:415-449` (`listOrders` returns `SELECT *` so the new column is included automatically)

**Interfaces:**
- Consumes: `markOrderPaid` request body now accepts optional `sub_method` (JSON string).
- Produces: `orders.payment_sub_method` and `payments.method_details` are written. `GET /api/orders` returns the new column (via `SELECT *`). Later tasks map it in StoreContext.

- [ ] **Step 1: Update `markOrderPaid` to accept and store `sub_method`**

Edit `orders/workers/api.js` in the `markOrderPaid` function (starts at line 484). Find the body-parsing block:

```js
let body;
try { body = await request.json(); } catch { body = {}; }
const method = body.method;
if (!method || !ALLOWED_PAYMENT.includes(method)) {
  return json({ error: `Invalid or missing method. Must be one of: ${ALLOWED_PAYMENT.join(', ')}` }, 400);
}
```

Add `sub_method` extraction right after:

```js
const subMethod = body.sub_method || null;
```

Then find the UPDATE for `payment_status`/`payment_method` (around line 506-509):

```js
if (!alreadyPaid) {
  await env.DB.prepare(`
    UPDATE orders SET payment_status = 'paid', payment_method = ? WHERE id = ?
  `).bind(method, id).run();
}
```

Change it to also set `payment_sub_method`:

```js
if (!alreadyPaid) {
  await env.DB.prepare(`
    UPDATE orders SET payment_status = 'paid', payment_method = ?, payment_sub_method = ? WHERE id = ?
  `).bind(method, subMethod, id).run();
}
```

Then find the INSERT into `payments` (around line 523-526):

```js
await env.DB.prepare(`
  INSERT INTO payments (id, order_id, customer_name, amount, method, date, created_at, active)
  VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), 1)
`).bind(payId, id, customerName, amount, method).run();
```

Change it to include `method_details`:

```js
await env.DB.prepare(`
  INSERT INTO payments (id, order_id, customer_name, amount, method, method_details, date, created_at, active)
  VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 1)
`).bind(payId, id, customerName, amount, method, subMethod).run();
```

- [ ] **Step 2: Verify `listOrders` and `listPayments` return the new columns**

`listOrders` (line 440-447) uses `SELECT * FROM orders` — the new `payment_sub_method` column is included automatically. No change needed.

`listPayments` (line 1386-1390) uses `SELECT * FROM payments` and passes through `snakeToCamelObject` — the new `method_details` column becomes `methodDetails` automatically. No change needed.

- [ ] **Step 3: Verify locally with curl (optional sanity check)**

Run the orders worker locally: `cd orders && npx wrangler dev`
Then in another terminal, send a test mark-paid (replace SECRET with your `PAYMENT_WEBHOOK_SECRET`):

```bash
curl -X POST http://localhost:8787/api/orders/1/mark-paid \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: SECRET" \
  -d '{"method":"stripe","sub_method":"{\"type\":\"card\",\"brand\":\"visa\",\"funding\":\"credit\",\"last4\":\"4242\"}"}'
```

Expected: `{"ok":true}`. Query D1 to confirm the column was written:

```bash
cd orders && npx wrangler d1 execute muy-rico-orders --command "SELECT id, payment_method, payment_sub_method FROM orders WHERE id = 1"
```

Expected: the row shows `payment_sub_method` with the JSON string.

- [ ] **Step 4: Commit**

```bash
git add orders/workers/api.js
git commit -m "feat: store payment_sub_method + method_details in markOrderPaid"
```

---

### Task 4: Checkout Worker — fetch Stripe Charge details and PayPal `payment_source`

**Files:**
- Modify: `workers/checkout.js:104-156` (`handleStripeWebhook`), `:167-187` (`markOrderPaidViaApi`), `:189-253` (`handlePayPalWebhook`), `:315-373` (`handlePayPalCapture`)

**Interfaces:**
- Consumes: `markOrderPaidViaApi` gains an optional `subMethod` 4th argument.
- Produces: Stripe and PayPal webhook/capture flows now POST `{ method, sub_method }` to the API Worker. The `sub_method` value is a JSON string.

- [ ] **Step 1: Update `markOrderPaidViaApi` to accept and forward `subMethod`**

Edit `workers/checkout.js` at line 167. Change the signature and body:

```js
async function markOrderPaidViaApi(orderId, method, env, subMethod = null) {
  try {
    const res = await ordersApiFetch(env, "/api/orders/" + encodeURIComponent(orderId) + "/mark-paid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, sub_method: subMethod }),
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

- [ ] **Step 2: Extract Stripe Charge details in `handleStripeWebhook`**

Edit `workers/checkout.js` in `handleStripeWebhook` (line 104). After the existing block that determines `orderId` (around line 144-147), and before the `markOrderPaidViaApi` call (line 148), add a charge-details fetch.

Find this block:

```js
if (!orderId) {
  console.warn(`stripe ${event.type} without order id — ignored`);
  return json({ received: true });
}
const ok = await markOrderPaidViaApi(orderId, "stripe", env);
```

Replace with:

```js
if (!orderId) {
  console.warn(`stripe ${event.type} without order id — ignored`);
  return json({ received: true });
}

// Fetch charge details to capture the specific card/instrument used.
const subMethod = await extractStripeSubMethod(event, obj, env);

const ok = await markOrderPaidViaApi(orderId, "stripe", env, subMethod);
```

Then add the helper function after `markOrderPaidViaApi` (before `handlePayPalWebhook`):

```js
async function extractStripeSubMethod(event, obj, env) {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) return null;
  try {
    let chargeId = null;
    if (event.type === "payment_intent.succeeded") {
      chargeId = obj.latest_charge || (obj.charges && obj.charges.data && obj.charges.data[0] && obj.charges.data[0].id);
    } else if (event.type === "checkout.session.completed") {
      // obj is a checkout session — expand payment_intent to get the charge
      const piId = typeof obj.payment_intent === "string" ? obj.payment_intent : null;
      if (piId) {
        const piRes = await fetch("https://api.stripe.com/v1/payment_intents/" + piId, {
          headers: { Authorization: "Bearer " + key },
        });
        const pi = await piRes.json();
        chargeId = pi.latest_charge || (pi.charges && pi.charges.data && pi.charges.data[0] && pi.charges.data[0].id);
      }
    }
    if (!chargeId) return null;
    const chargeRes = await fetch("https://api.stripe.com/v1/charges/" + chargeId, {
      headers: { Authorization: "Bearer " + key },
    });
    const charge = await chargeRes.json();
    const pmd = charge.payment_method_details;
    if (!pmd) return null;
    if (pmd.type === "card" && pmd.card) {
      return JSON.stringify({
        type: "card",
        brand: pmd.card.brand || "unknown",
        funding: pmd.card.funding || "unknown",
        last4: pmd.card.last4 || null,
      });
    }
    return JSON.stringify({ type: pmd.type });
  } catch (e) {
    console.error("extractStripeSubMethod failed:", e);
    return null;
  }
}
```

- [ ] **Step 3: Extract PayPal `payment_source` in `handlePayPalCapture`**

Edit `workers/checkout.js` in `handlePayPalCapture` (line 315). Find the success block near line 369:

```js
const ok = await markOrderPaidViaApi(orderId, "paypal", env);
if (!ok) return json({ error: "mark-paid failed" }, 500);

return json({ ok: true });
```

Replace with:

```js
const subMethod = extractPayPalSubMethod(captureData);
const ok = await markOrderPaidViaApi(orderId, "paypal", env, subMethod);
if (!ok) return json({ error: "mark-paid failed" }, 500);

return json({ ok: true });
```

Add the helper after `extractStripeSubMethod`:

```js
function extractPayPalSubMethod(captureData) {
  try {
    const ps = captureData && captureData.payment_source;
    if (!ps) return null;
    if (ps.paypal) {
      return JSON.stringify({ type: "paypal_wallet" });
    }
    if (ps.card) {
      return JSON.stringify({
        type: "card",
        brand: ps.card.brand || "unknown",
        funding: ps.card.type ? ps.card.type.toLowerCase() : "unknown",
      });
    }
    return null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Extract PayPal `payment_source` in `handlePayPalWebhook`**

Edit `workers/checkout.js` in `handlePayPalWebhook` (line 189). Find the block at line 246:

```js
const ok = await markOrderPaidViaApi(orderId, "paypal", env);
```

Replace with a capture-lookup to get `payment_source`:

```js
const subMethod = await extractPayPalWebhookSubMethod(event, env);
const ok = await markOrderPaidViaApi(orderId, "paypal", env, subMethod);
```

Add the helper after `extractPayPalSubMethod`:

```js
async function extractPayPalWebhookSubMethod(event, env) {
  try {
    const resource = event.resource || {};
    // PAYMENT.CAPTURE.COMPLETED — resource is a capture; fetch the order to get payment_source.
    const captureId = resource.id;
    if (!captureId) return null;
    const auth = await paypalAuth(env);
    if (!auth) return null;
    const capRes = await fetch(env.PAYPAL_API_BASE + "/v2/payments/captures/" + encodeURIComponent(captureId), {
      headers: { Authorization: "Bearer " + auth },
    });
    if (!capRes.ok) return null;
    const cap = await capRes.json();
    const orderId = cap.supplementary_data && cap.supplementary_data.related_ids && cap.supplementary_data.related_ids.order_id;
    if (!orderId) return null;
    const orderRes = await fetch(env.PAYPAL_API_BASE + "/v2/checkout/orders/" + encodeURIComponent(orderId), {
      headers: { Authorization: "Bearer " + auth },
    });
    if (!orderRes.ok) return null;
    const order = await orderRes.json();
    return extractPayPalSubMethod(order);
  } catch (e) {
    console.error("extractPayPalWebhookSubMethod failed:", e);
    return null;
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add workers/checkout.js
git commit -m "feat: capture Stripe charge + PayPal payment_source sub-method details"
```

---

### Task 5: Dashboard — map sub-method fields in StoreContext and API client

**Files:**
- Modify: `home-bakery-management-system/src/utils/api.ts:22-39` (`ApiOrder`), `:385-395` (`ApiPayment`)
- Modify: `home-bakery-management-system/src/context/StoreContext.tsx:73-105` (order mapping), `:225-236` (payment mapping)

**Interfaces:**
- Produces: `ApiOrder.payment_sub_method: string | null`. `ApiPayment.methodDetails: string | null`. `Order.paymentSubMethod` and `Payment.methodDetails` are populated by StoreContext. Later UI tasks read these fields.

- [ ] **Step 1: Add `payment_sub_method` to `ApiOrder`**

Edit `home-bakery-management-system/src/utils/api.ts` in the `ApiOrder` interface (line 22-39). Add the field after `payment_method`:

```typescript
interface ApiOrder {
  id: number;
  created_at: string;
  customer_name: string;
  customer_id: string | null;
  phone: string | null;
  pickup_date: string;
  pickup_time: string | null;
  items_json: string;
  total_cents: number;
  payment_method: string;
  payment_sub_method: string | null;
  payment_status: string;
  status: string;
  notes: string | null;
  created_by: string;
  source: string;
  food_coloring: string | null;
}
```

- [ ] **Step 2: Add `methodDetails` to `ApiPayment`**

Edit the `ApiPayment` interface (line 385-395). Add `methodDetails` after `method`:

```typescript
export interface ApiPayment {
  id: string;
  orderId: number | null;
  orderNumber: string | null;
  customerName: string;
  amount: number;
  method: PaymentMethod;
  methodDetails: string | null;
  date: string;
  createdAt: string;
  active: boolean;
}
```

- [ ] **Step 3: Map `payment_sub_method` in StoreContext `refreshOrders`**

Edit `home-bakery-management-system/src/context/StoreContext.tsx` in the `refreshOrders` mapping (line 79-99). Add `paymentSubMethod` after the `paymentMethod` line (line 89):

```typescript
return {
  id: String(r.id),
  orderNumber: `MR-${r.id}`,
  customerId: r.customer_id || null,
  customerName: r.customer_name,
  phone: r.phone || "",
  items,
  source: (r.source === "in-person" ? "in-person" : "website") as OrderSource,
  status: (r.status === "done" ? "completed" : r.status) as Order["status"],
  paymentMethod: r.payment_method as Order["paymentMethod"],
  paymentSubMethod: (r as any).payment_sub_method || null,
  paymentStatus: r.payment_status as Order["paymentStatus"],
  subtotal: r.total_cents / 100,
  discount: 0,
  total: r.total_cents / 100,
  dueDate: r.pickup_date,
  createdAt: r.created_at,
  notes: r.notes || "",
  inventoryDeducted: r.status === "done" || r.status === "completed",
  foodColoring: r.food_coloring || null,
};
```

Note: the `ApiOrder` type now includes `payment_sub_method`, so the `(r as any)` cast can be removed once the type is picked up — but `r` is typed as `ApiOrder` from `fetchOrders`, so you can use `r.payment_sub_method || null` directly:

```typescript
paymentSubMethod: r.payment_sub_method || null,
```

- [ ] **Step 4: Map `methodDetails` in StoreContext `apiToPayment`**

Edit `apiToPayment` (line 225-236). Add `methodDetails`:

```typescript
function apiToPayment(row: ApiPayment): Payment {
  return {
    id: row.id,
    orderId: row.orderId ? String(row.orderId) : "",
    orderNumber: row.orderNumber || "",
    customerName: row.customerName,
    amount: Number(row.amount) || 0,
    method: row.method,
    methodDetails: row.methodDetails || null,
    date: row.date,
    active: Boolean(row.active),
  };
}
```

- [ ] **Step 5: Run typecheck**

Run: `cd home-bakery-management-system && npx tsc --noEmit`
Expected: No new type errors.

- [ ] **Step 6: Commit**

```bash
git add home-bakery-management-system/src/utils/api.ts home-bakery-management-system/src/context/StoreContext.tsx
git commit -m "feat: map payment_sub_method and methodDetails in dashboard data layer"
```

---

### Task 6: Dashboard — hide Stripe/PayPal from in-person flows

**Files:**
- Modify: `home-bakery-management-system/src/components/OrderModal.tsx` (payment method dropdown)
- Modify: `home-bakery-management-system/src/pages/Orders.tsx:70-72` (`enabledMethods`)

**Interfaces:**
- Consumes: `ONLINE_ONLY` from `format.ts` (Task 1).
- Produces: In-person order creation and Record Payment dropdowns no longer show Stripe or PayPal, even if enabled in Settings.

- [ ] **Step 1: Update `OrderModal.tsx` payment method filter**

Find the enabled-methods derivation in `OrderModal.tsx` (search for `acceptedMethods` — it's around line 35-36). It currently looks like:

```typescript
const enabledMethods = (Object.keys(profile.acceptedMethods) as PaymentMethod[])
  .filter((m) => profile.acceptedMethods[m]);
```

Change it to exclude online-only methods. Add the import at the top:

```typescript
import { ONLINE_ONLY } from "../utils/format";
```

Then:

```typescript
const enabledMethods = (Object.keys(profile.acceptedMethods) as PaymentMethod[])
  .filter((m) => profile.acceptedMethods[m] && !ONLINE_ONLY.includes(m));
```

- [ ] **Step 2: Update `Orders.tsx` `enabledMethods`**

Edit `home-bakery-management-system/src/pages/Orders.tsx` at line 70-72. Add the import:

```typescript
import { formatCurrency, formatDate, PAYMENT_METHOD_LABELS, ONLINE_ONLY } from "../utils/format";
```

Then change:

```typescript
const enabledMethods = (Object.keys(profile.acceptedMethods) as PaymentMethod[]).filter(
  (m) => profile.acceptedMethods[m],
);
```

to:

```typescript
const enabledMethods = (Object.keys(profile.acceptedMethods) as PaymentMethod[]).filter(
  (m) => profile.acceptedMethods[m] && !ONLINE_ONLY.includes(m),
);
```

- [ ] **Step 3: Run typecheck**

Run: `cd home-bakery-management-system && npx tsc --noEmit`
Expected: No new type errors.

- [ ] **Step 4: Commit**

```bash
git add home-bakery-management-system/src/components/OrderModal.tsx home-bakery-management-system/src/pages/Orders.tsx
git commit -m "feat: hide Stripe/PayPal from in-person order entry and Record Payment"
```

---

### Task 7: Dashboard — show PayPal icon and sub-method in Payments page

**Files:**
- Modify: `home-bakery-management-system/src/pages/Payments.tsx:7-13` (`METHOD_ICONS`), table rows

**Interfaces:**
- Consumes: `Payment.methodDetails` (Task 5), `formatPaymentSubMethod` (Task 1).

- [ ] **Step 1: Add PayPal to `METHOD_ICONS`**

Edit `home-bakery-management-system/src/pages/Payments.tsx` at line 7-13:

```typescript
const METHOD_ICONS: Record<PaymentMethod, string> = {
  stripe: "💳",
  paypal: "🅿️",
  cashapp: "💵",
  venmo: "📲",
  applepay: "🍎",
  cash: "💰",
};
```

- [ ] **Step 2: Show sub-method in payment rows**

Find the method column in the payments table (search for `p.method` — it's in the rendered rows). Add the import:

```typescript
import { formatCurrency, formatDateTime, PAYMENT_METHOD_COLORS, PAYMENT_METHOD_LABELS, formatPaymentSubMethod } from "../utils/format";
```

Find the cell that renders the method. It currently looks something like:

```tsx
<td className="...">
  <span>{METHOD_ICONS[p.method]} {PAYMENT_METHOD_LABELS[p.method]}</span>
</td>
```

Update to show the sub-method underneath:

```tsx
<td className="...">
  <div>
    <span>{METHOD_ICONS[p.method]} {PAYMENT_METHOD_LABELS[p.method]}</span>
    {p.methodDetails && formatPaymentSubMethod(p.methodDetails) && (
      <div className="text-xs text-cocoa-muted/60">{formatPaymentSubMethod(p.methodDetails)}</div>
    )}
  </div>
</td>
```

- [ ] **Step 3: Run typecheck**

Run: `cd home-bakery-management-system && npx tsc --noEmit`
Expected: No new type errors.

- [ ] **Step 4: Commit**

```bash
git add home-bakery-management-system/src/pages/Payments.tsx
git commit -m "feat: show PayPal icon and payment sub-method in Payments page"
```

---

### Task 8: Dashboard — add PayPal toggle to Settings

**Files:**
- Modify: `home-bakery-management-system/src/pages/Settings.tsx` (`METHOD_ICONS` + toggle rendering)

**Interfaces:**
- Consumes: `PaymentMethod` includes `paypal` (Task 1). `BusinessProfile.acceptedMethods` is `Record<PaymentMethod, boolean>` so it now allows a `paypal` key.

- [ ] **Step 1: Add PayPal to `METHOD_ICONS` in Settings**

Find the `METHOD_ICONS` object in `home-bakery-management-system/src/pages/Settings.tsx` (around line 8-14). It mirrors the one in Payments. Add `paypal`:

```typescript
const METHOD_ICONS: Record<PaymentMethod, string> = {
  stripe: "💳",
  paypal: "🅿️",
  cashapp: "💵",
  venmo: "📲",
  applepay: "🍎",
  cash: "💰",
};
```

- [ ] **Step 2: Ensure toggle rendering includes PayPal**

The Settings page iterates over `Object.keys(profile.acceptedMethods) as PaymentMethod[]` and renders a toggle for each. Since `paypal` is now a valid `PaymentMethod` and the seed data includes `paypal: false`, the toggle will appear automatically. Verify by reading the toggle-rendering code — it should already handle any key in `acceptedMethods`.

If the page uses a hardcoded method list instead of iterating, update it to iterate `Object.keys(profile.acceptedMethods)`. Confirm the `toggleMethod` function (around line 46-47) works for `paypal` — it should, since it just flips the boolean.

- [ ] **Step 3: Run typecheck**

Run: `cd home-bakery-management-system && npx tsc --noEmit`
Expected: No new type errors.

- [ ] **Step 4: Commit**

```bash
git add home-bakery-management-system/src/pages/Settings.tsx
git commit -m "feat: add PayPal toggle to Settings payment methods"
```

---

### Task 9: API Worker — update `sendCustomerConfirmation` to return result and include sub-method + order status

**Files:**
- Modify: `orders/workers/api.js:604-768` (`sendCustomerConfirmation`)

**Interfaces:**
- Produces: `sendCustomerConfirmation(env, order)` returns `Promise<{ ok: boolean; messageId?: string }>`. The receipt email now shows the sub-method label (e.g., "Visa Credit") and the order status. Task 10 relies on this return value.

- [ ] **Step 1: Change the return type and capture Resend message ID**

Edit `orders/workers/api.js` in `sendCustomerConfirmation` (line 604). Find the early return at line 606-609:

```js
if (!email || !env.RESEND_API_KEY) {
  console.warn('sendCustomerConfirmation: missing email or RESEND_API_KEY for order', order.id);
  return;
}
```

Change to:

```js
if (!email || !env.RESEND_API_KEY) {
  console.warn('sendCustomerConfirmation: missing email or RESEND_API_KEY for order', order.id);
  return { ok: false };
}
```

Find the try/catch block at line 748-767:

```js
try {
  const res = await fetch("https://api.resend.com/emails", { ... });
  if (!res.ok) {
    const err = await res.text();
    console.error("Resend customer email failed:", res.status, err);
  }
} catch (e) { console.error('Customer email notify failed:', e); }
```

Replace the entire try/catch with:

```js
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
      subject: L.subject,
      text,
      html,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("Resend customer email failed:", res.status, err);
    return { ok: false };
  }
  const data = await res.json().catch(() => ({}));
  return { ok: true, messageId: data.id || null };
} catch (e) {
  console.error('Customer email notify failed:', e);
  return { ok: false };
}
```

Also add a final fallback return at the very end of the function (after the try/catch), in case execution reaches it:

```js
return { ok: false };
```

- [ ] **Step 2: Include sub-method label in the receipt email**

In `sendCustomerConfirmation`, find the `methodLabel` definition (line 615-618):

```js
const methodLabel = order.payment_method === 'stripe'
  ? (isEn ? 'Card' : 'Tarjeta')
  : order.payment_method === 'paypal' ? 'PayPal'
  : (order.payment_method || '—');
```

Replace with a version that uses the sub-method when available:

```js
const methodLabel = buildMethodLabel(order, isEn);
```

Add the helper function before `sendCustomerConfirmation` (before line 604):

```js
function buildMethodLabel(order, isEn) {
  const method = order.payment_method;
  let label;
  if (method === 'stripe') label = isEn ? 'Card' : 'Tarjeta';
  else if (method === 'paypal') label = 'PayPal';
  else if (method === 'cashapp') label = 'Cash App';
  else if (method === 'venmo') label = 'Venmo';
  else if (method === 'applepay') label = 'Apple Pay';
  else if (method === 'cash') label = isEn ? 'Cash' : 'Efectivo';
  else label = method || '—';
  // Append sub-method details for Stripe/PayPal
  const sub = order.payment_sub_method;
  if (sub) {
    try {
      const parsed = JSON.parse(sub);
      if (parsed.type === 'card' && parsed.brand) {
        const brand = parsed.brand.charAt(0).toUpperCase() + parsed.brand.slice(1).toLowerCase();
        const funding = parsed.funding ? ' ' + parsed.funding.charAt(0).toUpperCase() + parsed.funding.slice(1).toLowerCase() : '';
        const last4 = parsed.last4 ? ' (…' + parsed.last4 + ')' : '';
        label = `${brand}${funding}${last4}`;
      } else if (parsed.type === 'paypal_wallet') {
        label = 'PayPal Wallet';
      }
    } catch { /* keep base label */ }
  }
  return label;
}
```

- [ ] **Step 3: Add order status to the receipt summary table**

In the HTML template (line 666-721), find the summary table (around line 678-695). It has rows for Date, Payment, Pickup, Order. Add a Status row after the Payment row:

```html
<tr>
  <td style="color: #8a8078; font-size: 13px; padding: 3px 0;">${L.payment}</td>
  <td style="color: #4a423d; font-size: 13px; text-align: right; padding: 3px 0;">${methodLabel}</td>
</tr>
<tr>
  <td style="color: #8a8078; font-size: 13px; padding: 3px 0;">${L.statusLabel}</td>
  <td style="color: #4a423d; font-size: 13px; text-align: right; padding: 3px 0;">${statusLabel}</td>
</tr>
```

Add `statusLabel` and `L.statusLabel` to the string tables. Near the top of the function (after `methodLabel` is defined, around line 618), add:

```js
const statusLabel = order.status ? formatStatusLabel(order.status, isEn) : '—';
```

Add the helper after `buildMethodLabel`:

```js
function formatStatusLabel(status, isEn) {
  const map = isEn ? {
    'pending': 'Pending',
    'in-progress': 'In Progress',
    'ready': 'Ready',
    'completed': 'Completed',
    'cancelled': 'Cancelled',
    'awaiting_payment': 'Awaiting Payment',
  } : {
    'pending': 'Pendiente',
    'in-progress': 'En Progreso',
    'ready': 'Listo',
    'completed': 'Completado',
    'cancelled': 'Cancelado',
    'awaiting_payment': 'Esperando Pago',
  };
  return map[status] || status;
}
```

Add `statusLabel` to both `L` objects (EN and ES). In the EN object (line 636-649) add:

```js
statusLabel: 'Status',
```

In the ES object (line 650-664) add:

```js
statusLabel: 'Estado',
```

Also update the plain-text fallback (line 729-746) to include the status. After the `${L.payment}: ${methodLabel}` line, add:

```js
`${L.statusLabel}: ${statusLabel}`,
```

- [ ] **Step 4: Commit**

```bash
git add orders/workers/api.js
git commit -m "feat: sendCustomerConfirmation returns result and includes sub-method + order status"
```

---

### Task 10: D1 migration — create `receipts` table

**Files:**
- Create: `orders/migrations/0022_receipts.sql`

**Interfaces:**
- Produces: `receipts` table with columns: `id`, `order_id`, `order_number`, `customer_name`, `email`, `items_json`, `total_cents`, `payment_method`, `payment_sub_method`, `order_status`, `status`, `message_id`, `sent_at`, `created_at`. Indexes on `order_id`, `email`, `created_at`.

- [ ] **Step 1: Write the migration**

Create `orders/migrations/0022_receipts.sql`:

```sql
-- Receipt history: one row per receipt email send attempt (sent or failed).
-- Captures a snapshot of the order at send time so history survives order edits.
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
  status              TEXT NOT NULL DEFAULT 'sent',
  message_id          TEXT,
  sent_at             TEXT NOT NULL DEFAULT (datetime('now')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_receipts_order   ON receipts(order_id);
CREATE INDEX IF NOT EXISTS idx_receipts_email   ON receipts(email);
CREATE INDEX IF NOT EXISTS idx_receipts_created ON receipts(created_at DESC);
```

- [ ] **Step 2: Apply migration locally**

Run: `cd orders && npx wrangler d1 execute muy-rico-orders --file=migrations/0022_receipts.sql`
Expected: Table + 3 indexes created.

- [ ] **Step 3: Apply migration to remote**

Run: `cd orders && npx wrangler d1 execute muy-rico-orders --remote --file=migrations/0022_receipts.sql`
Expected: Table + 3 indexes created.

- [ ] **Step 4: Commit**

```bash
git add orders/migrations/0022_receipts.sql
git commit -m "feat: migration 0022 — create receipts table"
```

---

### Task 11: API Worker — log receipts in `markOrderPaid` and add receipt endpoints

**Files:**
- Modify: `orders/workers/api.js` (route dispatch ~line 108-120, `markOrderPaid` ~line 484-555, append `listReceipts`, `getReceipt`, `resendReceipt` functions)

**Interfaces:**
- Produces: `GET /api/receipts` (admin-only) returns `{ receipts: [...] }` with camelCase fields. `GET /api/receipts/:id` returns a single receipt. `POST /api/receipts/:id/resend` re-sends the email and inserts a new receipt row. `markOrderPaid` inserts a `receipts` row + `order_events` `receipt:sent`/`receipt:failed` event after the email is sent.

- [ ] **Step 1: Add route dispatch for receipts**

In `orders/workers/api.js`, find the route dispatch block (around line 108-120). After the payments routes (line 214-215), add:

```js
if (path === '/api/receipts' && method === 'GET') return await listReceipts(request, env);
const rm = path.match(/^\/api\/receipts\/([^/]+)$/);
if (rm && method === 'GET') return await getReceipt(rm[1], env);
const rsm = path.match(/^\/api\/receipts\/([^/]+)\/resend$/);
if (rsm && method === 'POST') return await resendReceipt(rsm[1], request, env, ctx, actorName);
```

Note: these are NOT added to the `isPublic*` allowlist (line 82-101), so they require Cloudflare Access auth.

- [ ] **Step 2: Update `markOrderPaid` to log receipts**

In `markOrderPaid` (line 484-555), find the block that fires notifications (around line 543-550):

```js
if (ctx) {
  ctx.waitUntil(notifyOrderPaid(env, updatedOrder, id, method));
  ctx.waitUntil(sendCustomerConfirmation(env, updatedOrder));
  if (wasAwaiting) {
    ctx.waitUntil(generateLabelsForOrder(env, id, order));
  }
}
```

Replace `sendCustomerConfirmation` fire-and-forget with an awaited call that logs the result:

```js
if (ctx) {
  ctx.waitUntil(notifyOrderPaid(env, updatedOrder, id, method));
  ctx.waitUntil((async () => {
    const result = await sendCustomerConfirmation(env, updatedOrder);
    await logReceipt(env, updatedOrder, result, id);
  })());
  if (wasAwaiting) {
    ctx.waitUntil(generateLabelsForOrder(env, id, order));
  }
}
```

- [ ] **Step 3: Add the `logReceipt` helper**

After `sendCustomerConfirmation` (after line 768), add:

```js
async function logReceipt(env, order, emailResult, orderId) {
  const status = emailResult && emailResult.ok ? 'sent' : 'failed';
  const messageId = (emailResult && emailResult.messageId) || null;
  const receiptId = `rcpt_${orderId}_${Date.now().toString(36)}`;
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
    await env.DB.prepare(`
      INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, ?)
    `).bind(orderId, 'system', status === 'sent' ? 'receipt:sent' : 'receipt:failed').run();
  } catch (e) {
    console.error('logReceipt failed:', e);
  }
}
```

- [ ] **Step 4: Add `listReceipts` function**

After `logReceipt`, add:

```js
async function listReceipts(request, env) {
  const sp = new URL(request.url).searchParams;
  const orderId = sp.get('order_id');
  const email = sp.get('email');
  const search = sp.get('search');
  const limit = Math.min(Number(sp.get('limit')) || 200, 500);
  const where = [];
  const binds = [];
  if (orderId) { where.push('order_id = ?'); binds.push(Number(orderId)); }
  if (email) { where.push('email LIKE ?'); binds.push(`%${email}%`); }
  if (search) { where.push('(customer_name LIKE ? OR order_number LIKE ?)'); binds.push(`%${search}%`, `%${search}%`); }
  const sql = `
    SELECT * FROM receipts
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC
    LIMIT ?
  `;
  binds.push(limit);
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return json({ receipts: results.map(snakeToCamelObject) }, 200);
}
```

- [ ] **Step 5: Add `getReceipt` function**

```js
async function getReceipt(id, env) {
  const receipt = await env.DB.prepare('SELECT * FROM receipts WHERE id = ?').bind(id).first();
  if (!receipt) return json({ error: 'Not found' }, 404);
  return json({ receipt: snakeToCamelObject(receipt) }, 200);
}
```

- [ ] **Step 6: Add `resendReceipt` function**

```js
async function resendReceipt(id, request, env, ctx, actor) {
  const receipt = await env.DB.prepare('SELECT * FROM receipts WHERE id = ?').bind(id).first();
  if (!receipt) return json({ error: 'Not found' }, 404);
  // Fetch the current order to send a fresh receipt
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(receipt.order_id).first();
  if (!order) return json({ error: 'Order not found' }, 404);
  const result = await sendCustomerConfirmation(env, order);
  await logReceipt(env, order, result, receipt.order_id);
  return json({ ok: true, status: result.ok ? 'sent' : 'failed', messageId: result.messageId || null }, 200);
}
```

- [ ] **Step 7: Commit**

```bash
git add orders/workers/api.js
git commit -m "feat: log receipts in markOrderPaid + add /api/receipts endpoints"
```

---

### Task 12: Dashboard — add Receipts API client + StoreContext

**Files:**
- Modify: `home-bakery-management-system/src/utils/api.ts` (add `ApiReceipt`, `fetchReceipts`, `resendReceipt`)
- Modify: `home-bakery-management-system/src/context/StoreContext.tsx` (receipts state, `refreshReceipts`, `resendReceipt`)

**Interfaces:**
- Produces: `fetchReceipts(filters)` returns `ApiReceipt[]`. `resendReceiptApi(id)` returns `{ ok, status, messageId }`. StoreContext exposes `receipts`, `refreshReceipts`, `resendReceipt`.

- [ ] **Step 1: Add `ApiReceipt` and API functions to `api.ts`**

In `home-bakery-management-system/src/utils/api.ts`, after the Payments section (after line 423), add a Receipts section:

```typescript
// ─── Receipts ─────────────────────────────────────────────────────────────────

export interface ApiReceipt {
  id: string;
  orderId: number;
  orderNumber: string | null;
  customerName: string;
  email: string | null;
  itemsJson: string;
  totalCents: number;
  paymentMethod: string;
  paymentSubMethod: string | null;
  orderStatus: string;
  status: "sent" | "failed";
  messageId: string | null;
  sentAt: string;
  createdAt: string;
}

export async function fetchReceipts(filters?: {
  order_id?: string;
  email?: string;
  search?: string;
}): Promise<ApiReceipt[]> {
  const params = new URLSearchParams();
  if (filters?.order_id) params.set("order_id", filters.order_id);
  if (filters?.email) params.set("email", filters.email);
  if (filters?.search) params.set("search", filters.search);
  params.set("limit", "500");
  const qs = params.toString();
  const data = await apiFetch<{ receipts: ApiReceipt[] }>(`/api/receipts${qs ? `?${qs}` : ""}`);
  return data.receipts;
}

export async function resendReceiptApi(id: string): Promise<{ ok: boolean; status: string; messageId: string | null }> {
  return apiFetch(`/api/receipts/${encodeURIComponent(id)}/resend`, { method: "POST" });
}
```

- [ ] **Step 2: Add receipts state to StoreContext**

In `home-bakery-management-system/src/context/StoreContext.tsx`, add the import:

```typescript
import { fetchReceipts, resendReceiptApi } from "../utils/api";
import type { Receipt } from "../types";
```

Find the state declarations near the top (search for `useState`). Add:

```typescript
const [receipts, setReceipts] = useState<Receipt[]>([]);
```

Add the `apiToReceipt` mapping function (near `apiToPayment`):

```typescript
function apiToReceipt(row: ApiReceipt): Receipt {
  return {
    id: row.id,
    orderId: String(row.orderId),
    orderNumber: row.orderNumber || "",
    customerName: row.customerName,
    email: row.email,
    itemsJson: row.itemsJson,
    totalCents: row.totalCents,
    paymentMethod: row.paymentMethod,
    paymentSubMethod: row.paymentSubMethod,
    orderStatus: row.orderStatus,
    status: row.status,
    messageId: row.messageId,
    sentAt: row.sentAt,
    createdAt: row.createdAt,
  };
}
```

Add the import for `ApiReceipt`:

```typescript
import type { ApiReceipt } from "../utils/api";
```

- [ ] **Step 3: Add `refreshReceipts` and `resendReceipt` to StoreContext**

After `refreshPayments` (around line 246), add:

```typescript
const refreshReceipts = useCallback(async () => {
  try {
    const rows = await fetchReceipts();
    setReceipts(rows.map(apiToReceipt));
  } catch (err) {
    console.warn("Failed to fetch receipts from API:", err);
    setReceipts([]);
  }
}, []);
```

Add `refreshReceipts` to the `refreshAll` `Promise.all` array (line 358-368).

After `recordPayment` (around line 492), add:

```typescript
const resendReceipt = useCallback(async (id: string) => {
  try {
    await resendReceiptApi(id);
    await refreshReceipts();
  } catch (err) {
    console.warn("Failed to resend receipt:", err);
  }
}, [refreshReceipts]);
```

Add `receipts`, `refreshReceipts`, `resendReceipt` to the `value` useMemo object (line 524-549) and to the `StoreContextValue` interface at the top of the file.

- [ ] **Step 4: Run typecheck**

Run: `cd home-bakery-management-system && npx tsc --noEmit`
Expected: No new type errors.

- [ ] **Step 5: Commit**

```bash
git add home-bakery-management-system/src/utils/api.ts home-bakery-management-system/src/context/StoreContext.tsx
git commit -m "feat: add receipts API client and StoreContext state"
```

---

### Task 13: Dashboard — create Receipts page

**Files:**
- Create: `home-bakery-management-system/src/pages/Receipts.tsx`

**Interfaces:**
- Consumes: `receipts`, `refreshReceipts`, `resendReceipt` from StoreContext. `formatPaymentSubMethod`, `formatCurrency`, `formatDateTime`, `PAYMENT_METHOD_LABELS` from format.ts.
- Produces: A `<Receipts search={search} />` component rendered by `App.tsx` (Task 14).

- [ ] **Step 1: Create the Receipts page**

Create `home-bakery-management-system/src/pages/Receipts.tsx`:

```tsx
import { useMemo, useState, Fragment } from "react";
import { Mail, MailCheck, MailX, RotateCw, Search } from "lucide-react";
import { useStore } from "../context/StoreContext";
import { formatCurrency, formatDateTime, PAYMENT_METHOD_LABELS, formatPaymentSubMethod } from "../utils/format";
import type { Receipt } from "../types";

export default function Receipts({ search }: { search: string }) {
  const { receipts, resendReceipt } = useStore();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [resending, setResending] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return receipts
      .filter((r) => (statusFilter === "all" ? true : r.status === statusFilter))
      .filter((r) =>
        search
          ? r.customerName.toLowerCase().includes(search.toLowerCase()) ||
            r.orderNumber.toLowerCase().includes(search.toLowerCase()) ||
            (r.email || "").toLowerCase().includes(search.toLowerCase())
          : true,
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [receipts, statusFilter, search]);

  async function handleResend(r: Receipt) {
    setResending(r.id);
    try {
      await resendReceipt(r.id);
    } finally {
      setResending(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Search size={16} className="text-cocoa-muted/50" />
        <span className="text-sm text-cocoa-muted">Filter by status:</span>
        {["all", "sent", "failed"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-lg px-3 py-1 text-xs font-medium capitalize transition ${
              statusFilter === s ? "bg-palm text-white" : "bg-white text-cocoa-muted border border-sand-200 hover:bg-sand-50"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-sand-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-sand-50 text-left text-xs uppercase text-cocoa-muted/60">
            <tr>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Payment</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3">Sent</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand-100">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-cocoa-muted/50">
                  No receipts found.
                </td>
              </tr>
            )}
            {filtered.map((r) => (
              <Fragment key={r.id}>
                <tr
                  onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                  className="cursor-pointer hover:bg-sand-50"
                >
                  <td className="px-4 py-3 font-medium">{r.orderNumber}</td>
                  <td className="px-4 py-3">{r.customerName}</td>
                  <td className="px-4 py-3 text-cocoa-muted">{r.email || "—"}</td>
                  <td className="px-4 py-3">
                    <div>{PAYMENT_METHOD_LABELS[r.paymentMethod] || r.paymentMethod}</div>
                    {r.paymentSubMethod && formatPaymentSubMethod(r.paymentSubMethod) && (
                      <div className="text-xs text-cocoa-muted/60">{formatPaymentSubMethod(r.paymentSubMethod)}</div>
                    )}
                  </td>
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
                  <td className="px-4 py-3 text-right font-medium">{formatCurrency(r.totalCents / 100)}</td>
                  <td className="px-4 py-3 text-cocoa-muted">{formatDateTime(r.sentAt)}</td>
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
                </tr>
                {expanded === r.id && (
                  <tr className="bg-sand-50/50">
                    <td colSpan={8} className="px-4 py-4">
                      <ReceiptDetail receipt={r} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReceiptDetail({ receipt }: { receipt: Receipt }) {
  let items: { name: string; qty: number; price: number }[] = [];
  try {
    items = JSON.parse(receipt.itemsJson);
  } catch { /* ignore */ }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs sm:grid-cols-4">
        <div><span className="text-cocoa-muted/60">Order status: </span>{receipt.orderStatus}</div>
        <div><span className="text-cocoa-muted/60">Message ID: </span>{receipt.messageId || "—"}</div>
        <div><span className="text-cocoa-muted/60">Created: </span>{formatDateTime(receipt.createdAt)}</div>
        <div><span className="text-cocoa-muted/60">Total: </span>{formatCurrency(receipt.totalCents / 100)}</div>
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold uppercase text-cocoa-muted/60">Items</p>
        <ul className="space-y-0.5 text-sm">
          {items.map((it, i) => (
            <li key={i} className="flex justify-between">
              <span>{it.qty} × {it.name}</span>
              <span className="text-cocoa-muted">{formatCurrency(it.qty * it.price)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd home-bakery-management-system && npx tsc --noEmit`
Expected: No new type errors (the `<>` fragment with key may need a `React.Fragment` with key — adjust if the linter complains).

- [ ] **Step 3: Commit**

```bash
git add home-bakery-management-system/src/pages/Receipts.tsx
git commit -m "feat: add Receipts page with list, detail expansion, and resend"
```

---

### Task 14: Dashboard — wire Receipts page into App and Sidebar

**Files:**
- Modify: `home-bakery-management-system/src/App.tsx` (Page union + route)
- Modify: `home-bakery-management-system/src/components/Sidebar.tsx` (nav item)

**Interfaces:**
- Produces: `"receipts"` is a valid `Page`. The sidebar shows a Receipts nav item. Navigating to it renders `<Receipts />`.

- [ ] **Step 1: Add `"receipts"` to the `Page` union**

Edit `home-bakery-management-system/src/App.tsx` at line 18-28. Add `receipts`:

```typescript
export type Page =
  | "dashboard"
  | "orders"
  | "products"
  | "gallery"
  | "homepage"
  | "inventory"
  | "customers"
  | "payments"
  | "receipts"
  | "labels"
  | "settings";
```

- [ ] **Step 2: Add the Receipts route**

In `App.tsx`, add the import:

```typescript
import Receipts from "./pages/Receipts";
```

In the `<main>` switch (line 59-68), add after the `payments` route:

```tsx
{page === "receipts" && <Receipts search={search} />}
```

- [ ] **Step 3: Add Receipts nav item to Sidebar**

Edit `home-bakery-management-system/src/components/Sidebar.tsx`. Add `Mail` (or `Receipt`) to the lucide-react import:

```typescript
import {
  LayoutDashboard,
  ClipboardList,
  Cookie,
  Images,
  Home,
  Package,
  Users,
  Wallet,
  Mail,
  Tag,
  Settings,
} from "lucide-react";
```

In the `NAV` array (line 17-28), add `receipts` after `payments`:

```typescript
{ id: "payments", label: "Payments", icon: Wallet },
{ id: "receipts", label: "Receipts", icon: Mail },
{ id: "labels", label: "Label Designer", icon: Tag },
```

- [ ] **Step 4: Run typecheck and build**

Run: `cd home-bakery-management-system && npx tsc --noEmit`
Expected: No new type errors.

Run: `cd home-bakery-management-system && npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add home-bakery-management-system/src/App.tsx home-bakery-management-system/src/components/Sidebar.tsx
git commit -m "feat: wire Receipts page into App routing and Sidebar"
```

---

### Task 15: Dashboard — show sub-method in Orders detail modal

**Files:**
- Modify: `home-bakery-management-system/src/pages/Orders.tsx` (order detail modal)

**Interfaces:**
- Consumes: `Order.paymentSubMethod` (Task 5), `formatPaymentSubMethod` (Task 1).

- [ ] **Step 1: Show sub-method in order detail modal**

In `home-bakery-management-system/src/pages/Orders.tsx`, add the import:

```typescript
import { formatCurrency, formatDate, PAYMENT_METHOD_LABELS, ONLINE_ONLY, formatPaymentSubMethod } from "../utils/format";
```

Find the order detail modal (the `<Modal open={!!selected} ...>` block). Find where the payment method is displayed (search for `paymentMethod` in the modal — it's typically a row like `PAYMENT_METHOD_LABELS[selected.paymentMethod]`).

Add the sub-method below it:

```tsx
<div>
  <span className="text-cocoa-muted/60">Payment: </span>
  {selected.paymentMethod ? PAYMENT_METHOD_LABELS[selected.paymentMethod] : "—"}
  {selected.paymentSubMethod && formatPaymentSubMethod(selected.paymentSubMethod) && (
    <span className="ml-1 text-cocoa-muted/60">({formatPaymentSubMethod(selected.paymentSubMethod)})</span>
  )}
</div>
```

- [ ] **Step 2: Show receipts for this order inside the detail modal**

Add a small section at the bottom of the order detail modal showing receipts for the selected order. Import `useStore`'s `receipts`:

```typescript
const { orders, deductInventoryForOrder, recordPayment, profile, apiUpdateOrder, apiCancelOrder, apiDeleteOrder, refreshOrders, receipts, resendReceipt } = useStore();
```

In the modal, after the items section, add:

```tsx
<div className="border-t border-sand-200 pt-3">
  <p className="mb-2 text-xs font-semibold uppercase text-cocoa-muted/60">Receipts</p>
  {receipts.filter((r) => r.orderId === selected.id).length === 0 ? (
    <p className="text-sm text-cocoa-muted/50">No receipts sent for this order.</p>
  ) : (
    <ul className="space-y-1 text-sm">
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
      </ul>
  )}
</div>
```

Add `formatDateTime` to the import:

```typescript
import { formatCurrency, formatDate, formatDateTime, PAYMENT_METHOD_LABELS, ONLINE_ONLY, formatPaymentSubMethod } from "../utils/format";
```

- [ ] **Step 3: Run typecheck**

Run: `cd home-bakery-management-system && npx tsc --noEmit`
Expected: No new type errors.

- [ ] **Step 4: Commit**

```bash
git add home-bakery-management-system/src/pages/Orders.tsx
git commit -m "feat: show payment sub-method and receipt history in order detail"
```

---

### Task 16: End-to-end verification

**Files:** None (verification only)

- [ ] **Step 1: Run all frontend tests**

Run: `cd home-bakery-management-system && npm test`
Expected: All tests pass (including the new `format.test.ts`).

- [ ] **Step 2: Run typecheck**

Run: `cd home-bakery-management-system && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Build the dashboard**

Run: `cd home-bakery-management-system && npm run build`
Expected: Build succeeds, `dist/` produced.

- [ ] **Step 4: Start the orders worker locally and verify receipts endpoint**

Run: `cd orders && npx wrangler dev`
Then:

```bash
curl http://localhost:8787/api/receipts
```

Expected: `{"receipts":[]}` (or a list of receipts if any exist). A 401 without Access cookies is also acceptable in local dev if Access is enforced.

- [ ] **Step 5: Final commit (if any verification fixes were needed)**

If any fixes were applied during verification, commit them:

```bash
git add -A
git commit -m "fix: verification fixes from end-to-end testing"
```

- [ ] **Step 6: Done**

The feature is complete. All three deliverables work:
1. PayPal orders display correctly; in-person entry hides Stripe/PayPal
2. Stripe/PayPal sub-method details (Visa Credit, PayPal Wallet) are captured and displayed
3. Receipt emails include sub-method + order status, and every send is logged to the `receipts` table with status + Resend message ID, viewable and resendable from the dashboard
