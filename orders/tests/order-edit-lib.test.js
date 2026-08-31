import { describe, it, expect } from 'vitest';
import { validateOrderItems, computeOrderTotals } from '../workers/order-edit-lib.js';

describe('validateOrderItems', () => {
  it('accepts a valid single item', () => {
    expect(validateOrderItems([{ name: 'Cupcakes (Vanilla)', qty: 12, price: 3.5, productId: 'prod_cupcakes', emoji: '🧁' }]))
      .toEqual({ ok: true, error: null });
  });

  it('accepts multiple valid items', () => {
    expect(validateOrderItems([
      { name: 'Cake', qty: 1, price: 40 },
      { name: 'Cakepops', qty: 6, price: 2 },
    ])).toEqual({ ok: true, error: null });
  });

  it('rejects non-array input', () => {
    expect(validateOrderItems('nope').ok).toBe(false);
    expect(validateOrderItems(undefined).ok).toBe(false);
  });

  it('rejects an empty array', () => {
    const r = validateOrderItems([]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('At least one item');
  });

  it('rejects items with a blank name', () => {
    const r = validateOrderItems([{ name: '   ', qty: 1, price: 5 }]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Item 1');
  });

  it('rejects a name longer than 200 chars', () => {
    const r = validateOrderItems([{ name: 'x'.repeat(201), qty: 1, price: 5 }]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('200');
  });

  it('rejects qty 0, negative, non-integer, and over 9999', () => {
    expect(validateOrderItems([{ name: 'a', qty: 0, price: 1 }]).ok).toBe(false);
    expect(validateOrderItems([{ name: 'a', qty: -2, price: 1 }]).ok).toBe(false);
    expect(validateOrderItems([{ name: 'a', qty: 1.5, price: 1 }]).ok).toBe(false);
    expect(validateOrderItems([{ name: 'a', qty: 10000, price: 1 }]).ok).toBe(false);
    expect(validateOrderItems([{ name: 'a', qty: 1, price: 1 }]).ok).toBe(true);
  });

  it('rejects negative, NaN, and over-10000 prices', () => {
    expect(validateOrderItems([{ name: 'a', qty: 1, price: -1 }]).ok).toBe(false);
    expect(validateOrderItems([{ name: 'a', qty: 1, price: NaN }]).ok).toBe(false);
    expect(validateOrderItems([{ name: 'a', qty: 1, price: 10000.01 }]).ok).toBe(false);
    expect(validateOrderItems([{ name: 'a', qty: 1, price: 10000 }]).ok).toBe(true);
    expect(validateOrderItems([{ name: 'a', qty: 1, price: 0 }]).ok).toBe(true);
  });

  it('names the offending item index', () => {
    const r = validateOrderItems([
      { name: 'ok', qty: 1, price: 1 },
      { name: 'bad', qty: 0, price: 1 },
    ]);
    expect(r.error).toBe('Item 2 quantity must be an integer between 1 and 9999');
  });
});

describe('computeOrderTotals', () => {
  it('computes subtotal from qty * price', () => {
    expect(computeOrderTotals([{ name: 'a', qty: 12, price: 3.5 }], 0))
      .toEqual({ subtotalCents: 4200, discountCents: 0, totalCents: 4200 });
  });

  it('rounds fractional cents', () => {
    expect(computeOrderTotals([{ name: 'a', qty: 1, price: 2.675 }], 0).subtotalCents).toBe(268);
  });

  it('sums multiple items', () => {
    expect(computeOrderTotals([
      { name: 'a', qty: 1, price: 40 },
      { name: 'b', qty: 6, price: 2 },
    ], 0)).toEqual({ subtotalCents: 5200, discountCents: 0, totalCents: 5200 });
  });

  it('applies discount and clamps to [0, subtotal]', () => {
    expect(computeOrderTotals([{ name: 'a', qty: 1, price: 100 }], 500))
      .toEqual({ subtotalCents: 10000, discountCents: 500, totalCents: 9500 });
    expect(computeOrderTotals([{ name: 'a', qty: 1, price: 100 }], 99999).discountCents).toBe(10000);
    expect(computeOrderTotals([{ name: 'a', qty: 1, price: 100 }], -50).discountCents).toBe(0);
  });

  it('handles non-finite discount as zero', () => {
    expect(computeOrderTotals([{ name: 'a', qty: 1, price: 5 }], NaN))
      .toEqual({ subtotalCents: 500, discountCents: 0, totalCents: 500 });
  });
});