// orders/workers/receipt-html.js
// Pure receipt/invoice rendering helpers (extracted from api.js for unit testing).
// buildReceiptHtml renders the branded HTML used both as the customer email body
// and the /api/receipts/:id/html view. Paid orders render as RECEIPT; unpaid and
// partial orders render as INVOICE with due-at-pickup wording.

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function buildMethodLabel(order, isEn) {
  const method = order.payment_method;
  let label;
  if (method === 'stripe') label = isEn ? 'Card' : 'Tarjeta';
  else if (method === 'paypal') label = 'PayPal';
  else if (method === 'cashapp') label = 'Cash App';
  else if (method === 'venmo') label = 'Venmo';
  else if (method === 'applepay') label = 'Apple Pay';
  else if (method === 'cash') label = isEn ? 'Cash' : 'Efectivo';
  else label = method || '—';
  // Append sub-method details for Stripe/PayPal
  const sub = order.payment_sub_method;
  if (sub) {
    try {
      const parsed = JSON.parse(sub);
      if (parsed.type === 'card' && parsed.brand) {
        const brand = parsed.brand.charAt(0).toUpperCase() + parsed.brand.slice(1).toLowerCase();
        const funding = parsed.funding ? ' ' + parsed.funding.charAt(0).toUpperCase() + parsed.funding.slice(1).toLowerCase() : '';
        const last4 = parsed.last4 ? ' (…' + parsed.last4 + ')' : '';
        label = `${brand}${funding}${last4}`;
      } else if (parsed.type === 'paypal_wallet') {
        label = 'PayPal Wallet';
      }
    } catch { /* keep base label */ }
  }
  return label;
}

export function formatStatusLabel(status, isEn) {
  const map = isEn ? {
    'pending': 'Pending',
    'in-progress': 'In Progress',
    'ready': 'Ready',
    'completed': 'Completed',
    'cancelled': 'Cancelled',
    'awaiting_payment': 'Awaiting Payment',
  } : {
    'pending': 'Pendiente',
    'in-progress': 'En Progreso',
    'ready': 'Listo',
    'completed': 'Completado',
    'cancelled': 'Cancelado',
    'awaiting_payment': 'Esperando Pago',
  };
  return map[status] || status;
}

export function buildReceiptHtml(order, isEn) {
  const customer = order.customer_name.trim();
  const total = order.total_cents ? '$' + (order.total_cents / 100).toFixed(2) : '$0.00';
  const orderDate = (order.created_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  const methodLabel = buildMethodLabel(order, isEn);
  const statusLabel = order.status ? formatStatusLabel(order.status, isEn) : '—';
  const isPaid = order.payment_status === 'paid';
  const isPartial = order.payment_status === 'partial';
  const notes = (order.notes || '').trim();
  const discountCents = Number(order.discount_cents) || 0;
  const subtotalCents = Number(order.subtotal_cents) || ((Number(order.total_cents) || 0) + discountCents);

  // Itemized receipt rows: name, qty × unit, line total (right-aligned like a paper receipt)
  const itemRows = (function () {
    try {
      const items = JSON.parse(order.items_json);
      return items.map(i => {
        const line = (i.qty * i.price).toFixed(2);
        const itemName = isEn ? (i.name_en || i.name) : (i.name_es || i.name);
        return `<tr>
        <td style="padding: 10px 0; border-bottom: 1px dashed #e3dcd2; color: #4a423d; font-size: 14px;">${itemName}</td>
        <td style="padding: 10px 0; border-bottom: 1px dashed #e3dcd2; color: #8a8078; font-size: 13px; text-align: center; white-space: nowrap;">${i.qty} × $${Number(i.price).toFixed(2)}</td>
        <td style="padding: 10px 0; border-bottom: 1px dashed #e3dcd2; color: #4a423d; font-size: 14px; text-align: right; font-weight: 600;">$${line}</td>
      </tr>`;
      }).join('');
    } catch {
      return `<tr><td style="padding: 10px 0; color: #4a423d; font-size: 14px;">${order.items_json}</td><td></td><td></td></tr>`;
    }
  })();

  const L = isEn ? {
    receipt: isPaid ? 'RECEIPT' : 'INVOICE',
    thanks: 'Thank you for your order!',
    paidNote: isPaid
      ? 'Your payment was received and your order is being prepared.'
      : isPartial
        ? 'Your order is confirmed. Deposit received — balance due at pickup.'
        : 'Your order is confirmed. Payment is due at pickup.',
    date: 'Date',
    payment: 'Payment',
    statusLabel: 'Status',
    pickup: 'Pickup',
    notes: 'Notes',
    item: 'Item',
    qty: 'Qty',
    amount: 'Amount',
    subtotal: 'Subtotal',
    discount: 'Discount',
    total: isPaid ? 'TOTAL PAID' : isPartial ? 'TOTAL' : 'TOTAL DUE',
    contact: 'Questions about your order? Reply to this email or call/text us at (616) 218-3582.',
    footer: 'Muy Rico Bakery · Holland, Michigan · Familia · Tradición · Sabor',
  } : {
    receipt: isPaid ? 'RECIBO' : 'FACTURA',
    thanks: '¡Gracias por tu pedido!',
    paidNote: isPaid
      ? 'Tu pago fue recibido y tu pedido se está preparando.'
      : isPartial
        ? 'Tu pedido está confirmado. Depósito recibido — el saldo se paga al recoger.'
        : 'Tu pedido está confirmado. El pago se realiza al recoger.',
    date: 'Fecha',
    payment: 'Pago',
    statusLabel: 'Estado',
    pickup: 'Recogida',
    notes: 'Notas',
    item: 'Producto',
    qty: 'Cant.',
    amount: 'Importe',
    subtotal: 'Subtotal',
    discount: 'Descuento',
    total: isPaid ? 'TOTAL PAGADO' : isPartial ? 'TOTAL' : 'TOTAL A PAGAR',
    contact: '¿Preguntas sobre tu pedido? Responde a este correo o llámanos al (616) 218-3582.',
    footer: 'Muy Rico Bakery · Holland, Michigan · Familia · Tradición · Sabor',
  };

  const discountRows = discountCents > 0 ? `
        <tr>
          <td colspan="2" style="padding: 14px 0 4px; color: #8a8078; font-size: 13px;">${L.subtotal}</td>
          <td style="padding: 14px 0 4px; color: #8a8078; font-size: 13px; text-align: right;">$${(subtotalCents / 100).toFixed(2)}</td>
        </tr>
        <tr>
          <td colspan="2" style="padding: 4px 0; color: #2d7a46; font-size: 13px; font-weight: 600;">${L.discount}</td>
          <td style="padding: 4px 0; color: #2d7a46; font-size: 13px; font-weight: 600; text-align: right;">−$${(discountCents / 100).toFixed(2)}</td>
        </tr>` : '';

  const notesRow = notes ? `
      <tr>
        <td style="color: #8a8078; font-size: 13px; padding: 3px 0; vertical-align: top;">${L.notes}</td>
        <td style="color: #4a423d; font-size: 13px; text-align: right; padding: 3px 0;">${escapeHtml(notes)}</td>
      </tr>` : '';

  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #faf7f2; padding: 24px 12px; color: #333;">
<div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.07);">

  <div style="background: #1e4636; padding: 28px 32px 24px; text-align: center;">
    <img src="https://muy-rico.com/muy_rico_logo_email.png" alt="Muy Rico Bakery" width="180" style="width: 180px; max-width: 60%; height: auto; display: block; margin: 0 auto 10px;" />
    <div style="color: #d4edda; font-size: 12px; letter-spacing: 3px; font-weight: 600;">${L.receipt}</div>
  </div>

  <div style="padding: 28px 32px 8px;">
    <h2 style="margin: 0 0 6px; color: #2d7a46; font-size: 20px;">${L.thanks}</h2>
    <p style="margin: 0 0 20px; color: #6b615a; font-size: 14px; line-height: 1.5;">${customer} — ${L.paidNote}</p>

    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
      <tr>
        <td style="color: #8a8078; font-size: 13px; padding: 3px 0;">${L.date}</td>
        <td style="color: #4a423d; font-size: 13px; text-align: right; padding: 3px 0;">${orderDate}</td>
      </tr>
      <tr>
        <td style="color: #8a8078; font-size: 13px; padding: 3px 0;">${L.payment}</td>
        <td style="color: #4a423d; font-size: 13px; text-align: right; padding: 3px 0;">${methodLabel}</td>
      </tr>
      <tr>
        <td style="color: #8a8078; font-size: 13px; padding: 3px 0;">${L.statusLabel}</td>
        <td style="color: #4a423d; font-size: 13px; text-align: right; padding: 3px 0;">${statusLabel}</td>
      </tr>
      <tr>
        <td style="color: #8a8078; font-size: 13px; padding: 3px 0;">${L.pickup}</td>
        <td style="color: #4a423d; font-size: 13px; text-align: right; padding: 3px 0;">${order.pickup_date || '—'}${order.pickup_time ? ' ' + order.pickup_time : ''}</td>
      </tr>
      <tr>
        <td style="color: #8a8078; font-size: 13px; padding: 3px 0;">Order</td>
        <td style="color: #4a423d; font-size: 13px; text-align: right; padding: 3px 0; font-weight: 600;">#${order.id}</td>
      </tr>${notesRow}
    </table>

    <table style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr>
          <th style="text-align: left; color: #8a8078; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; padding-bottom: 8px; border-bottom: 2px solid #1e4636;">${L.item}</th>
          <th style="text-align: center; color: #8a8078; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; padding-bottom: 8px; border-bottom: 2px solid #1e4636;">${L.qty}</th>
          <th style="text-align: right; color: #8a8078; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; padding-bottom: 8px; border-bottom: 2px solid #1e4636;">${L.amount}</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
      <tfoot>${discountRows}
        <tr>
          <td colspan="2" style="padding: 14px 0 4px; color: #1e4636; font-size: 15px; font-weight: 700;">${L.total}</td>
          <td style="padding: 14px 0 4px; color: #1e4636; font-size: 18px; font-weight: 700; text-align: right;">${total}</td>
        </tr>
      </tfoot>
    </table>
  </div>

  <div style="padding: 20px 32px 28px;">
    <p style="color: #8a8078; font-size: 13px; line-height: 1.6; margin: 0 0 6px;">${L.contact}</p>
    <p style="color: #b8ada2; font-size: 12px; margin: 14px 0 0; text-align: center;">${L.footer}</p>
  </div>

</div>
</div>`;
}
