# Edit Order (Items + Totals) — Design

Date: 2026-08-31
Status: Approved

## Problem

Orders created from cake quotes (or any order) cannot be edited once created. The quote
editor locks a quote permanently at conversion (`assertQuoteEditable` rejects `converted`
quotes in `orders/workers/api.js`), and the admin Orders page has no way to change an
order's line items or totals — the PATCH allowlist covers only `status`, `payment_status`,
`notes`, `pickup_date`, `pickup_time`, `payment_method`, `payment_sub_method`,
`food_coloring`, `customer_id`. A user converting quote → order for "Gena Romain" lost all
edit capability: the quote was locked and the resulting order had no edit UI.

## Scope

Admin-app editing of order **line items and totals** for any order (all sources, all
statuses):

- Add/remove line items, change quantity, change per-item price.
- Edit discount; subtotal/total recompute automatically (server-authoritative).
- Inventory is NOT re-deducted; the editor shows a note when inventory was already deducted.
- Existing payments, receipts, events, customer link, dates, notes, and language are
  untouched by this feature.

Out of scope (considered, rejected): editing customer name/phone/email/notes/dates/payment
from this modal, un-converting orders back to quotes, re-running inventory deduction,
blocking edits for deducted orders, website-visible order edits.

## Approach

Extend the existing `PATCH /api/orders/:id` update path (single mutation endpoint) and add
items/totals support to it. Validation and money math live in a new pure module so they can
be unit-tested without a fetch harness (same pattern as `orders/workers/order-date.js`).

## Design

### Backend — new pure module `orders/workers/order-edit-lib.js`

Exports two functions:

- `validateOrderItems(items)` → `{ ok: true, error: null } | { ok: false, error: string }`
  - `items` must be a non-empty array.
  - Each item must be an object with:
    - `name`: non-empty string (trimmed length ≥ 1, ≤ 200 chars).
    - `qty`: positive integer, 1 ≤ qty ≤ 9999.
    - `price`: finite number ≥ 0 and ≤ 10000 (dollars).
  - Extra keys (`productId`, `emoji`, `flavorNote`) are preserved verbatim and not
    validated.
  - First invalid item returns a specific error naming the item index.
- `computeOrderTotals(items, discountCents)` → `{ subtotalCents, totalCents }`
  - `subtotalCents = Σ round(qty * price * 100)` (round-half-away-from-zero via
    `Math.round`).
  - `discountCents` clamped to `[0, subtotalCents]`.
  - `totalCents = subtotalCents - discountCents`.
  - Totals are always server-computed — the client never supplies them.

### Backend — `updateOrder` (`orders/workers/api.js:642`)

- Add `items_json` and `discount_cents` to the PATCH allowlist.
- `items_json` handling (when present):
  1. Stringify if the client sent an array (`typeof body.items_json === 'string' ? body.items_json : JSON.stringify(body.items_json)` — mirrors `createOrder`).
  2. Parse the stored/string value, run `validateOrderItems` → 400 with the specific error on failure.
  3. If `discount_cents` present: validate integer ≥ 0 → 400 otherwise; else keep the row's existing `discount_cents`.
  4. Compute `subtotal_cents`/`total_cents` via `computeOrderTotals`, write `items_json`, `subtotal_cents`, `discount_cents`, `total_cents` together.
- `discount_cents` without `items_json`: recompute `total_cents = subtotal_cents - discount_cents` (validate ≥ 0), write both.
- All validation happens BEFORE any write; a failed payload leaves the row untouched.
- Events: the existing generic `order:updated` still fires; additionally `order:items_changed: <N> items` is logged when `items_json` is written.
- No payment-sync, no pickup-date side effects, no inventory changes.
- All other PATCH behavior unchanged.

### Admin — new component `EditOrderModal.tsx`

Props: `{ open, order, onClose }`. Rendered from a new **Edit** button in the order detail
modal header (`Orders.tsx`, next to the source/status badges).

- Item rows loaded from `order.items`:
  - Name: read-only text (existing lines are immutable in name; qty/price editable).
  - Qty stepper (− / value / +), min 1.
  - Per-item price input (number, ≥ 0, 2 decimals).
  - Remove button; list must keep ≥ 1 item.
- **Add item** section: product select + flavor-group selects + pack-size picker + Add
  button — same behavior as `OrderModal.tsx` (addItem/updateQty/removeItem logic).
- Discount input (dollars, ≥ 0).
- Live subtotal/total via `computeOrderTotals(items, discount)` added to
  `utils/format.ts` (cents → dollars at the boundary).
- Banner when `order.inventoryDeducted`: "Inventory was already deducted for this order —
  changing quantities won't adjust inventory."
- Save: `apiUpdateOrder(Number(order.id), { items_json: items, discount_cents })`, then
  `refreshOrders()` (StoreContext already refetches), close modal.
- Error from server (400): show inline message, keep modal open with current edits.
- Converted-quote orders (single collapsed line, possibly `productId: null`) edit normally:
  qty/price on the existing line plus new lines via the picker.

### Admin — types (`utils/api.ts`, `StoreContext.tsx`)

- Widen the `updateOrder` patch type: `items_json?: OrderItem[]`, `discount_cents?: number`.
- `StoreContext.handleApiUpdateOrder` unchanged (already refetches orders after update).

### No migration

No schema changes; `items_json` is already TEXT and `subtotal_cents`/`discount_cents`/
`total_cents` already exist (migration 0037).

## Error handling

| Case | Result |
|---|---|
| Empty items array | `400 { error: 'At least one item is required' }` |
| Item missing name / blank name | `400` naming the item index |
| qty 0, negative, non-integer, > 9999 | `400` naming the item index |
| price negative, NaN, > $10,000 | `400` naming the item index |
| `discount_cents` negative or non-integer | `400` |
| Order not found | Existing `404` behavior |
| Items change after inventory deducted | Allowed; editor shows the banner note |
| Total changes vs. recorded payments | Payments untouched (out of scope; payment panel already shows history) |

## Testing

- New Vitest file `orders/tests/order-edit-lib.test.js`:
  - `validateOrderItems`: accepts valid single/multi item payloads; rejects empty array,
    blank names, qty bounds, price bounds, NaN, non-array input; preserves extra keys.
  - `computeOrderTotals`: subtotal math incl. fractional cents rounding; discount clamp at
    0 and at subtotal; zero-price items; large qty.
- `home-bakery-management-system/src/utils/format.test.ts`: `computeOrderTotals` dollars
  cases (existing test file, existing vitest runner).
- Local smoke test via `npx wrangler dev -c orders/wrangler.toml` + curl:
  - PATCH items_json (valid) → 200; `GET /api/orders/:id` shows new items/totals and the
    `order:items_changed` event.
  - PATCH with an invalid item → 400, row unchanged.
  - PATCH discount_cents only → 200, total recomputed.
- Admin: `npm run build` (typecheck + bundle) passes; manual check that editing an order
  updates the Orders table, detail modal, and label generation uses the new items.

## Docs

Design doc committed here; implementation plan follows via writing-plans.