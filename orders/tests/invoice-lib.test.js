import { describe, it, expect } from 'vitest';
import {
  depositCentsFor, balanceCentsFor, allowedPayModes, matchedPayMode,
  invoiceNumberFor, computeTotalCents, buildPayUrl,
  encodeInvoiceCustomId, parseInvoiceCustomId, generateInvoiceToken,
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
