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

// ─── Barcode sanitization + check-digit validation ─────────────────────────
// Scanner guns can emit prefixes (AIM symbology codes like ]C1 / ]e0, GS
// record separators) and stray whitespace. EAN-13 / UPC-A / EAN-8 / ITF-14
// share the same mod-10 check digit. Validation is warn-only by design: some
// legitimately bound codes are non-GTIN (e.g. internal slugs), so callers
// receive a verdict, never a hard block.
export function sanitizeBarcode(raw) {
  const input = String(raw == null ? '' : raw);
  let stripped = input;
  // GS1 application-identifier wrapper: "(01)12345678901231"
  const gs1 = stripped.match(/^\(\s*0*1\s*\)\s*(\d{12,14})$/);
  if (gs1) stripped = gs1[1];
  // AIM prefixes, GS/RS/US record separators, all whitespace
  stripped = stripped
    .replace(/^\s*\]c\d/gi, '')
    .replace(/^\s*\]e\d/gi, '')
    .replace(/[\u001d\u001e\u001f]/g, '')
    .replace(/\s+/g, '');
  const digits = stripped.replace(/\D/g, '');
  if (!digits) {
    return { code: null, raw: input, stripped, digits: '', valid: false, format: 'non-numeric' };
  }
  let format = 'unknown';
  if (digits.length === 8) format = 'EAN8';
  else if (digits.length === 12) format = 'UPC-A';
  else if (digits.length === 13) format = 'EAN13';
  else if (digits.length === 14) format = 'ITF14';
  const valid = ['EAN8', 'UPC-A', 'EAN13', 'ITF14'].includes(format) && mod10CheckDigitValid(digits);
  return { code: digits, raw: input, stripped, digits, valid, format };
}

// Mod-10 check digit shared by EAN-8/UPC-A/EAN-13/ITF-14. Weights alternate
// ×3 / ×1 scanning from the right, with the check digit (rightmost) ×1.
function mod10CheckDigitValid(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const d = Number(digits[i]);
    const posFromRight = digits.length - 1 - i;
    sum += posFromRight % 2 === 1 ? d * 3 : d;
  }
  return sum % 10 === 0;
}

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
