# Product Pipeline: Dashboard → Order Page End-to-End

**Date:** 2026-07-09  
**Status:** Approved

---

## Objective

Changes made to products in the admin dashboard (→ `/api/products` CRUD) must correctly display on the customer-facing order page (`/order.html`), with:
- Product name (Spanish + English)
- Price
- Description (Spanish + English)
- Image or emoji
- Multiple named flavor groups per product, rendered as labeled dropdown selectors on the order page
- Instant reflection (next page load)

---

## 1. Data Model

### Current (broken)

```ts
interface Product {
  flavors?: string[];        // stored as TEXT JSON in D1, returned as raw string → crashes
}
```

### New

```ts
interface FlavorGroup {
  name: string;     // label, e.g. "Cake Flavor", "Frosting"
  options: string[]; // choices, e.g. ["Vanilla", "Chocolate"]
}

interface Product {
  flavor_groups?: FlavorGroup[];  // replaces flavors, same TEXT JSON column
  name_es?: string;                // already supported but no admin UI field
  // ... other fields unchanged
}
```

**No D1 migration needed** — the existing `flavors` TEXT column stores JSON; we change the internal format from `string[]` to `FlavorGroup[]`.

---

## 2. API Worker (`orders/workers/api.js`)

### Fix: parse JSON columns in GET response

`listProducts()` and `getProduct()` currently return raw D1 row data. `flavors` and `recipe` are TEXT columns containing JSON strings. The `json()` response must parse them:

```js
const { results } = await env.DB.prepare(`SELECT * FROM products WHERE active = 1 ...`).all();
const parsed = results.map(r => ({
  ...r,
  flavors: safeJsonParse(r.flavors, []),
  recipe:  safeJsonParse(r.recipe, []),
  active:  Boolean(r.active),
  auto_generate_label: Boolean(r.auto_generate_label),
}));
return json({ products: parsed }, 200);
```

`safeJsonParse` is a new helper that tries `JSON.parse` and returns a fallback on failure.

`createProduct` / `updateProduct` already call `parseFlavors(body.flavors)` and `parseRecipe(body.recipe)` which accept a JS array and return `JSON.stringify(…)` for storage — these may need to remain compatible with both `string[]` and `FlavorGroup[]` input (both are arrays, so `JSON.stringify` already works).

### New: POST /api/upload

**Route:** `POST /api/upload`  
**Auth:** Admin only (same Access check as other admin endpoints)  
**Body:** `multipart/form-data` with a `file` field  
**Validation:** Content-Type must be image/jpeg, image/png, or image/webp. File size ≤ 5MB.  
**Storage:** `env.IMAGES_BUCKET.put(key, fileStream, { httpMetadata: { contentType } })`  
**Key pattern:** `products/{productId}-{Date.now()}.{ext}` (productId optional — use a uuid-like string if not present)  
**Response:** `{ url: "https://pub-<bucket-id>.r2.dev/products/..." }`

Requires R2 binding in `orders/wrangler.toml`:

```toml
[[r2_buckets]]
binding = "IMAGES_BUCKET"
bucket_name = "muy-rico-product-images"
```

---

## 3. Types (`src/types.ts` and `src/utils/api.ts`)

### `src/types.ts`
- Add `FlavorGroup { name: string; options: string[] }`
- Rename/extend: `Product.flavors?` → `Product.flavor_groups?: FlavorGroup[]`
  (keep backward compat with old `flavors` key during transition)

### `src/utils/api.ts`
- Update `ApiProduct.flavors` type to reflect the new structure parsed by the API
- Add `ApiProduct.flavor_groups?: FlavorGroup[]` to API types
- Add `uploadImage(file: File): Promise<{ url: string }>` function

---

## 4. Admin Dashboard (`Products.tsx`)

### New form fields

1. **`name_es` input** — `<input>` after the English name field, placeholder "Nombre en español"
2. **Emoji** — keep 10-preset grid, add a "Custom emoji" text input below
3. **Image upload** — file picker (`<input type="file" accept="image/*">`) with a preview thumbnail and an "Upload" button. After upload, stores the returned URL in `draft.image_url`. Keep the URL text field as a manual override.

### Flavor groups editor

Replace the comma-separated `flavorsText` input with a Flavor Groups section:

```
┌─────────────────────────────────────────────────────────┐
│  Flavor Groups                                           │
│                                                          │
│  ┌─ Group 1 ──────────────────────────────────────────┐ │
│  │  Name: [Cake Flavor                      ]         │ │
│  │  Options: [Vanilla] [Chocolate] [Red Velvet]  [+] │ │
│  └─────────────────────────────────────────────────────┘ │
│  ┌─ Group 2 ──────────────────────────────────────────┐ │
│  │  Name: [Frosting                           ]       │ │
│  │  Options: [Buttercream] [Cream Cheese]        [+]  │ │
│  └─────────────────────────────────────────────────────┘ │
│  [+ Add Flavor Group]    Clear All                      │
└──────────────────────────────────────────────────────────┘
```

State: `draft.flavor_groups: FlavorGroup[]`. Each group renders:
- `<input>` for `group.name`
- A tag row for `group.options` — each tag is a chip with [×] to remove, plus a text input and [+] button to add
- **[+ Add Flavor Group]** appends `{ name: "", options: [] }`

On save, `draft.flavor_groups` is JSON.stringify'd by the `parseFlavors` call in the API.

For existing products that have old-style `flavors` (a `string[]`), migrate on read: if `flavors` is detected as a `string[]` (not `FlavorGroup[]`), convert to a single group `{ name: "Flavor", options: oldFlavors }`.

---

## 5. Order Page (`order.html`)

### Dynamic tile rendering

`renderProductTile(p)` — replace the single `<select>` with multiple labeled dropdowns:

```js
const flavorHTML = (p.flavor_groups || []).map(g => `
  <div class="flavor-group">
    <label class="flavor-label">${g.name}</label>
    <select class="flavor-select" data-group="${g.name}">
      <option value="">— Select —</option>
      ${g.options.map(o => `<option value="${o}">${o}</option>`).join('')}
    </select>
  </div>
`).join('');
```

### `addToCart()` — read flavor selections

Replace the static class-name-based flavor reading (`.cake-flavor`, `.frosting-flavor`, `.concha-flavor`) with dynamic iteration:

```js
const selects = tile.querySelectorAll('.flavor-select');
const selectedFlavors = [];
selects.forEach(sel => {
  if (sel.value) {
    selectedFlavors.push(`${sel.dataset.group}: ${sel.value}`);
  }
});
if (selectedFlavors.length) {
  displayName += ` (${selectedFlavors.join(', ')})`;
}
```

### Fix `toastEmoji` bug

When adding to cart, store `toastEmoji` in the cart object:

```js
const toastEmoji = tile.getAttribute('data-toast-emoji') || '🍞';
cart.push({ ..., toastEmoji });
```

This ensures the order submission payload uses the correct emoji per item.

### Fix SVG image detection

The `renderCart()` function currently checks `item.icon.endsWith('.svg')` to decide whether to render `<img>` or a text emoji. Since `p.emoji` is now an emoji string (not a file path), this check fails. Update to use `item.toastEmoji` as the emoji source, and only render `<img>` if the product has an `image_url`:

```js
if (item.icon && item.icon.endsWith('.svg')) {
  iconHtml = `<img src="${item.icon}" ...>`;
} else if (item.image_url) {
  iconHtml = `<img src="${item.image_url}" ...>`;
} else {
  iconHtml = `<span>${item.toastEmoji || '🍞'}</span>`;
}
```

---

## 6. Seed Data (`src/data/seedData.ts`)

- Remove the pre-existing static `flavors: string[]` from any product that has it
- Add `flavor_groups` to Custom Cake and Cupcake seed products:
  ```ts
  flavor_groups: [
    { name: "Cake Flavor", options: ["Vanilla", "Chocolate", "Red Velvet"] },
    { name: "Frosting",    options: ["Buttercream", "Cream Cheese", "Chocolate"] },
  ]
  ```

---

## 7. Infrastructure — R2

1. **Manual (Dashboard):** Create bucket `muy-rico-product-images`
2. **Manual (Dashboard):** Enable Public Access → get the public URL base
3. **Manual (Dashboard):** Set CORS policy (optional — needed if uploads are done browser-side)

---

## 8. Deploy Sequence

1. Create R2 bucket in Dashboard (prerequisite)
2. Update `orders/wrangler.toml` with R2 binding → `wrangler versions upload --name muy-rico-orders-api` + `wrangler versions deploy`
3. Build admin + deploy:
   ```bash
   cd home-bakery-management-system && npm ci && npm run build
   cd .. && npx wrangler versions upload --name muyrico --assets .
   npx wrangler versions deploy --name muyrico --version-id <id>
   ```
4. Verify: curl `GET /api/products` → flavors/recipe are parsed arrays; order page renders flavor groups; admin form saves/reads correctly.

---

## 9. Files Changed

| File | Change |
|------|--------|
| `orders/workers/api.js` | JSON parsing fix, upload endpoint, parseFlavors compat |
| `orders/wrangler.toml` | R2 binding |
| `src/types.ts` | FlavorGroup type, Product update |
| `src/utils/api.ts` | Type updates, uploadImage function |
| `src/pages/Products.tsx` | Flavor groups editor, name_es, emoji, image upload |
| `order.html` | Flavor group rendering, addToCart parsing, toastEmoji fix, cart image logic |
| `src/data/seedData.ts` | flavor_groups examples |

## 10. Not Changed

- D1 migrations (no schema change needed — flavors column reused)
- No new Worker (upload via existing API Worker)
- No Pages reconfig (same deploy flow)
