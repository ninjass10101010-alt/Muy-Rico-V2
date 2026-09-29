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

function makeEnv({ quote = QUOTE, winner = null, batchError = null } = {}) {
  const calls = [];
  const db = {
    prepare(sql) {
      const stmt = {
        _sql: sql,
        _binds: [],
        bind(...args) { stmt._binds = args; return stmt; },
        async first() {
          calls.push({ sql, binds: stmt._binds, method: 'first' });
          // The loser's winner-lookup is a *fresh* read issued after the race;
          // its pre-conversion snapshot of the same row is still status 'new'.
          if (/SELECT converted_order_id FROM cake_quotes/.test(sql)) return winner;
          if (/FROM cake_quotes WHERE id/.test(sql)) return quote;
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
      if (batchError) throw batchError;
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

const batchOf = (calls) => calls.find((c) => c.method === 'batch');

describe('convertQuoteToOrder atomicity', () => {
  it('commits the order, payment, event and quote update as one batch', async () => {
    const { env, ctx, calls } = makeEnv();
    await worker.fetch(depositRequest(), env, ctx);

    const batch = batchOf(calls);
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

  it('puts the order insert first in the batch, since the id comes from results[0]', async () => {
    const { env, ctx, calls } = makeEnv();
    await worker.fetch(depositRequest(), env, ctx);
    const batch = batchOf(calls);
    expect(batch.binds[0].sql).toMatch(/INSERT INTO orders/);
  });

  it('correlates the dependent inserts on quote_id, never on a rowid', async () => {
    const { env, ctx, calls } = makeEnv();
    await worker.fetch(depositRequest(), env, ctx);
    const batch = batchOf(calls);

    // The dependent statements find the order through the unique quote_id index.
    // bf19876 exists because last_insert_rowid() inside a batch drifted and
    // silently linked rows to the wrong parent.
    const [order, payment, event, quoteUpdate] = batch.binds;

    // The order insert carries the quote id in its own column.
    expect(order.sql).toMatch(/quote_id/);
    expect(order.binds, 'the quote id must be bound, never inlined').toContain(18);

    expect(payment.sql).toMatch(/FROM orders WHERE quote_id = \?/);
    expect(event.sql).toMatch(/FROM orders WHERE quote_id = \?/);
    expect(quoteUpdate.sql).toMatch(/converted_order_id = \(SELECT id FROM orders WHERE quote_id = \?\)/);
    expect(quoteUpdate.binds.filter((b) => b === 18), 'bound twice: once for the lookup, once for WHERE id').toHaveLength(2);

    for (const stmt of [payment, event, quoteUpdate]) {
      expect(stmt.binds, 'the quote id must be bound, never inlined').toContain(18);
    }
  });

  it('still returns an order id to the caller', async () => {
    const { env, ctx } = makeEnv();
    const res = await worker.fetch(depositRequest(), env, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.order_id).toBe(99);
  });

  it('returns the winner order id when a concurrent convert wins the quote_id race', async () => {
    const { env, ctx, calls } = makeEnv({
      winner: { converted_order_id: 77 },
      batchError: new Error('D1_ERROR: UNIQUE constraint failed: orders.quote_id'),
    });
    const res = await worker.fetch(depositRequest(), env, ctx);

    expect(res.status, 'a lost race is not a server error').toBe(200);
    const body = await res.json();
    expect(body.order_id, 'the caller must learn the winning order, not a duplicate').toBe(77);

    // The winner's order is read back, not re-inserted.
    const lookup = calls.find(
      (c) => c.method === 'first' && /SELECT converted_order_id FROM cake_quotes/.test(c.sql)
    );
    expect(lookup, 'the loser must read the winning order id').toBeTruthy();
    expect(batchOf(calls).binds, 'no partial re-write of a second order').toHaveLength(4);
  });

  it('rethrows a batch failure that is not the quote_id unique violation', async () => {
    const { env, ctx } = makeEnv({
      batchError: new Error('D1_ERROR: something else broke'),
    });
    const res = await worker.fetch(depositRequest(), env, ctx);
    expect(res.status).toBe(500);
  });
});
