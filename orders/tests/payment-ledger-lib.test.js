import { describe, it, expect } from 'vitest';
import {
  derivePaymentStatus,
  activePaymentsCents,
  balanceCentsCents,
} from '../workers/payment-ledger-lib.js';

describe('activePaymentsCents', () => {
  it('converts dollar amounts to integer cents without float drift', () => {
    expect(activePaymentsCents([{ amount: 12.34 }])).toBe(1234);
    expect(activePaymentsCents([{ amount: 19.99 }])).toBe(1999);
    expect(activePaymentsCents([{ amount: 0.1 }, { amount: 0.2 }])).toBe(30);
    // Rounds, never truncates. 0.29 * 100 is 28.999999999999996 in binary, so a
    // truncating implementation would record 28 cents and under-report revenue
    // by a cent on roughly 4.6% of real two-decimal amounts.
    expect(activePaymentsCents([{ amount: 0.29 }])).toBe(29);
    expect(activePaymentsCents([{ amount: 1.13 }])).toBe(113);
  });

  it('sums multiple rows', () => {
    expect(activePaymentsCents([{ amount: 50 }, { amount: 12.5 }])).toBe(6250);
  });

  it('treats an empty list as zero', () => {
    expect(activePaymentsCents([])).toBe(0);
  });

  it('coerces non-numeric amounts to zero rather than NaN', () => {
    expect(activePaymentsCents([{ amount: 'abc' }, { amount: 5 }])).toBe(500);
    expect(activePaymentsCents([{ amount: null }])).toBe(0);
  });
});

describe('derivePaymentStatus', () => {
  it('is unpaid when nothing has been collected', () => {
    expect(derivePaymentStatus(0, 6000)).toBe('unpaid');
  });

  it('is partial when some but not all has been collected', () => {
    expect(derivePaymentStatus(3000, 6000)).toBe('partial');
    expect(derivePaymentStatus(1, 6000)).toBe('partial');
    expect(derivePaymentStatus(5999, 6000)).toBe('partial');
  });

  it('is paid at exactly the total', () => {
    expect(derivePaymentStatus(6000, 6000)).toBe('paid');
  });

  it('is paid when over-collected', () => {
    expect(derivePaymentStatus(6500, 6000)).toBe('paid');
  });

  it('is paid for a zero-total order that received a payment', () => {
    expect(derivePaymentStatus(100, 0)).toBe('paid');
  });

  it('is unpaid for a negative or zero sum', () => {
    expect(derivePaymentStatus(-100, 6000)).toBe('unpaid');
  });

  it('does not report partial for a sum that is a cent short of the total', () => {
    // The dollars/cents class of bug: 0.1 + 0.2 must not land on 29.99 cents.
    const rows = [{ amount: 12.34 }, { amount: 0.1 }, { amount: 0.2 }];
    expect(activePaymentsCents(rows)).toBe(1264);
    expect(derivePaymentStatus(activePaymentsCents(rows), 1264)).toBe('paid');
  });
});

describe('balanceCentsCents', () => {
  it('returns the unpaid remainder', () => {
    expect(balanceCentsCents(3000, 6000)).toBe(3000);
  });

  it('returns zero when settled', () => {
    expect(balanceCentsCents(6000, 6000)).toBe(0);
  });

  it('never returns a negative balance on overpayment', () => {
    expect(balanceCentsCents(6500, 6000)).toBe(0);
  });

  it('returns zero when nothing was collected and the total is zero', () => {
    expect(balanceCentsCents(0, 0)).toBe(0);
  });
});
