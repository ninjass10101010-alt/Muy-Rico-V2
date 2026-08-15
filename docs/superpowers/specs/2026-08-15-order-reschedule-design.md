# Order Reschedule (Pickup Date Change) — Design

Date: 2026-08-15
Status: Approved

## Problem

When a customer changes their mind and wants a later pickup date, the owner has no way to
move an order in the admin app. The backend `PATCH /api/orders/:id` already accepts
`pickup_date`, but it is unused by the admin UI, untyped in the admin API client, has no
validation, logs no old→new history, and sends no notification. Today the owner must edit
the D1 database directly (or recreate the order) to move a date.

## Scope

Owner-only, admin-app rescheduling:

- Editable pickup date in the order detail modal (Orders page).
- Old→new date recorded in the order history (order_events).
- Owner notified via Telegram + email when a date is moved.
- No past dates allowed.

Out of scope (considered, rejected): customer self-service rescheduling, calendar
drag-and-drop, blocking moves for cancelled/completed/ready orders, pickup_time editing.

## Approach

Extend the existing update path rather than adding a new endpoint. The PATCH route,
validation plumbing, event logging, and notification helpers all already exist; the change
adds date-specific behavior inside them.

## Design

### Admin UI — order detail modal (`home-bakery-management-system/src/pages/Orders.tsx`)

- The detail modal footer currently shows read-only "Ordered … / Due …" dates. The Due date
  becomes an editable `<input type="date">` with a save affordance, styled to match the
  existing modal.
- `min` attribute = today's date (browser-level guard; backend validates too).
- On save: call the existing `apiUpdateOrder(order.id, { pickup_date })` wrapper via
  StoreContext, then refresh orders so the table, urgency ranking, and calendar views
  reflect the new date.
- On failure (e.g. 400 past date): show a small error message next to the field and revert
  the displayed value to the saved date.
- History: the modal gains a small "History" section that fetches `GET /api/orders/:id`
  (admin client gains a `fetchOrder(id)` helper — the endpoint already returns
  `{ order, events }`) and renders recent `order_events` with actor + timestamp. The new
  `order:pickup_changed` entries show up there; no backend change needed for this.
- Cancelled orders: field locked (read-only display).

### Admin types (`utils/api.ts`, `context/StoreContext.tsx`, `types.ts`)

- Widen the typed order update payload to include `pickup_date` (optional string).
- No type changes needed on the admin `Order` model — it already maps `pickup_date` to
  `dueDate`.

### Backend (`orders/workers/api.js` — `updateOrder`)

- `updateOrder` gains access to `ctx` (passed from the router) for `ctx.waitUntil`.
- When the request body includes `pickup_date`:
  1. Validate format `YYYY-MM-DD`; reject otherwise with `400`.
  2. Reject dates earlier than today (`400 { error: 'Pickup date cannot be in the past' }`).
     Comparison done against UTC today to match how pickup_date strings are stored.
  3. If the new date equals the stored `pickup_date`, skip (no event, no notification).
  4. Otherwise update the row as today (dynamic SET clause), then:
     - Insert event: `order:pickup_changed: <old> -> <new>` with the acting actor.
     - `ctx.waitUntil` owner notification: `notifyTelegram` + `notifyEmail` with a message
       like "Pickup date moved — MR-49 Lincoln Chiquito: 2026-08-16 -> 2026-08-22",
       reusing the existing helpers (no new secrets or services).
- All other PATCH behavior (status, payment, notes, etc.) is unchanged.
- The generic `order:updated` event is still logged for every PATCH; the pickup change adds
  the specific event on top (both are fine — the specific one is what the history displays).

### No migration

No schema changes. `order_events.event` is free-form TEXT; `idx_orders_pickup` already
exists for per-date queries.

## Error handling

| Case | Result |
|---|---|
| Invalid/empty date string | `400 { error }`, UI shows message, value reverts |
| Past date | `400 { error }`, UI shows message, value reverts |
| Date unchanged | No-op success (no event/notification) |
| Order not found | Existing `404` behavior |
| Notification fails (Telegram/Resend down) | `ctx.waitUntil` — order update still succeeds; notification failure does not fail the request |

## Testing

- New pure module `orders/workers/order-date.js` (validation + event text) with Vitest unit
  tests in `orders/tests/order-date.test.js` (the worker itself has no fetch-level test
  harness; validation logic is extracted pure and tested, the wiring is smoke-tested):
  - accepts today and future dates; rejects past dates, malformed formats, empty values
  - event text formats as `order:pickup_changed: <old> -> <new>`
- Local smoke test via `npx wrangler dev -c orders/wrangler.toml` + curl:
  - PATCH with a new date → 200, row updated, `order:pickup_changed` event present in
    `GET /api/orders/:id`
  - PATCH with past date → 400 with error, row unchanged
  - PATCH with the same date → 200, no extra event
- Admin: `npm run build` (typecheck + bundle) passes; manual check that changing the date
  updates the Orders table and Calendar view after refresh.

## Docs

Design doc committed here; implementation plan follows via writing-plans.
