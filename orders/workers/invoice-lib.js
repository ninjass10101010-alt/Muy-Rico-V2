// Pure helpers for the invoice payment flow.
// See docs/superpowers/specs/2026-09-16-invoices-design.md
import { depositCentsFor } from './quote-deposit-lib.js';

// Same 50%-rounded-up rule as quotes — single source of truth.
export { depositCentsFor };

export function balanceCentsFor(totalCents, paidCents) {
  return Math.max(0, Number(totalCents) - Number(paidCents || 0));
}

export function allowedPayModes(paymentOptions) {
  if (paymentOptions === 'full') return ['full'];
  if (paymentOptions === 'deposit') return ['deposit'];
  return ['deposit', 'full'];
}

// Which single mode a given amount corresponds to — or null if unauthorized.
export function matchedPayMode(paymentOptions, totalCents, amountCents) {
  const amt = Number(amountCents);
  const total = Number(totalCents);
  if (!Number.isFinite(amt) || !Number.isFinite(total) || total <= 0) return null;
  const modes = allowedPayModes(paymentOptions);
  if (modes.includes('full') && amt === total) return 'full';
  if (modes.includes('deposit') && amt === depositCentsFor(total)) return 'deposit';
  return null;
}

// Classifies an incoming /paid request. Pure so the idempotency + amount policy
// is unit-testable without a D1 harness.
export function classifyInvoicePayment({ hasPaymentRef, sameRef, status, convertedOrderId, paymentOptions, totalCents, amountCents }) {
  if (hasPaymentRef) {
    if (!sameRef) return 'duplicate';
    if (convertedOrderId == null && status !== 'converted' && status !== 'void'
        && matchedPayMode(paymentOptions, totalCents, amountCents)) {
      return 'heal';
    }
    return 'already';
  }
  if (status === 'converted' || status === 'void') return 'settled';
  if (!matchedPayMode(paymentOptions, totalCents, amountCents)) return 'unexpected-amount';
  return 'settle';
}

export function invoiceNumberFor(id) {
  return `INV-${String(Number(id) + 1000).padStart(4, '0')}`;
}

export function computeTotalCents(items) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, it) => {
    const qty = Number(it && it.qty) || 0;
    const unit = Number(it && it.unit_price_cents) || 0;
    return sum + qty * unit;
  }, 0);
}

export function buildPayUrl(invoiceId, token) {
  return `https://muy-rico.com/pay-invoice.html?inv=${invoiceId}&t=${encodeURIComponent(token)}`;
}

export function encodeInvoiceCustomId(invoiceId, token) {
  return `i${invoiceId}:${token}`;
}

export function parseInvoiceCustomId(s) {
  const m = typeof s === 'string' ? s.match(/^i(\d+):([0-9a-f]{32})$/) : null;
  return m ? { id: Number(m[1]), token: m[2] } : null;
}

export function generateInvoiceToken() {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
