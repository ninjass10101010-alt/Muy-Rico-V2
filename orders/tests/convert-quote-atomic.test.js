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
      // Distinct ids per statement: a shared id would let the order_id
      // assertion pass whichever result the code read.
      return stmts.map((_, i) => ({ meta: { changes: 1, last_row_id: 100 + i } }));
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

    // D1 only rejects a mismatched bind count at runtime, and a dropped
    // argument silently shifts every later value in the same statement.
    for (const stmt of batch.binds) {
      const placeholders = (stmt.sql.match(/\?/g) || []).length;
      expect(placeholders, `bind/placeholder mismatch in: ${stmt.sql}`).toBe(stmt.binds.length);
    }
  });

  it('still returns an order id to the caller', async () => {
    const { env, ctx } = makeEnv();
    const res = await worker.fetch(depositRequest(), env, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.order_id).toBe(100);
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

  it('rethrows a payments.id unique violation instead of reporting a lost race', async () => {
    // payments.id is a TEXT PRIMARY KEY and statement 2 inserts a generated
    // payId. Treated as a lost race, a rolled-back batch would answer 2xx with
    // order_id: null — the deposit is already claimed on the quote, so the
    // money would sit with no order, no payment row, and no retry.
    const { env, ctx, calls } = makeEnv({
      winner: { converted_order_id: null },
      batchError: new Error('D1_ERROR: UNIQUE constraint failed: payments.id'),
    });
    const res = await worker.fetch(depositRequest(), env, ctx);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.order_id, 'nothing was committed, so no order id may be reported').toBeUndefined();
    expect(
      calls.find((c) => c.method === 'first' && /SELECT converted_order_id/.test(c.sql)),
      'a rolled-back batch must not be treated as a lost race'
    ).toBeFalsy();
  });
});

/**
 * The admin convert endpoint is the second consumer of the `already` flag, and
 * it had none: it destructured only { orderId, paymentStatus } and answered 201
 * { payment_status: null }. QuoteConvertModal renders
 * `paymentStatus === "paid" ? "Full" : "Partial"`, so a lost race showed the
 * owner a green success screen reading "Partial payment of $X via Y" for an
 * order they did not create, and handed the winner's order id to onDone.
 */
describe('convertQuote (admin) lost conversion race', () => {
  const adminRequest = (body) =>
    new Request('https://orders-api.test/api/quotes/18/convert', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cf-access-authenticated-user-email': 'jeff@example.test',
      },
      body: JSON.stringify(body),
    });

  const convertRequest = () =>
    adminRequest({ deposit_amount_cents: 7500, payment_method: 'cash' });

  it('answers 201 with a payment status when this caller wins', async () => {
    const { env, ctx } = makeEnv();
    const res = await worker.fetch(convertRequest(), env, ctx);

    expect(res.status).toBe(201);
    const body = await res.json();
    // 7500 of a 15000 quote: a deposit was taken, so a balance is outstanding.
    expect(body.payment_status).toBe('partial');
    expect(body.already).toBeUndefined();
  });

  it('answers 200 already:true and no payment status when it loses the race', async () => {
    const { env, calls } = makeEnv({
      winner: { converted_order_id: 77 },
      batchError: new Error('D1_ERROR: UNIQUE constraint failed: orders.quote_id'),
    });
    const waited = [];
    const ctx = { waitUntil: (p) => { waited.push(p); } };
    const res = await worker.fetch(convertRequest(), env, ctx);

    // Not 201: nothing was created here. The invoice callers already use this
    // exact shape for the same event.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.already).toBe(true);
    expect(body.order_id, 'the owner is pointed at the order that does exist').toBe(77);
    // The absent field, not a null one: the dashboard's "Full"/"Partial" ternary
    // has nothing to render, and a status that reads like a real one is what
    // made this screen lie.
    expect(body, 'a loser has no payment status of its own to report').not.toHaveProperty('payment_status');
    expect(waited, 'a loser must not announce a conversion that did not happen').toHaveLength(0);
    expect(batchOf(calls).binds, 'no second order is written on the loser path').toHaveLength(4);
  });

  it('rejects a quote that already produced an order, whatever its status says', async () => {
    // The status check alone is not a guard: updateQuote pushes `status = ?`
    // unconditionally and the Quotes tab's unarchive sends status:'new' after
    // any reload, so a converted quote can be downgraded to 'new' and converted
    // a second time. converted_order_id is the fact that cannot be rewritten.
    const { env, ctx, calls } = makeEnv({
      quote: { ...QUOTE, status: 'new', converted_order_id: 61 },
    });
    const res = await worker.fetch(convertRequest(), env, ctx);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/already converted to order 61/);
    expect(batchOf(calls), 'a rejected conversion must create nothing').toBeUndefined();
  });

  it('still converts a quote whose status was flipped but that produced no order', async () => {
    // The new guard keys on converted_order_id, not on status — a quote that
    // was never converted must not be caught by it.
    const { env, ctx } = makeEnv({ quote: { ...QUOTE, status: 'replied' } });
    const res = await worker.fetch(convertRequest(), env, ctx);
    expect(res.status).toBe(201);
  });
});
