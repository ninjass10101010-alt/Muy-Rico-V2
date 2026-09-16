// Pure invoice document rendering (mirrors receipt-html.js / buildQuoteDocumentHtml).
// Used both as the customer email body and the /api/invoices/:id/html printable view.
import { depositCentsFor, balanceCentsFor, buildPayUrl } from './invoice-lib.js';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const money = (c) => '$' + (Number(c) / 100).toFixed(2);

export function invoiceEmailMeta(invoice, isEn) {
  const number = invoice.number || `INV-${invoice.id}`;
  return {
    subject: isEn ? `Invoice ${number} — Muy Rico Bakery` : `Factura ${number} — Muy Rico Bakery`,
  };
}

export function buildInvoiceDocumentHtml(invoice, items, isEn) {
  const number = esc(invoice.number || `INV-${invoice.id}`);
  const customerName = esc(invoice.customer_name || '');
  const greeting = isEn ? `Hi ${customerName},` : `Hola ${customerName}:`;
  const totalCents = Number(invoice.total_cents) || 0;
  const depositCents = depositCentsFor(totalCents);
  const balanceCents = balanceCentsFor(totalCents, depositCents);
  const showDeposit = invoice.payment_options !== 'full';
  const isPaid = invoice.paid_at != null || invoice.status === 'converted';

  const metaLines = [];
  if (invoice.issue_date) metaLines.push(`${isEn ? 'Issued' : 'Emitida'}: ${esc(invoice.issue_date)}`);
  if (invoice.due_date) metaLines.push(`${isEn ? 'Due' : 'Vence'}: ${esc(invoice.due_date)}`);

  const rows = (items || []).map((it) => {
    const qty = Number(it.qty) || 1;
    const unit = Number(it.unit_price_cents) || 0;
    return `<tr>
        <td style="padding:10px 8px;border-bottom:1px solid #f0e9dc;">${esc(it.description)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #f0e9dc;text-align:center;white-space:nowrap;">×${qty}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #f0e9dc;text-align:right;white-space:nowrap;">${money(unit)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #f0e9dc;text-align:right;white-space:nowrap;"><strong>${money(qty * unit)}</strong></td>
      </tr>`;
  }).join('\n');

  let totals = `
      <tr>
        <td style="padding:12px 14px;color:#2c2523;font-size:15px;"><strong>${isEn ? 'Total' : 'Total'}</strong></td>
        <td style="padding:12px 14px;text-align:right;color:#2c2523;font-size:15px;"><strong>${money(totalCents)}</strong></td>
      </tr>`;
  if (showDeposit) {
    totals += `
      <tr>
        <td style="padding:8px 14px;color:#4a423d;font-size:13px;">${isEn ? 'Deposit (50%) due now' : 'Depósito (50%) a pagar ahora'}</td>
        <td style="padding:8px 14px;text-align:right;color:#4a423d;font-size:13px;">${money(depositCents)}</td>
      </tr>
      <tr>
        <td style="padding:8px 14px 12px;color:#4a423d;font-size:13px;">${isEn ? 'Balance due at pickup' : 'Restante al recoger'}</td>
        <td style="padding:8px 14px 12px;text-align:right;color:#4a423d;font-size:13px;">${money(balanceCents)}</td>
      </tr>`;
  }

  let payButton = '';
  if (!isPaid && invoice.public_token) {
    payButton = `
  <a href="${buildPayUrl(invoice.id, invoice.public_token)}" style="display:block;background:#2d7a46;color:#fff;text-align:center;padding:14px;border-radius:8px;font-size:16px;font-weight:600;text-decoration:none;margin:16px 0 4px;">${isEn ? `Pay Invoice — ${money(totalCents)}` : `Pagar factura — ${money(totalCents)}`}</a>`;
  }

  const settledLine = isPaid
    ? `<p style="font-size:14px;margin:20px 0 0;color:#2d7a46;"><strong>${isEn ? 'Paid' : 'Pagada'}</strong>${invoice.payment_method ? ` · ${esc(invoice.payment_method)}` : ''}</p>`
    : '';
  const noteLine = invoice.notes
    ? `<p style="font-size:13px;color:#4a423d;margin:16px 0 0;">${esc(invoice.notes)}</p>`
    : '';
  const disclaimer = isEn
    ? 'Baked in a home kitchen not inspected by the health department (Michigan Cottage Law). May contain or come into contact with common allergens.'
    : 'Horneado en una cocina doméstica no inspeccionada por el departamento de salud (Ley Cottage de Michigan). Puede contener alérgenos o haber tenido contacto con ellos.';

  return `<div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; color: #2c2523; line-height: 1.6;">
  <div style="text-align: center; margin-bottom: 24px;">
    <img src="https://muy-rico.com/muy_rico_logo_email.png" alt="Muy Rico Bakery" style="max-width: 160px;">
  </div>
  <h2 style="margin:0 0 8px;font-size:20px;">${isEn ? 'Invoice' : 'Factura'} ${number}</h2>
  <p style="margin:0 0 4px;">${greeting}</p>
  ${metaLines.length ? `<p style="margin:0 0 12px;color:#4a423d;font-size:13px;">${metaLines.join(' · ')}</p>` : ''}
  <table style="width:100%;border-collapse:collapse;margin-top:8px;">
    <thead>
      <tr>
        <th style="text-align:left;padding:8px;border-bottom:2px solid #e3dcd2;font-size:12px;color:#8a8078;text-transform:uppercase;letter-spacing:0.04em;">${isEn ? 'Description' : 'Descripción'}</th>
        <th style="text-align:center;padding:8px;border-bottom:2px solid #e3dcd2;font-size:12px;color:#8a8078;text-transform:uppercase;letter-spacing:0.04em;">${isEn ? 'Qty' : 'Cant.'}</th>
        <th style="text-align:right;padding:8px;border-bottom:2px solid #e3dcd2;font-size:12px;color:#8a8078;text-transform:uppercase;letter-spacing:0.04em;">${isEn ? 'Unit' : 'Precio'}</th>
        <th style="text-align:right;padding:8px;border-bottom:2px solid #e3dcd2;font-size:12px;color:#8a8078;text-transform:uppercase;letter-spacing:0.04em;">${isEn ? 'Amount' : 'Importe'}</th>
      </tr>
    </thead>
    <tbody>${rows || ''}</tbody>
  </table>
  <table style="width:100%;border-collapse:collapse;margin-top:16px;background:#faf7f2;border-radius:8px;">${totals}</table>
  ${payButton}
  ${settledLine}
  ${noteLine}
  <p style="color:#706561;font-size:11px;margin:16px 0 0;">${disclaimer}</p>
  <hr style="border: none; border-top: 1px solid #e8dbc4; margin: 24px 0;">
  <p style="color: #706561; font-size: 12px; text-align: center; margin: 0;">
    Muy Rico Bakery · Holland, MI<br>
    ${isEn ? 'Family · Tradition · Flavor' : 'Familia · Tradición · Sabor'}
  </p>
</div>`;
}
