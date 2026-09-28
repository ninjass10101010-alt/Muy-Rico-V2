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
