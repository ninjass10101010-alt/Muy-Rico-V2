// Per-item / per-flavor order label generation helpers.
// Pure functions (no Cloudflare bindings) shared by label generation and
// quote-to-order conversion.

/* ── Quote item helpers (also used for order notes + quote documents) ─── */

export function quoteItemDisplayName(item) {
  const d = (item.details && typeof item.details === 'object') ? item.details : {};
  switch (item.product_type) {
    case 'cake':
      return d.cake_flavor ? `Custom Cake — ${d.cake_flavor}` : 'Custom Cake';
    case 'cakepops': {
      const parts = [d.chocolate_dip, d.topping_style].filter(Boolean);
      return parts.length ? `Cakepops (${parts.join(', ')})` : 'Cakepops';
    }
    case 'cupcakes':
      return d.frosting ? `Cupcakes (${d.frosting})` : 'Cupcakes';
    case 'custom':
      return d.name || 'Custom Item';
    default:
      return item.product_type || 'Custom Item';
  }
}

export function quoteItemQty(item) {
  const d = (item.details && typeof item.details === 'object') ? item.details : {};
  if (item.product_type === 'cake') return 1;
  if (item.product_type === 'custom') return Number(d.quantity) || 1;
  return Number(d.quantity) || 6;
}

export function quoteItemDetailsSummary(details, excludeKeys = []) {
  if (!details || typeof details !== 'object') return '';
  return Object.entries(details)
    .filter(([k, v]) => !excludeKeys.includes(k) && v != null && v !== '' && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('/') : v}`)
    .join(', ');
}

/**
 * Snapshot the structured quote items onto the converted order line so label
 * generation can produce one label per item/flavor instead of one combined
 * label for the whole quote. Totals stay untouched: the order line remains a
 * single priced row.
 */
export function buildSubItems(quoteItems) {
  return (quoteItems || []).map((i) => ({
    type: i.product_type,
    name: quoteItemDisplayName(i),
    qty: quoteItemQty(i),
    details: i.details,
  }));
}

/* ── Product matching ────────────────────────────────────────────────── */

// Quote item types that map 1:1 to a catalog product.
const QUOTE_TYPE_PRODUCT = {
  cake: 'prod_custom_cake',
  cupcakes: 'prod_cupcakes',
  cakepops: 'prod_cakepop',
};

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stem(w) {
  return w.endsWith('s') && w.length > 3 ? w.slice(0, -1) : w;
}

function tokens(s) {
  return (String(s || '').toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter((t) => !/^\d+$/.test(t))
    .map(stem);
}

/**
 * Direct (name-contained) product match. Longest contained product name wins,
 * so "Mini Cinnamon Rolls" resolves to the mini product, not "Cinnamon Rolls".
 */
export function matchProductForName(name, products) {
  if (!name) return null;
  const lower = String(name).toLowerCase();
  let best = null;
  let bestLen = 0;
  for (const p of products || []) {
    for (const pn of [p.name, p.name_es].filter(Boolean)) {
      if (lower.includes(pn.toLowerCase()) && pn.length > bestLen) {
        best = p;
        bestLen = pn.length;
      }
    }
  }
  return best;
}

/**
 * Fuzzy token match for free-text custom quote items ("Lemon cupcake" →
 * "Cupcakes (6)"). A product wins when all/most of its name tokens appear in
 * the item name; ties prefer the most matched tokens.
 */
export function fuzzyMatchProductForName(name, products) {
  const nameTokens = new Set(tokens(name));
  if (!nameTokens.size) return null;
  let best = null;
  let bestScore = 0;
  let bestMatched = 0;
  for (const p of products || []) {
    const pTokens = tokens([p.name, p.name_es].filter(Boolean).join(' '));
    if (!pTokens.length) continue;
    const matched = pTokens.filter((t) => nameTokens.has(t)).length;
    if (!matched) continue;
    const score = matched / pTokens.length;
    if (score > bestScore || (score === bestScore && matched > bestMatched)) {
      best = p;
      bestScore = score;
      bestMatched = matched;
    }
  }
  return bestScore > 0 ? best : null;
}

export function matchProductForSubItem(sub, products) {
  const list = products || [];
  const mappedId = QUOTE_TYPE_PRODUCT[sub && sub.type];
  if (mappedId) {
    const mapped = list.find((p) => p.id === mappedId);
    if (mapped) return mapped;
  }
  return matchProductForName(sub && sub.name, list) || fuzzyMatchProductForName(sub && sub.name, list);
}

/* ── Label naming ────────────────────────────────────────────────────── */

/**
 * Human detail that distinguishes same-named sub-items, e.g. the Dubai vs
 * Regular varieties of "Cinnamon Rolls". Strips a repeated item name and a
 * trailing pack count like "(4)".
 */
export function cleanSubItemDetail(sub) {
  const d = (sub && sub.details && typeof sub.details === 'object') ? sub.details : {};
  let detail = '';
  if (sub && sub.type === 'cupcakes') {
    detail = d.cake_flavor || d.frosting || '';
  } else if (sub && sub.type === 'cakepops') {
    detail = [d.chocolate_dip, d.topping_style].filter(Boolean).join(', ');
  } else {
    detail = d.description || '';
  }
  detail = String(detail).trim();
  if (!detail) return '';
  const name = String((sub && sub.name) || '').trim();
  if (name) detail = detail.replace(new RegExp(escapeRegExp(name), 'ig'), ' ');
  detail = detail
    .replace(/^[\s,;:—–-]+/, '')
    .replace(/\s*\(\s*\d{1,2}\s*\)\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return detail;
}

function uniqueSubItemLabelName(sub, usedNames) {
  const qty = Number(sub.qty) || 1;
  const detail = cleanSubItemDetail(sub);
  let base = String(sub.name || '').trim();
  if (detail && !base.toLowerCase().includes(detail.toLowerCase())) {
    base = `${base} (${detail})`;
  }
  if (qty > 1) base = `${base} ×${qty}`;
  let name = base;
  let n = 2;
  while (usedNames.has(name)) {
    name = `${base} (${n})`;
    n++;
  }
  usedNames.add(name);
  return name;
}

/**
 * Expand parsed order items_json into one label target per product:
 *
 *  - Quote-converted lines carry `subItems`; each food sub-item (delivery /
 *    services are skipped by product matching) becomes its own label with a
 *    distinct, deterministic name. Price is suppressed: quote prices are
 *    lump-sum and per-item prices are not stored.
 *  - Website/in-person lines keep the original single-label behavior.
 */
export function expandOrderLineItems(items, products) {
  const out = [];
  const usedNames = new Set();
  for (const item of items || []) {
    if (Array.isArray(item.subItems) && item.subItems.length > 0) {
      for (const sub of item.subItems) {
        const product = matchProductForSubItem(sub, products);
        if (!product || !product.auto_generate_label) continue;
        out.push({
          product,
          displayName: uniqueSubItemLabelName(sub, usedNames),
          item,
          isSubItem: true,
          showPrice: 0,
        });
      }
      continue;
    }

    let product = null;
    if (item.productId) {
      product = (products || []).find((p) => p.id === item.productId) || null;
    }
    if (!product) product = matchProductForName(item.name, products);
    if (!product || !product.auto_generate_label) continue;
    out.push({
      product,
      displayName: String(item.name || product.name).trim(),
      item,
      isSubItem: false,
    });
  }
  return out;
}
