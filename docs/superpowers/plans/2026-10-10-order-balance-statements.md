# Order Balance Statements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins send branded balance-statement emails for overdue unpaid orders, and let customers pay the remaining balance online through a secure per-order link that records the payment on the order's own ledger.

**Architecture:** A new pure rules lib (`order-statements-lib.js`) and statement renderer (extension of `receipt-html.js`), two admin API routes + one public balance route + one webhook-guarded payment route in the orders worker, mirroring the existing invoice pay rails in `workers/checkout.js`, a new static pay page (`pay-order.html`), and admin one-click/bulk actions in `Orders.tsx`.

**Tech Stack:** Cloudflare Workers + D1 (SQLite), Resend email API, Stripe Checkout + PayPal Smart Buttons (both already wired in `workers/checkout.js`), React 19 + Vite + Tailwind admin SPA, Vitest (workers), Playwright (local verification).

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-10-10-order-balance-statements-design.md` — read it before starting.
- TDD: every worker/pure-lib change starts with a failing test (see existing `orders/tests/*.test.js` patterns).
- `payments.amount` is **REAL dollars**; every other money column is **INTEGER cents**. Convert with `Math.round(Number(amount) * 100)` on read (see `payment-ledger-lib.js`). Never mix.
- Balance = `total_cents − Σ active payments` (integer cents), floored at 0. Never trust client amounts.
- Full remaining balance only online (no partial entry). No automatic/scheduled sends in v1.
- Statements: EN (`order.language === 'en'`) / ES (default) using `name_en`/`name_es` item resolution, exactly like receipts.
- Public pay links use a 32-hex token (`orders.pay_token`); webhook writes are guarded by `X-Webhook-Secret`; admin routes use the existing Access/device-token auth.
- Deploy order (final task): migration 0050 → 0051 → orders API → checkout worker → assets. Do not deploy before the owner approves the pending deploy batch.
- Commit after every green task; message style follows repo history (`feat(statements): ...`, `test(statements): ...`).

---

### Task 1: Migration 0051 — pay token, payment refs, statements log

**Files:**
- Create: `orders/migrations/0051_order_balance_statements.sql`

**Interfaces:**
- Produces: `orders.pay_token TEXT`, `payments.ref TEXT` (+ unique partial index), `order_statements` table — everything later tasks rely on.

- [ ] **Step 1: Write the migration**

```sql
-- Order balance statements: a stable per-order pay token, gateway refs on
-- payments for idempotent webhooks, and a statement send log.
-- Run:
--   npx -y wrangler@4.127.0 d1 execute muy-rico-orders --config orders/wrangler.toml --local --file=orders/migrations/0051_order_balance_statements.sql
--   npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0051_order_balance_statements.sql

ALTER TABLE orders ADD COLUMN pay_token TEXT;

ALTER TABLE payments ADD COLUMN ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_ref ON payments(ref) WHERE ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_statements (
  id            TEXT PRIMARY KEY,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  email         TEXT,
  language      TEXT NOT NULL DEFAULT 'es',
  total_cents   INTEGER NOT NULL,
  paid_cents    INTEGER NOT NULL,
  balance_cents INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'sent',
  message_id    TEXT,
  sent_by       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_order_statements_order
  ON order_statements(order_id, created_at DESC);
```

- [ ] **Step 2: Apply locally and verify**

Run: `npx -y wrangler@4.127.0 d1 execute muy-rico-orders --config orders/wrangler.toml --local --file=orders/migrations/0051_order_balance_statements.sql`
Expected: `5 commands executed successfully` (no errors).

Then run: `npx -y wrangler@4.127.0 d1 execute muy-rico-orders --config orders/wrangler.toml --local --command "SELECT name FROM pragma_table_info('order_statements')"`
Expected: rows `id, order_id, customer_name, email, language, total_cents, paid_cents, balance_cents, status, message_id, sent_by, created_at`.

- [ ] **Step 3: Commit**

```bash
git add orders/migrations/0051_order_balance_statements.sql
git commit -m "feat(statements): migration 0051 — pay token, payment refs, statements log"
```

---

### Task 2: Pure eligibility lib — `order-statements-lib.js`

**Files:**
- Create: `orders/workers/order-statements-lib.js`
- Test: `orders/tests/order-statements-lib.test.js`

**Interfaces:**
- Produces (used by Tasks 4–6):
  - `orderBalanceCents(order, activePayments) -> number` (integer cents)
  - `isStatementEligible(order, { balanceCents, today }) -> boolean` (`today` = `'YYYY-MM-DD'`)
  - `selectStatementRecipients(candidates, paymentsByOrder, lastSentByOrder, { today, cooldownHours = 24, cap = 50, now = Date.now() }) -> { send: [{ order, balanceCents }], skipped: { recent, noEmail, notOverdue, paid, cancelled, capped } }`

- [ ] **Step 1: Write the failing tests**

Create `orders/tests/order-statements-lib.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  orderBalanceCents,
  isStatementEligible,
  selectStatementRecipients,
} from '../workers/order-statements-lib.js';

const ORDER = (over = {}) => ({
  id: 65,
  status: 'pending',
  email: 'stacy@example.com',
  pickup_date: '2026-10-07',
  total_cents: 8000,
  ...over,
});

describe('orderBalanceCents', () => {
  it('subtracts active payments (dollars) from the total (cents)', () => {
    expect(orderBalanceCents(ORDER(), [{ amount: 60 }, { amount: 5.5 }])).toBe(1450);
  });
  it('floors at zero on overpayment', () => {
    expect(orderBalanceCents(ORDER(), [{ amount: 100 }])).toBe(0);
  });
  it('treats missing payments as zero', () => {
    expect(orderBalanceCents(ORDER(), undefined)).toBe(8000);
  });
});

describe('isStatementEligible', () => {
  const today = '2026-10-10';
  it('accepts an overdue unpaid order', () => {
    expect(isStatementEligible(ORDER(), { balanceCents: 2000, today })).toBe(true);
  });
  it('accepts completed-but-unpaid orders', () => {
    expect(isStatementEligible(ORDER({ status: 'completed' }), { balanceCents: 2000, today })).toBe(true);
  });
  it('rejects cancelled orders', () => {
    expect(isStatementEligible(ORDER({ status: 'cancelled' }), { balanceCents: 2000, today })).toBe(false);
  });
  it('rejects future/missing pickup dates', () => {
    expect(isStatementEligible(ORDER({ pickup_date: '2026-10-11' }), { balanceCents: 2000, today })).toBe(false);
    expect(isStatementEligible(ORDER({ pickup_date: null }), { balanceCents: 2000, today })).toBe(false);
  });
  it('rejects orders with no email or no balance', () => {
    expect(isStatementEligible(ORDER({ email: '  ' }), { balanceCents: 2000, today })).toBe(false);
    expect(isStatementEligible(ORDER(), { balanceCents: 0, today })).toBe(false);
  });
});

describe('selectStatementRecipients', () => {
  const today = '2026-10-10';
  const orders = [
    ORDER({ id: 1 }),                                    // eligible
    ORDER({ id: 2 }),                                    // reminded 2h ago
    ORDER({ id: 3, email: '' }),                         // no email
    ORDER({ id: 4, pickup_date: '2026-10-12' }),         // not overdue
    ORDER({ id: 5, status: 'cancelled' }),               // cancelled
    ORDER({ id: 6 }),                                    // already paid
  ];
  const paymentsByOrder = { 1: [{ amount: 60 }], 6: [{ amount: 80 }] };
  const lastSentByOrder = { 2: '2026-10-10 08:00:00' };
  const now = Date.parse('2026-10-10T10:00:00Z');

  it('selects eligible orders and counts every skip bucket', () => {
    const { send, skipped } = selectStatementRecipients(
      orders, paymentsByOrder, lastSentByOrder, { today, now }
    );
    expect(send.map((s) => s.order.id)).toEqual([1]);
    expect(send[0].balanceCents).toBe(2000);
    expect(skipped).toMatchObject({ recent: 1, noEmail: 1, notOverdue: 1, cancelled: 1, paid: 1, capped: 0 });
  });

  it('sends again once the cooldown has passed', () => {
    const old = { 2: '2026-10-08 08:00:00' };
    const { send, skipped } = selectStatementRecipients([orders[1]], {}, old, { today, now });
    expect(send.map((s) => s.order.id)).toEqual([2]);
    expect(skipped.recent).toBe(0);
  });

  it('caps the send list and reports the remainder as capped', () => {
    const { send, skipped } = selectStatementRecipients(
      orders.filter((o) => o.id === 1 || o.id === 2), paymentsByOrder, {}, { today, now, cap: 1 }
    );
    expect(send).toHaveLength(1);
    expect(skipped.capped).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd orders && npx vitest run tests/order-statements-lib.test.js`
Expected: FAIL — `Cannot find module '../workers/order-statements-lib.js'`.

- [ ] **Step 3: Implement the lib**

Create `orders/workers/order-statements-lib.js`:

```js
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

/** Overdue + unpaid + has email + not cancelled. `today` is 'YYYY-MM-DD'. */
export function isStatementEligible(order, { balanceCents, today }) {
  if (!order || order.status === 'cancelled') return false;
  const pickup = typeof order.pickup_date === 'string' ? order.pickup_date.slice(0, 10) : '';
  if (!pickup || pickup >= today) return false;
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd orders && npx vitest run tests/order-statements-lib.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Run the full worker suite (no regressions)**

Run: `cd orders && npx vitest run`
Expected: all existing tests + the new file pass.

- [ ] **Step 6: Commit**

```bash
git add orders/workers/order-statements-lib.js orders/tests/order-statements-lib.test.js
git commit -m "feat(statements): pure eligibility and selection rules"
```

---

### Task 3: Statement rendering in `receipt-html.js`

**Files:**
- Modify: `orders/workers/receipt-html.js` (extend `buildReceiptHtml`, add `statementSubject`)
- Test: `orders/tests/receipt-html.test.js` (append new describes)

**Interfaces:**
- Consumes: existing `buildMethodLabel`, `emailMeta`, `escapeHtml` (file-local).
- Produces (used by Tasks 4, 7):
  - `buildReceiptHtml(order, isEn, opts = {})` where `opts = { payments?: [{ date, methodLabel, amountCents }], balanceCents?: number, payUrl?: string }`
  - `statementSubject(order, isEn) -> string`

- [ ] **Step 1: Write the failing tests**

Append to `orders/tests/receipt-html.test.js` (imports at top of file need `statementSubject` added to the existing import from `../workers/receipt-html.js`):

```js
import { buildReceiptHtml, statementSubject } from '../workers/receipt-html.js';

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd orders && npx vitest run tests/receipt-html.test.js`
Expected: FAIL — `statementSubject` is not exported / `Balance reminder` not found.

- [ ] **Step 3: Implement**

In `orders/workers/receipt-html.js`:

3a. Add this export directly after `emailMeta`:

```js
export function statementSubject(order, isEn) {
  return isEn
    ? `Balance reminder — Muy Rico Order #${order.id}`
    : `Recordatorio de saldo — Pedido Muy Rico #${order.id}`;
}
```

3b. Change the signature and add option parsing. Replace the current opening of `buildReceiptHtml`:

```js
export function buildReceiptHtml(order, isEn) {
  const customer = order.customer_name.trim();
```

with:

```js
export function buildReceiptHtml(order, isEn, opts = {}) {
  const customer = order.customer_name.trim();
  const payments = Array.isArray(opts.payments) ? opts.payments : null;
  const balanceCents = Number.isFinite(opts.balanceCents) ? opts.balanceCents : null;
  const payUrl = typeof opts.payUrl === 'string' && opts.payUrl ? opts.payUrl : null;
  const isStatement = payments !== null && balanceCents !== null && balanceCents > 0 && !!payUrl;
```

3c. In the `const L = { ...emailMeta(order, isEn), ...(isEn ? {...} : {...}) }` block, add the new label keys. For the EN branch add:

```js
      paymentsReceived: 'Payments received',
      paidToDate: 'Paid to date',
      balanceDue: 'Balance due',
      payNow: 'Pay balance',
```

and the ES branch:

```js
      paymentsReceived: 'Pagos recibidos',
      paidToDate: 'Pagado a la fecha',
      balanceDue: 'Saldo pendiente',
      payNow: 'Pagar saldo',
```

Immediately after the `const L = {...};` statement, add:

```js
  if (isStatement) {
    L.receipt = isEn ? 'BALANCE REMINDER' : 'RECORDATORIO DE SALDO';
    L.paidNote = isEn
      ? `Our records show a balance of $${(balanceCents / 100).toFixed(2)} on your order from ${order.pickup_date}. If you already paid, just reply and we will fix it right away.`
      : `Nuestros registros muestran un saldo de $${(balanceCents / 100).toFixed(2)} en tu pedido del ${order.pickup_date}. Si ya pagaste, respóndenos y lo corregimos de inmediato.`;
  }
```

3d. Add the payments + summary rows and CTA. Replace the current `f`ooter block of the totals table:

```js
      <tfoot>${discountRows}
        <tr>
          <td colspan="2" style="padding: 14px 0 4px; color: #1e4636; font-size: 15px; font-weight: 700;">${L.total}</td>
          <td style="padding: 14px 0 4px; color: #1e4636; font-size: 18px; font-weight: 700; text-align: right;">${total}</td>
        </tr>
      </tfoot>
```

with:

```js
      <tfoot>${discountRows}
        <tr>
          <td colspan="2" style="padding: 14px 0 4px; color: #1e4636; font-size: 15px; font-weight: 700;">${L.total}</td>
          <td style="padding: 14px 0 4px; color: #1e4636; font-size: 18px; font-weight: 700; text-align: right;">${total}</td>
        </tr>
        ${payments !== null ? `
        <tr>
          <td colspan="3" style="padding: 16px 0 4px; border-top: 1px dashed #e3dcd2; color: #8a8078; font-size: 11px; letter-spacing: 1px; text-transform: uppercase;">${L.paymentsReceived}</td>
        </tr>
        ${payments.length ? payments.map((p) => `
        <tr>
          <td style="padding: 4px 0; color: #4a423d; font-size: 13px;">${escapeHtml(p.date)}</td>
          <td style="padding: 4px 0; color: #8a8078; font-size: 13px; text-align: center;">${escapeHtml(p.methodLabel)}</td>
          <td style="padding: 4px 0; color: #4a423d; font-size: 13px; text-align: right;">$${(Number(p.amountCents) / 100).toFixed(2)}</td>
        </tr>`).join('') : '<tr><td colspan="3" style="padding: 4px 0; color: #8a8078; font-size: 13px;">—</td></tr>'}
        <tr>
          <td colspan="2" style="padding: 10px 0 4px; color: #2d7a46; font-size: 13px; font-weight: 600;">${L.paidToDate}</td>
          <td style="padding: 10px 0 4px; color: #2d7a46; font-size: 13px; font-weight: 600; text-align: right;">&minus;$${(payments.reduce((s, p) => s + (Number(p.amountCents) || 0), 0) / 100).toFixed(2)}</td>
        </tr>
        ${balanceCents !== null ? `
        <tr>
          <td colspan="2" style="padding: 4px 0 14px; color: #1e4636; font-size: 15px; font-weight: 700;">${L.balanceDue}</td>
          <td style="padding: 4px 0 14px; color: #1e4636; font-size: 18px; font-weight: 700; text-align: right;">$${(balanceCents / 100).toFixed(2)}</td>
        </tr>` : ''}` : ''}
      </tfoot>
```

3e. Add the CTA between the totals table `</table>` and the closing `</div>` of the padded section. Replace:

```js
    </table>
  </div>

  <div style="padding: 20px 32px 28px;">
```

with:

```js
    </table>
    ${isStatement ? `
    <div style="text-align: center; margin: 22px 0 6px;">
      <a href="${escapeHtml(payUrl)}" style="display: inline-block; background: #1e4636; color: #ffffff; font-size: 15px; font-weight: 600; padding: 12px 28px; border-radius: 10px; text-decoration: none;">${L.payNow} — $${(balanceCents / 100).toFixed(2)}</a>
    </div>` : ''}
  </div>

  <div style="padding: 20px 32px 28px;">
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd orders && npx vitest run tests/receipt-html.test.js`
Expected: PASS — new statement tests and all pre-existing receipt tests.

- [ ] **Step 5: Commit**

```bash
git add orders/workers/receipt-html.js orders/tests/receipt-html.test.js
git commit -m "feat(statements): statement rendering with payments and balance due"
```

---

### Task 4: `POST /api/orders/:id/send-statement` (single, admin)

**Files:**
- Modify: `orders/workers/api.js` (imports, route, helpers, handler)
- Test: `orders/tests/send-statement.test.js`

**Interfaces:**
- Consumes: `orderBalanceCents`, `isStatementEligible` (Task 2); `buildReceiptHtml`, `statementSubject`, `emailMeta`, `buildMethodLabel` (Task 3 + existing).
- Produces (used by Tasks 5, 11): `deliverStatement(env, order, actor) -> { outcome: 'sent'|'failed'|'no-email'|'not-eligible', balanceCents?, messageId?, lastSentAt? }`; response shape `{ ok, status, balanceCents, lastSentAt }`.

- [ ] **Step 1: Write the failing tests**

Create `orders/tests/send-statement.test.js`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../workers/api.js';

function makeEnv({ order = null, payments = [], statementRow = null } = {}) {
  const calls = [];
  const db = {
    prepare(sql) {
      const stmt = {
        _sql: sql,
        _binds: [],
        bind(...args) { stmt._binds = args; return stmt; },
        async first() {
          calls.push({ sql, binds: stmt._binds, method: 'first' });
          if (/FROM orders WHERE id = \?/.test(sql)) return order;
          if (/SELECT pay_token FROM orders/.test(sql)) return { pay_token: 'tok65' };
          if (/MAX\(created_at\)/.test(sql)) return statementRow;
          return null;
        },
        async run() { calls.push({ sql, binds: stmt._binds, method: 'run' }); return { meta: { changes: 1 } }; },
        async all() {
          calls.push({ sql, binds: stmt._binds, method: 'all' });
          if (/FROM payments WHERE order_id = \? AND active = 1/.test(sql)) return { results: payments };
          return { results: [] };
        },
      };
      return stmt;
    },
  };
  return { env: { DB: db, RESEND_API_KEY: 're_test' }, calls };
}

const req = (path) => new Request(`http://localhost${path}`, { method: 'POST' });

const ORDER = {
  id: 65, customer_name: 'Stacy Stout', email: 'stacy@example.com', language: 'en',
  status: 'pending', pickup_date: '2026-10-07', total_cents: 8000, subtotal_cents: 12000,
  discount_cents: 4000, payment_method: 'stripe', payment_sub_method: null,
  payment_status: 'partial', items_json: '[]', created_at: '2026-10-06 00:05:04',
  pay_token: null,
};

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/orders/:id/send-statement', () => {
  it('sends a statement, generates the token, logs the send and the event', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ id: 'msg_9' }) })));
    const { env, calls } = makeEnv({ order: ORDER, payments: [{ amount: 60 }], statementRow: { last_sent_at: '2026-10-10 14:00:00' } });
    const res = await worker.fetch(req('/api/orders/65/send-statement'), env, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, status: 'sent', balanceCents: 2000, lastSentAt: '2026-10-10 14:00:00' });

    const tokenWrite = calls.find((c) => c.method === 'run' && /UPDATE orders SET pay_token/.test(c.sql));
    expect(tokenWrite, 'token must be generated when missing').toBeTruthy();
    expect(tokenWrite.binds[0]).toMatch(/^[0-9a-f]{32}$/);

    const stmtInsert = calls.find((c) => c.method === 'run' && /INSERT INTO order_statements/.test(c.sql));
    expect(stmtInsert).toBeTruthy();
    expect(stmtInsert.binds).toContain(2000); // balance_cents
    expect(stmtInsert.binds).toContain(6000); // paid_cents

    const event = calls.find((c) => c.method === 'run' && /INSERT INTO order_events/.test(c.sql));
    expect(event.binds[2]).toBe('statement:sent');
  });

  it('rejects an order with no email', async () => {
    const { env } = makeEnv({ order: { ...ORDER, email: null }, payments: [{ amount: 60 }] });
    const res = await worker.fetch(req('/api/orders/65/send-statement'), env, {});
    expect(res.status).toBe(400);
  });

  it('rejects an order that is already paid', async () => {
    const { env } = makeEnv({ order: { ...ORDER, pay_token: 'tok65' }, payments: [{ amount: 80 }] });
    const res = await worker.fetch(req('/api/orders/65/send-statement'), env, {});
    expect(res.status).toBe(409);
  });

  it('logs a failed statement when Resend rejects and returns 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, text: async () => 'nope' })));
    const { env, calls } = makeEnv({ order: { ...ORDER, pay_token: 'tok65' }, payments: [{ amount: 60 }] });
    const res = await worker.fetch(req('/api/orders/65/send-statement'), env, {});
    expect(res.status).toBe(502);
    const stmtInsert = calls.find((c) => c.method === 'run' && /INSERT INTO order_statements/.test(c.sql));
    expect(stmtInsert.binds).toContain('failed');
    const event = calls.find((c) => c.method === 'run' && /INSERT INTO order_events/.test(c.sql));
    expect(event.binds[2]).toBe('statement:failed');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd orders && npx vitest run tests/send-statement.test.js`
Expected: FAIL — route returns 404 (not implemented).

- [ ] **Step 3: Implement**

3a. Update imports in `orders/workers/api.js`. Extend the receipt-html import:

```js
import { buildMethodLabel, buildReceiptHtml, emailMeta, formatStatusLabel, statementSubject } from './receipt-html.js';
```

Add after the label-gen-lib import:

```js
import { orderBalanceCents, isStatementEligible } from './order-statements-lib.js';
```

3b. Register routes. In the authed routing section, directly after the backfill-labels route block, add:

```js
      const stm = path.match(/^\/api\/orders\/(\d+)\/send-statement$/);
      if (stm && method === 'POST') {
        return await sendOrderStatement(Number(stm[1]), env, actorName);
      }
      if (path === '/api/orders/send-statements' && method === 'POST') {
        return await sendOverdueStatements(env, actorName);
      }
```

(Task 5 implements `sendOverdueStatements`; add a temporary stub in this task so the file parses:)

```js
async function sendOverdueStatements(env, actor) {
  return json({ ok: true, sent: 0, failed: 0, skipped: {} }, 200);
}
```

Place it next to `sendOrderStatement` and replace it in Task 5.

3c. Add the helpers and handler after `generateLabelsForOrderById` (near the other order helpers):

```js
// ─── Order balance statements ────────────────────────────────────────────────

async function loadActivePayments(env, orderId) {
  const { results } = await env.DB.prepare(
    'SELECT id, amount, method, method_details, date FROM payments WHERE order_id = ? AND active = 1 ORDER BY date ASC'
  ).bind(orderId).all();
  return results || [];
}

async function ensurePayToken(env, order) {
  if (order.pay_token) return order.pay_token;
  const token = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare('UPDATE orders SET pay_token = ? WHERE id = ?').bind(token, order.id).run();
  return token;
}

function statementPayUrl(order, token) {
  return `https://muy-rico.com/pay-order.html?o=${order.id}&t=${token}`;
}

function paymentsForEmail(payments, isEn) {
  return payments.map((p) => ({
    date: String(p.date || '').slice(0, 10),
    methodLabel: buildMethodLabel({ payment_method: p.method, payment_sub_method: p.method_details }, isEn),
    amountCents: Math.round((Number(p.amount) || 0) * 100),
  }));
}

async function sendStatementEmail(env, order, payments, balanceCents, token) {
  const email = order.email;
  if (!email || !env.RESEND_API_KEY) return { ok: false, skipped: true };
  const isEn = order.language === 'en';
  const payUrl = statementPayUrl(order, token);
  const html = buildReceiptHtml(order, isEn, {
    payments: paymentsForEmail(payments, isEn),
    balanceCents,
    payUrl,
  });
  const balance = '$' + (balanceCents / 100).toFixed(2);
  const paidCents = payments.reduce((s, p) => s + Math.round((Number(p.amount) || 0) * 100), 0);
  const text = [
    'Muy Rico Bakery — ' + (isEn ? 'BALANCE REMINDER' : 'RECORDATORIO DE SALDO'),
    '',
    (isEn ? 'Hi ' : 'Hola ') + order.customer_name + ',',
    isEn
      ? `Our records show a balance of ${balance} on your order from ${order.pickup_date}.`
      : `Nuestros registros muestran un saldo de ${balance} en tu pedido del ${order.pickup_date}.`,
    '',
    (isEn ? 'Total: ' : 'Total: ') + '$' + ((Number(order.total_cents) || 0) / 100).toFixed(2),
    (isEn ? 'Paid to date: ' : 'Pagado a la fecha: ') + '$' + (paidCents / 100).toFixed(2),
    (isEn ? 'Balance due: ' : 'Saldo pendiente: ') + balance,
    '',
    (isEn ? 'Pay online: ' : 'Paga en línea: ') + payUrl,
    '',
    isEn ? 'Questions? Reply to this email or call/text (616) 218-3582.' : '¿Preguntas? Responde a este correo o llámanos al (616) 218-3582.',
    'Muy Rico Bakery · Holland, Michigan · Familia · Tradición · Sabor',
  ].join('\n');

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.RESEND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM || 'orders@muy-rico.com',
        to: [email],
        subject: statementSubject(order, isEn),
        text,
        html,
      }),
    });
    if (!res.ok) {
      console.error('statement email failed', res.status, await res.text().catch(() => ''));
      return { ok: false };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, messageId: data.id || null };
  } catch (e) {
    console.error('statement email failed:', e);
    return { ok: false };
  }
}

async function logStatement(env, order, { paidCents, balanceCents, emailResult, actor }) {
  const id = `stmt_${order.id}_${Date.now().toString(36)}`;
  const status = emailResult && emailResult.ok ? 'sent' : 'failed';
  await env.DB.prepare(`
    INSERT INTO order_statements
      (id, order_id, customer_name, email, language, total_cents, paid_cents, balance_cents, status, message_id, sent_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, order.id, order.customer_name || '', order.email || null, order.language || 'es',
    Number(order.total_cents) || 0, paidCents, balanceCents, status,
    (emailResult && emailResult.messageId) || null, actor || 'system',
  ).run();
  await env.DB.prepare(
    `INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, ?)`
  ).bind(order.id, actor || 'system', status === 'sent' ? 'statement:sent' : 'statement:failed').run();
}

async function deliverStatement(env, order, actor) {
  const today = new Date().toISOString().slice(0, 10);
  const payments = await loadActivePayments(env, order.id);
  const balanceCents = orderBalanceCents(order, payments);
  if (!String(order.email || '').trim()) return { outcome: 'no-email', balanceCents };
  if (!isStatementEligible(order, { balanceCents, today })) return { outcome: 'not-eligible', balanceCents };

  const token = await ensurePayToken(env, order);
  const emailResult = await sendStatementEmail(env, order, payments, balanceCents, token);
  const paidCents = payments.reduce((s, p) => s + Math.round((Number(p.amount) || 0) * 100), 0);
  await logStatement(env, order, { paidCents, balanceCents, emailResult, actor });

  const latest = await env.DB.prepare(
    "SELECT MAX(created_at) AS last_sent_at FROM order_statements WHERE order_id = ? AND status = 'sent'"
  ).bind(order.id).first();

  return {
    outcome: emailResult.ok ? 'sent' : 'failed',
    balanceCents,
    messageId: emailResult.messageId || null,
    lastSentAt: (latest && latest.last_sent_at) || null,
  };
}

async function sendOrderStatement(orderId, env, actor) {
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  if (!order) return json({ error: 'Not found' }, 404);
  const result = await deliverStatement(env, order, actor);
  if (result.outcome === 'no-email') return json({ error: 'Order has no email' }, 400);
  if (result.outcome === 'not-eligible') {
    return json({ error: 'Not eligible for a balance statement' }, 409);
  }
  if (result.outcome === 'failed') {
    return json({ ok: false, error: 'Statement email could not be sent', balanceCents: result.balanceCents }, 502);
  }
  return json({
    ok: true,
    status: 'sent',
    balanceCents: result.balanceCents,
    lastSentAt: result.lastSentAt,
  }, 200);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd orders && npx vitest run tests/send-statement.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full worker suite**

Run: `cd orders && npx vitest run`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add orders/workers/api.js orders/tests/send-statement.test.js
git commit -m "feat(statements): admin send-statement endpoint"
```

---

### Task 5: `POST /api/orders/send-statements` (bulk, admin)

**Files:**
- Modify: `orders/workers/api.js` (replace the Task 4 stub)
- Test: `orders/tests/send-statements-bulk.test.js`

**Interfaces:**
- Consumes: `selectStatementRecipients` (Task 2), `deliverStatement` (Task 4).
- Produces: response `{ ok, sent, failed, skipped, results: [{ orderId, outcome }] }`.

- [ ] **Step 1: Write the failing tests**

Create `orders/tests/send-statements-bulk.test.js`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../workers/api.js';

const CANDIDATES = [
  { id: 1, status: 'pending', email: 'a@x.com', pickup_date: '2026-10-01', total_cents: 5000, customer_name: 'A', language: 'en', items_json: '[]' },
  { id: 2, status: 'completed', email: 'b@x.com', pickup_date: '2026-10-01', total_cents: 3000, customer_name: 'B', language: 'es', items_json: '[]' },
];

function makeEnv({ payments = [], sent = [] } = {}) {
  const calls = [];
  const db = {
    prepare(sql) {
      const stmt = {
        _sql: sql, _binds: [],
        bind(...args) { stmt._binds = args; return stmt; },
        async first() {
          calls.push({ sql, binds: stmt._binds, method: 'first' });
          if (/FROM orders WHERE id = \?/.test(sql)) return CANDIDATES.find((o) => o.id === stmt._binds[0]) || null;
          if (/SELECT pay_token FROM orders/.test(sql)) return { pay_token: 'tok' };
          if (/MAX\(created_at\)/.test(sql)) return { last_sent_at: null };
          return null;
        },
        async run() { calls.push({ sql, binds: stmt._binds, method: 'run' }); return { meta: { changes: 1 } }; },
        async all() {
          calls.push({ sql, binds: stmt._binds, method: 'all' });
          if (/FROM orders WHERE status != 'cancelled'/.test(sql)) return { results: CANDIDATES };
          if (/FROM payments WHERE active = 1 AND order_id IN/.test(sql)) return { results: payments };
          if (/FROM order_statements/.test(sql)) return { results: sent };
          if (/FROM payments WHERE order_id = \?/.test(sql)) {
            return { results: payments.filter((p) => p.order_id === stmt._binds[0]) };
          }
          return { results: [] };
        },
      };
      return stmt;
    },
  };
  return { env: { DB: db, RESEND_API_KEY: 're_test' }, calls };
}

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/orders/send-statements', () => {
  it('sends to eligible orders and skips recently reminded ones', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ id: 'm' }) })));
    const { env } = makeEnv({
      payments: [{ order_id: 1, amount: 20 }, { order_id: 2, amount: 10 }],
      sent: [{ order_id: 2, last_sent_at: new Date().toISOString().slice(0, 19).replace('T', ' ') }],
    });
    const res = await worker.fetch(
      new Request('http://localhost/api/orders/send-statements', { method: 'POST' }),
      env, {}
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(1);
    expect(body.skipped.recent).toBe(1);
    expect(body.results).toEqual([{ orderId: 1, outcome: 'sent' }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd orders && npx vitest run tests/send-statements-bulk.test.js`
Expected: FAIL — `body.sent` is 0 (stub response).

- [ ] **Step 3: Implement**

In `orders/workers/api.js`, replace the Task 4 stub `sendOverdueStatements` with:

```js
async function sendOverdueStatements(env, actor) {
  const today = new Date().toISOString().slice(0, 10);

  const { results: candidates } = await env.DB.prepare(
    `SELECT * FROM orders
      WHERE status != 'cancelled'
        AND TRIM(COALESCE(email, '')) != ''
        AND pickup_date IS NOT NULL
        AND pickup_date < ?`
  ).bind(today).all();

  const ids = (candidates || []).map((o) => o.id);
  const paymentsByOrder = {};
  const lastSentByOrder = {};
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const { results: payRows } = await env.DB.prepare(
      `SELECT order_id, amount FROM payments WHERE active = 1 AND order_id IN (${placeholders})`
    ).bind(...ids).all();
    for (const r of payRows || []) (paymentsByOrder[r.order_id] ||= []).push(r);

    const { results: sentRows } = await env.DB.prepare(
      `SELECT order_id, MAX(created_at) AS last_sent_at FROM order_statements
        WHERE status = 'sent' AND order_id IN (${placeholders}) GROUP BY order_id`
    ).bind(...ids).all();
    for (const r of sentRows || []) lastSentByOrder[r.order_id] = r.last_sent_at;
  }

  const { send, skipped } = selectStatementRecipients(
    candidates, paymentsByOrder, lastSentByOrder, { today }
  );

  const results = [];
  let sent = 0;
  let failed = 0;
  for (const { order } of send) {
    try {
      const result = await deliverStatement(env, order, actor);
      if (result.outcome === 'sent') sent++;
      else failed++;
      results.push({ orderId: order.id, outcome: result.outcome });
    } catch (e) {
      console.error('sendOverdueStatements: failed for order', order.id, e);
      failed++;
      results.push({ orderId: order.id, outcome: 'failed' });
    }
  }

  return json({ ok: true, sent, failed, skipped, results }, 200);
}
```

Also add `selectStatementRecipients` to the `order-statements-lib.js` import line in `api.js`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd orders && npx vitest run tests/send-statements-bulk.test.js`
Expected: PASS.

- [ ] **Step 5: Full suite + commit**

Run: `cd orders && npx vitest run` — expected all pass.

```bash
git add orders/workers/api.js orders/tests/send-statements-bulk.test.js
git commit -m "feat(statements): bulk remind-all-overdue endpoint"
```

---

### Task 6: `GET /api/public/orders/:id/balance` (token-gated)

**Files:**
- Modify: `orders/workers/api.js` (auth gate allowlist + handler)
- Test: `orders/tests/public-order-balance.test.js`

**Interfaces:**
- Produces (consumed by Task 8 proxying + Task 9 pay page):
  `{ orderId, customerName, pickupDate, language, status, subtotalCents, discountCents, totalCents, paidCents, balanceCents, paid, items: [{name, qty, price}], payments: [{date, amountCents, methodLabel}] }`

- [ ] **Step 1: Write the failing tests**

Create `orders/tests/public-order-balance.test.js`:

```js
import { describe, it, expect } from 'vitest';
import worker from '../workers/api.js';

const ORDER = {
  id: 65, customer_name: 'Stacy Stout', email: 'stacy@example.com', language: 'en',
  status: 'pending', pickup_date: '2026-10-07', pay_token: 'a'.repeat(32),
  total_cents: 8000, subtotal_cents: 12000, discount_cents: 4000,
  items_json: JSON.stringify([{ name: 'Lemon Cupcake ×24', name_en: 'Lemon Cupcake ×24', qty: 1, price: 40 }]),
  payment_method: 'stripe', payment_sub_method: null, payment_status: 'partial',
};

function makeEnv({ order = ORDER, payments = [] } = {}) {
  const db = {
    prepare(sql) {
      const stmt = {
        _sql: sql, _binds: [],
        bind(...args) { stmt._binds = args; return stmt; },
        async first() { if (/FROM orders WHERE id = \?/.test(sql)) return order; return null; },
        async run() { return { meta: { changes: 1 } }; },
        async all() {
          if (/FROM payments WHERE order_id = \? AND active = 1/.test(sql)) return { results: payments };
          return { results: [] };
        },
      };
      return stmt;
    },
  };
  return { env: { DB: db } };
}

const get = (path) => new Request(`http://localhost${path}`);

describe('GET /api/public/orders/:id/balance', () => {
  it('returns the payable payload for the right token', async () => {
    const { env } = makeEnv({ payments: [{ amount: 60, method: 'stripe', method_details: null, date: '2026-10-06 00:05:04' }] });
    const res = await worker.fetch(get(`/api/public/orders/65/balance?t=${'a'.repeat(32)}`), env, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      orderId: 65, customerName: 'Stacy Stout', totalCents: 8000, paidCents: 6000,
      balanceCents: 2000, paid: false, language: 'en',
    });
    expect(body.payments[0]).toMatchObject({ date: '2026-10-06', amountCents: 6000 });
    expect(body.items[0].name).toBe('Lemon Cupcake ×24');
  });

  it('rejects missing or wrong tokens', async () => {
    const { env } = makeEnv();
    expect((await worker.fetch(get('/api/public/orders/65/balance'), env, {})).status).toBe(404);
    expect((await worker.fetch(get('/api/public/orders/65/balance?t=wrong'), env, {})).status).toBe(404);
  });

  it('reports a cancelled order as not payable', async () => {
    const { env } = makeEnv({ order: { ...ORDER, status: 'cancelled' } });
    const res = await worker.fetch(get(`/api/public/orders/65/balance?t=${'a'.repeat(32)}`), env, {});
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd orders && npx vitest run tests/public-order-balance.test.js`
Expected: FAIL — 401 Unauthorized (route not public yet).

- [ ] **Step 3: Implement**

3a. Auth gate: in the `const isPublicX = ...` block add:

```js
    const isPublicOrderBalance =
      path.match(/^\/api\/public\/orders\/\d+\/balance$/) && method === 'GET';
```

and add `&& !isPublicOrderBalance` to the big unauthorized `if` condition (same pattern as `isPublicSiteGet`).

3b. Handler route — add inside the main `try` block, before the `om` order regex:

```js
      const obm = path.match(/^\/api\/public\/orders\/(\d+)\/balance$/);
      if (obm && method === 'GET') return await getPublicOrderBalance(Number(obm[1]), url, env);
```

3c. Handler implementation (place next to `getOrderPayable`):

```js
async function getPublicOrderBalance(id, url, env) {
  const token = url.searchParams.get('t') || '';
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  if (!order || !order.pay_token || !token || !timingSafeEqualStr(token, order.pay_token)) {
    return json({ error: 'Not found' }, 404);
  }
  if (order.status === 'cancelled') {
    return json({ error: 'Order is no longer payable' }, 409);
  }

  const payments = await loadActivePayments(env, id);
  const paidCents = payments.reduce((s, p) => s + Math.round((Number(p.amount) || 0) * 100), 0);
  const totalCents = Number(order.total_cents) || 0;
  const balanceCents = orderBalanceCents(order, payments);
  const isEn = order.language === 'en';

  let items = [];
  try { items = JSON.parse(order.items_json || '[]'); } catch { /* keep [] */ }

  return json({
    orderId: order.id,
    customerName: order.customer_name || '',
    pickupDate: order.pickup_date || null,
    language: order.language || 'es',
    status: order.status,
    subtotalCents: Number(order.subtotal_cents) || (totalCents + (Number(order.discount_cents) || 0)),
    discountCents: Number(order.discount_cents) || 0,
    totalCents,
    paidCents,
    balanceCents,
    paid: balanceCents <= 0,
    items: items.map((i) => ({
      name: isEn ? (i.name_en || i.name) : (i.name_es || i.name),
      qty: i.qty,
      price: i.price,
    })),
    payments: payments.map((p) => ({
      date: String(p.date || '').slice(0, 10),
      amountCents: Math.round((Number(p.amount) || 0) * 100),
      methodLabel: buildMethodLabel(
        { payment_method: p.method, payment_sub_method: p.method_details }, isEn
      ),
    })),
  }, 200);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd orders && npx vitest run tests/public-order-balance.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Full suite + commit**

Run: `cd orders && npx vitest run` — all pass.

```bash
git add orders/workers/api.js orders/tests/public-order-balance.test.js
git commit -m "feat(statements): token-gated public balance endpoint"
```

---

### Task 7: `POST /api/orders/:id/balance-paid` (webhook-guarded)

**Files:**
- Modify: `orders/workers/api.js` (auth gate allowlist, route, handler, `sendCustomerConfirmation` opts)
- Test: `orders/tests/balance-paid.test.js`

**Interfaces:**
- Consumes: `loadActivePayments`, `orderBalanceCents`, `rederiveOrderPaymentStatus`, `notifyOrderPaid`, `logReceipt`, `sendCustomerConfirmation` (existing + Task 4).
- Produces: response `{ ok, paymentStatus, balanceCents }` (+ `{ ok: true, already: true }` on replay).

- [ ] **Step 1: Write the failing tests**

Create `orders/tests/balance-paid.test.js`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../workers/api.js';

const ORDER = {
  id: 65, customer_name: 'Stacy Stout', email: 'stacy@example.com', language: 'en',
  status: 'pending', total_cents: 8000, payment_status: 'partial',
  items_json: '[]', payment_method: 'stripe', payment_sub_method: null,
  pickup_date: '2026-10-07', pickup_time: null, created_at: '2026-10-06 00:05:04',
};

function makeEnv({ order = ORDER, payments = [], paymentByRef = null } = {}) {
  const calls = [];
  const db = {
    prepare(sql) {
      const stmt = {
        _sql: sql, _binds: [],
        bind(...args) { stmt._binds = args; return stmt; },
        async first() {
          calls.push({ sql, binds: stmt._binds, method: 'first' });
          if (/SELECT id FROM payments WHERE ref = \?/.test(sql)) return paymentByRef;
          if (/SELECT total_cents FROM orders/.test(sql)) return { total_cents: order.total_cents };
          if (/FROM orders WHERE id = \?/.test(sql)) return order;
          return null;
        },
        async run() { calls.push({ sql, binds: stmt._binds, method: 'run' }); return { meta: { changes: 1 } }; },
        async all() {
          calls.push({ sql, binds: stmt._binds, method: 'all' });
          if (/FROM payments WHERE order_id = \? AND active = 1/.test(sql)) return { results: payments };
          return { results: [] };
        },
      };
      return stmt;
    },
  };
  return { env: { DB: db, PAYMENT_WEBHOOK_SECRET: 's3cret', RESEND_API_KEY: 're_test' }, calls };
}

const post = (body) => new Request('http://localhost/api/orders/65/balance-paid', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': 's3cret' },
  body: JSON.stringify(body),
});

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/orders/:id/balance-paid', () => {
  it('records the balance payment, derives paid, logs the event, and emails a receipt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ id: 'msg' }) })));
    const { env, calls } = makeEnv({ payments: [{ amount: 60 }] });
    const res = await worker.fetch(post({ amount_cents: 2000, method: 'stripe', ref: 'cs_live_1' }), env, {
      waitUntil: (p) => { if (p && p.catch) p.catch(() => {}); },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, paymentStatus: 'paid', balanceCents: 0 });

    const insert = calls.find((c) => c.method === 'run' && /INSERT INTO payments/.test(c.sql));
    expect(insert).toBeTruthy();
    expect(insert.binds).toContain(20);      // dollars
    expect(insert.binds).toContain('cs_live_1');
    const event = calls.find((c) =>
      c.method === 'run' && /INSERT INTO order_events/.test(c.sql) && c.binds[2] === 'payment:balance_online');
    expect(event, 'balance payment event').toBeTruthy();
  });

  it('is idempotent by gateway ref', async () => {
    const { env, calls } = makeEnv({ payments: [{ amount: 60 }], paymentByRef: { id: 'pay_existing' } });
    const res = await worker.fetch(post({ amount_cents: 2000, method: 'stripe', ref: 'cs_live_1' }), env, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, already: true });
    expect(calls.find((c) => c.method === 'run' && /INSERT INTO payments/.test(c.sql))).toBeFalsy();
  });

  it('rejects without the webhook secret', async () => {
    const { env } = makeEnv();
    const bad = new Request('http://localhost/api/orders/65/balance-paid', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect((await worker.fetch(bad, env, {})).status).toBe(401);
  });

  it('records the settled amount and flags a mismatch instead of dropping the money', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ id: 'msg' }) })));
    const { env, calls } = makeEnv({ payments: [{ amount: 70 }] }); // balance 1000; webhook says 1500
    const res = await worker.fetch(post({ amount_cents: 1500, method: 'paypal', ref: 'cap_9' }), env, {
      waitUntil: (p) => { if (p && p.catch) p.catch(() => {}); },
    });
    expect(res.status).toBe(200);
    const insert = calls.find((c) => c.method === 'run' && /INSERT INTO payments/.test(c.sql));
    expect(insert.binds).toContain(15);
    const mismatchEvent = calls.find((c) => c.method === 'run' && /balance-amount-mismatch/.test(String(c.binds[2])));
    expect(mismatchEvent, 'mismatch must be audited').toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd orders && npx vitest run tests/balance-paid.test.js`
Expected: FAIL — 401 (route falls through to the auth gate).

- [ ] **Step 3: Implement**

3a. Auth gate additions:

```js
    const isPublicBalancePaid =
      path.match(/^\/api\/orders\/\d+\/balance-paid$/) && method === 'POST';
```

Add `&& !isPublicBalancePaid` to the big unauthorized `if` condition.

3b. Route — next to the `mark-paid` route:

```js
      const bpm = path.match(/^\/api\/orders\/(\d+)\/balance-paid$/);
      if (bpm && method === 'POST') {
        return await markOrderBalancePaid(Number(bpm[1]), request, env, ctx);
      }
```

3c. Handler — place after `getPublicOrderBalance`:

```js
async function markOrderBalancePaid(id, request, env, ctx) {
  if (!hasValidWebhookSecret(request, env)) {
    return json({ error: 'Forbidden — invalid webhook secret' }, 401);
  }

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const method = body.method;
  if (!method || !ALLOWED_PAYMENT.includes(method)) {
    return json({ error: `Invalid or missing method. Must be one of: ${ALLOWED_PAYMENT.join(', ')}` }, 400);
  }
  const subMethod = body.sub_method || null;
  const ref = typeof body.ref === 'string' && body.ref.trim()
    ? body.ref.trim().slice(0, 200)
    : '';
  if (!ref) return json({ error: 'Missing ref' }, 400);
  const amountCents = Number(body.amount_cents);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return json({ error: 'Invalid amount_cents' }, 400);
  }

  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  if (!order) return json({ error: 'Not found' }, 404);

  // Idempotency: a webhook replay with the same gateway ref is a no-op.
  const seen = await env.DB.prepare('SELECT id FROM payments WHERE ref = ?').bind(ref).first();
  if (seen) return json({ ok: true, already: true }, 200);

  const payments = await loadActivePayments(env, id);
  const balanceCents = orderBalanceCents(order, payments);

  // The money moved: always record the settled amount. A mismatch (balance
  // changed between page load and payment) is audited and flagged, not dropped —
  // mirrors the invoice `unexpected-amount` policy.
  if (amountCents !== balanceCents) {
    await env.DB.prepare(
      `INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, ?)`
    ).bind(id, 'system', `order:balance-amount-mismatch: paid=${amountCents} expected=${balanceCents}`).run();
    if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
      await notifyTelegram(env,
        `⚠️ Balance amount mismatch on order #${id}: paid $${(amountCents / 100).toFixed(2)}, expected $${(balanceCents / 100).toFixed(2)} — recorded the settled amount`);
    }
  }

  const payId = `pay_${id}_${Date.now().toString(36)}_b`;
  await env.DB.prepare(`
    INSERT INTO payments (id, order_id, order_number, customer_name, amount, method, method_details, ref, date, created_at, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 1)
  `).bind(
    payId, id, `MR-${id}`, order.customer_name || '',
    amountCents / 100, method, subMethod, ref,
  ).run();

  const derived = await rederiveOrderPaymentStatus(env, id);
  await env.DB.prepare(
    `INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, 'payment:balance_online')`
  ).bind(id, 'system').run();

  if (ctx) {
    ctx.waitUntil((async () => {
      const updatedOrder = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
      const updatedPayments = await loadActivePayments(env, id);
      await notifyOrderPaid(env, updatedOrder, id, method);
      const result = await sendCustomerConfirmation(env, updatedOrder, {
        payments: paymentsForEmail(updatedPayments, updatedOrder.language === 'en'),
        balanceCents: derived ? derived.balanceCents : 0,
        payUrl: null,
      });
      await logReceipt(env, updatedOrder, result, id);
    })());
  }

  return json({
    ok: true,
    paymentStatus: derived ? derived.paymentStatus : null,
    balanceCents: derived ? derived.balanceCents : 0,
  }, 200);
}
```

3d. Teach `sendCustomerConfirmation` to pass the breakdown through. Change its signature and the `buildReceiptHtml` call:

```js
async function sendCustomerConfirmation(env, order, opts = {}) {
```
```js
  const html = buildReceiptHtml(order, isEn, opts);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd orders && npx vitest run tests/balance-paid.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Full suite + commit**

Run: `cd orders && npx vitest run` — all pass.

```bash
git add orders/workers/api.js orders/tests/balance-paid.test.js
git commit -m "feat(statements): idempotent balance-paid webhook endpoint"
```

---

### Task 8: Checkout worker — order balance payment rails

**Files:**
- Modify: `workers/checkout.js`

**Interfaces:**
- Consumes: orders API `GET /api/public/orders/:id/balance`, `POST /api/orders/:id/balance-paid`.
- Produces (consumed by Task 9's pay page): `GET /order/:id/payable?t=`, `POST /order/checkout {id, token, origin}`, `POST /order/paypal-capture {id, token, paypalOrderId}`; Stripe metadata `kind=order_balance`; PayPal custom id `o<id>:<token>`.

- [ ] **Step 1: Register the routes**

In `workers/checkout.js` `fetch`, after the invoice routes:

```js
      const opay = path.match(/^\/order\/(\d+)\/payable$/);
      if (opay && request.method === "GET") {
        return await handleOrderPayable(Number(opay[1]), request, env);
      }
      if (path === "/order/checkout" && request.method === "POST") {
        return await handleOrderCheckout(request, env);
      }
      if (path === "/order/paypal-capture" && request.method === "POST") {
        return await handleOrderPayPalCapture(request, env);
      }
```

- [ ] **Step 2: Add the custom-id helpers and payable proxy**

Next to `parseInvoiceCustomId`:

```js
function encodeOrderPayCustomId(orderId, token) {
  return `o${orderId}:${token}`;
}

function parseOrderPayCustomId(s) {
  const m = typeof s === "string" ? s.match(/^o(\d+):([0-9a-f]{32})$/) : null;
  return m ? { id: Number(m[1]), token: m[2] } : null;
}
```

Next to `handleInvoicePayable`:

```js
function fetchOrderPayable(env, id, token) {
  return ordersApiFetch(env, "/api/public/orders/" + encodeURIComponent(id) +
    "/balance?t=" + encodeURIComponent(token));
}

async function handleOrderPayable(id, request, env) {
  const token = new URL(request.url).searchParams.get("t") || "";
  if (!token) return json({ error: "Missing token" }, 403);
  const res = await fetchOrderPayable(env, id, token);
  return new Response(await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

// Load the payable order for payment creation; returns { order } or { err: Response }.
async function loadPayableOrder(env, id, token) {
  const res = await fetchOrderPayable(env, id, token);
  if (!res.ok) return { err: json({ error: "Order balance not payable" }, res.status) };
  const order = await res.json();
  if (order.paid || order.status === "cancelled") {
    return { err: json({ error: "Order already settled" }, 409) };
  }
  return { order };
}
```

- [ ] **Step 3: Add checkout + capture handlers**

After `handleInvoicePayPalCapture`:

```js
async function handleOrderCheckout(request, env) {
  const { id, token, origin } = await request.json();
  if (!id || !token) return json({ error: "id and token required" }, 400);
  const key = env.STRIPE_SECRET_KEY;
  if (!key) return json({ error: "STRIPE_SECRET_KEY not set" }, 500);

  const { order, err } = await loadPayableOrder(env, id, token);
  if (err) return err;

  const ALLOWED_ORIGINS = ["https://muy-rico.com", "https://www.muy-rico.com", "https://muyrico.bexgarcia0208.workers.dev"];
  const base = ALLOWED_ORIGINS.includes(origin) ? origin : "https://muy-rico.com";
  const pageUrl = `${base}/pay-order.html?o=${id}&t=${encodeURIComponent(token)}`;

  const params = new URLSearchParams();
  params.append("line_items[0][price_data][currency]", "usd");
  params.append("line_items[0][price_data][product_data][name]", `Muy Rico — Order #${id} Balance`);
  params.append("line_items[0][price_data][unit_amount]", String(order.balanceCents));
  params.append("line_items[0][quantity]", "1");
  params.append("mode", "payment");
  params.append("client_reference_id", encodeOrderPayCustomId(id, token));
  params.append("metadata[kind]", "order_balance");
  params.append("metadata[order_id]", String(id));
  params.append("metadata[token]", token);
  params.append("success_url", pageUrl + "&paid=stripe");
  params.append("cancel_url", pageUrl);

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const session = await res.json();
  if (session.error) return json({ error: session.error.message }, 400);
  return json({ url: session.url });
}

async function handleOrderPayPalCapture(request, env) {
  const { id, token, paypalOrderId } = await request.json();
  if (!id || !token || !paypalOrderId) return json({ error: "id, token and paypalOrderId required" }, 400);

  const { order, err } = await loadPayableOrder(env, id, token);
  if (err) return err;

  const auth = await paypalAuth(env);
  if (!auth) return json({ error: "paypal auth failed" }, 500);

  const orderRes = await fetch(env.PAYPAL_API_BASE + "/v2/checkout/orders/" + encodeURIComponent(paypalOrderId), {
    headers: { Authorization: "Bearer " + auth },
  });
  const paypalOrder = await orderRes.json();
  if (!orderRes.ok) {
    console.error("paypal order balance lookup failed", JSON.stringify(paypalOrder));
    return json({ error: "Could not verify PayPal order" }, 400);
  }
  const ppCents = Math.round(parseFloat(paypalOrder.purchase_units?.[0]?.amount?.value || "0") * 100);
  const ppCurrency = paypalOrder.purchase_units?.[0]?.amount?.currency_code || "";
  if (ppCurrency !== "USD") {
    console.error(`order balance currency mismatch: ${ppCurrency} order=${id}`);
    return json({ error: "Currency mismatch" }, 400);
  }
  if (ppCents !== order.balanceCents) {
    console.error(`order balance amount mismatch: expected=${order.balanceCents} paypal=${ppCents} order=${id}`);
    return json({ error: "Amount mismatch" }, 400);
  }
  const ppCustomId = paypalOrder.purchase_units?.[0]?.custom_id || "";
  if (ppCustomId !== encodeOrderPayCustomId(id, token)) {
    console.error(`order balance custom_id mismatch: ${ppCustomId}`);
    return json({ error: "Order mismatch" }, 400);
  }

  const captureRes = await fetch(env.PAYPAL_API_BASE + "/v2/checkout/orders/" + encodeURIComponent(paypalOrderId) + "/capture", {
    method: "POST",
    headers: { Authorization: "Bearer " + auth, "Content-Type": "application/json" },
  });
  const captureData = await captureRes.json();
  if (!captureRes.ok || captureData.status !== "COMPLETED") {
    console.error("paypal order balance capture failed", JSON.stringify(captureData));
    return json({ error: captureData.message || "Capture failed" }, 400);
  }

  const capture = captureData.purchase_units?.[0]?.payments?.captures?.[0] || {};
  if ((capture.amount?.currency_code || "USD") !== "USD") {
    console.error(`order balance capture currency mismatch: ${capture.amount?.currency_code} order=${id}`);
    return json({ error: "Currency mismatch" }, 400);
  }
  const captureId = capture.id || paypalOrderId;
  const amountCents = Math.round(parseFloat(capture.amount?.value || "0") * 100) || order.balanceCents;
  const ok = await markOrderBalancePaid(env, {
    id, token, method: "paypal",
    subMethod: extractPayPalSubMethod(captureData),
    ref: captureId, amountCents,
  });
  if (!ok) return json({ error: "balance-paid failed" }, 500);
  return json({ ok: true });
}
```

- [ ] **Step 4: Add the API caller (next to `markInvoicePaid`)**

```js
async function markOrderBalancePaid(env, { id, token, method, subMethod, ref, amountCents }) {
  try {
    const res = await ordersApiFetch(env, "/api/orders/" + encodeURIComponent(id) + "/balance-paid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, method, sub_method: subMethod, ref, amount_cents: amountCents }),
    });
    if (res.status === 404 || res.status === 409) {
      console.error("balance-paid final status", res.status, "for order", id);
      return true;
    }
    if (!res.ok) {
      console.error("balance-paid failed", res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("balance-paid network error", e);
    return false;
  }
}
```

- [ ] **Step 5: Route the webhooks**

Stripe — after the invoice `checkout.session.completed` branch:

```js
    if (event.type === "checkout.session.completed" && meta.kind === "order_balance") {
      const subMethod = await extractStripeSubMethod(event, obj, env);
      const ok = await markOrderBalancePaid(env, {
        id: Number(meta.order_id), token: meta.token, method: "stripe",
        subMethod, ref: obj.id, amountCents: obj.amount_total,
      });
      return ok ? json({ received: true }) : json({ error: "balance-paid failed" }, 500);
    }
```

PayPal — after the `invoiceRef` branch:

```js
    const orderPayRef = parseOrderPayCustomId(orderId);
    if (orderPayRef) {
      if (event.event_type !== "PAYMENT.CAPTURE.COMPLETED") {
        return json({ received: true });
      }
      const oSubMethod = await extractPayPalWebhookSubMethod(event, env);
      const oAmountCents = Math.round(parseFloat(resource.amount?.value || "0") * 100);
      const ok = await markOrderBalancePaid(env, {
        id: orderPayRef.id, token: orderPayRef.token, method: "paypal",
        subMethod: oSubMethod, ref: resource.id || String(orderId), amountCents: oAmountCents,
      });
      return ok ? json({ received: true }) : json({ error: "balance-paid failed" }, 500);
    }
```

- [ ] **Step 6: Syntax-check the worker**

Run: `node --check workers/checkout.js`
Expected: no output (valid).

- [ ] **Step 7: Commit**

```bash
git add workers/checkout.js
git commit -m "feat(statements): checkout worker order-balance payment rails"
```

---

### Task 9: Public pay page — `pay-order.html`

**Files:**
- Create: `pay-order.html` (copy of `pay-invoice.html`, script fully adapted)

**Interfaces:**
- Consumes: checkout worker endpoints from Task 8.
- Produces: the page the statement email links to (`?o=<id>&t=<token>`).

- [ ] **Step 1: Copy and retarget**

```bash
cp pay-invoice.html pay-order.html
```

In the copied file's `<head>`, replace the `<title>` and description meta with:

```html
<title>Muy Rico — Order Balance / Saldo de Pedido</title>
<meta name="robots" content="noindex">
```

- [ ] **Step 2: Replace the entire `<script>…</script>` block**

Replace everything between `<script>` and `</script>` (inclusive of contents) with:

```js
'use strict';

const WORKER = 'https://muy-rico-checkout.bexgarcia0208.workers.dev';
const params = new URLSearchParams(location.search);
const O_ID = params.get('o') || '';
const TOKEN = params.get('t') || '';
const PAID_FLAG = params.get('paid') === 'stripe';

const STR = {
  en: {
    loading: 'Loading…', hi: (n) => `Hi ${n},`, orderHash: (n) => `Order #${n}`,
    total: 'Total', paid: 'Paid to date', balance: 'Balance due',
    payCard: (amt) => `Pay ${amt} by Card`, or: 'or', confirming: 'Confirming your payment…',
    confirmLong: 'Still confirming — you will receive a confirmation email shortly.',
    successT: 'Payment received!', successB: 'Thank you! We just emailed your receipt — see you soon!',
    alreadyT: 'Balance already paid', alreadyB: 'Thank you! This order has no balance due — no further action needed.',
    invalidT: 'Link not available', invalidB: 'This payment link is invalid or no longer active. Please contact us and we will help you.',
    errPay: 'Payment could not be completed. Please try again or contact us.',
    processing: 'Processing…', secure: 'Secure payment via Stripe & PayPal',
    payments: 'Payments received', none: 'No payments recorded yet.',
    pickup: 'Pickup',
  },
  es: {
    loading: 'Cargando…', hi: (n) => `Hola ${n},`, orderHash: (n) => `Pedido #${n}`,
    total: 'Total', paid: 'Pagado a la fecha', balance: 'Saldo pendiente',
    payCard: (amt) => `Pagar ${amt} con tarjeta`, or: 'o', confirming: 'Confirmando tu pago…',
    confirmLong: 'Seguimos confirmando — recibirás un correo de confirmación en breve.',
    successT: '¡Pago recibido!', successB: '¡Gracias! Acabamos de enviarte tu recibo — ¡hasta pronto!',
    alreadyT: 'Saldo ya pagado', alreadyB: '¡Gracias! Este pedido no tiene saldo pendiente — no necesitas hacer nada más.',
    invalidT: 'Enlace no disponible', invalidB: 'Este enlace de pago no es válido o ya no está activo. Contáctanos y con gusto te ayudamos.',
    errPay: 'No se pudo completar el pago. Intenta de nuevo o contáctanos.',
    processing: 'Procesando…', secure: 'Pago seguro con Stripe y PayPal',
    payments: 'Pagos recibidos', none: 'Aún no hay pagos registrados.',
    pickup: 'Recogida',
  },
};
let lang = 'es';
let order = null; // payable payload
let state = 'loading';
let paying = false;
const t = () => STR[lang];
const money = (c) => '$' + (Number(c) / 100).toFixed(2);
const chargeCents = () => order.balanceCents;

function setLang(l) { lang = l; document.documentElement.lang = l; render(); paintLangButtons(); }
function setLangSilently(l) { lang = l; document.documentElement.lang = l; }
function paintLangButtons() {
  const bar = document.getElementById('langBar');
  bar.style.display = '';
  document.getElementById('btnEn').className = lang === 'en' ? 'on' : '';
  document.getElementById('btnEs').className = lang === 'es' ? 'on' : '';
  document.getElementById('btnEn').setAttribute('aria-pressed', String(lang === 'en'));
  document.getElementById('btnEs').setAttribute('aria-pressed', String(lang === 'es'));
}
function esc(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }

function render() {
  const app = document.getElementById('app');
  const s = t();
  if (state === 'loading') {
    app.innerHTML = `<p class="msg muted"><span class="spin"></span>${esc(s.loading)}</p>`;
  } else if (state === 'invalid') {
    app.innerHTML = `<div class="msg err"><h1>${esc(s.invalidT)}</h1><p class="muted">${esc(s.invalidB)}</p></div>`;
  } else if (state === 'already') {
    app.innerHTML = `<div class="msg ok"><h1>${esc(s.alreadyT)}</h1><p class="muted">${esc(s.alreadyB)}</p></div>`;
  } else if (state === 'confirming') {
    app.innerHTML = `<p class="msg muted"><span class="spin"></span>${esc(s.confirming)}</p>`;
  } else if (state === 'confirm-timeout') {
    app.innerHTML = `<div class="msg ok"><h1>✓</h1><p class="muted">${esc(s.confirmLong)}</p></div>`;
  } else if (state === 'success') {
    app.innerHTML = `<div class="msg ok"><h1>${esc(s.successT)}</h1><p class="muted">${esc(s.successB)}</p></div>`;
  } else if (state === 'pay-error') {
    app.innerHTML = `<div class="msg err"><p class="muted">${esc(s.errPay)}</p></div>` + payBody();
    wirePayButtons();
  } else if (state === 'payable') {
    app.innerHTML = payBody();
    wirePayButtons();
  }
}

function payBody() {
  const s = t();
  const itemsRows = (order.items || []).map(i =>
    `<tr><td>${esc(i.name)}</td><td>&times;${esc(i.qty)}</td></tr>`).join('');
  const paymentRows = (order.payments || []).map(p =>
    `<tr><td>${esc(p.date)}</td><td>${esc(p.methodLabel)}</td><td>${money(p.amountCents)}</td></tr>`).join('');
  const btnLabel = paying
    ? `<span class="spin" style="border-color:rgba(250,246,236,.3);border-top-color:#FAF6EC"></span>${esc(s.processing)}`
    : esc(s.payCard(money(chargeCents())));
  return `
    <h1>${esc(s.orderHash(order.orderId))}</h1>
    <p class="sub">${esc(s.hi(order.customerName))}${order.pickupDate ? ` · ${esc(s.pickup)} ${esc(order.pickupDate)}` : ''}</p>
    ${itemsRows ? `<table class="items">${itemsRows}</table>` : ''}
    <table class="totals">
      <tr><td>${esc(s.total)}</td><td>${money(order.totalCents)}</td></tr>
      <tr><td>${esc(s.paid)}</td><td>&minus;${money(order.paidCents)}</td></tr>
      <tr class="hi"><td>${esc(s.balance)}</td><td>${money(order.balanceCents)}</td></tr>
    </table>
    <h2 style="font-size:13px;margin:18px 0 6px;color:#8a8078;text-transform:uppercase;letter-spacing:1px;">${esc(s.payments)}</h2>
    ${paymentRows ? `<table class="items">${paymentRows}</table>` : `<p class="msg muted">${esc(s.none)}</p>`}
    <button class="btn-pay" id="btnCard" ${paying ? 'disabled' : ''}>${btnLabel}</button>
    <div class="divider">${esc(s.or)}</div>
    <div id="paypal-area"></div>
    <p class="msg muted"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true" style="vertical-align:-1px;margin-right:4px"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>${esc(s.secure)}</p>`;
}

async function loadOrder() {
  const res = await fetch(`${WORKER}/order/${encodeURIComponent(O_ID)}/payable?t=${encodeURIComponent(TOKEN)}`);
  if (!res.ok) { state = 'invalid'; render(); return; }
  order = await res.json();
  setLangSilently(order.language === 'en' ? 'en' : 'es');
  if (order.paid) { state = 'already'; }
  else if (order.status === 'cancelled') { state = 'invalid'; }
  else if (PAID_FLAG) { state = 'confirming'; pollForPaid(); }
  else { state = 'payable'; }
  render();
}

async function pollForPaid() {
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 2500));
    try {
      const res = await fetch(`${WORKER}/order/${encodeURIComponent(O_ID)}/payable?t=${encodeURIComponent(TOKEN)}`);
      if (res.ok) {
        const o = await res.json();
        if (o.paid) { state = 'success'; render(); return; }
      }
    } catch { /* keep polling */ }
  }
  state = 'confirm-timeout'; render();
}

function wirePayButtons() {
  document.getElementById('btnCard').addEventListener('click', payByCard);
  renderPayPal();
}

async function payByCard() {
  if (paying) return;
  const btn = document.getElementById('btnCard');
  paying = true;
  btn.disabled = true;
  btn.innerHTML = `<span class="spin" style="border-color:rgba(250,246,236,.3);border-top-color:#FAF6EC"></span>${esc(t().processing)}`;
  try {
    const res = await fetch(`${WORKER}/order/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: Number(O_ID), token: TOKEN, origin: location.origin }),
    });
    const data = await res.json();
    // 409 means the balance changed or was settled while this page was open —
    // reload the payable payload instead of sending a stale charge.
    if (res.status === 409) { paying = false; await loadOrder(); return; }
    if (!res.ok || !data.url) throw new Error(data.error || 'checkout failed');
    window.location = data.url;
  } catch (e) {
    console.error(e);
    paying = false;
    state = 'pay-error'; render();
  }
}

let paypalScriptReady = null;
async function renderPayPal() {
  try {
    if (!window.paypal) {
      if (!paypalScriptReady) {
        paypalScriptReady = (async () => {
          const cfg = await (await fetch(`${WORKER}/paypal-client-id`)).json();
          if (!cfg.clientId) throw new Error('no paypal client id');
          await loadScript(`https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(cfg.clientId)}&currency=USD&intent=capture`);
        })();
      }
      await paypalScriptReady;
    }
    window.paypal.Buttons({
      createOrder: (_data, actions) => actions.order.create({
        purchase_units: [{
          amount: { value: (chargeCents() / 100).toFixed(2) },
          custom_id: `o${order.orderId}:${TOKEN}`,
        }],
      }),
      onApprove: async (data) => {
        try {
          state = 'confirming'; render();
          const res = await fetch(`${WORKER}/order/paypal-capture`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: order.orderId, token: TOKEN, paypalOrderId: data.orderID }),
          });
          if (!res.ok) throw new Error('capture failed');
          state = 'success'; render();
        } catch (e) {
          console.error(e);
          state = 'pay-error'; render();
        }
      },
      onError: (err) => { console.error(err); state = 'pay-error'; render(); },
    }).render('#paypal-area');
  } catch (e) {
    console.error('paypal render failed', e);
  }
}
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src; el.onload = resolve; el.onerror = reject;
    document.head.appendChild(el);
  });
}

document.getElementById('btnEn').addEventListener('click', () => setLang('en'));
document.getElementById('btnEs').addEventListener('click', () => setLang('es'));

if (!O_ID || !TOKEN) { state = 'invalid'; }
render();
if (state !== 'invalid') loadOrder();
paintLangButtons();
```

- [ ] **Step 3: Verify locally with stubbed API (Playwright)**

Serve the page and intercept the worker calls. Create `/tmp/payorder-check.py`:

```python
from playwright.sync_api import sync_playwright
import json

PAYLOAD = {
  "orderId": 65, "customerName": "Stacy Stout", "pickupDate": "2026-10-07",
  "language": "en", "status": "pending", "subtotalCents": 12000, "discountCents": 4000,
  "totalCents": 8000, "paidCents": 6000, "balanceCents": 2000, "paid": False,
  "items": [{"name": "Lemon Cupcake ×24", "qty": 1, "price": 40}],
  "payments": [{"date": "2026-10-06", "amountCents": 6000, "methodLabel": "Card"}],
}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 420, "height": 900})
    page.route("**/order/65/payable*", lambda r: r.fulfill(
        status=200, content_type="application/json", body=json.dumps(PAYLOAD)))
    page.route("**/paypal-client-id", lambda r: r.fulfill(
        status=200, content_type="application/json", body='{"clientId":""}'))
    page.goto("file:///Users/garciafam/Documents/website/Muy-Rico-V2/pay-order.html?o=65&t=" + "a"*32)
    page.wait_for_timeout(1500)
    body = page.inner_text("body")
    assert "$20.00" in body, body
    assert "Balance due" in body, body
    assert "Pay $20.00 by Card" in body, body
    assert "Card" in body and "$60.00" in body, body
    page.get_by_role("button", name="ES").click()
    page.wait_for_timeout(300)
    assert "Saldo pendiente" in page.inner_text("body")
    page.screenshot(path="/tmp/pay-order-check.png")
    print("pay page OK")
    browser.close()
```

Run: `python3 /tmp/payorder-check.py`
Expected: `pay page OK`.

- [ ] **Step 4: Commit**

```bash
git add pay-order.html
git commit -m "feat(statements): order balance pay page"
```

---

### Task 10: Admin API client + StoreContext wiring

**Files:**
- Modify: `home-bakery-management-system/src/utils/api.ts`
- Modify: `home-bakery-management-system/src/context/StoreContext.tsx`

**Interfaces:**
- Produces (consumed by Tasks 11–12): `sendOrderStatement(orderId)`, `sendOverdueStatements()`; context methods `sendOrderStatement`, `sendOverdueStatements`.

- [ ] **Step 1: Add the API client functions**

In `utils/api.ts`, next to `sendInvoice`:

```ts
export interface SendStatementResult {
  ok: boolean;
  status?: string;
  balanceCents?: number;
  lastSentAt?: string | null;
  error?: string;
}

export async function sendOrderStatement(orderId: number): Promise<SendStatementResult> {
  return apiFetch(`/api/orders/${orderId}/send-statement`, { method: "POST" });
}

export interface SendOverdueResult {
  ok: boolean;
  sent: number;
  failed: number;
  skipped: Record<string, number>;
}

export async function sendOverdueStatements(): Promise<SendOverdueResult> {
  return apiFetch(`/api/orders/send-statements`, { method: "POST" });
}
```

- [ ] **Step 2: Wire the context**

In `StoreContext.tsx`:

2a. Extend the import list from `../utils/api` with `sendOrderStatement as apiSendOrderStatement, sendOverdueStatements as apiSendOverdueStatements, type SendStatementResult, type SendOverdueResult`.

2b. In the store interface (near `handleSendInvoice`):

```ts
  handleSendOrderStatement: (orderId: number) => Promise<SendStatementResult>;
  handleSendOverdueStatements: () => Promise<SendOverdueResult>;
```

2c. Implement next to `handleSendInvoice`:

```ts
  const handleSendOrderStatement = useCallback(async (orderId: number): Promise<SendStatementResult> => {
    return apiSendOrderStatement(orderId);
  }, []);

  const handleSendOverdueStatements = useCallback(async (): Promise<SendOverdueResult> => {
    return apiSendOverdueStatements();
  }, []);
```

2d. Add both to the provider value object and the `useMemo` dependency array (follow `handleSendInvoice` exactly).

- [ ] **Step 3: Typecheck**

Run: `cd home-bakery-management-system && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add home-bakery-management-system/src/utils/api.ts home-bakery-management-system/src/context/StoreContext.tsx
git commit -m "feat(statements): admin API client for statement sends"
```

---

### Task 11: Order detail — "Send balance statement" button

**Files:**
- Modify: `home-bakery-management-system/src/types.ts` (Order.email)
- Modify: `home-bakery-management-system/src/context/StoreContext.tsx` (map `email`)
- Modify: `home-bakery-management-system/src/pages/Orders.tsx`

**Interfaces:**
- Consumes: `handleSendOrderStatement` (Task 10), `orderEvents` already loaded per order.

- [ ] **Step 1: Add `email` to the Order model**

`types.ts` — add to `interface Order` after `phone`:

```ts
  email: string;
```

`StoreContext.tsx` — in the `refreshOrders` mapping add after `phone: r.phone || "",`:

```ts
          email: r.email || "",
```

- [ ] **Step 2: Add state + handler in Orders.tsx**

In `Orders.tsx`, destructure from the store (add `handleSendOrderStatement`):

```ts
  const { orders, products, payments, customers, apiDeductInventory, recordPayment, profile, apiUpdateOrder, apiDeleteOrder, handleRelinkOrder, refreshOrders, refreshPayments, refreshLabelTemplates, receipts, resendReceipt, generateReceipt, handleSendOrderStatement } = useStore();
```

Add state next to `generatingLabels`:

```ts
  const [stmtBusy, setStmtBusy] = useState(false);
  const [stmtMsg, setStmtMsg] = useState("");

  const lastStatementAt = useMemo(() => {
    const sent = orderEvents.filter((e) => e.event === "statement:sent");
    return sent.length ? sent[sent.length - 1].created_at : null;
  }, [orderEvents]);
```

- [ ] **Step 3: Render the button in the payment panel**

Inside the order modal, directly after the "Remaining balance" block (the closing `</>` of the partial branch), add:

```tsx
                  {(() => {
                    const today = new Date().toISOString().slice(0, 10);
                    const overdue = !!selected.dueDate && selected.dueDate < today && selected.status !== "cancelled";
                    const canSend = selected.paymentStatus !== "paid" && !!selected.email && overdue;
                    if (selected.paymentStatus === "paid") return null;
                    return (
                      <div className="space-y-2 pt-2 border-t border-sand-100">
                        <button
                          disabled={!canSend || stmtBusy}
                          title={!selected.email ? "Add an email to send a statement" : undefined}
                          onClick={async () => {
                            if (stmtBusy) return;
                            if (lastStatementAt) {
                              const sentMs = new Date(lastStatementAt.replace(" ", "T") + "Z").getTime();
                              const hours = (Date.now() - sentMs) / 3600000;
                              if (hours < 24 && !window.confirm(`Reminded ${hours < 1 ? "just now" : Math.round(hours) + " hours ago"}. Send again?`)) return;
                            }
                            setStmtBusy(true);
                            setStmtMsg("");
                            try {
                              const r = await handleSendOrderStatement(Number(selected.id));
                              setStmtMsg(r.lastSentAt ? `Statement sent — balance $${((r.balanceCents || 0) / 100).toFixed(2)}` : "Statement sent.");
                              const fresh = await fetchOrder(Number(selected.id));
                              if (eventsFetchId.current === Number(selected.id)) setOrderEvents(fresh.events);
                            } catch (err: any) {
                              setStmtMsg(err?.message || "Could not send the statement.");
                            } finally {
                              setStmtBusy(false);
                            }
                          }}
                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-coral/40 bg-coral-light/20 py-2.5 text-sm font-semibold text-coral transition hover:bg-coral-light/40 disabled:opacity-50"
                        >
                          <Wallet size={16} /> {stmtBusy ? "Sending…" : "Send balance statement"}
                        </button>
                        {!selected.email && (
                          <p className="text-xs text-cocoa-muted">Add an email to this order to send a statement.</p>
                        )}
                        {lastStatementAt && (
                          <p className="text-xs text-cocoa-muted">Last reminder: {formatDateTime(lastStatementAt.replace(" ", "T") + "Z")}</p>
                        )}
                        {stmtMsg && (
                          <p className={`text-xs ${/Could not|could not|failed/i.test(stmtMsg) ? "text-hibiscus" : "text-mid-green"}`}>{stmtMsg}</p>
                        )}
                      </div>
                    );
                  })()}
```

Placement: insert this block immediately after the `</div>` that closes the `selected.paymentStatus === "partial"` branch (the `<div className="space-y-2">…</div>` block), so it renders for both `partial` and `unpaid` orders. The block itself returns `null` when the order is fully paid.

- [ ] **Step 4: Typecheck + build**

Run: `cd home-bakery-management-system && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Manual verification in the local dev harness**

Start local workers (`npx -y wrangler@4.127.0 dev -c orders/wrangler.toml --port 8787 --persist-to <fresh dir seeded with a test order>`) + the running Vite dev server, open an overdue partial order, confirm:
- Button enabled with email, disabled without.
- Sending shows "Statement sent" and "Last reminder: …".
- The order events gain `statement:sent` (visible in the timeline if shown).

- [ ] **Step 6: Commit**

```bash
git add home-bakery-management-system/src/types.ts home-bakery-management-system/src/context/StoreContext.tsx home-bakery-management-system/src/pages/Orders.tsx
git commit -m "feat(statements): send balance statement from the order detail"
```

---

### Task 12: Orders list — "Remind all overdue" banner

**Files:**
- Modify: `home-bakery-management-system/src/pages/Orders.tsx`

**Interfaces:**
- Consumes: `handleSendOverdueStatements` (Task 10), existing `paidCentsForOrder`.

- [ ] **Step 1: Destructure + compute**

Add `handleSendOverdueStatements` to the store destructure (same line as Task 11's addition).

Add below the existing `filtered` memo:

```ts
  const overdueStatementCandidates = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return orders.filter((o) => {
      if (o.status === "cancelled") return false;
      if (!o.dueDate || o.dueDate >= today) return false;
      if (!o.email) return false;
      const paid = paidCentsForOrder(payments, o.id) / 100;
      return o.total - paid > 0.005;
    });
  }, [orders, payments]);

  const [bulkStmtBusy, setBulkStmtBusy] = useState(false);
  const [bulkStmtMsg, setBulkStmtMsg] = useState("");
```

- [ ] **Step 2: Render the banner**

In the "Needs attention" block (after the `unpaid` chip), add:

```tsx
            {overdueStatementCandidates.length > 0 && (
              <button
                disabled={bulkStmtBusy}
                onClick={async () => {
                  const total = overdueStatementCandidates.reduce((s, o) => {
                    const paid = paidCentsForOrder(payments, o.id) / 100;
                    return s + Math.max(0, o.total - paid);
                  }, 0);
                  if (!window.confirm(`Send balance statements to ${overdueStatementCandidates.length} overdue order(s) (${formatCurrency(total)} owed)?`)) return;
                  setBulkStmtBusy(true);
                  setBulkStmtMsg("");
                  try {
                    const r = await handleSendOverdueStatements();
                    const skipped = Object.entries(r.skipped || {})
                      .filter(([k, v]) => v > 0 && k !== "cancelled")
                      .map(([k, v]) => `${v} ${k}`)
                      .join(", ");
                    setBulkStmtMsg(`Sent ${r.sent} · Failed ${r.failed}${skipped ? ` · Skipped: ${skipped}` : ""}`);
                  } catch (err: any) {
                    setBulkStmtMsg(err?.message || "Could not send statements.");
                  } finally {
                    setBulkStmtBusy(false);
                  }
                }}
                className="rounded-full bg-coral px-2.5 py-1 font-semibold text-white ring-1 ring-inset ring-coral transition hover:opacity-90 disabled:opacity-60"
              >
                {bulkStmtBusy ? "Sending…" : `Remind all overdue (${overdueStatementCandidates.length})`}
              </button>
            )}
```

Note: the enclosing `if (!overdue && !today && !unpaid) return null;` guard must also account for the new chip. Change it to:

```ts
        if (!overdue && !today && !unpaid && overdueStatementCandidates.length === 0) return null;
```

and render the banner message below the chips row:

```tsx
          {bulkStmtMsg && (
            <div className="w-full text-xs text-cocoa-muted">{bulkStmtMsg}</div>
          )}
```

- [ ] **Step 3: Typecheck + build**

Run: `cd home-bakery-management-system && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Manual verification**

In the local harness with an overdue partial order seeded:
- The chip appears with the count; confirm dialog shows count + total.
- After sending, the message reports sent/skipped counts.
- Re-running immediately reports the cooldown skip (`1 recent`).

- [ ] **Step 5: Commit**

```bash
git add home-bakery-management-system/src/pages/Orders.tsx
git commit -m "feat(statements): remind-all-overdue bulk action"
```

---

### Task 13: End-to-end local pass + deploy runbook

**Files:**
- No code changes (verification + ops).

- [ ] **Step 1: Full worker suite**

Run: `cd orders && npx vitest run`
Expected: all pass, including the 5 new test files.

- [ ] **Step 2: Admin typecheck + build**

Run: `cd home-bakery-management-system && npm run build`
Expected: typecheck clean; bundle written; `postbuild.sh` copies to `admin/index.html`.

- [ ] **Step 3: Local end-to-end (no live payment)**

1. Fresh local D1 (temp `--persist-to` dir) seeded with order 65-like data (`total_cents=8000`, one $60 payment, past pickup, email).
2. Start `npx -y wrangler@4.127.0 dev -c orders/wrangler.toml --port 8787 --persist-to <dir>`.
3. `curl -s -X POST http://127.0.0.1:8787/api/orders/65/send-statement`
   Expected: `{"ok":true,...}` or 502 with a `statement:failed` row when `RESEND_API_KEY` is absent locally (both acceptable; verify the `order_statements` row and token were written either way).
4. `curl -s "http://127.0.0.1:8787/api/public/orders/65/balance?t=<token>"` → verify the payload math (total 8000, paid 6000, balance 2000).
5. Re-run send → verify the cooldown path only in the bulk endpoint; single send still allows (with the UI confirm).
6. Admin dev server → order 65 → "Send balance statement" → verify button states and last-reminder line; Orders list → "Remind all overdue" → verify counts.

- [ ] **Step 4: Deploy runbook (execute only after owner approves the pending deploy batch)**

```bash
# 1. Pending migration first, then this feature's migration
npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0050_orders_quote_id.sql
npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0051_order_balance_statements.sql

# 2. Orders API worker
npx wrangler deploy -c orders/wrangler.toml

# 3. Checkout worker
cd workers && npx wrangler deploy && cd ..

# 4. Assets (admin bundle already built in Step 2)
npx wrangler versions upload --name muyrico --assets . --compatibility-date 2025-03-21
npx wrangler versions deploy --name muyrico <VERSION_ID>@100%
```

- [ ] **Step 5: Post-deploy smoke (owner-assisted, real $ small order)**

1. Send a statement to a real overdue order; open the email; confirm payments list, balance, and the pay button.
2. Pay with a card; confirm the pay page success state, the ledger row (with `ref`), the order balance dropping to $0, and the confirmation email showing Paid to date + Balance due $0.00.
3. Replay safety: refresh the pay page → "Balance already paid"; re-triggering the webhook records nothing new.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore(statements): local verification and deploy runbook notes"
```

(If there are no file changes, skip the commit — this task is verification-only; do not create empty commits.)

---

## Self-Review Notes

- Spec coverage: data model → Task 1; eligibility/balance → Tasks 2, 5; statement email → Tasks 3, 4; pay page → Tasks 8, 9; public balance → Task 6; ledger write + idempotency → Task 7; checkout rails → Task 8; admin UI (single + bulk + last-sent) → Tasks 11, 12; error handling → Tasks 4–7 tests; deployment → Task 13.
- Type consistency: `orderBalanceCents` / `isStatementEligible` / `selectStatementRecipients` / `deliverStatement` / `paymentsForEmail` / `loadActivePayments` / `ensurePayToken` are defined once (Tasks 2, 4) and referenced with identical names later.
- Deliberately out of scope per spec: scheduled sends, partial payments, SMS/PDF, token rotation.
