import { describe, it, expect } from 'vitest';
import worker from '../workers/api.js';

// D1 stub with the batch() support the mark-paid stub lacks.
// Follows the makeEnv pattern from tests/mark-paid.test.js:5-33.
function makeEnv({
  totalCents = 6000,
  activePayments = [],
  orderExists = true,
  batchThrows = false,
  throwOnAll = false,
} = {}) {
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
          if (throwOnAll) throw new Error('D1_ERROR: something failed after the batch');
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
      if (batchThrows) throw new Error('UNIQUE constraint failed: payments.id');
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

// Every statement's SQL, flattened out of any batch. A batch is recorded as one
// call whose .sql is the literal 'BATCH', with the statement SQL in .binds —
// so without the flatten, the batched INSERT would be invisible here.
const sqlOf = (calls) => calls
  .flatMap((c) => (c.method === 'batch' ? c.binds.map((b) => b.sql) : [c.sql]))
  .join(' || ');
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

  // The field arrives as JSON with no runtime validation, so the falsy
  // spellings below all arrive as truthy-ish junk. Reading "false" as true
  // deactivates the order's prior payments — the failure replace:false exists
  // to prevent — so each spelling is pinned here.
  it('treats an explicit string "false" as replace:false, not true', async () => {
    const { env, ctx, calls } = makeEnv();
    await worker.fetch(createPaymentRequest({ ...BASE, replace: 'false' }), env, ctx);
    const batch = batchOf(calls);
    expect(batch.binds).toHaveLength(1);
  });

  it('treats replace:0 as replace:false, not true', async () => {
    const { env, ctx, calls } = makeEnv();
    await worker.fetch(createPaymentRequest({ ...BASE, replace: 0 }), env, ctx);
    const batch = batchOf(calls);
    expect(batch.binds).toHaveLength(1);
  });

  it('binds the order id into the deactivate', async () => {
    const { env, ctx, calls } = makeEnv();
    await worker.fetch(createPaymentRequest({ ...BASE, order_id: 42 }), env, ctx);
    const batch = batchOf(calls);
    expect(batch.binds[0].binds).toEqual([42]);
  });

  it('binds the recorded fields into the insert positionally', async () => {
    const { env, ctx, calls } = makeEnv();
    await worker.fetch(
      createPaymentRequest({ ...BASE, amount: 30, method: 'cash', method_details: '{"type":"cash"}' }),
      env, ctx
    );
    const ins = batchOf(calls).binds[1].binds;
    // id, order_id, order_number, customer_name, amount, method, method_details, date
    expect(ins[0]).toBe('pay_test1');
    expect(ins[1]).toBe(1);
    expect(ins[2]).toBe('MR-1');
    expect(ins[3]).toBe('Ana');
    expect(ins[4]).toBe(30);
    expect(ins[5]).toBe('cash');
    expect(ins[6]).toBe('{"type":"cash"}');
    // BASE sends no `date`, and the handler binds `body.date || null`.
    expect(ins[7]).toBeNull();
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
    expect(event.binds[1]).toBe('jeff');
  });
});

describe('createPayment failure handling', () => {
  it('returns 400 when the batch fails, having committed nothing on its own', async () => {
    const { env, ctx, calls } = makeEnv({ batchThrows: true });
    const res = await worker.fetch(createPaymentRequest(BASE), env, ctx);
    expect(res.status).toBe(400);

    // The deactivate is a member of the batch, so a failed batch rolls the
    // whole thing back. Nothing may run outside it.
    const after = calls.slice(calls.findIndex((c) => c.method === 'batch') + 1);
    expect(after, 'no statement may follow a failed batch').toHaveLength(0);
  });

  it('never issues a standalone deactivate when the batch fails', async () => {
    const { env, ctx, calls } = makeEnv({ batchThrows: true });
    await worker.fetch(createPaymentRequest(BASE), env, ctx);
    const standalone = calls.filter(
      (c) => c.method === 'run' && /UPDATE payments SET active = 0/.test(c.sql)
    );
    expect(standalone).toHaveLength(0);
  });
});

describe('createPayment read-after-write ordering', () => {
  it('reads the ledger only after the batch has committed', async () => {
    const { env, ctx, calls } = makeEnv({ activePayments: [{ amount: 60 }] });
    await worker.fetch(createPaymentRequest(BASE), env, ctx);
    const batchIdx = calls.findIndex((c) => c.method === 'batch');
    const readIdx = calls.findIndex((c) => c.method === 'all');
    // Without this, a missing batch (batchIdx -1) would satisfy the comparison
    // below via any read at index 0 and the test would pass vacuously.
    expect(batchIdx, 'the batch must be recorded').toBeGreaterThanOrEqual(0);
    expect(readIdx, 'the ledger read must see the rows the batch just wrote').toBeGreaterThan(batchIdx);
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

  it('does not touch payment_status on a zero-total order', async () => {
    const { env, ctx, calls } = makeEnv({ totalCents: 0, activePayments: [] });
    const res = await worker.fetch(createPaymentRequest(BASE), env, ctx);
    expect(res.status).toBe(201);
    expect(sqlOf(calls)).not.toMatch(/UPDATE orders SET payment_status/);
    // The DB write is skipped but the derived values are still reported.
    const body = await res.json();
    expect(body.paymentStatus).toBe('unpaid');
    expect(body.balanceCents).toBe(0);
  });

  it('does not touch payment_status when the order no longer exists', async () => {
    const { env, ctx, calls } = makeEnv({ orderExists: false });
    const res = await worker.fetch(createPaymentRequest(BASE), env, ctx);
    expect(res.status).toBe(201);
    expect(sqlOf(calls)).not.toMatch(/UPDATE orders SET payment_status/);
  });

  it('still returns 201 when a post-commit step throws', async () => {
    // throwOnAll fails the ledger `all()` read, one of the four post-commit
    // statements; the handler must swallow a throw from any of them rather than
    // let the router answer 500 for a payment that already committed.
    // The region is wrapped precisely because the order_events insert is a real
    // FK: the cron at api.js:445 deletes awaiting_payment orders, so one can
    // vanish between the read below and that insert.
    const { env, ctx } = makeEnv({ throwOnAll: true });
    const res = await worker.fetch(createPaymentRequest(BASE), env, ctx);
    expect(res.status).toBe(201);
  });

  it('omits the derived fields when a post-commit step throws', async () => {
    const { env, ctx } = makeEnv({ throwOnAll: true });
    const res = await worker.fetch(createPaymentRequest(BASE), env, ctx);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).not.toHaveProperty('balanceCents');
    expect(body).not.toHaveProperty('paymentStatus');
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
