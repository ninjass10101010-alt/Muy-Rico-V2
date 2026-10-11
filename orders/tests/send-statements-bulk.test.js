import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../workers/api.js';

const CANDIDATES = [
  { id: 1, status: 'pending', email: 'a@x.com', pickup_date: '2026-10-01', total_cents: 5000, customer_name: 'A', language: 'en', items_json: '[]' },
  { id: 2, status: 'completed', email: 'b@x.com', pickup_date: '2026-10-01', total_cents: 3000, customer_name: 'B', language: 'es', items_json: '[]' },
];

function makeEnv({ payments = [], sent = [] } = {}) {
  const calls = [];
  const db = {
    prepare(sql) {
      const stmt = {
        _sql: sql, _binds: [],
        bind(...args) { stmt._binds = args; return stmt; },
        async first() {
          calls.push({ sql, binds: stmt._binds, method: 'first' });
          if (/FROM orders WHERE id = \?/.test(sql)) return CANDIDATES.find((o) => o.id === stmt._binds[0]) || null;
          if (/SELECT pay_token FROM orders/.test(sql)) return { pay_token: 'tok' };
          if (/MAX\(created_at\)/.test(sql)) return { last_sent_at: null };
          return null;
        },
        async run() { calls.push({ sql, binds: stmt._binds, method: 'run' }); return { meta: { changes: 1 } }; },
        async all() {
          calls.push({ sql, binds: stmt._binds, method: 'all' });
          if (/FROM orders WHERE status != 'cancelled'/.test(sql)) return { results: CANDIDATES };
          if (/FROM payments WHERE active = 1 AND order_id IN/.test(sql)) return { results: payments };
          if (/FROM order_statements/.test(sql)) return { results: sent };
          if (/FROM payments WHERE order_id = \?/.test(sql)) {
            return { results: payments.filter((p) => p.order_id === stmt._binds[0]) };
          }
          return { results: [] };
        },
      };
      return stmt;
    },
  };
  return { env: { DB: db, RESEND_API_KEY: 're_test' }, calls };
}

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/orders/send-statements', () => {
  it('sends to eligible orders and skips recently reminded ones', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ id: 'm' }) })));
    const { env } = makeEnv({
      payments: [{ order_id: 1, amount: 20 }, { order_id: 2, amount: 10 }],
      sent: [{ order_id: 2, last_sent_at: new Date().toISOString().slice(0, 19).replace('T', ' ') }],
    });
    const res = await worker.fetch(
      new Request('http://localhost/api/orders/send-statements', { method: 'POST' }),
      env, {}
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(1);
    expect(body.skipped.recent).toBe(1);
    expect(body.results).toEqual([{ orderId: 1, outcome: 'sent' }]);
  });
});
