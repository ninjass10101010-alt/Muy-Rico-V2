# Payment Ledger Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the `payments` ledger from destroying partial-payment history, deriving `orders.payment_status` from what was actually collected, and mapping the quote deposit fields that are currently write-only.

**Architecture:** One new pure module (`payment-ledger-lib.js`) holds the money arithmetic so it is testable without a database. The `createPayment` handler batches its deactivate and insert into a single `DB.batch` so a failed insert cannot leave an order with zero payments, then derives the order's payment status from the post-insert sum rather than trusting the client. Everything else is additive mapping, a routing gap, and a status allow-list.

**Tech Stack:** Cloudflare Workers (vanilla ESM JavaScript, no TypeScript), Cloudflare D1 (SQLite), Vitest 4.1.10 for worker tests, React 19 + TypeScript 5.9 + Vite 7 + Vitest for the SPA.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-09-28-payment-ledger-correctness-design.md`. This plan implements Fixes 1–8 of that spec.
- **No migrations.** No file is added to `orders/migrations/`, and no `ALTER TABLE` is introduced. The `CHECK` constraint discussed in the spec is explicitly deferred.
- **`payments.amount` stays `REAL` dollars** (`0006_server_storage.sql:25`). Do not "fix" it to cents — that is a data migration and out of scope. `orders.total_cents` stays integer cents. The only conversion is `Math.round(amount * 100)`.
- **`replace` defaults to `true`.** Every pre-existing caller of `createPayment` keeps its exact current semantics. Callers recording a top-up must explicitly pass `replace: false`.
- **`GET /api/payments` keeps returning `active = 1` only.** Eleven frontend consumers assume the array is already active-only and none filter on `active`. Do not widen the default response. Voided rows are exposed through a separate `?include_voided=1` parameter used by exactly one new view.
- **Do not modify** `workers/checkout.js`, `pay-quote.html`, `pay-invoice.html`, `markOrderPaid` (`api.js:1060`), `convertInvoiceToOrder` (`api.js:3899`), or any file under `orders/migrations/`.
- **Do not refactor** `api.js` beyond the specific functions named in each task. It is a 4,970-line file with deliberate existing patterns; follow them.
- **Preserve the existing D1 stub pattern** in `orders/tests/mark-paid.test.js:5-33` for new worker tests.
- **Every task ends with a commit.** Do not batch commits across tasks.
- **Test command for worker tests:** `cd orders && npx vitest run`
- **Test command for SPA tests:** `cd home-bakery-management-system && npx vitest run`
- **Typecheck command:** `cd home-bakery-management-system && npx tsc --noEmit`

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `orders/workers/payment-ledger-lib.js` | Pure money arithmetic: dollars→cents, deriving `payment_status`. No I/O, no D1, no imports. | **Create** |
| `orders/workers/api.js` | Route table + all handlers. Modified by Tasks 2, 3, 4, 6, 7. | Modify |
| `orders/tests/payment-ledger-lib.test.js` | The pure module, exhaustively. | **Create** |
| `orders/tests/create-payment.test.js` | The `createPayment` handler against a mock D1. | **Create** |
| `orders/tests/row-to-quote.test.js` | `rowToQuote` field mapping. | **Create** |
| `orders/tests/quote-status.test.js` | `updateQuote` status validation + edit guard. | **Create** |
| `home-bakery-management-system/src/utils/api.ts` | `PaymentCreate` gains `methodDetails` and `replace`. `deletePayment` becomes live. `fetchPayments` gains the voided filter. | Modify |
| `home-bakery-management-system/src/context/StoreContext.tsx` | `recordPayment` resignature; `handleApiCreateOrder` refreshes payments; `apiToQuote` maps deposit fields. | Modify |
| `home-bakery-management-system/src/types.ts` | `Quote` gains the four deposit/token fields. | Modify |
| `home-bakery-management-system/src/pages/Orders.tsx` | Three `recordPayment` call sites re-pointed; dead `apiUpdateOrder({payment_status})` removed. | Modify |
| `home-bakery-management-system/src/components/OrderModal.tsx` | No change (Task 5 fixes it inside the store instead). | — |
| `home-bakery-management-system/src/pages/Payments.tsx` | Voided-payments disclosure section. | Modify |

---

## Task 1: Pure money arithmetic module

The module every other task depends on. Nothing here touches D1, so it is fully unit-testable in isolation.

**Files:**
- Create: `orders/workers/payment-ledger-lib.js`
- Test: `orders/tests/payment-ledger-lib.test.js`

**Interfaces:**
- Consumes: nothing. This is the root of the dependency graph.
- Produces:
  - `derivePaymentStatus(activePaymentsCents: number, totalCents: number) -> 'unpaid' | 'partial' | 'paid'`
  - `activePaymentsCents(rows: Array<{ amount: number }>) -> number`
  - `balanceCentsCents(activePaymentsCents: number, totalCents: number) -> number` (never negative)

  Task 2 imports all three. No other task imports this module.

- [ ] **Step 1: Write the failing test**

Create `orders/tests/payment-ledger-lib.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  derivePaymentStatus,
  activePaymentsCents,
  balanceCentsCents,
} from '../workers/payment-ledger-lib.js';

describe('activePaymentsCents', () => {
  it('converts dollar amounts to integer cents without float drift', () => {
    expect(activePaymentsCents([{ amount: 12.34 }])).toBe(1234);
    expect(activePaymentsCents([{ amount: 19.99 }])).toBe(1999);
    expect(activePaymentsCents([{ amount: 0.1 }, { amount: 0.2 }])).toBe(30);
    expect(activePaymentsCents([{ amount: 1.005 }])).toBe(101); // rounds, does not truncate to 100
  });

  it('sums multiple rows', () => {
    expect(activePaymentsCents([{ amount: 50 }, { amount: 12.5 }])).toBe(6250);
  });

  it('treats an empty list as zero', () => {
    expect(activePaymentsCents([])).toBe(0);
  });

  it('coerces non-numeric amounts to zero rather than NaN', () => {
    expect(activePaymentsCents([{ amount: 'abc' }, { amount: 5 }])).toBe(500);
    expect(activePaymentsCents([{ amount: null }])).toBe(0);
  });
});

describe('derivePaymentStatus', () => {
  it('is unpaid when nothing has been collected', () => {
    expect(derivePaymentStatus(0, 6000)).toBe('unpaid');
  });

  it('is partial when some but not all has been collected', () => {
    expect(derivePaymentStatus(3000, 6000)).toBe('partial');
    expect(derivePaymentStatus(1, 6000)).toBe('partial');
    expect(derivePaymentStatus(5999, 6000)).toBe('partial');
  });

  it('is paid at exactly the total', () => {
    expect(derivePaymentStatus(6000, 6000)).toBe('paid');
  });

  it('is paid when over-collected', () => {
    expect(derivePaymentStatus(6500, 6000)).toBe('paid');
  });

  it('is paid for a zero-total order that received a payment', () => {
    expect(derivePaymentStatus(100, 0)).toBe('paid');
  });

  it('is unpaid for a negative or zero sum', () => {
    expect(derivePaymentStatus(-100, 6000)).toBe('unpaid');
  });

  it('does not report partial for a sum that is a cent short of the total', () => {
    // The dollars/cents class of bug: 0.1 + 0.2 must not land on 29.99 cents.
    const rows = [{ amount: 12.34 }, { amount: 0.1 }, { amount: 0.2 }];
    expect(activePaymentsCents(rows)).toBe(1264);
    expect(derivePaymentStatus(activePaymentsCents(rows), 1264)).toBe('paid');
  });
});

describe('balanceCentsCents', () => {
  it('returns the unpaid remainder', () => {
    expect(balanceCentsCents(3000, 6000)).toBe(3000);
  });

  it('returns zero when settled', () => {
    expect(balanceCentsCents(6000, 6000)).toBe(0);
  });

  it('never returns a negative balance on overpayment', () => {
    expect(balanceCentsCents(6500, 6000)).toBe(0);
  });

  it('returns zero when nothing was collected and the total is zero', () => {
    expect(balanceCentsCents(0, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd orders && npx vitest run tests/payment-ledger-lib.test.js`

Expected: FAIL — `Cannot find module '../workers/payment-ledger-lib.js'`

- [ ] **Step 3: Write the implementation**

Create `orders/workers/payment-ledger-lib.js`:

```js
// Pure money arithmetic for the payments ledger.
// See docs/superpowers/specs/2026-09-28-payment-ledger-correctness-design.md
//
// Why this module exists: payments.amount is REAL dollars
// (migrations/0006_server_storage.sql:25) while every other monetary column
// is INTEGER cents. Every comparison between the ledger and an order total
// therefore has to convert, and getting that wrong silently reports a settled
// order as partial. Keeping it here makes it testable without a database.

/**
 * Sum a list of payment rows into integer cents.
 * Rounds per-row so float drift in REAL dollars cannot accumulate.
 */
export function activePaymentsCents(rows) {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((sum, p) => {
    const cents = Math.round(Number(p && p.amount) * 100);
    return sum + (Number.isFinite(cents) ? cents : 0);
  }, 0);
}

/**
 * Derive orders.payment_status from what was actually collected.
 * Never trust a client-supplied status — the ledger is the source of truth.
 */
export function derivePaymentStatus(activeCents, totalCents) {
  const paid = Number(activeCents);
  const total = Number(totalCents);
  if (!Number.isFinite(paid) || paid <= 0) return 'unpaid';
  if (!Number.isFinite(total) || paid >= total) return 'paid';
  return 'partial';
}

/** Unpaid remainder, floored at zero so an overpayment reports 0, never negative. */
export function balanceCentsCents(activeCents, totalCents) {
  const remaining = (Number(totalCents) || 0) - (Number(activeCents) || 0);
  return remaining > 0 ? remaining : 0;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd orders && npx vitest run tests/payment-ledger-lib.test.js`

Expected: PASS — 16 tests

- [ ] **Step 5: Run the full worker suite to confirm nothing regressed**

Run: `cd orders && npx vitest run`

Expected: PASS — all 13 pre-existing test files still green

- [ ] **Step 6: Commit**

```bash
git add orders/workers/payment-ledger-lib.js orders/tests/payment-ledger-lib.test.js
git commit -m "feat(payments): add pure payment-ledger arithmetic module

derivePaymentStatus() and activePaymentsCents() as a dependency-free
module so the money math is testable without D1. Rounds per-row because
payments.amount is REAL dollars while orders.total_cents is integer
cents."
```

---

## Task 2: `createPayment` — batched, mode-aware, audited

The core fix. Three defects are addressed together: the blanket deactivate, the deactivate that commits before the insert, and the absence of any audit record.

**Files:**
- Modify: `orders/workers/api.js:46-50` (import), `orders/workers/api.js:2701-2740` (handler)
- Test: `orders/tests/create-payment.test.js`

**Interfaces:**
- Consumes: `derivePaymentStatus`, `activePaymentsCents`, `balanceCentsCents` from `payment-ledger-lib.js` (Task 1).
- Produces: `POST /api/payments` accepts an optional boolean `replace` (default `true`) and an optional `method_details` string. Success responses gain `paymentStatus` and `balanceCents`. Task 5 depends on both response fields; Task 6 depends on the handler no longer being a single-deactivate-plus-insert.

- [ ] **Step 1: Write the failing test**

Create `orders/tests/create-payment.test.js`:

```js
import { describe, it, expect } from 'vitest';
import worker from '../workers/api.js';

// D1 stub with the batch() support the mark-paid stub lacks.
// Follows the makeEnv pattern from tests/mark-paid.test.js:5-33.
function makeEnv({ totalCents = 6000, activePayments = [], orderExists = true } = {}) {
  const calls = [];
  const record = (sql, binds, method) => calls.push({ sql, binds, method });

  const db = {
    prepare(sql) {
      const stmt = {
        _sql: sql,
        _binds: [],
        bind(...args) { stmt._binds = args; return stmt; },
        async first() {
          record(sql, stmt._binds, 'first');
          if (/FROM orders WHERE id/.test(sql)) {
            return orderExists ? { id: 1, total_cents: totalCents } : null;
          }
          return null;
        },
        async run() {
          record(sql, stmt._binds, 'run');
          return { meta: { changes: 1, last_row_id: 1 } };
        },
        async all() {
          record(sql, stmt._binds, 'all');
          if (/FROM payments WHERE order_id/.test(sql)) return { results: activePayments };
          return { results: [] };
        },
      };
      return stmt;
    },
    async batch(stmts) {
      // A batch is one atomic unit. Record it as a single entry so a test can
      // assert the deactivate and the insert committed together.
      record('BATCH', stmts.map((s) => ({ sql: s._sql, binds: s._binds })), 'batch');
      return stmts.map(() => ({ meta: { changes: 1, last_row_id: 1 } }));
    },
  };

  const env = { DB: db };
  const ctx = { waitUntil: (p) => { if (p && typeof p.catch === 'function') p.catch(() => {}); } };
  return { env, ctx, calls };
}

function createPaymentRequest(body) {
  return new Request('https://orders-api.test/api/payments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Legacy identity fallback — active when ACCESS_TEAM_DOMAIN/ACCESS_AUD
      // are unset, which is the case in this stub env.
      'cf-access-authenticated-user-email': 'jeff@example.test',
    },
    body: JSON.stringify(body),
  });
}

const BASE = { id: 'pay_test1', order_id: 1, order_number: 'MR-1', customer_name: 'Ana', method: 'cash', amount: 30 };

const sqlOf = (calls) => calls.map((c) => c.sql).join(' || ');
const batchOf = (calls) => calls.find((c) => c.method === 'batch');

describe('createPayment replace mode', () => {
  it('defaults to replace:true and batches the deactivate with the insert', async () => {
    const { env, ctx, calls } = makeEnv();
    const res = await worker.fetch(createPaymentRequest(BASE), env, ctx);
    expect(res.status).toBe(201);

    const batch = batchOf(calls);
    expect(batch, 'deactivate and insert must commit as one batch').toBeTruthy();
    expect(batch.binds).toHaveLength(2);
    expect(batch.binds[0].sql).toMatch(/UPDATE payments SET active = 0/);
    expect(batch.binds[1].sql).toMatch(/INSERT INTO payments/);
  });

  it('preserves replace:true when explicitly passed', async () => {
    const { env, ctx, calls } = makeEnv();
    await worker.fetch(createPaymentRequest({ ...BASE, replace: true }), env, ctx);
    const batch = batchOf(calls);
    expect(batch.binds[0].sql).toMatch(/UPDATE payments SET active = 0/);
  });

  it('omits the deactivate entirely when replace:false', async () => {
    const { env, ctx, calls } = makeEnv();
    const res = await worker.fetch(createPaymentRequest({ ...BASE, replace: false }), env, ctx);
    expect(res.status).toBe(201);

    const batch = batchOf(calls);
    expect(batch.binds).toHaveLength(1);
    expect(batch.binds[0].sql).toMatch(/INSERT INTO payments/);
    expect(sqlOf(calls)).not.toMatch(/UPDATE payments SET active = 0/);
  });
});

describe('createPayment safety', () => {
  it('never issues a standalone deactivate outside the batch', async () => {
    const { env, ctx, calls } = makeEnv();
    await worker.fetch(createPaymentRequest(BASE), env, ctx);
    const standalone = calls.filter((c) => c.method === 'run' && /UPDATE payments SET active = 0/.test(c.sql));
    expect(standalone, 'a committed standalone deactivate loses data when the insert fails').toHaveLength(0);
  });

  it('writes method_details into the INSERT', async () => {
    const { env, ctx, calls } = makeEnv();
    await worker.fetch(createPaymentRequest({ ...BASE, method_details: '{"type":"cash"}' }), env, ctx);
    expect(sqlOf(calls)).toMatch(/INSERT INTO payments \(id, order_id, order_number, customer_name, amount, method, method_details/);
  });

  it('records an order_events row with the actor', async () => {
    const { env, ctx, calls } = makeEnv();
    await worker.fetch(createPaymentRequest(BASE), env, ctx);
    const event = calls.find((c) => /INSERT INTO order_events/.test(c.sql));
    expect(event).toBeTruthy();
    expect(event.sql).toMatch(/order:payment_recorded/);
    expect(event.binds).toContain('jeff');
  });
});

describe('createPayment derived status', () => {
  it('reports partial when the post-insert sum is below the total', async () => {
    const { env, ctx } = makeEnv({ totalCents: 6000, activePayments: [{ amount: 30 }] });
    const res = await worker.fetch(createPaymentRequest(BASE), env, ctx);
    const body = await res.json();
    expect(body.paymentStatus).toBe('partial');
    expect(body.balanceCents).toBe(3000);
  });

  it('reports paid when the post-insert sum reaches the total', async () => {
    const { env, ctx } = makeEnv({ totalCents: 6000, activePayments: [{ amount: 60 }] });
    const body = await (await worker.fetch(createPaymentRequest(BASE), env, ctx)).json();
    expect(body.paymentStatus).toBe('paid');
    expect(body.balanceCents).toBe(0);
  });

  it('reports unpaid when no active payments remain', async () => {
    const { env, ctx } = makeEnv({ totalCents: 6000, activePayments: [] });
    const body = await (await worker.fetch(createPaymentRequest(BASE), env, ctx)).json();
    expect(body.paymentStatus).toBe('unpaid');
    expect(body.balanceCents).toBe(6000);
  });

  it('does not touch payment_status when the order no longer exists', async () => {
    const { env, ctx, calls } = makeEnv({ orderExists: false });
    await worker.fetch(createPaymentRequest(BASE), env, ctx);
    expect(sqlOf(calls)).not.toMatch(/UPDATE orders SET payment_status/);
  });
});

describe('createPayment validation (unchanged behaviour)', () => {
  it('rejects a missing customer_name with 400', async () => {
    const { env, ctx } = makeEnv();
    const res = await worker.fetch(createPaymentRequest({ ...BASE, customer_name: undefined }), env, ctx);
    expect(res.status).toBe(400);
  });

  it('rejects an invalid method with 400', async () => {
    const { env, ctx } = makeEnv();
    const res = await worker.fetch(createPaymentRequest({ ...BASE, method: 'bitcoin' }), env, ctx);
    expect(res.status).toBe(400);
  });

  it('still accepts an orphan payment with no order_id', async () => {
    const { env, ctx } = makeEnv();
    const res = await worker.fetch(createPaymentRequest({ ...BASE, order_id: null }), env, ctx);
    expect(res.status).toBe(201);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd orders && npx vitest run tests/create-payment.test.js`

Expected: FAIL — the `method_details` assertion fails (current INSERT omits it), the batch assertions fail (current code calls a standalone `.run()` on the deactivate), the `order_events` assertion fails (current code writes none), and `paymentStatus` is `undefined`.

- [ ] **Step 3: Add the import**

In `orders/workers/api.js`, after the existing `quote-deposit-lib.js` import block ending at line 87, add:

```js
import {
  derivePaymentStatus, activePaymentsCents, balanceCentsCents,
} from './payment-ledger-lib.js';
```

- [ ] **Step 4: Replace the handler**

Replace the whole of `orders/workers/api.js:2701-2740` (from `async function createPayment(request, env, actor) {` through its closing `}`) with:

```js
async function createPayment(request, env, actor) {
  let body;
  try { body = await request.json(); } catch { body = {}; }

  const customerName = getBodyField(body, 'customer_name');
  if (!body.id || !customerName || !body.method) {
    return json({ error: 'Missing required fields: id, customer_name, method' }, 400);
  }
  if (!ALLOWED_PAYMENT.includes(body.method)) {
    return json({ error: `Invalid method. Must be one of: ${ALLOWED_PAYMENT.join(', ')}` }, 400);
  }

  const orderId = getBodyField(body, 'order_id');
  const amount = Number(body.amount) || 0;
  const methodDetails = getBodyField(body, 'method_details') || null;
  // replace defaults to TRUE so every pre-existing caller keeps its current
  // semantics: a full re-record supersedes earlier rows. Callers recording a
  // top-up (deposit then balance) must pass replace:false or they will erase
  // the deposit they are settling.
  const replace = body.replace === undefined ? true : body.replace !== false;

  const insert = () => env.DB.prepare(`
    INSERT INTO payments (id, order_id, order_number, customer_name, amount, method, method_details, date, created_at, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 1)
  `).bind(
    body.id,
    orderId == null ? null : orderId,
    getBodyField(body, 'order_number') || null,
    customerName,
    amount,
    body.method,
    methodDetails,
    body.date || null,
  );

  // Orphan payment (no order): nothing to deactivate, nothing to derive.
  if (orderId == null) {
    try {
      await insert().run();
    } catch (err) {
      return json({ error: String(err) }, 400);
    }
    return json({ ok: true, id: body.id }, 201);
  }

  // Deactivate and insert commit as ONE batch. Previously the deactivate was a
  // separate statement outside the try/catch, so a failed insert left the order
  // with zero active payments while returning 400 to a client that logs and moves on.
  const stmts = [];
  if (replace) {
    stmts.push(env.DB.prepare(`
      UPDATE payments SET active = 0 WHERE order_id = ? AND active = 1
    `).bind(orderId));
  }
  stmts.push(insert());

  try {
    await env.DB.batch(stmts);
  } catch (err) {
    return json({ error: String(err) }, 400);
  }

  // Derive the order's payment status from the ledger. Never trust a
  // client-supplied status — this is the single source of truth.
  const order = await env.DB.prepare(
    'SELECT total_cents FROM orders WHERE id = ?'
  ).bind(orderId).first();
  if (!order) {
    // Order was deleted mid-flight; the payment row still stands on its own.
    return json({ ok: true, id: body.id }, 201);
  }

  const active = await env.DB.prepare(
    'SELECT amount FROM payments WHERE order_id = ? AND active = 1'
  ).bind(orderId).all();
  const collected = activePaymentsCents((active && active.results) || []);
  const totalCents = Number(order.total_cents) || 0;
  const paymentStatus = derivePaymentStatus(collected, totalCents);

  await env.DB.prepare('UPDATE orders SET payment_status = ? WHERE id = ?')
    .bind(paymentStatus, orderId).run();

  await env.DB.prepare(`
    INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, 'order:payment_recorded')
  `).bind(orderId, actor || 'unknown').run();

  return json({
    ok: true,
    id: body.id,
    paymentStatus,
    balanceCents: balanceCentsCents(collected, totalCents),
  }, 201);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd orders && npx vitest run tests/create-payment.test.js`

Expected: PASS — 14 tests

- [ ] **Step 6: Run the full worker suite**

Run: `cd orders && npx vitest run`

Expected: PASS. `quote-deposit-lib.test.js` and `invoice-lib.test.js` are the ones that matter here — they must be untouched-green, which is what the `replace: true` default guarantees.

- [ ] **Step 7: Commit**

```bash
git add orders/workers/api.js orders/tests/create-payment.test.js
git commit -m "fix(payments): batch the deactivate, add replace mode, derive status

createPayment deactivated every active payment for the order in a separate
statement outside the try/catch, so a failed insert left the order with zero
payments and returned 400 to a client that logs and moves on.

- deactivate and insert now commit as one DB.batch
- replace (default true) keeps existing callers byte-identical; replace:false
  appends a top-up so a deposit is no longer erased by the balance that
  settles it
- method_details is written, matching markOrderPaid
- orders.payment_status is derived from the ledger, never client-supplied
- an order_events row is written on every payment (actor was accepted and unused)"
```

---

## Task 3: `rowToQuote` maps the deposit fields

`QUOTE_FIELDS` already selects these columns, but the serializer drops them, so they are write-only across the entire codebase. This is the change that later lets the Sales Hub show a quote deposit at all.

**Files:**
- Modify: `orders/workers/api.js:3161-3187` (`rowToQuote`), and add a named export
- Test: `orders/tests/row-to-quote.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks. Independent of Task 1 and 2.
- Produces: named export `rowToQuote` from `api.js`. Task 5's `apiToQuote` mapping depends on the four new field names: `public_token`, `deposit_paid_cents`, `deposit_paid_at`, `deposit_method`.

- [ ] **Step 1: Write the failing test**

Create `orders/tests/row-to-quote.test.js`:

```js
import { describe, it, expect } from 'vitest';
import worker, { rowToQuote } from '../workers/api.js';

const BASE_ROW = {
  id: 7,
  status: 'new',
  customer_name: 'Ana',
  email: 'ana@example.test',
  cake_flavor: 'tres leches',
  quoted_price: 15000,
  created_at: '2026-09-01 10:00:00',
  updated_at: '2026-09-01 10:00:00',
};

describe('rowToQuote deposit mapping', () => {
  it('is exported for direct testing', () => {
    expect(typeof worker.fetch).toBe('function');
    expect(typeof rowToQuote).toBe('function');
  });

  it('maps public_token, which the Quotes tab needs for a pay link', () => {
    const q = rowToQuote({ ...BASE_ROW, public_token: 'abc123' });
    expect(q.public_token).toBe('abc123');
  });

  it('maps the three deposit fields', () => {
    const q = rowToQuote({
      ...BASE_ROW,
      deposit_paid_cents: 4000,
      deposit_paid_at: '2026-09-05 12:00:00',
      deposit_method: 'stripe',
    });
    expect(q.deposit_paid_cents).toBe(4000);
    expect(q.deposit_paid_at).toBe('2026-09-05 12:00:00');
    expect(q.deposit_method).toBe('stripe');
  });

  it('preserves a falsy-but-present deposit amount of 0 rather than dropping it', () => {
    const q = rowToQuote({ ...BASE_ROW, deposit_paid_cents: 0, deposit_paid_at: null, deposit_method: null });
    expect(q).toHaveProperty('deposit_paid_cents', 0);
    expect(q.deposit_paid_at).toBeNull();
    expect(q.deposit_method).toBeNull();
  });

  it('maps null when the columns are absent entirely', () => {
    const q = rowToQuote(BASE_ROW);
    expect(q).toHaveProperty('deposit_paid_cents');
    expect(q).toHaveProperty('public_token');
  });

  it('leaves existing fields untouched', () => {
    const q = rowToQuote(BASE_ROW);
    expect(q.id).toBe(7);
    expect(q.quoted_price).toBe(15000);
    expect(q.cake_flavor).toBe('tres leches');
    expect(q.items).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd orders && npx vitest run tests/row-to-quote.test.js`

Expected: FAIL — `rowToQuote` is not exported; importing it yields `undefined`.

- [ ] **Step 3: Add the four fields to `rowToQuote`**

In `orders/workers/api.js`, inside `rowToQuote`, after the `converted_order_id: r.converted_order_id,` line, add:

```js
    // These are selected by QUOTE_FIELDS (api.js:3140-3149) but were never
    // mapped, which made them write-only across the whole codebase: a quote
    // deposit could be taken and never displayed, filtered, or surfaced.
    public_token: r.public_token,
    deposit_paid_cents: r.deposit_paid_cents,
    deposit_paid_at: r.deposit_paid_at,
    deposit_method: r.deposit_method,
```

- [ ] **Step 4: Export `rowToQuote`**

At the end of `orders/workers/api.js`, add:

```js

// Exported for unit tests — see tests/row-to-quote.test.js
export { rowToQuote };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd orders && npx vitest run tests/row-to-quote.test.js`

Expected: PASS — 6 tests

- [ ] **Step 6: Run the full worker suite**

Run: `cd orders && npx vitest run`

Expected: PASS. The default export must still be the worker object — verify no import elsewhere broke by running the whole suite rather than just this file.

- [ ] **Step 7: Commit**

```bash
git add orders/workers/api.js orders/tests/row-to-quote.test.js
git commit -m "fix(quotes): map deposit fields and public_token in rowToQuote

QUOTE_FIELDS has selected deposit_paid_cents/_at/_method and public_token
since 0044, but rowToQuote never mapped them, so a quote deposit was
write-only across the entire codebase. Also maps public_token, which gives
the Quotes tab the pay-link button invoices already have."
```

---

## Task 4: `cake_quotes.status` allow-list and edit guard

**Files:**
- Modify: `orders/workers/api.js:53-55` (constant), `orders/workers/api.js:3424-3465` (`updateQuote`), `orders/workers/api.js:3479-3484` (`assertQuoteEditable`)
- Test: `orders/tests/quote-status.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks. Independent.
- Produces: `QUOTE_STATUSES` array; `assertQuoteEditable(quote, what?)` gains an optional second parameter. No later task depends on either, so the exact shape is free — follow the code shown.

- [ ] **Step 1: Write the failing test**

Create `orders/tests/quote-status.test.js`:

```js
import { describe, it, expect } from 'vitest';
import worker from '../workers/api.js';

function makeEnv({ quote } = {}) {
  const calls = [];
  const db = {
    prepare(sql) {
      const stmt = {
        _sql: sql,
        _binds: [],
        bind(...args) { stmt._binds = args; return stmt; },
        async first() {
          calls.push({ sql, binds: stmt._binds, method: 'first' });
          if (/FROM cake_quotes WHERE id/.test(sql)) return quote;
          return null;
        },
        async run() {
          calls.push({ sql, binds: stmt._binds, method: 'run' });
          return { meta: { changes: 1 } };
        },
        async all() { calls.push({ sql, binds: stmt._binds, method: 'all' }); return { results: [] }; },
      };
      return stmt;
    },
    async batch(stmts) { return stmts.map(() => ({ meta: { changes: 1 } })); },
  };
  const env = { DB: db };
  const ctx = { waitUntil: (p) => { if (p && typeof p.catch === 'function') p.catch(() => {}); } };
  return { env, ctx, calls };
}

function patchQuote(body) {
  return new Request('https://orders-api.test/api/quotes/7', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'cf-access-authenticated-user-email': 'jeff@example.test',
    },
    body: JSON.stringify(body),
  });
}

const OPEN_QUOTE = { id: 7, status: 'new', customer_name: 'Ana', quoted_price: 15000 };
const sqlOf = (calls) => calls.map((c) => c.sql).join(' || ');

describe('updateQuote status validation', () => {
  it('accepts every valid status', async () => {
    for (const status of ['new', 'replied', 'converted', 'archived']) {
      const { env, ctx, calls } = makeEnv({ quote: OPEN_QUOTE });
      const res = await worker.fetch(patchQuote({ status }), env, ctx);
      expect(res.status, `status ${status} should be accepted`).toBe(200);
      expect(sqlOf(calls)).toMatch(/UPDATE cake_quotes SET status/);
    }
  });

  it('rejects an unknown status with 400 and issues no UPDATE', async () => {
    const { env, ctx, calls } = makeEnv({ quote: OPEN_QUOTE });
    const res = await worker.fetch(patchQuote({ status: 'banana' }), env, ctx);
    expect(res.status).toBe(400);
    expect(sqlOf(calls)).not.toMatch(/UPDATE cake_quotes/);
  });

  it('does not return a successful no-op for a status-only bad request', async () => {
    // The validation must run BEFORE the `sets.length === 0` early return,
    // otherwise an invalid status would be swallowed into a 200.
    const { env, ctx } = makeEnv({ quote: OPEN_QUOTE });
    const res = await worker.fetch(patchQuote({ status: 'nope' }), env, ctx);
    expect(res.status).toBe(400);
  });

  it('lists the valid statuses in the error message', async () => {
    const { env, ctx } = makeEnv({ quote: OPEN_QUOTE });
    const body = await (await worker.fetch(patchQuote({ status: 'nope' }), env, ctx)).json();
    expect(body.error).toMatch(/new/);
    expect(body.error).toMatch(/replied/);
    expect(body.error).toMatch(/converted/);
    expect(body.error).toMatch(/archived/);
  });
});

describe('updateQuote edit guard', () => {
  it('blocks a quoted_price change on a converted quote', async () => {
    const { env, ctx, calls } = makeEnv({ quote: { ...OPEN_QUOTE, status: 'converted' } });
    const res = await worker.fetch(patchQuote({ quoted_price: 1 }), env, ctx);
    expect(res.status).toBe(400);
    expect(sqlOf(calls)).not.toMatch(/UPDATE cake_quotes/);
  });

  it('blocks a quoted_price change on an archived quote', async () => {
    const { env, ctx } = makeEnv({ quote: { ...OPEN_QUOTE, status: 'archived' } });
    const res = await worker.fetch(patchQuote({ quoted_price: 1 }), env, ctx);
    expect(res.status).toBe(400);
  });

  it('still allows pricing an open quote', async () => {
    const { env, ctx, calls } = makeEnv({ quote: { ...OPEN_QUOTE, status: 'replied' } });
    const res = await worker.fetch(patchQuote({ quoted_price: 18000 }), env, ctx);
    expect(res.status).toBe(200);
    expect(sqlOf(calls)).toMatch(/quoted_price = \?/);
  });

  it('returns 404 for a quote that does not exist', async () => {
    const { env, ctx } = makeEnv({ quote: null });
    const res = await worker.fetch(patchQuote({ quoted_price: 1 }), env, ctx);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd orders && npx vitest run tests/quote-status.test.js`

Expected: FAIL — `status: 'banana'` currently returns 200, and the converted-quote `quoted_price` write is currently allowed.

- [ ] **Step 3: Add the constant**

In `orders/workers/api.js`, after `const ALLOWED_SOURCE  = ['website', 'in-person'];` (line 55), add:

```js
const ALLOWED_QUOTE_STATUS = ['new', 'replied', 'converted', 'archived'];
```

- [ ] **Step 4: Widen `assertQuoteEditable`'s message**

Replace `orders/workers/api.js:3479-3484`:

```js
function assertQuoteEditable(quote) {
  if (quote.status === 'converted' || quote.status === 'archived') {
    return json({ error: `Quote is ${quote.status}; items cannot be changed` }, 400);
  }
  return null;
}
```

with:

```js
// `what` names the thing being guarded so the message is accurate for both
// callers: item edits and the updateQuote field patch. Defaults to the
// original wording so existing item-edit callers are unaffected.
function assertQuoteEditable(quote, what = 'items cannot be changed') {
  if (quote.status === 'converted' || quote.status === 'archived') {
    return json({ error: `Quote is ${quote.status}; ${what}` }, 400);
  }
  return null;
}
```

- [ ] **Step 5: Rewrite `updateQuote`**

Replace `orders/workers/api.js:3424-3465` with:

```js
async function updateQuote(id, request, env, ctx, actor) {
  try {
    const body = await request.json();
    const existing = await env.DB.prepare(
      `SELECT ${QUOTE_FIELDS.join(', ')} FROM cake_quotes WHERE id = ?`
    ).bind(id).first();
    if (!existing) return json({ error: 'Not found' }, 404);

    // Converted and archived quotes are terminal. Mirrors the guard
    // updateInvoice applies at api.js:3722.
    const guard = assertQuoteEditable(existing, 'it cannot be changed');
    if (guard) return guard;

    // Validate BEFORE the `sets.length === 0` early return, otherwise a bad
    // status would be silently swallowed into a successful no-op.
    if (body.status !== undefined && !ALLOWED_QUOTE_STATUS.includes(body.status)) {
      return json({
        error: `Invalid status. Must be one of: ${ALLOWED_QUOTE_STATUS.join(', ')}`,
      }, 400);
    }

    const sets = [];
    const binds = [];

    if (body.quoted_price !== undefined) {
      sets.push('quoted_price = ?');
      binds.push(body.quoted_price);
    }
    if (body.admin_notes !== undefined) {
      sets.push('admin_notes = ?');
      binds.push(body.admin_notes);
    }
    if (body.status !== undefined) {
      sets.push('status = ?');
      binds.push(body.status);
    }

    if (sets.length === 0) return json({ ok: true }, 200);

    sets.push("updated_at = datetime('now')");
    binds.push(id);

    await env.DB.prepare(
      `UPDATE cake_quotes SET ${sets.join(', ')} WHERE id = ?`
    ).bind(...binds).run();

    return json({ ok: true }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}
```

Note the dead `if (body.status === 'archived' || ...)` block at the old lines 3457-3459 is removed — its body was an empty comment.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd orders && npx vitest run tests/quote-status.test.js`

Expected: PASS — 8 tests

- [ ] **Step 7: Run the full worker suite**

Run: `cd orders && npx vitest run`

Expected: PASS. If `createQuote` (the admin path) now fails because it PATCHes a just-created quote, check `api.js:3265` — it inserts with a server-derived status and should not be calling `updateQuote` at all.

- [ ] **Step 8: Commit**

```bash
git add orders/workers/api.js orders/tests/quote-status.test.js
git commit -m "fix(quotes): allow-list cake_quotes.status and guard the edit

updateQuote bound body.status straight into the UPDATE with no allow-list
and no CHECK constraint anywhere in the schema. Every consumer tests
status by equality against two literals, so an unknown value fails open
rather than erroring — which turns the duplicate-payment guards in
quoteDepositPaid and the reconversion guard into silent second orders.

Validation runs before the sets.length===0 early return so a bad status
cannot be swallowed into a 200.

Also adds the assertQuoteEditable guard that updateInvoice already had at
api.js:3722, so quoted_price can no longer be rewritten on a terminal quote."
```

---

## Task 5: `recordPayment` resignature and the three `Orders.tsx` call sites

This is the task that stops the over-collection proven by order 52 in the local D1 store: a `$1.30` deposit deactivated 85 seconds before a `$13.00` payment on a `$13.00` order.

**Files:**
- Modify: `home-bakery-management-system/src/utils/api.ts:698-706` (`PaymentCreate`), `:713-718` (`createPayment`)
- Modify: `home-bakery-management-system/src/context/StoreContext.tsx:66` (type), `:582-586` (`handleApiCreateOrder`), `:685-701` (`recordPayment`)
- Modify: `home-bakery-management-system/src/pages/Orders.tsx:105-130`, `:478-497`, `:545-560`
- Test: `home-bakery-management-system/src/utils/payments.test.ts` (new)

**Interfaces:**
- Consumes: the `replace` field and the `{ paymentStatus, balanceCents }` response from Task 2.
- Produces: `recordPayment(input: { orderId, amountCents, method, subMethod?, date?, replace? }) => Promise<{ ok, paymentStatus, balanceCents }>`. Task 6 and the Sales Hub spec consume this.

- [ ] **Step 1: Write the failing test**

Create `home-bakery-management-system/src/utils/payments.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";

const fetchMock = vi.fn();
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

function stubFetchOnce(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
}

const sentBody = () => JSON.parse(fetchMock.mock.calls[0][1].body);

describe("createPayment wire format", () => {
  it("sends amount in dollars, converting from cents exactly once", async () => {
    stubFetchOnce({ ok: true, id: "p1", paymentStatus: "partial", balanceCents: 3000 });
    const { createPayment } = await import("./api");
    await createPayment({
      id: "p1",
      orderId: 1,
      customerName: "Ana",
      amountCents: 3050,
      method: "cash",
    } as never);
    expect(sentBody().amount).toBe(30.5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd home-bakery-management-system && npx vitest run src/utils/payments.test.ts`

Expected: FAIL — `createPayment` sends `amount` verbatim and has no cents conversion.

- [ ] **Step 3: Extend `PaymentCreate`**

Replace `home-bakery-management-system/src/utils/api.ts:698-706`:

```ts
export interface PaymentCreate {
  id: string;
  orderId?: number | null;
  orderNumber?: string | null;
  customerName: string;
  /** DOLLARS, not cents — payments.amount is a REAL column (migrations/0006). */
  amount: number;
  method: PaymentMethod;
  methodDetails?: string | null;
  date?: string;
  /**
   * true (default, omitted) supersedes earlier payments for the order.
   * false appends a top-up so a deposit survives the balance that settles it.
   */
  replace?: boolean;
}
```

- [ ] **Step 4: Return the derived status from `createPayment`**

Add `PaymentStatus` to the type import on line 1 of `home-bakery-management-system/src/utils/api.ts`:

```ts
import type { BusinessProfile, FlavorGroup, PackSize, PaymentMethod, PaymentStatus, RecipeLine, Invoice, PaymentOptions } from "../types";
```

Replace `home-bakery-management-system/src/utils/api.ts:713-718`:

```ts
export async function createPayment(p: PaymentCreate): Promise<{
  ok: boolean;
  id: string;
  paymentStatus?: PaymentStatus;
  balanceCents?: number;
}> {
  return apiFetch("/api/payments", {
    method: "POST",
    body: JSON.stringify(p),
  });
}
```

- [ ] **Step 5: Reshape `recordPayment`**

Add `PaymentMethod` and `PaymentStatus` to the `from "../types"` import block in `home-bakery-management-system/src/context/StoreContext.tsx` (currently lines 11-25, listing `BusinessProfile` through `Receipt`; neither symbol is present).

Replace `home-bakery-management-system/src/context/StoreContext.tsx:685-701`:

```ts
  const recordPayment = useCallback(
    async (input: {
      orderId: number;
      customerName: string;
      amountCents: number;
      method: PaymentMethod;
      subMethod?: string | null;
      date?: string;
      replace?: boolean;
    }): Promise<{ ok: boolean; paymentStatus: PaymentStatus; balanceCents: number }> => {
      // amountCents because the modal and Orders both do balance maths in
      // cents; the wire format is dollars to match the REAL column.
      // customerName stays required — createPayment 400s without it.
      const result = await apiCreatePayment({
        id: newId("pay"),
        orderId: input.orderId,
        orderNumber: null,
        customerName: input.customerName,
        amount: input.amountCents / 100,
        method: input.method,
        methodDetails: input.subMethod ?? null,
        date: input.date ?? new Date().toISOString(),
        replace: input.replace,
      });
      await refreshPayments();
      await refreshOrders();
      return {
        ok: Boolean(result?.ok),
        paymentStatus: (result?.paymentStatus ?? "unpaid") as PaymentStatus,
        balanceCents: result?.balanceCents ?? 0,
      };
    },
    [refreshPayments, refreshOrders]
  );
```

Replace the type declaration at `home-bakery-management-system/src/context/StoreContext.tsx:66`:

```ts
  recordPayment: (input: {
    orderId: number;
    customerName: string;
    amountCents: number;
    method: PaymentMethod;
    subMethod?: string | null;
    date?: string;
    replace?: boolean;
  }) => Promise<{ ok: boolean; paymentStatus: PaymentStatus; balanceCents: number }>;
```

- [ ] **Step 6: Refresh payments after the new-order deposit**

Find `handleApiCreateOrder` at `home-bakery-management-system/src/context/StoreContext.tsx:582-586`. It currently refreshes orders only. Because `OrderModal.tsx:180-195` records the 10% deposit by calling `createPayment` directly and never refreshing, the resulting row is missing from the client `payments` array — which is what makes `Orders.tsx:480-483` compute `remaining` as the full total and over-collect.

After the order is created, refresh payments too:

```ts
  const handleApiCreateOrder = useCallback(
    async (order: Parameters<typeof apiCreateOrder>[0]): Promise<{ id: number }> => {
      const result = await apiCreateOrder(order);
      // OrderModal records the new-order deposit by calling createPayment
      // directly (to avoid a circular import), so payments must be refreshed
      // here or "Collect Balance" will read a stale array and over-collect.
      await Promise.all([refreshOrders(), refreshPayments()]);
      return result;
    },
    [refreshOrders, refreshPayments]
  );
```

- [ ] **Step 7: Re-point the three `Orders.tsx` call sites**

Replace `home-bakery-management-system/src/pages/Orders.tsx:110-114` (the `confirmPayment` body):

```ts
      await recordPayment({
        orderId,
        customerName: payFor.customerName,
        amountCents: Math.round(payFor.total * 100),
        method: payMethod,
        replace: true,
      });
```

Replace the two-await pair at `home-bakery-management-system/src/pages/Orders.tsx:484-485` (Collect Balance):

```ts
      await recordPayment({
        orderId: Number(selected.id),
        customerName: selected.customerName,
        amountCents: Math.round(remaining * 100),
        method: markPayMethod,
        replace: false,
      });
```

Replace the two-await pair at `home-bakery-management-system/src/pages/Orders.tsx:547-548` (Mark as Paid on an unpaid order):

```ts
      await recordPayment({
        orderId: Number(selected.id),
        customerName: selected.customerName,
        amountCents: Math.round(selected.total * 100),
        method: markPayMethod,
        replace: true,
      });
```

The `apiUpdateOrder({ payment_status: 'paid', payment_method })` calls that preceded each of these are removed — the server derives the status now, and the old order wrote `paid` *before* the payment that justified it existed. `refreshOrders()` already follows each handler.

- [ ] **Step 8: Run the test and typecheck**

Run: `cd home-bakery-management-system && npx vitest run src/utils/payments.test.ts && npx tsc --noEmit`

Expected: the test PASSes and `tsc` reports no errors. If `tsc` flags unused variables where `apiUpdateOrder` was removed, delete the now-unused import.

- [ ] **Step 9: Run the full SPA suite**

Run: `cd home-bakery-management-system && npx vitest run`

Expected: PASS — all 19 pre-existing files still green.

- [ ] **Step 10: Commit**

```bash
git add home-bakery-management-system/src/utils/api.ts \
        home-bakery-management-system/src/context/StoreContext.tsx \
        home-bakery-management-system/src/pages/Orders.tsx \
        home-bakery-management-system/src/utils/payments.test.ts
git commit -m "fix(payments): resign recordPayment and stop over-collecting balances

OrderModal records the new-order 10% deposit by calling createPayment
directly and never refreshes, so the client payments array lacked it.
Orders.tsx then computed 'remaining' from that stale array, saw \$0 paid,
and collected the FULL order total — which the server's deactivate then
used to erase the deposit. Local D1 proof: order 52, \$1.30 deposit
deactivated 85s before a \$13.00 payment on a \$13.00 order.

recordPayment now takes explicit cents/method/replace instead of a
forged Order whose 'total' field was silently the balance, and the three
call sites stop writing payment_status by hand — the server derives it."
```

---

## Task 6: Route the payment void and expose voided rows

Nothing in the application can currently un-deactivate a payment. This wires the already-written `deletePayment` handler and adds the one view that makes the hub's "Undo payment" copy correction truthful.

**Files:**
- Modify: `orders/workers/api.js:345-346` (route table), `:2694-2699` (`listPayments`), `:2742-2746` (`deletePayment`)
- Modify: `home-bakery-management-system/src/utils/api.ts:708-711` (`fetchPayments`)
- Modify: `home-bakery-management-system/src/pages/Payments.tsx`
- Test: `orders/tests/list-payments.test.js` (new)

**Interfaces:**
- Consumes: `deletePayment` (`api.js:2742`, already written, currently unrouted).
- Produces: `GET /api/payments?include_voided=1` returns active and inactive rows; `DELETE /api/payments/:id` deactivates by id. The Sales Hub spec's Payments tab depends on neither.

- [ ] **Step 1: Write the failing test**

Create `orders/tests/list-payments.test.js`:

```js
import { describe, it, expect } from 'vitest';
import worker from '../workers/api.js';

const PAYMENTS = [
  { id: 'pay_1', order_id: 1, amount: 60, method: 'cash', active: 1 },
  { id: 'pay_2', order_id: 1, amount: 1.3, method: 'cash', active: 0 },
];

function makeEnv() {
  const calls = [];
  const db = {
    prepare(sql) {
      const stmt = {
        _sql: sql,
        _binds: [],
        bind(...args) { stmt._binds = args; return stmt; },
        async first() { calls.push({ sql, binds: stmt._binds, method: 'first' }); return null; },
        async run() {
          calls.push({ sql, binds: stmt._binds, method: 'run' });
          return { meta: { changes: 1 } };
        },
        async all() {
          calls.push({ sql, binds: stmt._binds, method: 'all' });
          return { results: PAYMENTS };
        },
      };
      return stmt;
    },
    async batch(stmts) { return stmts.map(() => ({ meta: { changes: 1 } })); },
  };
  const env = { DB: db };
  const ctx = { waitUntil: () => {} };
  return { env, ctx, calls };
}

const authHeaders = { 'cf-access-authenticated-user-email': 'jeff@example.test' };

describe('listPayments', () => {
  it('returns only active rows by default', async () => {
    const { env, ctx, calls } = makeEnv();
    await worker.fetch(new Request('https://orders-api.test/api/payments', { headers: authHeaders }), env, ctx);
    const select = calls.find((c) => c.method === 'all');
    expect(select.sql).toMatch(/WHERE active = 1/);
  });

  it('returns every row when include_voided=1', async () => {
    const { env, ctx, calls } = makeEnv();
    await worker.fetch(
      new Request('https://orders-api.test/api/payments?include_voided=1', { headers: authHeaders }),
      env, ctx
    );
    const select = calls.find((c) => c.method === 'all');
    expect(select.sql).not.toMatch(/WHERE active = 1/);
  });
});

describe('DELETE /api/payments/:id', () => {
  it('deactivates a payment by id', async () => {
    const { env, ctx, calls } = makeEnv();
    const res = await worker.fetch(
      new Request('https://orders-api.test/api/payments/pay_1', { method: 'DELETE', headers: authHeaders }),
      env, ctx
    );
    expect(res.status).toBe(200);
    const update = calls.find((c) => /UPDATE payments SET active = 0 WHERE id/.test(c.sql));
    expect(update).toBeTruthy();
    expect(update.binds).toContain('pay_1');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd orders && npx vitest run tests/list-payments.test.js`

Expected: FAIL — `include_voided` is ignored and `DELETE /api/payments/:id` returns 404.

- [ ] **Step 3: Add the route and honour `include_voided`**

In `orders/workers/api.js`, the route table currently reads:

```js
  if (path === '/api/payments' && method === 'GET') return await listPayments(env);
  if (path === '/api/payments' && method === 'POST') return await createPayment(request, env, actor);
```

Replace with:

```js
  if (path === '/api/payments' && method === 'GET') return await listPayments(request, env);
  if (path === '/api/payments' && method === 'POST') return await createPayment(request, env, actor);
  const payDelete = path.match(/^\/api\/payments\/([^/]+)$/);
  if (payDelete && method === 'DELETE') return await deletePayment(payDelete[1], env, actor);
```

Replace `orders/workers/api.js:2694-2699`:

```js
async function listPayments(request, env) {
  // Default stays active-only: eleven frontend consumers (Dashboard revenue,
  // both charts, the owed total, Payments totals, Orders balance maths) assume
  // the array is pre-filtered and none of them filter on `active` themselves.
  // Widening the default would silently change all of them at once.
  const includeVoided = new URL(request.url).searchParams.get('include_voided') === '1';
  const where = includeVoided ? '' : 'WHERE active = 1';
  const { results } = await env.DB.prepare(`
    SELECT * FROM payments ${where} ORDER BY date DESC, created_at DESC
  `).all();
  return json({ payments: results.map(snakeToCamelObject) }, 200);
}
```

`deletePayment` at `api.js:2742-2746` needs no change — it already performs the soft delete. It is referenced by no other call site, so widening its signature usage is safe.

- [ ] **Step 4: Audit the in-place method rewrite**

`updateOrder` rewrites `method` on the newest active payment row in place with no audit event (`api.js:955-965`), triggered by the "Edit method" button (`Orders.tsx:427` → `Orders.tsx:768`). On an order with a cash deposit and a card balance, "correcting" the method relabels the cash row with nothing recorded.

The behaviour is intentional and stays. Add the event. `updateOrder` already has `actor` in scope (`api.js:882`, passed as `actorName` from the route at `api.js:219`), so no signature change is needed. Inside that `if (body.payment_method !== undefined)` block, after the existing `UPDATE payments SET method = ...` statement, add:

```js
      await env.DB.prepare(
        `INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, 'order:payment_method_corrected')`
      ).bind(id, actor).run();
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd orders && npx vitest run tests/list-payments.test.js`

Expected: PASS — 3 tests

- [ ] **Step 5: Expose the filter on the client**

Replace `home-bakery-management-system/src/utils/api.ts:708-711`:

```ts
export async function fetchPayments(includeVoided = false): Promise<ApiPayment[]> {
  const data = await apiFetch<{ payments: ApiPayment[] }>(
    `/api/payments${includeVoided ? "?include_voided=1" : ""}`
  );
  return data.payments;
}
```

- [ ] **Step 6: Add the voided-payments section to the Payments tab**

In `home-bakery-management-system/src/pages/Payments.tsx`, add a second state and a disclosure section below the existing table. The existing active-only fetch at line 17 stays as-is; the voided fetch is separate and only runs when the section is opened.

Add to the component body:

```tsx
  const [showVoided, setShowVoided] = useState(false);
  const [voidedPayments, setVoidedPayments] = useState<Payment[]>([]);
  const [voidedBusy, setVoidedBusy] = useState(false);

  const toggleVoided = async () => {
    const next = !showVoided;
    setShowVoided(next);
    if (!next) return;
    setVoidedBusy(true);
    try {
      const rows = await fetchPayments(true);
      setVoidedPayments(rows.filter((p) => !p.active).map(apiToPaymentForRow));
    } catch (err) {
      console.warn("Failed to fetch voided payments:", err);
    } finally {
      setVoidedBusy(false);
    }
  };

  const restorePayment = async (id: string) => {
    try {
      await deletePayment(id);
      const rows = await fetchPayments(true);
      setVoidedPayments(rows.filter((p) => !p.active).map(apiToPaymentForRow));
    } catch (err) {
      console.warn("Failed to restore payment:", err);
    }
  };
```

Add the section after the existing table (after line 104, before the "Accepted payment methods" panel):

```tsx
      <div className="rounded-xl border border-sand-200 bg-white shadow-sm">
        <button
          onClick={toggleVoided}
          className="flex w-full items-center justify-between px-5 py-4 text-left text-sm font-semibold text-cocoa"
        >
          Voided payments
          <span className="text-xs font-normal text-cocoa-muted">
            {showVoided ? "Hide" : "Show"}
          </span>
        </button>
        {showVoided && (
          <div className="border-t border-sand-100 px-5 py-4">
            {voidedBusy && <p className="text-sm text-cocoa-muted">Loading…</p>}
            {!voidedBusy && voidedPayments.length === 0 && (
              <p className="text-sm text-cocoa-muted">No voided payments.</p>
            )}
            {!voidedBusy && voidedPayments.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-sand-100 text-left text-xs uppercase tracking-wide text-cocoa-muted">
                    <th className="px-2 py-2">Customer</th>
                    <th className="px-2 py-2">Method</th>
                    <th className="px-2 py-2">Date</th>
                    <th className="px-2 py-2 text-right">Amount</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand-100">
                  {voidedPayments.map((p) => (
                    <tr key={p.id}>
                      <td className="px-2 py-2 text-cocoa-muted">{p.customerName}</td>
                      <td className="px-2 py-2 text-cocoa-muted">
                        {PAYMENT_METHOD_LABELS[p.method]}
                      </td>
                      <td className="px-2 py-2 text-cocoa-muted">{formatDateTime(p.date)}</td>
                      <td className="px-2 py-2 text-right text-cocoa-muted line-through">
                        {formatCurrency(p.amount)}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button
                          onClick={() => restorePayment(p.id)}
                          className="text-xs font-semibold text-palm hover:underline"
                        >
                          Restore
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
```

Add the imports this needs to the top of `Payments.tsx`: `fetchPayments`, `deletePayment` from `../utils/api`, and the `Payment` type from `../types`. If the API's snake/camel shape does not match the `Payment` type directly, write a small local mapper rather than importing the store's private one.

- [ ] **Step 7: Correct the "Undo payment" copy**

`home-bakery-management-system/src/pages/Orders.tsx:434` and `:520` both read:

```
"Mark this order as unpaid? The payment history will be kept for your records."
```

That is false — `api.js:950-952` deactivates every active payment and `listPayments` filters them out. Replace both with:

```
"This will void every payment recorded for this order. They stay in the database but will no longer count toward revenue. Continue?"
```

- [ ] **Step 8: Run the SPA tests and typecheck**

Run: `cd home-bakery-management-system && npx vitest run && npx tsc --noEmit`

Expected: PASS and no type errors.

- [ ] **Step 9: Commit**

```bash
git add orders/workers/api.js orders/tests/list-payments.test.js \
        home-bakery-management-system/src/utils/api.ts \
        home-bakery-management-system/src/pages/Payments.tsx \
        home-bakery-management-system/src/pages/Orders.tsx
git commit -m "feat(payments): route the payment void and expose voided rows

deletePayment existed at api.js:2742 but no route reached it and the client
wrapper was never called, so there was no way to un-deactivate a payment
anywhere in the app. Wired the route and added a disclosure in the Payments
tab listing voided rows with a Restore action.

GET /api/payments keeps returning active rows only — eleven frontend
consumers assume that and none filter on active themselves. Voided rows
come from a separate ?include_voided=1 parameter.

Also corrects the 'Undo payment' confirm text, which claimed history was
kept for the record while the handler deactivates it."
```

---

## Task 7: Make `convertQuoteToOrder` atomic

**Files:**
- Modify: `orders/workers/api.js:4517-4640` (`convertQuoteToOrder`)
- Test: `orders/tests/convert-quote-atomic.test.js` (new)

**Interfaces:**
- Consumes: nothing from earlier tasks. Independent.
- Produces: no new interfaces. `convertQuoteToOrder` keeps its signature `(env, id, quote, { depositCents, method, subMethod, actor })` and its `{ orderId, paymentStatus }` return, so both callers (`api.js:4313` heal, `api.js:4371` happy path) are unaffected.

- [ ] **Step 1: Write the failing test**

Create `orders/tests/convert-quote-atomic.test.js`:

```js
import { describe, it, expect } from 'vitest';
import worker from '../workers/api.js';

const QUOTE = {
  id: 18,
  status: 'new',
  customer_name: 'Ana',
  email: 'ana@example.test',
  quoted_price: 15000,
  public_token: 'tok123',
  deposit_ref: null,
  converted_order_id: null,
};

function makeEnv() {
  const calls = [];
  const db = {
    prepare(sql) {
      const stmt = {
        _sql: sql,
        _binds: [],
        bind(...args) { stmt._binds = args; return stmt; },
        async first() {
          calls.push({ sql, binds: stmt._binds, method: 'first' });
          if (/FROM cake_quotes WHERE id/.test(sql)) return QUOTE;
          return null;
        },
        async run() {
          calls.push({ sql, binds: stmt._binds, method: 'run' });
          return { meta: { changes: 1, last_row_id: 99 } };
        },
        async all() { calls.push({ sql, binds: stmt._binds, method: 'all' }); return { results: [] }; },
      };
      return stmt;
    },
    async batch(stmts) {
      calls.push({
        sql: 'BATCH',
        binds: stmts.map((s) => ({ sql: s._sql, binds: s._binds })),
        method: 'batch',
      });
      return stmts.map(() => ({ meta: { changes: 1, last_row_id: 99 } }));
    },
  };
  const env = { DB: db, PAYMENT_WEBHOOK_SECRET: 's3cret' };
  const ctx = { waitUntil: (p) => { if (p && typeof p.catch === 'function') p.catch(() => {}); } };
  return { env, ctx, calls };
}

const depositRequest = () =>
  new Request('https://orders-api.test/api/quotes/18/deposit-paid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': 's3cret' },
    body: JSON.stringify({ token: 'tok123', method: 'stripe', ref: 'cs_test_1', amount_cents: 7500 }),
  });

describe('convertQuoteToOrder atomicity', () => {
  it('commits the order, payment, event and quote update as one batch', async () => {
    const { env, ctx, calls } = makeEnv();
    await worker.fetch(depositRequest(), env, ctx);

    const batch = calls.find((c) => c.method === 'batch');
    expect(batch, 'the conversion must be all-or-nothing').toBeTruthy();

    const batchSql = batch.binds.map((b) => b.sql).join(' || ');
    expect(batchSql).toMatch(/INSERT INTO orders/);
    expect(batchSql).toMatch(/INSERT INTO payments/);
    expect(batchSql).toMatch(/INSERT INTO order_events/);
    expect(batchSql).toMatch(/UPDATE cake_quotes SET status = 'converted'/);
  });

  it('issues no standalone order insert outside the batch', async () => {
    const { env, ctx, calls } = makeEnv();
    await worker.fetch(depositRequest(), env, ctx);
    const stray = calls.filter(
      (c) => c.method === 'run' && /INSERT INTO orders/.test(c.sql)
    );
    expect(stray, 'a standalone order insert can survive a crash that loses the payment').toHaveLength(0);
  });

  it('still returns an order id to the caller', async () => {
    const { env, ctx } = makeEnv();
    const res = await worker.fetch(depositRequest(), env, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.order_id).toBe(99);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd orders && npx vitest run tests/convert-quote-atomic.test.js`

Expected: FAIL — the conversion currently issues four standalone `.run()` calls, so `batch` is undefined.

- [ ] **Step 3: Batch the conversion**

In `orders/workers/api.js`, inside `convertQuoteToOrder`, replace the four sequential awaits — the order INSERT, the payments deactivate, the payments INSERT, the `order_events` INSERT, and the `cake_quotes` UPDATE (lines `4596` through `4637`) — with a single batch. The order insert runs first via `.run()` to obtain `last_row_id`; everything that depends on that id then goes in the batch:

```js
  const orderResult = await env.DB.prepare(`
    INSERT INTO orders (customer_name, phone, email, pickup_date, items_json,
      total_cents, payment_method, payment_status, status, notes,
      created_by, source, language)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 'website', ?)
  `).bind(
    quote.customer_name, quote.phone, quote.email,
    quote.desired_date || new Date().toISOString().slice(0, 10),
    itemsJson, quote.quoted_price, method, paymentStatus,
    orderNotes, actor, quote.language || 'es'
  ).run();

  const orderId = orderResult.meta.last_row_id;

  // One batch, all-or-nothing. Previously these were four separate awaits, so a
  // crash after the order insert but before the payment left an order with no
  // payment and the quote still 'new' — the exact partial state the crash-heal
  // branch at api.js:4310 exists to repair. convertInvoiceToOrder has batched
  // its five statements since it was written (api.js:3923-3954).
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO payments (id, order_id, customer_name, amount, method, method_details, date)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(payId, orderId, quote.customer_name, depositCents / 100, method, subMethod),

    env.DB.prepare(`
      INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, 'order:created')
    `).bind(orderId, actor),

    env.DB.prepare(`
      UPDATE cake_quotes SET status = 'converted', converted_order_id = ?,
        updated_at = datetime('now') WHERE id = ?
    `).bind(orderId, id),
  ]);
```

**Delete** the `UPDATE payments SET active = 0 WHERE order_id = ? AND active = 1` statement at the old line `4620-4622`. It targets an order inserted seconds earlier in the same function, so it always matches zero rows.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd orders && npx vitest run tests/convert-quote-atomic.test.js`

Expected: PASS — 3 tests

- [ ] **Step 5: Run the full worker suite**

Run: `cd orders && npx vitest run`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add orders/workers/api.js orders/tests/convert-quote-atomic.test.js
git commit -m "fix(quotes): make quote-to-order conversion atomic

The four statements ran as separate awaits, so a crash after the order
insert but before the payment insert left an order with no payment and the
quote still 'new' — the exact partial state the crash-heal branch at
api.js:4310 exists to repair. convertInvoiceToOrder has batched its five
statements since it was written.

Also drops the deactivate of payments for the just-inserted order, which
always matched zero rows."
```

---

## Post-Implementation Verification

Run after all seven tasks.

- [ ] **Step 1: Full worker suite**

Run: `cd orders && npx vitest run`
Expected: PASS — 13 pre-existing files plus 6 new ones.

- [ ] **Step 2: Full SPA suite and typecheck**

Run: `cd home-bakery-management-system && npx vitest run && npx tsc --noEmit`
Expected: PASS and no type errors.

- [ ] **Step 3: Confirm no migration was added**

Run: `git diff --stat HEAD~7 -- orders/migrations/`
Expected: empty. If this prints anything, a migration was introduced in violation of the global constraints.

- [ ] **Step 4: Measure the ledger divergence on the local D1 store, then production**

Run against `orders/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/85810f21….sqlite`:

```sql
SELECT o.id, o.payment_status, o.total_cents,
       CAST(ROUND(COALESCE(SUM(CASE WHEN p.active = 1 THEN p.amount * 100 ELSE 0 END), 0)) AS INTEGER) AS collected_cents
FROM orders o
LEFT JOIN payments p ON p.order_id = o.id
GROUP BY o.id
HAVING collected_cents < o.total_cents
   AND o.payment_status = 'paid';
```

Expected: a non-zero count **before** the fix (the local store has 8 deactivated rows including the order-52 pair) and zero after re-deriving. Then run the identical query against production D1 — its divergence count is the real measure of how long this has been live, and should be checked before shipping.

- [ ] **Step 5: Manual smoke test in the dashboard**

Run `cd home-bakery-management-system && npm run dev` and the orders API locally, then:

1. Create a cake order with the 10% deposit collected. Confirm the Payments tab shows the deposit immediately, without a reload.
2. Open that order and click **Collect Balance**. Confirm the Payments tab now shows **two** rows for it — the deposit and the balance — totalling the order total, and that the order reads `paid`.
3. Click **Undo payment**. Confirm both rows move to the new **Voided payments** section and revenue drops.
4. Restore one. Confirm it returns to the active list.
5. Open a quote that has a deposit recorded but no order (use the local D1 fixture). Confirm the deposit is now visible on the Quotes tab.
6. `PATCH /api/quotes/7` with `{"status":"banana"}`. Confirm a 400 and no database change.

---

## Known gaps left open by this plan

Recorded so they are not mistaken for fixed. All are tracked in `docs/superpowers/specs/2026-09-28-payment-ledger-correctness-design.md` under "Not addressed here".

- **The under-minimum deposit is still a customer-facing lockout.** A customer who pays under the floor sees a green *"Your date is secured"* screen when no order exists, receives no confirmation email, and cannot pay the remainder. Task 3 makes the state *visible to the owner*; it does not change what the customer experiences. Deferred to the third spec.
- **Nothing still prevents a double charge** — a quote-deposit link and an invoice for the same cake produce two orders and two revenue-counting payments. Needs `orders.quote_id` plus a unique index.
- **Quote conversion is still not serialized against itself.** Task 7 buys atomicity, not serialization: two concurrent converts can both insert, because there is no unique index on `cake_quotes.converted_order_id`. Same migration as above would close it.
- **`orders.payment_status` can still be flipped to `unpaid` by `api.js:950-952`**, after which a provider retry can insert a second payment row for the same money, because the `alreadyPaid` guard at `api.js:1080` reads that mutable field. Fixing it properly means a `payment_ref` column on `payments`.
- **`seedPayments` is still `[]`**, so a transient `GET /api/payments` failure silently blanks revenue with only a `console.warn`.
- **No `CHECK` constraint on `cake_quotes.status`.** The app-layer allow-list closes the write path; a future code path with a typo would still land a bad value.
- **The `quote_deposit` claim-loser still does not self-heal** (`api.js:4360-4362`), unlike the invoice equivalent.
- **`convertQuoteToOrder` still drops the recorded deposit** — it never reads `quote.deposit_paid_cents`, so the true amount is lost once the quote converts.
