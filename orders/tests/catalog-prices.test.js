import { describe, it, expect } from 'vitest';
import worker from '../workers/api.js';

function makeEnv({ products = [], enforce = true } = {}) {
  const db = {
    prepare(sql) {
      const stmt = {
        _sql: sql,
        bind() { return stmt; },
        async first() { return null; },
        async run() { return { meta: { last_row_id: 1 } }; },
        async all() {
          if (/FROM products WHERE id IN/.test(sql)) return { results: products };
          return { results: [] };
        },
      };
      return stmt;
    },
  };
  const env = { DB: db };
  if (enforce) env.ENFORCE_CATALOG_PRICES = '1';
  return env;
}
const ctx = { waitUntil: () => {} };

const orderReq = (items) => new Request('https://orders-api.test/api/orders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    customer_name: 'Test',
    pickup_date: '2099-01-01',
    items_json: items,
    payment_method: 'stripe',
    source: 'website',
  }),
});

const CONCHAS = {
  id: 'prod_conchas',
  name: 'Conchas',
  price: 4,
  active: 1,
  pack_sizes: JSON.stringify([
    { id: '4-pack', qty: 4, price: 16 },
    { id: 'dozen', qty: 12, price: 40 },
  ]),
};

describe('catalog price enforcement', () => {
  it('rejects an item priced below the catalog', async () => {
    const env = makeEnv({ products: [CONCHAS] });
    const res = await worker.fetch(orderReq([{ name: 'Conchas', productId: 'prod_conchas', qty: 1, price: 0.01 }]), env, ctx);
    expect(res.status).toBe(409);
  });

  it('accepts the base unit price', async () => {
    const env = makeEnv({ products: [CONCHAS] });
    const res = await worker.fetch(orderReq([{ name: 'Conchas', productId: 'prod_conchas', qty: 1, price: 4 }]), env, ctx);
    expect(res.status).toBe(201);
  });

  it('accepts a pack price', async () => {
    const env = makeEnv({ products: [CONCHAS] });
    const res = await worker.fetch(orderReq([{ name: 'Conchas', productId: 'prod_conchas', qty: 1, price: 16 }]), env, ctx);
    expect(res.status).toBe(201);
  });

  it('does not reject items whose product is unknown (e.g. bundles)', async () => {
    const env = makeEnv({ products: [CONCHAS] });
    const res = await worker.fetch(orderReq([{ name: 'Bundle', productId: 'not_in_catalog', qty: 1, price: 123 }]), env, ctx);
    expect(res.status).toBe(201);
  });

  it('is inert when ENFORCE_CATALOG_PRICES is not set', async () => {
    const env = makeEnv({ products: [CONCHAS], enforce: false });
    const res = await worker.fetch(orderReq([{ name: 'Conchas', productId: 'prod_conchas', qty: 1, price: 0.01 }]), env, ctx);
    expect(res.status).toBe(201);
  });
});
