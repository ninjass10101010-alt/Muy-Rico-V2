# Quote Deposit Payment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a working "Pay 50% Deposit" button to priced quote emails; paying it online (Stripe/PayPal) auto-converts the quote to an order.

**Architecture:** Three pieces, all extending existing systems — (1) orders API (`orders/workers/api.js`): per-quote public token + deposit columns, token-guarded payable read, shared-secret `deposit-paid` endpoint that records the deposit and auto-converts via an extracted `convertQuoteToOrder`; (2) checkout worker (`workers/checkout.js`): public quote-deposit endpoints that create Stripe Checkout Sessions / capture PayPal orders for the deposit amount, plus webhook branches that call `deposit-paid`; (3) new static bilingual pay page `pay-quote.html` linked from the quote email.

**Tech Stack:** Cloudflare Workers (JS, ESM), D1 (SQLite) migrations, Stripe + PayPal REST APIs, Resend email, vitest.

**Spec:** `docs/superpowers/specs/2026-09-03-quote-deposit-payment-design.md` (committed as `dc7d8f5`)

## Global Constraints

- Deposit = `Math.ceil(quoted_price * 0.5)` everywhere — single source: `depositCentsFor` in `orders/workers/quote-deposit-lib.js`.
- Amounts are ALWAYS computed server-side from the current `quoted_price` in D1; clients never submit amounts (PayPal capture verifies cent-exact).
- Emails/pages are bilingual: `quote.language` (`'es'` default, `'en'`) drives every customer-facing string.
- `ALLOWED_PAYMENT` already includes `'stripe'` and `'paypal'`.
- Internal payment endpoints authenticate with header `X-Webhook-Secret === env.PAYMENT_WEBHOOK_SECRET` (exact pattern from `markOrderPaid`) AND must be added to the Cloudflare Access public-bypass condition list in `fetch()` or they return 401.
- No new secrets, no new Stripe/PayPal dashboard webhooks, no admin dashboard (SPA) changes.
- Commit style: conventional, e.g. `feat(orders): …`, `feat(checkout): …`, `feat(site): …`, `test(orders): …`. Never commit `orders/.dev.vars`.
- Verification test suite: `cd orders && npx vitest run`.
- The manual Convert flow (`POST /api/quotes/:id/convert`) and `getQuoteItems`/`quoteItemDisplayName`/`quoteItemQty` shapes must remain unchanged.

---

### Task 1: Quote deposit lib (pure functions) + unit tests

**Files:**
- Create: `orders/workers/quote-deposit-lib.js`
- Test: `orders/tests/quote-deposit-lib.test.js`

**Interfaces:**
- Consumes: nothing (vitest only).
- Produces (used by Tasks 2–6):
  - `depositCentsFor(quotedPriceCents: number) -> number`
  - `isDepositSufficient(paidCents: number, quotedPriceCents: number) -> boolean`
  - `buildPayUrl(quoteId: number|string, token: string) -> string` (hardcodes origin `https://muy-rico.com`)
  - `encodeQuoteCustomId(quoteId: number|string, token: string) -> string` — returns `q{id}:{token}`
  - `parseQuoteCustomId(s: string) -> { id: number, token: string } | null`
  - `generateQuoteToken() -> string` — 32 lowercase hex chars (128-bit)

- [ ] **Step 1: Write the failing test**

`orders/tests/quote-deposit-lib.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  depositCentsFor, isDepositSufficient, buildPayUrl,
  encodeQuoteCustomId, parseQuoteCustomId, generateQuoteToken,
} from '../workers/quote-deposit-lib.js';

describe('depositCentsFor', () => {
  it('halves even amounts', () => expect(depositCentsFor(18000)).toBe(9000));
  it('rounds up on odd cents', () => expect(depositCentsFor(9999)).toBe(5000));
  it('ceil of 1 cent price is 1', () => expect(depositCentsFor(1)).toBe(1));
  it('zero price -> 0', () => expect(depositCentsFor(0)).toBe(0));
  it('garbage -> 0', () => expect(depositCentsFor('abc')).toBe(0));
});

describe('isDepositSufficient', () => {
  it('exact half is sufficient', () => expect(isDepositSufficient(5000, 10000)).toBe(true));
  it('one cent under fails', () => expect(isDepositSufficient(4999, 10000)).toBe(false));
});

describe('buildPayUrl', () => {
  it('builds the hosted pay link', () => {
    expect(buildPayUrl(12, 'abc123')).toBe('https://muy-rico.com/pay-quote.html?quote=12&t=abc123');
  });
});

describe('quote custom ids', () => {
  it('round-trips', () => {
    const enc = encodeQuoteCustomId(7, 'a'.repeat(32));
    expect(parseQuoteCustomId(enc)).toEqual({ id: 7, token: 'a'.repeat(32) });
  });
  it.each(['', 'q12', 'x12:' + 'a'.repeat(32), 'q12:xyz', '12', 'q12:' + 'a'.repeat(31)])(
    'rejects %j',
    (s) => expect(parseQuoteCustomId(s)).toBeNull(),
  );
});

describe('generateQuoteToken', () => {
  it('is 32 lowercase hex chars and unique per call', () => {
    const t = generateQuoteToken();
    expect(t).toMatch(/^[0-9a-f]{32}$/);
    expect(generateQuoteToken()).not.toBe(t);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd orders && npx vitest run tests/quote-deposit-lib.test.js`
Expected: FAIL — "Cannot find module '../workers/quote-deposit-lib.js'"

- [ ] **Step 3: Write the implementation**

`orders/workers/quote-deposit-lib.js`:

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd orders && npx vitest run tests/quote-deposit-lib.test.js`
Expected: PASS — all suites green.

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `cd orders && npx vitest run`
Expected: PASS — existing suites (`enrich-lib`, `groups-lib`, `order-date`, `order-edit-lib`, `receipt-html`) all still green.

- [ ] **Step 6: Commit**

```bash
git add orders/workers/quote-deposit-lib.js orders/tests/quote-deposit-lib.test.js
git commit -m "feat(orders): quote deposit lib (deposit math, pay links, tokens)"
```

---

### Task 2: Migration 0044 + per-quote token generation

**Files:**
- Create: `orders/migrations/0044_quote_deposit.sql`
- Modify: `orders/workers/api.js` (import line ~63-68; `QUOTE_FIELDS` at ~2725; `createQuote` INSERT at ~2851; inline `quoteRow` at ~2902)

**Interfaces:**
- Consumes: `generateQuoteToken` from Task 1.
- Produces: `cake_quotes` columns `public_token`, `deposit_paid_cents`, `deposit_paid_at`, `deposit_method`, `deposit_ref`; `generateQuoteToken` bound into every new quote; `QUOTE_FIELDS` exposes the new columns to all quote SELECTs.

- [ ] **Step 1: Write the migration**

`orders/migrations/0044_quote_deposit.sql`:

```sql
ALTER TABLE cake_quotes ADD COLUMN public_token TEXT;
ALTER TABLE cake_quotes ADD COLUMN deposit_paid_cents INTEGER;
ALTER TABLE cake_quotes ADD COLUMN deposit_paid_at TEXT;
ALTER TABLE cake_quotes ADD COLUMN deposit_method TEXT;
ALTER TABLE cake_quotes ADD COLUMN deposit_ref TEXT;
UPDATE cake_quotes SET public_token = lower(hex(randomblob(16))) WHERE public_token IS NULL;
CREATE UNIQUE INDEX idx_cake_quotes_public_token ON cake_quotes(public_token);
```

- [ ] **Step 2: Apply migration to the local dev database**

Run: `cd orders && npx wrangler d1 execute muy-rico-orders --local --file=migrations/0044_quote_deposit.sql`
Expected: migration applied successfully (no SQL errors).

- [ ] **Step 3: Import the lib in api.js**

In `orders/workers/api.js`, add after the last import line (currently `import { buildMethodLabel, buildReceiptHtml, emailMeta, formatStatusLabel } from './receipt-html.js';` around line 68):

```js
import {
  depositCentsFor, isDepositSufficient, buildPayUrl, generateQuoteToken,
} from './quote-deposit-lib.js';
```

- [ ] **Step 4: Extend QUOTE_FIELDS**

Change the `QUOTE_FIELDS` array (~line 2725) — add the five new columns at the end:

```js
const QUOTE_FIELDS = [
  'id', 'status', 'customer_name', 'email', 'phone', 'language',
  'occasion', 'serving_size', 'cake_flavor', 'filling', 'frosting',
  'toppings', 'dietary', 'reference_image_url',
  'comments', 'desired_date', 'budget',
  'quoted_price', 'admin_notes', 'converted_order_id',
  'inspiration',
  'public_token', 'deposit_paid_cents', 'deposit_paid_at', 'deposit_method', 'deposit_ref',
  'created_at', 'updated_at',
];
```

(Leave `rowToQuote` unchanged — its callers that need the new fields read them straight off the DB row; only the deposit endpoints in Tasks 4–5 and the email builder use them.)

- [ ] **Step 5: Generate the token in createQuote**

In `createQuote`, immediately before the `const result = await env.DB.prepare(...)` INSERT (~line 2850), add:

```js
    const publicToken = generateQuoteToken();
```

Then change the INSERT statement to include the column and bind:

```js
    const result = await env.DB.prepare(`
      INSERT INTO cake_quotes
        (customer_name, email, phone, language, occasion, serving_size,
         cake_flavor, filling, frosting, toppings, dietary,
         reference_image_url, comments, desired_date, budget, inspiration,
         quoted_price, status, public_token)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      body.customer_name.trim(),
      body.email.trim().toLowerCase(),
      body.phone || null,
      body.language || 'es',
      body.occasion || null,
      body.serving_size || null,
      cakeFlavor,
      body.filling || null,
      body.frosting || null,
      toppings,
      dietary,
      body.reference_image_url || null,
      body.comments || null,
      body.desired_date || null,
      body.budget || null,
      inspirationJson,
      quotedPrice,
      status,
      publicToken,
    ).run();
```

- [ ] **Step 6: Fix the admin-created inline quoteRow** (spec §2b — the row object literals, not DB reads, feed `sendQuoteAutoReply`)

In `createQuote`, the admin-priced branch (~line 2902) — add `public_token: publicToken,`:

```js
      if (quotedPrice != null) {
        const quoteRow = {
          id: quoteId,
          email: body.email.trim().toLowerCase(),
          language: body.language || 'es',
          quoted_price: quotedPrice,
          customer_name: body.customer_name,
          occasion: body.occasion || null,
          desired_date: body.desired_date || null,
          public_token: publicToken,
        };
        ctx.waitUntil(sendQuoteAutoReply(env, quoteRow, itemsForEmail, true));
        ctx.waitUntil(notifyQuoteReplied(env, quoteId, body.customer_name, quotedPrice));
      }
```

(The non-priced auto-reply row needs no token — the ack email never renders the button.)

- [ ] **Step 7: Verify locally — token generated on insert**

Run the dev server: `cd orders && npx wrangler dev --local --port 8787` (keep running; all local curl checks in this plan assume another terminal).

```bash
curl -s -X POST http://localhost:8787/api/quotes -H 'Content-Type: application/json' -d '{
  "customer_name": "Plan Test", "email": "plan-test@example.com", "language": "en",
  "cake_flavor": "Vanilla",
  "items": [{ "product_type": "cake", "details": { "cake_flavor": "Vanilla" } }]
}'
```
Expected: `{"ok":true,"id":N}`.

Then: `npx wrangler d1 execute muy-rico-orders --local --command "SELECT id, public_token FROM cake_quotes ORDER BY id DESC LIMIT 1"` (workdir `orders`)
Expected: the new row with a 32-char hex `public_token`.

- [ ] **Step 8: Run the test suite + syntax sanity**

Run: `cd orders && npx vitest run && npx wrangler deploy --dry-run`
Expected: tests PASS; wrangler dry run succeeds (syntax check of api.js).

- [ ] **Step 9: Commit**

```bash
git add orders/migrations/0044_quote_deposit.sql orders/workers/api.js
git commit -m "feat(orders): per-quote public tokens + deposit columns (migration 0044)"
```

---

### Task 3: Extract convertQuoteToOrder (pure refactor)

**Files:**
- Modify: `orders/workers/api.js` (`convertQuote` at ~3313-3471)

**Interfaces:**
- Consumes: `depositCentsFor` (Task 1), new `cake_quotes` columns (Task 2 — none used here yet).
- Produces: `convertQuoteToOrder(env, id, quote, { depositCents, method, subMethod?, actor }) -> Promise<{ orderId: number, paymentStatus: 'paid'|'partial' }>` — used by `convertQuote` (this task) and `quoteDepositPaid` (Task 5).

Rules: zero behavior change to the manual flow (`POST /api/quotes/:id/convert`); the single deliberate extension is the payments INSERT gaining `method_details` (NULL for the manual path — same as today), matching `markOrderPaid`'s insert shape.

- [ ] **Step 1: Extract the shared function**

In `orders/workers/api.js`, replace the entire current `convertQuote` function (from `async function convertQuote(id, request, env, ctx, actor) {` through its closing brace, currently ~lines 3313-3471) with these two functions:

```js
// Shared quote → order conversion. `quote` is a cake_quotes row (QUOTE_FIELDS).
// `subMethod` is an optional JSON string describing the instrument (e.g. card brand/last4).
async function convertQuoteToOrder(env, id, quote, { depositCents, method, subMethod = null, actor }) {
  const paymentStatus = depositCents >= quote.quoted_price ? 'paid' : 'partial';

  const quoteItems = (await getQuoteItems(env, [id]))[id] || [];
  const hasItems = quoteItems.length > 0;
  const hasCake = quoteItems.some(i => i.product_type === 'cake');

  // Build flavor note: quote-level fields when a cake is involved (or legacy
  // item-less quotes), otherwise per-item detail summaries.
  let flavorNote;
  if (!hasItems || hasCake) {
    const flavorParts = [quote.cake_flavor];
    if (quote.filling) flavorParts.push(`Filling: ${quote.filling}`);
    if (quote.frosting) flavorParts.push(`Frosting: ${quote.frosting}`);
    if (quote.toppings) {
      try {
        const tp = typeof quote.toppings === 'string' ? JSON.parse(quote.toppings) : quote.toppings;
        if (Array.isArray(tp) && tp.length) flavorParts.push(`Toppings: ${tp.join(', ')}`);
      } catch {}
    }
    flavorNote = flavorParts.join(' | ');
  } else {
    flavorNote = quoteItems
      .map(i => quoteItemDetailsSummary(i.details))
      .filter(Boolean)
      .join(' | ');
  }

  // Build order notes — include quote reference + dietary + comments + image
  const orderNotesParts = [
    `From Quote #${id}`,
    quote.dietary ? `Dietary: ${JSON.parse(typeof quote.dietary === 'string' ? quote.dietary : '[]').join(', ')}` : '',
    quote.comments || '',
    quote.reference_image_url ? `Ref image: ${quote.reference_image_url}` : '',
  ].filter(Boolean);
  if (hasItems) {
    orderNotesParts.push('Items:');
    for (const item of quoteItems) {
      const detail = quoteItemDetailsSummary(item.details, ['name']);
      orderNotesParts.push(`- ${quoteItemDisplayName(item)} ×${quoteItemQty(item)}${detail ? ` — ${detail}` : ''}`);
    }
  }
  const orderNotes = orderNotesParts.join('\n');

  // Create the order — single line so totals stay exact
  let orderLine;
  if (hasItems) {
    const lineName = quoteItems
      .map(i => {
        const name = quoteItemDisplayName(i);
        const qty = quoteItemQty(i);
        return qty > 1 ? `${name} ×${qty}` : name;
      })
      .join(' + ');
    const emoji = hasCake ? '🎂'
      : quoteItems.some(i => i.product_type === 'cakepops') ? '🍭'
      : quoteItems.some(i => i.product_type === 'cupcakes') ? '🧁'
      : '✨';
    orderLine = {
      productId: hasCake ? 'prod_custom_cake' : null,
      name: lineName,
      emoji,
      qty: 1,
      price: quote.quoted_price / 100,
      flavorNote,
    };
  } else {
    // Legacy quotes (pre-items-table): keep the original Custom Cake line
    orderLine = {
      productId: 'prod_custom_cake',
      name: 'Custom Cake',
      emoji: '🎂',
      qty: 1,
      price: quote.quoted_price / 100,
      flavorNote,
    };
  }
  const itemsJson = JSON.stringify([orderLine]);

  const orderResult = await env.DB.prepare(`
    INSERT INTO orders
      (customer_name, phone, email, pickup_date, items_json,
       total_cents, payment_method, payment_status, status, notes,
       created_by, source, language)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 'website', ?)
  `).bind(
    quote.customer_name,
    quote.phone,
    quote.email,
    quote.desired_date || new Date().toISOString().slice(0, 10),
    itemsJson,
    quote.quoted_price,
    method,
    paymentStatus,
    orderNotes,
    actor,
    quote.language || 'es',
  ).run();

  const orderId = orderResult.meta.last_row_id;

  // Record deposit payment
  const payId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await env.DB.prepare(`
    UPDATE payments SET active = 0 WHERE order_id = ? AND active = 1
  `).bind(orderId).run();
  await env.DB.prepare(`
    INSERT INTO payments (id, order_id, customer_name, amount, method, method_details, date)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(payId, orderId, quote.customer_name, depositCents / 100, method, subMethod).run();

  // Log event
  await env.DB.prepare(`
    INSERT INTO order_events (order_id, actor, event) VALUES (?, ?, 'order:created')
  `).bind(orderId, actor).run();

  // Update quote
  await env.DB.prepare(`
    UPDATE cake_quotes SET status = 'converted', converted_order_id = ?,
      updated_at = datetime('now') WHERE id = ?
  `).bind(orderId, id).run();

  return { orderId, paymentStatus };
}

async function convertQuote(id, request, env, ctx, actor) {
  try {
    const body = await request.json();
    const quote = await env.DB.prepare(
      `SELECT ${QUOTE_FIELDS.join(', ')} FROM cake_quotes WHERE id = ?`
    ).bind(id).first();
    if (!quote) return json({ error: 'Quote not found' }, 404);

    if (quote.status === 'converted') {
      return json({ error: 'Quote already converted' }, 400);
    }
    if (quote.quoted_price == null) {
      return json({ error: 'Set quoted_price before converting' }, 400);
    }

    const depositCents = Number(body.deposit_amount_cents) || 0;
    const minDeposit = depositCentsFor(quote.quoted_price);
    if (depositCents < minDeposit) {
      return json({
        error: `Deposit must be at least 50% of quoted price ($${(minDeposit / 100).toFixed(2)})`,
      }, 400);
    }

    if (!ALLOWED_PAYMENT.includes(body.payment_method)) {
      return json({
        error: `Invalid payment_method. Must be one of: ${ALLOWED_PAYMENT.join(', ')}`,
      }, 400);
    }

    const { orderId, paymentStatus } = await convertQuoteToOrder(env, id, quote, {
      depositCents, method: body.payment_method, actor,
    });

    ctx.waitUntil(notifyQuoteConverted(env, id, quote.customer_name, orderId, depositCents, quote.quoted_price, body.payment_method));

    return json({ ok: true, order_id: orderId, payment_status: paymentStatus }, 201);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}
```

- [ ] **Step 2: Verify the manual convert flow still works (local)**

With `wrangler dev --local --port 8787` running (orders dir) and the Task 2 test quote still present (note its id, e.g. via `SELECT id FROM cake_quotes ORDER BY id DESC LIMIT 1`):

```bash
# Set a price first (admin path — local dev bypasses Access)
curl -s -X PATCH http://localhost:8787/api/quotes/ID -H 'Content-Type: application/json' \
  -d '{"quoted_price": 18000}'

# Manual convert with a cash deposit
curl -s -X POST http://localhost:8787/api/quotes/ID/convert -H 'Content-Type: application/json' \
  -d '{"deposit_amount_cents": 9000, "payment_method": "cash"}'
```
Expected: `{"ok":true,"order_id":M,"payment_status":"partial"}` and 201. Confirm the payments row:
`npx wrangler d1 execute muy-rico-orders --local --command "SELECT order_id, amount, method, method_details FROM payments ORDER BY rowid DESC LIMIT 1"` — amount `9000` (cents→dollars? NO: convertQuote historically stored `depositCents / 100` — dollars, e.g. `90`). Verify amount is `90` and `method_details` is NULL.

Also verify below-minimum rejection: `curl ... -d '{"deposit_amount_cents": 100, "payment_method": "cash"}'` on a fresh priced quote → `Deposit must be at least 50%...`.

- [ ] **Step 3: Syntax + tests**

Run: `cd orders && npx vitest run && npx wrangler deploy --dry-run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add orders/workers/api.js
git commit -m "refactor(orders): extract convertQuoteToOrder for deposit-paid reuse"
```

---

### Task 4: `GET /api/quotes/:id/payable-deposit` (token-guarded read)

**Files:**
- Modify: `orders/workers/api.js` (bypass list ~lines 99-115; routes ~line 276; new handler near `emailQuote`)

**Interfaces:**
- Consumes: `depositCentsFor` (Task 1), `QUOTE_FIELDS` with new columns (Task 2), existing `getQuoteItems`/`quoteItemDisplayName`/`quoteItemQty`.
- Produces: endpoint consumed by checkout worker Task 6 `handleQuoteDepositPayable`. Response JSON:
  `{ ok: true, id, customer_name, total_cents, deposit_cents, balance_cents, language, status, deposit_paid: boolean, deposit_paid_at: string|null, items: [{ name, qty }] }`
  Errors: 404 `{ error: 'Not found' }`, 403 `{ error: 'Invalid token' }`, 409 `{ error: 'Quote not yet priced' }`.

- [ ] **Step 1: Add the auth bypass (scan finding — skip this and Access 401s the endpoint)**

In `fetch()`, after the `isPublicQuoteUpload` declaration (~line 110), add:

```js
    // Quote deposit read: public but token-guarded inside the handler
    const isPublicQuoteDepositGet =
      path.match(/^\/api\/quotes\/\d+\/payable-deposit$/) && method === 'GET';
```

Then add `&& !isPublicQuoteDepositGet` inside the big unauthorized-condition at line 115:

```js
    if (!actorEmail && !isLocal && !isPublicPost && !isPublicProductGet && !isPublicGalleryGet && !isPublicSiteGet && !isPublicMarkPaid && !isPublicPayable && !isPublicPaymentStatus && !isPublicQuotePost && !isPublicQuoteUpload && !isPublicPaymentOptions && !isPublicQuoteDepositGet) {
```

- [ ] **Step 2: Register the route**

Immediately after the `/api/quotes/:id/email` route (~line 276):

```js
      const qdp = path.match(/^\/api\/quotes\/(\d+)\/payable-deposit$/);
      if (qdp && method === 'GET') return await getQuoteDepositPayable(Number(qdp[1]), request, env);
```

- [ ] **Step 3: Write the handler**

Add near `emailQuote` (e.g. right after the `deleteQuote` function, ~line 3184):

```js
// ─── Quote deposit: public token-guarded read for the pay page ──────────────

async function getQuoteDepositPayable(id, request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get('t') || '';
  const quote = await env.DB.prepare(
    `SELECT ${QUOTE_FIELDS.join(', ')} FROM cake_quotes WHERE id = ?`
  ).bind(id).first();
  if (!quote) return json({ error: 'Not found' }, 404);
  if (!quote.public_token || token !== quote.public_token) {
    return json({ error: 'Invalid token' }, 403);
  }
  if (quote.quoted_price == null) {
    return json({ error: 'Quote not yet priced' }, 409);
  }
  const itemsByQuote = await getQuoteItems(env, [id]);
  const items = (itemsByQuote[id] || []).map(i => ({
    name: quoteItemDisplayName(i),
    qty: quoteItemQty(i),
  }));
  const depositCents = depositCentsFor(quote.quoted_price);
  return json({
    ok: true,
    id: quote.id,
    customer_name: quote.customer_name,
    total_cents: quote.quoted_price,
    deposit_cents: depositCents,
    balance_cents: quote.quoted_price - depositCents,
    language: quote.language || 'es',
    status: quote.status,
    deposit_paid: quote.deposit_paid_at != null,
    deposit_paid_at: quote.deposit_paid_at,
    items,
  }, 200);
}
```

- [ ] **Step 4: Verify locally**

With dev server running, fetch the token from local D1 and exercise all states:

```bash
TOKEN=$(npx wrangler d1 execute muy-rico-orders --local --json --command "SELECT public_token FROM cake_quotes ORDER BY id DESC LIMIT 1" | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["results"][0]["public_token"])')
QID=$(npx wrangler d1 execute muy-rico-orders --local --json --command "SELECT id FROM cake_quotes WHERE status != 'converted' ORDER BY id DESC LIMIT 1" | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["results"][0]["id"])')

curl -s "http://localhost:8787/api/quotes/$QID/payable-deposit?t=$TOKEN"        # 200, full payload
curl -s "http://localhost:8787/api/quotes/$QID/payable-deposit?t=wrong"          # 403 Invalid token
curl -s "http://localhost:8787/api/quotes/999999/payable-deposit?t=$TOKEN"       # 404
```
Expected: the 200 payload matches the shape in the Interfaces block (deposit = half of total, `deposit_paid: false`).

- [ ] **Step 5: Commit**

```bash
git add orders/workers/api.js
git commit -m "feat(orders): token-guarded quote deposit payable endpoint"
```

---

### Task 5: `POST /api/quotes/:id/deposit-paid` — record, auto-convert, notify, confirm

**Files:**
- Modify: `orders/workers/api.js` (bypass list; routing; new handlers in the quote section ~after `getQuoteDepositPayable`)

**Interfaces:**
- Consumes: `isDepositSufficient` (Task 1), new columns (Task 2), `convertQuoteToOrder` (Task 3), existing `escapeHtml`, `notifyTelegram`, `notifyQuoteConverted`.
- Produces: endpoint consumed by checkout worker Task 6 `markQuoteDepositPaid`.
  - Body: `{ token: string, method: 'stripe'|'paypal', sub_method?: string|null, ref: string, amount_cents: number }`
  - 200 responses: `{ ok: true, order_id }` · `{ ok: true, already: true, order_id }` · `{ ok: true, duplicate: true }` · `{ ok: true, duplicate: true, reason: 'already_converted' }`
  - Errors: 401 invalid secret · 403 invalid token · 404 unknown quote · 400 invalid method / missing ref / insufficient amount · 422 unpriced

- [ ] **Step 1: Add the auth bypass**

Next to the Task 4 bypass (~line 111), add:

```js
    // Quote deposit write: public route, authenticated by X-Webhook-Secret inside the handler
    const isPublicQuoteDepositPaid =
      path.match(/^\/api\/quotes\/\d+\/deposit-paid$/) && method === 'POST';
```

and append `&& !isPublicQuoteDepositPaid` to the unauthorized-condition at line 115.

- [ ] **Step 2: Register the route**

Immediately after the Task 4 route:

```js
      const qdpaid = path.match(/^\/api\/quotes\/(\d+)\/deposit-paid$/);
      if (qdpaid && method === 'POST') return await quoteDepositPaid(Number(qdpaid[1]), request, env, ctx);
```

- [ ] **Step 3: Write the handler + notification helpers**

Add after `getQuoteDepositPayable`:

```js
async function notifyDuplicateDeposit(env, id, ref, why) {
  const msg = `⚠️ Duplicate deposit payment on Quote #${id} (ref ${ref} — ${why}) — refund needed`;
  console.warn(msg);
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    notifyTelegram(env, msg);
  }
}

// Records the customer-online deposit, auto-converts the quote, notifies owner + customer.
async function quoteDepositPaid(id, request, env, ctx) {
  // Shared-secret auth (same pattern as markOrderPaid — no Access on this route)
  const provided = request.headers.get('X-Webhook-Secret') || '';
  if (!env.PAYMENT_WEBHOOK_SECRET || provided !== env.PAYMENT_WEBHOOK_SECRET) {
    return json({ error: 'Forbidden — invalid webhook secret' }, 401);
  }

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const { token, method, ref } = body;
  const subMethod = body.sub_method || null;
  const amountCents = Number(body.amount_cents) || 0;

  const quote = await env.DB.prepare(
    `SELECT ${QUOTE_FIELDS.join(', ')} FROM cake_quotes WHERE id = ?`
  ).bind(id).first();
  if (!quote) return json({ error: 'Not found' }, 404);
  if (!quote.public_token || token !== quote.public_token) {
    return json({ error: 'Invalid token' }, 403);
  }
  if (!ALLOWED_PAYMENT.includes(method)) {
    return json({ error: `Invalid method. Must be one of: ${ALLOWED_PAYMENT.join(', ')}` }, 400);
  }
  if (!ref) return json({ error: 'Missing ref' }, 400);

  // Idempotency: a replay with the same ref is a no-op ack
  if (quote.deposit_ref) {
    if (quote.deposit_ref === ref) {
      return json({ ok: true, already: true, order_id: quote.converted_order_id }, 200);
    }
    // Different ref → a real second payment: alert owner, never double-convert
    ctx.waitUntil(notifyDuplicateDeposit(env, id, ref, 'second payment'));
    return json({ ok: true, duplicate: true }, 200);
  }

  // Owner already converted (e.g. cash) before this payment landed
  if (quote.status === 'converted' || quote.status === 'archived') {
    await env.DB.prepare(`
      UPDATE cake_quotes SET deposit_paid_cents = ?, deposit_paid_at = datetime('now'),
        deposit_method = ?, deposit_ref = ?, updated_at = datetime('now') WHERE id = ?
    `).bind(amountCents, method, ref, id).run();
    ctx.waitUntil(notifyDuplicateDeposit(env, id, ref, `quote already ${quote.status}`));
    return json({ ok: true, duplicate: true, reason: 'already_converted' }, 200);
  }

  if (quote.quoted_price == null) return json({ error: 'Quote not priced' }, 422);
  if (!isDepositSufficient(amountCents, quote.quoted_price)) {
    return json({ error: 'Deposit amount below 50% minimum' }, 400);
  }

  await env.DB.prepare(`
    UPDATE cake_quotes SET deposit_paid_cents = ?, deposit_paid_at = datetime('now'),
      deposit_method = ?, deposit_ref = ?, updated_at = datetime('now') WHERE id = ?
  `).bind(amountCents, method, ref, id).run();

  const { orderId } = await convertQuoteToOrder(env, id, quote, {
    depositCents: amountCents, method, subMethod, actor: 'online-deposit',
  });

  ctx.waitUntil(notifyQuoteConverted(env, id, quote.customer_name, orderId, amountCents, quote.quoted_price, method));
  ctx.waitUntil(sendDepositConfirmationEmail(env, quote, orderId, amountCents));

  return json({ ok: true, order_id: orderId }, 200);
}
```

- [ ] **Step 4: Write the customer confirmation email**

Add after `sendQuoteAutoReply` (~line 3596):

```js
async function sendDepositConfirmationEmail(env, quote, orderId, depositCents) {
  const email = quote.email;
  const lang = quote.language || 'es';
  if (!email || !env.RESEND_API_KEY) return;

  const isEn = lang === 'en';
  const name = escapeHtml(quote.customer_name || '');
  const deposit = `$${(depositCents / 100).toFixed(2)}`;
  const balanceCents = quote.quoted_price != null ? quote.quoted_price - depositCents : null;

  const subject = isEn
    ? `Deposit received! Order #${orderId} confirmed — Muy Rico Bakery`
    : `¡Depósito recibido! Pedido #${orderId} confirmado — Muy Rico Bakery`;

  const rows = [
    [isEn ? 'Deposit paid' : 'Depósito pagado', `<strong>${deposit}</strong>`],
    balanceCents != null ? [isEn ? 'Balance due at pickup' : 'Restante al recoger', `$${(balanceCents / 100).toFixed(2)}`] : null,
    quote.desired_date ? [isEn ? 'Date' : 'Fecha', escapeHtml(quote.desired_date)] : null,
  ].filter(Boolean).map(([k, v]) =>
    `<tr><td style="padding:10px 14px;color:#4a423d;font-size:14px;">${k}</td><td style="padding:10px 14px;text-align:right;color:#2c2523;font-size:14px;">${v}</td></tr>`
  ).join('');

  const bodyHtml = `<div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; color: #2c2523; line-height: 1.6;">
  <div style="text-align: center; margin-bottom: 24px;">
    <img src="https://muy-rico.com/muy_rico_logo_email.png" alt="Muy Rico Bakery" style="max-width: 160px;">
  </div>
  <h2 style="margin:0 0 8px;font-size:20px;">${isEn ? `Order #${orderId} confirmed` : `Pedido #${orderId} confirmado`}</h2>
  <p style="margin:0 0 4px;">${isEn ? `Hi ${name},` : `Hola ${name}:`}</p>
  <p style="margin:0 0 12px;">${isEn
    ? 'Your deposit was received and your date is secured. We will reach out to confirm the final details.'
    : 'Recibimos tu depósito y tu fecha quedó apartada. Te contactaremos para confirmar los detalles finales.'}</p>
  <table style="width:100%;border-collapse:collapse;margin:12px 0;background:#faf7f2;border-radius:8px;">${rows}</table>
  <p style="color:#706561;font-size:11px;margin:16px 0 0;">${isEn
    ? 'Baked in a home kitchen not inspected by the health department (Michigan Cottage Law). May contain or come into contact with common allergens.'
    : 'Horneado en una cocina doméstica no inspeccionada por el departamento de salud (Ley Cottage de Michigan). Puede contener alérgenos o haber tenido contacto con ellos.'}</p>
  <hr style="border: none; border-top: 1px solid #e8dbc4; margin: 24px 0;">
  <p style="color: #706561; font-size: 12px; text-align: center; margin: 0;">
    Muy Rico Bakery · Holland, MI<br>${isEn ? 'Family · Tradition · Flavor' : 'Familia · Tradición · Sabor'}
  </p>
</div>`;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.RESEND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM || 'orders@muy-rico.com',
        to: email,
        subject,
        html: bodyHtml,
      }),
    });
  } catch (e) {
    console.error('sendDepositConfirmationEmail failed:', e);
  }
}
```

- [ ] **Step 5: Verify locally — all five paths**

Dev server running. Ensure `orders/.dev.vars` contains `PAYMENT_WEBHOOK_SECRET` (it should already — the checkout flow uses it); use its value as `$SECRET`. Use a FRESH priced, non-converted quote id as `$QID` (`SELECT id, public_token, quoted_price, status FROM cake_quotes ORDER BY id DESC`).

```bash
# 1) Happy path: deposit-paid with exact 50%
curl -s -X POST http://localhost:8787/api/quotes/$QID/deposit-paid \
  -H "Content-Type: application/json" -H "X-Webhook-Secret: $SECRET" \
  -d "{\"token\":\"$TOKEN\",\"method\":\"stripe\",\"sub_method\":\"{\\\"type\\\":\\\"card\\\",\\\"brand\\\":\\\"visa\\\"}\",\"ref\":\"cs_test_plan1\",\"amount_cents\":9000}"
# Expected: {"ok":true,"order_id":M}
# Side effects to verify in D1:
#   cake_quotes: status 'converted', deposit_paid_cents 9000, deposit_ref cs_test_plan1
#   payments: row method 'stripe', method_details with the JSON, amount 90
#   orders: new row, payment_status 'partial'

# 2) Webhook replay — same ref (idempotent)
curl ... same body again
# Expected: {"ok":true,"already":true,"order_id":M} — NO new payments row

# 3) Second genuine payment — different ref
curl ... -d '..."ref":"cs_test_plan2"...'
# Expected: {"ok":true,"duplicate":true} — still no new payments row

# 4) Wrong secret
curl -s -X POST ... -H "X-Webhook-Secret: nope" ...
# Expected: 401

# 5) Insufficient amount (on ANOTHER fresh priced quote)
curl ... -d '{"token":...,"method":"stripe","ref":"cs_test_plan3","amount_cents":100}'
# Expected: 400 Deposit amount below 50% minimum
```

- [ ] **Step 6: Tests + syntax**

Run: `cd orders && npx vitest run && npx wrangler deploy --dry-run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add orders/workers/api.js
git commit -m "feat(orders): deposit-paid endpoint — record, auto-convert, notify, confirm"
```

---

### Task 6: Deposit pay button in the quote email/printable document

**Files:**
- Modify: `orders/workers/api.js` (`buildQuoteDocumentHtml` at ~3229-3311)

**Interfaces:**
- Consumes: `depositCentsFor`, `buildPayUrl` (Task 1), `quote.public_token` (Task 2).
- Produces: the email + `/api/quotes/:id/html` document shows the button linking to the pay page (Task 7).

- [ ] **Step 1: Restructure the price block to hoist the deposit math and add the button**

In `buildQuoteDocumentHtml`, replace the entire `let priceBlock; if (quote.quoted_price == null) {...} else {...}` block AND the `proceedLine`/`disclaimer` consts (currently ~lines 3253-3284) with:

```js
  let priceBlock;
  let payButton = '';
  if (quote.quoted_price == null) {
    priceBlock = `<p style="color:#8a6d3b;font-size:14px;margin:16px 0 0;">${isEn
      ? 'Price pending — we will confirm your quote shortly.'
      : 'Precio por confirmar — te enviaremos tu cotización en breve.'}</p>`;
  } else {
    const totalCents = Number(quote.quoted_price);
    const depositCents = depositCentsFor(totalCents);
    const balanceCents = totalCents - depositCents;
    priceBlock = `
      <table style="width:100%;border-collapse:collapse;margin-top:16px;background:#faf7f2;border-radius:8px;">
        <tr>
          <td style="padding:12px 14px;color:#2c2523;font-size:15px;"><strong>${isEn ? 'Total' : 'Total'}</strong></td>
          <td style="padding:12px 14px;text-align:right;color:#2c2523;font-size:15px;"><strong>$${(totalCents / 100).toFixed(2)}</strong></td>
        </tr>
        <tr>
          <td style="padding:8px 14px;color:#4a423d;font-size:13px;">${isEn ? 'Deposit (50%) to secure your date' : 'Depósito (50%) para apartar tu fecha'}</td>
          <td style="padding:8px 14px;text-align:right;color:#4a423d;font-size:13px;">$${(depositCents / 100).toFixed(2)}</td>
        </tr>
        <tr>
          <td style="padding:8px 14px 12px;color:#4a423d;font-size:13px;">${isEn ? 'Balance at pickup' : 'Restante al recoger'}</td>
          <td style="padding:8px 14px 12px;text-align:right;color:#4a423d;font-size:13px;">$${(balanceCents / 100).toFixed(2)}</td>
        </tr>
      </table>`;
    if (quote.public_token) {
      payButton = `
  <a href="${buildPayUrl(quote.id, quote.public_token)}" style="display:block;background:#2d7a46;color:#fff;text-align:center;padding:14px;border-radius:8px;font-size:16px;font-weight:600;text-decoration:none;margin:16px 0 4px;">${isEn ? `Pay 50% Deposit — $${(depositCents / 100).toFixed(2)}` : `Pagar depósito (50%) — $${(depositCents / 100).toFixed(2)}`}</a>`;
    }
  }

  const proceedLine = isEn
    ? 'Pay your deposit online above to secure your date — or reply to this email / call us and we will set it up for you.'
    : 'Paga tu depósito en línea arriba para apartar tu fecha — o responde a este correo / llámanos y con gusto te ayudamos.';
  const disclaimer = isEn
    ? 'Baked in a home kitchen not inspected by the health department (Michigan Cottage Law). May contain or come into contact with common allergens.'
    : 'Horneado en una cocina doméstica no inspeccionada por el departamento de salud (Ley Cottage de Michigan). Puede contener alérgenos o haber tenido contacto con ellos.';
```

- [ ] **Step 2: Render the button in the document**

In the same function's return template (~line 3302), change:

```js
  ${priceBlock}
  <p style="font-size:14px;margin:20px 0 0;">${proceedLine}</p>
```

to:

```js
  ${priceBlock}
  ${payButton}
  <p style="font-size:14px;margin:20px 0 0;">${proceedLine}</p>
```

- [ ] **Step 3: Verify locally (template is shared with the printable HTML route)**

With a priced, non-converted quote present locally:

```bash
curl -s "http://localhost:8787/api/quotes/$QID/html?lang=en" | grep -o 'pay-quote.html?quote=[0-9]*&amp;t=[0-9a-f]*' | head -1
curl -s "http://localhost:8787/api/quotes/$QID/html?lang=en" | grep -c 'Pay 50% Deposit'
curl -s "http://localhost:8787/api/quotes/$QID/html?lang=es" | grep -c 'Pagar depósito (50%)'
```
Expected: the URL with id + 32-char token, then `1`, then `1`.

- [ ] **Step 4: Syntax + tests**

Run: `cd orders && npx vitest run && npx wrangler deploy --dry-run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add orders/workers/api.js
git commit -m "feat(orders): deposit pay button in quote email/printable document"
```

---

### Task 7: Checkout worker — quote deposit endpoints + webhook branches

**Files:**
- Modify: `workers/checkout.js`

**Interfaces:**
- Consumes: orders API Task 4 endpoint (`GET /api/quotes/:id/payable-deposit`) and Task 5 endpoint (`POST /api/quotes/:id/deposit-paid`) via the existing `ordersApiFetch` (adds `X-Webhook-Secret` automatically).
- Produces (consumed by Task 8 pay page):
  - `GET  /quote/:id/payable?t=<token>` → passthrough of the orders API payload
  - `POST /quote-deposit/checkout` `{ id, token, origin? }` → `{ url }` (Stripe hosted checkout)
  - `POST /quote-deposit/paypal-capture` `{ id, token, paypalOrderId }` → `{ ok: true }`
- Webhooks: Stripe `checkout.session.completed` with `metadata.kind === 'quote_deposit'`; PayPal events whose parsed custom_id matches `q{id}:{token}`.

- [ ] **Step 1: Register the routes**

In `workers/checkout.js`, inside the try block of the main fetch handler, add immediately after the `/create-checkout` route (~line 18):

```js
      const qpay = path.match(/^\/quote\/(\d+)\/payable$/);
      if (qpay && request.method === "GET") {
        return await handleQuoteDepositPayable(Number(qpay[1]), request, env);
      }
      if (path === "/quote-deposit/checkout" && request.method === "POST") {
        return await handleQuoteDepositCheckout(request, env);
      }
      if (path === "/quote-deposit/paypal-capture" && request.method === "POST") {
        return await handleQuoteDepositPayPalCapture(request, env);
      }
```

- [ ] **Step 2: Add the helpers + handlers**

Append at the end of `workers/checkout.js` (after `cancelPage`):

```js
// ─── Quote deposits (see docs/superpowers/specs/2026-09-03-quote-deposit-payment-design.md) ───
// NOTE: kept in sync with orders/workers/quote-deposit-lib.js (workers can't share code).

function encodeQuoteCustomId(quoteId, token) {
  return `q${quoteId}:${token}`;
}

function parseQuoteCustomId(s) {
  const m = typeof s === "string" ? s.match(/^q(\d+):([0-9a-f]{32})$/) : null;
  return m ? { id: Number(m[1]), token: m[2] } : null;
}

function fetchQuotePayable(env, id, token) {
  return ordersApiFetch(env, "/api/quotes/" + encodeURIComponent(id) +
    "/payable-deposit?t=" + encodeURIComponent(token));
}

async function handleQuoteDepositPayable(id, request, env) {
  const token = new URL(request.url).searchParams.get("t") || "";
  if (!token) return json({ error: "Missing token" }, 403);
  const res = await fetchQuotePayable(env, id, token);
  return new Response(await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

// Load the payable quote for payment creation; returns { quote } or { err: Response }.
async function loadPayableQuote(env, id, token) {
  const res = await fetchQuotePayable(env, id, token);
  if (!res.ok) return { err: json({ error: "Quote not payable" }, res.status) };
  const quote = await res.json();
  if (quote.deposit_paid || quote.status === "converted" || quote.status === "archived") {
    return { err: json({ error: "Deposit already paid" }, 409) };
  }
  return { quote };
}

async function handleQuoteDepositCheckout(request, env) {
  const { id, token, origin } = await request.json();
  if (!id || !token) return json({ error: "id and token required" }, 400);
  const key = env.STRIPE_SECRET_KEY;
  if (!key) return json({ error: "STRIPE_SECRET_KEY not set" }, 500);

  const { quote, err } = await loadPayableQuote(env, id, token);
  if (err) return err;

  const base = origin || "https://muy-rico.com";
  const pageUrl = `${base}/pay-quote.html?quote=${id}&t=${encodeURIComponent(token)}`;
  const params = new URLSearchParams();
  params.append("line_items[0][price_data][currency]", "usd");
  params.append("line_items[0][price_data][product_data][name]", `Muy Rico — Quote #${id} Deposit (50%)`);
  params.append("line_items[0][price_data][unit_amount]", String(quote.deposit_cents));
  params.append("line_items[0][quantity]", "1");
  params.append("mode", "payment");
  params.append("client_reference_id", encodeQuoteCustomId(id, token));
  params.append("metadata[kind]", "quote_deposit");
  params.append("metadata[quote_id]", String(id));
  params.append("metadata[token]", token);
  params.append("success_url", pageUrl + "&paid=stripe");
  params.append("cancel_url", pageUrl);

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const session = await res.json();
  if (session.error) return json({ error: session.error.message }, 400);
  return json({ url: session.url });
}

async function handleQuoteDepositPayPalCapture(request, env) {
  const { id, token, paypalOrderId } = await request.json();
  if (!id || !token || !paypalOrderId) return json({ error: "id, token and paypalOrderId required" }, 400);

  const { quote, err } = await loadPayableQuote(env, id, token);
  if (err) return err;

  const auth = await paypalAuth(env);
  if (!auth) return json({ error: "paypal auth failed" }, 500);

  // Verify amount + linkage against D1 BEFORE capturing any funds
  const orderRes = await fetch(env.PAYPAL_API_BASE + "/v2/checkout/orders/" + encodeURIComponent(paypalOrderId), {
    headers: { Authorization: "Bearer " + auth },
  });
  const paypalOrder = await orderRes.json();
  if (!orderRes.ok) {
    console.error("paypal order lookup failed", JSON.stringify(paypalOrder));
    return json({ error: "Could not verify PayPal order" }, 400);
  }
  const ppCents = Math.round(parseFloat(paypalOrder.purchase_units?.[0]?.amount?.value || "0") * 100);
  if (ppCents !== quote.deposit_cents) {
    console.error(`quote deposit amount mismatch: D1=${quote.deposit_cents} paypal=${ppCents} quote=${id}`);
    return json({ error: "Amount mismatch" }, 400);
  }
  const ppCustomId = paypalOrder.purchase_units?.[0]?.custom_id || "";
  if (ppCustomId !== encodeQuoteCustomId(id, token)) {
    console.error(`quote deposit custom_id mismatch: ${ppCustomId}`);
    return json({ error: "Quote mismatch" }, 400);
  }

  const captureRes = await fetch(env.PAYPAL_API_BASE + "/v2/checkout/orders/" + encodeURIComponent(paypalOrderId) + "/capture", {
    method: "POST",
    headers: { Authorization: "Bearer " + auth, "Content-Type": "application/json" },
  });
  const captureData = await captureRes.json();
  if (!captureRes.ok || captureData.status !== "COMPLETED") {
    console.error("paypal quote deposit capture failed", JSON.stringify(captureData));
    return json({ error: captureData.message || "Capture failed" }, 400);
  }

  const capture = captureData.purchase_units?.[0]?.payments?.captures?.[0] || {};
  const captureId = capture.id || paypalOrderId;
  const amountCents = Math.round(parseFloat(capture.amount?.value || "0") * 100) || quote.deposit_cents;
  const ok = await markQuoteDepositPaid(env, {
    id, token, method: "paypal",
    subMethod: extractPayPalSubMethod(captureData),
    ref: captureId, amountCents,
  });
  if (!ok) return json({ error: "deposit-paid failed" }, 500);
  return json({ ok: true });
}

// Same semantics as markOrderPaidViaApi: 404/409 are final (don't retry), other
// failures return false so the webhook 500s and Stripe/PayPal retry.
async function markQuoteDepositPaid(env, { id, token, method, subMethod, ref, amountCents }) {
  try {
    const res = await ordersApiFetch(env, "/api/quotes/" + encodeURIComponent(id) + "/deposit-paid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, method, sub_method: subMethod, ref, amount_cents: amountCents }),
    });
    if (res.status === 404 || res.status === 409) {
      console.error("deposit-paid final status", res.status, "for quote", id);
      return true;
    }
    if (!res.ok) {
      console.error("deposit-paid failed", res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("deposit-paid network error", e);
    return false;
  }
}
```

- [ ] **Step 3: Stripe webhook branch**

In `handleStripeWebhook`, inside the `if (event.type === "checkout.session.completed" || event.type === "payment_intent.succeeded") {` block — after the `const obj = ...` line and BEFORE the `const orderId = ...` line (~line 141-143) — insert:

```js
    const meta = obj.metadata || {};

    // Quote deposits: only checkout sessions carry deposit metadata
    if (event.type === "checkout.session.completed" && meta.kind === "quote_deposit") {
      const subMethod = await extractStripeSubMethod(event, obj, env);
      const ok = await markQuoteDepositPaid(env, {
        id: Number(meta.quote_id), token: meta.token, method: "stripe",
        subMethod, ref: obj.id, amountCents: obj.amount_total,
      });
      return ok ? json({ received: true }) : json({ error: "deposit-paid failed" }, 500);
    }
```

- [ ] **Step 4: PayPal webhook branch**

In `handlePayPalWebhook`, immediately after the `if (!orderId) { ...return... }` block (~line 336) and before `const subMethod = await extractPayPalWebhookSubMethod(event, env);`, insert:

```js
    const quoteRef = parseQuoteCustomId(orderId);
    if (quoteRef) {
      const qSubMethod = await extractPayPalWebhookSubMethod(event, env);
      const qAmountCents = Math.round(parseFloat(
        resource.amount?.value ||
        resource.purchase_units?.[0]?.amount?.value || "0"
      ) * 100);
      const ok = await markQuoteDepositPaid(env, {
        id: quoteRef.id, token: quoteRef.token, method: "paypal",
        subMethod: qSubMethod, ref: resource.id || String(orderId), amountCents: qAmountCents,
      });
      return ok ? json({ received: true }) : json({ error: "deposit-paid failed" }, 500);
    }
```

- [ ] **Step 5: Verify locally (syntax + a safe end-to-end pass-through)**

```bash
cd workers && npx wrangler deploy --dry-run   # syntax check
```

Then start `cd workers && npx wrangler dev --port 8788` and verify route wiring. NOTE: without the `ORDERS_API` service binding locally, `ordersApiFetch` falls back to the PRODUCTION orders API URL — so use a nonsense quote id and expect a clean passthrough error, never a mutation:

```bash
curl -s "http://localhost:8788/quote/999999/payable?t=badtoken"            # expect 404 JSON passthrough
curl -s -X POST http://localhost:8788/quote-deposit/checkout \
  -H 'Content-Type: application/json' -d '{"id":999999,"token":"badtoken"}' # expect 404 "Quote not payable"
```

- [ ] **Step 6: Commit**

```bash
git add workers/checkout.js
git commit -m "feat(checkout): quote deposit endpoints + webhook branches (stripe/paypal)"
```

---

### Task 8: Pay page — `pay-quote.html`

**Files:**
- Create: `pay-quote.html` (site root, deployed with the static assets worker)

**Interfaces:**
- Consumes: checkout worker endpoints from Task 7 (`/quote/:id/payable`, `/quote-deposit/checkout`, `/quote-deposit/paypal-capture`, existing `GET /paypal-client-id`).
- Produces: the page the email button (Task 6) links to.

States (per spec §4): invalid/unavailable, already-paid, confirming (post-Stripe redirect, polls until `deposit_paid`), payable, success, error.

- [ ] **Step 1: Write the page**

`pay-quote.html`:

```html
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Depósito — Muy Rico Bakery</title>
<link rel="icon" href="/qr_muy_rico.png">
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #faf7f2; margin: 0; min-height: 100vh; display: flex; justify-content: center; align-items: flex-start; padding: 32px 16px; color: #2c2523; }
  .card { background: #fff; border-radius: 14px; box-shadow: 0 2px 12px rgba(0,0,0,.08); padding: 32px 28px; max-width: 460px; width: 100%; }
  .logo { display: block; margin: 0 auto 16px; max-width: 140px; }
  h1 { font-size: 22px; margin: 0 0 4px; text-align: center; }
  .sub { text-align: center; color: #706561; font-size: 14px; margin: 0 0 20px; }
  .lang { text-align: center; margin-bottom: 16px; font-size: 12px; }
  .lang button { border: 0; border-radius: 4px; padding: 4px 12px; margin: 0 2px; font-size: 12px; font-weight: 600; cursor: pointer; background: #e3dcd2; color: #4a423d; }
  .lang button.on { background: #1e4636; color: #fff; }
  table.items { width: 100%; border-collapse: collapse; margin: 12px 0; }
  table.items td { padding: 8px; border-bottom: 1px solid #f0e9dc; font-size: 14px; }
  table.items td:last-child { text-align: center; white-space: nowrap; color: #706561; }
  table.totals { width: 100%; border-collapse: collapse; background: #faf7f2; border-radius: 8px; margin: 16px 0 20px; }
  table.totals td { padding: 10px 14px; font-size: 14px; color: #4a423d; }
  table.totals td:last-child { text-align: right; }
  table.totals tr.hi td { font-weight: 700; color: #2c2523; font-size: 15px; }
  .btn-pay { display: block; width: 100%; border: 0; border-radius: 8px; padding: 14px; font-size: 16px; font-weight: 700; background: #2d7a46; color: #fff; cursor: pointer; margin-bottom: 14px; }
  .btn-pay:disabled { opacity: .6; cursor: default; }
  .divider { text-align: center; color: #8a8078; font-size: 12px; margin: 4px 0 12px; text-transform: uppercase; letter-spacing: .05em; }
  #paypal-area { min-height: 44px; }
  .msg { text-align: center; padding: 8px 0 0; }
  .msg.ok h1 { color: #2d7a46; }
  .msg.err h1 { color: #c0392b; }
  .muted { color: #706561; font-size: 13px; line-height: 1.5; }
  .spin { display: inline-block; width: 16px; height: 16px; border: 2px solid #e3dcd2; border-top-color: #2d7a46; border-radius: 50%; animation: sp .8s linear infinite; vertical-align: -3px; margin-right: 6px; }
  @keyframes sp { to { transform: rotate(360deg); } }
  .foot { text-align: center; color: #706561; font-size: 12px; margin-top: 24px; }
</style>
</head>
<body>
<div class="card">
  <img class="logo" src="/muy_rico_logo_transparent.webp" alt="Muy Rico Bakery">
  <div class="lang" id="langBar" style="display:none">
    <button id="btnEn" type="button">EN</button>
    <button id="btnEs" type="button">ES</button>
  </div>
  <div id="app"><p class="msg muted"><span class="spin"></span><span id="loadingTxt">Cargando…</span></p></div>
  <div class="foot">Muy Rico Bakery · Holland, MI</div>
</div>

<script>
'use strict';

const WORKER = 'https://muy-rico-checkout.bexgarcia0208.workers.dev';
const params = new URLSearchParams(location.search);
const QUOTE_ID = params.get('quote') || '';
const TOKEN = params.get('t') || '';
const PAID_FLAG = params.get('paid') === 'stripe';

const STR = {
  en: {
    loading: 'Loading…', hi: (n) => `Hi ${n},`, quoteHash: (id) => `Quote #${id}`,
    total: 'Total', deposit: 'Deposit due now (50%)', balance: 'Balance at pickup',
    payCard: (amt) => `Pay ${amt} by Card`, or: 'or', confirming: 'Confirming your payment…',
    confirmLong: 'Still confirming — you will receive a confirmation email shortly.',
    successT: 'Deposit received!', successB: 'Your date is secured. We just emailed your confirmation — see you soon!',
    alreadyT: 'Deposit already received', alreadyB: 'Thank you! This quote is already paid — no further action needed.',
    invalidT: 'Link not available', invalidB: 'This payment link is invalid or no longer active. Please contact us and we will help you.',
    errPay: 'Payment could not be completed. Please try again or contact us.',
  },
  es: {
    loading: 'Cargando…', hi: (n) => `Hola ${n},`, quoteHash: (id) => `Cotización #${id}`,
    total: 'Total', deposit: 'Depósito a pagar ahora (50%)', balance: 'Restante al recoger',
    payCard: (amt) => `Pagar ${amt} con tarjeta`, or: 'o', confirming: 'Confirmando tu pago…',
    confirmLong: 'Seguimos confirmando — recibirás un correo de confirmación en breve.',
    successT: '¡Depósito recibido!', successB: 'Tu fecha quedó apartada. Acabamos de enviarte la confirmación — ¡hasta pronto!',
    alreadyT: 'Depósito ya recibido', alreadyB: '¡Gracias! Esta cotización ya fue pagada — no necesitas hacer nada más.',
    invalidT: 'Enlace no disponible', invalidB: 'Este enlace de pago no es válido o ya no está activo. Contáctanos y con gusto te ayudamos.',
    errPay: 'No se pudo completar el pago. Intenta de nuevo o contáctanos.',
  },
};
let lang = 'es';
let quote = null; // payable payload
const t = () => STR[lang];
const money = (c) => '$' + (Number(c) / 100).toFixed(2);

function setLang(l) { lang = l; document.documentElement.lang = l; render(); paintLangButtons(); }
function paintLangButtons() {
  const bar = document.getElementById('langBar');
  bar.style.display = '';
  document.getElementById('btnEn').className = lang === 'en' ? 'on' : '';
  document.getElementById('btnEs').className = lang === 'es' ? 'on' : '';
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
  const itemsRows = (quote.items || []).map(i =>
    `<tr><td>${esc(i.name)}</td><td>×${esc(i.qty)}</td></tr>`).join('');
  return `
    <h1>${esc(s.quoteHash(quote.id))}</h1>
    <p class="sub">${esc(s.hi(quote.customer_name))}</p>
    ${itemsRows ? `<table class="items">${itemsRows}</table>` : ''}
    <table class="totals">
      <tr><td>${esc(s.total)}</td><td>${money(quote.total_cents)}</td></tr>
      <tr class="hi"><td>${esc(s.deposit)}</td><td>${money(quote.deposit_cents)}</td></tr>
      <tr><td>${esc(s.balance)}</td><td>${money(quote.balance_cents)}</td></tr>
    </table>
    <button class="btn-pay" id="btnCard">${esc(s.payCard(money(quote.deposit_cents)))}</button>
    <div class="divider">${esc(s.or)}</div>
    <div id="paypal-area"></div>`;
}

let state = 'loading';

async function loadQuote() {
  const res = await fetch(`${WORKER}/quote/${encodeURIComponent(QUOTE_ID)}/payable?t=${encodeURIComponent(TOKEN)}`);
  if (!res.ok) { state = 'invalid'; render(); return; }
  quote = await res.json();
  setLangSilently(quote.language === 'en' ? 'en' : 'es');
  if (quote.deposit_paid || quote.status === 'converted') { state = 'already'; }
  else if (quote.status === 'archived') { state = 'invalid'; }
  else if (PAID_FLAG) { state = 'confirming'; pollForPaid(); }
  else { state = 'payable'; }
  render();
}
function setLangSilently(l) { lang = l; document.documentElement.lang = l; }

async function pollForPaid() {
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 2500));
    try {
      const res = await fetch(`${WORKER}/quote/${encodeURIComponent(QUOTE_ID)}/payable?t=${encodeURIComponent(TOKEN)}`);
      if (res.ok) {
        const q = await res.json();
        if (q.deposit_paid) { state = 'success'; render(); return; }
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
  const btn = document.getElementById('btnCard');
  btn.disabled = true;
  try {
    const res = await fetch(`${WORKER}/quote-deposit/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: Number(QUOTE_ID), token: TOKEN, origin: location.origin }),
    });
    const data = await res.json();
    if (!res.ok || !data.url) throw new Error(data.error || 'checkout failed');
    window.location = data.url;
  } catch (e) {
    console.error(e);
    state = 'pay-error'; render();
  }
}

let paypalScriptReady = null; // cached script-load promise (SDK may only be injected once)
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
          amount: { value: money(quote.deposit_cents) },
          custom_id: `q${quote.id}:${TOKEN}`,
        }],
      }),
      onApprove: async (data) => {
        try {
          state = 'confirming'; render();
          const res = await fetch(`${WORKER}/quote-deposit/paypal-capture`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: quote.id, token: TOKEN, paypalOrderId: data.orderID }),
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

if (!QUOTE_ID || !TOKEN) { state = 'invalid'; }
render();
if (state !== 'invalid') loadQuote();
paintLangButtons();
</script>
</body>
</html>
```

- [ ] **Step 2: Static sanity check**

Run: `node -e "const s=require('fs').readFileSync('pay-quote.html','utf8'); console.log('bytes:', s.length, '| has paypal:', s.includes('paypal.Buttons'), '| has worker:', s.includes('muy-rico-checkout'))"` from the repo root.
Expected: `bytes: >6000 | has paypal: true | has worker: true`

- [ ] **Step 3: Commit**

```bash
git add pay-quote.html
git commit -m "feat(site): bilingual quote deposit pay page"
```

---

### Task 9: Deploy + production verification

**Files:** none created/modified (deploy + manual checks only).

- [ ] **Step 1: Apply the migration to production D1**

```bash
npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0044_quote_deposit.sql
```

- [ ] **Step 2: Deploy the orders API worker**

```bash
npx wrangler deploy -c orders/wrangler.toml
```

- [ ] **Step 3: Deploy the checkout worker**

```bash
cd workers && npx wrangler deploy && cd ..
```

- [ ] **Step 4: Deploy the static site (pay-quote.html + existing assets)**

```bash
npx wrangler versions upload --name muyrico --assets . --compatibility-date 2025-03-21
npx wrangler versions deploy --name muyrico <VERSION_ID>@100%
```

- [ ] **Step 5: Production E2E (from spec §6)**

1. In the admin dashboard: create a test quote with a small price (e.g. $2.00) to your own email. The priced email must contain the green deposit button.
2. Open the link in an incognito window → summary + card + PayPal render; EN/ES toggle works.
3. Tamper the `t` param → invalid-link state.
4. Card: complete the Stripe payment → redirect → confirming → success state. Verify: dashboard shows the converted order with a partial 50% payment and card detail; Telegram ping fired; confirmation email received.
5. Re-open the same link → "Deposit already received" state.
6. Second test quote via PayPal → onApprove → success; same dashboard/email verifications.
7. Third quote: manual Convert with cash → converted flow unchanged (no online payment involved).
8. Re-send a quote email (email button) → link still valid.

- [ ] **Step 6: Done — no repo changes to commit** (deploy only)

---

## Self-review notes (author)

- Spec coverage: migration (T2), QUOTE_FIELDS/token gen/inline-row fix (T2 §2a/2b), lib (T1 §2c), email button + new proceed line (T6 §2d), convert extraction (T3 §2e), payable-deposit (T4 §2f), deposit-paid + dup alert + confirmation email (T5 §2g/2h/2i), checkout endpoints + webhooks (T7 §3a–3f), pay page (T8 §4), tests (T1/T3/T4/T5 verify steps §6), deploy (T9 §7). Admin UI: intentionally untouched (spec "Non-goals").
- Idempotency key: `deposit_ref`. PayPal capture id preferred; falls back to paypalOrderId.
- 409-vs-getQuote semantics: `loadPayableQuote` in checkout returns 409 for paid/converted/archived — the orders API `deposit-paid` endpoint itself uses its own `deposit_ref`/status checks and never returns 409, so `markQuoteDepositPaid`'s 409 branch is belt-and-suspenders.
- `rowToQuote` intentionally not extended; deposit endpoints read raw columns.
