import { describe, it, expect } from 'vitest';
import worker from '../workers/api.js';
import {
  depositCentsFor, balanceCentsFor, allowedPayModes, matchedPayMode,
  invoiceNumberFor, computeTotalCents, buildPayUrl,
  encodeInvoiceCustomId, parseInvoiceCustomId, generateInvoiceToken,
  classifyInvoicePayment,
} from '../workers/invoice-lib.js';

describe('depositCentsFor (re-exported 50% rule)', () => {
  it('halves even amounts', () => expect(depositCentsFor(18000)).toBe(9000));
  it('rounds up on odd cents', () => expect(depositCentsFor(9999)).toBe(5000));
});

describe('balanceCentsFor', () => {
  it('subtracts paid from total', () => expect(balanceCentsFor(18000, 9000)).toBe(9000));
  it('never goes negative', () => expect(balanceCentsFor(10000, 12000)).toBe(0));
});

describe('allowedPayModes', () => {
  it('full → only full', () => expect(allowedPayModes('full')).toEqual(['full']));
  it('deposit → only deposit', () => expect(allowedPayModes('deposit')).toEqual(['deposit']));
  it('both → deposit then full', () => expect(allowedPayModes('both')).toEqual(['deposit', 'full']));
  it('unknown falls back to both', () => expect(allowedPayModes(undefined)).toEqual(['deposit', 'full']));
});

describe('matchedPayMode', () => {
  it('full invoice matches the total', () => expect(matchedPayMode('full', 18000, 18000)).toBe('full'));
  it('full invoice rejects the deposit amount', () => expect(matchedPayMode('full', 18000, 9000)).toBeNull());
  it('deposit invoice matches the deposit', () => expect(matchedPayMode('deposit', 18000, 9000)).toBe('deposit'));
  it('deposit invoice rejects the full amount', () => expect(matchedPayMode('deposit', 18000, 18000)).toBeNull());
  it('both matches full', () => expect(matchedPayMode('both', 18000, 18000)).toBe('full'));
  it('both matches deposit', () => expect(matchedPayMode('both', 18000, 9000)).toBe('deposit'));
  it('both rejects a wrong amount', () => expect(matchedPayMode('both', 18000, 1234)).toBeNull());
});

describe('classifyInvoicePayment', () => {
  const base = { paymentOptions: 'both', totalCents: 18000 };

  it('no ref + valid amount → settle', () => {
    expect(classifyInvoicePayment({
      ...base, hasPaymentRef: false, sameRef: false, status: 'sent',
      convertedOrderId: null, amountCents: 18000,
    })).toBe('settle');
  });

  it('no ref + wrong amount → unexpected-amount', () => {
    expect(classifyInvoicePayment({
      ...base, hasPaymentRef: false, sameRef: false, status: 'sent',
      convertedOrderId: null, amountCents: 1234,
    })).toBe('unexpected-amount');
  });

  it('already converted → settled', () => {
    expect(classifyInvoicePayment({
      ...base, hasPaymentRef: false, sameRef: false, status: 'converted',
      convertedOrderId: 42, amountCents: 18000,
    })).toBe('settled');
  });

  it('same ref, not yet converted, valid amount → heal', () => {
    expect(classifyInvoicePayment({
      ...base, hasPaymentRef: true, sameRef: true, status: 'sent',
      convertedOrderId: null, amountCents: 9000,
    })).toBe('heal');
  });

  it('same ref, already converted → already', () => {
    expect(classifyInvoicePayment({
      ...base, hasPaymentRef: true, sameRef: true, status: 'converted',
      convertedOrderId: 42, amountCents: 18000,
    })).toBe('already');
  });

  it('different ref → duplicate', () => {
    expect(classifyInvoicePayment({
      ...base, hasPaymentRef: true, sameRef: false, status: 'sent',
      convertedOrderId: null, amountCents: 18000,
    })).toBe('duplicate');
  });

  it('void with no ref → settled', () => {
    expect(classifyInvoicePayment({
      ...base, hasPaymentRef: false, sameRef: false, status: 'void',
      convertedOrderId: null, amountCents: 18000,
    })).toBe('settled');
  });
});

describe('invoiceNumberFor', () => {
  it('first invoice is INV-1001', () => expect(invoiceNumberFor(1)).toBe('INV-1001'));
  it('pads to four digits', () => expect(invoiceNumberFor(42)).toBe('INV-1042'));
  it('grows past four digits', () => expect(invoiceNumberFor(9001)).toBe('INV-10001'));
});

describe('computeTotalCents', () => {
  it('sums qty × unit', () =>
    expect(computeTotalCents([{ qty: 2, unit_price_cents: 2500 }, { qty: 1, unit_price_cents: 1000 }])).toBe(6000));
  it('empty is zero', () => expect(computeTotalCents([])).toBe(0));
  it('garbage is zero', () => expect(computeTotalCents(null)).toBe(0));
});

describe('buildPayUrl', () => {
  it('builds the hosted pay link', () => {
    expect(buildPayUrl(7, 'abc123')).toBe('https://muy-rico.com/pay-invoice.html?inv=7&t=abc123');
  });
});

describe('invoice custom ids', () => {
  it('round-trips', () => {
    const enc = encodeInvoiceCustomId(7, 'a'.repeat(32));
    expect(enc).toBe('i7:' + 'a'.repeat(32));
    expect(parseInvoiceCustomId(enc)).toEqual({ id: 7, token: 'a'.repeat(32) });
  });
  it.each(['', 'i12', 'q12:' + 'a'.repeat(32), 'i12:xyz', '12', 'i12:' + 'a'.repeat(31)])(
    'rejects %j',
    (s) => expect(parseInvoiceCustomId(s)).toBeNull(),
  );
});

describe('generateInvoiceToken', () => {
  it('is 32 lowercase hex chars and unique per call', () => {
    const t = generateInvoiceToken();
    expect(t).toMatch(/^[0-9a-f]{32}$/);
    expect(generateInvoiceToken()).not.toBe(t);
  });
});

/**
 * convertInvoiceToOrder's lost-race catch, driven through the real router.
 *
 * The batch's only other UNIQUE is payments.id (TEXT PRIMARY KEY, statement 4).
 * A wide /UNIQUE constraint failed/ swallowed a collision there as "another
 * caller won the race", so a batch that rolled back committed nothing answered
 * 200 { order_id: null } — a paid invoice with no order, and a 2xx that stops
 * the provider from retrying. Byte-for-byte the failure the quote side was
 * already fixed for; the invoice catch still matched any UNIQUE.
 */
const INVOICE = {
  id: 7,
  number: 'INV-1007',
  status: 'sent',
  customer_name: 'Maria Lopez',
  email: 'maria@example.test',
  phone: null,
  language: 'es',
  customer_id: null,
  issue_date: '2026-09-16',
  due_date: '2026-09-30',
  payment_options: 'both',
  total_cents: 18000,
  notes: null,
  admin_notes: null,
  public_token: 'a'.repeat(32),
  paid_cents: null,
  paid_at: null,
  payment_method: null,
  payment_sub_method: null,
  payment_ref: null,
  converted_order_id: null,
  created_at: '2026-09-16 00:00:00',
  updated_at: '2026-09-16 00:00:00',
  created_by: 'owner',
};

function makeInvoiceEnv({ winner = null, batchError = null } = {}) {
  const calls = [];
  const db = {
    prepare(sql) {
      const stmt = {
        _sql: sql,
        _binds: [],
        bind(...args) { stmt._binds = args; return stmt; },
        async first() {
          calls.push({ sql, binds: stmt._binds, method: 'first' });
          if (/SELECT converted_order_id FROM invoices/.test(sql)) return winner;
          if (/FROM invoices WHERE id/.test(sql)) return INVOICE;
          return null;
        },
        async run() {
          calls.push({ sql, binds: stmt._binds, method: 'run' });
          return { meta: { changes: 1, last_row_id: 55 } };
        },
        async all() {
          calls.push({ sql, binds: stmt._binds, method: 'all' });
          return { results: [] };
        },
      };
      return stmt;
    },
    async batch(stmts) {
      calls.push({ sql: 'BATCH', binds: stmts.map((s) => ({ sql: s._sql, binds: s._binds })), method: 'batch' });
      if (batchError) throw batchError;
      return stmts.map((_, i) => ({ meta: { changes: 1, last_row_id: 200 + i } }));
    },
  };
  const env = { DB: db, PAYMENT_WEBHOOK_SECRET: 's3cret' };
  const ctx = { waitUntil: (p) => { if (p && typeof p.catch === 'function') p.catch(() => {}); } };
  return { env, ctx, calls };
}

const invoicePaidRequest = () =>
  new Request('https://orders-api.test/api/invoices/7/paid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': 's3cret' },
    body: JSON.stringify({ token: 'a'.repeat(32), method: 'stripe', ref: 'cs_test_9', amount_cents: 18000 }),
  });

describe('convertInvoiceToOrder unique-violation narrowing', () => {
  it('returns the winner order id when the real orders.invoice_id index fires', async () => {
    const { env, ctx, calls } = makeInvoiceEnv({
      winner: { converted_order_id: 66 },
      batchError: new Error('D1_ERROR: UNIQUE constraint failed: orders.invoice_id'),
    });
    const res = await worker.fetch(invoicePaidRequest(), env, ctx);

    expect(res.status, 'a lost race is not a server error').toBe(200);
    const body = await res.json();
    expect(body.already).toBe(true);
    expect(body.order_id).toBe(66);
    expect(
      calls.find((c) => c.method === 'first' && /SELECT converted_order_id FROM invoices/.test(c.sql)),
      'the loser must read the winning order id'
    ).toBeTruthy();
  });

  it('propagates a payments.id collision as an error instead of a lost race', async () => {
    // payments.id is a TEXT PRIMARY KEY and statement 4 inserts a generated
    // payId. Swallowed as a lost race, a rolled-back batch answers 200 with
    // order_id: null — the customer's money is marked paid, no order exists,
    // and the 2xx stops the provider from retrying.
    const { env, ctx, calls } = makeInvoiceEnv({
      winner: { converted_order_id: null },
      batchError: new Error('D1_ERROR: UNIQUE constraint failed: payments.id'),
    });
    const res = await worker.fetch(invoicePaidRequest(), env, ctx);

    expect(res.status, 'nothing committed, so the provider must be told to retry').toBe(500);
    const body = await res.json();
    expect(body.already, 'this was not a lost race').toBeUndefined();
    expect(body.order_id, 'no order exists, so no order id may be reported').toBeUndefined();
    expect(
      calls.find((c) => c.method === 'first' && /SELECT converted_order_id FROM invoices/.test(c.sql)),
      'a rolled-back batch must not be treated as a lost race'
    ).toBeFalsy();
  });

  it('rethrows a batch failure that names no constraint at all', async () => {
    const { env, ctx } = makeInvoiceEnv({ batchError: new Error('D1_ERROR: disk exploded') });
    expect((await worker.fetch(invoicePaidRequest(), env, ctx)).status).toBe(500);
  });
});
