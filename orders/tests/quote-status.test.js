import { describe, it, expect } from 'vitest';
import worker from '../workers/api.js';

function makeEnv({ quote } = {}) {
  const calls = [];
  const db = {
    prepare(sql) {
      const stmt = {
        _sql: sql,
        _binds: [],
        bind(...args) { stmt._binds = args; return stmt; },
        async first() {
          calls.push({ sql, binds: stmt._binds, method: 'first' });
          if (/FROM cake_quotes WHERE id/.test(sql)) return quote;
          return null;
        },
        async run() {
          calls.push({ sql, binds: stmt._binds, method: 'run' });
          return { meta: { changes: 1 } };
        },
        async all() { calls.push({ sql, binds: stmt._binds, method: 'all' }); return { results: [] }; },
      };
      return stmt;
    },
    async batch(stmts) { return stmts.map(() => ({ meta: { changes: 1 } })); },
  };
  const env = { DB: db };
  const ctx = { waitUntil: (p) => { if (p && typeof p.catch === 'function') p.catch(() => {}); } };
  return { env, ctx, calls };
}

function patchQuote(body) {
  return new Request('https://orders-api.test/api/quotes/7', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'cf-access-authenticated-user-email': 'jeff@example.test',
    },
    body: JSON.stringify(body),
  });
}

const OPEN_QUOTE = { id: 7, status: 'new', customer_name: 'Ana', quoted_price: 15000 };
const sqlOf = (calls) => calls.map((c) => c.sql).join(' || ');

describe('updateQuote status validation', () => {
  it('accepts every valid status', async () => {
    for (const status of ['new', 'replied', 'converted', 'archived']) {
      const { env, ctx, calls } = makeEnv({ quote: OPEN_QUOTE });
      const res = await worker.fetch(patchQuote({ status }), env, ctx);
      expect(res.status, `status ${status} should be accepted`).toBe(200);
      expect(sqlOf(calls)).toMatch(/UPDATE cake_quotes SET status/);
    }
  });

  it('rejects an unknown status with 400 and issues no UPDATE', async () => {
    const { env, ctx, calls } = makeEnv({ quote: OPEN_QUOTE });
    const res = await worker.fetch(patchQuote({ status: 'banana' }), env, ctx);
    expect(res.status).toBe(400);
    expect(sqlOf(calls)).not.toMatch(/UPDATE cake_quotes/);
  });

  it('does not return a successful no-op for a status-only bad request', async () => {
    // The validation must run BEFORE the `sets.length === 0` early return,
    // otherwise an invalid status would be swallowed into a 200.
    const { env, ctx } = makeEnv({ quote: OPEN_QUOTE });
    const res = await worker.fetch(patchQuote({ status: 'nope' }), env, ctx);
    expect(res.status).toBe(400);
  });

  it('lists the valid statuses in the error message', async () => {
    const { env, ctx } = makeEnv({ quote: OPEN_QUOTE });
    const body = await (await worker.fetch(patchQuote({ status: 'nope' }), env, ctx)).json();
    expect(body.error).toMatch(/new/);
    expect(body.error).toMatch(/replied/);
    expect(body.error).toMatch(/converted/);
    expect(body.error).toMatch(/archived/);
  });
});

describe('updateQuote edit guard', () => {
  it('blocks a quoted_price change on a converted quote', async () => {
    const { env, ctx, calls } = makeEnv({ quote: { ...OPEN_QUOTE, status: 'converted' } });
    const res = await worker.fetch(patchQuote({ quoted_price: 1 }), env, ctx);
    expect(res.status).toBe(400);
    expect(sqlOf(calls)).not.toMatch(/UPDATE cake_quotes/);
  });

  it('blocks a quoted_price change on an archived quote', async () => {
    const { env, ctx } = makeEnv({ quote: { ...OPEN_QUOTE, status: 'archived' } });
    const res = await worker.fetch(patchQuote({ quoted_price: 1 }), env, ctx);
    expect(res.status).toBe(400);
  });

  it('still allows pricing an open quote', async () => {
    const { env, ctx, calls } = makeEnv({ quote: { ...OPEN_QUOTE, status: 'replied' } });
    const res = await worker.fetch(patchQuote({ quoted_price: 18000 }), env, ctx);
    expect(res.status).toBe(200);
    expect(sqlOf(calls)).toMatch(/quoted_price = \?/);
  });

  it('returns 404 for a quote that does not exist', async () => {
    const { env, ctx } = makeEnv({ quote: null });
    const res = await worker.fetch(patchQuote({ quoted_price: 1 }), env, ctx);
    expect(res.status).toBe(404);
  });
});
