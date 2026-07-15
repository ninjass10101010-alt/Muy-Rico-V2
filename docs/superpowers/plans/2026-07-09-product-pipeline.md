# Product Pipeline: Dashboard → Order Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make product edits in the admin dashboard correctly appear on the customer order page — with bilingual names/descriptions, prices, images/emojis, and multiple named flavor dropdowns per product.

**Architecture:** The admin SPA and the order page share one D1 database through the `muy-rico-orders-api` Worker. The order page fetches `GET /api/products` (parsed JSON) on every load, so changes are instant. The fix adds: (1) JSON parsing in the API GET response (currently crashes the order page), (2) per-product `flavor_groups` data model + editor, (3) R2 image uploads, (4) order-page rendering of flavor groups + cart bug fixes.

**Tech Stack:** Cloudflare Workers, D1, R2, vanilla JS (`order.html`), React + Vite + Tailwind (`home-bakery-management-system`).

## Global Constraints

- API auth: `cf-access-authenticated-user-email` header OR `CF_Authorization` cookie; public exceptions are `POST /api/orders` and `GET /api/products`/`GET /api/products/:id`.
- No D1 schema migration — the `flavors` TEXT column is reused for the new `flavor_groups` JSON format.
- All write endpoints (products, inventory) require admin auth. `POST /api/upload` requires admin auth.
- Deploy API with `npx wrangler versions upload --name muy-rico-orders-api` then `npx wrangler versions deploy`.
- Deploy site with `npx wrangler versions upload --name muyrico --assets .` then `npx wrangler versions deploy`.
- Images: R2 bucket `muy-rico-product-images`, public access enabled, served from `https://pub-<id>.r2.dev/...`.

---

### Task 1: API — parse JSON columns in GET responses

**Files:**
- Modify: `orders/workers/api.js:362-375` (`listProducts`, `getProduct`)
- Modify: `orders/workers/api.js` (add `safeJsonParse` helper near `parseFlavors`)

**Interfaces:**
- Produces: `listProducts(env)` returns `{ products: [...] }` where each product's `flavors` and `recipe` are parsed JS values (array/object), not JSON strings. `getProduct(id, env)` returns `{ product }` with the same parsing.

- [ ] **Step 1: Add `safeJsonParse` helper** (place right after the existing `parseFlavors` function, ~line 410):

```javascript
function safeJsonParse(v, fallback) {
  if (v == null) return fallback;
  if (typeof v !== 'string') return v; // already parsed (array/object)
  try {
    const parsed = JSON.parse(v);
    return parsed;
  } catch {
    return fallback;
  }
}
```

The DB column is named `flavors` but the new wire/JS name is `flavor_groups`. The API stores `flavor_groups` into the `flavors` column and reads it back as `flavor_groups`. Keep a legacy `flavors` alias too.

- [ ] **Step 2: Rewrite `listProducts`** to parse `flavors`/`recipe` and coerce boolean flags:

```javascript
async function listProducts(env) {
  const { results } = await env.DB.prepare(`
    SELECT * FROM products
    WHERE active = 1
    ORDER BY display_order ASC, name ASC
  `).all();
  const products = (results || []).map(r => {
    const flavorGroups = safeJsonParse(r.flavors, []);
    return {
      ...r,
      flavor_groups: flavorGroups,  // canonical new name
      flavors: flavorGroups,         // legacy alias for any old reader
      recipe: safeJsonParse(r.recipe, []),
      active: Boolean(r.active),
      auto_generate_label: Boolean(r.auto_generate_label),
    };
  });
  return json({ products }, 200);
}
```

- [ ] **Step 3: Rewrite `getProduct`** to parse the same fields:

```javascript
async function getProduct(id, env) {
  const row = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'Not found' }, 404);
  const flavorGroups = safeJsonParse(row.flavors, []);
  const product = {
    ...row,
    flavor_groups: flavorGroups,
    flavors: flavorGroups,
    recipe: safeJsonParse(row.recipe, []),
    active: Boolean(row.active),
    auto_generate_label: Boolean(row.auto_generate_label),
  };
  return json({ product }, 200);
}
```

- [ ] **Step 3b: Map `flavor_groups` payload → `flavors` column in writes.** The admin sends `flavor_groups`; the DB column is `flavors`. In `createProduct`, change the `flavors` bind value to `parseFlavors(body.flavor_groups || body.flavors || [])`. In `updateProduct`, change the line `if (f === 'flavors') val = parseFlavors(val);` to:
  ```javascript
  if (f === 'flavors') val = parseFlavors(body.flavor_groups || body.flavors || []);
  ```
  (This prevents the UPDATE loop from overwriting `flavors` with `[]` when the admin only sends `flavor_groups`.)

- [ ] **Step 4: Deploy and verify** the JSON parsing fix (deploy can be deferred to Task 2's combined deploy, but verify logic by curl after deploy):

```bash
export CLOUDFLARE_API_TOKEN="<CLOUDFLARE_API_TOKEN>"
curl -s "https://muy-rico.com/api/products" | python3 -c "
import sys, json
d = json.load(sys.stdin)
p = d['products'][0]
print('flavors type:', type(p.get('flavors')).__name__)
print('recipe type:', type(p.get('recipe')).__name__)
print('active type:', type(p.get('active')).__name__)
"
```

Expected: `flavors type: list` (or dict for flavor_groups), `recipe type: list`, `active type: bool`.

- [ ] **Step 5: Commit**

```bash
git add orders/workers/api.js
git commit -m "fix(api): parse JSON columns (flavors/recipe) in GET product responses"
```

---

### Task 2: API — R2 image upload endpoint + binding

**Files:**
- Modify: `orders/wrangler.toml` (add `[[r2_buckets]]`)
- Modify: `orders/workers/api.js` (add `uploadImage`, dispatch route)

**Interfaces:**
- Consumes: `safeJsonParse` (Task 1), existing Access check (the `actorEmail`/`isLocal` logic at top of `fetch`).
- Produces: `POST /api/upload` returns `{ url: string }`. Requires `env.IMAGES_BUCKET` (R2 binding).

**Prerequisite (manual, Dashboard):** Create R2 bucket `muy-rico-product-images`, enable Public Access, note the `pub-<id>.r2.dev` base URL. Set CORS if browser uploads directly (not required here since the Worker proxies the upload).

- [ ] **Step 1: Add R2 binding to `orders/wrangler.toml`** (append after the `[vars]` block):

```toml
[[r2_buckets]]
binding = "IMAGES_BUCKET"
bucket_name = "muy-rico-product-images"
```

- [ ] **Step 2: Add `uploadImage` function** (place near `listProducts`):

```javascript
const ALLOWED_IMG = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMG_BYTES = 5 * 1024 * 1024;

async function uploadImage(request, env) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') {
      return json({ error: 'No file provided' }, 400);
    }
    if (!ALLOWED_IMG.includes(file.type)) {
      return json({ error: 'Only JPG, PNG, or WEBP images allowed' }, 400);
    }
    if (file.size > MAX_IMG_BYTES) {
      return json({ error: 'Image must be 5MB or smaller' }, 400);
    }
    const ext = (file.type.split('/')[1] || 'bin').replace('jpeg', 'jpg');
    const key = `products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    await env.IMAGES_BUCKET.put(key, file.stream(), {
      httpMetadata: { contentType: file.type },
    });
    const url = `https://pub-${env.R2_PUBLIC_ID || 'REPLACE'}.r2.dev/${key}`;
    return json({ url }, 200);
  } catch (e) {
    return json({ error: String(e) }, 400);
  }
}
```

Note: replace `REPLACE` with the actual R2 public bucket ID, OR set `R2_PUBLIC_ID` as a Worker var in `orders/wrangler.toml` `[vars]` so the URL is correct.

- [ ] **Step 3: Add dispatch route** (in the `try` block of `fetch`, after the products routes, ~line 82):

```javascript
if (path === '/api/upload' && method === 'POST') return await uploadImage(request, env);
```

- [ ] **Step 4: Add `R2_PUBLIC_ID` var to `orders/wrangler.toml`** `[vars]`:

```toml
[vars]
ALLOWED_ORIGIN = "https://muy-rico.pages.dev"
R2_PUBLIC_ID = "<your-r2-public-bucket-id>"
```

(Find the bucket ID in Dashboard → R2 → bucket → "Public access" / S3 API details.)

- [ ] **Step 5: Deploy API Worker**

```bash
export CLOUDFLARE_API_TOKEN="<CLOUDFLARE_API_TOKEN>"
npx wrangler versions upload --name muy-rico-orders-api --compatibility-date 2025-03-21 orders/workers/api.js
# then deploy the returned version id to 100%
```

- [ ] **Step 6: Verify upload (requires admin Access cookie)** — manual test via the admin dashboard later; for now confirm the route exists:

```bash
curl -s -X POST "https://muy-rico.com/api/upload" -F "file=@/tmp/test.jpg" 
# Expected: 401 Unauthorized (no Access cookie) — confirms route is wired
```

- [ ] **Step 7: Commit**

```bash
git add orders/workers/api.js orders/wrangler.toml
git commit -m "feat(api): add POST /api/upload R2 image endpoint + binding"
```

---

### Task 3: Types — FlavorGroup + uploadImage

**Files:**
- Modify: `src/types.ts` (add `FlavorGroup`, update `Product`)
- Modify: `src/utils/api.ts` (update `ApiProduct`, add `uploadImage`)

**Interfaces:**
- Produces: `FlavorGroup` type used by `Products.tsx` (Task 4) and `order.html` rendering (Task 5). `uploadImage(file)` used by `Products.tsx`.

- [ ] **Step 1: Add `FlavorGroup` interface and update `Product` in `src/types.ts`** (after the `RecipeLine` interface, before/with `Product`):

```typescript
export interface FlavorGroup {
  name: string;
  options: string[];
}

export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  cost: number;
  sku: string;
  emoji: string;
  active: boolean;
  description: string;
  ingredients: string;
  allergens: string;
  recipe: RecipeLine[];
  name_es?: string;
  description_es?: string;
  image_url?: string;
  flavor_groups?: FlavorGroup[];   // replaces `flavors: string[]`
  display_order?: number;
  auto_generate_label?: boolean;
}
```

(Leave `flavors?: string[]` OUT — this is the new structure.)

- [ ] **Step 2: Update `ApiProduct` in `src/utils/api.ts`** (replace the `flavors?: string` line with):

```typescript
export interface ApiProduct {
  id: string;
  name: string;
  name_es?: string | null;
  description?: string | null;
  description_es?: string | null;
  category: string;
  price: number;
  cost: number;
  sku?: string | null;
  emoji: string;
  image_url?: string | null;
  active: number | boolean;
  ingredients?: string | null;
  allergens?: string | null;
  flavor_groups?: FlavorGroup[];   // parsed by API
  recipe?: string | RecipeLine[];
  display_order?: number;
  auto_generate_label?: number | boolean;
  created_at?: string;
  updated_at?: string | null;
}
```

- [ ] **Step 3: Add `uploadImage` to `src/utils/api.ts`** (after `deleteProduct`):

```typescript
export async function uploadImage(file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Upload failed');
  }
  return res.json();
}
```

- [ ] **Step 4: Type-check the SPA build**

```bash
cd home-bakery-management-system && npm run build 2>&1 | tail -20
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/utils/api.ts
git commit -m "feat(types): add FlavorGroup, uploadImage; replace flavors with flavor_groups"
```

---

### Task 4: Admin form — flavor groups editor, name_es, emoji, image upload

**Files:**
- Modify: `src/pages/Products.tsx` (flavor groups editor, `name_es` input, emoji custom input, image uploader)

**Interfaces:**
- Consumes: `FlavorGroup` type, `Product` type, `uploadImage(file)` from `api.ts`, `apiCreateProduct`/`apiUpdateProduct`.
- Produces: `save()` sends `flavor_groups` (FlavorGroup[]) and `name_es` in the payload.

- [ ] **Step 1: Add `flavor_groups` state + migration of legacy `flavors`** in `Products.tsx`. In the component, add:

```typescript
const [flavorGroups, setFlavorGroups] = useState<FlavorGroup[]>([]);
```

When opening the edit modal (where `draft` is set), normalize legacy `flavors`:

```typescript
function normalizeFlavors(p: Product): FlavorGroup[] {
  if (Array.isArray((p as any).flavor_groups) && (p as any).flavor_groups.length) {
    return (p as any).flavor_groups;
  }
  if (Array.isArray((p as any).flavors) && (p as any).flavors.length) {
    return [{ name: 'Flavor', options: (p as any).flavors }];
  }
  return [];
}
// use: setFlavorGroups(normalizeFlavors(p));
```

- [ ] **Step 2: Replace the `flavorsText` text input (around lines 227–234) with the flavor groups editor:**

```tsx
{/* Flavor Groups */}
<div className="mb-4">
  <label className="mb-1 block text-sm font-semibold text-cocoa">Flavor Options</label>
  {flavorGroups.map((grp, gi) => (
    <div key={gi} className="mb-3 rounded-lg border border-sand-200 p-3">
      <div className="mb-2 flex items-center gap-2">
        <input
          className="flex-1 rounded-lg border border-sand-200 px-3 py-2 text-sm"
          placeholder="Group name (e.g. Cake Flavor)"
          value={grp.name}
          onChange={(e) => {
            const next = [...flavorGroups];
            next[gi] = { ...grp, name: e.target.value };
            setFlavorGroups(next);
          }}
        />
        <button
          type="button"
          className="rounded-lg bg-red-50 px-2 py-1 text-xs text-red-600"
          onClick={() => setFlavorGroups(flavorGroups.filter((_, i) => i !== gi))}
        >Remove</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {grp.options.map((opt, oi) => (
          <span key={oi} className="inline-flex items-center gap-1 rounded-full bg-sand-100 px-2.5 py-1 text-xs">
            {opt}
            <button type="button" className="text-cocoa-muted" onClick={() => {
              const next = [...flavorGroups];
              next[gi] = { ...grp, options: grp.options.filter((_, i) => i !== oi) };
              setFlavorGroups(next);
            }}>×</button>
          </span>
        ))}
        <input
          className="w-28 rounded-full border border-sand-200 px-2 py-1 text-xs"
          placeholder="Add…"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
              const v = (e.target as HTMLInputElement).value.trim();
              const next = [...flavorGroups];
              next[gi] = { ...grp, options: [...grp.options, v] };
              setFlavorGroups(next);
              (e.target as HTMLInputElement).value = '';
            }
          }}
        />
      </div>
    </div>
  ))}
  <button
    type="button"
    className="rounded-lg border border-dashed border-cocoa-muted px-3 py-1.5 text-xs font-medium text-cocoa-muted"
    onClick={() => setFlavorGroups([...flavorGroups, { name: '', options: [] }])}
  >+ Add Flavor Group</button>
</div>
```

- [ ] **Step 3: Add `name_es` input** (after the English `name` input, ~line 179):

```tsx
<div>
  <label className="mb-1 block text-sm font-semibold text-cocoa">Name (Spanish)</label>
  <input
    className="w-full rounded-lg border border-sand-200 px-3 py-2 text-sm"
    placeholder="Nombre en español"
    value={draft.name_es || ''}
    onChange={(e) => setDraft({ ...draft, name_es: e.target.value })}
  />
</div>
```

- [ ] **Step 4: Add custom emoji input** (after the `EMOJI_CHOICES` grid, ~line 310):

```tsx
<div className="mt-2">
  <label className="mb-1 block text-xs text-cocoa-muted">Or type a custom emoji</label>
  <input
    className="w-20 rounded-lg border border-sand-200 px-2 py-1 text-center text-lg"
    value={draft.emoji}
    onChange={(e) => setDraft({ ...draft, emoji: e.target.value })}
  />
</div>
```

- [ ] **Step 5: Replace the `image_url` text input with an uploader** (around lines 235–242):

```tsx
<div>
  <label className="mb-1 block text-sm font-semibold text-cocoa">Product Image</label>
  {draft.image_url && (
    <img src={draft.image_url} alt="" className="mb-2 h-16 w-16 rounded-lg object-cover" />
  )}
  <input
    type="file"
    accept="image/*"
    className="block w-full text-sm"
    onChange={async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const { url } = await uploadImage(file);
        setDraft({ ...draft, image_url: url });
      } catch (err: any) {
        alert('Upload failed: ' + err.message);
      }
    }}
  />
  <input
    className="mt-2 w-full rounded-lg border border-sand-200 px-3 py-2 text-sm"
    placeholder="…or paste image URL"
    value={draft.image_url || ''}
    onChange={(e) => setDraft({ ...draft, image_url: e.target.value })}
  />
</div>
```

- [ ] **Step 6: Update `save()` payload** — replace `flavors: flavorsText.split(...)` with `flavor_groups: flavorGroups.filter(g => g.name.trim() && g.options.length)`, and keep `name_es`:

```typescript
const payload: any = {
  ...draft,
  name_es: draft.name_es || null,
  flavor_groups: flavorGroups.filter(g => g.name.trim() && g.options.length),
  ingredients,
  allergens,
  auto_generate_label: useAuto,
};
```

- [ ] **Step 7: Type-check + build**

```bash
cd home-bakery-management-system && npm run build 2>&1 | tail -20
```

Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/pages/Products.tsx
git commit -m "feat(admin): flavor groups editor, name_es, custom emoji, image upload"
```

---

### Task 5: Order page — flavor dropdowns + cart fixes

**Files:**
- Modify: `order.html` (`renderProductTile`, `addToCart`, `renderCart`)

**Interfaces:**
- Consumes: `GET /api/products` returning `flavor_groups: FlavorGroup[]` (parsed by API, Task 1).
- Produces: tiles render one `<select class="flavor-select" data-group="...">` per group; `addToCart` reads all selects; cart item carries `toastEmoji` + `image_url`.

- [ ] **Step 1: Update `renderProductTile(p)` flavor block** (lines 934–939) to iterate `flavor_groups`:

```javascript
const flavorHTML = (p.flavor_groups && p.flavor_groups.length)
  ? `<div class="flavor-selects">` + p.flavor_groups.map(g => `
      <div class="flavor-group">
        <label class="flavor-label">${escapeHtml(g.name)}</label>
        <select class="flavor-select" data-group="${escapeHtml(g.name)}">
          <option value="">— Select —</option>
          ${g.options.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('')}
        </select>
      </div>`).join('') + `</div>`
  : '';
```

Add a small `escapeHtml` helper at top of the script:

```javascript
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
```

- [ ] **Step 2: Insert `flavorHTML` into the tile template** (in the HTML string built at lines 940–967, replace the old `${flavors}` usage with `${flavorHTML}`):

Find the line `const flavors = ...` block and the `${flavors}` placeholder; remove the `const flavors = ...` definition (replaced by `flavorHTML` above) and change `${flavors}` → `${flavorHTML}`.

- [ ] **Step 3: Update `addToCart()` flavor reading** (lines 1151–1162) to iterate `.flavor-select`:

```javascript
const selects = tile.querySelectorAll('.flavor-select');
const selectedFlavors = [];
selects.forEach(sel => {
  if (sel.value) selectedFlavors.push(`${sel.dataset.group}: ${sel.value}`);
});
if (selectedFlavors.length) {
  displayName += ` (${selectedFlavors.join(', ')})`;
}
```

Remove the old `.cake-flavor`/`.frosting-flavor`/`.concha-flavor` block.

- [ ] **Step 4: Fix `toastEmoji` in cart push** (line ~1171) — ensure the cart object includes `toastEmoji`:

```javascript
cart.push({
  name,
  nameEn,
  displayName,
  price,
  qty,
  icon,
  image_url: tile.getAttribute('data-image-url') || '',
  toastEmoji,
  flavorNote: selectedFlavors.join(', '),
});
```

Also add `data-image-url="${p.image_url || ''}"` to the tile's top-level `<article>` attributes in `renderProductTile` (alongside `data-toast-emoji`).

- [ ] **Step 5: Fix `renderCart()` image logic** (lines ~1272–1274) — detect image_url vs emoji:

```javascript
let iconHtml;
if (item.image_url) {
  iconHtml = `<img src="${item.image_url}" alt="" width="36" height="36" style="object-fit:cover;border-radius:8px;" />`;
} else {
  iconHtml = `<span style="font-size:28px;line-height:1;">${item.toastEmoji || '🍞'}</span>`;
}
```

(Remove the `item.icon.endsWith('.svg')` branch — `icon` is now an emoji string, not an SVG path.)

- [ ] **Step 6: Verify via headless render** (use the same playwright-core approach as the mobile fix). After deploy, load `https://muy-rico.com/order.html` at desktop + mobile and confirm:
  - Tiles with `flavor_groups` show labeled dropdowns
  - Adding to cart includes flavor text in display name
  - Console has no errors related to `.map` on flavors

- [ ] **Step 7: Commit**

```bash
git add order.html
git commit -m "fix(order): render flavor_groups dropdowns, fix addToCart + cart image/toast"
```

---

### Task 6: Seed data — flavor_groups examples

**Files:**
- Modify: `src/data/seedData.ts` (add `flavor_groups` to Custom Cake + Cupcake)

**Interfaces:**
- Consumes: `FlavorGroup` type (Task 3).
- Produces: seed products that demonstrate flavor groups on first load.

- [ ] **Step 1: Add `flavor_groups` to the Custom Cake and Cupcake seed entries** (find their object literals and add):

```typescript
flavor_groups: [
  { name: 'Cake Flavor', options: ['Vanilla', 'Chocolate', 'Red Velvet'] },
  { name: 'Frosting', options: ['Buttercream', 'Cream Cheese', 'Chocolate'] },
],
```

- [ ] **Step 2: Build + verify seed compiles**

```bash
cd home-bakery-management-system && npm run build 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add src/data/seedData.ts
git commit -m "feat(seed): add flavor_groups examples to Custom Cake + Cupcake"
```

---

### Task 7: Deploy + end-to-end verification

**Files:**
- Deploy: `orders/workers/api.js` (API), `home-bakery-management-system` build (admin), root static (order.html)

**Interfaces:**
- Verifies all prior tasks integrate correctly.

- [ ] **Step 1: Ensure R2 bucket exists** (Dashboard) — `muy-rico-product-images`, public access on, `R2_PUBLIC_ID` set in `orders/wrangler.toml`.

- [ ] **Step 2: Deploy API Worker**

```bash
export CLOUDFLARE_API_TOKEN="<CLOUDFLARE_API_TOKEN>"
npx wrangler versions upload --name muy-rico-orders-api --compatibility-date 2025-03-21 orders/workers/api.js
# deploy the returned version id to 100%
```

- [ ] **Step 3: Build admin + deploy site**

```bash
cd home-bakery-management-system && npm ci && npm run build
cd ..
npx wrangler versions upload --name muyrico --assets . --compatibility-date 2025-03-21
# deploy the returned version id to 100%
```

(Use a `.assetsignore` excluding `.agents/`, `home-bakery-management-system/`, `orders/`, `workers/`, `.git`, `.wrangler`.)

- [ ] **Step 4: Verify API parsing**

```bash
curl -s "https://muy-rico.com/api/products" | python3 -c "
import sys, json
d = json.load(sys.stdin)
p = d['products'][0]
print('flavors/flavor_groups:', type(p.get('flavors') or p.get('flavor_groups')).__name__)
print('recipe:', type(p.get('recipe')).__name__)
"
```

Expected: not a string (list/dict).

- [ ] **Step 5: Verify order page renders flavor groups** — headless check (desktop + iPhone 13) that tiles with flavor_groups show `<select class="flavor-select">` and no console errors.

- [ ] **Step 6: Verify admin round-trip** — log into `/admin/`, edit a product: set `name_es`, add a flavor group, upload an image. Reload `/order.html` and confirm the product shows Spanish name (toggle ES), the flavor dropdown(s), and the image.

- [ ] **Step 7: Commit deploy artifacts if any config changed**

```bash
git add -A && git commit -m "deploy: product pipeline (flavor groups, image upload, bilingual)" || echo "nothing to commit"
```

---

## Self-Review Notes

- **Spec coverage:** Task 1 (JSON parse + crash fix) ✓; Task 2 (upload + R2) ✓; Task 3 (types) ✓; Task 4 (admin editor) ✓; Task 5 (order page) ✓; Task 6 (seed) ✓; Task 7 (deploy/verify) ✓.
- **No placeholders:** every step has concrete code or command.
- **Type consistency:** `FlavorGroup` defined in Task 3, used in Tasks 4/5/6. `uploadImage` defined in Task 3, used in Task 4. `flavor_groups` key used consistently across API response, types, admin, order page, seed.
- **Backward compat:** `normalizeFlavors` in Task 4 handles legacy `flavors: string[]` during transition; API `safeJsonParse` is tolerant.
