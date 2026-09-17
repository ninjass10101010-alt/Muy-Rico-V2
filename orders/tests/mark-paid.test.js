import { describe, it, expect } from 'vitest';
import worker from '../workers/api.js';

// Minimal D1 stub: enough to exercise the mark-paid guard without a real DB.
function makeEnv({ order, secret = 's3cret' } = {}) {
  const calls = [];
  const db = {
    prepare(sql) {
      const stmt = {
        _sql: sql,
        _binds: [],
        bind(...args) { stmt._binds = args; return stmt; },
        async first() {
          calls.push({ sql, binds: stmt._binds, method: 'first' });
          if (/FROM orders WHERE id/.test(sql)) return order;
          return null;
        },
        async run() {
          calls.push({ sql, binds: stmt._binds, method: 'run' });
          return { meta: { last_row_id: 1 } };
        },
        async all() {
          calls.push({ sql, binds: stmt._binds, method: 'all' });
          return { results: [] };
        },
      };
      return stmt;
    },
  };
  const env = { DB: db, PAYMENT_WEBHOOK_SECRET: secret };
  const ctx = { waitUntil: (p) => { if (p && typeof p.catch === 'function') p.catch(() => {}); } };
  return { env, ctx, calls };
}

function markPaidRequest(body, secret) {
  return new Request('https://orders-api.test/api/orders/1/mark-paid', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { 'X-Webhook-Secret': secret } : {}),
    },
    body: JSON.stringify(body),
  });
}

const ORDER = { id: 1, total_cents: 6000, payment_status: 'unpaid', status: 'awaiting_payment', customer_name: 'Test' };

describe('mark-paid guard', () => {
  it('rejects a missing/incorrect webhook secret with 401', async () => {
    const { env, ctx } = makeEnv({ order: ORDER });
    const res = await worker.fetch(markPaidRequest({ method: 'stripe' }, 'wrong'), env, ctx);
    expect(res.status).toBe(401);
  });

  it('refuses to mark paid when the settled amount is less than the order total', async () => {
    const { env, ctx, calls } = makeEnv({ order: ORDER });
    const res = await worker.fetch(
      markPaidRequest({ method: 'stripe', amount_cents: 1 }, 's3cret'),
      env, ctx
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/amount/i);
    // The order must NOT have been flipped to paid.
    expect(calls.some((c) => /UPDATE orders SET payment_status/.test(c.sql))).toBe(false);
    // The mismatch is recorded as an event for review.
    expect(calls.some((c) => c.sql.includes('order_events') && String(c.binds?.[2] || '').includes('mismatch'))).toBe(true);
  });

  it('refuses a larger-than-total amount too (exact match required)', async () => {
    const { env, ctx, calls } = makeEnv({ order: ORDER });
    const res = await worker.fetch(
      markPaidRequest({ method: 'stripe', amount_cents: 9999 }, 's3cret'),
      env, ctx
    );
    expect(res.status).toBe(409);
    expect(calls.some((c) => /UPDATE orders SET payment_status/.test(c.sql))).toBe(false);
  });

  it('marks paid when the settled amount matches the order total', async () => {
    const { env, ctx, calls } = makeEnv({ order: ORDER });
    const res = await worker.fetch(
      markPaidRequest({ method: 'stripe', amount_cents: 6000 }, 's3cret'),
      env, ctx
    );
    expect(res.status).toBe(200);
    expect(calls.some((c) => /UPDATE orders SET payment_status/.test(c.sql))).toBe(true);
  });
});

describe('public website order creation', () => {
  function createRequest(body) {
    return new Request('https://orders-api.test/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('forces unpaid / awaiting_payment even if the client claims it is paid', async () => {
    const { env, ctx, calls } = makeEnv({ order: null });
    const res = await worker.fetch(createRequest({
      customer_name: 'Attacker',
      pickup_date: '2099-01-01',
      items_json: [{ name: 'Custom Cake', qty: 1, price: 0.01 }],
      payment_method: 'stripe',
      payment_status: 'paid',
      status: 'pending',
      source: 'website',
      total_cents: 1,
    }), env, ctx);

    expect(res.status).toBe(201);
    const insert = calls.find((c) => /INSERT INTO orders/.test(c.sql));
    expect(insert).toBeTruthy();
    // binds: [name, customer_id, phone, email, pickup_date, pickup_time, items,
    //         total, subtotal, discount, payment_method, payment_status, status, ...]
    expect(insert.binds[11]).toBe('unpaid');
    expect(insert.binds[12]).toBe('awaiting_payment');
  });
});
