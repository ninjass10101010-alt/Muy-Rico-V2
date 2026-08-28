# Mini Cupcakes Product + Judi Vanderstelt Special Order — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Duncan Hines mix + "Mini Cupcakes (12)" product + Judy Vanderstelt customer record to the live system, create her special order (48 minis, charged 36 → $72, for The Content Cove), and produce its invoice + labels.

**Architecture:** One additive D1 migration (inventory item + ingredient group + product + customer), one tested refactor of the receipt renderer into a pure module with invoice enhancements (subtotal/discount/notes + unpaid wording), then order creation through the existing public `POST /api/orders` (which auto-generates labels and notifications) plus D1 touch-ups for `created_by` and the printable invoice row.

**Tech Stack:** Cloudflare Workers (`orders/workers/api.js`), D1 (SQLite) via `wrangler d1 execute`, Vitest unit tests (`orders/tests/`), curl against the public API.

**Spec:** `docs/superpowers/specs/2026-08-27-mini-cupcakes-product-and-order-design.md`

## Global Constraints

- Product ingredient labels are **brand-free** (raw sub-ingredients only — migration 0011 convention, Michigan Cottage Food Law).
- All migration inserts use `INSERT OR IGNORE` (idempotent re-runs).
- Mini cupcakes sell **by the dozen only** ($24, `pack_sizes = '[]'`) so deduction and prep-list engines agree.
- Recipe uses **0.24 box of mix per dozen** (owner yield: 0.3 oz dry mix per mini).
- Order totals are stored in **cents**: subtotal 9600, discount 2400, total 7200.
- Customer name is exactly **Judy Vanderstelt**; business note is exactly **Order for business: The Content Cove.**
- Remote D1 commands always use `-c orders/wrangler.toml --remote`; local ones use `--local`.
- Do not touch the unrelated modified file `home-bakery-management-system/src/utils/labelRasterPdf.ts`.

---

### Task 1: Extract receipt renderer into tested module + invoice enhancements

**Files:**
- Create: `orders/workers/receipt-html.js`
- Create: `orders/tests/receipt-html.test.js`
- Modify: `orders/workers/api.js` (add import near line 63; delete the three functions spanning lines 900–1062: `buildMethodLabel`, `formatStatusLabel`, `buildReceiptHtml`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `orders/workers/receipt-html.js` exporting `buildMethodLabel(order, isEn) → string`, `formatStatusLabel(status, isEn) → string`, `buildReceiptHtml(order, isEn) → string` (HTML). `api.js` imports all three; behavior for existing paid receipts is unchanged except an additive notes row when `order.notes` is non-empty.

- [ ] **Step 1: Baseline — existing worker tests pass**

Run: `cd orders && npm test`
Expected: PASS (3 test files: enrich-lib, groups-lib, order-date). If anything fails before our change, stop and investigate.

- [ ] **Step 2: Write the failing tests**

Create `orders/tests/receipt-html.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { buildMethodLabel, buildReceiptHtml, formatStatusLabel } from '../workers/receipt-html.js';

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

describe('buildMethodLabel / formatStatusLabel', () => {
  it('keeps existing labels', () => {
    expect(buildMethodLabel({ payment_method: 'cash' }, true)).toBe('Cash');
    expect(buildMethodLabel({ payment_method: 'cash' }, false)).toBe('Efectivo');
    expect(buildMethodLabel({ payment_method: 'venmo' }, true)).toBe('Venmo');
    expect(formatStatusLabel('pending', true)).toBe('Pending');
    expect(formatStatusLabel('pending', false)).toBe('Pendiente');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd orders && npm test`
Expected: FAIL — `Cannot find module '../workers/receipt-html.js'`.

- [ ] **Step 4: Create `orders/workers/receipt-html.js`**

The two small helpers are moved verbatim from `api.js`; `buildReceiptHtml` is moved with three enhancements: payment-status-aware wording, subtotal/discount footer rows, and an HTML-escaped notes row.

```js
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
```

**Important:** the items-table header in the template below references `${L.item}`, `${L.qty}`, `${L.amount}` — these keys are already included in both `L` dictionaries above (`item/qty/amount`), so the template works as-is.

- [ ] **Step 5: Repoint `api.js` at the module**

In `orders/workers/api.js`:

1. Add the import next to the other pure-module imports (currently lines 63–66):

```js
import { buildMethodLabel, buildReceiptHtml, formatStatusLabel } from './receipt-html.js';
```

2. Delete the three now-duplicated function definitions: everything from `function buildMethodLabel(order, isEn) {` (line ~900) through the closing `}` of `buildReceiptHtml` (line ~1062, immediately before `async function sendCustomerConfirmation(env, order) {`). Do not delete or modify `sendCustomerConfirmation` or anything after it.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd orders && npm test`
Expected: PASS — 4 test files, including `receipt-html.test.js` (7 tests).

- [ ] **Step 7: Commit**

```bash
git add orders/workers/receipt-html.js orders/tests/receipt-html.test.js orders/workers/api.js
git commit -m "feat(receipts): extract receipt renderer; invoice wording, subtotal/discount, notes"
```

---

### Task 2: Migration 0042 — Duncan Hines mix, Mini Cupcakes product, Judy customer

**Files:**
- Create: `orders/migrations/0042_mini_cupcakes.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: D1 rows used by later tasks — `inventory.id = 'inv_duncan_hines_chocolate'`, `ingredient_groups.id = 'grp_inv_duncan_hines_chocolate'`, `products.id = 'prod_mini_cupcakes'`, `customers.id = 'cust_judyvanderstelt'`.

- [ ] **Step 1: Write the migration**

Create `orders/migrations/0042_mini_cupcakes.sql`:

```sql
-- Muy Rico — Migration 0042
-- Mini Cupcakes product + Duncan Hines chocolate mix + customer record for Judy Vanderstelt.
-- Spec: docs/superpowers/specs/2026-08-27-mini-cupcakes-product-and-order-design.md
--
-- Run:
--   npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --local  --file=orders/migrations/0042_mini_cupcakes.sql
--   npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0042_mini_cupcakes.sql

-- ── Duncan Hines Perfectly Moist Dark Chocolate Fudge Cake Mix ───────────────
-- Barcode 0644209307562 (Open Food Facts). Brand-free ingredients label per 0011 convention.
INSERT OR IGNORE INTO inventory
  (id, name, category, quantity, unit, reorder_level, cost_per_unit, supplier,
   ingredients_label, allergens, unit_weight, active, barcode, group_id)
VALUES
  ('inv_duncan_hines_chocolate',
   'Duncan Hines Perfectly Moist Dark Chocolate Fudge Cake Mix',
   'Baking', 3, 'box', 2, 2.50, NULL,
   'Sugar, Enriched Bleached Wheat Flour (wheat flour, niacin, reduced iron, thiamine mononitrate, riboflavin, folic acid), Emulsified Palm Shortening (palm oil, propylene glycol mono- and diesters of fats and fatty acids, mono- and diglycerides, sodium stearoyl lactylate), Cocoa Powder Processed with Alkali, Dextrose, Leavening (baking soda, dicalcium phosphate, sodium aluminum phosphate, monocalcium phosphate), Contains 2% or less of: Wheat Starch, Salt, Cellulose Gum, Xanthan Gum.',
   '["Wheat"]', 0.95, 1, '0644209307562', 'grp_inv_duncan_hines_chocolate');

INSERT OR IGNORE INTO ingredient_groups (id, name, category, active_item_id)
VALUES ('grp_inv_duncan_hines_chocolate',
        'Duncan Hines Perfectly Moist Dark Chocolate Fudge Cake Mix',
        'Baking', 'inv_duncan_hines_chocolate');

-- ── Mini Cupcakes (12) — sold by the dozen, $24, no pack sizes ───────────────
-- Recipe per DOZEN: 0.24 box of mix (owner yield 0.3 oz dry mix per mini cupcake);
-- non-mix quantities mirror prod_cupcakes' per-6-pack values (a dozen minis ≈
-- same batter as a half-dozen regular cupcakes).
INSERT OR IGNORE INTO products
  (id, name, name_es, description, description_es, category, price, cost, sku, emoji, image_url,
   active, show_online, ingredients, allergens, flavors, pack_sizes, recipe,
   flavor_deduction_map, display_order, auto_generate_label, featured)
VALUES
  ('prod_mini_cupcakes',
   'Mini Cupcakes (12)', 'Mini Cupcakes (12)',
   'One dozen mini cupcakes made fresh to order. Choose your cake flavor and frosting. One flavor per dozen.',
   'Una docena de mini cupcakes hechos frescos a pedido. Elige el sabor del pastel y el betún. Un sabor por docena.',
   'Cupcakes', 24, 5, 'MR-MCUP12', 'cupcake.svg', NULL,
   1, 1,
   'Enriched Flour Bleached (wheat flour, niacin, iron, thiamin mononitrate, riboflavin, folic acid), sugar, corn syrup, cocoa processed with alkali, leavening (baking soda, sodium aluminum phosphate, monocalcium phosphate, dicalcium phosphate), emulsified palm shortening (palm oil, propylene glycol mono- and diesters of fats and fatty acids, mono- and diglycerides, sodium stearoyl lactylate), dextrose, modified corn starch, corn starch, wheat starch, salt, cellulose gum, xanthan gum, natural and artificial flavor, water, butter (cream, salt), eggs, vanilla extract. Frosting: sugar, palm oil, water, corn syrup, canola oil, corn starch, cocoa (processed with alkali), and 2% or less of: mono- and diglycerides, natural and artificial flavor, modified corn starch, cellulose gel, salt, propylene glycol monostearate, carrageenan, polysorbate 80, potassium sorbate (preservative), cellulose gum, citric acid, sodium stearoyl lactylate, antioxidants (ascorbyl palmitate, mixed tocopherols, chamomile and rosemary extracts). Strawberry variety additionally contains: Red 40.',
   'Contains: wheat, milk, eggs. Strawberry variety contains Red 40 artificial color.',
   '[{"name":"Pastel","name_es":"Pastel","options":["Chocolate","Vainilla","Fresa","Funfetti","Red Velvet","Marmoleado","Limón"]},{"name":"Betún","name_es":"Betún","options":["Betún de Vainilla","Betún de Chocolate"]}]',
   '[]',
   '[{"inventoryItemId":"inv_betty_crocker_vanilla","qtyPerUnit":0.24},{"inventoryItemId":"inv_duncan_hines_chocolate","qtyPerUnit":0.24},{"inventoryItemId":"inv_betty_crocker_strawberry","qtyPerUnit":0.24},{"inventoryItemId":"inv_butter","qtyPerUnit":0.0625},{"inventoryItemId":"inv_eggs","qtyPerUnit":0.0625},{"inventoryItemId":"inv_vanilla","qtyPerUnit":0.025},{"inventoryItemId":"inv_frosting_vanilla","qtyPerUnit":0.083},{"inventoryItemId":"inv_frosting_chocolate","qtyPerUnit":0.083}]',
   '{"Cake":{"Chocolate":["inv_duncan_hines_chocolate"],"Vanilla":["inv_betty_crocker_vanilla"],"Strawberry":["inv_betty_crocker_strawberry"],"Funfetti":["inv_betty_crocker_vanilla"],"Red Velvet":["inv_duncan_hines_chocolate"],"Marble":["inv_duncan_hines_chocolate"],"Lemon":["inv_betty_crocker_vanilla"]},"Frosting":{"Vanilla Buttercream":["inv_frosting_vanilla"],"Chocolate Buttercream":["inv_frosting_chocolate"]}}',
   75, 1, 0);

-- ── Customer: Judy Vanderstelt (from website order #19, 2026-07-18) ──────────
INSERT OR IGNORE INTO customers (id, name, phone, email, notes, created_at, active, phone_normalized)
VALUES ('cust_judyvanderstelt', 'Judy Vanderstelt', '6162600225', NULL,
        'Website order 2026-07-18 (order #19, completed/paid via Stripe). Orders for The Content Cove (photography business). 2026-08-29 special order: 48 mini cupcakes delivered, 36 charged — service recovery for the July misunderstanding.',
        datetime('now'), 1, '6162600225');
```

- [ ] **Step 2: Mirror production data into the local D1**

```bash
npx wrangler d1 export muy-rico-orders -c orders/wrangler.toml --remote --output=/tmp/muyrico-backup.sql
rm -rf orders/.wrangler/state/v3/d1   # reset any stale local DB
npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --local --file=/tmp/muyrico-backup.sql
```

Expected: export writes the dump; both execute runs finish with no errors. Sanity-check the mirror:

```bash
npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --local --command "SELECT COUNT(*) AS n FROM products; SELECT id, quantity FROM inventory WHERE id = 'inv_betty_crocker_vanilla'"
```

Expected: product count matches production (≥ 10); `inv_betty_crocker_vanilla` quantity = 0.75.

- [ ] **Step 3: Apply the migration locally and verify**

```bash
npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --local --file=orders/migrations/0042_mini_cupcakes.sql
```

Then verify all four rows:

```bash
npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --local --command "SELECT id, name, quantity, barcode, group_id FROM inventory WHERE id = 'inv_duncan_hines_chocolate'; SELECT id FROM ingredient_groups WHERE id = 'grp_inv_duncan_hines_chocolate'; SELECT id, name, price, pack_sizes FROM products WHERE id = 'prod_mini_cupcakes'; SELECT id, name, phone FROM customers WHERE id = 'cust_judyvanderstelt'"
```

Expected: DH item (quantity 3, barcode 0644209307562), group row, product row (price 24, `pack_sizes = '[]'`), customer row (phone 6162600225).

- [ ] **Step 4: Verify idempotency**

Run the same migration file a second time (same command as Step 3).
Expected: no errors (INSERT OR IGNORE), row counts unchanged.

- [ ] **Step 5: Commit**

```bash
git add orders/migrations/0042_mini_cupcakes.sql
git commit -m "feat(db): mini cupcakes product, Duncan Hines mix, Judy Vanderstelt customer"
```

---

### Task 3: Local end-to-end dry run (order → invoice → labels → deduction)

**Files:** none modified (verification only, against the local D1 from Task 2).

**Interfaces:**
- Consumes: local D1 with migration 0042 applied; `wrangler dev` server where localhost is treated as authenticated.
- Produces: confidence that the remote run (Tasks 4–5) will behave identically.

- [ ] **Step 1: Write the order payload file**

Create `/tmp/mini-order.json`:

```json
{
  "customer_name": "Judy Vanderstelt",
  "customer_id": "cust_judyvanderstelt",
  "phone": "6162600225",
  "pickup_date": "2026-08-29",
  "pickup_time": "09:00",
  "items_json": [
    {
      "name": "Mini Cupcakes (12) (Cake: Vanilla, Frosting: Vanilla Buttercream)",
      "name_en": "Mini Cupcakes (12) (Cake: Vanilla, Frosting: Vanilla Buttercream)",
      "name_es": "Mini Cupcakes (12) (Pastel: Vainilla, Betún: Betún de Vainilla)",
      "qty": 2, "price": 24,
      "productId": "prod_mini_cupcakes",
      "flavorNote": " (Cake: Vanilla, Frosting: Vanilla Buttercream)",
      "emoji": "cupcake.svg"
    },
    {
      "name": "Mini Cupcakes (12) (Cake: Chocolate, Frosting: Chocolate Buttercream)",
      "name_en": "Mini Cupcakes (12) (Cake: Chocolate, Frosting: Chocolate Buttercream)",
      "name_es": "Mini Cupcakes (12) (Pastel: Chocolate, Betún: Betún de Chocolate)",
      "qty": 2, "price": 24,
      "productId": "prod_mini_cupcakes",
      "flavorNote": " (Cake: Chocolate, Frosting: Chocolate Buttercream)",
      "emoji": "cupcake.svg"
    }
  ],
  "total_cents": 7200,
  "subtotal_cents": 9600,
  "discount_cents": 2400,
  "payment_method": "cash",
  "payment_status": "unpaid",
  "status": "pending",
  "notes": "Order for business: The Content Cove.",
  "source": "in-person",
  "language": "es"
}
```

- [ ] **Step 2: Start the worker locally**

Run (in a background shell): `cd orders && npx wrangler dev --port 8787`
Expected: server ready on `http://localhost:8787`.

- [ ] **Step 3: Create the order locally**

```bash
curl -s -X POST http://localhost:8787/api/orders -H 'Content-Type: application/json' -d @/tmp/mini-order.json
```

Expected: `{"ok":true,"id":<N>}` with HTTP 201. Note the id as `<N>`.

- [ ] **Step 4: Verify order row + auto-generated labels**

```bash
npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --local --command "SELECT id, customer_name, customer_id, total_cents, subtotal_cents, discount_cents, payment_status, status, notes FROM orders WHERE id = <N>; SELECT name, product_id, price FROM label_templates WHERE name LIKE 'MR-<N>%'"
```

Expected: order row with totals 7200/9600/2400, customer_id `cust_judyvanderstelt`, notes "Order for business: The Content Cove."; **two** label rows named `MR-<N> - Mini Cupcakes (12) (Cake: Vanilla, Frosting: Vanilla Buttercream)` and `MR-<N> - Mini Cupcakes (12) (Cake: Chocolate, Frosting: Chocolate Buttercream)`, each with `product_id = 'prod_mini_cupcakes'` and price `$24.00`.

- [ ] **Step 5: Generate the receipt and verify the invoice HTML**

```bash
curl -s -X POST http://localhost:8787/api/orders/<N>/generate-receipt
```

Expected: `{"ok":true,"receiptId":"rcpt_<N>_…","status":"printed",…}` (no email on file → `printed`).

```bash
RID=$(curl -s "http://localhost:8787/api/receipts?order_id=<N>" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
curl -s "http://localhost:8787/api/receipts/$RID/html" > /tmp/invoice.html
grep -c 'FACTURA\|TOTAL A PAGAR\|Subtotal\|Descuento\|Notas\|The Content Cove' /tmp/invoice.html
```

Expected: all six markers present (grep count ≥ 6 lines; or open `/tmp/invoice.html` in a browser and visually confirm: FACTURA header, two item rows 2 × $24.00 = $48.00 each, Subtotal $96.00, Descuento −$24.00, TOTAL A PAGAR $72.00, Notas row with The Content Cove, pickup 2026-08-29 09:00).

- [ ] **Step 6: Verify flavor-aware deduction math**

```bash
curl -s -X POST http://localhost:8787/api/orders/<N>/deduct
npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --local --command "SELECT id, quantity FROM inventory WHERE id IN ('inv_betty_crocker_vanilla','inv_duncan_hines_chocolate','inv_betty_crocker_strawberry','inv_frosting_vanilla','inv_frosting_chocolate','inv_butter','inv_eggs') ORDER BY id"
```

Expected deltas (local mirror values): `inv_betty_crocker_vanilla` 0.75 → **0.27**; `inv_duncan_hines_chocolate` 3 → **2.52**; `inv_frosting_vanilla` 5.09 → **4.92**; `inv_frosting_chocolate` 4.73 → **4.56**; `inv_betty_crocker_strawberry`, `inv_butter`, `inv_eggs` **unchanged**.

- [ ] **Step 7: Stop the dev server**

Kill the `wrangler dev` process from Step 2.

No commit (verification-only task).

---

### Task 4: Deploy worker + apply migration to production

**Files:** none modified (deploy + remote DDL).

**Interfaces:**
- Consumes: Task 1 commit (receipt module) and Task 2 migration file.
- Produces: live worker with invoice template; production D1 rows for DH mix, group, product, customer.

- [ ] **Step 1: Full worker test suite**

Run: `cd orders && npm test`
Expected: all tests PASS.

- [ ] **Step 2: Deploy the orders worker**

Run: `npx wrangler deploy -c orders/wrangler.toml`
Expected: successful deploy of `muy-rico-orders-api` (no errors; note the published version).

- [ ] **Step 3: Apply migration 0042 to remote D1**

```bash
npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0042_mini_cupcakes.sql
```

Expected: 4 statements executed, no errors.

- [ ] **Step 4: Verify production rows**

```bash
npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --command "SELECT id, quantity FROM inventory WHERE id = 'inv_duncan_hines_chocolate'; SELECT id FROM ingredient_groups WHERE id = 'grp_inv_duncan_hines_chocolate'; SELECT id, name, price FROM products WHERE id = 'prod_mini_cupcakes'; SELECT id, name FROM customers WHERE id = 'cust_judyvanderstelt'"
```

Expected: all four rows present. Also confirm the public API serves the product:

```bash
curl -s https://muy-rico-orders-api.bexgarcia0208.workers.dev/api/products | grep -o 'prod_mini_cupcakes' | head -1
```

Expected: `prod_mini_cupcakes`.

No commit (nothing changed in the repo).

---

### Task 5: Create the real order + invoice row + final verification

**Files:** none modified in the repo (remote data operations).

**Interfaces:**
- Consumes: live product `prod_mini_cupcakes`, customer `cust_judyvanderstelt`, deployed invoice template.
- Produces: the real order (id `<N>`), its two labels, its printable invoice row; final report to the owner.

- [ ] **Step 1: Create the order via the public API**

```bash
curl -s -X POST https://muy-rico-orders-api.bexgarcia0208.workers.dev/api/orders -H 'Content-Type: application/json' -d @/tmp/mini-order.json
```

Expected: `{"ok":true,"id":<N>}`. Record `<N>` — used in every following step. (Owner Telegram/email notification fires here — expected.)

- [ ] **Step 2: Touch up `created_by` (public POST stamps 'website')**

```bash
npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --command "UPDATE orders SET created_by = 'bexgarcia0208' WHERE id = <N>"
```

Expected: 1 row changed.

- [ ] **Step 3: Insert the printable invoice row (mirrors `logReceiptWithId` with status 'printed')**

```bash
npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --command "INSERT INTO receipts (id, order_id, order_number, customer_name, email, items_json, total_cents, payment_method, payment_sub_method, order_status, status, message_id, language, sent_at, created_at) SELECT 'rcpt_<N>_manual', id, 'MR-' || id, customer_name, email, items_json, total_cents, payment_method, payment_sub_method, status, 'printed', NULL, language, datetime('now'), datetime('now') FROM orders WHERE id = <N>; INSERT INTO order_events (order_id, actor, event) VALUES (<N>, 'system', 'receipt:printed')"
```

Expected: both statements succeed (INSERT … SELECT copies the exact stored items_json, so no manual escaping needed).

- [ ] **Step 4: Final verification**

```bash
npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --command "SELECT id, customer_name, customer_id, pickup_date, pickup_time, subtotal_cents, discount_cents, total_cents, payment_method, payment_status, status, notes, created_by, language, inventory_deducted FROM orders WHERE id = <N>; SELECT name FROM label_templates WHERE name LIKE 'MR-<N>%' AND active = 1; SELECT id, status, language FROM receipts WHERE order_id = <N>; SELECT id, quantity FROM inventory WHERE id IN ('inv_betty_crocker_vanilla','inv_duncan_hines_chocolate')"
```

Expected:
- Order: customer_id `cust_judyvanderstelt`, pickup 2026-08-29 09:00, subtotal 9600 / discount 2400 / total 7200, cash/unpaid/pending, notes "Order for business: The Content Cove.", created_by `bexgarcia0208`, language `es`, `inventory_deducted = 0`.
- Two active labels for `MR-<N>` (vanilla + chocolate lines).
- One receipt row, status `printed`, language `es`.
- Inventory **unchanged** (0.75 BC vanilla / 3 DH) — deduction happens only when the owner completes the order.

- [ ] **Step 5: Report to the owner**

Provide:
- Order number `MR-<N>` and where to find it (dashboard → Orders).
- Invoice: dashboard → Receipts → open `MR-<N>` → print (Spanish, FACTURA, Subtotal $96 − Descuento $24 = TOTAL A PAGAR $72, notes "Order for business: The Content Cove.").
- Labels: two auto-generated labels (`MR-<N> - Mini Cupcakes (12) …`) in Label Studio, ready to print.
- Restock warning: **BC Vanilla is at 0.75 box; completing this order drops it to ~0.27 — restock vanilla mix before Saturday.**
- Reminder: marking the order completed deducts 0.48 box BC vanilla + 0.48 box Duncan Hines + frosting.

No commit (nothing changed in the repo).

---

## Self-Review Notes

- **Spec coverage:** §5.1 → Task 2; §5.2 → Task 1; §5.3 → Tasks 3/5 (payload file shared); §5.4 → Task 5 Step 3; §6 → Task 3 Step 6 (local) + Task 5 Step 4 (remote unchanged check); §7 → Tasks 3–5; §8 → task order 1→2→3→4→5. ✓
- **Placeholder scan:** only runtime values (`<N>`, `<RID>`) which are captured from real command output at execution time. ✓
- **Type/name consistency:** `inv_duncan_hines_chocolate`, `grp_inv_duncan_hines_chocolate`, `prod_mini_cupcakes`, `cust_judyvanderstelt`, `rcpt_<N>_manual` used identically across all tasks; exported names `buildMethodLabel/formatStatusLabel/buildReceiptHtml` match the import in Task 1 Step 5. ✓
- **Known deviation from spec (improvement):** spec §5.2 said "single function edit"; the plan extracts the renderer into `orders/workers/receipt-html.js` (repo's established pure-module pattern: customer-match.js, order-date.js, groups-lib.js) to make it unit-testable. Behavior and scope are unchanged.
