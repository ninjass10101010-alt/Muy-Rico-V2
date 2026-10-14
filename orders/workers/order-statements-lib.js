// Pure eligibility + selection rules for order balance statements.
// Order rows are snake_case (as they come out of D1).

/** Remaining balance in integer cents; floors at zero. */
export function orderBalanceCents(order, activePayments) {
  const total = Number(order && order.total_cents) || 0;
  const paid = (Array.isArray(activePayments) ? activePayments : []).reduce((sum, p) => {
    const cents = Math.round((Number(p && p.amount) || 0) * 100);
    return sum + (Number.isFinite(cents) ? cents : 0);
  }, 0);
  const remaining = total - paid;
  return remaining > 0 ? remaining : 0;
}

/**
 * Balance-statement eligibility. Requires a non-cancelled order, an email, and a
 * positive balance. Overdue (pickup strictly in the past) is required for BULK
 * "remind all overdue" sends; a targeted single-order send may go out for an
 * order due today or in the future (e.g. collecting the balance at pickup).
 */
export function isStatementEligible(order, { balanceCents, today, requireOverdue = true }) {
  if (!order || order.status === 'cancelled') return false;
  const pickup = typeof order.pickup_date === 'string' ? order.pickup_date.slice(0, 10) : '';
  if (requireOverdue && (!pickup || pickup >= today)) return false;
  if (!String(order.email || '').trim()) return false;
  return Number(balanceCents) > 0;
}

/**
 * Pick bulk recipients for "Remind all overdue".
 * candidates: order rows; paymentsByOrder: { [orderId]: [{amount}] };
 * lastSentByOrder: { [orderId]: 'YYYY-MM-DD HH:MM:SS' (UTC, from SQLite) }.
 */
export function selectStatementRecipients(candidates, paymentsByOrder = {}, lastSentByOrder = {}, {
  today,
  cooldownHours = 24,
  cap = 50,
  now = Date.now(),
} = {}) {
  const send = [];
  const skipped = { recent: 0, noEmail: 0, notOverdue: 0, paid: 0, cancelled: 0, capped: 0 };

  for (const order of candidates || []) {
    if (order.status === 'cancelled') { skipped.cancelled++; continue; }

    const balanceCents = orderBalanceCents(order, paymentsByOrder[order.id]);
    if (!isStatementEligible(order, { balanceCents, today })) {
      if (!String(order.email || '').trim()) skipped.noEmail++;
      else if (balanceCents <= 0) skipped.paid++;
      else skipped.notOverdue++;
      continue;
    }

    const lastSent = lastSentByOrder[order.id];
    if (lastSent) {
      const sentAt = Date.parse(String(lastSent).replace(' ', 'T') + 'Z');
      if (Number.isFinite(sentAt) && now - sentAt < cooldownHours * 3600_000) {
        skipped.recent++;
        continue;
      }
    }

    send.push({ order, balanceCents });
  }

  if (send.length > cap) {
    skipped.capped = send.length - cap;
    send.length = cap;
  }
  return { send, skipped };
}
