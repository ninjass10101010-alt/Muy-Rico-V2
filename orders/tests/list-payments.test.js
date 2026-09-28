import { describe, it, expect } from 'vitest';
import worker from '../workers/api.js';

const PAYMENTS = [
  { id: 'pay_1', order_id: 1, amount: 60, method: 'cash', active: 1 },
  { id: 'pay_2', order_id: 1, amount: 1.3, method: 'cash', active: 0 },
];

/**
 * Restore reads three things the deactivate never did: the payment's own
 * order_id, the order's total, and that order's ACTIVE payments. The stub
 * dispatches on SQL so restore is exercised through the same
 * prepare/bind/first/all surface deletePayment already uses, and so every
 * pre-existing assertion keeps seeing the rows it saw before — the fallbacks
 * below are the original unconditional `null` / `PAYMENTS` answers.
 */
function makeEnv({ payment = null, order = null, activeRows = [], changes = 1 } = {}) {
  const calls = [];
  const db = {
    prepare(sql) {
      const stmt = {
        _sql: sql,
        _binds: [],
        bind(...args) { stmt._binds = args; return stmt; },
        async first() {
          calls.push({ sql, binds: stmt._binds, method: 'first' });
          if (/SELECT order_id FROM payments/.test(sql)) return payment;
          if (/SELECT total_cents FROM orders/.test(sql)) return order;
          return null;
        },
        async run() {
          calls.push({ sql, binds: stmt._binds, method: 'run' });
          return { meta: { changes } };
        },
        async all() {
          calls.push({ sql, binds: stmt._binds, method: 'all' });
          if (/SELECT amount FROM payments/.test(sql)) return { results: activeRows };
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

const restore = (id) =>
  new Request(`https://orders-api.test/api/payments/${id}/restore`, {
    method: 'POST',
    headers: authHeaders,
  });

// The write that makes an order's cached status agree with the ledger again.
const statusWrite = (calls) =>
  calls.find((c) => /UPDATE orders SET payment_status/.test(c.sql));

describe('POST /api/payments/:id/restore', () => {
  it('reactivates a voided payment by id', async () => {
    const { env, ctx, calls } = makeEnv();
    const res = await worker.fetch(restore('pay_2'), env, ctx);
    expect(res.status).toBe(200);
    const update = calls.find((c) => /UPDATE payments SET active = 1 WHERE id/.test(c.sql));
    expect(update).toBeTruthy();
    expect(update.binds).toContain('pay_2');
  });

  it('is not the deactivate wearing a different verb', async () => {
    // A voided payment is unrecoverable from the app unless this route really
    // sets active = 1. Collapse the two statements and the Restore button
    // silently becomes a no-op again, which is exactly how it shipped.
    const { env, ctx, calls } = makeEnv();
    await worker.fetch(
      new Request('https://orders-api.test/api/payments/pay_1', { method: 'DELETE', headers: authHeaders }),
      env, ctx
    );
    expect(calls.some((c) => /SET active = 1/.test(c.sql))).toBe(false);

    const restored = makeEnv();
    await worker.fetch(restore('pay_1'), restored.env, restored.ctx);
    expect(restored.calls.some((c) => /SET active = 0/.test(c.sql))).toBe(false);
  });

  it('404s when no payment row changed', async () => {
    const { env, ctx, calls } = makeEnv({ changes: 0 });
    const res = await worker.fetch(restore('pay_nope'), env, ctx);
    expect(res.status).toBe(404);
    // The router's own fallback answers an unrouted path with the same body and
    // status (api.js:440), so assert the statement was issued: a 404 from a
    // route that does not exist would otherwise satisfy this test.
    expect(calls.some((c) => /UPDATE payments SET active = 1 WHERE id/.test(c.sql))).toBe(true);
    // Nothing was restored, so there is no new ledger sum to derive against.
    expect(statusWrite(calls)).toBeUndefined();
  });

  it('re-derives the order payment_status from the active payments', async () => {
    // $60.00 order, only $1.30 of it active once the row is restored: partial.
    const { env, ctx, calls } = makeEnv({
      payment: { id: 'pay_2', order_id: 1 },
      order: { total_cents: 6000 },
      activeRows: [{ amount: 1.3 }],
    });
    const res = await worker.fetch(restore('pay_2'), env, ctx);
    expect(res.status).toBe(200);

    const write = statusWrite(calls);
    expect(write).toBeTruthy();
    expect(write.binds).toEqual(['partial', 1]);
  });

  it('leaves payment_status alone when the order total is zero', async () => {
    // createPayment's convention: a 100%-discount order must not be parked at a
    // derived 'unpaid' with a $0.00 balance, so the write is guarded.
    const { env, ctx, calls } = makeEnv({
      payment: { id: 'pay_2', order_id: 1 },
      order: { total_cents: 0 },
      activeRows: [{ amount: 0 }],
    });
    await worker.fetch(restore('pay_2'), env, ctx);
    // The row was restored and the ledger read — the guard, not a short
    // circuit, is what withholds the write.
    expect(calls.some((c) => /UPDATE payments SET active = 1 WHERE id/.test(c.sql))).toBe(true);
    expect(calls.some((c) => /SELECT total_cents FROM orders/.test(c.sql))).toBe(true);
    expect(statusWrite(calls)).toBeUndefined();
  });

  it('writes an order_events row so the restore is auditable', async () => {
    const { env, ctx, calls } = makeEnv({
      payment: { id: 'pay_2', order_id: 1 },
      order: { total_cents: 6000 },
      activeRows: [{ amount: 1.3 }],
    });
    await worker.fetch(restore('pay_2'), env, ctx);
    const event = calls.find((c) => /INSERT INTO order_events/.test(c.sql));
    expect(event).toBeTruthy();
    expect(event.binds[0]).toBe(1);
    // actorName is the local part of the authenticated email (api.js:140).
    expect(event.binds[1]).toBe('jeff');
    expect(event.sql).toMatch(/order:payment_restored/);
  });

  it('does not derive a status for an orphan payment', async () => {
    // order_id is NULL, so there is no order to write a status to — and
    // order_events.order_id is NOT NULL (migrations/0001_initial.sql:29).
    const { env, ctx, calls } = makeEnv({ payment: { id: 'pay_3', order_id: null } });
    const res = await worker.fetch(restore('pay_3'), env, ctx);
    expect(res.status).toBe(200);
    expect(calls.some((c) => /UPDATE payments SET active = 1 WHERE id/.test(c.sql))).toBe(true);
    expect(statusWrite(calls)).toBeUndefined();
    expect(calls.some((c) => /INSERT INTO order_events/.test(c.sql))).toBe(false);
  });
});
