# Multi-Item Cake Quote System

**Date:** 2026-07-30
**Status:** Approved — transitioning to implementation planning
**Supersedes:** Single-item quote form shipped in `fc8b5bf` (cake quote system)

## Goal

Customer can quote one OR multiple product types in a single quote submission, with type-specific fields per item. Quote buttons appear on `order.html` product tiles for the three customizable products (Custom Cake, Cakepops, Cupcakes).

## Context

The original quote form (shipped 2026-07-29) assumed a single Custom Cake per quote. The user wants:
- Quote buttons on the Cakepops and Cupcakes tiles on `order.html` (not just the Custom Cake entry).
- A single quote submission can request multiple product types — e.g., one quote covering a cake + matching cakepops + cupcakes for the same event.
- Each item shows only the fields relevant to its product type (cake has "servings"; cakepops have "chocolate dip + topping style + quantity"; cupcakes have "topper design + quantity").

## Scope

### In scope
- `order.html`: "Get a Quote" secondary button on 3 product tiles.
- `quote.html`: multi-item form with type-specific fields, "+ Add another item" flow, URL pre-fill via `?type=`.
- D1 migration: new `cake_quote_items` table + backfill of existing quotes.
- `orders/workers/api.js`: `createQuote` accepts items array; `getQuote` / `listQuotes` return items; `convertQuote` builds order line items from each quote item.
- Admin SPA (`Quotes.tsx`, `types.ts`, `api.ts`, `StoreContext`): render multiple items; updated `QuoteConvertModal` that builds line items per product type.
- Notification + auto-reply emails: render per-item rows.

### Out of scope
- Homepage (`index.html`) oven cards — no quote buttons added there.
- Quote buttons on non-customizable products (Conchas, Cookies, Empanadas, Bolillos, Tortillas, Cinnamon Rolls, Coqui Pie).
- Deposit / convert flow mechanics — unchanged. Still requires `quoted_price` on the parent quote.
- Admin auth, R2 upload endpoint, stats endpoint.
- New admin page for items — items render inside the existing quote detail panel.

## Design

### 1. `order.html` — Quote buttons on tiles

For the 3 quoteable product tiles (`#tile-prod_custom_cake`, `#tile-prod_cakepop`, `#tile-prod_cupcakes`), add a secondary **"Get a Quote"** button next to the existing "Add" button in `.tile-actions`:

```
[ qty stepper ] [ Add ]  [ Get a Quote → ]
```

Clicking it opens `quote.html?type=cake` (or `?type=cakepops` / `?type=cupcakes`), pre-filling the form with that item section. The button uses `btn-ghost` styling that doesn't compete with the primary "Add" CTA. The other non-quoteable tiles keep only "Add to Cart."

The existing "Need a custom cake?" CTA band below the menu stays as the generic entry point (opens `quote.html` with no pre-fill, defaults to one Custom Cake item).

### 2. `quote.html` — Multi-item form

Replace the single "Cake Details" section with a dynamic **Items** section.

**Initial state:**
- `?type=cakepops` → loads with one Cakepops item section.
- `?type=cupcakes` → loads with one Cupcakes item section.
- No `?type` → loads with one Custom Cake item section (default).

Each item is a collapsible card with a header showing the product type icon + label + remove button (shown only when >1 item). Below the header, fields render **based on product type**:

**Custom Cake fields:**
- `cake_flavor` * (text)
- `filling` (text)
- `frosting` (text)
- `serving_size` (select: 6-8 / 10-12 / 15-20 / 20-30 / 30+)
- `toppings` checkbox grid (same options as today)
- `reference_image` (file upload) — per-item

**Cakepops fields:**
- `cake_flavor` * (select: Chocolate / Vanilla)
- `chocolate_dip` (select: Milk / White)
- `topping_style` (select: Marble / Sprinkles / Chocolate Drizzle / Chocolate Accessories / Fondant Accessories)
- `quantity` (select: 6 / 12 / 24 / Custom [text])
- `design_theme` (text — e.g., "Birthday sprinkles in pink/gold")
- `reference_image` — per-item

**Cupcakes fields:**
- `cake_flavor` * (select: Chocolate / Vanilla)
- `frosting` * (select: Vanilla Buttercream / Chocolate Buttercream)
- `quantity` (select: 6 / 12 / 24 / Custom [text])
- `topper_design` (text — e.g., "Floral with gold leaf")
- `reference_image` — per-item

**Form-level fields (not per-item):**
- Dietary restrictions checkboxes (applies to the whole order).
- Comments, desired date, budget.
- Customer info (name, email, phone).

**"+ Add another item"** button at the bottom of the items list. Clicking shows a small product-type picker (Cake / Cakepops / Cupcakes) and appends another item section below the existing ones.

### 3. Data model — D1 migration

Current `cake_quotes` has single-item columns (`cake_flavor`, `filling`, etc.). Add a new `cake_quote_items` table and backfill the existing single-item rows into it.

```sql
-- 0026_cake_quote_items.sql
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

-- Backfill existing rows into the new items table (idempotent)
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
  FROM cake_quotes WHERE cake_flavor IS NOT NULL
  AND id NOT IN (SELECT quote_id FROM cake_quote_items);
```

**`cake_quotes` parent table keeps:**
- Order-level fields: `customer_name`, `email`, `phone`, `language`, `occasion`, `desired_date`, `budget`, `comments`, `dietary`, `status`, `quoted_price`, `admin_notes`, `converted_order_id`, `created_at`, `updated_at`.
- Legacy single-item columns (`cake_flavor`, `filling`, `frosting`, `serving_size`, `toppings`, `reference_image_url`) **remain** for back-compat. New inserts still populate `cake_flavor` on the parent row from `items[0].details.cake_flavor` so existing admin lookup queries and stats continue to work.

### 4. API changes (`orders/workers/api.js`)

**`createQuote` (POST `/api/quotes`):**
- Accept `items: [{ product_type, details, reference_image_url }]` array (required, non-empty).
- Still require `customer_name` + `email`.
- Insert parent row into `cake_quotes` with order-level fields; populate `cake_flavor` from `items[0].details.cake_flavor` for back-compat.
- Insert each item into `cake_quote_items` with `sort_order` = array index.
- Validation: reject if `items` is empty or has unknown `product_type`.

**`getQuote` / `listQuotes`:**
- Join `cake_quote_items` and return `items: [...]` in each quote object.
- If a quote has legacy single-item columns but no rows in `cake_quote_items` (defensive — should not happen after backfill), synthesize `items: [{ product_type: 'cake', details: {...} }]` from the parent row's legacy fields.

**`updateQuote`:**
- Still updates order-level fields on the parent row (`quoted_price`, `admin_notes`, `status`).
- No changes to item editing — items are immutable post-submit (customer meant what they asked for).

**`convertQuote`:**
- Build order line items based on each quote item's `product_type`:
  - `cake` → 1 order line item, name like `Custom Cake — {cake_flavor}`, quantity 1.
  - `cakepops` → 1 line item per quote item, name like `Cakepops ({dip}, {topping_style}) ×{quantity}`, quantity = `quantity`.
  - `cupcakes` → 1 line item per quote item, name like `Cupcakes ({frosting}) ×{quantity}`, quantity = `quantity`.
- Deposit logic unchanged: still requires `quoted_price` set on the parent quote. The order total = `quoted_price`.
- Link `converted_order_id` on parent quote (existing behavior).

**Notification emails:**
- Admin notification: render each item as its own row.
  - `🍰 Custom Cake — Chocolate, cream cheese filling, 10-12 servings`
  - `🍭 Cakepops ×24 — Vanilla, white chocolate, sprinkles`
  - `🧁 Cupcakes ×12 — Vanilla, vanilla buttercream, floral topper`
- Customer auto-reply: list items similarly (bilingual).

### 5. Admin SPA changes

**`types.ts`:**
```ts
export interface QuoteItem {
  id: number;
  product_type: 'cake' | 'cakepops' | 'cupcakes';
  details: Record<string, any>;
  reference_image_url?: string | null;
}
export interface Quote {
  // ...existing fields...
  items: QuoteItem[];
}
```

**`api.ts` — `ApiQuote` interface:**
- Add `items?: ApiQuoteItem[]` for raw wire format.
- `ApiQuote` items map 1:1 to `QuoteItem`.

**`StoreContext`:**
- Normalize `items` through; if missing, synthesize from legacy fields like the API does defensively.

**`Quotes.tsx`:**
- Detail panel renders `selected.items` array.
- Each item shows product-type icon (uses `ProductIcon` — see existing variants) + label + its fields rendered as chips/rows.
- If only 1 item, layout similar to today. If multiple, each item is a numbered card.
- Existing single-item test quotes (3 created earlier) display correctly because backfill populates `cake_quote_items` with `product_type: 'cake'`.

**`QuoteConvertModal.tsx`:**
- Reads each item and builds order line items per the convert rules above.
- Shows a summary list to admin before confirming conversion (visual review).

### 6. URL routing + cache

- `quote.html?type=cakepops` — Workers Static Assets serves `quote.html` at `/quote?type=...`. Query string doesn't affect routing (verified — same pretty-URL redirect pattern works for `order.html#...`).
- Add `Cache-Control: no-cache` meta hint or set it via the Worker's `_headers` file so the first deploy doesn't require user to hard-refresh.
- Add a `_headers` entry for `/quote*` → `Cache-Control: no-cache` if not already present.

## Migration safety

- `cake_quotes` columns kept → existing admin SPA builds still work if you don't rebuild immediately.
- Backfill migration is idempotent (`id NOT IN (SELECT quote_id FROM cake_quote_items)` guard prevents duplicates on rerun).
- API worker + admin SPA deploy independently.
- Defensive: if a v2 admin SPA hits a v1 API, `items` is just missing; the SPA synthesizes one cake item from legacy fields. If a v1 admin SPA hits a v2 API, it ignores `items` and reads legacy fields (which still get populated for back-compat).
- The 3 existing test quotes survive migration — backfill writes them into `cake_quote_items` so they render correctly in the new admin SPA.

## Verification

1. Apply migration `0026_cake_quote_items.sql` to remote D1.
2. Verify backfill: `SELECT COUNT(*) FROM cake_quote_items` should equal `SELECT COUNT(*) FROM cake_quotes WHERE cake_flavor IS NOT NULL` (currently 3-4 test quotes).
3. Deploy API worker. Hit `POST /api/quotes` with a multi-item body; verify `GET /api/quotes/:id` returns `items` array.
4. Build admin SPA. Load `/admin/` → Quotes tab. Click each existing test quote and verify it displays as a single cake item (backfill worked).
5. Deploy static assets (`npx wrangler deploy` from root).
6. Visit `https://muy-rico.com/order` → confirm "Get a Quote" button appears on Custom Cake, Cakepops, Cupcakes tiles only.
7. Click "Get a Quote" on Cakepops tile → `quote.html?type=cakepops` loads with a Cakepops item section.
8. Click "+ Add another item" → picker appears; select Cupcakes → second item section appended.
9. Fill and submit → verify in admin Quotes tab that both items render.
10. Click Convert to Order → verify order line items built correctly (1 cake line + 1 cakepops line ×24 + 1 cupcakes line ×12).
