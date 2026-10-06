import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../workers/api.js';

function makeEnv({ ordersById = {}, missingRows = [], secret = 's3cret' } = {}) {
  const calls = [];
  const db = {
    prepare(sql) {
      const stmt = {
        _sql: sql,
        _binds: [],
        bind(...args) { stmt._binds = args; return stmt; },
        async first() {
          calls.push({ sql, binds: stmt._binds, method: 'first' });
          if (/FROM orders WHERE id = \?/.test(sql)) return ordersById[stmt._binds[0]] ?? null;
          return null;
        },
        async run() {
          calls.push({ sql, binds: stmt._binds, method: 'run' });
          return { meta: { last_row_id: 1, changes: 1 } };
        },
        async all() {
          calls.push({ sql, binds: stmt._binds, method: 'all' });
          if (/FROM orders o/.test(sql)) return { results: missingRows };
          return { results: [] };
        },
      };
      return stmt;
    },
  };
  return { env: { DB: db, RESEND_API_KEY: 're_test' }, calls };
}

function authedRequest(path, { method = 'GET', body } = {}) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

afterEach(() => vi.unstubAllGlobals());

const GOOD_ORDER = {
  id: 7, customer_name: 'Ana', email: 'ana@example.com', language: 'es',
  items_json: '[]', total_cents: 1000, payment_method: 'cash', payment_sub_method: null,
  status: 'completed', payment_status: 'paid',
};

describe('GET /api/orders/missing-receipts', () => {
  it('returns candidate orders with attempt metadata', async () => {
    const { env } = makeEnv({ missingRows: [{ id: 7, customer_name: 'Ana', email: 'ana@example.com', receipt_attempts: 1, last_receipt_status: 'failed' }] });
    const res = await worker.fetch(authedRequest('/api/orders/missing-receipts'), env, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.orders).toHaveLength(1);
    expect(body.orders[0].receipt_attempts).toBe(1);
  });

  it('filters to orders with an email and no sent receipt', async () => {
    const { env, calls } = makeEnv({});
    await worker.fetch(authedRequest('/api/orders/missing-receipts'), env, {});
    const list = calls.find((c) => /FROM orders o/.test(c.sql));
    expect(list.sql).toContain("TRIM(COALESCE(o.email, '')) != ''");
    expect(list.sql).toContain("r.status = 'sent'");
  });
});

describe('POST /api/orders/send-receipts', () => {
  it('rejects empty, oversized, non-integer id lists and bad language', async () => {
    const { env } = makeEnv({});
    for (const body of [{ ids: [] }, { ids: [1, 2], language: 'fr' }]) {
      const res = await worker.fetch(authedRequest('/api/orders/send-receipts', { method: 'POST', body }), env, {});
      expect(res.status).toBe(400);
    }
    const tooMany = { ids: Array.from({ length: 26 }, (_, i) => i + 1) };
    const res = await worker.fetch(authedRequest('/api/orders/send-receipts', { method: 'POST', body: tooMany }), env, {});
    expect(res.status).toBe(400);
    const badId = await worker.fetch(authedRequest('/api/orders/send-receipts', { method: 'POST', body: { ids: ['x'] } }), env, {});
    expect(badId.status).toBe(400);
  });

  it('sends, logs a sent receipt, and writes the generated event', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'msg_1' }) }));
    vi.stubGlobal('fetch', fetchMock);
    const { env, calls } = makeEnv({ ordersById: { 7: GOOD_ORDER } });
    const res = await worker.fetch(authedRequest('/api/orders/send-receipts', { method: 'POST', body: { ids: [7] } }), env, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ sent: 1, failed: 0, skipped: 0 });
    expect(body.results[0]).toMatchObject({ id: 7, ok: true, status: 'sent', messageId: 'msg_1' });
    const insert = calls.find((c) => /INSERT INTO receipts/.test(c.sql));
    expect(insert).toBeTruthy();
    expect(insert.binds.at(-1)).toBe('es');
    expect(calls.some((c) => c.sql.includes('order_events') && c.binds[2] === 'receipt:generated')).toBe(true);
  });

  it('honors the language override on the logged receipt row', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ id: 'msg_2' }) })));
    const { env, calls } = makeEnv({ ordersById: { 7: GOOD_ORDER } });
    await worker.fetch(authedRequest('/api/orders/send-receipts', { method: 'POST', body: { ids: [7], language: 'en' } }), env, {});
    const insert = calls.find((c) => /INSERT INTO receipts/.test(c.sql));
    expect(insert.binds.at(-1)).toBe('en');
  });

  it('skips orders with no email or no order row, and reports failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, text: async () => 'nope' })));
    const { env, calls } = makeEnv({
      ordersById: { 7: { ...GOOD_ORDER, email: null }, 8: GOOD_ORDER },
    });
    const res = await worker.fetch(
      authedRequest('/api/orders/send-receipts', { method: 'POST', body: { ids: [7, 8, 999] } }),
      env, {}
    );
    const body = await res.json();
    expect(body.skipped).toBe(2);
    expect(body.failed).toBe(1);
    const statuses = Object.fromEntries(body.results.map((r) => [r.id, r.status]));
    expect(statuses[7]).toBe('skipped');
    expect(statuses[999]).toBe('skipped');
    expect(statuses[8]).toBe('failed');
    expect(calls.some((c) => c.sql.includes('order_events') && c.binds?.[2] === 'receipt:generated')).toBe(true);
  });
});
