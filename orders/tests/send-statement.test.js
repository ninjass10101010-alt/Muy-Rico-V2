import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../workers/api.js';

function makeEnv({ order = null, payments = [], statementRow = null } = {}) {
  const calls = [];
  const db = {
    prepare(sql) {
      const stmt = {
        _sql: sql,
        _binds: [],
        bind(...args) { stmt._binds = args; return stmt; },
        async first() {
          calls.push({ sql, binds: stmt._binds, method: 'first' });
          if (/FROM orders WHERE id = \?/.test(sql)) return order;
          if (/SELECT pay_token FROM orders/.test(sql)) return { pay_token: 'tok65' };
          if (/MAX\(created_at\)/.test(sql)) return statementRow;
          return null;
        },
        async run() { calls.push({ sql, binds: stmt._binds, method: 'run' }); return { meta: { changes: 1 } }; },
        async all() {
          calls.push({ sql, binds: stmt._binds, method: 'all' });
          if (/FROM payments WHERE order_id = \? AND active = 1/.test(sql)) return { results: payments };
          return { results: [] };
        },
      };
      return stmt;
    },
  };
  return { env: { DB: db, RESEND_API_KEY: 're_test' }, calls };
}

const req = (path) => new Request(`http://localhost${path}`, { method: 'POST' });

const ORDER = {
  id: 65, customer_name: 'Stacy Stout', email: 'stacy@example.com', language: 'en',
  status: 'pending', pickup_date: '2026-10-07', total_cents: 8000, subtotal_cents: 12000,
  discount_cents: 4000, payment_method: 'stripe', payment_sub_method: null,
  payment_status: 'partial', items_json: '[]', created_at: '2026-10-06 00:05:04',
  pay_token: null,
};

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/orders/:id/send-statement', () => {
  it('sends a statement, generates the token, logs the send and the event', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ id: 'msg_9' }) })));
    const { env, calls } = makeEnv({ order: ORDER, payments: [{ amount: 60 }], statementRow: { last_sent_at: '2026-10-10 14:00:00' } });
    const res = await worker.fetch(req('/api/orders/65/send-statement'), env, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, status: 'sent', balanceCents: 2000, lastSentAt: '2026-10-10 14:00:00' });

    const tokenWrite = calls.find((c) => c.method === 'run' && /UPDATE orders SET pay_token/.test(c.sql));
    expect(tokenWrite, 'token must be generated when missing').toBeTruthy();
    expect(tokenWrite.binds[0]).toMatch(/^[0-9a-f]{32}$/);

    const stmtInsert = calls.find((c) => c.method === 'run' && /INSERT INTO order_statements/.test(c.sql));
    expect(stmtInsert).toBeTruthy();
    expect(stmtInsert.binds).toContain(2000); // balance_cents
    expect(stmtInsert.binds).toContain(6000); // paid_cents

    const event = calls.find((c) => c.method === 'run' && /INSERT INTO order_events/.test(c.sql));
    expect(event.binds[2]).toBe('statement:sent');
  });

  it('rejects an order with no email', async () => {
    const { env } = makeEnv({ order: { ...ORDER, email: null }, payments: [{ amount: 60 }] });
    const res = await worker.fetch(req('/api/orders/65/send-statement'), env, {});
    expect(res.status).toBe(400);
  });

  it('rejects an order that is already paid', async () => {
    const { env } = makeEnv({ order: { ...ORDER, pay_token: 'tok65' }, payments: [{ amount: 80 }] });
    const res = await worker.fetch(req('/api/orders/65/send-statement'), env, {});
    expect(res.status).toBe(409);
  });

  it('logs a failed statement when Resend rejects and returns 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, text: async () => 'nope' })));
    const { env, calls } = makeEnv({ order: { ...ORDER, pay_token: 'tok65' }, payments: [{ amount: 60 }] });
    const res = await worker.fetch(req('/api/orders/65/send-statement'), env, {});
    expect(res.status).toBe(502);
    const stmtInsert = calls.find((c) => c.method === 'run' && /INSERT INTO order_statements/.test(c.sql));
    expect(stmtInsert.binds).toContain('failed');
    const event = calls.find((c) => c.method === 'run' && /INSERT INTO order_events/.test(c.sql));
    expect(event.binds[2]).toBe('statement:failed');
  });
});
