import { describe, it, expect } from 'vitest';
import { validatePickupDate, pickupChangeEvent } from '../workers/order-date.js';

describe('validatePickupDate', () => {
  const now = new Date('2026-08-15T12:00:00Z');

  it('accepts today', () => {
    expect(validatePickupDate('2026-08-15', now)).toEqual({ ok: true });
  });

  it('accepts a future date', () => {
    expect(validatePickupDate('2026-08-22', now)).toEqual({ ok: true });
  });

  it('rejects a past date', () => {
    expect(validatePickupDate('2026-08-14', now)).toEqual({
      ok: false,
      error: 'Pickup date cannot be in the past',
    });
  });

  it('rejects malformed values', () => {
    expect(validatePickupDate('08/22/2026', now).ok).toBe(false);
    expect(validatePickupDate('', now).ok).toBe(false);
    expect(validatePickupDate(undefined, now).ok).toBe(false);
    expect(validatePickupDate('2026-8-22', now).ok).toBe(false);
    expect(validatePickupDate('not-a-date', now).ok).toBe(false);
  });

  it('rejects calendar-invalid dates', () => {
    const now = new Date('2026-01-15T12:00:00Z');
    expect(validatePickupDate('2026-02-31', now)).toEqual({
      ok: false,
      error: 'Invalid pickup_date format (expected YYYY-MM-DD)',
    });
    expect(validatePickupDate('2026-13-01', now)).toEqual({
      ok: false,
      error: 'Invalid pickup_date format (expected YYYY-MM-DD)',
    });
    expect(validatePickupDate('2026-02-29', now).ok).toBe(false);
  });

  it('accepts valid calendar dates', () => {
    const now = new Date('2026-01-15T12:00:00Z');
    expect(validatePickupDate('2026-02-28', now)).toEqual({ ok: true });
    expect(validatePickupDate('2028-02-29', now)).toEqual({ ok: true });
  });
});

describe('pickupChangeEvent', () => {
  it('formats old -> new', () => {
    expect(pickupChangeEvent('2026-08-16', '2026-08-22')).toBe(
      'order:pickup_changed: 2026-08-16 -> 2026-08-22'
    );
  });
});