# Receipt Backfill & File Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin find old orders missing receipts and email them from a selectable list, and turn any receipt into a shareable/downloadable PNG or PDF file (mobile + desktop) instead of an admin-only HTML URL.

**Architecture:** Two new admin-only Worker endpoints (`GET /api/orders/missing-receipts`, `POST /api/orders/send-receipts`) reuse the proven `sendCustomerConfirmation` → Resend → `logReceiptWithId` path. On the client, a single `ReceiptDocument` DOM render is captured at 3× with `html-to-image`; that PNG is both the PNG deliverable and the embedded image inside a paginated A4 `pdf-lib` PDF, so the two formats cannot diverge. Share/download/print reuse the label-proven helpers.

**Tech Stack:** Cloudflare Workers + D1 (orders worker), React 19 + Vite + Tailwind 4 admin SPA, `pdf-lib`, `html-to-image`, Vitest (jsdom), Playwright, macOS `qlmanage` for PDF→PNG inspection.

## Global Constraints

- Receipts MUST visually match `orders/workers/receipt-html.js` wording/palette (verbatim strings copied in this plan): palm `#1e4636`, green `#2d7a46`, cocoa `#4a423d`, muted `#8a8078`, sand background `#faf7f2`.
- Do NOT modify `src/utils/labelExport.ts`, `src/utils/labelRasterPdf.ts`, or any label code.
- Do NOT modify the `receipts` table schema. No new migrations.
- New API routes are admin-only: never add them to the public allowlist block in `orders/workers/api.js` (lines 155–193).
- Customer emails are sent ONLY from an explicit user click (send-selected / row send / resend). Tests never hit real Resend: stub `fetch`.
- `orders/` tests: `cd orders && npm test`. Admin tests: `cd home-bakery-management-system && npm test`. Typecheck: `cd home-bakery-management-system && npm run typecheck`.
- Admin build is a single file copied to `admin/index.html` + `app/index.html` by `postbuild.sh`; never hand-edit those built files.
- Max 25 ids per send-receipts request; 600 ms delay between sends; client chunks of 10.
- Receipt file filenames: `muy-rico-receipt-<orderNumber>-<lang>.pdf|png` where `<orderNumber>` is `MR-<orderId>`.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `orders/workers/api.js` | Modify | 2 routes + `listOrdersMissingReceipts` + `sendReceiptsForOrders` |
| `orders/tests/missing-receipts.test.js` | Create | Endpoint unit tests |
| `home-bakery-management-system/src/utils/receiptView.ts` | Create | Pure snapshot+order → view model (server wording port) |
| `home-bakery-management-system/src/utils/receiptView.test.ts` | Create | View-model tests |
| `home-bakery-management-system/src/utils/receiptExport.ts` | Create | Capture → PNG/PDF, filenames, share/download |
| `home-bakery-management-system/src/utils/receiptExport.test.ts` | Create | Export unit tests |
| `home-bakery-management-system/src/components/receipt/ReceiptDocument.tsx` | Create | Branded 794 px receipt DOM |
| `home-bakery-management-system/src/components/receipt/ReceiptExportHost.tsx` | Create | Offscreen render + action runner |
| `home-bakery-management-system/src/assets/muy_rico_logo_email.png` | Copy from repo root | Offline logo for capture |
| `home-bakery-management-system/src/types.ts` | Modify | `Receipt.language`, `MissingReceiptOrder` |
| `home-bakery-management-system/src/utils/api.ts` | Modify | `fetchOrderRaw`, missing-receipt endpoints, `language` on `ApiReceipt` |
| `home-bakery-management-system/src/context/StoreContext.tsx` | Modify | Missing-receipts state + send handler |
| `home-bakery-management-system/src/pages/Receipts.tsx` | Modify | Tabs, missing list, file actions, export host |
| `home-bakery-management-system/e2e/receipt-visual.mjs` | Create | Playwright functional + artifact script |

---

### Task 1: Worker endpoints — missing list + bulk send

**Files:**
- Modify: `orders/workers/api.js` (routes after line 280; handlers after `generateReceiptForOrder`, line 1463)
- Test: `orders/tests/missing-receipts.test.js`

**Interfaces:**
- Consumes: `sendCustomerConfirmation(env, order)` (`api.js:1229`), `logReceiptWithId(env, order, emailResult, orderId, receiptId)` (`api.js:1305`), `json(data, status)`, `env.DB`.
- Produces (HTTP): `GET /api/orders/missing-receipts` → `{ orders: [...] }`; `POST /api/orders/send-receipts` body `{ ids: number[], language?: "auto"|"en"|"es" }` → `{ results: [{ id, ok, status, messageId?, reason? }], sent, failed, skipped }` (200) or `{ error }` (400).

- [ ] **Step 1: Write the failing test**

Create `orders/tests/missing-receipts.test.js`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../workers/api.js';

function makeEnv({ ordersById = {}, missingRows = [], secret = 's3cret' } = {}) {
  const calls = [];
  const db = {
    prepare(sql) {
      const stmt = {
        _sql: sql,
        _binds: [],
        bind(...args) { stmt._binds = args; return stmt; },
        async first() {
          calls.push({ sql, binds: stmt._binds, method: 'first' });
          if (/FROM orders WHERE id = \?/.test(sql)) return ordersById[stmt._binds[0]] ?? null;
          return null;
        },
        async run() {
          calls.push({ sql, binds: stmt._binds, method: 'run' });
          return { meta: { last_row_id: 1, changes: 1 } };
        },
        async all() {
          calls.push({ sql, binds: stmt._binds, method: 'all' });
          if (/FROM orders o/.test(sql)) return { results: missingRows };
          return { results: [] };
        },
      };
      return stmt;
    },
  };
  return { env: { DB: db, RESEND_API_KEY: 're_test' }, calls };
}

function authedRequest(path, { method = 'GET', body } = {}) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

afterEach(() => vi.unstubAllGlobals());

const GOOD_ORDER = {
  id: 7, customer_name: 'Ana', email: 'ana@example.com', language: 'es',
  items_json: '[]', total_cents: 1000, payment_method: 'cash', payment_sub_method: null,
  status: 'completed', payment_status: 'paid',
};

describe('GET /api/orders/missing-receipts', () => {
  it('returns candidate orders with attempt metadata', async () => {
    const { env } = makeEnv({ missingRows: [{ id: 7, customer_name: 'Ana', email: 'ana@example.com', receipt_attempts: 1, last_receipt_status: 'failed' }] });
    const res = await worker.fetch(authedRequest('/api/orders/missing-receipts'), env, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.orders).toHaveLength(1);
    expect(body.orders[0].receipt_attempts).toBe(1);
  });

  it('filters to orders with an email and no sent receipt', async () => {
    const { env, calls } = makeEnv({});
    await worker.fetch(authedRequest('/api/orders/missing-receipts'), env, {});
    const list = calls.find((c) => /FROM orders o/.test(c.sql));
    expect(list.sql).toContain("TRIM(COALESCE(o.email, '')) != ''");
    expect(list.sql).toContain("r.status = 'sent'");
  });
});

describe('POST /api/orders/send-receipts', () => {
  it('rejects empty, oversized, non-integer id lists and bad language', async () => {
    const { env } = makeEnv({});
    for (const body of [{ ids: [] }, { ids: [1, 2], language: 'fr' }]) {
      const res = await worker.fetch(authedRequest('/api/orders/send-receipts', { method: 'POST', body }), env, {});
      expect(res.status).toBe(400);
    }
    const tooMany = { ids: Array.from({ length: 26 }, (_, i) => i + 1) };
    const res = await worker.fetch(authedRequest('/api/orders/send-receipts', { method: 'POST', body: tooMany }), env, {});
    expect(res.status).toBe(400);
    const badId = await worker.fetch(authedRequest('/api/orders/send-receipts', { method: 'POST', body: { ids: ['x'] } }), env, {});
    expect(badId.status).toBe(400);
  });

  it('sends, logs a sent receipt, and writes the generated event', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'msg_1' }) }));
    vi.stubGlobal('fetch', fetchMock);
    const { env, calls } = makeEnv({ ordersById: { 7: GOOD_ORDER } });
    const res = await worker.fetch(authedRequest('/api/orders/send-receipts', { method: 'POST', body: { ids: [7] } }), env, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ sent: 1, failed: 0, skipped: 0 });
    expect(body.results[0]).toMatchObject({ id: 7, ok: true, status: 'sent', messageId: 'msg_1' });
    const insert = calls.find((c) => /INSERT INTO receipts/.test(c.sql));
    expect(insert).toBeTruthy();
    expect(insert.binds.at(-1)).toBe('es');
    expect(calls.some((c) => c.sql.includes('order_events') && c.binds[2] === 'receipt:generated')).toBe(true);
  });

  it('honors the language override on the logged receipt row', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ id: 'msg_2' }) })));
    const { env, calls } = makeEnv({ ordersById: { 7: GOOD_ORDER } });
    await worker.fetch(authedRequest('/api/orders/send-receipts', { method: 'POST', body: { ids: [7], language: 'en' } }), env, {});
    const insert = calls.find((c) => /INSERT INTO receipts/.test(c.sql));
    expect(insert.binds.at(-1)).toBe('en');
  });

  it('skips orders with no email or no order row, and reports failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, text: async () => 'nope' })));
    const { env, calls } = makeEnv({
      ordersById: { 7: { ...GOOD_ORDER, email: null }, 8: GOOD_ORDER },
    });
    const res = await worker.fetch(
      authedRequest('/api/orders/send-receipts', { method: 'POST', body: { ids: [7, 8, 999] } }),
      env, {}
    );
    const body = await res.json();
    expect(body.skipped).toBe(2);
    expect(body.failed).toBe(1);
    const statuses = Object.fromEntries(body.results.map((r) => [r.id, r.status]));
    expect(statuses[7]).toBe('skipped');
    expect(statuses[999]).toBe('skipped');
    expect(statuses[8]).toBe('failed');
    expect(calls.some((c) => /INSERT INTO order_events/.test(c.sql))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd orders && npx vitest run tests/missing-receipts.test.js`
Expected: FAIL — 404 `Not found` / handler missing.

- [ ] **Step 3: Add routes**

In `orders/workers/api.js` after the `backfill-labels` route (currently line 278–280), add:

```js
      // Receipt backfill: orders with an email but no successful receipt
      if (path === '/api/orders/missing-receipts' && method === 'GET') {
        return await listOrdersMissingReceipts(request, env);
      }
      if (path === '/api/orders/send-receipts' && method === 'POST') {
        return await sendReceiptsForOrders(request, env, actorName);
      }
```

- [ ] **Step 4: Add handlers**

In `orders/workers/api.js` after `generateReceiptForOrder` (currently ends line 1463), add:

```js
async function listOrdersMissingReceipts(request, env) {
  const sp = new URL(request.url).searchParams;
  const search = (sp.get('search') || '').trim();
  const limit = Math.min(Number(sp.get('limit')) || 200, 500);

  const where = [
    "TRIM(COALESCE(o.email, '')) != ''",
    "NOT EXISTS (SELECT 1 FROM receipts r WHERE r.order_id = o.id AND r.status = 'sent')",
  ];
  const binds = [];
  if (search) {
    where.push("(o.customer_name LIKE ? OR o.email LIKE ? OR ('MR-' || o.id) LIKE ?)");
    binds.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  binds.push(limit);

  const sql = `
    SELECT o.id, o.customer_name, o.email, o.phone, o.created_at, o.pickup_date,
           o.payment_status, o.status, o.total_cents, o.language,
           (SELECT COUNT(*) FROM receipts r WHERE r.order_id = o.id) AS receipt_attempts,
           (SELECT r.status FROM receipts r WHERE r.order_id = o.id
             ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS last_receipt_status,
           (SELECT r.created_at FROM receipts r WHERE r.order_id = o.id
             ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS last_receipt_at
    FROM orders o
    WHERE ${where.join(' AND ')}
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT ?
  `;
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return json({ orders: results }, 200);
}

const SEND_RECEIPTS_MAX_IDS = 25;
const SEND_RECEIPTS_DELAY_MS = 600;
const SEND_RECEIPTS_LANGUAGES = new Set(['auto', 'en', 'es']);

async function sendReceiptsForOrders(request, env, actor) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const ids = body && body.ids;
  const language = (body && body.language) || 'auto';
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > SEND_RECEIPTS_MAX_IDS) {
    return json({ error: `ids must be an array of 1-${SEND_RECEIPTS_MAX_IDS} order ids` }, 400);
  }
  if (!ids.every((v) => Number.isInteger(v) && v > 0)) {
    return json({ error: 'ids must be positive integers' }, 400);
  }
  if (!SEND_RECEIPTS_LANGUAGES.has(language)) {
    return json({ error: 'language must be auto, en, or es' }, 400);
  }

  const results = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
    if (!order) {
      results.push({ id, ok: false, status: 'skipped', reason: 'not_found' });
    } else if (!order.email || !String(order.email).trim()) {
      results.push({ id, ok: false, status: 'skipped', reason: 'no_email' });
    } else {
      const orderForSend = language === 'auto' ? order : { ...order, language };
      const emailResult = await sendCustomerConfirmation(env, orderForSend);
      const receiptId = `rcpt_${id}_${Date.now().toString(36)}`;
      await logReceiptWithId(env, orderForSend, emailResult, id, receiptId);
      await env.DB.prepare(
        `INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, 'receipt:generated')`
      ).bind(id, actor || 'system').run();
      results.push({
        id,
        ok: !!emailResult.ok,
        status: emailResult.ok ? 'sent' : 'failed',
        messageId: emailResult.messageId || null,
      });
    }
    // Resend's default rate limit is 2 req/s — space sequential sends.
    if (i < ids.length - 1) await new Promise((r) => setTimeout(r, SEND_RECEIPTS_DELAY_MS));
  }

  return json({
    results,
    sent: results.filter((r) => r.status === 'sent').length,
    failed: results.filter((r) => r.status === 'failed').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
  }, 200);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd orders && npm test`
Expected: PASS (all existing + new; the 2-id test waits ~600 ms, well under the 5 s vitest default).

- [ ] **Step 6: Commit**

```bash
git add orders/workers/api.js orders/tests/missing-receipts.test.js
git commit -m "feat(receipts): admin endpoints to list and backfill missing receipts"
```

---

### Task 2: Receipt view model (client port of `receipt-html.js`)

**Files:**
- Create: `home-bakery-management-system/src/utils/receiptView.ts`
- Test: `home-bakery-management-system/src/utils/receiptView.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces (used by Tasks 4–5): `buildReceiptViewModel(receipt: ReceiptViewInput, order: ReceiptViewOrder | null, lang: "en" | "es"): ReceiptViewModel`.

- [ ] **Step 1: Write the failing test**

Create `home-bakery-management-system/src/utils/receiptView.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildReceiptViewModel } from "./receiptView";
import type { ReceiptViewInput, ReceiptViewOrder } from "./receiptView";

const RECEIPT: ReceiptViewInput = {
  receiptId: "rcpt_7_abc",
  orderId: 7,
  orderNumber: "MR-7",
  customerName: "Ana",
  itemsJson: JSON.stringify([{ name: "Concha", name_es: "Concha", name_en: "Sweet Bread", qty: 2, price: 2.5 }]),
  totalCents: 500,
  paymentMethod: "stripe",
  paymentSubMethod: JSON.stringify({ type: "card", brand: "visa", last4: "4242" }),
  orderStatus: "completed",
  language: "es",
  createdAt: "2026-01-02 10:00:00",
};

const ORDER: ReceiptViewOrder = {
  id: 7,
  customer_name: "Ana",
  items_json: JSON.stringify([{ name: "Concha", name_es: "Concha", name_en: "Sweet Bread", qty: 2, price: 2.5 }]),
  total_cents: 500,
  subtotal_cents: 600,
  discount_cents: 100,
  payment_method: "stripe",
  payment_sub_method: JSON.stringify({ type: "card", brand: "visa", last4: "4242" }),
  status: "completed",
  payment_status: "paid",
  pickup_date: "2026-01-05",
  pickup_time: "10:00",
  created_at: "2026-01-02 10:00:00",
  notes: "Sin canela",
  language: "es",
};

describe("buildReceiptViewModel", () => {
  it("uses the live order when present and the snapshot otherwise", () => {
    const live = buildReceiptViewModel(RECEIPT, ORDER, "es");
    expect(live.pickupDate).toBe("2026-01-05");
    expect(live.notes).toBe("Sin canela");
    expect(live.discountCents).toBe(100);
    expect(live.subtotalCents).toBe(600);

    const snapshot = buildReceiptViewModel(RECEIPT, null, "es");
    expect(snapshot.pickupDate).toBeNull();
    expect(snapshot.paymentStatus).toBe("paid");
    expect(snapshot.totalCents).toBe(500);
  });

  it("picks item names by language and formats card labels", () => {
    const es = buildReceiptViewModel(RECEIPT, ORDER, "es");
    expect(es.items[0].name).toBe("Concha");
    expect(es.paymentLabel).toBe("Visa (…4242)");
    const en = buildReceiptViewModel(RECEIPT, ORDER, "en");
    expect(en.items[0].name).toBe("Sweet Bread");
    expect(en.labels.receipt).toBe("RECEIPT");
    expect(en.labels.total).toBe("TOTAL PAID");
    expect(en.labels.footer).toBe("Muy Rico Bakery · Holland, Michigan · Familia · Tradición · Sabor");
  });

  it("renders invoice wording for unpaid and partial orders", () => {
    const unpaid = buildReceiptViewModel(RECEIPT, { ...ORDER, payment_status: "unpaid" }, "en");
    expect(unpaid.labels.receipt).toBe("INVOICE");
    expect(unpaid.labels.total).toBe("TOTAL DUE");
    expect(unpaid.labels.paidNote).toBe("Your order is confirmed. Payment is due at pickup.");
    const partial = buildReceiptViewModel(RECEIPT, { ...ORDER, payment_status: "partial" }, "es");
    expect(partial.labels.receipt).toBe("FACTURA");
    expect(partial.labels.total).toBe("TOTAL");
    expect(partial.labels.paidNote).toBe("Tu pedido está confirmado. Depósito recibido — el saldo se paga al recoger.");
  });

  it("gates a stale card sub-method on cash and survives broken items JSON", () => {
    const stale = buildReceiptViewModel(RECEIPT, { ...ORDER, payment_method: "cash" }, "en");
    expect(stale.paymentLabel).toBe("Cash");
    const broken = buildReceiptViewModel({ ...RECEIPT, itemsJson: "not json" }, null, "en");
    expect(broken.items).toEqual([]);
    expect(broken.rawItemsText).toBe("not json");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd home-bakery-management-system && npx vitest run src/utils/receiptView.test.ts`
Expected: FAIL — cannot resolve `./receiptView`.

- [ ] **Step 3: Implement the view model**

Create `home-bakery-management-system/src/utils/receiptView.ts`:

```ts
// Port of orders/workers/receipt-html.js for the client-rendered receipt
// document. Wording and palette must stay in sync with the server module;
// receiptView.test.ts pins the exact strings.

export interface ReceiptViewInput {
  receiptId: string;
  orderId: number;
  orderNumber?: string | null;
  customerName: string;
  itemsJson: string;
  totalCents: number;
  paymentMethod: string;
  paymentSubMethod?: string | null;
  orderStatus: string;
  language?: string | null;
  createdAt: string;
}

export interface ReceiptViewOrder {
  id: number;
  customer_name: string;
  items_json: string;
  total_cents: number;
  subtotal_cents?: number | null;
  discount_cents?: number | null;
  payment_method: string;
  payment_sub_method?: string | null;
  status: string;
  payment_status: string;
  pickup_date?: string | null;
  pickup_time?: string | null;
  created_at?: string;
  notes?: string | null;
  language?: string | null;
}

export interface ReceiptViewItem {
  name: string;
  qty: number;
  price: number;
}

export interface ReceiptViewModel {
  receiptId: string;
  orderId: number;
  orderNumber: string;
  customerName: string;
  email: string | null;
  createdAt: string;
  pickupDate: string | null;
  pickupTime: string | null;
  items: ReceiptViewItem[];
  rawItemsText: string | null;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  paymentLabel: string;
  statusLabel: string;
  notes: string | null;
  paymentStatus: "paid" | "partial" | "unpaid";
  language: "en" | "es";
  labels: ReceiptViewLabels;
}

export interface ReceiptViewLabels {
  receipt: string;
  thanks: string;
  paidNote: string;
  date: string;
  payment: string;
  statusLabel: string;
  pickup: string;
  order: string;
  item: string;
  qty: string;
  amount: string;
  subtotal: string;
  discount: string;
  total: string;
  notes: string;
  contact: string;
  footer: string;
}

export function buildMethodLabel(method: string, subMethod: string | null | undefined, isEn: boolean): string {
  let label: string;
  if (method === "stripe") label = isEn ? "Card" : "Tarjeta";
  else if (method === "paypal") label = "PayPal";
  else if (method === "cashapp") label = "Cash App";
  else if (method === "venmo") label = "Venmo";
  else if (method === "applepay") label = "Apple Pay";
  else if (method === "cash") label = isEn ? "Cash" : "Efectivo";
  else label = method || "—";
  if (subMethod) {
    try {
      const parsed = JSON.parse(subMethod);
      if (method === "stripe" && parsed.type === "card" && parsed.brand) {
        const brand = parsed.brand.charAt(0).toUpperCase() + parsed.brand.slice(1).toLowerCase();
        const funding = parsed.funding
          ? " " + parsed.funding.charAt(0).toUpperCase() + parsed.funding.slice(1).toLowerCase()
          : "";
        const last4 = parsed.last4 ? " (…" + parsed.last4 + ")" : "";
        label = `${brand}${funding}${last4}`;
      } else if (method === "paypal" && parsed.type === "paypal_wallet") {
        label = "PayPal Wallet";
      }
    } catch {
      /* keep base label */
    }
  }
  return label;
}

export function formatStatusLabel(status: string, isEn: boolean): string {
  const map: Record<string, string> = isEn
    ? {
        pending: "Pending",
        "in-progress": "In Progress",
        ready: "Ready",
        completed: "Completed",
        cancelled: "Cancelled",
        awaiting_payment: "Awaiting Payment",
      }
    : {
        pending: "Pendiente",
        "in-progress": "En Progreso",
        ready: "Listo",
        completed: "Completado",
        cancelled: "Cancelado",
        awaiting_payment: "Esperando Pago",
      };
  return map[status] || status;
}

function emailMeta(paymentStatus: string, isEn: boolean) {
  const isPaid = paymentStatus === "paid";
  const isPartial = paymentStatus === "partial";
  return isEn
    ? {
        receipt: isPaid ? "RECEIPT" : "INVOICE",
        thanks: "Thank you for your order!",
        paidNote: isPaid
          ? "Your payment was received and your order is being prepared."
          : isPartial
            ? "Your order is confirmed. Deposit received — balance due at pickup."
            : "Your order is confirmed. Payment is due at pickup.",
        date: "Date",
        payment: "Payment",
        statusLabel: "Status",
        pickup: "Pickup",
        total: isPaid ? "TOTAL PAID" : isPartial ? "TOTAL" : "TOTAL DUE",
        contact: "Questions about your order? Reply to this email or call/text us at (616) 218-3582.",
        footer: "Muy Rico Bakery · Holland, Michigan · Familia · Tradición · Sabor",
      }
    : {
        receipt: isPaid ? "RECIBO" : "FACTURA",
        thanks: "¡Gracias por tu pedido!",
        paidNote: isPaid
          ? "Tu pago fue recibido y tu pedido se está preparando."
          : isPartial
            ? "Tu pedido está confirmado. Depósito recibido — el saldo se paga al recoger."
            : "Tu pedido está confirmado. El pago se realiza al recoger.",
        date: "Fecha",
        payment: "Pago",
        statusLabel: "Estado",
        pickup: "Recogida",
        total: isPaid ? "TOTAL PAGADO" : isPartial ? "TOTAL" : "TOTAL A PAGAR",
        contact: "¿Preguntas sobre tu pedido? Responde a este correo o llámanos al (616) 218-3582.",
        footer: "Muy Rico Bakery · Holland, Michigan · Familia · Tradición · Sabor",
      };
}

export function buildReceiptViewModel(
  receipt: ReceiptViewInput,
  order: ReceiptViewOrder | null,
  lang: "en" | "es",
): ReceiptViewModel {
  const isEn = lang === "en";
  const paymentStatus: "paid" | "partial" | "unpaid" =
    order?.payment_status === "partial" ? "partial" : order?.payment_status === "unpaid" ? "unpaid" : "paid";
  const meta = emailMeta(paymentStatus, isEn);
  const labels: ReceiptViewLabels = {
    ...meta,
    order: "Order",
    item: isEn ? "Item" : "Producto",
    qty: isEn ? "Qty" : "Cant.",
    amount: isEn ? "Amount" : "Importe",
    subtotal: "Subtotal",
    discount: isEn ? "Discount" : "Descuento",
    notes: isEn ? "Notes" : "Notas",
  };

  const customerName = order?.customer_name ?? receipt.customerName;
  const itemsJson = order?.items_json ?? receipt.itemsJson;
  const totalCents = Number(order?.total_cents ?? receipt.totalCents) || 0;
  const discountCents = Number(order?.discount_cents ?? 0) || 0;
  const subtotalCents = Number(order?.subtotal_cents ?? 0) || totalCents + discountCents;
  const method = order?.payment_method ?? receipt.paymentMethod;
  const subMethod = order?.payment_sub_method ?? receipt.paymentSubMethod ?? null;
  const orderStatus = order?.status ?? receipt.orderStatus;
  const createdAt = order?.created_at ?? receipt.createdAt;

  let items: ReceiptViewItem[] = [];
  let rawItemsText: string | null = null;
  try {
    const parsed = JSON.parse(itemsJson);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    items = parsed.map((i: { name?: string; name_en?: string; name_es?: string; qty?: number; price?: number }) => ({
      name: (isEn ? i.name_en : i.name_es) || i.name || "",
      qty: Number(i.qty) || 0,
      price: Number(i.price) || 0,
    }));
  } catch {
    rawItemsText = itemsJson || null;
  }

  return {
    receiptId: receipt.receiptId,
    orderId: receipt.orderId,
    orderNumber: receipt.orderNumber || `MR-${receipt.orderId}`,
    customerName,
    email: null,
    createdAt,
    pickupDate: order?.pickup_date ?? null,
    pickupTime: order?.pickup_time ?? null,
    items,
    rawItemsText,
    subtotalCents,
    discountCents,
    totalCents,
    paymentLabel: buildMethodLabel(method, subMethod, isEn),
    statusLabel: orderStatus ? formatStatusLabel(orderStatus, isEn) : "—",
    notes: (order?.notes ?? "").trim() || null,
    paymentStatus,
    language: lang,
    labels,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd home-bakery-management-system && npx vitest run src/utils/receiptView.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add home-bakery-management-system/src/utils/receiptView.ts home-bakery-management-system/src/utils/receiptView.test.ts
git commit -m "feat(receipts): client receipt view model ported from the email renderer"
```

---

### Task 3: Receipt export engine (capture → PNG/PDF)

**Files:**
- Copy: repo-root `muy_rico_logo_email.png` → `home-bakery-management-system/src/assets/muy_rico_logo_email.png`
- Create: `home-bakery-management-system/src/utils/receiptExport.ts`
- Test: `home-bakery-management-system/src/utils/receiptExport.test.ts`

**Interfaces:**
- Consumes: `pdf-lib` (`PDFDocument`), `html-to-image` (`toPng`, `getFontEmbedCSS`).
- Produces (used by Task 5): `RECEIPT_DOC_WIDTH_PX`, `computeReceiptPages`, `captureReceiptNode`, `receiptPdfFromCapture`, `dataUrlToBlob`, `receiptFileName`, `downloadReceiptFile`, `shareReceiptFile`.

- [ ] **Step 1: Copy the logo asset**

```bash
cp muy_rico_logo_email.png home-bakery-management-system/src/assets/muy_rico_logo_email.png
```

(`images.d.ts` already declares `*.png`.)

- [ ] **Step 2: Write the failing test**

Create `home-bakery-management-system/src/utils/receiptExport.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import zlib from "zlib";
import {
  computeReceiptPages,
  receiptPdfFromCapture,
  dataUrlToBlob,
  receiptFileName,
} from "./receiptExport";

// Tiny valid 2×2 PNG fixture (node zlib — no canvas needed), same technique as
// labelRasterPdf.test.ts.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function tinyPngDataUrl(w = 2, h = 2): string {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const stride = w * 3 + 1;
  const raw = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * stride + 1 + x * 3;
      raw[o] = 200; raw[o + 1] = 120; raw[o + 2] = 60;
    }
  }
  const idat = zlib.deflateSync(raw);
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const png = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { png.set(p, off); off += p.length; }
  return "data:image/png;base64," + Buffer.from(png).toString("base64");
}

describe("computeReceiptPages", () => {
  it("computes a single page for a short receipt", () => {
    const { pageCount, scale } = computeReceiptPages(794, 900);
    expect(pageCount).toBe(1);
    expect(scale).toBeGreaterThan(1);
  });

  it("paginates a long receipt and never returns zero pages", () => {
    expect(computeReceiptPages(794, 4000).pageCount).toBeGreaterThan(1);
    expect(computeReceiptPages(794, 1).pageCount).toBe(1);
  });

  it("throws on invalid dimensions", () => {
    expect(() => computeReceiptPages(0, 100)).toThrow();
  });
});

describe("receiptPdfFromCapture", () => {
  it("builds an A4 PDF slicing a tall capture across pages", async () => {
    const capture = { dataUrl: tinyPngDataUrl(), widthPx: 794, heightPx: 4000 };
    const bytes = await receiptPdfFromCapture(capture);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    const expected = computeReceiptPages(capture.widthPx, capture.heightPx).pageCount;
    expect(doc.getPageCount()).toBe(expected);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(595.28, 1);
    expect(height).toBeCloseTo(841.89, 1);
  });
});

describe("receiptFileName / dataUrlToBlob", () => {
  it("builds language-tagged filenames and PNG blobs", () => {
    expect(receiptFileName("MR-7", "en", "pdf")).toBe("muy-rico-receipt-MR-7-en.pdf");
    expect(receiptFileName("MR-7", "es", "png")).toBe("muy-rico-receipt-MR-7-es.png");
    const blob = dataUrlToBlob(tinyPngDataUrl());
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd home-bakery-management-system && npx vitest run src/utils/receiptExport.test.ts`
Expected: FAIL — cannot resolve `./receiptExport`.

- [ ] **Step 4: Implement the export engine**

Create `home-bakery-management-system/src/utils/receiptExport.ts`:

```ts
// Receipt file export: one DOM capture feeds BOTH the PNG deliverable and the
// PDF (embedded image), so the two formats can never drift apart.
import { PDFDocument } from "pdf-lib";
import { toPng, getFontEmbedCSS } from "html-to-image";

export type ReceiptFileFormat = "png" | "pdf";

export interface ReceiptCapture {
  dataUrl: string;
  widthPx: number;
  heightPx: number;
}

export const RECEIPT_DOC_WIDTH_PX = 794; // A4 width at 96 dpi

const A4_W_PT = 595.28;
const A4_H_PT = 841.89;
const MARGIN_PT = 24;
const CONTENT_W_PT = A4_W_PT - MARGIN_PT * 2;
const CONTENT_H_PT = A4_H_PT - MARGIN_PT * 2;

export function computeReceiptPages(widthPx: number, heightPx: number): {
  pageCount: number;
  scale: number;
  pageHeightPx: number;
} {
  if (!(widthPx > 0) || !(heightPx > 0)) {
    throw new Error("Invalid receipt capture dimensions");
  }
  const scale = widthPx / CONTENT_W_PT;
  const pageHeightPx = CONTENT_H_PT * scale;
  const pageCount = Math.max(1, Math.ceil(heightPx / pageHeightPx));
  return { pageCount, scale, pageHeightPx };
}

function waitForImages(node: HTMLElement): Promise<void> {
  const imgs = Array.from(node.querySelectorAll("img"));
  return Promise.all(
    imgs.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          }),
    ),
  ).then(() => undefined);
}

export async function captureReceiptNode(
  node: HTMLElement,
  opts?: { scale?: number; skipFonts?: boolean },
): Promise<ReceiptCapture> {
  const scale = opts?.scale ?? 3;
  if (typeof document !== "undefined" && document.fonts?.ready) {
    await document.fonts.ready;
  }
  await waitForImages(node);
  const rect = node.getBoundingClientRect();
  const width = rect.width || RECEIPT_DOC_WIDTH_PX;
  const height = rect.height || node.scrollHeight;
  const base = {
    pixelRatio: scale,
    backgroundColor: "#ffffff",
    width,
    height,
    cacheBust: true,
  };
  try {
    const fontEmbedCSS = opts?.skipFonts ? undefined : await getFontEmbedCSS(node);
    const dataUrl = await toPng(
      node,
      fontEmbedCSS ? { ...base, fontEmbedCSS } : { ...base, skipFonts: true },
    );
    return { dataUrl, widthPx: Math.round(width * scale), heightPx: Math.round(height * scale) };
  } catch (err) {
    if (!opts?.skipFonts) return captureReceiptNode(node, { scale, skipFonts: true });
    throw err;
  }
}

export async function receiptPdfFromCapture(capture: ReceiptCapture): Promise<Uint8Array> {
  const { pageCount, scale } = computeReceiptPages(capture.widthPx, capture.heightPx);
  const heightPt = capture.heightPx / scale;
  const doc = await PDFDocument.create();
  const base64 = capture.dataUrl.slice(capture.dataUrl.indexOf(",") + 1);
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const img = await doc.embedPng(bytes);
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([A4_W_PT, A4_H_PT]);
    // Draw the full image shifted down one content-height per page; page bounds
    // crop each slice, so a tall receipt paginates with no clipping or scaling.
    const drawY = MARGIN_PT + CONTENT_H_PT - heightPt + i * CONTENT_H_PT;
    page.drawImage(img, { x: MARGIN_PT, y: drawY, width: CONTENT_W_PT, height: heightPt });
  }
  return doc.save();
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(",");
  const mime = /data:(.*?)[;,]/.exec(meta)?.[1] || "application/octet-stream";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function receiptFileName(orderNumber: string, lang: string, ext: ReceiptFileFormat): string {
  const safe = (orderNumber || "order").replace(/[^A-Za-z0-9-]/g, "");
  return `muy-rico-receipt-${safe}-${lang}.${ext}`;
}

export function downloadReceiptFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function shareReceiptFile(blob: Blob, filename: string): Promise<boolean> {
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
    share?: (data: ShareData) => Promise<void>;
  };
  if (typeof nav.canShare !== "function" || typeof nav.share !== "function") return false;
  const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
  try {
    if (!nav.canShare({ files: [file] })) return false;
    await nav.share({ files: [file], title: filename });
    return true;
  } catch {
    // User cancelled the sheet — treated as handled, not an error.
    return true;
  }
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd home-bakery-management-system && npx vitest run src/utils/receiptExport.test.ts && npm run typecheck`
Expected: PASS, no TS errors.

- [ ] **Step 6: Commit**

```bash
git add home-bakery-management-system/src/assets/muy_rico_logo_email.png home-bakery-management-system/src/utils/receiptExport.ts home-bakery-management-system/src/utils/receiptExport.test.ts
git commit -m "feat(receipts): capture-to-PNG/PDF export engine"
```

---

### Task 4: ReceiptDocument component

**Files:**
- Create: `home-bakery-management-system/src/components/receipt/ReceiptDocument.tsx`

**Interfaces:**
- Consumes: `ReceiptViewModel` from `../../utils/receiptView` (Task 2); logo asset; font TTFs.
- Produces (used by Task 5): `ReceiptDocument` React component, `RECEIPT_FONT_FACES` (a CSS string the export host also injects while capturing).

- [ ] **Step 1: Implement the component**

Create `home-bakery-management-system/src/components/receipt/ReceiptDocument.tsx`:

```tsx
import { forwardRef } from "react";
import logoUrl from "../../assets/muy_rico_logo_email.png";
import quicksandUrl from "../../assets/fonts/Quicksand-Regular.ttf";
import cormorantUrl from "../../assets/fonts/CormorantGaramond-Regular.ttf";
import { RECEIPT_DOC_WIDTH_PX } from "../../utils/receiptExport";
import type { ReceiptViewModel } from "../../utils/receiptView";

// Injected while the offscreen document exists so html-to-image can embed the
// brand fonts into the capture (see ReceiptExportHost).
export const RECEIPT_FONT_FACES = `
@font-face { font-family: 'Quicksand'; src: url(${quicksandUrl}) format('truetype'); font-display: block; }
@font-face { font-family: 'Cormorant Garamond'; src: url(${cormorantUrl}) format('truetype'); font-display: block; }
`;

const PALETTE = {
  palm: "#1e4636",
  green: "#2d7a46",
  cocoa: "#4a423d",
  muted: "#8a8078",
  faint: "#b8ada2",
  sand: "#faf7f2",
  rule: "#e3dcd2",
  mint: "#d4edda",
};

const money = (cents: number) => "$" + ((Number(cents) || 0) / 100).toFixed(2);

const ReceiptDocument = forwardRef<HTMLDivElement, { viewModel: ReceiptViewModel }>(
  function ReceiptDocument({ viewModel: vm }, ref) {
    const L = vm.labels;
    const orderDate = (vm.createdAt || "").slice(0, 10);
    const showDiscount = vm.discountCents > 0;
    const pickup = vm.pickupDate
      ? `${vm.pickupDate}${vm.pickupTime ? " " + vm.pickupTime : ""}`
      : "—";

    return (
      <div
        ref={ref}
        style={{
          width: RECEIPT_DOC_WIDTH_PX,
          background: "#ffffff",
          fontFamily: "'Quicksand', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          color: "#333",
          overflow: "hidden",
        }}
      >
        <div style={{ background: PALETTE.palm, padding: "38px 44px 32px", textAlign: "center" }}>
          <img
            src={logoUrl}
            alt="Muy Rico Bakery"
            width={220}
            style={{ width: 220, maxWidth: "62%", height: "auto", display: "block", margin: "0 auto 14px" }}
          />
          <div style={{ color: PALETTE.mint, fontSize: 13, letterSpacing: 4, fontWeight: 600 }}>
            {L.receipt}
          </div>
        </div>

        <div style={{ padding: "38px 44px 12px" }}>
          <h2
            style={{
              margin: "0 0 8px",
              color: PALETTE.green,
              fontSize: 26,
              fontFamily: "'Cormorant Garamond', serif",
              fontWeight: 600,
            }}
          >
            {L.thanks}
          </h2>
          <p style={{ margin: "0 0 26px", color: "#6b615a", fontSize: 15, lineHeight: 1.55 }}>
            {vm.customerName} — {L.paidNote}
          </p>

          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 26 }}>
            <tbody>
              <MetaRow label={L.date} value={orderDate} />
              <MetaRow label={L.payment} value={vm.paymentLabel} />
              <MetaRow label={L.statusLabel} value={vm.statusLabel} />
              <MetaRow label={L.pickup} value={pickup} />
              <MetaRow label={L.order} value={`#${vm.orderId}`} strong />
              {vm.notes ? <MetaRow label={L.notes} value={vm.notes} /> : null}
            </tbody>
          </table>

          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle("left")}>{L.item}</th>
                <th style={thStyle("center")}>{L.qty}</th>
                <th style={thStyle("right")}>{L.amount}</th>
              </tr>
            </thead>
            <tbody>
              {vm.rawItemsText ? (
                <tr>
                  <td style={{ padding: "12px 0", fontSize: 15, color: PALETTE.cocoa }} colSpan={3}>
                    {vm.rawItemsText}
                  </td>
                </tr>
              ) : (
                vm.items.map((item, i) => (
                  <tr key={i}>
                    <td style={tdStyle("left")}>{item.name}</td>
                    <td style={tdStyle("center", true)}>
                      {item.qty} × {money(item.price * 100)}
                    </td>
                    <td style={{ ...tdStyle("right"), fontWeight: 600 }}>{money(item.qty * item.price * 100)}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              {showDiscount ? (
                <>
                  <tr>
                    <td colSpan={2} style={totalLabelStyle(PALETTE.muted)}>{L.subtotal}</td>
                    <td style={totalValueStyle(PALETTE.muted)}>{money(vm.subtotalCents)}</td>
                  </tr>
                  <tr>
                    <td colSpan={2} style={totalLabelStyle(PALETTE.green, true)}>{L.discount}</td>
                    <td style={{ ...totalValueStyle(PALETTE.green), fontWeight: 600 }}>
                      −{money(vm.discountCents)}
                    </td>
                  </tr>
                </>
              ) : null}
              <tr>
                <td colSpan={2} style={{ padding: "18px 0 6px", color: PALETTE.palm, fontSize: 17, fontWeight: 700 }}>
                  {L.total}
                </td>
                <td
                  style={{
                    padding: "18px 0 6px",
                    color: PALETTE.palm,
                    fontSize: 22,
                    fontWeight: 700,
                    textAlign: "right",
                  }}
                >
                  {money(vm.totalCents)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div style={{ padding: "26px 44px 36px" }}>
          <p style={{ color: PALETTE.muted, fontSize: 14, lineHeight: 1.6, margin: "0 0 8px" }}>{L.contact}</p>
          <p style={{ color: PALETTE.faint, fontSize: 13, margin: "18px 0 0", textAlign: "center" }}>
            {L.footer}
          </p>
        </div>
      </div>
    );
  },
);

function MetaRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr>
      <td style={{ color: PALETTE.muted, fontSize: 14, padding: "4px 0", verticalAlign: "top" }}>{label}</td>
      <td
        style={{
          color: PALETTE.cocoa,
          fontSize: 14,
          textAlign: "right",
          padding: "4px 0",
          fontWeight: strong ? 600 : 400,
        }}
      >
        {value}
      </td>
    </tr>
  );
}

function thStyle(align: "left" | "center" | "right") {
  return {
    textAlign: align as const,
    color: PALETTE.muted,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: "uppercase" as const,
    paddingBottom: 10,
    borderBottom: `2px solid ${PALETTE.palm}`,
  };
}

function tdStyle(align: "left" | "center" | "right", muted = false) {
  return {
    padding: "12px 0",
    borderBottom: `1px dashed ${PALETTE.rule}`,
    color: muted ? PALETTE.muted : PALETTE.cocoa,
    fontSize: 15,
    textAlign: align as const,
    whiteSpace: "nowrap" as const,
  };
}

function totalLabelStyle(color: string, bold = false) {
  return { padding: "16px 0 4px", color, fontSize: 14, fontWeight: bold ? 600 : 400 };
}
function totalValueStyle(color: string) {
  return { padding: "16px 0 4px", color, fontSize: 14, textAlign: "right" as const };
}

export default ReceiptDocument;
```

- [ ] **Step 2: Typecheck**

Run: `cd home-bakery-management-system && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add home-bakery-management-system/src/components/receipt/ReceiptDocument.tsx
git commit -m "feat(receipts): branded ReceiptDocument render component"
```

---

### Task 5: Export host + client API/state plumbing

**Files:**
- Create: `home-bakery-management-system/src/components/receipt/ReceiptExportHost.tsx`
- Modify: `home-bakery-management-system/src/types.ts` (Receipt interface, MissingReceiptOrder)
- Modify: `home-bakery-management-system/src/utils/api.ts`
- Modify: `home-bakery-management-system/src/context/StoreContext.tsx`

**Interfaces:**
- Consumes: Tasks 1–4 outputs; `downloadPdf`/`printPdf`/`openPdfInNewTab` from `labelExport.ts`; `useToast`.
- Produces (used by Task 6): `ReceiptExportHost`, `ReceiptExportTarget`, `ReceiptExportAction`; StoreContext `missingReceipts`, `refreshMissingReceipts`, `sendMissingReceipts`; api `fetchOrderRaw`, `fetchMissingReceipts`, `sendMissingReceiptsApi`.

- [ ] **Step 1: Add types**

In `src/types.ts`, add `language: string | null;` to the `Receipt` interface (after `orderStatus`), and append:

```ts
export interface MissingReceiptOrder {
  id: number;
  customerName: string;
  email: string | null;
  phone: string | null;
  createdAt: string;
  pickupDate: string;
  paymentStatus: "paid" | "partial" | "unpaid";
  status: string;
  totalCents: number;
  language: string;
  receiptAttempts: number;
  lastReceiptStatus: string | null;
  lastReceiptAt: string | null;
}
```

- [ ] **Step 2: Add API client functions**

In `src/utils/api.ts`:
1. Add `email?: string | null;` and `language?: string | null;` to `interface ApiOrder`.
2. Add `language: string | null;` to `interface ApiReceipt`.
3. After the receipts section (after `shareReceipt`, ~line 938), add:

```ts
export interface ApiMissingReceiptOrder {
  id: number;
  customer_name: string;
  email: string | null;
  phone: string | null;
  created_at: string;
  pickup_date: string;
  payment_status: string;
  status: string;
  total_cents: number;
  language: string;
  receipt_attempts: number;
  last_receipt_status: string | null;
  last_receipt_at: string | null;
}

export interface SendReceiptsResult {
  results: { id: number; ok: boolean; status: "sent" | "failed" | "skipped"; messageId?: string | null; reason?: string }[];
  sent: number;
  failed: number;
  skipped: number;
}

export async function fetchOrderRaw(id: number): Promise<{ order: ApiOrder; events: ApiOrderEvent[] }> {
  return apiFetch(`/api/orders/${id}`);
}

export async function fetchMissingReceipts(search?: string): Promise<ApiMissingReceiptOrder[]> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  params.set("limit", "500");
  const data = await apiFetch<{ orders: ApiMissingReceiptOrder[] }>(`/api/orders/missing-receipts?${params.toString()}`);
  return data.orders;
}

export async function sendMissingReceiptsApi(
  ids: number[],
  language: "auto" | "en" | "es",
): Promise<SendReceiptsResult> {
  return apiFetch(`/api/orders/send-receipts`, {
    method: "POST",
    body: JSON.stringify({ ids, language }),
  });
}
```

- [ ] **Step 3: Wire StoreContext**

In `src/context/StoreContext.tsx`:
1. Import `MissingReceiptOrder` from `../types`; import `fetchMissingReceipts`, `sendMissingReceiptsApi`, `type ApiMissingReceiptOrder`, `type SendReceiptsResult` from `../utils/api`.
2. Context interface (near lines 55–58): add

```ts
  missingReceipts: MissingReceiptOrder[];
  refreshMissingReceipts: () => Promise<void>;
  sendMissingReceipts: (ids: number[], language: "auto" | "en" | "es") => Promise<SendReceiptsResult>;
```

3. State (near line 121): `const [missingReceipts, setMissingReceipts] = useState<MissingReceiptOrder[]>([]);`
4. Mapper + refresh (after `refreshReceipts` at ~line 397); note `apiToReceipt` also maps `language: row.language ?? null`:

```ts
  function apiToMissingReceipt(row: ApiMissingReceiptOrder): MissingReceiptOrder {
    return {
      id: row.id,
      customerName: row.customer_name,
      email: row.email,
      phone: row.phone,
      createdAt: row.created_at,
      pickupDate: row.pickup_date,
      paymentStatus: (row.payment_status as MissingReceiptOrder["paymentStatus"]) || "paid",
      status: row.status,
      totalCents: row.total_cents,
      language: row.language || "es",
      receiptAttempts: Number(row.receipt_attempts) || 0,
      lastReceiptStatus: row.last_receipt_status,
      lastReceiptAt: row.last_receipt_at,
    };
  }

  const refreshMissingReceipts = useCallback(async () => {
    try {
      const rows = await fetchMissingReceipts();
      setMissingReceipts(rows.map(apiToMissingReceipt));
    } catch (err) {
      console.warn("Failed to fetch missing receipts from API:", err);
      setMissingReceipts([]);
    }
  }, []);

  const sendMissingReceipts = useCallback(async (ids: number[], language: "auto" | "en" | "es") => {
    const result = await sendMissingReceiptsApi(ids, language);
    await Promise.all([refreshMissingReceipts(), refreshReceipts()]);
    return result;
  }, [refreshMissingReceipts, refreshReceipts]);
```

5. Add `refreshMissingReceipts()` to the `refreshAll` `Promise.all` and its dependency array.
6. Add `missingReceipts`, `refreshMissingReceipts`, `sendMissingReceipts` to the context value object and its `useMemo` dependency array.

- [ ] **Step 4: Implement the export host**

Create `home-bakery-management-system/src/components/receipt/ReceiptExportHost.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import ReceiptDocument, { RECEIPT_FONT_FACES } from "./ReceiptDocument";
import type { ReceiptViewModel } from "../../utils/receiptView";
import {
  captureReceiptNode,
  dataUrlToBlob,
  downloadReceiptFile,
  receiptFileName,
  receiptPdfFromCapture,
  shareReceiptFile,
} from "../../utils/receiptExport";
import { downloadPdf, openPdfInNewTab, printPdf } from "../../utils/labelExport";

export type ReceiptExportAction = "download-png" | "download-pdf" | "share" | "print" | "open";

export interface ReceiptExportTarget {
  viewModel: ReceiptViewModel;
  action: ReceiptExportAction;
  shareFormat?: "png" | "pdf";
  win?: Window | null;
}

interface Props {
  target: ReceiptExportTarget | null;
  onDone: () => void;
  onError: (message: string) => void;
}

export default function ReceiptExportHost({ target, onDone, onError }: Props) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    if (!target || !nodeRef.current || runningRef.current) return;
    const vm = target.viewModel;
    runningRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        const node = nodeRef.current;
        if (!node) return;
        const capture = await captureReceiptNode(node);
        const pngBlob = dataUrlToBlob(capture.dataUrl);
        const needsPdf = target.action !== "download-png" && !(target.action === "share" && target.shareFormat === "png");
        const pdfBytes = needsPdf ? await receiptPdfFromCapture(capture) : null;
        const pngName = receiptFileName(vm.orderNumber, vm.language, "png");
        const pdfName = receiptFileName(vm.orderNumber, vm.language, "pdf");

        switch (target.action) {
          case "download-png":
            downloadReceiptFile(pngBlob, pngName);
            break;
          case "download-pdf":
            if (pdfBytes) downloadPdf(pdfBytes, pdfName);
            break;
          case "share": {
            const format = target.shareFormat === "png" ? "png" : "pdf";
            const shared =
              format === "png"
                ? await shareReceiptFile(pngBlob, pngName)
                : pdfBytes
                  ? await shareReceiptFile(new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" }), pdfName)
                  : false;
            if (!shared) {
              if (format === "png") downloadReceiptFile(pngBlob, pngName);
              else if (pdfBytes) downloadPdf(pdfBytes, pdfName);
            }
            break;
          }
          case "print":
            if (pdfBytes) printPdf(pdfBytes);
            break;
          case "open":
            if (pdfBytes) openPdfInNewTab(pdfBytes, target.win ?? undefined);
            break;
        }
        if (!cancelled) onDone();
      } catch (err) {
        if (!cancelled) onError(err instanceof Error ? err.message : "Could not build the receipt file.");
      } finally {
        runningRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [target, onDone, onError]);

  if (!target) return null;

  return createPortal(
    <div
      aria-hidden="true"
      style={{ position: "fixed", left: -100000, top: 0, width: 794, pointerEvents: "none" }}
    >
      <style>{RECEIPT_FONT_FACES}</style>
      <ReceiptDocument ref={nodeRef} viewModel={target.viewModel} />
    </div>,
    document.body,
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `cd home-bakery-management-system && npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add home-bakery-management-system/src/types.ts home-bakery-management-system/src/utils/api.ts home-bakery-management-system/src/context/StoreContext.tsx home-bakery-management-system/src/components/receipt/ReceiptExportHost.tsx
git commit -m "feat(receipts): export host, missing-receipt API client and store wiring"
```

---

### Task 6: Receipts page — missing tab + file actions

**Files:**
- Modify: `home-bakery-management-system/src/pages/Receipts.tsx`

**Interfaces:**
- Consumes: everything above; `useToast` from `../components/ui/Toast`; existing `resendReceipt` store handler.
- Produces: the finished UI.

- [ ] **Step 1: Replace page with tabs + export wiring**

Modify `src/pages/Receipts.tsx`. Keep `ReceiptDetail` unchanged. Replace imports/component top with:

```tsx
import { useCallback, useMemo, useState, Fragment } from "react";
import {
  MailCheck, MailX, Printer, RotateCw, Search, Download, Share2, Eye,
  FileText, FileImage, ExternalLink, Send,
} from "lucide-react";
import { useStore } from "../context/StoreContext";
import { useToast } from "../components/ui/Toast";
import { formatCurrency, formatDateTime, formatDate, PAYMENT_METHOD_LABELS, formatPaymentSubMethod } from "../utils/format";
import { fetchOrderRaw } from "../utils/api";
import ReceiptExportHost, { type ReceiptExportTarget, type ReceiptExportAction } from "../components/receipt/ReceiptExportHost";
import { buildReceiptViewModel } from "../utils/receiptView";
import type { Receipt } from "../types";
```

Inside `Receipts`:
- Add `const toast = useToast();` next to the existing `useStore()` call, and extend the destructure to `const { receipts, resendReceipt, missingReceipts } = useStore();` (the missing tab uses the other handlers through its own `useStore()`).
- Add `const [tab, setTab] = useState<"history" | "missing">("history");`
- Add export state and handler:

```tsx
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exportTarget, setExportTarget] = useState<ReceiptExportTarget | null>(null);
  const [langs, setLangs] = useState<Record<string, "en" | "es">>({});

  const runExport = useCallback(
    async (r: Receipt, action: ReceiptExportAction, win?: Window | null) => {
      const lang = langs[r.id] ?? (r.language === "en" ? "en" : "es");
      setBusyId(r.id);
      try {
        const raw = await fetchOrderRaw(Number(r.orderId)).catch(() => null);
        setExportTarget({
          viewModel: buildReceiptViewModel(r, raw?.order ?? null, lang),
          action,
          win: win ?? null,
        });
      } catch (e) {
        setBusyId(null);
        toast.error(e instanceof Error ? e.message : "Could not prepare the receipt.");
      }
    },
    [langs, toast],
  );

  const finishExport = useCallback(() => {
    setBusyId(null);
    setExportTarget(null);
  }, []);
  const failExport = useCallback((message: string) => {
    setBusyId(null);
    setExportTarget(null);
    toast.error(message);
  }, [toast]);
```

- Replace the mobile actions grid (current lines ~112–132) with:

```tsx
            <div className="mt-3 grid grid-cols-4 gap-2">
              <FileAction icon={<FileText size={16} />} label="PDF" busy={busyId === r.id} onClick={() => runExport(r, "download-pdf")} />
              <FileAction icon={<FileImage size={16} />} label="PNG" busy={busyId === r.id} onClick={() => runExport(r, "download-png")} />
              <FileAction icon={<Share2 size={16} />} label="Share" busy={busyId === r.id} onClick={() => runExport(r, "share", "pdf")} />
              <button
                onClick={() => {
                  const win = window.open("", "_blank");
                  void runExport(r, "open", win);
                }}
                disabled={busyId === r.id}
                className="flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-xl border border-sand-200 bg-sand-50 px-2 py-2 text-xs font-semibold text-cocoa hover:bg-sand-100 disabled:opacity-50"
              >
                <ExternalLink size={16} /> Open
              </button>
            </div>
            <div className="mt-2 flex gap-2">
              <LangToggle value={langs[r.id] ?? (r.language === "en" ? "en" : "es")} onChange={(v) => setLangs((m) => ({ ...m, [r.id]: v }))} />
              <button
                onClick={() => handleResend(r)}
                disabled={resending === r.id}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-sand-200 px-3 py-2.5 text-xs font-medium text-cocoa-muted hover:bg-sand-50 disabled:opacity-50 min-h-[44px]"
              >
                <RotateCw size={12} className={resending === r.id ? "animate-spin" : ""} />
                Resend
              </button>
            </div>
```

- Replace desktop actions (current lines ~230–262) with: `LangToggle` (compact) + PDF + PNG + Share + Print + Resend buttons, each `onClick={(e) => { e.stopPropagation(); ... }}`, using small `rounded-lg border border-sand-200 px-2.5 py-2 text-xs` styling. For Print use `runExport(r, "print")`; include a disabled state while `busyId === r.id`.

- Add helper components at the bottom of the file:

```tsx
function FileAction({
  icon, label, onClick, busy,
}: { icon: React.ReactNode; label: string; onClick: () => void; busy?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-xl border border-sand-200 bg-sand-50 px-2 py-2 text-xs font-semibold text-cocoa hover:bg-sand-100 disabled:opacity-50"
    >
      {icon} {busy ? "…" : label}
    </button>
  );
}

function LangToggle({ value, onChange }: { value: "en" | "es"; onChange: (v: "en" | "es") => void }) {
  return (
    <div className="flex flex-1 items-center gap-0.5 rounded-lg border border-sand-200 overflow-hidden">
      {(["en", "es"] as const).map((l) => (
        <button
          key={l}
          onClick={() => onChange(l)}
          className={`flex-1 px-3 py-2.5 text-xs font-semibold uppercase min-h-[44px] ${
            value === l ? "bg-palm text-white" : "text-cocoa-muted hover:bg-sand-50"
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
```

- Add tabs above the status filter:

```tsx
      <div className="flex gap-1 rounded-xl border border-sand-200 bg-white p-1">
        <button
          onClick={() => setTab("history")}
          className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold min-h-[44px] ${tab === "history" ? "bg-palm text-white" : "text-cocoa-muted hover:bg-sand-50"}`}
        >
          History
        </button>
        <button
          onClick={() => setTab("missing")}
          className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold min-h-[44px] ${tab === "missing" ? "bg-palm text-white" : "text-cocoa-muted hover:bg-sand-50"}`}
        >
          Missing receipts{missingReceipts.length ? ` (${missingReceipts.length})` : ""}
        </button>
      </div>
```

- Wrap the existing history content in `{tab === "history" && (<> ... existing ... </>)}` and render `{tab === "missing" && <MissingTab search={search} />}`.
- Get `missingReceipts` from `useStore()`.
- Render `<ReceiptExportHost target={exportTarget} onDone={finishExport} onError={failExport} />` once at the end of the page.

- [ ] **Step 2: Implement the missing tab**

Add at the bottom of the file (before `ReceiptDetail`):

```tsx
function MissingTab({ search }: { search: string }) {
  const { missingReceipts, refreshMissingReceipts, sendMissingReceipts } = useStore();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [language, setLanguage] = useState<"auto" | "en" | "es">("auto");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return missingReceipts;
    return missingReceipts.filter(
      (m) =>
        m.customerName.toLowerCase().includes(q) ||
        (m.email || "").toLowerCase().includes(q) ||
        `MR-${m.id}`.toLowerCase().includes(q),
    );
  }, [missingReceipts, search]);

  const allSelected = filtered.length > 0 && filtered.every((m) => selected.has(m.id));

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function send(ids: number[]) {
    if (!ids.length) return;
    setSending(true);
    let sent = 0, failed = 0, skipped = 0;
    try {
      for (let i = 0; i < ids.length; i += 10) {
        const chunk = ids.slice(i, i + 10);
        setProgress(`Sending ${Math.min(i + 10, ids.length)} of ${ids.length}…`);
        const result = await sendMissingReceipts(chunk, language);
        sent += result.sent; failed += result.failed; skipped += result.skipped;
      }
      if (failed || skipped) toast.error(`Sent ${sent}, failed ${failed}, skipped ${skipped}.`);
      else toast.success(`Sent ${sent} receipt${sent === 1 ? "" : "s"}.`);
      setSelected(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sending receipts failed.");
    } finally {
      setSending(false);
      setProgress(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value as "auto" | "en" | "es")}
          className="input h-10 max-w-[220px]"
          disabled={sending}
        >
          <option value="auto">Auto (order language)</option>
          <option value="en">English</option>
          <option value="es">Español</option>
        </select>
        <button
          onClick={() => send([...selected])}
          disabled={sending || selected.size === 0}
          className="btn-primary min-h-[40px]"
        >
          <Send size={16} /> {sending ? progress || "Sending…" : `Send selected (${selected.size})`}
        </button>
        <button onClick={() => refreshMissingReceipts()} disabled={sending} className="btn-secondary min-h-[40px]">
          <RotateCw size={14} /> Refresh
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-sand-200 bg-white px-4 py-10 text-center text-cocoa-muted/70">
          Every order with an email has a receipt.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-sand-200 bg-white">
          <label className="flex items-center gap-3 border-b border-sand-100 px-4 py-3 text-xs font-semibold uppercase text-cocoa-muted/60">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(filtered.map((m) => m.id)))}
              className="h-4 w-4"
            />
            Select all
          </label>
          <ul className="divide-y divide-sand-100">
            {filtered.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} className="h-4 w-4" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-cocoa">
                    {m.customerName} <span className="text-cocoa-muted/60">· MR-{m.id}</span>
                  </p>
                  <p className="truncate text-xs text-cocoa-muted">{m.email}</p>
                </div>
                <div className="text-right text-xs text-cocoa-muted">
                  <p className="font-semibold text-cocoa">{formatCurrency(m.totalCents / 100)}</p>
                  <p>{m.pickupDate}</p>
                </div>
                <span className="rounded-full bg-sand-100 px-2 py-0.5 text-[11px] font-medium text-cocoa-muted">
                  {m.lastReceiptStatus === "failed"
                    ? "Failed"
                    : m.lastReceiptStatus === "printed"
                      ? "Print only"
                      : "Never sent"}
                </span>
                <button
                  onClick={() => send([m.id])}
                  disabled={sending}
                  className="rounded-lg border border-sand-200 px-3 py-2 text-xs font-medium text-cocoa-muted hover:bg-sand-50 min-h-[36px]"
                >
                  Send
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + tests**

Run: `cd home-bakery-management-system && npm run typecheck && npm test`
Expected: no type errors; all existing tests pass.

- [ ] **Step 4: Build**

Run: `cd home-bakery-management-system && npm run build`
Expected: build succeeds; `postbuild.sh` copies `dist/index.html` to `../admin/index.html` and `../app/index.html`.

- [ ] **Step 5: Commit**

```bash
git add home-bakery-management-system/src/pages/Receipts.tsx admin/index.html app/index.html
git commit -m "feat(receipts): missing-receipts tab and receipt file actions"
```

(`admin/index.html` and `app/index.html` are the built artifacts this repo commits — confirm the diff is only the rebuilt bundle.)

---

### Task 7: Playwright functional + visual verification script

**Files:**
- Create: `home-bakery-management-system/e2e/receipt-visual.mjs`

**Interfaces:**
- Consumes: the built app (`npm run build`), mocked API responses, downloads.
- Produces: screenshots + downloaded PNG/PDF in `/tmp/muyrico-receipts/` for the critic subagents.

- [ ] **Step 1: Write the script**

Create `home-bakery-management-system/e2e/receipt-visual.mjs`:

```js
// Receipt backfill + file export verification.
// Usage: cd home-bakery-management-system && npm run build && npm run preview -- --port 4180
//        node e2e/receipt-visual.mjs
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4180";
const OUT = "/tmp/muyrico-receipts";
fs.mkdirSync(OUT, { recursive: true });

const ITEMS_LONG = JSON.stringify(
  Array.from({ length: 14 }, (_, i) => ({
    name: `Producto ${i + 1}`, name_es: `Producto ${i + 1}`, name_en: `Product ${i + 1}`,
    qty: 2, price: 3.5,
  })),
);

const RECEIPTS = [
  {
    id: "rcpt_7_abc", orderId: 7, orderNumber: "MR-7", customerName: "Ana García",
    email: "ana@example.com", itemsJson: ITEMS_LONG, totalCents: 9800,
    paymentMethod: "stripe", paymentSubMethod: JSON.stringify({ type: "card", brand: "visa", last4: "4242" }),
    orderStatus: "completed", status: "sent", messageId: "msg_1",
    sentAt: "2026-01-02 10:01:00", createdAt: "2026-01-02 10:00:00", language: "es",
  },
  {
    id: "rcpt_8_def", orderId: 8, orderNumber: "MR-8", customerName: "John Smith",
    email: "john@example.com", itemsJson: ITEMS_LONG, totalCents: 4500,
    paymentMethod: "cash", paymentSubMethod: null,
    orderStatus: "pending", status: "printed", messageId: null,
    sentAt: "2026-01-03 09:00:00", createdAt: "2026-01-03 09:00:00", language: "en",
  },
];

const ORDER_7 = {
  id: 7, created_at: "2026-01-02 10:00:00", customer_name: "Ana García", customer_id: null,
  phone: "616-555-0100", pickup_date: "2026-01-05", pickup_time: "10:00", items_json: ITEMS_LONG,
  total_cents: 9800, subtotal_cents: 10300, discount_cents: 500, payment_method: "stripe",
  payment_sub_method: JSON.stringify({ type: "card", brand: "visa", last4: "4242" }),
  payment_status: "paid", status: "completed", notes: "Sin canela por favor", created_by: "jeff",
  source: "website", food_coloring: null, email: "ana@example.com", language: "es",
};
const ORDER_8 = {
  ...ORDER_7, id: 8, customer_name: "John Smith", payment_method: "cash",
  payment_sub_method: null, payment_status: "unpaid", items_json: ITEMS_LONG, notes: null,
  email: "john@example.com", language: "en",
};

const MISSING = {
  orders: [
    { id: 11, customer_name: "María López", email: "maria@example.com", phone: null, created_at: "2025-12-01 10:00:00", pickup_date: "2025-12-05", payment_status: "paid", status: "completed", total_cents: 5600, language: "es", receipt_attempts: 0, last_receipt_status: null, last_receipt_at: null },
    { id: 12, customer_name: "Jane Doe", email: "jane@example.com", phone: null, created_at: "2025-12-02 10:00:00", pickup_date: "2025-12-06", payment_status: "paid", status: "completed", total_cents: 3200, language: "en", receipt_attempts: 1, last_receipt_status: "failed", last_receipt_at: "2025-12-02 10:01:00" },
  ],
};

const JSON_HEADERS = { "content-type": "application/json" };

async function mockApi(page) {
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const path = new URL(url).pathname;
    const respond = (body) => route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify(body) });
    if (path === "/api/auth/verify") return respond({ email: "owner@muy-rico.com" });
    if (path === "/api/auth/device-token") return respond({ token: "test-token" });
    if (path === "/api/receipts") return respond({ receipts: RECEIPTS });
    if (path === "/api/orders/missing-receipts") return respond(MISSING);
    if (path === "/api/orders/send-receipts") {
      const body = JSON.parse(route.request().postData() || "{}");
      return respond({ results: (body.ids || []).map((id) => ({ id, ok: true, status: "sent", messageId: "m" })), sent: (body.ids || []).length, failed: 0, skipped: 0 });
    }
    if (path === "/api/orders/7") return respond({ order: ORDER_7, events: [] });
    if (path === "/api/orders/8") return respond({ order: ORDER_8, events: [] });
    if (path === "/api/orders") return respond({ orders: [ORDER_7, ORDER_8] });
    if (path === "/api/products" || path === "/api/inventory" || path === "/api/customers" || path === "/api/payments" || path === "/api/quotes" || path === "/api/invoices") return respond([]);
    if (path === "/api/inventory/groups") return respond([]);
    if (path === "/api/labels") return respond([]);
    if (path === "/api/profile") return respond({});
    return respond({});
  });
}

async function main() {
  const browser = await chromium.launch();
  const consoleErrors = [];
  for (const view of [
    { id: "mobile", vp: { width: 390, height: 844 } },
    { id: "desktop", vp: { width: 1280, height: 900 } },
  ]) {
    const ctx = await browser.newContext({ viewport: view.vp, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => consoleErrors.push(`${view.id} pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`${view.id} console: ${m.text()}`); });
    await page.addInitScript(() => {
      try { localStorage.setItem("muyrico.deviceToken", "test-token"); } catch {}
    });
    await mockApi(page);
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    // Open Receipts (mobile needs the menu first)
    if (view.id === "mobile") {
      await page.getByRole("button", { name: /menu/i }).first().click().catch(() => {});
    }
    await page.getByText("Receipts", { exact: false }).first().click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/${view.id}-history.png`, fullPage: true });

    // Missing tab
    await page.getByText(/Missing receipts/).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${view.id}-missing.png`, fullPage: true });
    const checkboxes = page.locator('input[type="checkbox"]');
    if (await checkboxes.count() > 1) await checkboxes.nth(1).check();
    await page.screenshot({ path: `${OUT}/${view.id}-missing-selected.png`, fullPage: true });

    // File actions (history tab)
    await page.getByText("History", { exact: true }).click();
    await page.waitForTimeout(400);
    for (const label of ["PDF", "PNG"]) {
      const downloadPromise = page.waitForEvent("download", { timeout: 20000 });
      await page.getByRole("button", { name: label, exact: false }).first().click();
      const download = await downloadPromise;
      await download.saveAs(`${OUT}/${view.id}-${download.suggestedFilename()}`);
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(`${OUT}/console.log`, consoleErrors.join("\n"));
  console.log(consoleErrors.length ? `CONSOLE ERRORS:\n${consoleErrors.join("\n")}` : "console clean");
  console.log("artifacts in " + OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it**

```bash
cd home-bakery-management-system && npm run preview -- --port 4180 &
sleep 2
node e2e/receipt-visual.mjs
```

Expected: `artifacts in /tmp/muyrico-receipts`, console clean (or only benign warnings), 4 screenshots + PNG downloads for both viewports. Verify signatures:

```bash
file /tmp/muyrico-receipts/*.png
```

- [ ] **Step 3: Render PDFs for visual inspection**

```bash
for f in /tmp/muyrico-receipts/*.pdf; do qlmanage -t -s 1600 -o /tmp/muyrico-receipts "$f" >/dev/null 2>&1; done
ls /tmp/muyrico-receipts
```

Expected: matching `*.pdf.png` renders.

- [ ] **Step 4: Commit**

```bash
git add home-bakery-management-system/e2e/receipt-visual.mjs
git commit -m "test(receipts): Playwright visual + functional verification script"
```

---

### Task 8: Harsh critic loops (orchestrator)

Run after Tasks 1–6 land and Tests/build are green.

- [ ] **Criterion loop A — backfill (Feature 1)**: dispatch a critic subagent with `/tmp/muyrico-receipts/*-missing*.png` + the worker test output. It must verify: tab count badge, select-all state, language selector, Send disabled at zero selection, chunked progress copy, summary toast on partial failure (mock a failing id), badges (Never sent / Failed / Print only), mobile touch targets ≥44 px, and that no email is sendable without a click. It returns `PASS` with evidence or `FAIL` with numbered defects. On FAIL, the implementer fixes and the same critic session re-verifies; repeat until PASS.
- [ ] **Criterion loop B — files (Feature 2)**: dispatch a critic subagent with `/tmp/muyrico-receipts/*.png|*.pdf|*.pdf.png`. It must verify against the Triple-A rubric in the spec: brand fonts rendered (compare `Quicksand`/`Cormorant` glyph shapes), logo crisp and undistorted, ≥24 px margins, dashed rule alignment, currency/EN-ES correctness, `TOTAL PAID`/`TOTAL A` wording, multi-page long receipt no clipping, PNG text sharp when zoomed, sensible filenames, share fallback path. It returns `PASS` with evidence or `FAIL` with numbered defects; loop until PASS.
- [ ] **Full regression**: `cd orders && npm test`, `cd home-bakery-management-system && npm test && npm run typecheck && npm run build`, then re-run `node e2e/receipt-visual.mjs` and confirm the only rebuilt-file diffs are `admin/index.html`, `app/index.html`.
- [ ] **Deploy note**: deploy worker first (`npx wrangler deploy -c orders/wrangler.toml`), then commit/push the rebuilt admin bundle. Do not deploy as part of automated tasks — confirm with the owner first.
