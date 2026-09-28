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

  it('nets negative amounts rather than excluding them', () => {
    // Deliberate: the caller's SQL decides which rows to pass in, and
    // payments.amount is written from integer cents on every path, so a
    // negative cannot arise from the dashboard. Pinned so a refactor cannot
    // silently switch this to a filter.
    expect(activePaymentsCents([{ amount: -5 }])).toBe(-500);
    expect(activePaymentsCents([{ amount: 10 }, { amount: -2.5 }])).toBe(750);
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

  it('sums dollars and cents without drift, landing on the total exactly', () => {
    // The dollars/cents class of bug: adding REAL dollars in binary float can
    // land a cent under. These three rows must total exactly 1264 cents.
    const rows = [{ amount: 12.34 }, { amount: 0.1 }, { amount: 0.2 }];
    expect(activePaymentsCents(rows)).toBe(1264);
    expect(derivePaymentStatus(activePaymentsCents(rows), 1264)).toBe('paid');
  });

  it('treats a non-finite total as settled, since the column is NOT NULL', () => {
    // orders.total_cents is INTEGER NOT NULL DEFAULT 0 (migrations/0001:12),
    // so a bad total can only arrive from a caller bug. The module is
    // documented as fail-closed against reporting a settled order as partial,
    // so this branch is a caller-bug amplifier, not a data condition. Pinned
    // here so a future refactor cannot invert it silently.
    expect(derivePaymentStatus(100, undefined)).toBe('paid');
    expect(derivePaymentStatus(100, NaN)).toBe('paid');
    // Number(null) is 0, which is finite, so it falls through the isFinite
    // guard and reaches the >= comparison instead.
    expect(derivePaymentStatus(100, null)).toBe('paid');
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

  it('returns more than the total when the collected sum is negative', () => {
    // Follows directly from netting negatives — see activePaymentsCents.
    expect(balanceCentsCents(-500, 6000)).toBe(6500);
  });
});
