// Pure validation + money math for editing order line items.
// Extracted pure so it can be unit-tested without a fetch harness (see order-date.js).

const MAX_QTY = 9999;
const MAX_PRICE = 10000; // dollars
const MAX_NAME_LEN = 200;

export function validateOrderItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'At least one item is required' };
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== 'object') {
      return { ok: false, error: `Item ${i + 1} must be an object` };
    }
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name) {
      return { ok: false, error: `Item ${i + 1} requires a name` };
    }
    if (name.length > MAX_NAME_LEN) {
      return { ok: false, error: `Item ${i + 1} name exceeds ${MAX_NAME_LEN} characters` };
    }
    if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > MAX_QTY) {
      return { ok: false, error: `Item ${i + 1} quantity must be an integer between 1 and ${MAX_QTY}` };
    }
    if (typeof item.price !== 'number' || !Number.isFinite(item.price) || item.price < 0 || item.price > MAX_PRICE) {
      return { ok: false, error: `Item ${i + 1} price must be between 0 and ${MAX_PRICE}` };
    }
  }
  return { ok: true, error: null };
}

export function computeOrderTotals(items, discountCents) {
  let subtotalCents = 0;
  for (const item of items) {
    subtotalCents += Math.round(item.qty * item.price * 100);
  }
  let d = Number.isFinite(discountCents) ? Math.round(discountCents) : 0;
  if (d < 0) d = 0;
  if (d > subtotalCents) d = subtotalCents;
  return { subtotalCents, discountCents: d, totalCents: subtotalCents - d };
}