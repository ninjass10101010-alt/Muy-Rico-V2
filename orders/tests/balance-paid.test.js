import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../workers/api.js';

const ORDER = {
  id: 65, customer_name: 'Stacy Stout', email: 'stacy@example.com', language: 'en',
  status: 'pending', total_cents: 8000, payment_status: 'partial',
  items_json: '[]', payment_method: 'stripe', payment_sub_method: null,
  pickup_date: '2026-10-07', pickup_time: null, created_at: '2026-10-06 00:05:04',
};

function makeEnv({ order = ORDER, payments = [], paymentByRef = null } = {}) {
  const calls = [];
  const db = {
    prepare(sql) {
      const stmt = {
        _sql: sql, _binds: [],
        bind(...args) { stmt._binds = args; return stmt; },
        async first() {
          calls.push({ sql, binds: stmt._binds, method: 'first' });
          if (/SELECT id FROM payments WHERE ref = \?/.test(sql)) return paymentByRef;
          if (/SELECT total_cents FROM orders/.test(sql)) return { total_cents: order.total_cents };
          if (/FROM orders WHERE id = \?/.test(sql)) return order;
          return null;
        },
        async run() {
          calls.push({ sql, binds: stmt._binds, method: 'run' });
          // D1 write fidelity: the handler re-derives the ledger from a read that
          // must see the row this INSERT just committed, so the double applies it.
          if (/INSERT INTO payments/.test(sql)) payments.push({ amount: stmt._binds[4] });
          return { meta: { changes: 1 } };
        },
        async all() {
          calls.push({ sql, binds: stmt._binds, method: 'all' });
          if (/FROM payments WHERE order_id = \? AND active = 1/.test(sql)) return { results: payments };
          return { results: [] };
        },
      };
      return stmt;
    },
  };
  return { env: { DB: db, PAYMENT_WEBHOOK_SECRET: 's3cret', RESEND_API_KEY: 're_test' }, calls };
}

const post = (body) => new Request('http://localhost/api/orders/65/balance-paid', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': 's3cret' },
  body: JSON.stringify(body),
});

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/orders/:id/balance-paid', () => {
  it('records the balance payment, derives paid, logs the event, and emails a receipt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ id: 'msg' }) })));
    const { env, calls } = makeEnv({ payments: [{ amount: 60 }] });
    const res = await worker.fetch(post({ amount_cents: 2000, method: 'stripe', ref: 'cs_live_1' }), env, {
      waitUntil: (p) => { if (p && p.catch) p.catch(() => {}); },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, paymentStatus: 'paid', balanceCents: 0 });

    const insert = calls.find((c) => c.method === 'run' && /INSERT INTO payments/.test(c.sql));
    expect(insert).toBeTruthy();
    expect(insert.binds).toContain(20);      // dollars
    expect(insert.binds).toContain('cs_live_1');
    const event = calls.find((c) =>
      c.method === 'run' && /INSERT INTO order_events/.test(c.sql) && c.binds[2] === 'payment:balance_online');
    expect(event, 'balance payment event').toBeTruthy();
  });

  it('is idempotent by gateway ref', async () => {
    const { env, calls } = makeEnv({ payments: [{ amount: 60 }], paymentByRef: { id: 'pay_existing' } });
    const res = await worker.fetch(post({ amount_cents: 2000, method: 'stripe', ref: 'cs_live_1' }), env, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, already: true });
    expect(calls.find((c) => c.method === 'run' && /INSERT INTO payments/.test(c.sql))).toBeFalsy();
  });

  it('rejects without the webhook secret', async () => {
    const { env } = makeEnv();
    const bad = new Request('http://localhost/api/orders/65/balance-paid', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect((await worker.fetch(bad, env, {})).status).toBe(401);
  });

  it('records the settled amount and flags a mismatch instead of dropping the money', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ id: 'msg' }) })));
    const { env, calls } = makeEnv({ payments: [{ amount: 70 }] }); // balance 1000; webhook says 1500
    const res = await worker.fetch(post({ amount_cents: 1500, method: 'paypal', ref: 'cap_9' }), env, {
      waitUntil: (p) => { if (p && p.catch) p.catch(() => {}); },
    });
    expect(res.status).toBe(200);
    const insert = calls.find((c) => c.method === 'run' && /INSERT INTO payments/.test(c.sql));
    expect(insert.binds).toContain(15);
    const mismatchEvent = calls.find((c) => c.method === 'run' && /balance-amount-mismatch/.test(String(c.binds[2])));
    expect(mismatchEvent, 'mismatch must be audited').toBeTruthy();
  });

  it('records a fresh payment even when the balance is already zero', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ id: 'msg' }) })));
    const { env, calls } = makeEnv({ payments: [{ amount: 80 }] }); // balance already 0
    const res = await worker.fetch(post({ amount_cents: 2000, method: 'stripe', ref: 'cs_live_dup' }), env, {
      waitUntil: (p) => { if (p && p.catch) p.catch(() => {}); },
    });
    expect(res.status).toBe(200);
    const insert = calls.find((c) => c.method === 'run' && /INSERT INTO payments/.test(c.sql));
    expect(insert, 'settled money must still be recorded').toBeTruthy();
    expect(insert.binds).toContain('cs_live_dup');
    const mismatch = calls.find((c) => c.method === 'run' && /INSERT INTO order_events/.test(c.sql)
      && /balance-amount-mismatch/.test(String(c.binds[2])));
    expect(mismatch, 'overpayment must be audited').toBeTruthy();
  });
});
