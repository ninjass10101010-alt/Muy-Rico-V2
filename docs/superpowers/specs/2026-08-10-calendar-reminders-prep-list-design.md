# Calendar, Reminders & Prep List Design

**Date:** 2026-08-10
**Status:** Design Approved
**Approach:** A — Pure client-side, persisted in BusinessProfile

## Problem

The Muy Rico bakery admin dashboard (`home-bakery-management-system/`) has no way to visualize upcoming orders on a calendar, no reminders before orders are due, and no "what ingredients do I need for upcoming orders" prep view. Orders are shown only as a flat urgency-sorted list. The bakery team needs to see the workload ahead of time, get reminded before orders come due, and know what inventory to prep or buy.

## Scope

Three integrated features, all client-side, all reading existing `StoreContext` data:

1. **Calendar page** — Month, Week, Day, and List views of orders by due date.
2. **Reminders** — In-app bell dropdown with snooze/dismiss, configurable lead time.
3. **Prep List** — Aggregate ingredients required for orders in a date window vs. current inventory, with shortfall highlighting. Bridged to the existing Inventory page.

Out of scope: email/push notifications, server-side cron jobs, new DB tables, shared snooze state across devices.

## Architecture

Pure client-side. No backend changes. No migrations. No new API endpoints.

```
StoreContext (existing)
  orders · products · inventory · profile
        │
        ▌
        ▼
┌─────────────────────────────────────────────────┐
│ Pure utils (new, fully unit-testable)           │
│  computeReminders(orders, config) → Reminder[]  │
│  computePrepList(orders, products, inventory,   │
│                  options) → PrepListResult      │
│  calendarGrid(month) → CalendarCell[]           │
└─────────────────────────────────────────────────┘
        │
        ▌
        ▼
┌─────────────────────────────────────────────────┐
│ New hook: useReminders()                        │
│  - 60s interval, paused when tab hidden         │
│  - reads/writes localStorage snooze state       │
│  - returns { reminders, unreadCount, snooze,    │
│              dismiss, markAllRead }              │
└─────────────────────────────────────────────────┘
        │
        ▌
        ▼
┌──────────────┬───────────────────┬──────────────┐
│ Topbar bell  │ Calendar page     │ Dashboard    │
│ (always on)  │ (Month/Week/Day/   │ widget       │
│              │  List + reminders  │              │
│              │  + prep panel)     │              │
└──────────────┴───────────────────┴──────────────┘
        │
        ▌ (bidirectional)
        ▼
Inventory page (existing) — gains an optional "Upcoming demand"
column + a "Prep for upcoming" header pill.
```

## Navigation & Page Structure

### New sidebar entry
A `Calendar` nav item inserted between **Orders** and **Cake Quotes** with the `CalendarDays` lucide icon. It gets a coral badge showing the count of orders due within the active reminder window (mirrors how Quotes already shows a pending count).

### New `calendar` page (`src/pages/CalendarView.tsx`)
Top-level URL: `/admin/calendar`. Layout: calendar grid (left, ~⅔ width) + side panel (right, ~⅓ width) with three collapsible sections — Reminders, Day detail, Prep list.

### Dashboard widget
A compact "Upcoming orders" card on the Dashboard page showing the top 3 reminders (reusing `useReminders()`) with colored tier badges + a "View calendar →" button. The existing "Due next 48h" stat card and "Orders needing attention" list remain.

### Topbar bell
A `Bell` icon added to the existing `Topbar` (right side, between search and the **+ New** button) with a coral count badge. Click → dropdown of reminders. Click outside closes.

## Calendar Views

Four views, switchable via a tab bar at the top of the Calendar page.

### Month view
High-level density scan. Dots/badges on dates with due orders. Click a date → Day view. Hover → mini tooltip with that day's order count. Header has ‹ › month navigation + a month/year label (e.g. "June 2026").

### Week view
Mid-zoom. Seven day columns. Each day cell lists up to 3 order numbers; overflow shows "+N more". Click any day → Day view.

### Day view
Operational schedule for a single day. The four-view drill-down target.

**Header:** `‹ Wed, June 11, 2026 ›` with day-by-day navigation arrows. A small calendar glyph drops back to the Month view. The URL hash carries `#calendar/2026-06-11` for shareable deep links.

**Timeline grid:** Vertical hour rows spanning a configurable range (default 9am–7pm, driven by the `dayStartTime`/`dayEndTime` reminder config). Each order is placed in the row matching its `dueDate` time. Orders whose `dueDate` carries no time component stack into an "unscheduled" bucket at the bottom of the timeline.

**Per-order card** (within the timeline row):
- Customer name, pickup time (parsed from `dueDate`), total ($), payment-status icon.
- Item list: emoji + qty + flavor note (uses existing `ProductIcon` component).
- Order notes quoted below the items.
- Click the card → opens the same order-detail modal used on the Orders page (reuses existing detail/receipt flows).

**Buttons on the Day view:**
- `[+ New order for this day]` — opens the existing `OrderModal` with the due date pre-filled to this day.
- `[Prep needs for this day →]` — scrolls the side panel's Prep List section into view, scoped to that day.

**Empty state:** "No orders scheduled for this day" + a [+ New order] button pre-filled with that date.

### List view
Fallback. The current urgency-sorted Orders list shape (reuses `urgencyRank()`), scoped to the reminder window. Useful for triage without calendar visualization.

### Pickup time handling
No data model change required to ship. `Order.dueDate` is already an ISO string used by `dueTier()`. Orders with date-only `dueDate` land in the Day view's "unscheduled" bucket. A future enhancement can extend `OrderModal` to capture a specific pickup time; this spec does not require that change.

## Reminders

### Reminder tiers
Computed by a pure function `computeReminders(orders, config): Reminder[]`, reusing the existing `dueTier()` logic so tiers stay consistent with the rest of the app.

| Tier | Condition | Badge color |
|------|-----------|-------------|
| `overdue` | due in the past, not cancelled/completed | red ⚠ |
| `today` | due today | coral ⏰ |
| `tomorrow` | due tomorrow | amber 📅 |
| `leadDays` | due within `reminderLeadDays` (default 2) | muted |
| `dismissed` | snoozed past its tier / explicitly cleared | hidden |

Only active orders count (`status !== "completed" && status !== "cancelled"`).

### Config (added to `BusinessProfile`)
Four new fields persisted via the existing `fetchProfile` / `updateProfile` API (no new endpoints):

```ts
reminders: {
  leadDays: number;            // default 2 — remind N days before due
  dayOf: boolean;              // default true — also fire on the due day
  defaultSnoozeHours: number;  // default 24
  dayStartTime: number;        // default 9  — hour-of-day the Day view timeline begins
  dayEndTime: number;          // default 19 — hour-of-day the Day view timeline ends
}
```

Settings page gets a new "Reminders" card editing these values.

### Snooze / dismiss state
Lives in `localStorage` (per-browser, per-device for this in-app-only feature):

```ts
{
  [orderId: string]: {
    dismissedAt: string;      // ISO
    snoozedUntil: string | null;
  }
}
```

A snoozed reminder reappears when `now > snoozedUntil`. "Mark all read" clears all current-tier reminders without preventing future fires. If shared snooze state across devices becomes important later, escalate to a D1 table.

### `useReminders` hook (`src/hooks/useReminders.ts`)
```ts
useReminders(): {
  reminders: Reminder[];       // sorted: overdue → today → tomorrow → leadDays
  unreadCount: number;         // for the bell badge
  snooze: (id: string, hours: number) => void;
  dismiss: (id: string) => void;
  markAllRead: () => void;
}
```

- Re-evaluates on a 60-second interval while the dashboard tab is visible.
- Pauses on `document.visibilitychange === "hidden"` to prevent CPU churn when backgrounded.
- Returns stable function identities (wrapped in `useCallback`).

### Reminder surfaces
1. **Topbar bell** with badge — always visible from any page.
2. **Dashboard "Upcoming" widget** — reuses `useReminders()` to show the top 3 reminders inline; a bell glyph links to open the dropdown / Calendar page.
3. **Calendar page side panel** — "Reminders" collapsible section mirrors the bell dropdown, scoped to the active calendar window.

## Prep List

Pure function, fully testable in isolation:

```ts
computePrepList(
  orders: Order[],
  products: Product[],
  inventory: InventoryItem[],
  options: { windowStart: string; windowEnd: string }
): PrepListResult
```

### Algorithm
1. Filter orders to the date window, excluding cancelled orders.
2. For each order's items, find the product by `productId` and read its `recipe[]`.
3. For each recipe line, multiply `qtyPerUnit × orderQty`. If the order item came through a pack size, multiply by `PackSize.qty` (the per-pack count) instead of the raw order qty.
4. Aggregate sums by `inventoryItemId` using a `Map` (so multiple products sharing one inventory item, e.g. flour in conchas + empanadas, are summed correctly).
5. Compare aggregated need against `inventory.quantity` to compute shortfall: `short = max(0, need - have)`.
6. Return shortfalls (sorted by `short` desc) and OK items separately.

### Edge cases
- Product with no `recipe` → counted in a separate "needs manual entry" list, not silently dropped.
- Cancelled orders → excluded from the window.
- Inactive (archived) inventory items → still counted for need, flagged separately since you cannot deduct from them.
- Multiple products sharing one inventory item → needs correctly summed via `Map` aggregation.

### Scoping options

| Scope | Source | Use case |
|-------|--------|----------|
| All upcoming (reminder window) | All active orders due within `reminderLeadDays` | "What do I need to buy this week?" |
| Specific day | Day view → "Prep needs for this day" button | "What should I pull from the fridge tonight for tomorrow?" |
| Custom range | Date-picker header dropdown in the Prep panel | E.g. Jun 11–14 for weekend prep |

### Inventory page bridge (three touchpoints)

The Inventory page (existing) stays the source of truth for "what do I have right now". The Prep List answers "what do I *need* for upcoming orders". They bridge bidirectionally:

**1. Calendar Prep List → Inventory:**
Each short ingredient row gets:
- **"Open Inventory: {item name}"** → calls `setPage("inventory")` with a `highlightId` prop (mirrors the existing pattern where `Orders.tsx` accepts `setLabelFilter` from `App.tsx`). The Inventory page scrolls to and briefly highlights the row.
- **"Adjust +N"** quick button → calls the existing `apiUpdateInventoryItem(id, { quantity: current + N })` directly from the Prep card (matches the existing `adjust()` pattern on the Inventory page) so the baker can top up without leaving the Calendar page.

**2. Inventory page: optional "Upcoming demand" column:**
A new toggleable column on the Inventory table showing the aggregate quantity required for orders in the reminder window. Shows ⚠ if `need > current` quantity. Shows `—` if no product uses the inventory item in any recipe (no opinion). Click the cell → jumps to Calendar page with Prep panel scoped to the reminder window.

**3. Inventory page header: "Prep for upcoming" summary pill:**
A new pill in the Inventory header (alongside the existing "Inventory value" and "Low stock" pills) styled consistently. Text: `"Prep for N orders · M short →"`. Click → Calendar page with Prep panel scrolled + scoped to the reminder window.

### What stays unchanged on the Inventory page
All existing CRUD, scan, USDA lookup, scan history, ±adjust buttons, and low-stock logic. The new column + pill are additive and derived purely from `computePrepList()`.

### Where Prep List surfaces
- **Calendar page side panel** — collapsible "Prep list" section, scoped to the active calendar window (Month → month, Day → that day, Week → that week).
- **Day view** — "Prep needs for this day →" button opens the same Prep panel scoped to the selected day.
- **Dashboard widget** (optional) — compact "Prep today" row showing shortfall count + top 2 short ingredients, linking to Calendar page. Kept short to avoid dashboard crowding.

## Data Flow

```
Order.items[]                Product (by productId)         InventoryItem (by recipeInventoryItemId)
────────────                 ──────────────────────          ────────────────────────────────────────
{productId, qty: 12}   →    recipe: [                      inventory.quantity = 6
                              {inventoryItemId: "fl-ap",
                               qtyPerUnit: 1.0}            need: 12 × 1.0 = 12
                            ]                              have: 6
                            recipe: [                       SHORT: 12 - 6 = 6
                              {inventoryItemId: "eggs",
                               qtyPerUnit: 1.5}            need: 12 × 1.5 = 18
                            ]                              have: 24 → OK
```

Both the Calendar page (scoped to its window) and the Inventory page (scoped to the reminder window) call `computePrepList()` from `orders` + `products` + `inventory` already in `StoreContext`. No new context state to thread.

## Units & Files

### New files
- `src/pages/CalendarView.tsx` — the Calendar page (Month/Week/Day/List views + side panel).
- `src/components/ReminderBell.tsx` — the Topbar bell dropdown (renders `useReminders()`).
- `src/components/DashboardUpcomingWidget.tsx` — the dashboard widget.
- `src/hooks/useReminders.ts` — the reminder hook.
- `src/utils/reminders.ts` — `computeReminders()` pure function.
- `src/utils/prepList.ts` — `computePrepList()` pure function.
- `src/utils/calendarGrid.ts` — `calendarGrid(month)` pure helper.
- `src/utils/reminders.test.ts` — unit tests for `computeReminders`.
- `src/utils/prepList.test.ts` — unit tests for `computePrepList`.

### Modified files
- `src/App.tsx` — add `"calendar"` to `Page` union, render `<CalendarView>`.
- `src/components/Sidebar.tsx` — add Calendar nav item (between Orders and Cake Quotes), badge from reminder window count.
- `src/components/Topbar.tsx` — add `<ReminderBell>`.
- `src/pages/Dashboard.tsx` — add `<DashboardUpcomingWidget>` (replace or sit beside existing "Orders needing attention").
- `src/pages/Inventory.tsx` — accept a new optional `highlightId` prop; add optional "Upcoming demand" column + header pill.
- `src/pages/Settings.tsx` — add "Reminders" card.
- `src/types.ts` — add `reminders` field to `BusinessProfile`.
- `src/data/seedData.ts` — add reminder defaults to `seedProfile`.
- `src/utils/api.ts` — map the new `reminders` sub-object in `ApiBusinessProfile` ↔ `BusinessProfile`.

## Testing

Pure util functions are unit-tested in isolation (no React, no mocks):

- `computeReminders`: overdue / today / tomorrow / leadDays / dismissed / cancelled-excluded / empty-orders.
- `computePrepList`: basic aggregation, shared-inventory-item sum, missing recipe (manual-entry bucket), cancelled-excluded, pack-size multiplication, inactive inventory item flagging, empty window.

The existing vitest setup (`vitest.config.ts`, `npm test`) runs these. The existing dashboard visual can be checked by running `npm run dev` in `home-bakery-management-system/` and opening `http://localhost:5173/`.

## Non-Goals

- Browser desktop notifications / Web Notifications API (not chosen).
- Email or push reminders (not chosen; would require server cron).
- Shared snooze state across devices (can escalate to a D1 table later).
- A pickup-time picker in the OrderModal (a future enhancement; Day view degrades gracefully into the "unscheduled" bucket without it).
- Any change to existing Inventory CRUD flows on the Inventory page.
