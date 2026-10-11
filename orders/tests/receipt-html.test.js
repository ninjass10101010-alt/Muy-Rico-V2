import { describe, expect, it } from 'vitest';
import { buildMethodLabel, buildReceiptHtml, emailMeta, formatStatusLabel, statementSubject } from '../workers/receipt-html.js';

const baseOrder = {
  id: 42,
  customer_name: 'Judy Vanderstelt',
  created_at: '2026-08-27 12:00:00',
  pickup_date: '2026-08-29',
  pickup_time: '09:00',
  payment_method: 'cash',
  payment_sub_method: null,
  status: 'pending',
  language: 'es',
  notes: '',
  total_cents: 4800,
  subtotal_cents: 4800,
  discount_cents: 0,
  payment_status: 'paid',
  items_json: JSON.stringify([
    { name: 'Mini Cupcakes (12) (Cake: Vanilla)', name_en: 'Mini Cupcakes (12) (Cake: Vanilla)', name_es: 'Mini Cupcakes (12) (Pastel: Vainilla)', qty: 2, price: 24 },
  ]),
};

describe('buildReceiptHtml', () => {
  it('paid order renders receipt wording, no discount/notes rows', () => {
    const html = buildReceiptHtml({ ...baseOrder }, true);
    expect(html).toContain('RECEIPT');
    expect(html).toContain('TOTAL PAID');
    expect(html).toContain('$48.00');
    expect(html).toContain('Your payment was received');
    expect(html).not.toContain('Subtotal');
    expect(html).not.toContain('Notes');
  });

  it('unpaid ES order with discount renders invoice wording, subtotal, discount, notes', () => {
    const order = {
      ...baseOrder,
      payment_status: 'unpaid',
      total_cents: 7200,
      subtotal_cents: 9600,
      discount_cents: 2400,
      notes: 'Order for business: The Content Cove.',
      items_json: JSON.stringify([
        { name: 'x', name_es: 'Mini Cupcakes (12) (Pastel: Vainilla)', qty: 2, price: 24 },
        { name: 'y', name_es: 'Mini Cupcakes (12) (Pastel: Chocolate)', qty: 2, price: 24 },
      ]),
    };
    const html = buildReceiptHtml(order, false);
    expect(html).toContain('FACTURA');
    expect(html).toContain('TOTAL A PAGAR');
    expect(html).toContain('El pago se realiza al recoger.');
    expect(html).toContain('Subtotal');
    expect(html).toContain('$96.00');
    expect(html).toContain('Descuento');
    expect(html).toContain('−$24.00'); // U+2212 minus sign
    expect(html).toContain('$72.00');
    expect(html).toContain('Notas');
    expect(html).toContain('Order for business: The Content Cove.');
    expect(html).toContain('Mini Cupcakes (12) (Pastel: Chocolate)');
  });

  it('unpaid EN order renders INVOICE and TOTAL DUE', () => {
    const html = buildReceiptHtml({ ...baseOrder, payment_status: 'unpaid' }, true);
    expect(html).toContain('INVOICE');
    expect(html).toContain('TOTAL DUE');
    expect(html).toContain('Payment is due at pickup.');
  });

  it('partial order renders TOTAL label and deposit wording', () => {
    const html = buildReceiptHtml({ ...baseOrder, payment_status: 'partial' }, true);
    expect(html).toContain('INVOICE');
    expect(html).toContain('Deposit received — balance due at pickup.');
    expect(html).not.toContain('TOTAL DUE');
    expect(html).not.toContain('TOTAL PAID');
  });

  it('escapes HTML in notes', () => {
    const html = buildReceiptHtml({ ...baseOrder, notes: '<script>alert(1)</script>' }, true);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('falls back to total+discount when subtotal is missing', () => {
    const html = buildReceiptHtml(
      { ...baseOrder, payment_status: 'unpaid', subtotal_cents: 0, discount_cents: 2400, total_cents: 7200 },
      true,
    );
    expect(html).toContain('$96.00');
    expect(html).toContain('−$24.00');
  });
});

describe('emailMeta', () => {
  it('paid order keeps the original receipt subject and wording', () => {
    const en = emailMeta({ ...baseOrder }, true);
    expect(en.subject).toBe('Receipt — Muy Rico Order #42');
    expect(en.receipt).toBe('RECEIPT');
    expect(en.total).toBe('TOTAL PAID');
    expect(en.paidNote).toBe('Your payment was received and your order is being prepared.');
    const es = emailMeta({ ...baseOrder }, false);
    expect(es.subject).toBe('Recibo — Pedido Muy Rico #42');
    expect(es.receipt).toBe('RECIBO');
    expect(es.total).toBe('TOTAL PAGADO');
  });

  it('unpaid order uses invoice subject and due wording', () => {
    const en = emailMeta({ ...baseOrder, payment_status: 'unpaid' }, true);
    expect(en.subject).toBe('Invoice — Muy Rico Order #42');
    expect(en.receipt).toBe('INVOICE');
    expect(en.total).toBe('TOTAL DUE');
    expect(en.paidNote).toBe('Your order is confirmed. Payment is due at pickup.');
    const es = emailMeta({ ...baseOrder, payment_status: 'unpaid' }, false);
    expect(es.subject).toBe('Factura — Pedido Muy Rico #42');
    expect(es.receipt).toBe('FACTURA');
    expect(es.total).toBe('TOTAL A PAGAR');
  });

  it('partial order uses invoice subject, TOTAL label, and deposit wording', () => {
    const en = emailMeta({ ...baseOrder, payment_status: 'partial' }, true);
    expect(en.subject).toBe('Invoice — Muy Rico Order #42');
    expect(en.receipt).toBe('INVOICE');
    expect(en.total).toBe('TOTAL');
    expect(en.paidNote).toBe('Your order is confirmed. Deposit received — balance due at pickup.');
    const es = emailMeta({ ...baseOrder, payment_status: 'partial' }, false);
    expect(es.total).toBe('TOTAL');
    expect(es.paidNote).toContain('Depósito recibido');
  });
});

describe('buildMethodLabel / formatStatusLabel', () => {
  it('keeps existing labels', () => {
    expect(buildMethodLabel({ payment_method: 'cash' }, true)).toBe('Cash');
    expect(buildMethodLabel({ payment_method: 'cash' }, false)).toBe('Efectivo');
    expect(buildMethodLabel({ payment_method: 'venmo' }, true)).toBe('Venmo');
    expect(formatStatusLabel('pending', true)).toBe('Pending');
    expect(formatStatusLabel('pending', false)).toBe('Pendiente');
  });

  /**
   * payment_sub_method is preserved by design when a later collection uses a
   * different method (createPayment's COALESCE), so the blob is the ledger's
   * history rather than the order's current tender. The label must follow
   * payment_method; a customer settling an $11.70 cash balance on a $1.30 card
   * deposit was reading "Visa (…4242)" on the receipt for money handed over in
   * cash.
   */
  const cardBlob = JSON.stringify({ type: 'card', brand: 'visa', last4: '4242' });

  it('labels a cash order carrying a card blob as cash', () => {
    expect(buildMethodLabel({ payment_method: 'cash', payment_sub_method: cardBlob }, true)).toBe('Cash');
    expect(buildMethodLabel({ payment_method: 'cash', payment_sub_method: cardBlob }, false)).toBe('Efectivo');
  });

  it('still labels a stripe order with a card blob as the brand', () => {
    expect(buildMethodLabel({ payment_method: 'stripe', payment_sub_method: cardBlob }, true))
      .toBe('Visa (…4242)');
  });

  it('still labels a paypal order with paypal_wallet as PayPal Wallet', () => {
    const blob = JSON.stringify({ type: 'paypal_wallet' });
    expect(buildMethodLabel({ payment_method: 'paypal', payment_sub_method: blob }, true))
      .toBe('PayPal Wallet');
  });

  it('does not let a stale card blob relabel a paypal order', () => {
    expect(buildMethodLabel({ payment_method: 'paypal', payment_sub_method: cardBlob }, true))
      .toBe('PayPal');
  });

  it('does not let a stale paypal_wallet blob relabel a stripe order', () => {
    const blob = JSON.stringify({ type: 'paypal_wallet' });
    expect(buildMethodLabel({ payment_method: 'stripe', payment_sub_method: blob }, true))
      .toBe('Card');
  });

  it('does not print the stale card on the receipt a customer is actually emailed', () => {
    // The same helper feeds the emailed/printed receipt, so the gate has to
    // hold on the rendered document and not only on the label in isolation.
    const html = buildReceiptHtml(
      { ...baseOrder, payment_method: 'cash', payment_sub_method: cardBlob },
      true,
    );
    expect(html).toContain('Cash');
    expect(html, 'the receipt must not name a card that was not the tender').not.toContain('4242');
    expect(html).not.toContain('Visa');
  });
});

const STMT_ORDER = {
  id: 65,
  customer_name: 'Stacy Stout',
  email: 'stacy@example.com',
  items_json: JSON.stringify([{ name: 'Lemon Cupcake ×24', qty: 1, price: 40 }]),
  subtotal_cents: 12000,
  discount_cents: 4000,
  total_cents: 8000,
  payment_method: 'stripe',
  payment_sub_method: null,
  payment_status: 'partial',
  status: 'pending',
  pickup_date: '2026-10-07',
  pickup_time: null,
  created_at: '2026-10-06 00:05:04',
  language: 'en',
};

const PAYMENTS = [{ date: '2026-10-06', methodLabel: 'Card', amountCents: 6000 }];

describe('statement rendering', () => {
  it('renders the statement title, payments, balance due, and pay button (EN)', () => {
    const html = buildReceiptHtml(STMT_ORDER, true, {
      payments: PAYMENTS, balanceCents: 2000, payUrl: 'https://muy-rico.com/pay-order.html?o=65&t=abc',
    });
    expect(html).toContain('BALANCE REMINDER');
    expect(html).not.toContain('>RECEIPT<');
    expect(html).toContain('2026-10-06');
    expect(html).toContain('Card');
    expect(html).toContain('$60.00');
    expect(html).toContain('Paid to date');
    expect(html).toContain('Balance due');
    expect(html).toContain('$20.00');
    expect(html).toContain('href="https://muy-rico.com/pay-order.html?o=65&amp;t=abc"');
  });

  it('renders Spanish statement wording', () => {
    const es = { ...STMT_ORDER, language: 'es' };
    const html = buildReceiptHtml(es, false, {
      payments: PAYMENTS, balanceCents: 2000, payUrl: 'https://muy-rico.com/pay-order.html?o=65&t=abc',
    });
    expect(html).toContain('RECORDATORIO DE SALDO');
    expect(html).toContain('Pagado a la fecha');
    expect(html).toContain('Saldo pendiente');
  });

  it('shows the payments breakdown on a paid receipt with no button', () => {
    const paid = { ...STMT_ORDER, payment_status: 'paid' };
    const html = buildReceiptHtml(paid, true, { payments: PAYMENTS, balanceCents: 0, payUrl: null });
    expect(html).toContain('RECEIPT');
    expect(html).toContain('Paid to date');
    expect(html).not.toContain('pay-order.html');
  });

  it('produces statement subjects per language', () => {
    expect(statementSubject(STMT_ORDER, true)).toBe('Balance reminder — Muy Rico Order #65');
    expect(statementSubject(STMT_ORDER, false)).toBe('Recordatorio de saldo — Pedido Muy Rico #65');
  });
});
