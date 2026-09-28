import { describe, it, expect } from 'vitest';
import worker, { rowToQuote } from '../workers/api.js';

const BASE_ROW = {
  id: 7,
  status: 'new',
  customer_name: 'Ana',
  email: 'ana@example.test',
  cake_flavor: 'tres leches',
  quoted_price: 15000,
  created_at: '2026-09-01 10:00:00',
  updated_at: '2026-09-01 10:00:00',
};

describe('rowToQuote deposit mapping', () => {
  it('is exported for direct testing', () => {
    expect(typeof worker.fetch).toBe('function');
    expect(typeof rowToQuote).toBe('function');
  });

  it('maps public_token, which the Quotes tab needs for a pay link', () => {
    const q = rowToQuote({ ...BASE_ROW, public_token: 'abc123' });
    expect(q.public_token).toBe('abc123');
  });

  it('maps the three deposit fields', () => {
    const q = rowToQuote({
      ...BASE_ROW,
      deposit_paid_cents: 4000,
      deposit_paid_at: '2026-09-05 12:00:00',
      deposit_method: 'stripe',
    });
    expect(q.deposit_paid_cents).toBe(4000);
    expect(q.deposit_paid_at).toBe('2026-09-05 12:00:00');
    expect(q.deposit_method).toBe('stripe');
  });

  it('preserves a falsy-but-present deposit amount of 0 rather than dropping it', () => {
    const q = rowToQuote({ ...BASE_ROW, deposit_paid_cents: 0, deposit_paid_at: null, deposit_method: null });
    expect(q).toHaveProperty('deposit_paid_cents', 0);
    expect(q.deposit_paid_at).toBeNull();
    expect(q.deposit_method).toBeNull();
  });

  it('includes the deposit keys even when the row omits them', () => {
    const q = rowToQuote(BASE_ROW);
    expect(q).toHaveProperty('deposit_paid_cents');
    expect(q).toHaveProperty('public_token');
  });

  it('maps a SQL NULL deposit to null, distinct from a recorded 0', () => {
    // The distinction matters: null means no deposit was taken, 0 means a
    // zero-amount deposit was recorded. A `?? 0` mapping would collapse them.
    expect(rowToQuote({ ...BASE_ROW, deposit_paid_cents: null }).deposit_paid_cents).toBeNull();
  });

  it('leaves existing fields untouched', () => {
    const q = rowToQuote(BASE_ROW);
    expect(q.id).toBe(7);
    expect(q.quoted_price).toBe(15000);
    expect(q.cake_flavor).toBe('tres leches');
    expect(q.items).toEqual([]);
  });
});
