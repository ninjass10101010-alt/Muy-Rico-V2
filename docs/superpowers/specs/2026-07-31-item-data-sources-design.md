# Item Data Sources — Design

**Date:** 2026-07-31
**Status:** Approved (user greenlit the two-source free-tier recommendation)
**Depends on:** existing Orders Worker + D1 (`muy-rico-orders`), admin SPA, scan modal (`prod_mrwvp8n0` etc.)

## 1. Goal

Auto-fill inventory item data (name, ingredients, allergens, unit weight, supplier) from authoritative web sources so the bakery doesn't have to type it all by hand for each ingredient and each scanned supplier package.

## 2. Non-goals (this phase)

- Any paid data source (Edamam / FatSecret / Upcitemdb). Re-evaluate in 3–6 months based on measured coverage.
- Bulk import / scraping. All calls are on-demand with results cached in our D1.
- Auto-submit products back to Open Food Facts. We can add later if gaps are an issue.
- Image storage beyond what the scan modal already handles (R2 caching deferred; we display OFF's CDN URL with attribution).

## 3. Architecture fit (verified)

- **Worker outbound `fetch`** — Cloudflare Workers allow `fetch()` to any URL out of the box. Verified by querying live USDA + OFF endpoints in this session.
- **Inventory schema** (`orders/migrations/0004_inventory.sql`) already has the target fields: `name`, `supplier`, `ingredients_label`, `allergens` (JSON), `unit_weight`. New cache columns are additive.
- **Scan modal** (`home-bakery-management-system/src/components/ScanModal.tsx`) already has a "bind" flow when a code isn't recognized — we'll add an "Auto-fill from package" step before the count stepper.
- **Auth** — both new endpoints sit behind the existing admin Access gate.

## 4. Sources

| Source | Cost | Coverage | Use |
|---|---|---|---|
| **USDA FoodData Central** | Free, CC0 public domain, 1,000 req/hr per IP (or 30/hr with DEMO_KEY) | Generic ingredients (Foundation + SR Legacy + Survey). No UPC. | "Auto-fill from USDA" on the inventory edit modal — typeahead by name |
| **Open Food Facts** | Free, ODbL + CC BY-SA (images), 15 req/min/IP read | Branded products with UPCs. 90%+ coverage globally; spottier for US-only brands. | "Auto-fill from package" after scanning a new barcode — lookup by code |

Both allow caching results in our DB. No scrapers, no mirrors.

## 5. Data model

**Migration `orders/migrations/0031_inventory_enrich_cache.sql`** — additive columns to track the source of cached data:

```sql
ALTER TABLE inventory ADD COLUMN nutrition_source TEXT;     -- 'fdc:2490378' or 'off:0737628064502'
ALTER TABLE inventory ADD COLUMN nutrition_fetched_at TEXT; -- ISO 8601 UTC
```

These let us re-fetch when the upstream data improves, and show provenance on the inventory page ("Filled from USDA FoodData Central on 2026-07-31").

## 6. Worker API

### 6a. USDA endpoint

`GET /api/inventory/lookup-ingredient?q=<text>&limit=5` → array of `{fdcId, name, dataType, ingredients, foodCategory, nutrients}` candidates. Admin-only.

- Calls `https://api.nal.usda.gov/fdc/v1/foods/search?query=<text>&pageSize=<limit>&api_key=<USDA_KEY>`
- `USDA_KEY` is a Cloudflare Worker secret (`wrangler secret put USDA_KEY`). Falls back to `DEMO_KEY` for local dev with a `X-Data-Source: demo` header in the response so the UI can warn about rate limits.
- Filters out `Branded` data type (we want generic ingredients from USDA) unless the query is very specific — surfaced as a header the SPA can use.
- Caches the JSON in the worker module (in-memory LRU, ~50 entries, 5-min TTL) so repeated edits to the same ingredient don't re-hit USDA.
- Returns 200 with `{candidates: [...]}` or 400 (missing q).

### 6b. Open Food Facts endpoint

`GET /api/inventory/enrich?code=<barcode>` → `{source: 'off', product: {name, brand, ingredients, allergens, quantity, imageUrl}}` or `null` on miss. Admin-only.

- Calls `https://world.openfoodfacts.org/api/v3/product/<code>.json` with a custom User-Agent: `MuyRico/1.0 (contact@muy-rico.com)`.
- Returns 200 + `{source: 'off', product: {...}}` on hit, 200 + `{source: 'off', product: null}` on miss (so the SPA can show "not in Open Food Facts" without it being an error).
- 3-second fetch timeout.
- Maps OFF fields → inventory columns:
  - `product_name` → `name`
  - `brands` (first brand) → `supplier`
  - `ingredients_text_en` ?? `ingredients_text` → `ingredients_label`
  - `allergens_tags` (e.g. `["en:milk","en:wheat"]`) → JSON array, normalized to your existing tags (`Milk`, `Wheat`, …)
  - `quantity` + `quantity_unit` → `unit` + parsed `unit_weight` (lb)

### 6c. No new write endpoints

The SPA's existing PATCH `/api/inventory/:id` writes the values the user picks. No new worker writes.

## 7. SPA changes

### 7a. Inventory edit modal — "Auto-fill from USDA"

Add a "🔎 Find ingredient data" button above the `ingredients_label` field. Clicking opens a small search sub-panel:

1. Input field pre-filled with the current `name`.
2. Calls `GET /api/inventory/lookup-ingredient?q=<name>`.
3. Shows up to 5 candidates (name, data type, category) — each clickable to select.
4. On select: pre-fills `ingredients_label`, `allergens` (parsed from the food category), `unit_weight` (best-effort from food portion data).
5. Sets `nutrition_source = 'fdc:<fdcId>'` and `nutrition_fetched_at = now()` so the SPA shows a small "Filled from USDA · <date>" pill.

The user can still edit anything before saving. No silent overwrites.

### 7b. Scan modal — "Auto-fill from package"

Modify the bind flow (`ScanModal.tsx`). After the user picks an item to bind a new code to, and BEFORE entering the count stepper:

1. Automatically call `GET /api/inventory/enrich?code=<code>`.
2. If hit: show a one-line preview ("King Arthur · 100% Whole Wheat · Contains: Wheat"). User clicks "Use this info" → pre-fills `ingredients_label`, `allergens`, `supplier`, `unit_weight`. Then proceeds to count.
3. If miss: skip the preview and go straight to count (current behavior).

### 7c. Type safety

Add `nutrition_source` and `nutrition_fetched_at` to `ApiInventoryItem`, `InventoryItem` type, and the create/update payload.

## 8. Bundle / dependency impact

- No new npm dependencies. We use `fetch` (browser-native) and the existing UI components.
- The Admin SPA bundle is unchanged in size; both new SPA components are small.

## 9. Deployment

1. `wrangler secret put USDA_KEY --name muy-rico-orders-api` (the owner gets a free key from `fdc.nal.usda.gov/api-key-signup/`, free, instant).
2. `wrangler d1 execute muy-rico-orders --remote --file=orders/migrations/0031_inventory_enrich_cache.sql`
3. `wrangler deploy -c orders/wrangler.toml` (worker has the new endpoints)
4. `home-bakery-management-system && npm install && npm run build` → `postbuild.sh` → `wrangler versions upload` → `deploy`.

## 10. Verification plan

- **Unit (Vitest):** USDA response → candidate shape; OFF hit → inventory field mapping; OFF miss → `{product: null}`. Cache layer TTL math.
- **Worker smoke test (local wrangler dev):**
  - `GET /api/inventory/lookup-ingredient?q=all-purpose+flour` → 200 with candidates
  - `GET /api/inventory/lookup-ingredient?q=` → 400
  - `GET /api/inventory/enrich?code=0737628064502` (real King Arthur UPC) → 200 + product or 200 + null
  - `GET /api/inventory/enrich?code=0000000000000` → 200 + null
- **End-to-end (Playwright):**
  - Open admin → Inventory → edit an existing item → click "Find ingredient data" → results appear → select → fields populate → save → reload and verify DB row updated (via wrangler d1 execute --remote SELECT).
  - Scan modal: simulate scanning a new UPC (programmatically call the camera-decoded path with a real UPC) → see preview → apply → verify DB row updated.
- **License compliance:** confirm OFF product images are NOT auto-downloaded into R2 (we display their CDN URL with attribution in alt text).

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Worker outbound IP rate-limited by OFF (15/min) | Sequential calls; admin-only; if hit, fall back to "type manually" UX |
| USDA DEMO_KEY only 30 req/hr | Owner sets USDA_KEY secret; fallback warning if DEMO_KEY in use |
| OFF US coverage gap | Document expected hit rate (~60–70% for US branded items); fall through to manual entry cleanly |
| Caching stale data | `nutrition_fetched_at` timestamp visible; "Refetch" button next to the source pill re-runs the lookup and offers the new fields |
| Free-tier changes / API drift | Wrapper functions isolate the API shape; only the wrapper needs updating if USDA or OFF change |

## 12. Out of scope / later

- Edamam ($14/mo) if OFF coverage gap proves painful after 3–6 months.
- Image storage in R2 (currently display OFF CDN URL with attribution).
- Submitting missing products back to OFF.
- Nutrition display on the customer-facing order page.
