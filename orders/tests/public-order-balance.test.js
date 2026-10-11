import { describe, it, expect } from 'vitest';
import worker from '../workers/api.js';

const ORDER = {
  id: 65, customer_name: 'Stacy Stout', email: 'stacy@example.com', language: 'en',
  status: 'pending', pickup_date: '2026-10-07', pay_token: 'a'.repeat(32),
  total_cents: 8000, subtotal_cents: 12000, discount_cents: 4000,
  items_json: JSON.stringify([{ name: 'Lemon Cupcake ×24', name_en: 'Lemon Cupcake ×24', qty: 1, price: 40 }]),
  payment_method: 'stripe', payment_sub_method: null, payment_status: 'partial',
};

function makeEnv({ order = ORDER, payments = [] } = {}) {
  const db = {
    prepare(sql) {
      const stmt = {
        _sql: sql, _binds: [],
        bind(...args) { stmt._binds = args; return stmt; },
        async first() { if (/FROM orders WHERE id = \?/.test(sql)) return order; return null; },
        async run() { return { meta: { changes: 1 } }; },
        async all() {
          if (/FROM payments WHERE order_id = \? AND active = 1/.test(sql)) return { results: payments };
          return { results: [] };
        },
      };
      return stmt;
    },
  };
  return { env: { DB: db } };
}

const get = (path) => new Request(`http://localhost${path}`);

describe('GET /api/public/orders/:id/balance', () => {
  it('returns the payable payload for the right token', async () => {
    const { env } = makeEnv({ payments: [{ amount: 60, method: 'stripe', method_details: null, date: '2026-10-06 00:05:04' }] });
    const res = await worker.fetch(get(`/api/public/orders/65/balance?t=${'a'.repeat(32)}`), env, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      orderId: 65, customerName: 'Stacy Stout', totalCents: 8000, paidCents: 6000,
      balanceCents: 2000, paid: false, language: 'en',
    });
    expect(body.payments[0]).toMatchObject({ date: '2026-10-06', amountCents: 6000 });
    expect(body.items[0].name).toBe('Lemon Cupcake ×24');
  });

  it('rejects missing or wrong tokens', async () => {
    const { env } = makeEnv();
    expect((await worker.fetch(get('/api/public/orders/65/balance'), env, {})).status).toBe(404);
    expect((await worker.fetch(get('/api/public/orders/65/balance?t=wrong'), env, {})).status).toBe(404);
  });

  it('reports a cancelled order as not payable', async () => {
    const { env } = makeEnv({ order: { ...ORDER, status: 'cancelled' } });
    const res = await worker.fetch(get(`/api/public/orders/65/balance?t=${'a'.repeat(32)}`), env, {});
    expect(res.status).toBe(409);
  });
});
