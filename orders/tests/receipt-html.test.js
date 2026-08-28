import { describe, expect, it } from 'vitest';
import { buildMethodLabel, buildReceiptHtml, emailMeta, formatStatusLabel } from '../workers/receipt-html.js';

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
});
