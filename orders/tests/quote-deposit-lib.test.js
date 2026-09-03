import { describe, it, expect } from 'vitest';
import {
  depositCentsFor, isDepositSufficient, buildPayUrl,
  encodeQuoteCustomId, parseQuoteCustomId, generateQuoteToken,
} from '../workers/quote-deposit-lib.js';

describe('depositCentsFor', () => {
  it('halves even amounts', () => expect(depositCentsFor(18000)).toBe(9000));
  it('rounds up on odd cents', () => expect(depositCentsFor(9999)).toBe(5000));
  it('ceil of 1 cent price is 1', () => expect(depositCentsFor(1)).toBe(1));
  it('zero price -> 0', () => expect(depositCentsFor(0)).toBe(0));
  it('garbage -> 0', () => expect(depositCentsFor('abc')).toBe(0));
});

describe('isDepositSufficient', () => {
  it('exact half is sufficient', () => expect(isDepositSufficient(5000, 10000)).toBe(true));
  it('one cent under fails', () => expect(isDepositSufficient(4999, 10000)).toBe(false));
});

describe('buildPayUrl', () => {
  it('builds the hosted pay link', () => {
    expect(buildPayUrl(12, 'abc123')).toBe('https://muy-rico.com/pay-quote.html?quote=12&t=abc123');
  });
});

describe('quote custom ids', () => {
  it('round-trips', () => {
    const enc = encodeQuoteCustomId(7, 'a'.repeat(32));
    expect(parseQuoteCustomId(enc)).toEqual({ id: 7, token: 'a'.repeat(32) });
  });
  it.each(['', 'q12', 'x12:' + 'a'.repeat(32), 'q12:xyz', '12', 'q12:' + 'a'.repeat(31)])(
    'rejects %j',
    (s) => expect(parseQuoteCustomId(s)).toBeNull(),
  );
});

describe('generateQuoteToken', () => {
  it('is 32 lowercase hex chars and unique per call', () => {
    const t = generateQuoteToken();
    expect(t).toMatch(/^[0-9a-f]{32}$/);
    expect(generateQuoteToken()).not.toBe(t);
  });
});
