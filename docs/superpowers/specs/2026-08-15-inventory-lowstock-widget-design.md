# Design: Actionable Low-Stock Widget on Dashboard

Date: 2026-08-15

## Goal

Replace the dashboard's passive low-stock alert chips with an actionable widget that lets the owner act on low stock without leaving the dashboard: inline +/- steppers and a Restock dialog that adds received quantities.

## Current state

- `Dashboard.tsx` renders a "Low stock items" StatCard (count + critical sub) and, when `lowStock.length > 0`, an alert chips section split into Critical (qty <= 0) and Low chips with a "Manage inventory →" link.
- `Inventory.tsx` has full CRUD, +/- steppers (via `apiUpdateInventoryItem`), scan history, USDA enrichment, and prep-list demand.
- `StoreContext` exposes `apiUpdateInventoryItem(id, patch)` which calls the API then `refreshInventory()`.

## Design

### 1. Component & layout

New component `src/components/InventoryLowStockWidget.tsx`, rendered in `Dashboard.tsx` in place of the current low-stock alert chips section.

- Card style matches existing dashboard cards: `rounded-xl border border-sand-200 bg-white shadow-sm`.
- Header row: "Low stock" title + count badge on the left, "Manage inventory →" link on the right (calls `setPage("inventory")` via a prop callback `onManageInventory`).
- Body: up to 8 rows, each showing:
  - Item name (truncated)
  - `quantity unit` and reorder threshold (e.g. "2 each · reorder at 5")
  - Severity badge: "Out" (qty <= 0, hibiscus) or "Low" (coral)
  - Inline −/+ steppers (same styling as Inventory page)
  - "Restock" button
- If more than 8 low-stock items: footer shows "+N more — View all in Inventory" link.
- Empty state (no low-stock items): friendly "All stocked up" message in the same card so layout stays stable.
- The existing "Low stock items" StatCard stays unchanged.

### 2. Behavior

- **Sorting:** out-of-stock first (qty <= 0), then by percentage shortfall below reorder level (descending), ties broken alphabetically by name. Pure helper `sortLowStock(items, limit)` — unit-testable. Cap at 8.
- **Steppers:** −/+ adjust by 1 via `apiUpdateInventoryItem(id, { quantity: newTotal })` (same pattern as Inventory page). − disabled at 0. Quantity clamped at >= 0, rounded to 2 decimals.
- **Restock dialog:** small `ui/Modal` per item. Shows item name, current stock + unit. Input labeled "Amount received" — the entered value is **added** to current quantity. Validation: numeric, > 0 (allow decimals, step 0.01). Save calls `apiUpdateInventoryItem(id, { quantity: current + received })` and closes on success.

### 3. Data flow & error handling

- Reads `inventory` from `useStore`.
- All writes via `apiUpdateInventoryItem` (pessimistic — matches Inventory page; inventory refreshes after success).
- Errors: inline error message in the restock dialog and a transient inline error text in the widget for stepper failures. No `alert()`.

### 4. Testing

Vitest + React Testing Library (pattern matches `DashboardUpcomingWidget.test.tsx`):

- `sortLowStock`: out-of-stock first, then shortfall percentage; cap at limit.
- Widget renders sorted rows with correct badges.
- Empty state renders when nothing is low.
- Stepper + calls `apiUpdateInventoryItem` with quantity + 1; − disabled at 0.
- Restock dialog adds received amount and calls update with correct new total; invalid input (0, negative, non-numeric) does not submit.
- "+N more" footer shows when > 8 low items.

## Out of scope

- Changes to the Inventory page itself.
- Scan history recording for widget adjustments (Inventory page steppers don't record scan events either).
- Supplier ordering / shopping list features.
- Optimistic updates.
