import { describe, expect, it } from 'vitest';
import { buildInvoiceDocumentHtml, invoiceEmailMeta } from '../workers/invoice-html.js';

const baseInvoice = {
  id: 7,
  number: 'INV-1007',
  status: 'sent',
  customer_name: 'Maria Lopez',
  email: 'maria@example.com',
  language: 'es',
  payment_options: 'both',
  total_cents: 18000,
  public_token: 'a'.repeat(32),
  paid_at: null,
  issue_date: '2026-09-16',
  due_date: '2026-09-30',
  notes: 'Gracias por su pedido',
  payment_method: null,
};

const items = [
  { description: 'Tres leches 10"', qty: 1, unit_price_cents: 15000 },
  { description: 'Docena de conchas', qty: 1, unit_price_cents: 3000 },
];

describe('buildInvoiceDocumentHtml', () => {
  it('renders the number, customer, and every line item', () => {
    const html = buildInvoiceDocumentHtml(baseInvoice, items, false);
    expect(html).toContain('INV-1007');
    expect(html).toContain('Maria Lopez');
    expect(html).toContain('Tres leches 10"');
    expect(html).toContain('Docena de conchas');
  });

  it('shows total, deposit (50%), and balance when payment_options = both', () => {
    const html = buildInvoiceDocumentHtml(baseInvoice, items, true);
    expect(html).toContain('$180.00');
    expect(html).toContain('$90.00');
  });

  it('omits the deposit/balance breakdown when payment_options = full', () => {
    const html = buildInvoiceDocumentHtml({ ...baseInvoice, payment_options: 'full' }, items, true);
    expect(html).not.toContain('Deposit (50%)');
  });

  it('includes a Pay button with the hosted pay link when unpaid and tokenized', () => {
    const html = buildInvoiceDocumentHtml(baseInvoice, items, false);
    expect(html).toContain('https://muy-rico.com/pay-invoice.html?inv=7&t=' + 'a'.repeat(32));
  });

  it('omits the Pay button when the invoice is settled', () => {
    const html = buildInvoiceDocumentHtml({ ...baseInvoice, status: 'converted', paid_at: '2026-09-17' }, items, true);
    expect(html).not.toContain('pay-invoice.html');
    expect(html).toContain('Paid');
  });
});

describe('invoiceEmailMeta', () => {
  it('uses English subject', () =>
    expect(invoiceEmailMeta(baseInvoice, true).subject).toBe('Invoice INV-1007 — Muy Rico Bakery'));
  it('uses Spanish subject', () =>
    expect(invoiceEmailMeta(baseInvoice, false).subject).toBe('Factura INV-1007 — Muy Rico Bakery'));
});
