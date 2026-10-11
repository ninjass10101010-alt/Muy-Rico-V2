import { describe, it, expect } from 'vitest';
import {
  orderBalanceCents,
  isStatementEligible,
  selectStatementRecipients,
} from '../workers/order-statements-lib.js';

const ORDER = (over = {}) => ({
  id: 65,
  status: 'pending',
  email: 'stacy@example.com',
  pickup_date: '2026-10-07',
  total_cents: 8000,
  ...over,
});

describe('orderBalanceCents', () => {
  it('subtracts active payments (dollars) from the total (cents)', () => {
    expect(orderBalanceCents(ORDER(), [{ amount: 60 }, { amount: 5.5 }])).toBe(1450);
  });
  it('floors at zero on overpayment', () => {
    expect(orderBalanceCents(ORDER(), [{ amount: 100 }])).toBe(0);
  });
  it('treats missing payments as zero', () => {
    expect(orderBalanceCents(ORDER(), undefined)).toBe(8000);
  });
});

describe('isStatementEligible', () => {
  const today = '2026-10-10';
  it('accepts an overdue unpaid order', () => {
    expect(isStatementEligible(ORDER(), { balanceCents: 2000, today })).toBe(true);
  });
  it('accepts completed-but-unpaid orders', () => {
    expect(isStatementEligible(ORDER({ status: 'completed' }), { balanceCents: 2000, today })).toBe(true);
  });
  it('rejects cancelled orders', () => {
    expect(isStatementEligible(ORDER({ status: 'cancelled' }), { balanceCents: 2000, today })).toBe(false);
  });
  it('rejects future/missing pickup dates', () => {
    expect(isStatementEligible(ORDER({ pickup_date: '2026-10-11' }), { balanceCents: 2000, today })).toBe(false);
    expect(isStatementEligible(ORDER({ pickup_date: null }), { balanceCents: 2000, today })).toBe(false);
  });
  it('rejects orders with no email or no balance', () => {
    expect(isStatementEligible(ORDER({ email: '  ' }), { balanceCents: 2000, today })).toBe(false);
    expect(isStatementEligible(ORDER(), { balanceCents: 0, today })).toBe(false);
  });
});

describe('selectStatementRecipients', () => {
  const today = '2026-10-10';
  const orders = [
    ORDER({ id: 1 }),                                    // eligible
    ORDER({ id: 2 }),                                    // reminded 2h ago
    ORDER({ id: 3, email: '' }),                         // no email
    ORDER({ id: 4, pickup_date: '2026-10-12' }),         // not overdue
    ORDER({ id: 5, status: 'cancelled' }),               // cancelled
    ORDER({ id: 6 }),                                    // already paid
  ];
  const paymentsByOrder = { 1: [{ amount: 60 }], 6: [{ amount: 80 }] };
  const lastSentByOrder = { 2: '2026-10-10 08:00:00' };
  const now = Date.parse('2026-10-10T10:00:00Z');

  it('selects eligible orders and counts every skip bucket', () => {
    const { send, skipped } = selectStatementRecipients(
      orders, paymentsByOrder, lastSentByOrder, { today, now }
    );
    expect(send.map((s) => s.order.id)).toEqual([1]);
    expect(send[0].balanceCents).toBe(2000);
    expect(skipped).toMatchObject({ recent: 1, noEmail: 1, notOverdue: 1, cancelled: 1, paid: 1, capped: 0 });
  });

  it('sends again once the cooldown has passed', () => {
    const old = { 2: '2026-10-08 08:00:00' };
    const { send, skipped } = selectStatementRecipients([orders[1]], {}, old, { today, now });
    expect(send.map((s) => s.order.id)).toEqual([2]);
    expect(skipped.recent).toBe(0);
  });

  it('caps the send list and reports the remainder as capped', () => {
    const { send, skipped } = selectStatementRecipients(
      orders.filter((o) => o.id === 1 || o.id === 2), paymentsByOrder, {}, { today, now, cap: 1 }
    );
    expect(send).toHaveLength(1);
    expect(skipped.capped).toBe(1);
  });
});
