export function validatePickupDate(value, now = new Date()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { ok: false, error: 'Invalid pickup_date format (expected YYYY-MM-DD)' };
  }
  const today = now.toISOString().slice(0, 10);
  if (value < today) {
    return { ok: false, error: 'Pickup date cannot be in the past' };
  }
  return { ok: true };
}

export function pickupChangeEvent(oldDate, newDate) {
  return `order:pickup_changed: ${oldDate} -> ${newDate}`;
}