# Quote Deposit — Pay-in-Full Option — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let quote customers choose to pay the full amount instead of just the 50% deposit on `pay-quote.html`.

**Architecture:** Client selection (`payMode`) flows through both checkout endpoints; amounts stay server-computed from D1. Orders API needed only a confirmation-email wording tweak (conversion already handles full payments → `payment_status='paid'`).

**Spec:** addendum in `docs/superpowers/specs/2026-09-03-quote-deposit-payment-design.md` (2026-09-04).

## Global Constraints

- Amounts still always server-computed: `mode === 'full' ? quote.total_cents : quote.deposit_cents`.
- Bilingual EN/ES strings via the existing `STR` dict; `es` default unchanged.
- `mode` is optional everywhere it appears; default `'deposit'` (backward compatible with already-sent emails).
- Stage ONLY the three files per task; owner WIP (`index.html`, `style.css`, `slideshow-sample.html`) never touched.

---

### Task 1: Pay-in-full option (page + checkout worker + email wording)

**Files:**
- Modify: `pay-quote.html`
- Modify: `workers/checkout.js`
- Modify: `orders/workers/api.js` (`sendDepositConfirmationEmail` only)

**Interfaces:**
- `POST /quote-deposit/checkout` body gains optional `mode: 'deposit'|'full'` (default deposit) → Stripe session `unit_amount` = server value for that mode; `metadata[mode]` set; line name `Muy Rico — Quote #N Full Payment` when full.
- `POST /quote-deposit/paypal-capture` body gains optional `mode` (same default) — verified amount = mode's server value, exact match required.
- Webhook paths unchanged (Stripe `amount_total` authoritative; PayPal capture amount authoritative).

- [ ] **Step 1: pay-quote.html**

1. In the `STR` dict, add per language:

en:
```js
    fullLabel: (amt) => `Pay in full — ${amt}`,
```
es:
```js
    fullLabel: (amt) => `Pago completo — ${amt}`,
```

2. In `payBody()`, replace the card-button line:

```js
    <button class="btn-pay" id="btnCard">${esc(s.payCard(money(quote.deposit_cents)))}</button>
```

with:

```js
    <div class="mode-group">
      <label class="mode"><input type="radio" name="paymode" value="deposit" ${payMode === 'deposit' ? 'checked' : ''}><span>${esc(s.deposit)} · ${money(quote.deposit_cents)}</span></label>
      <label class="mode"><input type="radio" name="paymode" value="full" ${payMode === 'full' ? 'checked' : ''}><span>${esc(s.fullLabel(money(quote.total_cents)))}</span></label>
    </div>
    <button class="btn-pay" id="btnCard">${esc(s.payCard(money(chargeCents())))}</button>
```

3. Add CSS after the `.divider` rule:

```css
  .mode { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: 1.5px solid #e3dcd2; border-radius: 8px; margin-bottom: 8px; font-size: 14px; cursor: pointer; color: #4a423d; }
  .mode input { accent-color: #2d7a46; margin: 0; }
  .mode input:checked + span { font-weight: 700; color: #2c2523; }
```

4. After `let state = 'loading';` add:

```js
let payMode = 'deposit';
function chargeCents() { return payMode === 'full' ? quote.total_cents : quote.deposit_cents; }
```

5. In `payByCard`, the POST body becomes:

```js
      body: JSON.stringify({ id: Number(QUOTE_ID), token: TOKEN, origin: location.origin, mode: payMode }),
```

6. In `wirePayButtons()`, at the top, add the radio listeners:

```js
  document.querySelectorAll('input[name="paymode"]').forEach((r) =>
    r.addEventListener('change', (e) => {
      payMode = e.target.value === 'full' ? 'full' : 'deposit';
      const btn = document.getElementById('btnCard');
      if (btn) btn.textContent = t().payCard(money(chargeCents()));
    })
  );
```

7. In `renderPayPal`'s `createOrder`, the amount becomes:

```js
          amount: { value: (chargeCents() / 100).toFixed(2) },
```

8. In the PayPal `onApprove` capture POST body, add the mode:

```js
            body: JSON.stringify({ id: quote.id, token: TOKEN, paypalOrderId: data.orderID, mode: payMode }),
```

- [ ] **Step 2: workers/checkout.js**

1. In `handleQuoteDepositCheckout`, replace the destructuring + first guard, and the `const base =` line region through the `unit_amount` line:

Current:
```js
  const { id, token, origin } = await request.json();
  if (!id || !token) return json({ error: "id and token required" }, 400);
```

New:
```js
  const { id, token, origin, mode } = await request.json();
  if (!id || !token) return json({ error: "id and token required" }, 400);
  if (mode !== undefined && mode !== "deposit" && mode !== "full") {
    return json({ error: "Invalid mode" }, 400);
  }
```

Then after the `loadPayableQuote` block, replace the pricing lines:

Current:
```js
  params.append("line_items[0][price_data][product_data][name]", `Muy Rico — Quote #${id} Deposit (50%)`);
  params.append("line_items[0][price_data][unit_amount]", String(quote.deposit_cents));
```

New:
```js
  const chargeCents = mode === "full" ? quote.total_cents : quote.deposit_cents;
  params.append("line_items[0][price_data][product_data][name]",
    mode === "full" ? `Muy Rico — Quote #${id} Full Payment` : `Muy Rico — Quote #${id} Deposit (50%)`);
  params.append("line_items[0][price_data][unit_amount]", String(chargeCents));
```

And after the `metadata[token]` line add:

```js
  params.append("metadata[mode]", mode === "full" ? "full" : "deposit");
```

2. In `handleQuoteDepositPayPalCapture`, replace:

```js
  const { id, token, paypalOrderId } = await request.json();
  if (!id || !token || !paypalOrderId) return json({ error: "id, token and paypalOrderId required" }, 400);
```

with:

```js
  const { id, token, paypalOrderId, mode } = await request.json();
  if (!id || !token || !paypalOrderId) return json({ error: "id, token and paypalOrderId required" }, 400);
  if (mode !== undefined && mode !== "deposit" && mode !== "full") {
    return json({ error: "Invalid mode" }, 400);
  }
```

and replace the amount-check lines:

Current:
```js
  const ppCents = Math.round(parseFloat(paypalOrder.purchase_units?.[0]?.amount?.value || "0") * 100);
  if (ppCents !== quote.deposit_cents) {
```

New:
```js
  const ppCents = Math.round(parseFloat(paypalOrder.purchase_units?.[0]?.amount?.value || "0") * 100);
  const expectedCents = mode === "full" ? quote.total_cents : quote.deposit_cents;
  if (ppCents !== expectedCents) {
```

(the `console.error` line inside that if may keep referencing `quote.deposit_cents`; update its message to reference `expectedCents` for accuracy.)

- [ ] **Step 3: orders/workers/api.js — confirmation email balance row**

In `sendDepositConfirmationEmail`, replace:

```js
  const balanceCents = quote.quoted_price != null ? quote.quoted_price - depositCents : null;
```

with:

```js
  const balanceCents = quote.quoted_price != null ? Math.max(quote.quoted_price - depositCents, 0) : null;
  const paidInFull = balanceCents === 0;
```

and replace the `rows` array construction:

```js
  const rows = [
    [isEn ? 'Deposit paid' : 'Depósito pagado', `<strong>${deposit}</strong>`],
    balanceCents != null ? [isEn ? 'Balance due at pickup' : 'Restante al recoger', `$${(balanceCents / 100).toFixed(2)}`] : null,
    quote.desired_date ? [isEn ? 'Date' : 'Fecha', escapeHtml(quote.desired_date)] : null,
  ].filter(Boolean).map(...)
```

with:

```js
  const rows = [
    [isEn ? (paidInFull ? 'Amount paid' : 'Deposit paid') : (paidInFull ? 'Monto pagado' : 'Depósito pagado'), `<strong>${deposit}</strong>`],
    balanceCents != null && balanceCents > 0
      ? [isEn ? 'Balance due at pickup' : 'Restante al recoger', `$${(balanceCents / 100).toFixed(2)}`]
      : [isEn ? 'Paid in full' : 'Pagado por completo', isEn ? 'Nothing due at pickup' : 'Nada pendiente al recoger'],
    quote.desired_date ? [isEn ? 'Date' : 'Fecha', escapeHtml(quote.desired_date)] : null,
  ].filter(Boolean).map(...)
```

(Fallback edge: if `quoted_price` is null, `paidInFull` is false and the first row keeps the legacy label while the second row shows "Paid in full" — only reachable on a logic bug; harmless.)

- [ ] **Step 4: Verify**

- `cd orders && npx vitest run` → 70/70 green.
- `npx wrangler deploy --dry-run -c orders/wrangler.toml` and `npx wrangler deploy --dry-run -c workers/wrangler.toml` from repo root → compile.
- pay page: extract `<script>` → `node --check` passes.
- Local orders API: `cd orders && npx -y wrangler@4.127.0 dev --config wrangler.toml --port 8788`. With a fresh priced quote:
  - `POST /api/quotes/:id/deposit-paid` with `amount_cents` = full price → 200, created order has `payment_status = "paid"` and a payments row of the full amount (verify via local D1) — SEED SECRET from orders/.dev.vars.
  - Replay same ref → `already: true`.

- [ ] **Step 5: Commit**

```bash
git add pay-quote.html workers/checkout.js orders/workers/api.js
git commit -m "feat(deposit): pay-in-full option on quote pay page (stripe + paypal)"
```
