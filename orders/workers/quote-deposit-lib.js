// Pure helpers for the quote deposit flow.
// See docs/superpowers/specs/2026-09-03-quote-deposit-payment-design.md

export function depositCentsFor(quotedPriceCents) {
  const p = Number(quotedPriceCents);
  if (!Number.isFinite(p) || p <= 0) return 0;
  return Math.ceil(p * 0.5);
}

export function isDepositSufficient(paidCents, quotedPriceCents) {
  return Number(paidCents) >= depositCentsFor(quotedPriceCents);
}

export function buildPayUrl(quoteId, token) {
  return `https://muy-rico.com/pay-quote.html?quote=${quoteId}&t=${encodeURIComponent(token)}`;
}

export function encodeQuoteCustomId(quoteId, token) {
  return `q${quoteId}:${token}`;
}

export function parseQuoteCustomId(s) {
  const m = typeof s === 'string' ? s.match(/^q(\d+):([0-9a-f]{32})$/) : null;
  return m ? { id: Number(m[1]), token: m[2] } : null;
}

export function generateQuoteToken() {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
