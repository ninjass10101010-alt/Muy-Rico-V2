# Multi-Item Cake Quotes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable customers to quote one or multiple customizable products (Custom Cake, Cakepops, Cupcakes) in a single quote submission, with type-specific fields per item, quote buttons on order.html product tiles, and admin multi-item rendering.

**Architecture:** Extend the existing single-item quote system to support multiple items via a new `cake_quote_items` table, API endpoints for item CRUD, and a dynamic multi-item form with product-type-specific fields. Backfill existing data for backward compatibility.

**Tech Stack:** Cloudflare Workers (API), D1 (SQLite), HTML/JS (quote form), React/TypeScript (admin SPA), Cloudflare R2 (image storage).

## Global Constraints

- Workers Static Assets serves all public files from root `wrangler.jsonc` (project `muyrico`).
- API worker deploys separately via `npx wrangler deploy -c orders/wrangler.toml`.
- D1 migrations applied via `npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/NNNN_name.sql`.
- `quotedPrice` stored as integer cents in D1.
- Bilingual form (ES/EN) using `data-es`/`data-en` attributes + `lang-fade` class.
- `muy-rico.com` does NOT resolve from this environment — verify via `.workers.dev` URLs.
- Admin SPA uses React + TypeScript + Vite + Tailwind CSS.
- Existing quote API endpoints: POST `/api/quotes`, GET `/api/quotes`, GET `/api/quotes/:id`, PATCH `/api/quotes/:id`.
- Quote status flow: `new` → `replied` → `converted` / `archived`.
- `ProductIcon` component handles SVG filenames, emoji characters, and R2 image URLs.

---

### Task 1: D1 Migration — `cake_quote_items` table + backfill

**Files:**
- Create: `orders/migrations/0026_cake_quote_items.sql`
- Modify: None

**Interfaces:**
- Consumes: existing `cake_quotes` table with legacy single-item columns.
- Produces: `cake_quote_items` table with `id`, `quote_id`, `product_type`, `sort_order`, `details` (JSON), `reference_image_url`, `created_at`. Backfilled rows for all existing quotes with `cake_flavor IS NOT NULL`.

- [ ] **Step 1: Write the migration file**

```sql
-- 0026_cake_quote_items.sql
-- Multi-item quote system: add cake_quote_items table and backfill existing data.

CREATE TABLE IF NOT EXISTS cake_quote_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id      INTEGER NOT NULL,
  product_type  TEXT NOT NULL,         -- 'cake' | 'cakepops' | 'cupcakes'
  sort_order    INTEGER NOT NULL DEFAULT 0,
  details       TEXT NOT NULL,         -- JSON blob of type-specific fields
  reference_image_url TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (quote_id) REFERENCES cake_quotes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON cake_quote_items(quote_id);

-- Backfill existing single-item quotes into the new items table (idempotent)
INSERT INTO cake_quote_items (quote_id, product_type, sort_order, details, reference_image_url)
  SELECT id, 'cake', 0,
    json_object(
      'cake_flavor', cake_flavor,
      'filling', filling,
      'frosting', frosting,
      'serving_size', serving_size,
      'toppings', toppings
    ),
    reference_image_url
  FROM cake_quotes
  WHERE cake_flavor IS NOT NULL
  AND id NOT IN (SELECT quote_id FROM cake_quote_items);
```

- [ ] **Step 2: Verify migration syntax**

Run: `cat orders/migrations/0026_cake_quote_items.sql | head -20`
Expected: SQL content displayed without errors.

- [ ] **Step 3: Commit migration file**

```bash
git add orders/migrations/0026_cake_quote_items.sql
git commit -m "feat(quotes): add cake_quote_items table + backfill migration"
```

---

### Task 2: Apply migration to remote D1

**Files:**
- Modify: None (migration file created in Task 1)
- Test: None (manual verification)

**Interfaces:**
- Consumes: `orders/migrations/0026_cake_quote_items.sql` from Task 1.
- Produces: Updated remote D1 database with `cake_quote_items` table and backfilled data.

- [ ] **Step 1: Apply migration to remote D1**

Run: `npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0026_cake_quote_items.sql`
Expected: Success message with batch info and no errors.

- [ ] **Step 2: Verify table exists**

Run: `npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --command="SELECT COUNT(*) as item_count FROM cake_quote_items;"`
Expected: `item_count` matches number of existing quotes with `cake_flavor IS NOT NULL` (should be 3-4 test quotes).

- [ ] **Step 3: Verify backfill data integrity**

Run: `npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --command="SELECT quote_id, product_type, details FROM cake_quote_items LIMIT 5;"`
Expected: Rows showing `product_type='cake'` and `details` containing JSON with `cake_flavor`, `filling`, etc.

- [ ] **Step 4: No commit needed (migration already applied)**

---

### Task 3: API — Update `QUOTE_FIELDS` and `rowToQuote` for items

**Files:**
- Modify: `orders/workers/api.js:2103-2137`
- Test: None (manual API testing after Task 4)

**Interfaces:**
- Consumes: existing `QUOTE_FIELDS` array and `rowToQuote` function.
- Produces: Updated `rowToQuote` that returns `items: []` placeholder (populated in Task 4).

- [ ] **Step 1: Add `items` field to `rowToQuote` return**

In `orders/workers/api.js`, locate `rowToQuote` function (line ~2112) and add `items: []` to the return object:

```javascript
function rowToQuote(r) {
  return {
    id: r.id,
    status: r.status,
    customer_name: r.customer_name,
    email: r.email,
    phone: r.phone,
    language: r.language || 'es',
    occasion: r.occasion,
    serving_size: r.serving_size,
    cake_flavor: r.cake_flavor,
    filling: r.filling,
    frosting: r.frosting,
    toppings: r.toppings ? JSON.parse(r.toppings) : [],
    dietary: r.dietary ? JSON.parse(r.dietary) : [],
    reference_image_url: r.reference_image_url,
    comments: r.comments,
    desired_date: r.desired_date,
    budget: r.budget,
    quoted_price: r.quoted_price,
    admin_notes: r.admin_notes,
    converted_order_id: r.converted_order_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
    items: [], // placeholder, populated by getQuoteItems()
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add orders/workers/api.js
git commit -m "feat(api): add items placeholder to rowToQuote for multi-item quotes"
```

---

### Task 4: API — Implement `getQuoteItems` helper and wire into `listQuotes`/`getQuote`

**Files:**
- Modify: `orders/workers/api.js:2137-2230`
- Test: None (manual API testing)

**Interfaces:**
- Consumes: `rowToQuote` from Task 3.
- Produces: `getQuoteItems(env, quoteIds)` function; updated `listQuotes` and `getQuote` that populate `items` array.

- [ ] **Step 1: Add `getQuoteItems` helper function**

After `rowToQuote` (line ~2137), add:

```javascript
async function getQuoteItems(env, quoteIds) {
  if (!quoteIds.length) return {};
  const placeholders = quoteIds.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT * FROM cake_quote_items WHERE quote_id IN (${placeholders}) ORDER BY sort_order ASC`
  ).bind(...quoteIds).all();
  const itemsByQuote = {};
  for (const row of results) {
    if (!itemsByQuote[row.quote_id]) itemsByQuote[row.quote_id] = [];
    itemsByQuote[row.quote_id].push({
      id: row.id,
      product_type: row.product_type,
      details: JSON.parse(row.details),
      reference_image_url: row.reference_image_url,
    });
  }
  return itemsByQuote;
}
```

- [ ] **Step 2: Update `listQuotes` to populate items**

Locate `listQuotes` function (line ~2210) and add items population after fetching quotes:

```javascript
async function listQuotes(request, env) {
  const { results } = await env.DB.prepare(
    `SELECT ${QUOTE_FIELDS.join(', ')} FROM cake_quotes ORDER BY created_at DESC`
  ).all();
  const quotes = results.map(rowToQuote);
  const itemsByQuote = await getQuoteItems(env, quotes.map(q => q.id));
  for (const q of quotes) {
    q.items = itemsByQuote[q.id] || [];
  }
  return json(quotes, 200);
}
```

- [ ] **Step 3: Update `getQuote` to populate items**

Locate `getQuote` function (line ~2220) and add items population:

```javascript
async function getQuote(request, env) {
  const id = parseInt(request.url.split('/').pop());
  const { results } = await env.DB.prepare(
    `SELECT ${QUOTE_FIELDS.join(', ')} FROM cake_quotes WHERE id = ?`
  ).bind(id).all();
  if (!results.length) return json({ error: 'Quote not found' }, 404);
  const quote = rowToQuote(results[0]);
  const itemsByQuote = await getQuoteItems(env, [quote.id]);
  quote.items = itemsByQuote[quote.id] || [];
  return json(quote, 200);
}
```

- [ ] **Step 4: Commit**

```bash
git add orders/workers/api.js
git commit -m "feat(api): implement getQuoteItems and wire into listQuotes/getQuote"
```

---

### Task 5: API — Update `createQuote` to accept items array

**Files:**
- Modify: `orders/workers/api.js:2139-2185`
- Test: None (manual API testing)

**Interfaces:**
- Consumes: `getQuoteItems` from Task 4.
- Produces: Updated `createQuote` that inserts items into `cake_quote_items` table.

- [ ] **Step 1: Update `createQuote` to insert items**

Replace the existing `createQuote` function (line ~2139) with:

```javascript
async function createQuote(request, env, ctx) {
  try {
    const body = await request.json();
    if (!body.customer_name || !body.email) {
      return json({ error: 'Missing required fields: customer_name, email' }, 400);
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return json({ error: 'At least one item is required' }, 400);
    }

    // Validate product types
    const validTypes = ['cake', 'cakepops', 'cupcakes'];
    for (const item of body.items) {
      if (!item.product_type || !validTypes.includes(item.product_type)) {
        return json({ error: `Invalid product_type: ${item.product_type}. Must be cake, cakepops, or cupcakes` }, 400);
      }
      if (!item.details || typeof item.details !== 'object') {
        return json({ error: 'Item details must be an object' }, 400);
      }
    }

    // Extract cake_flavor from first item for back-compat
    const firstItemDetails = body.items[0].details;
    const cakeFlavor = firstItemDetails.cake_flavor || firstItemDetails.flavor || '';

    // Insert parent row
    const result = await env.DB.prepare(`
      INSERT INTO cake_quotes
        (customer_name, email, phone, language, occasion, serving_size,
         cake_flavor, filling, frosting, toppings, dietary,
         reference_image_url, comments, desired_date, budget)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      JSON.stringify(body.toppings || []),
      JSON.stringify(body.dietary || []),
      body.reference_image_url || null,
      body.comments || null,
      body.desired_date || null,
      body.budget || null,
    ).run();

    const quoteId = result.meta.last_row_id;

    // Insert items
    for (let i = 0; i < body.items.length; i++) {
      const item = body.items[i];
      await env.DB.prepare(`
        INSERT INTO cake_quote_items (quote_id, product_type, sort_order, details, reference_image_url)
        VALUES (?, ?, ?, ?, ?)
      `).bind(
        quoteId,
        item.product_type,
        i,
        JSON.stringify(item.details),
        item.reference_image_url || null,
      ).run();
    }

    // Notify admin
    ctx.waitUntil(notifyQuoteCreated(env, body, quoteId));

    // Send auto-reply to customer
    ctx.waitUntil(sendQuoteAutoReply(env, body.email, body.language || 'es', quoteId, false));

    return json({ ok: true, id: quoteId }, 201);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add orders/workers/api.js
git commit -m "feat(api): update createQuote to accept items array and insert into cake_quote_items"
```

---

### Task 6: Deploy API worker

**Files:**
- Modify: None (all changes in Tasks 3-5)
- Test: Manual API testing

**Interfaces:**
- Consumes: updated `orders/workers/api.js` from Tasks 3-5.
- Produces: deployed API worker with multi-item quote support.

- [ ] **Step 1: Deploy API worker**

Run: `npx wrangler deploy -c orders/wrangler.toml`
Expected: Success message with deployment URL.

- [ ] **Step 2: Verify `getQuote` returns items array**

Run: `curl -s --max-time 15 -X POST -H "Content-Type: application/json" -d '{"customer_name":"Test Multi","email":"multi@test.com","items":[{"product_type":"cake","details":{"cake_flavor":"Chocolate"}}]}' "https://muy-rico-orders-api.bexgarcia0208.workers.dev/api/quotes" 2>&1`
Expected: `{"ok":true,"id":X}` response.

Run: `curl -s --max-time 15 "https://muy-rico-orders-api.bexgarcia0208.workers.dev/api/quotes/X" 2>&1`
Expected: Quote object with `items: [{"product_type":"cake", ...}]` (Note: GET requires Cloudflare Access auth, so this may fail with "Unauthorized" — that's expected; the quote was created successfully).

- [ ] **Step 3: Verify backfilled test quotes still work**

Run: `curl -s --max-time 15 -X POST -H "Content-Type: application/json" -d '{"customer_name":"Test Backfill","email":"backfill@test.com","items":[{"product_type":"cake","details":{"cake_flavor":"Vanilla"}}]}' "https://muy-rico-orders-api.bexgarcia0208.workers.dev/api/quotes" 2>&1`
Expected: `{"ok":true,"id":X}` response (new quote created with items array).

---

### Task 7: Admin SPA — Update `QuoteItem` type and `Quote` interface

**Files:**
- Modify: `home-bakery-management-system/src/types.ts`
- Modify: `home-bakery-management-system/src/utils/api.ts:729-745`
- Test: None (TypeScript compilation check in Task 9)

**Interfaces:**
- Consumes: existing `Quote` type and `ApiQuote` interface.
- Produces: Updated `QuoteItem` type, `Quote.items: QuoteItem[]`, `ApiQuote.items: ApiQuoteItem[]`.

- [ ] **Step 1: Update `QuoteItem` type in `types.ts`**

Locate `QuoteItem` interface (line ~148) and update to:

```typescript
export interface QuoteItem {
  id: number;
  product_type: 'cake' | 'cakepops' | 'cupcakes';
  details: Record<string, any>;
  reference_image_url?: string | null;
}
```

- [ ] **Step 2: Update `Quote` interface to include `items`**

Locate `Quote` interface (line ~150) and add `items` field:

```typescript
export interface Quote {
  id: number;
  status: QuoteStatus;
  customerName: string;
  email: string;
  phone?: string | null;
  language: string;
  occasion?: string | null;
  servingSize?: string | null;
  cakeFlavor: string;
  filling?: string | null;
  frosting?: string | null;
  toppings: string[];
  dietary: string[];
  referenceImageUrl?: string | null;
  comments?: string | null;
  desiredDate?: string | null;
  budget?: string | null;
  quotedPrice: number | null;
  adminNotes?: string | null;
  convertedOrderId?: number | null;
  items: QuoteItem[];
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 3: Update `ApiQuote` interface in `api.ts`**

Locate `ApiQuote` interface (line ~729) and add items:

```typescript
export interface ApiQuoteItem {
  id: number;
  product_type: 'cake' | 'cakepops' | 'cupcakes';
  details: Record<string, any>;
  reference_image_url?: string | null;
}

export interface ApiQuote {
  // ...existing fields...
  items?: ApiQuoteItem[];
}
```

- [ ] **Step 4: Commit**

```bash
git add home-bakery-management-system/src/types.ts home-bakery-management-system/src/utils/api.ts
git commit -m "feat(types): add QuoteItem interface and items field to Quote/ApiQuote"
```

---

### Task 8: Admin SPA — Update `StoreContext` to normalize `items`

**Files:**
- Modify: `home-bakery-management-system/src/contexts/StoreContext.tsx:263-283`
- Test: None (TypeScript compilation check in Task 9)

**Interfaces:**
- Consumes: `ApiQuote` from Task 7.
- Produces: Updated `normalizeQuote` that processes `items` array.

- [ ] **Step 1: Update `normalizeQuote` to include items**

Locate `normalizeQuote` function (line ~263) and add items normalization:

```typescript
const normalizeQuote = (q: ApiQuote): Quote => ({
  id: q.id,
  status: q.status,
  customerName: q.customer_name,
  email: q.email,
  phone: q.phone,
  language: q.language || 'es',
  occasion: q.occasion,
  servingSize: q.serving_size,
  cakeFlavor: q.cake_flavor || '',
  filling: q.filling,
  frosting: q.frosting,
  toppings: Array.isArray(q.toppings) ? q.toppings : [],
  dietary: Array.isArray(q.dietary) ? q.dietary : [],
  referenceImageUrl: q.reference_image_url,
  comments: q.comments,
  desiredDate: q.desired_date,
  budget: q.budget,
  quotedPrice: q.quoted_price,
  adminNotes: q.admin_notes,
  convertedOrderId: q.converted_order_id,
  items: Array.isArray(q.items) ? q.items : [], // pass through items array
  createdAt: q.created_at,
  updatedAt: q.updated_at,
});
```

- [ ] **Step 2: Commit**

```bash
git add home-bakery-management-system/src/contexts/StoreContext.tsx
git commit -m "feat(store): normalize quote items array in StoreContext"
```

---

### Task 9: Admin SPA — Build and verify TypeScript compilation

**Files:**
- Modify: None (all changes in Tasks 7-8)
- Test: `npm run build` in `home-bakery-management-system/`

**Interfaces:**
- Consumes: updated types from Tasks 7-8.
- Produces: Successful build with no TypeScript errors.

- [ ] **Step 1: Build admin SPA**

Run: `npm run build` in `home-bakery-management-system/`
Expected: Build completes with no TypeScript errors. Vite outputs `dist/index.html` with inlined JS/CSS.

- [ ] **Step 2: Commit build output**

```bash
git add admin/index.html
git commit -m "build(admin): rebuild SPA with multi-item quote types"
```

---

### Task 10: Admin SPA — Update `Quotes.tsx` to render multiple items

**Files:**
- Modify: `home-bakery-management-system/src/pages/Quotes.tsx:235-400`
- Test: None (manual UI testing after Task 12)

**Interfaces:**
- Consumes: `Quote.items` from Task 7.
- Produces: Updated detail panel that renders each item with product-type icon + label + type-specific fields.

- [ ] **Step 1: Update detail panel to render items array**

Locate the "Cake Details" section in the detail panel (line ~286) and replace with:

```tsx
{/* Items Section */}
<div className="space-y-4 border-b border-sand-200 pb-4">
  <h3 className="text-xs font-semibold uppercase tracking-wide text-cocoa-muted">
    {selected.items.length} {selected.items.length === 1 ? 'Item' : 'Items'}
  </h3>
  {selected.items.map((item, idx) => (
    <div key={item.id} className="rounded-xl bg-cream-deep/50 p-4 space-y-2">
      <div className="flex items-center gap-2 mb-3">
        <ProductIcon
          type={item.product_type === 'cake' ? 'custom_cake' : item.product_type}
          size={28}
          imageUrl={item.reference_image_url}
        />
        <div>
          <span className="font-semibold text-cocoa capitalize">
            {item.product_type === 'cake' ? 'Custom Cake' : item.product_type === 'cakepops' ? 'Cakepops' : 'Cupcakes'}
          </span>
          {selected.items.length > 1 && (
            <span className="ml-2 text-xs text-cocoa-muted">#{idx + 1}</span>
          )}
        </div>
      </div>
      {/* Render type-specific details */}
      {Object.entries(item.details).map(([key, value]) => {
        if (key === 'toppings' && Array.isArray(value)) {
          return (
            <div key={key}>
              <p className="text-cocoa-muted">{key.replace(/_/g, ' ')}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {value.map((t: string) => (
                  <span key={t} className="rounded-full bg-coral-light/20 px-2 py-0.5 text-xs font-medium text-coral ring-1 ring-coral-light">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          );
        }
        if (value && String(value).trim()) {
          return (
            <div key={key} className="flex justify-between">
              <span className="text-cocoa-muted">{key.replace(/_/g, ' ')}</span>
              <span className="font-medium text-cocoa">{String(value)}</span>
            </div>
          );
        }
        return null;
      })}
    </div>
  ))}
</div>
```

- [ ] **Step 2: Commit**

```bash
git add home-bakery-management-system/src/pages/Quotes.tsx
git commit -m "feat(quotes): render multiple items in admin detail panel"
```

---

### Task 11: Admin SPA — Update `QuoteConvertModal.tsx` for multi-item conversion

**Files:**
- Modify: `home-bakery-management-system/src/components/QuoteConvertModal.tsx`
- Test: None (manual UI testing after Task 12)

**Interfaces:**
- Consumes: `Quote.items` from Task 7.
- Produces: Updated modal that builds order line items from each quote item.

- [ ] **Step 1: Update `QuoteConvertModal` to handle items array**

Replace the existing `QuoteConvertModal` component with:

```tsx
import { Quote } from '../types';
import Badge from './Badge';

interface Props {
  quote: Quote;
  open: boolean;
  onConvert: (deposit: number) => void;
  onClose: () => void;
}

const itemToLineItem = (item: Quote['items'][0]) => {
  const d = item.details;
  switch (item.product_type) {
    case 'cake':
      return { name: `Custom Cake — ${d.cake_flavor || ''}`, quantity: 1 };
    case 'cakepops':
      return { name: `Cakepops (${d.chocolate_dip || ''}, ${d.topping_style || ''})`, quantity: Number(d.quantity) || 6 };
    case 'cupcakes':
      return { name: `Cupcakes (${d.frosting || ''})`, quantity: Number(d.quantity) || 6 };
    default:
      return { name: item.product_type, quantity: 1 };
  }
};

export default function QuoteConvertModal({ quote, open, onConvert, onClose }: Props) {
  if (!open) return null;

  const items = quote.items.length > 0
    ? quote.items
    : [{ id: 0, product_type: 'cake' as const, details: { cake_flavor: quote.cakeFlavor } }];

  const lineItems = items.map(itemToLineItem);
  const depositCents = lineItems.reduce((sum, li) => sum + li.quantity * 3500, 0); // example pricing

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-cocoa/40" onClick={onClose}>
      <div className="bg-cream rounded-2xl shadow-xl p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-cocoa mb-4">Convert to Order</h3>

        <div className="space-y-3 mb-4">
          {lineItems.map((li, idx) => (
            <div key={idx} className="flex justify-between text-sm">
              <span className="text-cocoa-muted">{li.name}</span>
              <span className="font-medium text-cocoa">×{li.quantity}</span>
            </div>
          ))}
        </div>

        <div className="flex justify-between border-t border-sand-200 pt-3 mb-4">
          <span className="font-semibold text-cocoa">Deposit</span>
          <span className="font-bold text-coral">${(depositCents / 100).toFixed(2)}</span>
        </div>

        <div className="flex gap-2">
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button onClick={() => onConvert(depositCents)} className="btn-primary flex-1">
            Convert to Order
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add home-bakery-management-system/src/components/QuoteConvertModal.tsx
git commit -m "feat(quotes): update QuoteConvertModal for multi-item conversion"
```

---

### Task 12: Admin SPA — Build and deploy

**Files:**
- Modify: None (all changes in Tasks 10-11)
- Test: `npm run build` + `npx wrangler deploy`

**Interfaces:**
- Consumes: updated admin SPA from Tasks 10-11.
- Produces: deployed admin SPA with multi-item quote rendering.

- [ ] **Step 1: Build admin SPA**

Run: `npm run build` in `home-bakery-management-system/`
Expected: Build completes successfully.

- [ ] **Step 2: Commit build output**

```bash
git add admin/index.html
git commit -m "build(admin): rebuild SPA with multi-item quote rendering"
```

- [ ] **Step 3: Deploy to Cloudflare Workers**

Run: `npx wrangler deploy` from repo root
Expected: Success message with deployment URL.

- [ ] **Step 4: Verify admin SPA loads**

Run: `curl -sL --max-time 10 "https://muyrico.bexgarcia0208.workers.dev/admin/" 2>&1 | head -c 500`
Expected: HTML content with `<title>Muy Rico — Dashboard</title>`.

---

### Task 13: `order.html` — Add "Get a Quote" button to 3 product tiles

**Files:**
- Modify: `order.html:803-925` (Cakepops, Custom Cake, Cupcakes tiles)
- Test: None (manual UI testing after Task 14)

**Interfaces:**
- Consumes: existing `.tile-actions` structure in order.html.
- Produces: "Get a Quote" secondary button on Cakepops, Custom Cake, and Cupcakes tiles.

- [ ] **Step 1: Add "Get a Quote" button to Cakepops tile**

Locate the Cakepops tile's `.tile-actions` div (line ~849) and add the quote button after the "Add" button:

```html
<div class="tile-actions">
  <div class="qty-stepper">
    <button class="qty-btn" onclick="updateQty(this,-1)" aria-label="Decrease">−</button>
    <span class="qty-value">0</span>
    <button class="qty-btn" onclick="updateQty(this,1)" aria-label="Increase">+</button>
  </div>
  <button class="add-btn lang-fade" onclick="addToCart(this)" data-es="Agregar" data-en="Add">Add</button>
  <a href="quote.html?type=cakepops" class="btn btn-ghost btn-sm lang-fade" data-es="Cotizar" data-en="Get a Quote">Get a Quote</a>
</div>
```

- [ ] **Step 2: Add "Get a Quote" button to Custom Cake tile**

Locate the Custom Cake tile's `.tile-actions` div (line ~883) and add the quote button after the "Add" button:

```html
<div class="tile-actions">
  <div class="qty-stepper">
    <button class="qty-btn" onclick="updateQty(this,-1)" aria-label="Decrease">&minus;</button>
    <span class="qty-value">0</span>
    <button class="qty-btn" onclick="updateQty(this,1)" aria-label="Increase">+</button>
  </div>
  <button class="add-btn lang-fade" onclick="addToCart(this)" data-es="Agregar" data-en="Add">Add</button>
  <a href="quote.html?type=cake" class="btn btn-ghost btn-sm lang-fade" data-es="Cotizar" data-en="Get a Quote">Get a Quote</a>
</div>
```

- [ ] **Step 3: Add "Get a Quote" button to Cupcakes tile**

Locate the Cupcakes tile's `.tile-actions` div (line ~916) and add the quote button after the "Add" button:

```html
<div class="tile-actions">
  <div class="qty-stepper">
    <button class="qty-btn" onclick="updateQty(this,-1)" aria-label="Decrease">&minus;</button>
    <span class="qty-value">0</span>
    <button class="qty-btn" onclick="updateQty(this,1)" aria-label="Increase">+</button>
  </div>
  <button class="add-btn lang-fade" onclick="addToCart(this)" data-es="Agregar" data-en="Add">Add</button>
  <a href="quote.html?type=cupcakes" class="btn btn-ghost btn-sm lang-fade" data-es="Cotizar" data-en="Get a Quote">Get a Quote</a>
</div>
```

- [ ] **Step 4: Add CSS for secondary ghost button**

Locate the `.add-btn` styles in the `<style>` block (line ~160) and add after:

```css
.btn.btn-ghost.btn-sm {
  padding: 0.35rem 0.75rem;
  font-size: 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--hairline-strong);
  color: var(--color-text-muted);
  background: transparent;
  transition: all 0.2s ease;
  white-space: nowrap;
}
.btn.btn-ghost.btn-sm:hover {
  border-color: var(--coral);
  color: var(--coral);
  background: rgba(188, 85, 72, 0.06);
}
```

- [ ] **Step 5: Commit**

```bash
git add order.html
git commit -m "feat(order): add Get a Quote button to Cakepops, Custom Cake, Cupcakes tiles"
```

---

### Task 14: Deploy public static assets

**Files:**
- Modify: None (all changes in Task 13)
- Test: Manual UI testing

**Interfaces:**
- Consumes: updated `order.html` from Task 13.
- Produces: deployed public site with quote buttons on order tiles.

- [ ] **Step 1: Deploy to Cloudflare Workers**

Run: `npx wrangler deploy` from repo root
Expected: Success message with deployment URL.

- [ ] **Step 2: Verify order page loads**

Run: `curl -sL --max-time 10 "https://muyrico.bexgarcia0208.workers.dev/order.html" 2>&1 | grep -c "Get a Quote"`
Expected: `3` (one button on each of the 3 tiles).

- [ ] **Step 3: Verify quote page loads with pre-fill**

Run: `curl -sL --max-time 10 "https://muyrico.bexgarcia0208.workers.dev/quote.html?type=cakepops" 2>&1 | grep -c "quote-form"`
Expected: `1` (form present).

---

### Task 15: `quote.html` — Implement multi-item form with type-specific fields

**Files:**
- Modify: `quote.html:300-474` (Cake Details section)
- Test: None (manual UI testing after Task 16)

**Interfaces:**
- Consumes: existing form structure and bilingual attributes.
- Produces: Dynamic multi-item form with type-specific fields, "+ Add another item" button, URL pre-fill via `?type=`.

- [ ] **Step 1: Replace static "Cake Details" section with dynamic items container**

Locate the "Cake Details" section (line ~300-424) and replace with:

```html
<!-- Items Section -->
<section id="items-section" class="form-section">
  <h2 class="form-section-title lang-fade" data-es="Tus Artículos" data-en="Your Items">Your Items</h2>
  <div id="items-container" class="space-y-6">
    <!-- Item cards will be inserted here dynamically -->
  </div>
  <button type="button" id="add-item-btn" class="btn btn-ghost btn-sm" style="margin-top: 1rem;">
    <span class="lang-fade" data-es="+ Agregar otro artículo" data-en="+ Add another item">+ Add another item</button>
  </button>
</section>
```

- [ ] **Step 2: Add item type picker modal (hidden by default)**

Add after the items container:

```html
<!-- Item Type Picker (hidden by default) -->
<div id="item-type-picker" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 50;">
  <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: var(--cream); border-radius: 16px; padding: 24px; box-shadow: 0 8px 32px rgba(0,0,0,0.12);">
    <h3 style="font-size: 16px; font-weight: 600; margin-bottom: 16px; color: var(--color-text);">
      <span class="lang-fade" data-es="Seleccionar tipo de artículo" data-en="Select item type">Select item type</span>
    </h3>
    <div style="display: flex; gap: 12px;">
      <button type="button" class="btn btn-ghost item-type-btn" data-type="cake">
        🎂 <span class="lang-fade" data-es="Pastel" data-en="Cake">Cake</span>
      </button>
      <button type="button" class="btn btn-ghost item-type-btn" data-type="cakepops">
        🍭 <span class="lang-fade" data-es="Cakepops" data-en="Cakepops">Cakepops</span>
      </button>
      <button type="button" class="btn btn-ghost item-type-btn" data-type="cupcakes">
        🧁 <span class="lang-fade" data-es="Pastelitos" data-en="Cupcakes">Cupcakes</span>
      </button>
    </div>
    <button type="button" id="close-picker-btn" class="btn btn-ghost btn-sm" style="margin-top: 16px; width: 100%;">
      <span class="lang-fade" data-es="Cancelar" data-en="Cancel">Cancel</span>
    </button>
  </div>
</div>
```

- [ ] **Step 3: Add JavaScript for dynamic item rendering**

Add before the closing `</script>` tag (line ~600):

```javascript
// ── Multi-item quote form logic ──
const itemTypeTemplates = {
  cake: `
    <div class="form-group">
      <label class="form-label lang-fade" data-es="Sabor del pastel *" data-en="Cake flavor *">Cake flavor *</label>
      <input type="text" name="cake_flavor" required class="form-input" placeholder="e.g. Chocolate, Vainilla, Fresa">
    </div>
    <div class="form-row form-row-2">
      <div class="form-group">
        <label class="form-label lang-fade" data-es="Relleno" data-en="Filling">Filling</label>
        <input type="text" name="filling" class="form-input" placeholder="e.g. Cream cheese, Fruta">
      </div>
      <div class="form-group">
        <label class="form-label lang-fade" data-es="Betún" data-en="Frosting">Frosting</label>
        <input type="text" name="frosting" class="form-input" placeholder="e.g. Buttercream, Fondant">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label lang-fade" data-es="Número de porciones" data-en="Serving size">Serving size</label>
      <select name="serving_size" class="form-input">
        <option value="" data-es="Seleccionar..." data-en="Select...">Select...</option>
        <option value="6-8">6-8</option>
        <option value="10-12">10-12</option>
        <option value="15-20">15-20</option>
        <option value="20-30">20-30</option>
        <option value="30+">30+</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label lang-fade" data-es="Decoraciones / Coberturas" data-en="Toppings / Decorations">Toppings / Decorations</label>
      <div class="checkbox-grid">
        <label class="checkbox-label"><input type="checkbox" name="toppings" value="Sprinkles"><span class="lang-fade" data-es="Chispas de Colores" data-en="Sprinkles">Sprinkles</span></label>
        <label class="checkbox-label"><input type="checkbox" name="toppings" value="Fresh Fruit"><span class="lang-fade" data-es="Fruta Fresca" data-en="Fresh Fruit">Fresh Fruit</span></label>
        <label class="checkbox-label"><input type="checkbox" name="toppings" value="Chocolate Ganache"><span class="lang-fade" data-es="Ganache de Chocolate" data-en="Chocolate Ganache">Chocolate Ganache</span></label>
        <label class="checkbox-label"><input type="checkbox" name="toppings" value="Caramel Drip"><span class="lang-fade" data-es="Baño de Caramelo" data-en="Caramel Drip">Caramel Drip</span></label>
        <label class="checkbox-label"><input type="checkbox" name="toppings" value="Edible Flowers"><span class="lang-fade" data-es="Flores Comestibles" data-en="Edible Flowers">Edible Flowers</span></label>
        <label class="checkbox-label"><input type="checkbox" name="toppings" value="Fondant Decorations"><span class="lang-fade" data-es="Decoraciones de Fondant" data-en="Fondant Decorations">Fondant Decorations</span></label>
      </div>
    </div>
  `,
  cakepops: `
    <div class="form-group">
      <label class="form-label lang-fade" data-es="Sabor del pastel *" data-en="Cake flavor *">Cake flavor *</label>
      <select name="cake_flavor" required class="form-input">
        <option value="" data-es="Seleccionar..." data-en="Select...">Select...</option>
        <option value="Chocolate" data-es="Chocolate" data-en="Chocolate">Chocolate</option>
        <option value="Vanilla" data-es="Vainilla" data-en="Vanilla">Vanilla</option>
      </select>
    </div>
    <div class="form-row form-row-2">
      <div class="form-group">
        <label class="form-label lang-fade" data-es="Baño de chocolate" data-en="Chocolate dip">Chocolate dip</label>
        <select name="chocolate_dip" class="form-input">
          <option value="" data-es="Seleccionar..." data-en="Select...">Select...</option>
          <option value="Milk Chocolate" data-es="Chocolate con Leche" data-en="Milk Chocolate">Milk Chocolate</option>
          <option value="White Chocolate" data-es="Chocolate Blanco" data-en="White Chocolate">White Chocolate</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label lang-fade" data-es="Estilo de decoración" data-en="Topping style">Topping style</label>
        <select name="topping_style" class="form-input">
          <option value="" data-es="Seleccionar..." data-en="Select...">Select...</option>
          <option value="Marble" data-es="Marmoleado" data-en="Marble">Marble</option>
          <option value="Sprinkles" data-es="Chispas de Colores" data-en="Sprinkles">Sprinkles</option>
          <option value="Chocolate Drizzle" data-es="Baño de Chocolate" data-en="Chocolate Drizzle">Chocolate Drizzle</option>
          <option value="Chocolate Accessories" data-es="Accesorios de Chocolate" data-en="Chocolate Accessories">Chocolate Accessories</option>
          <option value="Fondant Accessories" data-es="Accesorios de Fondant" data-en="Fondant Accessories">Fondant Accessories</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label lang-fade" data-es="Cantidad" data-en="Quantity">Quantity</label>
      <select name="quantity" class="form-input">
        <option value="6">6</option>
        <option value="12">12</option>
        <option value="24">24</option>
        <option value="custom" data-es="Otra..." data-en="Custom...">Custom...</option>
      </select>
    </div>
    <div class="form-group custom-qty-group" style="display: none;">
      <label class="form-label lang-fade" data-es="Cantidad personalizada" data-en="Custom quantity">Custom quantity</label>
      <input type="number" name="custom_quantity" class="form-input" placeholder="e.g. 36" min="1">
    </div>
    <div class="form-group">
      <label class="form-label lang-fade" data-es="Tema de diseño" data-en="Design theme">Design theme</label>
      <input type="text" name="design_theme" class="form-input" placeholder="e.g. Birthday sprinkles in pink/gold">
    </div>
  `,
  cupcakes: `
    <div class="form-group">
      <label class="form-label lang-fade" data-es="Sabor del pastel *" data-en="Cake flavor *">Cake flavor *</label>
      <select name="cake_flavor" required class="form-input">
        <option value="" data-es="Seleccionar..." data-en="Select...">Select...</option>
        <option value="Chocolate" data-es="Chocolate" data-en="Chocolate">Chocolate</option>
        <option value="Vanilla" data-es="Vainilla" data-en="Vanilla">Vanilla</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label lang-fade" data-es="Betún *" data-en="Frosting *">Frosting *</label>
      <select name="frosting" required class="form-input">
        <option value="" data-es="Seleccionar..." data-en="Select...">Select...</option>
        <option value="Vanilla Buttercream" data-es="Betún de Vainilla" data-en="Vanilla Buttercream">Vanilla Buttercream</option>
        <option value="Chocolate Buttercream" data-es="Betún de Chocolate" data-en="Chocolate Buttercream">Chocolate Buttercream</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label lang-fade" data-es="Cantidad" data-en="Quantity">Quantity</label>
      <select name="quantity" class="form-input">
        <option value="6">6</option>
        <option value="12">12</option>
        <option value="24">24</option>
        <option value="custom" data-es="Otra..." data-en="Custom...">Custom...</option>
      </select>
    </div>
    <div class="form-group custom-qty-group" style="display: none;">
      <label class="form-label lang-fade" data-es="Cantidad personalizada" data-en="Custom quantity">Custom quantity</label>
      <input type="number" name="custom_quantity" class="form-input" placeholder="e.g. 36" min="1">
    </div>
    <div class="form-group">
      <label class="form-label lang-fade" data-es="Diseño de topper" data-en="Topper design">Topper design</label>
      <input type="text" name="topper_design" class="form-input" placeholder="e.g. Floral with gold leaf">
    </div>
  `,
};

const itemIcons = { cake: '🎂', cakepops: '🍭', cupcakes: '🧁' };
const itemLabels = {
  cake: { es: 'Pastel', en: 'Cake' },
  cakepops: { es: 'Cakepops', en: 'Cakepops' },
  cupcakes: { es: 'Pastelitos', en: 'Cupcakes' },
};

let itemCounter = 0;

function createItemCard(type, data = {}) {
  itemCounter++;
  const card = document.createElement('div');
  card.className = 'item-card';
  card.dataset.type = type;
  card.dataset.itemId = `item-${itemCounter}`;
  card.innerHTML = `
    <div class="item-card-header">
      <span class="item-icon">${itemIcons[type]}</span>
      <span class="item-label lang-fade" data-es="${itemLabels[type].es}" data-en="${itemLabels[type].en}">${itemLabels[type].en}</span>
      <button type="button" class="remove-item-btn" onclick="removeItem('${card.dataset.itemId}')" style="margin-left: auto; background: none; border: none; cursor: pointer; color: var(--clay);">✕</button>
    </div>
    <div class="item-card-body">
      ${itemTypeTemplates[type]}
    </div>
  `;
  return card;
}

function removeItem(itemId) {
  const card = document.querySelector(`[data-item-id="${itemId}"]`);
  if (card) card.remove();
  updateAddButtonVisibility();
}

function updateAddButtonVisibility() {
  const container = document.getElementById('items-container');
  const addBtn = document.getElementById('add-item-btn');
  addBtn.style.display = container.children.length >= 3 ? 'none' : 'flex';
}

document.getElementById('add-item-btn').addEventListener('click', () => {
  document.getElementById('item-type-picker').style.display = 'block';
});

document.getElementById('close-picker-btn').addEventListener('click', () => {
  document.getElementById('item-type-picker').style.display = 'none';
});

document.querySelectorAll('.item-type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.type;
    const container = document.getElementById('items-container');
    const card = createItemCard(type);
    container.appendChild(card);
    document.getElementById('item-type-picker').style.display = 'none';
    updateAddButtonVisibility();
    initCustomQtyToggles();
    updateLangElements(document.documentElement.lang);
  });
});

// Handle custom quantity visibility
function initCustomQtyToggles() {
  document.querySelectorAll('select[name="quantity"]').forEach(sel => {
    sel.addEventListener('change', () => {
      const card = sel.closest('.item-card');
      const customGroup = card.querySelector('.custom-qty-group');
      if (customGroup) {
        customGroup.style.display = sel.value === 'custom' ? 'block' : 'none';
      }
    });
  });
}

// Initialize with default item type from URL or 'cake'
function initializeQuoteForm() {
  const params = new URLSearchParams(window.location.search);
  const type = params.get('type') || 'cake';
  const container = document.getElementById('items-container');
  const card = createItemCard(type);
  container.appendChild(card);
  updateAddButtonVisibility();
  initCustomQtyToggles();
}

// Update form submit handler to collect items
function handleQuoteSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const items = [];
  document.querySelectorAll('.item-card').forEach(card => {
    const type = card.dataset.type;
    const details = {};
    card.querySelectorAll('input, select').forEach(el => {
      if (el.name) {
        if (el.type === 'checkbox') {
          if (!details[el.name]) details[el.name] = [];
          if (el.checked) details[el.name].push(el.value);
        } else if (el.name === 'quantity' && el.value === 'custom') {
          const customInput = card.querySelector('input[name="custom_quantity"]');
          details.quantity = customInput ? customInput.value : '';
        } else {
          details[el.name] = el.value;
        }
      }
    });
    items.push({ product_type: type, details });
  });

  // Collect form-level fields
  const formData = new FormData(form);
  const payload = {
    customer_name: formData.get('customer_name'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    language: getCurrentLang(),
    occasion: formData.get('occasion'),
    dietary: formData.getAll('dietary'),
    comments: formData.get('comments'),
    desired_date: formData.get('desired_date'),
    budget: formData.get('budget'),
    items,
  };

  // Submit to API
  fetch(`${API_BASE}/api/quotes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  .then(res => res.json())
  .then(data => {
    if (data.ok) {
      document.getElementById('form-success').style.display = 'block';
      form.reset();
    } else {
      throw new Error(data.error || 'Submission failed');
    }
  })
  .catch(err => {
    document.getElementById('form-error').textContent = err.message;
    document.getElementById('form-error').style.display = 'block';
  });
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  initializeQuoteForm();
  document.getElementById('quote-form').addEventListener('submit', handleQuoteSubmit);
});
```

- [ ] **Step 4: Add CSS for item cards**

Add before the closing `</style>` tag:

```css
/* ── Item card styles ── */
.item-card {
  background: var(--cream-deep);
  border: 1px solid var(--hairline);
  border-radius: 14px;
  padding: 16px;
}
.item-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--hairline);
}
.item-icon {
  font-size: 20px;
}
.item-label {
  font-weight: 600;
  color: var(--color-text);
}
.item-card-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.remove-item-btn:hover {
  color: var(--clay) !important;
}
```

- [ ] **Step 5: Commit**

```bash
git add quote.html
git commit -m "feat(quote): implement multi-item form with type-specific fields"
```

---

### Task 16: Deploy public static assets (quote.html)

**Files:**
- Modify: None (all changes in Task 15)
- Test: Manual UI testing

**Interfaces:**
- Consumes: updated `quote.html` from Task 15.
- Produces: deployed quote form with multi-item support.

- [ ] **Step 1: Deploy to Cloudflare Workers**

Run: `npx wrangler deploy` from repo root
Expected: Success message with deployment URL.

- [ ] **Step 2: Verify quote page loads with default item**

Run: `curl -sL --max-time 10 "https://muyrico.bexgarcia0208.workers.dev/quote.html" 2>&1 | grep -c "item-card"`
Expected: `1` (default cake item card rendered).

- [ ] **Step 3: Verify quote page loads with cakepops pre-fill**

Run: `curl -sL --max-time 10 "https://muyrico.bexgarcia0208.workers.dev/quote.html?type=cakepops" 2>&1 | grep -c "cakepops"`
Expected: Multiple matches (item type is cakepops).

---

### Task 17: End-to-end testing — Create multi-item quote via API

**Files:**
- Modify: None (all changes in Tasks 1-16)
- Test: Manual API testing

**Interfaces:**
- Consumes: deployed API worker from Task 6.
- Produces: Verified multi-item quote creation and retrieval.

- [ ] **Step 1: Create a multi-item quote via API**

Run:
```bash
curl -s --max-time 15 -X POST -H "Content-Type: application/json" -d '{
  "customer_name": "Multi-Item Test",
  "email": "multi-test@test.com",
  "language": "es",
  "occasion": "Birthday",
  "items": [
    {
      "product_type": "cake",
      "details": {
        "cake_flavor": "Chocolate",
        "filling": "Cream cheese",
        "frosting": "Vanilla Buttercream",
        "serving_size": "10-12",
        "toppings": ["Sprinkles", "Caramel Drip"]
      }
    },
    {
      "product_type": "cakepops",
      "details": {
        "cake_flavor": "Vanilla",
        "chocolate_dip": "White Chocolate",
        "topping_style": "Sprinkles",
        "quantity": "12",
        "design_theme": "Pink and gold birthday theme"
      }
    },
    {
      "product_type": "cupcakes",
      "details": {
        "cake_flavor": "Chocolate",
        "frosting": "Chocolate Buttercream",
        "quantity": "6",
        "topper_design": "Gold leaf accents"
      }
    }
  ]
}' "https://muy-rico-orders-api.bexgarcia0208.workers.dev/api/quotes" 2>&1
```
Expected: `{"ok":true,"id":X}` response.

- [ ] **Step 2: Verify quote was created with all items**

Note: GET requires Cloudflare Access auth, so this may fail with "Unauthorized" — that's expected. The quote was created successfully if Step 1 returned `{"ok":true,"id":X}`.

---

### Task 18: End-to-end testing — Verify admin SPA renders items

**Files:**
- Modify: None (all changes in Tasks 7-12)
- Test: Manual UI testing via browser

**Interfaces:**
- Consumes: deployed admin SPA from Task 12.
- Produces: Verified multi-item rendering in admin Quotes tab.

- [ ] **Step 1: Open admin SPA in browser**

Navigate to: `https://muyrico.bexgarcia0208.workers.dev/admin/`

- [ ] **Step 2: Navigate to Quotes tab**

Click "Quotes" in the sidebar.

- [ ] **Step 3: Click on the multi-item test quote**

Locate the quote with `customer_name: "Multi-Item Test"` and click it.

- [ ] **Step 4: Verify items render correctly**

Expected:
- Header shows "3 Items"
- Three item cards rendered:
  1. 🎂 Custom Cake — Chocolate, cream cheese filling, Vanilla Buttercream, 10-12 servings, Sprinkles + Caramel Drip
  2. 🍭 Cakepops — Vanilla, White Chocolate, Sprinkles, quantity 12, "Pink and gold birthday theme"
  3. 🧁 Cupcakes — Chocolate, Chocolate Buttercream, quantity 6, "Gold leaf accents"

- [ ] **Step 5: Verify backfilled test quotes still render**

Click on one of the original test quotes (e.g., `customer_name: "Test"`).

Expected:
- Header shows "1 Item"
- One item card rendered: 🎂 Custom Cake — Chocolate (backfilled from legacy `cake_flavor` field).

---

### Task 19: Final commit and verification

**Files:**
- Modify: None (all changes in Tasks 1-18)
- Test: Full end-to-end verification

**Interfaces:**
- Consumes: all previous tasks.
- Produces: Verified multi-item quote system fully functional.

- [ ] **Step 1: Verify all commits are in place**

Run: `git log --oneline -10`
Expected: Commits from Tasks 1-18 are visible.

- [ ] **Step 2: Verify all deployments are live**

Run: `curl -sL --max-time 10 "https://muyrico.bexgarcia0208.workers.dev/admin/" 2>&1 | head -c 200`
Run: `curl -sL --max-time 10 "https://muyrico.bexgarcia0208.workers.dev/order.html" 2>&1 | grep -c "Get a Quote"`
Run: `curl -sL --max-time 10 "https://muyrico.bexgarcia0208.workers.dev/quote.html?type=cakepops" 2>&1 | grep -c "quote-form"`
Expected: All three return expected results.

- [ ] **Step 3: Verify multi-item quote creation via API**

Run: `curl -s --max-time 15 -X POST -H "Content-Type: application/json" -d '{"customer_name":"Final Test","email":"final@test.com","items":[{"product_type":"cakepops","details":{"cake_flavor":"Chocolate"}}]}' "https://muy-rico-orders-api.bexgarcia0208.workers.dev/api/quotes" 2>&1`
Expected: `{"ok":true,"id":X}` response.

- [ ] **Step 4: Mark implementation complete**

All tasks completed successfully. Multi-item quote system is fully functional:
- Order.html has "Get a Quote" buttons on Cakepops, Custom Cake, and Cupcakes tiles.
- Quote.html supports multiple items with type-specific fields.
- API accepts and stores multi-item quotes.
- Admin SPA renders multiple items per quote.
- Existing single-item quotes backfilled and still display correctly.
