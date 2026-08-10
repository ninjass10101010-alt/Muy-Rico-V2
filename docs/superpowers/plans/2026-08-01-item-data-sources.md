# Item Data Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-fill inventory item data (name, ingredients, allergens, unit weight, supplier) from USDA FoodData Central and Open Food Facts so the bakery doesn't type it by hand.

**Architecture:** Pure mapping/cache logic in a new testable module `orders/workers/enrich-lib.js`, consumed by two admin-only Worker endpoints (`/api/inventory/lookup-ingredient` USDA, `/api/inventory/enrich` OFF). The SPA calls these from the inventory edit modal (USDA typeahead) and the scan modal bind flow (OFF barcode preview). Provenance columns `nutrition_source` / `nutrition_fetched_at` are added to the existing `inventory` table via migration 0031 and written through the existing PATCH `/api/inventory/:id`.

**Tech Stack:** Cloudflare Worker (plain JS, D1, outbound `fetch`), USDA FoodData Central v1 REST, Open Food Facts v3 REST, React SPA (fetch only — no new bundle deps), Vitest (dev-only, new harness under `orders/`).

## Global Constraints

- No new SPA bundle dependencies — use browser `fetch` and existing UI components (spec §8).
- No new Worker write endpoints — existing PATCH `/api/inventory/:id` writes everything (spec §6c).
- Both new endpoints are admin-only: they sit behind the existing `actorEmail` gate (`api.js:106`) like all inventory routes — never add to a public allowlist.
- OFF: custom User-Agent `MuyRico/1.0 (contact@muy-rico.com)`, 3-second fetch timeout, miss returns 200 + `{source:'off', product:null}` (NOT an error), product images displayed via OFF CDN URL — never downloaded into R2 (spec §6b, §10).
- USDA: `env.USDA_KEY` secret with `DEMO_KEY` fallback; when the fallback is used, respond with `X-Data-Source: demo` header so the UI can warn (spec §6a).
- USDA results cached in an in-memory LRU, ~50 entries, 5-min TTL (spec §6a).
- Provenance: `nutrition_source` values are exactly `fdc:<fdcId>` or `off:<barcode>`; `nutrition_fetched_at` is ISO 8601 UTC (spec §5).
- No silent overwrites — the user clicks "Use this info" / selects a candidate before any field is applied (spec §7).
- Allergen tags normalized to the bakery's canonical list: `Milk, Eggs, Wheat, Gluten, Soy, Peanuts, Tree Nuts, Fish, Shellfish, Mollusks, Sesame, Celery, Mustard, Lupin`. Unknown/too-specific OFF tags are dropped (conservative — no false allergen claims).
- USDA allergen hints come from `foodCategory` only when an obvious match exists; never invent allergens (spec §7a step 4).
- Do NOT touch unrelated uncommitted WIP in the working tree: `admin/index.html`, `src/pages/LabelDesigner.tsx`, `src/pages/Orders.tsx`, `src/utils/compliance.ts`, `src/utils/compliance.test.ts`, `src/utils/labelExport.ts`, `orders/workers/customer-match.js`. Whole-file commits only for files this plan touches (repo convention from `docs/superpowers/plans/2026-08-01-delete-quotes.md`).
- TypeScript: `npx tsc --noEmit` baseline is ~115 pre-existing errors (WIP); this plan adds 0 new errors.
- Spec §10 e2e via Playwright is deferred (no Playwright harness exists in the repo); verification is Vitest + `wrangler dev` curl smoke tests + build, per repo convention (delete-quotes plan verified the same way).

---

### Task 1: Pure logic module `orders/workers/enrich-lib.js` + Vitest harness

**Files:**
- Create: `orders/package.json`
- Create: `orders/workers/enrich-lib.js`
- Create: `orders/tests/enrich-lib.test.js`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (all named exports, used by Task 2):
  - `createLruCache(max, ttlMs) -> { get(key) -> value|undefined, set(key, value), clear() }`
  - `normalizeAllergenTags(tags: string[]) -> string[]`
  - `parseQuantityToLb(value: number|string, unit: string) -> number|null`
  - `mapOffProduct(product: object) -> {name, brand, ingredients, allergens, quantity, unitWeightLb, imageUrl} | null`
  - `usdaCandidatesFromResponse(data: object) -> Array<{fdcId, name, dataType, ingredients, foodCategory, portionGramWeight, per100g, allergenHints}>`
  - `categoryAllergenHints(foodCategory: string|null) -> string[]`

- [ ] **Step 1: Create `orders/package.json`**

```json
{
  "name": "muy-rico-orders-worker",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^4.1.10"
  }
}
```

- [ ] **Step 2: Install dev dependencies**

Run: `npm install` (workdir `orders/`)
Expected: creates `orders/node_modules` + `orders/package-lock.json`. Do NOT commit `orders/node_modules` (root `.gitignore` should already cover it — verify with `git status`).

- [ ] **Step 3: Write the failing test file `orders/tests/enrich-lib.test.js`**

```js
import { describe, it, expect } from "vitest";
import {
  createLruCache,
  normalizeAllergenTags,
  parseQuantityToLb,
  mapOffProduct,
  usdaCandidatesFromResponse,
  categoryAllergenHints,
} from "../workers/enrich-lib.js";

describe("normalizeAllergenTags", () => {
  it("maps known en: tags to canonical labels and drops unknown ones", () => {
    expect(normalizeAllergenTags(["en:milk", "en:wheat", "en:soybeans", "en:some-unknown"])).toEqual([
      "Milk",
      "Wheat",
      "Soy",
    ]);
  });
  it("dedupes and returns [] for empty input", () => {
    expect(normalizeAllergenTags(["en:milk", "en:milk", "en:soybeans"])).toEqual(["Milk", "Soy"]);
    expect(normalizeAllergenTags([])).toEqual([]);
  });
});

describe("parseQuantityToLb", () => {
  it("converts g, kg, oz, lb", () => {
    expect(parseQuantityToLb(500, "g")).toBeCloseTo(500 / 453.59237, 6);
    expect(parseQuantityToLb(2, "kg")).toBeCloseTo(2000 / 453.59237, 6);
    expect(parseQuantityToLb(16, "oz")).toBeCloseTo(1, 6);
    expect(parseQuantityToLb(1, "lb")).toBeCloseTo(1, 6);
  });
  it("returns null for unsupported units, non-positive, or invalid values", () => {
    expect(parseQuantityToLb(500, "ml")).toBeNull();
    expect(parseQuantityToLb(0, "g")).toBeNull();
    expect(parseQuantityToLb(NaN, "g")).toBeNull();
    expect(parseQuantityToLb(5, "")).toBeNull();
  });
});

describe("mapOffProduct", () => {
  it("maps a full product with quantity_value/quantity_unit", () => {
    const out = mapOffProduct({
      product_name: "100% Whole Wheat Flour",
      product_name_en: "100% Whole Wheat Flour",
      brands: "King Arthur, Other",
      ingredients_text_en: "whole wheat flour",
      ingredients_text: "farine de blé entier",
      allergens_tags: ["en:milk", "en:wheat"],
      quantity_value: 500,
      quantity_unit: "g",
      quantity: "500 g",
      image_front_url: "https://images.openfoodfacts.org/1.jpg",
    });
    expect(out).toEqual({
      name: "100% Whole Wheat Flour",
      brand: "King Arthur",
      ingredients: "whole wheat flour",
      allergens: ["Milk", "Wheat"],
      quantity: "500 g",
      unitWeightLb: 500 / 453.59237,
      imageUrl: "https://images.openfoodfacts.org/1.jpg",
    });
  });
  it("falls back to parsing the quantity string when value/unit are absent", () => {
    const out = mapOffProduct({ product_name: "Butter", quantity: "16 oz" });
    expect(out.unitWeightLb).toBeCloseTo(1, 6);
  });
  it("returns null when there is no product name or the input is null", () => {
    expect(mapOffProduct({ brands: "X" })).toBeNull();
    expect(mapOffProduct(null)).toBeNull();
  });
});

describe("usdaCandidatesFromResponse", () => {
  const sample = {
    foods: [
      {
        fdcId: 2490378,
        description: "Wheat flour, white, all-purpose",
        dataType: "Foundation",
        foodCategory: "Cereal Grains and Pasta",
        ingredients: null,
        foodPortions: [{ portionDescription: "cup", gramWeight: 125 }],
        foodNutrients: [
          { nutrientName: "Energy", value: 364 },
          { nutrientName: "Protein", value: 10.33 },
          { nutrientName: "Carbohydrate, by difference", value: 76.31 },
          { nutrientName: "Total lipid (fat)", value: 0.98 },
        ],
      },
      { fdcId: 2, description: "Branded flour", dataType: "Branded", foodCategory: null, foodPortions: [], foodNutrients: [] },
    ],
  };
  it("drops Branded items and maps candidate fields", () => {
    const out = usdaCandidatesFromResponse(sample);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      fdcId: 2490378,
      name: "Wheat flour, white, all-purpose",
      dataType: "Foundation",
      foodCategory: "Cereal Grains and Pasta",
      portionGramWeight: 125,
      allergenHints: ["Wheat"],
      per100g: { energy: 364, protein: 10.33, carbs: 76.31, fat: 0.98 },
    });
  });
  it("returns [] for a malformed response", () => {
    expect(usdaCandidatesFromResponse({})).toEqual([]);
    expect(usdaCandidatesFromResponse(null)).toEqual([]);
  });
});

describe("categoryAllergenHints", () => {
  it("maps obvious categories only", () => {
    expect(categoryAllergenHints("Cereal Grains and Pasta")).toEqual(["Wheat"]);
    expect(categoryAllergenHints("Milk and Milk Products")).toEqual(["Milk"]);
    expect(categoryAllergenHints("Legumes and Legume Products")).toEqual([]);
    expect(categoryAllergenHints(null)).toEqual([]);
  });
});

describe("createLruCache", () => {
  it("stores and returns values, refreshing recency on get", () => {
    const c = createLruCache(2, 60000);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3); // evicts "a"
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
    c.get("b");
    c.set("d", 4); // evicts "c", "b" survives
    expect(c.get("c")).toBeUndefined();
    expect(c.get("b")).toBe(2);
  });
  it("expires entries after ttlMs", async () => {
    const c = createLruCache(10, 20);
    c.set("a", 1);
    await new Promise((r) => setTimeout(r, 40));
    expect(c.get("a")).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test` (workdir `orders`)
Expected: FAIL — `Cannot find module '../workers/enrich-lib.js'` (module doesn't exist yet)

- [ ] **Step 5: Write minimal implementation `orders/workers/enrich-lib.js`**

```js
// Pure helpers shared by the USDA FoodData Central and Open Food Facts lookups.
// No Worker/IO dependencies — kept separate so the mapping logic is unit-testable.

const G_PER_LB = 453.59237;

// en: tags seen on Open Food Facts → canonical bakery allergen labels.
// Unknown / overly-specific tags (e.g. en:almonds) are dropped: OFF also emits
// the umbrella tag (en:nuts), so dropping keeps claims conservative.
const OFF_ALLERGEN_MAP = {
  'en:milk': 'Milk',
  'en:eggs': 'Eggs',
  'en:wheat': 'Wheat',
  'en:gluten': 'Gluten',
  'en:soy': 'Soy',
  'en:soybeans': 'Soy',
  'en:peanuts': 'Peanuts',
  'en:nuts': 'Tree Nuts',
  'en:tree-nuts': 'Tree Nuts',
  'en:fish': 'Fish',
  'en:crustaceans': 'Shellfish',
  'en:molluscs': 'Mollusks',
  'en:sesame': 'Sesame',
  'en:celery': 'Celery',
  'en:mustard': 'Mustard',
  'en:lupin': 'Lupin',
};

// USDA foodCategory → allergen hints. Most specific rules first. Only fire on
// an obvious textual match — never guess on ambiguous categories.
const CATEGORY_ALLERGEN_RULES = [
  { match: /milk products|dairy|cheese|yogurt|butter|cream/i, tag: 'Milk' },
  { match: /cereal grains|pasta|flour|bread|wheat/i, tag: 'Wheat' },
  { match: /\beggs?\b/i, tag: 'Eggs' },
  { match: /soy/i, tag: 'Soy' },
  { match: /peanut/i, tag: 'Peanuts' },
  { match: /\btree nuts?\b|almond|cashew|pistachio|walnut|pecan|hazelnut|macadamia/i, tag: 'Tree Nuts' },
  { match: /shellfish|crustacean|shrimp|crab|lobster/i, tag: 'Shellfish' },
  { match: /fish|seafood/i, tag: 'Fish' },
  { match: /sesame/i, tag: 'Sesame' },
  { match: /mustard/i, tag: 'Mustard' },
  { match: /celery/i, tag: 'Celery' },
];

export function normalizeAllergenTags(tags) {
  const out = [];
  for (const t of tags) {
    const tag = typeof t === 'string' ? t.trim().toLowerCase() : '';
    const canonical = OFF_ALLERGEN_MAP[tag];
    if (canonical && !out.includes(canonical)) out.push(canonical);
  }
  return out;
}

export function parseQuantityToLb(value, unit) {
  const v = typeof value === 'string' ? parseFloat(value) : value;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  const u = String(unit || '').trim().toLowerCase();
  if (u === 'g' || u === 'gram' || u === 'grams') return v / G_PER_LB;
  if (u === 'kg' || u === 'kilogram' || u === 'kilograms') return (v * 1000) / G_PER_LB;
  if (u === 'oz' || u === 'ounce' || u === 'ounces') return v * 0.0625;
  if (u === 'lb' || u === 'lbs' || u === 'pound' || u === 'pounds') return v;
  return null;
}

export function categoryAllergenHints(foodCategory) {
  if (!foodCategory) return [];
  const c = String(foodCategory);
  const out = [];
  for (const rule of CATEGORY_ALLERGEN_RULES) {
    if (rule.match.test(c) && !out.includes(rule.tag)) out.push(rule.tag);
  }
  return out;
}

// Map an Open Food Facts v3 product payload to our inventory fields.
// Returns null when there is nothing usable (no product name).
export function mapOffProduct(p) {
  if (!p || typeof p !== 'object') return null;
  const name = p.product_name || p.product_name_en || null;
  if (!name) return null;

  const brands = typeof p.brands === 'string'
    ? p.brands.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  let unitWeightLb = null;
  if (typeof p.quantity_value === 'number' && typeof p.quantity_unit === 'string') {
    unitWeightLb = parseQuantityToLb(p.quantity_value, p.quantity_unit);
  }
  if (unitWeightLb === null && typeof p.quantity === 'string') {
    const m = p.quantity.match(/^([\d.,]+)\s*([a-zA-Z]+)$/);
    if (m) {
      const v = parseFloat(m[1].replace(/,/g, '.'));
      if (Number.isFinite(v)) unitWeightLb = parseQuantityToLb(v, m[2]);
    }
  }

  return {
    name,
    brand: brands[0] || null,
    ingredients: p.ingredients_text_en || p.ingredients_text || null,
    allergens: normalizeAllergenTags(Array.isArray(p.allergens_tags) ? p.allergens_tags : []),
    quantity: typeof p.quantity === 'string' ? p.quantity : null,
    unitWeightLb,
    imageUrl: p.image_front_url || p.image_url || null,
  };
}

const NUTRIENT_PICKS = {
  Energy: 'energy',
  Protein: 'protein',
  'Carbohydrate, by difference': 'carbs',
  'Total lipid (fat)': 'fat',
};

// Map a USDA FoodData Central search response to compact candidates.
// Branded items are filtered out (we want generic ingredients, spec §6a).
export function usdaCandidatesFromResponse(data) {
  const foods = data && Array.isArray(data.foods) ? data.foods : [];
  const out = [];
  for (const f of foods) {
    if (!f || f.dataType === 'Branded') continue;
    const portion = Array.isArray(f.foodPortions)
      ? f.foodPortions.find((p) => p && typeof p.gramWeight === 'number' && p.gramWeight > 0)
      : null;
    const per100g = {};
    if (Array.isArray(f.foodNutrients)) {
      for (const n of f.foodNutrients) {
        if (!n || typeof n.value !== 'number') continue;
        const key = NUTRIENT_PICKS[n.nutrientName];
        if (key) per100g[key] = n.value;
      }
    }
    out.push({
      fdcId: f.fdcId,
      name: f.description || '',
      dataType: f.dataType || '',
      ingredients: f.ingredients || null,
      foodCategory: f.foodCategory || null,
      portionGramWeight: portion ? portion.gramWeight : null,
      per100g: Object.keys(per100g).length ? per100g : null,
      allergenHints: categoryAllergenHints(f.foodCategory),
    });
  }
  return out;
}

// Simple LRU with TTL. `map` keeps insertion order; get() re-inserts to
// refresh recency, set() evicts the oldest entry past `max`.
export function createLruCache(max = 50, ttlMs = 5 * 60 * 1000) {
  const map = new Map();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return undefined;
      if (hit.exp <= Date.now()) {
        map.delete(key);
        return undefined;
      }
      map.delete(key);
      map.set(key, hit);
      return hit.value;
    },
    set(key, value) {
      if (map.has(key)) map.delete(key);
      map.set(key, { value, exp: Date.now() + ttlMs });
      while (map.size > max) {
        const oldest = map.keys().next().value;
        map.delete(oldest);
      }
    },
    clear() {
      map.clear();
    },
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test` (workdir `orders`)
Expected: PASS (all describe blocks green)

- [ ] **Step 7: Commit**

```bash
git add orders/package.json orders/package-lock.json orders/workers/enrich-lib.js orders/tests/enrich-lib.test.js
git commit -m "feat(inventory): enrich-lib with USDA/OFF mapping + LRU cache (unit tests)"
```

---

### Task 2: Worker endpoints + provenance fields

**Files:**
- Modify: `orders/workers/api.js` — import (line 61), route functions (after `lookupInventoryByCode` at line 1727), `INVENTORY_FIELDS` (line 1685), `createInventory` INSERT (line 1753), header comment (lines 18-22)
- Modify: `orders/migrations/0031_inventory_enrich_cache.sql` (already created, untracked — verify content, then commit)

**Interfaces:**
- Consumes: `createLruCache`, `usdaCandidatesFromResponse`, `mapOffProduct` from `./enrich-lib.js` (Task 1).
- Produces:
  - `GET /api/inventory/lookup-ingredient?q=<text>&limit=<1..10>` → 200 `{candidates: [...]}` (header `X-Data-Source: usda|demo`), 400 missing q, 502 upstream failure
  - `GET /api/inventory/enrich?code=<8-14 digits>` → 200 `{source:'off', product: {...}|null}`, 400 bad code, 502 upstream failure, 504 timeout
  - PATCH `/api/inventory/:id` and POST `/api/inventory` now accept `nutrition_source` / `nutrition_fetched_at`

- [ ] **Step 1: Add the import** (next to the existing `customer-match.js` import, `api.js:61`)

```js
import { createLruCache, usdaCandidatesFromResponse, mapOffProduct } from './enrich-lib.js';
```

- [ ] **Step 2: Add the two endpoint functions + LRU cache** (insert immediately after `lookupInventoryByCode`, which ends at `api.js:1727`)

```js
// ─── External data sources (USDA FoodData Central + Open Food Facts) ────────
// Admin-only, like the rest of inventory. USDA results are cached in memory
// (LRU, ~50 entries, 5-min TTL) so repeated edits don't re-hit upstream.

const usdaCache = createLruCache(50, 5 * 60 * 1000);

// GET /api/inventory/lookup-ingredient?q=…&limit=5 — USDA FoodData Central search.
// Falls back to DEMO_KEY when env.USDA_KEY is not set; signals that with the
// X-Data-Source: demo header so the SPA can warn about the 30 req/hr limit.
async function lookupIngredientUsda(request, env) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) return json({ error: 'Missing q parameter' }, 400);
  let limit = Number(url.searchParams.get('limit') || 5);
  if (!Number.isFinite(limit) || limit < 1 || limit > 10) limit = 5;

  const cacheKey = `${q}:${limit}`;
  const cached = usdaCache.get(cacheKey);
  if (cached) {
    return json({ candidates: cached.candidates }, 200, { 'X-Data-Source': cached.demo ? 'demo' : 'usda' });
  }

  const apiKey = env.USDA_KEY || 'DEMO_KEY';
  const apiUrl = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(q)}&pageSize=${limit}&api_key=${encodeURIComponent(apiKey)}`;
  let data;
  try {
    const res = await fetch(apiUrl, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return json({ error: 'USDA lookup failed', status: res.status }, 502);
    data = await res.json();
  } catch (e) {
    return json({ error: 'USDA lookup failed: ' + ((e && e.message) || e) }, 502);
  }

  const candidates = usdaCandidatesFromResponse(data);
  const demo = !env.USDA_KEY;
  usdaCache.set(cacheKey, { candidates, demo });
  return json({ candidates }, 200, { 'X-Data-Source': demo ? 'demo' : 'usda' });
}

// GET /api/inventory/enrich?code=… — Open Food Facts product lookup by barcode.
const OFF_USER_AGENT = 'MuyRico/1.0 (contact@muy-rico.com)';

async function enrichInventoryOff(request, env) {
  const url = new URL(request.url);
  const code = (url.searchParams.get('code') || '').trim();
  if (!/^[0-9]{8,14}$/.test(code)) return json({ error: 'code must be a numeric barcode' }, 400);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(code)}.json`, {
      headers: { 'User-Agent': OFF_USER_AGENT, 'Accept': 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) return json({ error: 'Open Food Facts lookup failed', status: res.status }, 502);
    const data = await res.json();
    const product = data && data.product ? mapOffProduct(data.product) : null;
    return json({ source: 'off', product }, 200);
  } catch (e) {
    if (e && e.name === 'AbortError') return json({ error: 'Open Food Facts timeout' }, 504);
    return json({ error: 'Open Food Facts lookup failed: ' + ((e && e.message) || e) }, 502);
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 3: Extend `INVENTORY_FIELDS`** (`api.js:1685-1690`)

```js
const INVENTORY_FIELDS = [
  'name', 'category', 'quantity', 'unit',
  'reorder_level', 'cost_per_unit', 'supplier',
  'ingredients_label', 'allergens', 'unit_weight',
  'active', 'barcode', 'nutrition_source', 'nutrition_fetched_at',
];
```

- [ ] **Step 4: Extend `createInventory` INSERT** (`api.js:1753-1772`) — add the two columns and binds

```js
    await env.DB.prepare(`
      INSERT INTO inventory
        (id, name, category, quantity, unit, reorder_level, cost_per_unit, supplier,
         ingredients_label, allergens, unit_weight, active, barcode,
         nutrition_source, nutrition_fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      body.id,
      body.name,
      body.category,
      Number(body.quantity) || 0,
      body.unit,
      Number(body.reorder_level) || 0,
      Number(body.cost_per_unit) || 0,
      body.supplier || null,
      body.ingredients_label || null,
      parseAllergens(body.allergens),
      typeof body.unit_weight === 'number' && !Number.isNaN(body.unit_weight) ? body.unit_weight : null,
      body.active === false ? 0 : 1,
      body.barcode || null,
      body.nutrition_source || null,
      body.nutrition_fetched_at || null,
    ).run();
```

- [ ] **Step 5: Update the header route comment** (`api.js:18-22`) to document the new endpoints

```
//   GET    /api/inventory/lookup-ingredient — USDA FoodData Central search (admin)
//   GET    /api/inventory/enrich           — Open Food Facts product lookup (admin)
```

- [ ] **Step 6: Verify the migration file** `orders/migrations/0031_inventory_enrich_cache.sql` matches spec §5

Expected content (already written, verify no changes needed):

```sql
-- 0031: inventory enrich cache columns
-- Tracks which external source (USDA, OFF) populated an item's ingredient/allergen data
-- and when, so we can re-fetch later and show provenance on the inventory page.
--
-- Run:
--   npx wrangler d1 execute muy-rico-orders --remote --file=migrations/0031_inventory_enrich_cache.sql

ALTER TABLE inventory ADD COLUMN nutrition_source TEXT;     -- e.g. 'fdc:2490378', 'off:0737628064502'
ALTER TABLE inventory ADD COLUMN nutrition_fetched_at TEXT; -- ISO 8601 UTC
```

- [ ] **Step 7: Smoke test with local wrangler dev**

Run: `npx wrangler dev -c orders/wrangler.toml` (workdir repo root, in a second terminal)

Then (all from repo root):

```bash
curl -s 'http://localhost:8787/api/inventory/lookup-ingredient?q=all-purpose+flour' | head -c 400
curl -s 'http://localhost:8787/api/inventory/lookup-ingredient?q=' 
curl -s 'http://localhost:8787/api/inventory/enrich?code=0737628064502' | head -c 400
curl -s 'http://localhost:8787/api/inventory/enrich?code=0000000000000'
curl -s 'http://localhost:8787/api/inventory/enrich?code=abc'
```

Expected: first returns 200 + candidates array; second 400 `Missing q parameter`; third 200 with `product` or `product: null`; fourth 200 `{"source":"off","product":null}`; fifth 400 `code must be a numeric barcode`. (USDA may use DEMO_KEY locally — note the `X-Data-Source: demo` response header.)

Also verify the allowlist write path locally:
```bash
curl -s -X PATCH 'http://localhost:8787/api/inventory/inv_flour' -H 'Content-Type: application/json' -d '{"nutrition_source":"fdc:2490378","nutrition_fetched_at":"2026-08-01T00:00:00.000Z"}'
```
Expected: 200 `{"ok":true}` (choose an id that exists in your local DB; adjust if `inv_flour` doesn't exist — pick any item from `GET /api/inventory`).

- [ ] **Step 8: Commit**

```bash
git add orders/workers/api.js orders/migrations/0031_inventory_enrich_cache.sql
git commit -m "feat(inventory): add USDA lookup-ingredient + OFF enrich endpoints"
```

---

### Task 3: SPA data layer — wrappers, types, store mapping

**Files:**
- Modify: `home-bakery-management-system/src/utils/api.ts` — `ApiInventoryItem` (~line 282), `InventoryItemCreate` (~line 300), new wrappers after `adjustInventoryQuantity` (~line 376)
- Modify: `home-bakery-management-system/src/types.ts` — `InventoryItem` (~line 71)
- Modify: `home-bakery-management-system/src/context/StoreContext.tsx` — `apiToInventoryItem` (~line 197)

**Interfaces:**
- Consumes: Task 2 endpoints.
- Produces (used by Tasks 4-5):
  - `export interface UsdaCandidate { fdcId: number; name: string; dataType: string; ingredients: string | null; foodCategory: string | null; portionGramWeight: number | null; per100g: { energy?: number; protein?: number; carbs?: number; fat?: number } | null; allergenHints: string[] }`
  - `export interface OffProduct { name: string; brand: string | null; ingredients: string | null; allergens: string[]; quantity: string | null; unitWeightLb: number | null; imageUrl: string | null }`
  - `export async function lookupUsdaIngredient(q: string, limit?: number): Promise<{ candidates: UsdaCandidate[] }>`
  - `export async function enrichBarcode(code: string): Promise<{ source: "off"; product: OffProduct | null }>`

- [ ] **Step 1: Add fields to `ApiInventoryItem` and `InventoryItemCreate`** in `src/utils/api.ts`

```ts
export interface ApiInventoryItem {
  // ...existing fields...
  barcode?: string | null;
  nutrition_source?: string | null;
  nutrition_fetched_at?: string | null;
  created_at?: string;
  updated_at?: string | null;
}

export interface InventoryItemCreate {
  // ...existing fields...
  barcode?: string | null;
  nutrition_source?: string | null;
  nutrition_fetched_at?: string | null;
}
```

- [ ] **Step 2: Add wrappers + types after `adjustInventoryQuantity`** in `src/utils/api.ts`

```ts
// ─── Inventory enrichment (USDA FoodData Central + Open Food Facts) ──────────

export interface UsdaCandidate {
  fdcId: number;
  name: string;
  dataType: string;
  ingredients: string | null;
  foodCategory: string | null;
  portionGramWeight: number | null;
  per100g: { energy?: number; protein?: number; carbs?: number; fat?: number } | null;
  allergenHints: string[];
}

export interface OffProduct {
  name: string;
  brand: string | null;
  ingredients: string | null;
  allergens: string[];
  quantity: string | null;
  unitWeightLb: number | null;
  imageUrl: string | null;
}

export async function lookupUsdaIngredient(
  q: string,
  limit = 5
): Promise<{ candidates: UsdaCandidate[] }> {
  const params = new URLSearchParams({ q, limit: String(limit) });
  return apiFetch(`/api/inventory/lookup-ingredient?${params.toString()}`);
}

export async function enrichBarcode(
  code: string
): Promise<{ source: "off"; product: OffProduct | null }> {
  const params = new URLSearchParams({ code });
  return apiFetch(`/api/inventory/enrich?${params.toString()}`);
}
```

- [ ] **Step 3: Add fields to `InventoryItem`** in `src/types.ts`

```ts
export interface InventoryItem {
  // ...existing fields...
  barcode?: string | null;
  nutritionSource?: string;
  nutritionFetchedAt?: string;
}
```

- [ ] **Step 4: Map the new fields in `apiToInventoryItem`** in `src/context/StoreContext.tsx`

```ts
      barcode: row.barcode || null,
      nutritionSource: row.nutrition_source || undefined,
      nutritionFetchedAt: row.nutrition_fetched_at || undefined,
```

- [ ] **Step 5: Typecheck — confirm no NEW errors**

Run: `npx tsc --noEmit` (workdir `home-bakery-management-system`)
Expected: same error count as baseline (~115 pre-existing WIP errors); grep output for `nutrition`/`Usda`/`OffProduct` shows no new errors.

- [ ] **Step 6: Commit**

```bash
git add home-bakery-management-system/src/utils/api.ts home-bakery-management-system/src/types.ts home-bakery-management-system/src/context/StoreContext.tsx
git commit -m "feat(admin): enrich API wrappers + nutrition provenance types"
```

---

### Task 4: Inventory edit modal — USDA auto-fill

**Files:**
- Modify: `home-bakery-management-system/src/pages/Inventory.tsx`

**Interfaces:**
- Consumes: `lookupUsdaIngredient`, `UsdaCandidate` (Task 3); `InventoryItem.nutritionSource/nutritionFetchedAt` (Task 3).
- Produces: edit modal "Find ingredient data" sub-panel; source pill; PATCH payload includes `nutrition_source`/`nutrition_fetched_at`.

- [ ] **Step 1: Update imports** in `src/pages/Inventory.tsx`

```tsx
import { useState, Suspense, lazy } from "react";
import { Minus, Pencil, Plus, ScanLine, Search, Trash2 } from "lucide-react";
import { useStore } from "../context/StoreContext";
import Modal from "../components/ui/Modal";
import Badge from "../components/ui/Badge";
import { formatCurrency } from "../utils/format";
import { lookupUsdaIngredient, type UsdaCandidate } from "../utils/api";
import type { InventoryItem } from "../types";
```

- [ ] **Step 2: Add state** (after `allergensText` state, ~line 29)

```tsx
  const [usdaOpen, setUsdaOpen] = useState(false);
  const [usdaBusy, setUsdaBusy] = useState(false);
  const [usdaQ, setUsdaQ] = useState("");
  const [usdaResults, setUsdaResults] = useState<UsdaCandidate[]>([]);
  const [usdaErr, setUsdaErr] = useState("");
```

- [ ] **Step 3: Reset the sub-panel in `openNew` and prefill in `openEdit`** (~lines 33-45)

```tsx
  function openNew() {
    setDraft(emptyItem());
    setEditingId(null);
    setAllergensText("");
    setUsdaOpen(false);
    setUsdaQ("");
    setUsdaResults([]);
    setUsdaErr("");
    setModalOpen(true);
  }

  function openEdit(i: InventoryItem) {
    setDraft(i);
    setEditingId(i.id);
    setAllergensText((i.allergens || []).join(", "));
    setUsdaOpen(false);
    setUsdaQ(i.name);
    setUsdaResults([]);
    setUsdaErr("");
    setModalOpen(true);
  }
```

- [ ] **Step 4: Add search + apply handlers** (after `adjust`, ~line 94)

```tsx
  async function usdaSearch() {
    if (!usdaQ.trim()) return;
    setUsdaBusy(true);
    setUsdaErr("");
    try {
      const r = await lookupUsdaIngredient(usdaQ.trim(), 5);
      setUsdaResults(r.candidates || []);
    } catch (e: any) {
      setUsdaErr(e?.message || "Lookup failed");
      setUsdaResults([]);
    } finally {
      setUsdaBusy(false);
    }
  }

  function usdaApply(c: UsdaCandidate) {
    const merged = [...(draft.allergens || []).filter(Boolean)];
    for (const tag of c.allergenHints) if (!merged.includes(tag)) merged.push(tag);
    setAllergensText(merged.join(", "));
    const lb =
      c.portionGramWeight != null
        ? Math.round(c.portionGramWeight * 0.00220462 * 10000) / 10000
        : undefined;
    setDraft({
      ...draft,
      ingredients_label: c.ingredients || draft.ingredients_label,
      unit_weight: lb ?? draft.unit_weight,
      nutritionSource: `fdc:${c.fdcId}`,
      nutritionFetchedAt: new Date().toISOString(),
    });
    setUsdaOpen(false);
    setUsdaResults([]);
  }
```

- [ ] **Step 5: Add `nutrition_source` / `nutrition_fetched_at` to the save payload** (in `save()`, after `barcode` line ~61)

```tsx
      nutrition_source: draft.nutritionSource,
      nutrition_fetched_at: draft.nutritionFetchedAt,
```

- [ ] **Step 6: Replace the ingredients_label `Field` with header row + button + sub-panel** (lines 266-274)

Replace:

```tsx
              <Field label="Sub-ingredients label (legal)">
                <textarea
                  value={draft.ingredients_label || ""}
                  onChange={(e) => setDraft({ ...draft, ingredients_label: e.target.value || undefined })}
                  placeholder='e.g. "Enriched flour (wheat flour, niacin, …)". Leave blank for packaging.'
                  rows={2}
                  className="input"
                />
              </Field>
```

with:

```tsx
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className="text-xs font-medium text-cocoa-muted">Sub-ingredients label (legal)</label>
                  <button
                    type="button"
                    onClick={() => {
                      setUsdaQ(draft.name || usdaQ);
                      setUsdaOpen(!usdaOpen);
                      setUsdaResults([]);
                      setUsdaErr("");
                    }}
                    className="rounded-lg border border-palm/30 px-2.5 py-1 text-xs font-medium text-palm hover:bg-palm/5"
                  >
                    Find ingredient data
                  </button>
                </div>
                {draft.nutritionSource && (
                  <p className="mb-1 text-[11px] text-cocoa-muted">
                    Filled from USDA · {(draft.nutritionFetchedAt || "").slice(0, 10)} — click "Find ingredient
                    data" to refetch.
                  </p>
                )}
                <textarea
                  value={draft.ingredients_label || ""}
                  onChange={(e) => setDraft({ ...draft, ingredients_label: e.target.value || undefined })}
                  placeholder='e.g. "Enriched flour (wheat flour, niacin, …)". Leave blank for packaging.'
                  rows={2}
                  className="input"
                />
                {usdaOpen && (
                  <div className="mt-2 rounded-lg border border-sand-200 bg-white p-2">
                    <div className="flex gap-2">
                      <input
                        value={usdaQ}
                        onChange={(e) => setUsdaQ(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") usdaSearch(); }}
                        placeholder="Search USDA FoodData Central…"
                        className="input flex-1"
                      />
                      <button
                        onClick={usdaSearch}
                        disabled={usdaBusy}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-palm px-3 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        <Search size={12} /> {usdaBusy ? "Searching…" : "Search"}
                      </button>
                    </div>
                    {usdaErr && <p className="mt-2 text-xs text-hibiscus">{usdaErr}</p>}
                    <ul className="mt-2 max-h-48 divide-y divide-sand-100 overflow-y-auto">
                      {usdaResults.map((c) => (
                        <li key={c.fdcId}>
                          <button
                            type="button"
                            onClick={() => usdaApply(c)}
                            className="w-full px-2 py-2 text-left hover:bg-sand-50"
                          >
                            <div className="text-sm font-medium text-cocoa">{c.name}</div>
                            <div className="text-xs text-cocoa-muted">
                              {c.dataType}
                              {c.foodCategory ? ` · ${c.foodCategory}` : ""}
                              {c.portionGramWeight != null
                                ? ` · ${Math.round(c.portionGramWeight)} g/portion`
                                : ""}
                            </div>
                          </button>
                        </li>
                      ))}
                      {!usdaBusy && usdaResults.length === 0 && (
                        <li className="px-2 py-3 text-xs text-cocoa-muted">No matches — try a different search.</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
```

- [ ] **Step 7: Build + typecheck**

Run: `npx tsc --noEmit && npm run build` (workdir `home-bakery-management-system`)
Expected: no new tsc errors; build succeeds.

- [ ] **Step 8: Commit**

```bash
git add home-bakery-management-system/src/pages/Inventory.tsx
git commit -m "feat(admin): USDA auto-fill in inventory edit modal"
```

---

### Task 5: Scan modal — Open Food Facts auto-fill preview

**Files:**
- Modify: `home-bakery-management-system/src/components/ScanModal.tsx`

**Interfaces:**
- Consumes: `enrichBarcode`, `OffProduct` (Task 3); `updateInventoryItem`, `lookupInventoryByCode` (existing).
- Produces: in the bind flow — after barcode is bound, auto-call enrich; on hit show a preview panel with "Use this info" / "Skip"; on miss or failure proceed straight to the count stepper.

- [ ] **Step 1: Update imports** (`ScanModal.tsx:5-10`)

```tsx
import {
  adjustInventoryQuantity,
  lookupInventoryByCode,
  updateInventoryItem,
  enrichBarcode,
  type ApiInventoryItem,
  type OffProduct,
} from "../utils/api";
```

- [ ] **Step 2: Add "preview" mode + state** (line 14 and after `conflict` state ~line 27)

```tsx
type Mode = "scanning" | "adjust" | "bind" | "preview" | "conflict" | "error";
```

```tsx
  const [offProduct, setOffProduct] = useState<OffProduct | null>(null);
```

- [ ] **Step 3: Reset state when the modal opens** (in the `open` effect, near `setConflict(null)` ~line 94)

```tsx
    setOffProduct(null);
```

- [ ] **Step 4: Extract the post-bind lookup into `gotoAdjust` and rewire `bindToItem`** (replace lines 141-200)

```tsx
  // After a code is bound (or skipped), look it up so the count stepper opens.
  const gotoAdjust = useCallback(async () => {
    const r = await lookupInventoryByCode(code);
    if ("item" in r) {
      setItem(r.item);
      setNewCount(Number(r.item.quantity) || 0);
      setMode("adjust");
      await refreshInventory();
    } else {
      throw new Error("Bind succeeded but lookup failed");
    }
  }, [code, refreshInventory]);

  const saveAdjust = useCallback(async () => {
    if (!item) return;
    setBusy(true);
    setErrMsg("");
    try {
      const current = Number(item.quantity) || 0;
      const delta = newCount - current;
      if (!Number.isFinite(delta)) throw new Error("Invalid count");
      const r = await adjustInventoryQuantity(item.id, delta);
      if ("error" in r) throw new Error(r.error);
      await refreshInventory();
      // Return to scanning so the next item can be scanned immediately
      setItem(null);
      setCode("");
      setMode("scanning");
      focusManual();
    } catch (e: any) {
      setErrMsg(e?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  }, [item, newCount, refreshInventory, focusManual]);

  const bindToItem = useCallback(async () => {
    if (!bindPick) return;
    setBusy(true);
    setErrMsg("");
    try {
      await updateInventoryItem(bindPick.id, { barcode: code } as any);
      // Auto-lookup the code on Open Food Facts (non-fatal if it fails or misses)
      let product: OffProduct | null = null;
      try {
        const r = await enrichBarcode(code);
        product = r && r.product ? r.product : null;
      } catch {
        product = null;
      }
      if (product) {
        setOffProduct(product);
        setMode("preview");
      } else {
        await gotoAdjust();
      }
    } catch (e: any) {
      // 409 conflict: another item already has this code
      const status = e?.status ?? 0;
      const body = e?.body ?? null;
      if (status === 409 || body?.code === 'barcode_conflict') {
        const c: ConflictInfo | null = body?.conflict ? { id: body.conflict.id, name: body.conflict.name } : null;
        if (c) {
          setConflict(c);
          setMode("conflict");
        } else {
          setErrMsg("Barcode already bound to another item.");
          setMode("error");
        }
      } else {
        setErrMsg(String(e?.message || "Bind failed"));
        setMode("error");
      }
    } finally {
      setBusy(false);
    }
  }, [bindPick, code, gotoAdjust]);

  // "Use this info" — apply the OFF fields to the bound item, then open the count stepper.
  const applyOff = useCallback(async () => {
    if (!bindPick || !offProduct) return;
    setBusy(true);
    setErrMsg("");
    try {
      const patch: Record<string, any> = {
        nutrition_source: `off:${code}`,
        nutrition_fetched_at: new Date().toISOString(),
      };
      if (offProduct.brand) patch.supplier = offProduct.brand;
      if (offProduct.ingredients) patch.ingredients_label = offProduct.ingredients;
      if (offProduct.allergens.length) patch.allergens = offProduct.allergens;
      if (offProduct.unitWeightLb != null) patch.unit_weight = offProduct.unitWeightLb;
      await updateInventoryItem(bindPick.id, patch as any);
      await gotoAdjust();
    } catch (e: any) {
      setErrMsg(String(e?.message || "Apply failed"));
      setMode("error");
    } finally {
      setBusy(false);
    }
  }, [bindPick, offProduct, code, gotoAdjust]);
```

- [ ] **Step 5: Render the preview panel** (in the modal body, after the `bind` block ~line 276)

```tsx
        {mode === "preview" && offProduct && (
          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <div className="flex items-start gap-3">
              {offProduct.imageUrl && (
                <img
                  src={offProduct.imageUrl}
                  alt="Open Food Facts product"
                  className="h-16 w-16 rounded-lg object-cover"
                />
              )}
              <div className="min-w-0">
                <div className="font-semibold text-stone-900">{offProduct.name}</div>
                <div className="text-xs text-stone-500">
                  {offProduct.brand}
                  {offProduct.brand && offProduct.quantity ? " · " : ""}
                  {offProduct.quantity}
                </div>
              </div>
            </div>
            {offProduct.ingredients && (
              <p className="mt-2 line-clamp-2 text-xs text-stone-600">{offProduct.ingredients}</p>
            )}
            {offProduct.allergens.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {offProduct.allergens.map((a) => (
                  <Badge key={a} tone="new">{a}</Badge>
                ))}
              </div>
            )}
            <p className="mt-2 text-[11px] text-stone-400">
              Product data from Open Food Facts — review before using.
            </p>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                onClick={() =>
                  gotoAdjust().catch((e: any) => {
                    setErrMsg(String(e?.message || "Skip failed"));
                    setMode("error");
                  })
                }
                disabled={busy}
                className="rounded-lg px-3 py-2 text-stone-700 hover:bg-stone-100"
              >
                Skip
              </button>
              <button
                onClick={applyOff}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg bg-coral px-4 py-2 text-white hover:opacity-90 disabled:opacity-50"
              >
                <Check className="h-4 w-4" /> Use this info
              </button>
            </div>
          </div>
        )}
```

- [ ] **Step 6: Build + typecheck**

Run: `npx tsc --noEmit && npm run build` (workdir `home-bakery-management-system`)
Expected: no new tsc errors; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add home-bakery-management-system/src/components/ScanModal.tsx
git commit -m "feat(admin): OFF auto-fill preview in scan bind flow"
```

---

### Task 6: Deploy — migration, worker, SPA

**Files:**
- Modify: none (deployment only; commits from Tasks 1-5)

**Interfaces:**
- Consumes: all previous tasks.

- [ ] **Step 1: Run migration 0031 on local and remote D1**

```bash
npx wrangler d1 execute muy-rico-orders --local --file=orders/migrations/0031_inventory_enrich_cache.sql
npx wrangler d1 execute muy-rico-orders --remote --file=orders/migrations/0031_inventory_enrich_cache.sql
```

Expected: both report success (`ALTER TABLE ...` statements executed).

- [ ] **Step 2: Set the USDA secret** (owner action — key from `https://fdc.nal.usda.gov/api-key-signup/`)

```bash
npx wrangler secret put USDA_KEY --name muy-rico-orders-api
```

Expected: prompts for the key value. If the owner has not created a key yet, skip — the DEMO_KEY fallback keeps the feature working at 30 req/hr.

- [ ] **Step 3: Deploy the worker**

```bash
npx wrangler deploy -c orders/wrangler.toml
```

Expected: upload succeeds; new endpoints live.

- [ ] **Step 4: Build + deploy the admin SPA**

```bash
cd home-bakery-management-system && npm install && npm run build
```

(postbuild copies `dist/index.html` → `../admin/index.html`)

```bash
cd .. && npx wrangler versions upload
npx wrangler versions deploy
```

Expected: versions upload includes `admin/index.html`; deploy promotes it.

- [ ] **Step 5: Remote smoke tests** (from repo root; remote endpoints sit behind Cloudflare Access — if curl returns 401/403, verify locally via `wrangler dev` instead, then confirm the DB writes below)

```bash
curl -s 'https://muy-rico-orders-api.<account>.workers.dev/api/inventory/lookup-ingredient?q=butter' | head -c 300
curl -s 'https://muy-rico-orders-api.<account>.workers.dev/api/inventory/enrich?code=0737628064502' | head -c 300
curl -s 'https://muy-rico-orders-api.<account>.workers.dev/api/inventory/enrich?code=0000000000000'
```

Expected: 200s as in Task 2 (adjust the host to your actual workers.dev subdomain; replace with the localhost checks if Access blocks you).

- [ ] **Step 6: Verify a write round-trip in the remote DB**

```bash
npx wrangler d1 execute muy-rico-orders --remote --command "UPDATE inventory SET nutrition_source='off:0737628064502', nutrition_fetched_at='2026-08-01T00:00:00Z' WHERE id='inv_flour' RETURNING id, nutrition_source, nutrition_fetched_at"
npx wrangler d1 execute muy-rico-orders --remote --command "SELECT id, nutrition_source, nutrition_fetched_at FROM inventory WHERE nutrition_source IS NOT NULL LIMIT 5"
```

Expected: RETURNING row shows the provenance columns; second query lists items with sources. (Adjust the id if `inv_flour` doesn't exist — pick from `SELECT id FROM inventory LIMIT 5`.)

- [ ] **Step 7: Manual UI check (desktop)**

- Admin → Inventory → edit an item → "Find ingredient data" → search → click a candidate → fields prefill, "Filled from USDA · <date>" pill appears → Save → reopen → pill persists.
- Admin → Inventory → Scan → bind flow: scan/type a real UPC that isn't bound yet (e.g. `0737628064502`) → pick an item → preview panel shows OFF data → "Use this info" → count stepper → Save.
- Verify no console errors; the scan modal still handles the miss case (unknown code → straight to count stepper).

Expected: all flows work; pill persists after reload (data came from D1).

---

## Self-Review Notes

- **Spec coverage:** §5 migration (Task 2 step 6 + Task 6 step 1) ✓; §6a USDA endpoint with LRU/DEMO_KEY/X-Data-Source (Task 2) ✓; §6b OFF endpoint with UA/timeout/miss shape (Task 2) ✓; §6c no new write endpoints (all writes via PATCH) ✓; §7a edit modal auto-fill + pill (Task 4) ✓; §7b scan preview (Task 5) ✓; §7c type safety (Task 3) ✓; §9 deployment (Task 6) ✓; §10 unit tests (Task 1), smoke tests (Task 2 step 7 / Task 6 step 5); Playwright e2e deferred per repo convention ✓; §11 risks — DEMO_KEY fallback, OFF coverage fallthrough to manual entry, refetch via the find button, wrapper functions isolate API drift ✓.
- **Decisions logged:** USDA allergen hints are conservative category matches (spec §7a step 4 said "parsed from the food category" — implemented via `categoryAllergenHints` in the worker, not the SPA, to keep mapping logic DRY); `unit` is never overwritten from OFF (spec §7b only lists ingredients/allergens/supplier/unit_weight — matches); Playwright e2e deferred (no harness in repo).
- **Type consistency:** `UsdaCandidate.per100g` in SPA matches worker `per100g` keys (energy/protein/carbs/fat); `OffProduct.unitWeightLb` matches `mapOffProduct` output; `nutritionSource`/`nutritionFetchedAt` (camel) ↔ `nutrition_source`/`nutrition_fetched_at` (snake) mapping in `apiToInventoryItem` and save payloads verified against worker `INVENTORY_FIELDS`.
- **Route ordering:** `/api/inventory/lookup-ingredient` and `/api/inventory/enrich` sit at `api.js:126-127`, before any `/api/inventory/:id` regex — no ordering bug.
