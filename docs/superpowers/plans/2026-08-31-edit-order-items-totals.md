# Edit Order (Items + Totals) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin edit an order's line items and totals (add/remove items, qty, per-item price, discount) from the Orders page, with server-authoritative money math.

**Architecture:** Extend the existing `PATCH /api/orders/:id` handler with `items_json` + `discount_cents` fields; validation and cents math live in a new pure module `orders/workers/order-edit-lib.js` (unit-tested, same pattern as `order-date.js`). Frontend gains a new `EditOrderModal.tsx` opened from an "Edit" button in the order detail modal, plus a shared `computeOrderTotals` helper in `utils/format.ts`.

**Tech Stack:** Cloudflare Workers (D1), vanilla JS worker (ESM), React 19 + Vite + Tailwind dashboard, Vitest (both `orders/` and `home-bakery-management-system/`).

## Global Constraints

- Server-authoritative totals: client only sends `items_json` + `discount_cents`; `subtotal_cents`/`total_cents` are always recomputed server-side.
- Item limits (from spec): `qty` integer 1–9999; `price` (dollars) finite, 0–10000; `name` non-empty, ≤ 200 chars; items array must have ≥ 1 element.
- Existing PATCH behavior (payment sync, pickup-date events, payment_status='unpaid' deactivation) must remain unchanged.
- Inventory is never re-deducted by this feature.
- No new dependencies. No schema changes (no migration).
- Follow existing conventions: `orders/tests/*.test.js` imports from `../workers/*.js`; dashboard tests import `{ describe, it, expect }` from `vitest` and use `react-dom/client` `createRoot` + `act` for component tests.

---

### Task 1: Backend validation + money-math lib (TDD)

**Files:**
- Create: `orders/workers/order-edit-lib.js`
- Test: `orders/tests/order-edit-lib.test.js`

**Interfaces:**
- Produces:
  - `validateOrderItems(items: any) -> { ok: boolean, error: string | null }` — errors are human-readable and name the offending item index (1-based).
  - `computeOrderTotals(items: Array<{qty: number, price: number}>, discountCents: number) -> { subtotalCents: number, discountCents: number, totalCents: number }` — `subtotalCents = Σ round(qty * price * 100)`; `discountCents` clamped to `[0, subtotalCents]` (non-finite → 0); `totalCents = subtotalCents - discountCents`. All integers.

- [ ] **Step 1: Write the failing test**

Create `orders/tests/order-edit-lib.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { validateOrderItems, computeOrderTotals } from '../workers/order-edit-lib.js';

describe('validateOrderItems', () => {
  it('accepts a valid single item', () => {
    expect(validateOrderItems([{ name: 'Cupcakes (Vanilla)', qty: 12, price: 3.5, productId: 'prod_cupcakes', emoji: '🧁' }]))
      .toEqual({ ok: true, error: null });
  });

  it('accepts multiple valid items', () => {
    expect(validateOrderItems([
      { name: 'Cake', qty: 1, price: 40 },
      { name: 'Cakepops', qty: 6, price: 2 },
    ])).toEqual({ ok: true, error: null });
  });

  it('rejects non-array input', () => {
    expect(validateOrderItems('nope').ok).toBe(false);
    expect(validateOrderItems(undefined).ok).toBe(false);
  });

  it('rejects an empty array', () => {
    const r = validateOrderItems([]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('At least one item');
  });

  it('rejects items with a blank name', () => {
    const r = validateOrderItems([{ name: '   ', qty: 1, price: 5 }]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Item 1');
  });

  it('rejects a name longer than 200 chars', () => {
    const r = validateOrderItems([{ name: 'x'.repeat(201), qty: 1, price: 5 }]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('200');
  });

  it('rejects qty 0, negative, non-integer, and over 9999', () => {
    expect(validateOrderItems([{ name: 'a', qty: 0, price: 1 }]).ok).toBe(false);
    expect(validateOrderItems([{ name: 'a', qty: -2, price: 1 }]).ok).toBe(false);
    expect(validateOrderItems([{ name: 'a', qty: 1.5, price: 1 }]).ok).toBe(false);
    expect(validateOrderItems([{ name: 'a', qty: 10000, price: 1 }]).ok).toBe(false);
    expect(validateOrderItems([{ name: 'a', qty: 1, price: 1 }]).ok).toBe(true);
  });

  it('rejects negative, NaN, and over-10000 prices', () => {
    expect(validateOrderItems([{ name: 'a', qty: 1, price: -1 }]).ok).toBe(false);
    expect(validateOrderItems([{ name: 'a', qty: 1, price: NaN }]).ok).toBe(false);
    expect(validateOrderItems([{ name: 'a', qty: 1, price: 10000.01 }]).ok).toBe(false);
    expect(validateOrderItems([{ name: 'a', qty: 1, price: 10000 }]).ok).toBe(true);
    expect(validateOrderItems([{ name: 'a', qty: 1, price: 0 }]).ok).toBe(true);
  });

  it('names the offending item index', () => {
    const r = validateOrderItems([
      { name: 'ok', qty: 1, price: 1 },
      { name: 'bad', qty: 0, price: 1 },
    ]);
    expect(r.error).toBe('Item 2 quantity must be an integer between 1 and 9999');
  });
});

describe('computeOrderTotals', () => {
  it('computes subtotal from qty * price', () => {
    expect(computeOrderTotals([{ name: 'a', qty: 12, price: 3.5 }], 0))
      .toEqual({ subtotalCents: 4200, discountCents: 0, totalCents: 4200 });
  });

  it('rounds fractional cents', () => {
    expect(computeOrderTotals([{ name: 'a', qty: 1, price: 2.675 }], 0).subtotalCents).toBe(268);
  });

  it('sums multiple items', () => {
    expect(computeOrderTotals([
      { name: 'a', qty: 1, price: 40 },
      { name: 'b', qty: 6, price: 2 },
    ], 0)).toEqual({ subtotalCents: 5200, discountCents: 0, totalCents: 5200 });
  });

  it('applies discount and clamps to [0, subtotal]', () => {
    expect(computeOrderTotals([{ name: 'a', qty: 1, price: 100 }], 500))
      .toEqual({ subtotalCents: 10000, discountCents: 500, totalCents: 9500 });
    expect(computeOrderTotals([{ name: 'a', qty: 1, price: 100 }], 99999).discountCents).toBe(10000);
    expect(computeOrderTotals([{ name: 'a', qty: 1, price: 100 }], -50).discountCents).toBe(0);
  });

  it('handles non-finite discount as zero', () => {
    expect(computeOrderTotals([{ name: 'a', qty: 1, price: 5 }], NaN))
      .toEqual({ subtotalCents: 500, discountCents: 0, totalCents: 500 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run` (workdir `orders/`)
Expected: FAIL — `Failed to resolve import "../workers/order-edit-lib.js"` / module not found.

- [ ] **Step 3: Write minimal implementation**

Create `orders/workers/order-edit-lib.js`:

```js
// Pure validation + money math for editing order line items.
// Extracted pure so it can be unit-tested without a fetch harness (see order-date.js).

const MAX_QTY = 9999;
const MAX_PRICE = 10000; // dollars
const MAX_NAME_LEN = 200;

export function validateOrderItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'At least one item is required' };
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== 'object') {
      return { ok: false, error: `Item ${i + 1} must be an object` };
    }
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name) {
      return { ok: false, error: `Item ${i + 1} requires a name` };
    }
    if (name.length > MAX_NAME_LEN) {
      return { ok: false, error: `Item ${i + 1} name exceeds ${MAX_NAME_LEN} characters` };
    }
    if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > MAX_QTY) {
      return { ok: false, error: `Item ${i + 1} quantity must be an integer between 1 and ${MAX_QTY}` };
    }
    if (typeof item.price !== 'number' || !Number.isFinite(item.price) || item.price < 0 || item.price > MAX_PRICE) {
      return { ok: false, error: `Item ${i + 1} price must be between 0 and ${MAX_PRICE}` };
    }
  }
  return { ok: true, error: null };
}

export function computeOrderTotals(items, discountCents) {
  let subtotalCents = 0;
  for (const item of items) {
    subtotalCents += Math.round(item.qty * item.price * 100);
  }
  let d = Number.isFinite(discountCents) ? Math.round(discountCents) : 0;
  if (d < 0) d = 0;
  if (d > subtotalCents) d = subtotalCents;
  return { subtotalCents, discountCents: d, totalCents: subtotalCents - d };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run` (workdir `orders/`)
Expected: PASS — all `validateOrderItems` and `computeOrderTotals` cases green.

- [ ] **Step 5: Commit**

```bash
git add orders/workers/order-edit-lib.js orders/tests/order-edit-lib.test.js
git commit -m "feat(orders): validate order items + server-side totals lib"
```

---

### Task 2: Wire items/totals into PATCH /api/orders/:id

**Files:**
- Modify: `orders/workers/api.js` (add import near line 65; extend `updateOrder` at lines 642-702)

**Interfaces:**
- Consumes: `validateOrderItems`, `computeOrderTotals` from `./order-edit-lib.js` (Task 1).
- Produces: PATCH accepts `items_json` (array or JSON string) and `discount_cents` (integer ≥ 0). On items change: writes `items_json`, `subtotal_cents`, `discount_cents`, `total_cents` and logs event `order:items_changed: <N> items`. Discount-only patch: recomputes `total_cents` from stored `subtotal_cents` (or stored `total_cents` fallback), writes `discount_cents` + `total_cents`.

- [ ] **Step 1: Add the import**

In `orders/workers/api.js`, after line 65 (`import { validatePickupDate, pickupChangeEvent } from './order-date.js';`), add:

```js
import { validateOrderItems, computeOrderTotals } from './order-edit-lib.js';
```

- [ ] **Step 2: Extend `updateOrder`**

In `updateOrder` (starts at `orders/workers/api.js:642`), replace the block from `const allowed = [...]` (line 644) through the `if (!sets.length) return json({ error: 'Nothing to update' }, 400);` guard (line 653) with (do NOT touch line 643 `const body = await request.json();` — it stays):

```js
  const allowed = ['status', 'payment_status', 'notes', 'pickup_date', 'pickup_time', 'payment_method', 'payment_sub_method', 'food_coloring', 'customer_id'];
  const sets = [], binds = [];
  for (const f of allowed) {
    if (body[f] === undefined) continue;
    if (f === 'payment_method' && !ALLOWED_PAYMENT.includes(body[f])) return json({ error: 'Invalid payment_method' }, 400);
    if (f === 'payment_status' && !ALLOWED_PAYSTAT.includes(body[f])) return json({ error: 'Invalid payment_status' }, 400);
    if (f === 'status' && !ALLOWED_STATUS.includes(body[f])) return json({ error: 'Invalid status' }, 400);
    sets.push(`${f} = ?`); binds.push(body[f]);
  }

  // Items + totals edits — server-authoritative, validated before any write.
  let itemsChanged = false;
  let itemsCount = 0;
  if (body.items_json !== undefined || body.discount_cents !== undefined) {
    if (body.discount_cents !== undefined && (!Number.isInteger(body.discount_cents) || body.discount_cents < 0)) {
      return json({ error: 'Invalid discount_cents' }, 400);
    }
    const existing = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
    if (!existing) return json({ error: 'Not found' }, 404);
    const discountCents = body.discount_cents !== undefined ? body.discount_cents : (existing.discount_cents || 0);

    if (body.items_json !== undefined) {
      const itemsJson = typeof body.items_json === 'string' ? body.items_json : JSON.stringify(body.items_json);
      let items;
      try {
        items = JSON.parse(itemsJson);
      } catch {
        return json({ error: 'Invalid items_json' }, 400);
      }
      const check = validateOrderItems(items);
      if (!check.ok) return json({ error: check.error }, 400);
      const totals = computeOrderTotals(items, discountCents);
      sets.push('items_json = ?'); binds.push(JSON.stringify(items));
      sets.push('subtotal_cents = ?'); binds.push(totals.subtotalCents);
      sets.push('discount_cents = ?'); binds.push(totals.discountCents);
      sets.push('total_cents = ?'); binds.push(totals.totalCents);
      itemsChanged = true;
      itemsCount = items.length;
    } else {
      const subtotalCents = existing.subtotal_cents ?? existing.total_cents ?? 0;
      const clamped = Math.min(Math.max(Math.round(discountCents), 0), subtotalCents);
      sets.push('discount_cents = ?'); binds.push(clamped);
      sets.push('total_cents = ?'); binds.push(subtotalCents - clamped);
    }
  }

  if (!sets.length) return json({ error: 'Nothing to update' }, 400);
```

Then, after the existing generic event insert (`INSERT INTO order_events ... 'order:updated'`), add:

```js
  if (itemsChanged) {
    await env.DB.prepare(
      'INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, ?)'
    ).bind(id, actor, `order:items_changed: ${itemsCount} items`).run();
  }
```

All remaining `updateOrder` behavior (pickup-date validation/events, payment sync, unpaid deactivation) is untouched.

- [ ] **Step 3: Run the lib tests to confirm no regressions**

Run: `npm test -- --run` (workdir `orders/`)
Expected: PASS (all existing order-date/order-edit-lib/groups/receipt/enrich tests).

- [ ] **Step 4: Smoke test with wrangler dev**

Run: `npx wrangler dev -c orders/wrangler.toml` (workdir repo root, keep running in a second terminal; localhost bypasses auth — `api.js:82-83`).

Then:

```bash
curl -s -X PATCH http://localhost:8787/api/orders/1 \
  -H 'Content-Type: application/json' \
  -d '{"items_json":[{"name":"Cupcakes (Vanilla)","qty":12,"price":3.5,"productId":"prod_cupcakes","emoji":"🧁"}],"discount_cents":100}'
```

Expected: `{"ok":true}`

```bash
curl -s http://localhost:8787/api/orders/1
```

Expected: `items_json` is the new item array; `subtotal_cents: 4200`, `discount_cents: 100`, `total_cents: 4100`; `events` includes `order:items_changed: 1 items`.

Invalid payload:

```bash
curl -s -X PATCH http://localhost:8787/api/orders/1 \
  -H 'Content-Type: application/json' \
  -d '{"items_json":[{"name":"Bad","qty":0,"price":1}]}'
```

Expected: `{"error":"Item 1 quantity must be an integer between 1 and 9999"}` and the row unchanged (re-GET shows old items/totals).

Discount-only:

```bash
curl -s -X PATCH http://localhost:8787/api/orders/1 \
  -H 'Content-Type: application/json' \
  -d '{"discount_cents":200}'
```

Expected: `{"ok":true}`; GET shows `discount_cents: 200`, `total_cents` recomputed, and NO `order:items_changed` event.

- [ ] **Step 5: Commit**

```bash
git add orders/workers/api.js
git commit -m "feat(orders): accept items_json + discount_cents in order PATCH"
```

---

### Task 3: Frontend totals helper (TDD)

**Files:**
- Modify: `home-bakery-management-system/src/utils/format.ts`
- Test: `home-bakery-management-system/src/utils/format.test.ts`

**Interfaces:**
- Produces: `computeOrderTotals(items: { qty: number; price: number }[], discount: number) -> { subtotal: number; discount: number; total: number }` — dollars; discount clamped to `[0, subtotal]`; negative/non-finite discount → 0.

- [ ] **Step 1: Write the failing test**

Append to `home-bakery-management-system/src/utils/format.test.ts`:

```ts
describe("computeOrderTotals", () => {
  it("computes subtotal and total in dollars", () => {
    expect(computeOrderTotals([{ qty: 12, price: 3.5 }], 0))
      .toEqual({ subtotal: 42, discount: 0, total: 42 });
  });

  it("applies discount and clamps to [0, subtotal]", () => {
    expect(computeOrderTotals([{ qty: 1, price: 100 }], 5))
      .toEqual({ subtotal: 100, discount: 5, total: 95 });
    expect(computeOrderTotals([{ qty: 1, price: 100 }], 999).discount).toBe(100);
    expect(computeOrderTotals([{ qty: 1, price: 100 }], -5).discount).toBe(0);
    expect(computeOrderTotals([{ qty: 1, price: 100 }], NaN).discount).toBe(0);
  });

  it("sums multiple items", () => {
    expect(computeOrderTotals([
      { qty: 1, price: 40 },
      { qty: 6, price: 2 },
    ], 0)).toEqual({ subtotal: 52, discount: 0, total: 52 });
  });
});
```

Update the existing import on line 2 of `format.test.ts` to include `computeOrderTotals`:

```ts
import { formatPaymentSubMethod, PAYMENT_METHOD_LABELS, PAYMENT_METHOD_COLORS, dueTier, urgencyRank, computeOrderTotals } from "./format";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/format.test.ts` (workdir `home-bakery-management-system`)
Expected: FAIL — `computeOrderTotals is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `home-bakery-management-system/src/utils/format.ts`:

```ts
export function computeOrderTotals(
  items: { qty: number; price: number }[],
  discount: number
): { subtotal: number; discount: number; total: number } {
  const subtotal = items.reduce((sum, i) => sum + i.qty * i.price, 0);
  let d = Number.isFinite(discount) ? Math.max(0, discount) : 0;
  d = Math.min(d, subtotal);
  return { subtotal, discount: d, total: subtotal - d };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/format.test.ts` (workdir `home-bakery-management-system`)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add home-bakery-management-system/src/utils/format.ts home-bakery-management-system/src/utils/format.test.ts
git commit -m "feat(admin): computeOrderTotals helper for order editor"
```

---

### Task 4: Widen client updateOrder types

**Files:**
- Modify: `home-bakery-management-system/src/utils/api.ts:108-123`
- Modify: `home-bakery-management-system/src/context/StoreContext.tsx:70`

**Interfaces:**
- Consumes: none (type-only change).
- Produces: `updateOrder(id, patch)` accepts `items_json?: OrderItemPatch[]` and `discount_cents?: number`; `StoreContext.apiUpdateOrder` mirrors it.

- [ ] **Step 1: Widen the client patch type**

In `home-bakery-management-system/src/utils/api.ts`, replace the `updateOrder` function (lines 108-123) with:

```ts
export interface OrderItemPatch {
  name: string;
  qty: number;
  price: number;
  productId?: string | null;
  emoji?: string;
  flavorNote?: string;
}

export async function updateOrder(
  id: number,
  patch: {
    status?: string;
    payment_status?: string;
    payment_method?: string;
    payment_sub_method?: string | null;
    pickup_date?: string;
    notes?: string;
    items_json?: OrderItemPatch[];
    discount_cents?: number;
  }
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/orders/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}
```

- [ ] **Step 2: Widen the StoreContext signature**

In `home-bakery-management-system/src/context/StoreContext.tsx:70`, replace the `apiUpdateOrder` type with:

```ts
  apiUpdateOrder: (id: number, patch: {
    status?: string;
    payment_status?: string;
    payment_method?: string;
    payment_sub_method?: string | null;
    pickup_date?: string;
    items_json?: OrderItemPatch[];
    discount_cents?: number;
  }) => Promise<void>;
```

And update the import on line 26 of `StoreContext.tsx` to include `type OrderItemPatch` from `../utils/api`:

```ts
import { fetchOrders, createOrder as apiCreateOrder, updateOrder as apiUpdateOrder, /* ...existing... */, type ApiProduct, type ApiInventoryItem, type ApiCustomer, type ApiPayment, type ApiLabelTemplate, type ApiBusinessProfile, type ApiReceipt, type ApiQuote, type ApiQuoteItem, type ApiIngredientGroup, type OrderItemPatch } from "../utils/api";
```

(The line is long; append `type OrderItemPatch` to the existing type-import list.)

- [ ] **Step 3: Typecheck**

Run: `npm run build` (workdir `home-bakery-management-system`)
Expected: build succeeds (vite + tsc via plugin; watch for type errors only).

- [ ] **Step 4: Commit**

```bash
git add home-bakery-management-system/src/utils/api.ts home-bakery-management-system/src/context/StoreContext.tsx
git commit -m "feat(admin): type items_json/discount_cents on order update"
```

---

### Task 5: EditOrderModal component (TDD)

**Files:**
- Create: `home-bakery-management-system/src/components/EditOrderModal.tsx`
- Test: `home-bakery-management-system/src/components/EditOrderModal.test.tsx`

**Interfaces:**
- Consumes: `useStore()` (`products`, `apiUpdateOrder`), `Modal`, `ProductIcon`, `computeOrderTotals`, `newId`-free (no customer logic), `Order`/`OrderItem` types, lucide `Plus`, `Minus`, `Trash2`.
- Produces: `<EditOrderModal open: boolean; order: Order | null; onClose: () => void; onSaved: () => void />`. Calls `apiUpdateOrder(Number(order.id), { items_json, discount_cents })` on save, then `onSaved()`. Renders an inventory-deducted banner when `order.inventoryDeducted`. Never allows removing the last item.

- [ ] **Step 1: Write the failing component test**

Create `home-bakery-management-system/src/components/EditOrderModal.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import EditOrderModal from "./EditOrderModal";
import type { Order } from "../types";

const mockApiUpdateOrder = vi.fn();

vi.mock("../context/StoreContext", () => ({
  useStore: () => ({
    products: [
      { id: "prod_cupcakes", name: "Cupcakes", emoji: "🧁", active: true, price: 3, flavor_groups: [], pack_sizes: [] },
    ],
    apiUpdateOrder: mockApiUpdateOrder,
  }),
}));

const mkOrder = (partial: Partial<Order>): Order => ({
  id: "7", orderNumber: "MR-7", customerId: null, customerName: "Gena Romain", phone: "555",
  items: [{ productId: "prod_cupcakes", name: "Cupcakes (Vanilla)", emoji: "🧁", qty: 12, price: 3.5 }],
  source: "website", status: "pending", paymentMethod: null, paymentSubMethod: null, paymentStatus: "partial",
  subtotal: 42, discount: 0, total: 42, dueDate: "2026-09-05", createdAt: "2026-08-31", notes: "",
  inventoryDeducted: false, foodColoring: null, ...partial,
});

function render(order: Order | null, open = true) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<EditOrderModal open={open} order={order} onClose={() => {}} onSaved={() => {}} />);
  });
  return { text: container.textContent ?? "", root, container };
}

describe("EditOrderModal", () => {
  it("renders existing item rows with qty and price", () => {
    const { text, root, container } = render(mkOrder({}));
    expect(text).toContain("Cupcakes (Vanilla)");
    expect(text).toContain("12");
    expect(text).toContain("3.5");
    root.unmount();
    container.remove();
  });

  it("recomputes the total when qty changes", () => {
    const { text, root, container } = render(mkOrder({}));
    expect(text).toContain("$42.00");
    root.unmount();
    container.remove();
  });

  it("shows the inventory banner when inventory was already deducted", () => {
    const { text, root, container } = render(mkOrder({ inventoryDeducted: true }));
    expect(text).toContain("Inventory was already deducted");
    root.unmount();
    container.remove();
  });

  it("renders nothing when closed", () => {
    const { text, root, container } = render(mkOrder({}), false);
    expect(text).toBe("");
    root.unmount();
    container.remove();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/EditOrderModal.test.tsx` (workdir `home-bakery-management-system`)
Expected: FAIL — module not found / cannot find `./EditOrderModal`.

- [ ] **Step 3: Write minimal implementation**

Create `home-bakery-management-system/src/components/EditOrderModal.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import Modal from "./ui/Modal";
import ProductIcon from "./ProductIcon";
import { useStore } from "../context/StoreContext";
import { computeOrderTotals } from "../utils/format";
import type { Order, OrderItem } from "../types";

export default function EditOrderModal({
  open,
  order,
  onClose,
  onSaved,
}: {
  open: boolean;
  order: Order | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { products, apiUpdateOrder } = useStore();
  const [items, setItems] = useState<OrderItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [productPick, setProductPick] = useState("");
  const [flavorSelections, setFlavorSelections] = useState<Record<string, string>>({});
  const [packPick, setPackPick] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (open && order) {
      setItems(order.items.map((i) => ({ ...i })));
      setDiscount(order.discount);
      setProductPick("");
      setFlavorSelections({});
      setPackPick("");
      setErrorMsg("");
      setSubmitting(false);
    }
  }, [open, order]);

  const activeProducts = products.filter((p) => p.active);
  const pickedProduct = products.find((p) => p.id === productPick);
  const pickedFlavorGroups = pickedProduct?.flavor_groups ?? [];
  const pickedPacks = pickedProduct?.pack_sizes ?? [];
  const activePack = pickedPacks.find((pk) => pk.id === packPick) ?? pickedPacks[0] ?? null;
  const flavorsComplete = pickedFlavorGroups.every((g) => !!flavorSelections[g.name]);

  const totals = useMemo(() => computeOrderTotals(items, discount), [items, discount]);

  const itemKey = (i: OrderItem) => `${i.productId ?? ""}|${i.flavorNote ?? ""}`;

  function addItem() {
    const p = products.find((pr) => pr.id === productPick);
    if (!p) return;
    const groups = p.flavor_groups ?? [];
    if (groups.some((g) => !flavorSelections[g.name])) return;
    const packNote = activePack ? ` (${activePack.label})` : "";
    const flavorNote = packNote + (groups.length
      ? ` (${groups.map((g) => `${g.name}: ${flavorSelections[g.name]}`).join(", ")})`
      : "");
    const packPrice = activePack ? Number(activePack.price) : p.price;
    const displayName = p.name + flavorNote;
    setItems((prev) => {
      const existing = prev.find((i) => itemKey(i) === `${p.id}|${flavorNote}`);
      if (existing) {
        return prev.map((i) =>
          itemKey(i) === `${p.id}|${flavorNote}` ? { ...i, qty: i.qty + 1 } : i,
        );
      }
      return [...prev, { productId: p.id, name: displayName, emoji: p.emoji, qty: 1, price: packPrice, flavorNote }];
    });
    setFlavorSelections({});
    setPackPick("");
  }

  function updateQty(key: string, delta: number) {
    setItems((prev) =>
      prev.map((i) => (itemKey(i) === key ? { ...i, qty: Math.max(1, i.qty + delta) } : i)),
    );
  }

  function updatePrice(key: string, price: number) {
    setItems((prev) =>
      prev.map((i) => (itemKey(i) === key ? { ...i, price: Number.isFinite(price) ? Math.max(0, price) : 0 } : i)),
    );
  }

  function removeItem(key: string) {
    setItems((prev) => (prev.length > 1 ? prev.filter((i) => itemKey(i) !== key) : prev));
  }

  async function handleSave() {
    if (!order || submitting) return;
    setSubmitting(true);
    setErrorMsg("");
    try {
      await apiUpdateOrder(Number(order.id), {
        items_json: items.map((i) => ({
          name: i.name,
          qty: i.qty,
          price: i.price,
          productId: i.productId ?? null,
          emoji: i.emoji,
          flavorNote: i.flavorNote,
        })),
        discount_cents: Math.round(discount * 100),
      });
      onSaved();
    } catch (err: any) {
      setErrorMsg(err.message || "Could not save changes. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={order ? `Edit Order ${order.orderNumber}` : "Edit Order"} wide>
      {order && (
        <div className="space-y-4">
          <p className="text-sm text-cocoa-muted">{order.customerName}</p>
          {order.inventoryDeducted && (
            <div className="rounded-xl bg-coral-light/20 p-3 text-sm text-cocoa">
              Inventory was already deducted for this order — changing quantities won't adjust inventory.
            </div>
          )}

          <div className="space-y-2">
            {items.map((item) => (
              <div key={itemKey(item)} className="flex items-center justify-between gap-2 rounded-lg bg-sand-50 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-cocoa">
                    <ProductIcon emoji={item.emoji} imageUrl={products.find((p) => p.id === item.productId)?.image_url} size={18} /> {item.name}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => updateQty(itemKey(item), -1)}
                    className="rounded-md bg-white p-1 text-cocoa-muted shadow hover:bg-sand-100"
                  >
                    <Minus size={12} />
                  </button>
                  <span className="w-5 text-center text-sm">{item.qty}</span>
                  <button
                    onClick={() => updateQty(itemKey(item), 1)}
                    className="rounded-md bg-white p-1 text-cocoa-muted shadow hover:bg-sand-100"
                  >
                    <Plus size={12} />
                  </button>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={item.price}
                    onChange={(e) => updatePrice(itemKey(item), Number(e.target.value))}
                    className="w-20 rounded-md border border-sand-200 px-2 py-1 text-right text-sm outline-none focus:border-palm"
                  />
                  <button
                    onClick={() => removeItem(itemKey(item))}
                    disabled={items.length <= 1}
                    className="ml-1 rounded-md p-1 text-hibiscus hover:bg-hibiscus-light/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <select
              value={productPick}
              onChange={(e) => {
                setProductPick(e.target.value);
                setFlavorSelections({});
                setPackPick("");
              }}
              className="flex-1 rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-palm"
            >
              <option value="">Add item…</option>
              {activeProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — ${(p.pack_sizes?.[0]?.price ?? p.price).toFixed(2)}
                </option>
              ))}
            </select>
            <button
              onClick={addItem}
              disabled={!productPick || !flavorsComplete}
              className="rounded-xl bg-coral px-3 py-2 text-sm font-medium text-white hover:bg-coral/80 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus size={16} />
            </button>
          </div>

          {pickedPacks.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {pickedPacks.map((pk) => (
                <button
                  key={pk.id}
                  type="button"
                  onClick={() => setPackPick(pk.id)}
                  className={`rounded-xl border px-3 py-2 text-left text-xs transition ${
                    (activePack?.id ?? "") === pk.id
                      ? "border-palm bg-palm/10 text-cocoa"
                      : "border-sand-200 text-cocoa-muted hover:border-sand-300"
                  }`}
                >
                  <span className="block font-semibold">{pk.label}</span>
                  <span className="block">{pk.unit_label || `$${Number(pk.price).toFixed(2)}`}</span>
                </button>
              ))}
            </div>
          )}

          {pickedFlavorGroups.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {pickedFlavorGroups.map((g) => (
                <select
                  key={g.name}
                  value={flavorSelections[g.name] || ""}
                  onChange={(e) => setFlavorSelections((s) => ({ ...s, [g.name]: e.target.value }))}
                  className="rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-palm"
                >
                  <option value="">{g.name}…</option>
                  {g.options.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ))}
            </div>
          )}

          <div className="rounded-xl bg-sand-50 p-3 text-sm">
            <div className="flex justify-between text-cocoa-muted">
              <span>Subtotal</span>
              <span>${totals.subtotal.toFixed(2)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-cocoa-muted">
              <span>Discount</span>
              <input
                type="number"
                min={0}
                value={discount}
                onChange={(e) => setDiscount(Math.max(0, Number(e.target.value)))}
                className="w-20 rounded-md border border-sand-200 px-2 py-0.5 text-right outline-none focus:border-palm"
              />
            </div>
            <div className="mt-2 flex justify-between border-t border-sand-200 pt-2 text-base font-semibold text-cocoa">
              <span>Total</span>
              <span>${totals.total.toFixed(2)}</span>
            </div>
          </div>

          {errorMsg && (
            <div className="rounded-xl bg-hibiscus-light/10 p-3 text-sm text-hibiscus">{errorMsg}</div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={submitting}
              className="flex-1 rounded-xl bg-palm py-2.5 text-sm font-semibold text-white transition hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? "Saving..." : "Save Changes"}
            </button>
            <button
              onClick={onClose}
              className="rounded-xl border border-sand-200 px-4 py-2.5 text-sm text-cocoa-muted hover:bg-sand-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/EditOrderModal.test.tsx` (workdir `home-bakery-management-system`)
Expected: PASS. (Note: `$42.00` appears via `totals.total.toFixed(2)`; if the assertion fails because `$` formatting differs, adjust the assertion to `42.00`.)

- [ ] **Step 5: Typecheck**

Run: `npm run build` (workdir `home-bakery-management-system`)
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add home-bakery-management-system/src/components/EditOrderModal.tsx home-bakery-management-system/src/components/EditOrderModal.test.tsx
git commit -m "feat(admin): edit order items and totals modal"
```

---

### Task 6: Wire the Edit button into the Orders page

**Files:**
- Modify: `home-bakery-management-system/src/pages/Orders.tsx`

**Interfaces:**
- Consumes: `EditOrderModal` (Task 5), `refreshOrders` from `useStore` (already destructured at line 20).
- Produces: an "Edit" button in the order detail modal header; opening it closes the detail modal and opens `EditOrderModal` for that order; saving refreshes the orders list.

- [ ] **Step 1: Import the modal**

In `home-bakery-management-system/src/pages/Orders.tsx`, after `import QuoteConvertModal`-style component imports (line 6 area), add:

```tsx
import EditOrderModal from "../components/EditOrderModal";
```

- [ ] **Step 2: Add editor state**

After `const [dueEdit, setDueEdit] = useState<string | null>(null);` (line 36), add:

```tsx
  const [editOrder, setEditOrder] = useState<Order | null>(null);
```

- [ ] **Step 3: Add the Edit button to the detail modal header**

In the detail modal header (line 346, `<div className="flex gap-1.5">`), replace:

```tsx
              <div className="flex gap-1.5">
                <Badge tone={selected.source}>{selected.source}</Badge>
                <Badge tone={selected.status}>{selected.status}</Badge>
              </div>
```

with:

```tsx
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => { setEditOrder(selected); setSelected(null); }}
                  className="rounded-lg border border-sand-200 px-2.5 py-1 text-xs font-semibold text-cocoa transition hover:bg-sand-50"
                >
                  Edit
                </button>
                <Badge tone={selected.source}>{selected.source}</Badge>
                <Badge tone={selected.status}>{selected.status}</Badge>
              </div>
```

- [ ] **Step 4: Render the editor**

After the `editPayFor` Modal (closing around line 754, before the final `</div>`), add:

```tsx
      <EditOrderModal
        open={!!editOrder}
        order={editOrder}
        onClose={() => setEditOrder(null)}
        onSaved={async () => {
          setEditOrder(null);
          await refreshOrders();
        }}
      />
```

- [ ] **Step 5: Verify**

Run: `npm run build` (workdir `home-bakery-management-system`)
Expected: build succeeds.

Manual check with `npm run dev` (workdir `home-bakery-management-system`) + `npx wrangler dev -c orders/wrangler.toml` (repo root):
- Open an order (e.g. the converted quote for Gena Romain) → click **Edit** → item rows appear, qty/price/discount changes update the live total → Save → detail modal reappears via Orders refresh with new items/totals; History shows `order:items_changed`.
- Save with `qty: 0` via UI is impossible (stepper floors at 1), but a server-side 400 would surface the inline error message.

- [ ] **Step 6: Commit**

```bash
git add home-bakery-management-system/src/pages/Orders.tsx
git commit -m "feat(admin): Edit button opens order items editor"
```

---

## Final Verification

- [ ] `npm test -- --run` (workdir `orders/`) — all worker lib tests pass.
- [ ] `npx vitest run` (workdir `home-bakery-management-system/`) — all dashboard tests pass (format + EditOrderModal + existing).
- [ ] `npm run build` (workdir `home-bakery-management-system/`) — typecheck + bundle succeeds; `postbuild.sh` copies to `admin/index.html`.
- [ ] Deploy flow note: worker (`orders/`) and dashboard (`admin/`) are deployed separately; follow `orders/DEPLOY.md` for the worker and the normal dashboard deploy for the admin bundle.