# Order Reschedule (Pickup Date Change) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner move an order's pickup date to a later date from the admin Orders modal, with old→new history recorded and an owner Telegram/email notification.

**Architecture:** Extend the existing `PATCH /api/orders/:id` path. A new pure module `orders/workers/order-date.js` holds validation + event text (unit-testable without DB). `updateOrder` validates the new date, logs `order:pickup_changed: <old> -> <new>`, and fires a Telegram/Resend notification via `ctx.waitUntil`. The admin modal gets an editable date input and a History section fed by the existing `GET /api/orders/:id` (new `fetchOrder` client helper).

**Tech Stack:** Cloudflare Worker (JS, D1), React 19 + Vite + Tailwind 4 + TypeScript admin SPA, Vitest.

## Global Constraints

- No schema changes, no migrations.
- Past-date rejection error message (verbatim): `Pickup date cannot be in the past`
- Invalid-format error message (verbatim): `Invalid pickup_date format (expected YYYY-MM-DD)`
- Date comparison uses UTC today: `new Date().toISOString().slice(0, 10)`
- Event text format (verbatim): `order:pickup_changed: <old> -> <new>` (plain `-` and `>` ASCII chars)
- Notifications fire ONLY when the date actually changes; use `ctx.waitUntil` (never block the response on them).
- The existing generic `order:updated` event stays logged for every PATCH.
- Cancelled orders: date field locked (read-only) in the admin UI.
- Admin UI min attribute = UTC today; backend validation is the real guard.
- No customer-facing notification. No customer self-service.
- Follow existing code style: snake_case DB columns, `json()` helper, existing Tailwind utility classes (`input`, `text-xs`, `text-palm`, `text-hibiscus`, `text-cocoa-muted`, `border-sand-100`, etc.).

---

### Task 1: Backend date helper module (pure) + unit tests

**Files:**
- Create: `orders/workers/order-date.js`
- Create: `orders/tests/order-date.test.js`

**Interfaces:**
- Produces:
  - `validatePickupDate(value, now = new Date())` → `{ ok: true }` or `{ ok: false, error: string }`
  - `pickupChangeEvent(oldDate, newDate)` → `string` like `order:pickup_changed: 2026-08-16 -> 2026-08-22`
- Consumes: nothing.

- [ ] **Step 1: Write the failing tests**

Create `orders/tests/order-date.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { validatePickupDate, pickupChangeEvent } from '../workers/order-date.js';

describe('validatePickupDate', () => {
  const now = new Date('2026-08-15T12:00:00Z');

  it('accepts today', () => {
    expect(validatePickupDate('2026-08-15', now)).toEqual({ ok: true });
  });

  it('accepts a future date', () => {
    expect(validatePickupDate('2026-08-22', now)).toEqual({ ok: true });
  });

  it('rejects a past date', () => {
    expect(validatePickupDate('2026-08-14', now)).toEqual({
      ok: false,
      error: 'Pickup date cannot be in the past',
    });
  });

  it('rejects malformed values', () => {
    expect(validatePickupDate('08/22/2026', now).ok).toBe(false);
    expect(validatePickupDate('', now).ok).toBe(false);
    expect(validatePickupDate(undefined, now).ok).toBe(false);
    expect(validatePickupDate('2026-8-22', now).ok).toBe(false);
    expect(validatePickupDate('not-a-date', now).ok).toBe(false);
  });
});

describe('pickupChangeEvent', () => {
  it('formats old -> new', () => {
    expect(pickupChangeEvent('2026-08-16', '2026-08-22')).toBe(
      'order:pickup_changed: 2026-08-16 -> 2026-08-22'
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run orders/tests/order-date.test.js` (from repo root; or `npm test` inside `orders/`)
Expected: FAIL — cannot resolve `../workers/order-date.js`

- [ ] **Step 3: Write the module**

Create `orders/workers/order-date.js`:

```js
export function validatePickupDate(value, now = new Date()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { ok: false, error: 'Invalid pickup_date format (expected YYYY-MM-DD)' };
  }
  const today = now.toISOString().slice(0, 10);
  if (value < today) {
    return { ok: false, error: 'Pickup date cannot be in the past' };
  }
  return { ok: true };
}

export function pickupChangeEvent(oldDate, newDate) {
  return `order:pickup_changed: ${oldDate} -> ${newDate}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run orders/tests/order-date.test.js`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add orders/workers/order-date.js orders/tests/order-date.test.js
git commit -m "feat(reschedule): pickup date validation module + tests"
```

---

### Task 2: Wire validation, event, and notification into updateOrder

**Files:**
- Modify: `orders/workers/api.js` — import at ~line 64, router at line 138, `updateOrder` (lines 571–610), new `notifyOrderRescheduled` + `notifyRescheduleEmail` helpers after `notifyEmail` (line 524)

**Interfaces:**
- Consumes: `validatePickupDate`, `pickupChangeEvent` from `orders/workers/order-date.js` (Task 1); existing `notifyTelegram`/`notifyEmail` pattern.
- Produces: `updateOrder(id, request, env, ctx, actor)` (signature gains `ctx`); `notifyOrderRescheduled(env, order, oldDate, newDate)`.

- [ ] **Step 1: Add the import**

In `orders/workers/api.js`, after the existing imports (line 64: `import { createLruCache, ... } from './enrich-lib.js';`) add:

```js
import { validatePickupDate, pickupChangeEvent } from './order-date.js';
```

- [ ] **Step 2: Pass ctx to updateOrder in the router**

Change line 138 from:

```js
        if (method === 'PATCH')  return await updateOrder(id, request, env, actorName);
```

to:

```js
        if (method === 'PATCH')  return await updateOrder(id, request, env, ctx, actorName);
```

- [ ] **Step 3: Rewrite updateOrder with date validation + audit event**

Replace the whole `updateOrder` function (currently lines 571–610) with:

```js
async function updateOrder(id, request, env, ctx, actor) {
  const body = await request.json();
  const allowed = ['status', 'payment_status', 'notes', 'pickup_date', 'pickup_time', 'payment_method', 'payment_sub_method', 'food_coloring', 'customer_id'];
  const sets = [], binds = [];
  for (const f of allowed) {
    if (body[f] === undefined) continue;
    if (f === 'payment_method' && !ALLOWED_PAYMENT.includes(body[f])) return json({ error: 'Invalid payment_method' }, 400);
    if (f === 'payment_status' && !ALLOWED_PAYSTAT.includes(body[f])) return json({ error: 'Invalid payment_status' }, 400);
    if (f === 'status' && !ALLOWED_STATUS.includes(body[f])) return json({ error: 'Invalid status' }, 400);
    sets.push(`${f} = ?`); binds.push(body[f]);
  }
  if (!sets.length) return json({ error: 'Nothing to update' }, 400);

  // Pickup date move: validate first, and capture the old date for the audit event.
  let pickupMoved = null;
  let orderForNotify = null;
  if (body.pickup_date !== undefined) {
    const check = validatePickupDate(body.pickup_date);
    if (!check.ok) return json({ error: check.error }, 400);
    const existing = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
    if (!existing) return json({ error: 'Not found' }, 404);
    if (existing.pickup_date !== body.pickup_date) {
      pickupMoved = { old: existing.pickup_date, new: body.pickup_date };
      orderForNotify = existing;
    }
  }

  binds.push(id);
  const r = await env.DB.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  if (!r.meta.changes) return json({ error: 'Not found' }, 404);

  // When marking unpaid, deactivate all payments so they don't inflate totals
  if (body.payment_status === 'unpaid') {
    await env.DB.prepare(`UPDATE payments SET active = 0 WHERE order_id = ? AND active = 1`).bind(id).run();
  }

  // Keep the latest recorded payment in sync when the method is corrected
  if (body.payment_method !== undefined) {
    const latest = await env.DB.prepare(
      `SELECT id FROM payments WHERE order_id = ? AND active = 1 ORDER BY created_at DESC, id DESC LIMIT 1`
    ).bind(id).first();
    if (latest) {
      await env.DB.prepare(
        `UPDATE payments SET method = ?, method_details = COALESCE(?, method_details) WHERE id = ?`
      ).bind(body.payment_method, body.payment_sub_method ?? null, latest.id).run();
    }
  }

  await env.DB.prepare(`
    INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, 'order:updated')
  `).bind(id, actor).run();

  if (pickupMoved) {
    await env.DB.prepare(
      'INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, ?)'
    ).bind(id, actor, pickupChangeEvent(pickupMoved.old, pickupMoved.new)).run();
    ctx.waitUntil(notifyOrderRescheduled(env, orderForNotify, pickupMoved.old, pickupMoved.new));
  }

  return json({ ok: true }, 200);
}
```

- [ ] **Step 4: Add the notification helpers after notifyEmail**

Insert immediately after the `notifyEmail` function (ends at line 524):

```js
async function notifyOrderRescheduled(env, order, oldDate, newDate) {
  const customer = (order.customer_name || '').trim();
  const msg = [
    `📅 Pickup date moved — MR-${order.id}`,
    `👤 ${customer}`,
    `📅 ${oldDate} → ${newDate}`,
  ].join('\n');

  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    notifyTelegram(env, msg);
  }
  if (env.EMAIL_RECIPIENT && env.RESEND_API_KEY) {
    await notifyRescheduleEmail(env, order, oldDate, newDate, msg);
  }
}

async function notifyRescheduleEmail(env, order, oldDate, newDate, msg) {
  try {
    const emails = String(env.EMAIL_RECIPIENT).split(',').map(e => e.trim()).filter(Boolean);
    const html = `<div style="font-family: sans-serif; max-width: 480px; padding: 16px;">
  <h2 style="color: #333;">📅 Order #${order.id} — Pickup Date Moved</h2>
  <table style="width: 100%; border-collapse: collapse;">
    <tr><td style="padding: 6px 0; color: #555; width: 110px;"><strong>Customer</strong></td><td style="padding: 6px 0;">${order.customer_name || ''}</td></tr>
    <tr><td style="padding: 6px 0; color: #555;"><strong>Previous pickup</strong></td><td style="padding: 6px 0;">${oldDate}</td></tr>
    <tr><td style="padding: 6px 0; color: #555;"><strong>New pickup</strong></td><td style="padding: 6px 0;">${newDate}</td></tr>
  </table>
  <p style="color: #999; font-size: 12px; margin-top: 16px;">Order #${order.id} · Muy Rico Bakery</p>
</div>`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM || "orders@muy-rico.com",
        to: emails,
        subject: `📅 Order #${order.id} — Pickup Date Moved`,
        text: msg,
        html,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("Resend email failed:", res.status, err);
    }
  } catch (e) { console.error('Email notify failed:', e); }
}
```

- [ ] **Step 5: Verify syntax + unit tests still pass**

Run: `node --check orders/workers/api.js` then `npx vitest run orders/tests/order-date.test.js`
Expected: no syntax errors; 6 tests PASS

- [ ] **Step 6: Commit**

```bash
git add orders/workers/api.js
git commit -m "feat(reschedule): validate pickup_date changes, log audit event, notify owner"
```

---

### Task 3: Local smoke test with wrangler dev

**Files:** none (verification only)

**Interfaces:** consumes `PATCH /api/orders/:id` behavior from Task 2.

- [ ] **Step 1: Start the local worker**

Run: `npx wrangler dev -c orders/wrangler.toml --port 8788` (leave running in its own terminal)
Expected: `Ready on http://localhost:8788`

- [ ] **Step 2: Create a test order**

Run:
```bash
curl -s -X POST http://localhost:8788/api/orders \
  -H "Content-Type: application/json" \
  -d '{"customer_name":"Reschedule Test","pickup_date":"2026-08-20","items_json":"[{\"name\":\"Custom Cake\",\"qty\":1,\"price\":60,\"productId\":\"prod_custom_cake\"}]","total_cents":6000,"payment_method":"cash","payment_status":"unpaid","status":"pending","source":"in-person"}'
```
Expected: `{ ok: true, id: <ID> }` — save `<ID>` for the next steps.

- [ ] **Step 3: Move the date forward**

Run: `curl -s -X PATCH http://localhost:8788/api/orders/<ID> -H "Content-Type: application/json" -d '{"pickup_date":"2026-08-22"}'`
Expected: `{ ok: true }`

- [ ] **Step 4: Verify the event was recorded**

Run: `curl -s http://localhost:8788/api/orders/<ID>`
Expected: response includes `events` containing an `order:updated` entry AND an `order:pickup_changed: 2026-08-20 -> 2026-08-22` entry with `actor: "local"`.

- [ ] **Step 5: Verify past dates are rejected**

Run: `curl -s -X PATCH http://localhost:8788/api/orders/<ID> -H "Content-Type: application/json" -d '{"pickup_date":"2020-01-01"}'`
Expected: `400` with `{"error":"Pickup date cannot be in the past"}`

- [ ] **Step 6: Verify same-date patch is a no-op for events**

Run: `curl -s -X PATCH http://localhost:8788/api/orders/<ID> -H "Content-Type: application/json" -d '{"pickup_date":"2026-08-22"}'` then `curl -s http://localhost:8788/api/orders/<ID>`
Expected: `{ ok: true }`; event count unchanged from Step 4 (no second `order:pickup_changed` entry).

- [ ] **Step 7: Verify malformed dates are rejected**

Run: `curl -s -X PATCH http://localhost:8788/api/orders/<ID> -H "Content-Type: application/json" -d '{"pickup_date":"August 22"}'`
Expected: `400` with `{"error":"Invalid pickup_date format (expected YYYY-MM-DD)"}`

- [ ] **Step 8: Stop the dev server**

Run: `kill %1` in the wrangler terminal (or Ctrl+C)

- [ ] **Step 9: Commit (if nothing changed, skip)**

```bash
git status --short
```

---

### Task 4: Admin API client + store types

**Files:**
- Modify: `home-bakery-management-system/src/utils/api.ts` (updateOrder patch type lines 108–122; new `fetchOrder` + `ApiOrderEvent` nearby)
- Modify: `home-bakery-management-system/src/context/StoreContext.tsx` (line 504 handleApiUpdateOrder patch type)

**Interfaces:**
- Produces:
  - `updateOrder(id: number, patch: { status?, payment_status?, payment_method?, payment_sub_method?, pickup_date?, notes? })`
  - `fetchOrder(id: number): Promise<{ order: ApiOrder; events: ApiOrderEvent[] }>` where `ApiOrderEvent = { id: number; order_id: number; created_at: string; actor: string | null; event: string }`
  - StoreContext `apiUpdateOrder` accepts `pickup_date?: string` in its patch.
- Consumes: existing `apiFetch`.

- [ ] **Step 1: Widen updateOrder + add fetchOrder in api.ts**

In `home-bakery-management-system/src/utils/api.ts`, replace the `updateOrder` function (lines 108–122) with:

```ts
export async function updateOrder(
  id: number,
  patch: {
    status?: string;
    payment_status?: string;
    payment_method?: string;
    payment_sub_method?: string | null;
    pickup_date?: string;
    notes?: string;
  }
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/orders/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export interface ApiOrderEvent {
  id: number;
  order_id: number;
  created_at: string;
  actor: string | null;
  event: string;
}

export async function fetchOrder(id: number): Promise<{ order: ApiOrder; events: ApiOrderEvent[] }> {
  return apiFetch(`/api/orders/${id}`);
}
```

- [ ] **Step 2: Widen StoreContext apiUpdateOrder**

In `home-bakery-management-system/src/context/StoreContext.tsx`, replace line 504:

```ts
  const handleApiUpdateOrder = useCallback(async (id: number, patch: { status?: string; payment_status?: string; payment_method?: string; payment_sub_method?: string | null }) => {
```

with:

```ts
  const handleApiUpdateOrder = useCallback(async (id: number, patch: { status?: string; payment_status?: string; payment_method?: string; payment_sub_method?: string | null; pickup_date?: string }) => {
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit` (inside `home-bakery-management-system/`)
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add home-bakery-management-system/src/utils/api.ts home-bakery-management-system/src/context/StoreContext.tsx
git commit -m "feat(admin): add pickup_date patch type + fetchOrder client helper"
```

---

### Task 5: Admin Orders modal — editable due date + history section

**Files:**
- Modify: `home-bakery-management-system/src/pages/Orders.tsx` — imports (lines 1–10), state (after line 33), row click (line 179), new `saveDueDate` handler (after `updateStatus`, ~line 57), modal footer (lines 580–583)

**Interfaces:**
- Consumes: `fetchOrder`, `ApiOrderEvent` from `utils/api` (Task 4); `apiUpdateOrder` from StoreContext (Task 4); existing `formatDateTime` from `utils/format`.
- Produces: UI only.

- [ ] **Step 1: Update imports**

In `Orders.tsx` line 8, change:

```ts
import { generateOrderLabels, receiptHtmlUrl } from "../utils/api";
```

to:

```ts
import { generateOrderLabels, receiptHtmlUrl, fetchOrder } from "../utils/api";
import type { ApiOrderEvent } from "../utils/api";
```

- [ ] **Step 2: Add state**

After line 33 (`const [relinkSearch, setRelinkSearch] = useState("");`), add:

```ts
  const [orderEvents, setOrderEvents] = useState<ApiOrderEvent[]>([]);
  const [dueEdit, setDueEdit] = useState<string | null>(null);
  const [dueError, setDueError] = useState<string | null>(null);
```

- [ ] **Step 3: Load events on row click**

Change the row `onClick` at line 179 from:

```tsx
                <tr key={o.id} className="cursor-pointer hover:bg-sand-50" style={{ borderLeft: `3px solid ${borderColor}` }} onClick={() => { setSelected(o); setLabelGenResult(null); }}>
```

to:

```tsx
                <tr key={o.id} className="cursor-pointer hover:bg-sand-50" style={{ borderLeft: `3px solid ${borderColor}` }} onClick={() => { setSelected(o); setLabelGenResult(null); setDueEdit(null); setDueError(null); setOrderEvents([]); fetchOrder(Number(o.id)).then((r) => setOrderEvents(r.events)).catch(() => {}); }}>
```

- [ ] **Step 4: Add the saveDueDate handler**

After the `updateStatus` function (ends line 57), add:

```ts
  async function saveDueDate() {
    if (!selected || !dueEdit) return;
    try {
      await apiUpdateOrder(Number(selected.id), { pickup_date: dueEdit });
      setDueError(null);
      await refreshOrders();
      setSelected((prev) => (prev && prev.id === selected.id ? { ...prev, dueDate: dueEdit } : prev));
      setDueEdit(null);
      fetchOrder(Number(selected.id)).then((r) => setOrderEvents(r.events)).catch(() => {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setDueError(
        msg.includes("past")
          ? "Pickup date cannot be in the past."
          : "Could not save the date. Please try again."
      );
    }
  }
```

- [ ] **Step 5: Replace the modal footer with history + editable due date**

Replace lines 580–583:

```tsx
            <div className="flex items-center justify-between text-xs text-cocoa-muted">
              <span>Ordered {formatDate(selected.createdAt)}</span>
              <span>Due {formatDate(selected.dueDate)}</span>
            </div>
```

with:

```tsx
            {orderEvents.length > 0 && (
              <div className="space-y-1 rounded-xl border border-sand-100 p-3">
                <p className="text-xs font-semibold uppercase text-cocoa-muted/60">History</p>
                <ul className="space-y-1">
                  {orderEvents.slice(-8).reverse().map((e) => (
                    <li key={e.id} className="flex items-start justify-between gap-2 text-xs text-cocoa-muted">
                      <span className="break-all">{e.event}</span>
                      <span className="shrink-0">{formatDateTime(e.created_at)}{e.actor ? ` · ${e.actor}` : ""}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-cocoa-muted">
                <span>Ordered {formatDate(selected.createdAt)}</span>
                <span className="flex items-center gap-1.5">
                  Due{" "}
                  {selected.status === "cancelled" ? (
                    formatDate(selected.dueDate)
                  ) : (
                    <input
                      type="date"
                      min={new Date().toISOString().slice(0, 10)}
                      value={dueEdit ?? selected.dueDate.slice(0, 10)}
                      onChange={(e) => { setDueEdit(e.target.value); setDueError(null); }}
                      className="input text-xs"
                    />
                  )}
                  {dueEdit !== null && dueEdit !== selected.dueDate.slice(0, 10) && (
                    <button onClick={saveDueDate} className="text-xs font-semibold text-palm hover:underline">
                      Save
                    </button>
                  )}
                </span>
              </div>
              {dueError && <p className="text-xs text-hibiscus">{dueError}</p>}
            </div>
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit` (inside `home-bakery-management-system/`)
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add home-bakery-management-system/src/pages/Orders.tsx
git commit -m "feat(admin): editable due date + history in order detail modal"
```

---

### Task 6: Full test + build verification

**Files:** none (verification only)

- [ ] **Step 1: Run backend tests**

Run: `npx vitest run` (inside `orders/`)
Expected: all tests PASS (includes order-date.test.js)

- [ ] **Step 2: Run admin tests**

Run: `npm test` (inside `home-bakery-management-system/`)
Expected: all tests PASS

- [ ] **Step 3: Build the admin bundle**

Run: `npm run build` (inside `home-bakery-management-system/`)
Expected: build succeeds; postbuild copies the bundle to `admin/index.html` (check `git status` shows `admin/index.html` modified)

- [ ] **Step 4: Commit the built bundle if it changed**

```bash
git add admin/index.html
git commit -m "build(admin): ship reschedule feature bundle"
```
(Skip if `admin/index.html` is unchanged.)

---

### Task 7: Deploy + remote verification

**Files:** none (deploy only)

- [ ] **Step 1: Deploy the backend API**

Run: `npx wrangler deploy -c orders/wrangler.toml`
Expected: "Uploaded muy-rico-orders-api" + deployed triggers URL `https://muy-rico-orders-api.bexgarcia0208.workers.dev`

- [ ] **Step 2: Deploy frontend assets (admin bundle)**

Run:
```bash
npx wrangler versions upload --name muyrico --assets . --compatibility-date 2025-03-21
npx wrangler versions deploy --name muyrico <VERSION_ID>@100%
```
Expected: upload prints a Version ID; deploy reports 100% traffic on it.

- [ ] **Step 3: Remote smoke — public API is healthy**

Run: `curl -s -o /dev/null -w "%{http_code}" https://muy-rico-orders-api.bexgarcia0208.workers.dev/api/products`
Expected: `200`

- [ ] **Step 4: Remote smoke — admin loads**

Open `https://muy-rico.pages.dev/admin` in a browser (Cloudflare Access session). Open the Orders page, click order MR-49 (Lincoln Chiquito), confirm:
- Due date shows `2026-08-22` in an editable input
- History section lists the `order:pickup_changed` event recorded earlier
- Changing the date to a past date is blocked by the input's `min`; picking a new date and clicking Save updates the table/calendar and shows a new History entry
- A Telegram/email notification arrives for the date change

- [ ] **Step 5: Commit any final state and summarize**

```bash
git status --short
git log --oneline -6
```

---

## Self-Review Notes

- Spec coverage: editable due date (Task 5), old→new history (Tasks 2, 5), owner Telegram/email notify (Task 2), no past dates (Tasks 1–3), cancelled lock (Task 5), no migration (global constraints), fetchOrder/history display (Tasks 4–5), deploy (Task 7).
- Type consistency: `validatePickupDate`/`pickupChangeEvent` named identically in Task 1 exports and Task 2 usage; `fetchOrder`/`ApiOrderEvent` identical in Tasks 4–5; `updateOrder` new 5th param `ctx` wired in both router (Step 2) and signature (Step 3).
- Note for implementers: `orders/workers/customer-match.js` exists in the working tree (owner WIP) — deploys and tests bundle it; do not delete it.
