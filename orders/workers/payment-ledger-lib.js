// Pure money arithmetic for the payments ledger.
// See docs/superpowers/specs/2026-09-28-payment-ledger-correctness-design.md
//
// Why this module exists: payments.amount is REAL dollars
// (migrations/0006_server_storage.sql:25) while every other monetary column
// is INTEGER cents. Every comparison between the ledger and an order total
// therefore has to convert, and getting that wrong silently reports a settled
// order as partial. Keeping it here makes it testable without a database.

/**
 * Sum a list of payment rows into integer cents.
 * Rounds each row before summing so every row's cents value is independently
 * correct, instead of leaning on the total happening to land correctly.
 */
export function activePaymentsCents(rows) {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((sum, p) => {
    const cents = Math.round(Number(p && p.amount) * 100);
    return sum + (Number.isFinite(cents) ? cents : 0);
  }, 0);
}

/**
 * Derive orders.payment_status from what was actually collected.
 * Never trust a client-supplied status — the ledger is the source of truth.
 */
export function derivePaymentStatus(activeCents, totalCents) {
  const paid = Number(activeCents);
  const total = Number(totalCents);
  if (!Number.isFinite(paid) || paid <= 0) return 'unpaid';
  // A non-finite total only arrives from a caller bug: orders.total_cents is
  // INTEGER NOT NULL DEFAULT 0 (migrations/0001_initial.sql:12). Reporting
  // 'paid' here is deliberate — this module fails closed, toward settled.
  if (!Number.isFinite(total) || paid >= total) return 'paid';
  return 'partial';
}

/**
 * Payment status for an order created by converting a quote or an invoice.
 *
 * DELIBERATELY NOT derivePaymentStatus. The two answer different questions:
 *
 *   - derivePaymentStatus is the LEDGER rule: "given what has been collected
 *     against this order's total, what is its status?" Three outcomes, and
 *     nothing collected reads 'unpaid'.
 *   - This is the DEPOSIT rule: "a customer committed to this order and paid a
 *     deposit, so is it settled or still owing a balance?" Two outcomes, and it
 *     has no 'unpaid' on purpose — reaching a conversion at all implies a
 *     commitment, so a $0 deposit on a $150 quote reads 'partial' (a balance is
 *     outstanding), not 'unpaid' (nothing was ever promised).
 *
 * Swapping derivePaymentStatus in would make the boundary case worse, not
 * better: for a $0.00 quote with a $0.00 deposit this returns 'paid' (nothing
 * is outstanding) while derivePaymentStatus(0, 0) returns 'unpaid'.
 */
export function deriveConversionStatus(collectedCents, totalCents) {
  const collected = Number(collectedCents) || 0;
  const total = Number(totalCents) || 0;
  return collected >= total ? 'paid' : 'partial';
}

/** Unpaid remainder, floored at zero so an overpayment reports 0, never negative. */
export function balanceCentsCents(activeCents, totalCents) {
  const remaining = (Number(totalCents) || 0) - (Number(activeCents) || 0);
  return remaining > 0 ? remaining : 0;
}
