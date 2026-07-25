# Spec A: Operational Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the six operational fixes (hidden products, payment edit, manual-order packs, cupcakes dozen, mini cinnamon rolls, new flavors) plus the DB-level emoji-to-SVG icon swap.

**Architecture:** One new D1 column (`products.show_online`), small targeted changes to `orders/workers/api.js`, a handful of admin-dashboard edits behind `?include_hidden=1`, and two idempotent SQL migrations (schema + menu data). Public static pages need no changes. Spec: `docs/superpowers/specs/2026-07-24-operational-fixes-design.md`.

**Tech Stack:** Cloudflare Workers + D1, React 19 + Vite + Tailwind 4 (admin SPA), vanilla HTML/JS (public).

## Global Constraints

- Append-only data changes: no existing prices, flavor options, descriptions, or legal copy change.
- Order item naming convention must match the website exactly: `Name (PackLabel) (Flavor: X)`.
- No refunds/charges anywhere; payment edits are record corrections only.
- Deploy order: API worker → migration 0019 → admin SPA → migration 0020 (admin's ProductIcon must be live before DB emoji become filenames).
- Emoji policy: new UI uses icons, not emoji.
- Copy rule: no em-dashes in newly authored user-facing strings.

---

### Task 1: SQL migrations

**Files:**
- Create: `orders/migrations/0019_show_online.sql`
- Create: `orders/migrations/0020_menu_updates.sql`

**Interfaces:**
- Produces: `products.show_online INTEGER NOT NULL DEFAULT 1`; menu data consumed by Tasks 5-8 verification.

- [ ] **Step 1: Create `orders/migrations/0019_show_online.sql`**

```sql
-- 0019: products.show_online — hide a product from the website while keeping it sellable in admin
ALTER TABLE products ADD COLUMN show_online INTEGER NOT NULL DEFAULT 1;
```

- [ ] **Step 2: Create `orders/migrations/0020_menu_updates.sql`** (idempotent; fixed ids; current live values verified 2026-07-24)

```sql
-- 0020: menu updates — cupcakes dozen pack, new cake flavors, mini cinnamon rolls, emoji -> svg icons

-- Cupcakes: half-dozen base pack + dozen discount pack
UPDATE products SET pack_sizes = '[{"id":"half-dozen","label":"Half Dozen (6)","label_es":"Media Docena (6)","price":18,"qty":6,"unit_label":"$3.00 ea","unit_label_es":"$3.00 c/u"},{"id":"dozen","label":"Dozen (12)","label_es":"Docena (12)","price":30,"qty":12,"badge":"Save $6","badge_es":"¡Ahorra $6!","unit_label":"$2.50 ea","unit_label_es":"$2.50 c/u"}]'
WHERE id = 'prod_cupcakes';

-- New cake flavors on cupcakes + custom cake (Cake group; Frosting untouched)
UPDATE products SET flavors = '[{"name":"Cake","name_es":"Bizcocho","options":["Chocolate","Vanilla","Strawberry","Funfetti","Red Velvet","Marble","Lemon"]},{"name":"Frosting","name_es":"Betún","options":["Vanilla Buttercream","Chocolate Buttercream"]}]'
WHERE id = 'prod_cupcakes';
UPDATE products SET flavors = '[{"name":"Cake","name_es":"Bizcocho","options":["Chocolate","Vanilla","Strawberry","Funfetti","Red Velvet","Marble","Lemon"]},{"name":"Frosting","name_es":"Betún","options":["Vanilla Buttercream","Chocolate Buttercream"]}]'
WHERE id = 'prod_custom_cake';

-- Mini Cinnamon Rolls (new product; ingredients/allergens intentionally blank for owner to fill)
INSERT OR REPLACE INTO products
  (id, name, name_es, description, description_es, category, price, cost, sku, emoji, image_url,
   active, show_online, ingredients, allergens, flavors, pack_sizes, recipe, display_order, auto_generate_label, featured)
VALUES
  ('prod_mini_cinnamon_rolls', 'Mini Cinnamon Rolls', 'Mini Roles de Canela',
   'Bite-size cinnamon rolls, soft and swirled with cinnamon sugar. Sold by the half dozen or by the dozen.',
   'Roles de canela en tamaño mini, suaves y llenos de azúcar y canela. Por media docena o por docena.',
   'Cinnamon Rolls', 12, 0, 'MR-MCR', 'cinnamon-roll.svg', NULL,
   1, 1, '', '', '[]',
   '[{"id":"half-dozen","label":"Half Dozen (6)","label_es":"Media Docena (6)","price":12,"qty":6,"unit_label":"$2.00 ea","unit_label_es":"$2.00 c/u"},{"id":"dozen","label":"Dozen (12)","label_es":"Docena (12)","price":20,"qty":12,"badge":"Save $4","badge_es":"¡Ahorra $4!","unit_label":"$1.67 ea","unit_label_es":"$1.67 c/u"}]',
   '[]', 100, 1, 0);

-- Emoji -> SVG icon filenames (public order page already renders .svg icons)
UPDATE products SET emoji = 'cookies.svg'      WHERE id = 'prod_cookie';
UPDATE products SET emoji = 'conchas.svg'      WHERE id = 'prod_conchas';
UPDATE products SET emoji = 'bolillos.svg'     WHERE id = 'prod_bolillos';
UPDATE products SET emoji = 'tortilla.svg'     WHERE id = 'prod_tortillas';
UPDATE products SET emoji = 'empanada.svg'     WHERE id = 'prod_empanadas';
UPDATE products SET emoji = 'cakepop.svg'      WHERE id = 'prod_cakepop';
UPDATE products SET emoji = 'cake.svg'         WHERE id = 'prod_custom_cake';
UPDATE products SET emoji = 'cupcake.svg'      WHERE id = 'prod_cupcakes';
UPDATE products SET emoji = 'cookies.svg'      WHERE id = 'prod_mrzgdqza';
UPDATE products SET emoji = 'cinnamon-roll.svg' WHERE id = 'prod_mrwvp8n0';
```

- [ ] **Step 3: Commit**

```bash
git add orders/migrations/0019_show_online.sql orders/migrations/0020_menu_updates.sql
git commit -m "feat: migrations 0019 (products.show_online) + 0020 (menu updates, emoji->svg)"
```

---

### Task 2: API — show_online in product endpoints

**Files:**
- Modify: `orders/workers/api.js:111` (router), `:1124-1144` (listProducts), `:1146-1161` (getProduct), `:1163-1169` (PRODUCT_FIELDS), `:1180-1206` (createProduct), `:1222-1224` (updateProduct coercion)

**Interfaces:**
- Consumes: migration 0019 column.
- Produces: `GET /api/products` (public: `active=1 AND show_online=1`); `GET /api/products?include_hidden=1` (auth-gated via `actorEmail`, returns `active=1`); `show_online` accepted in POST/PATCH and returned in mappings.

- [ ] **Step 1: listProducts gains includeHidden + show_online mapping**

Replace the `listProducts` function:

```js
async function listProducts(env, includeHidden) {
  const where = includeHidden
    ? 'WHERE active = 1'
    : 'WHERE active = 1 AND show_online = 1';
  const { results } = await env.DB.prepare(`
    SELECT * FROM products
    ${where}
    ORDER BY display_order ASC, name ASC
  `).all();
  const products = (results || []).map(r => {
    const flavorGroups = migrateFlavorGroups(safeJsonParse(r.flavors, []));
    return {
      ...r,
      flavor_groups: flavorGroups,
      flavors: flavorGroups,
      pack_sizes: safeJsonParse(r.pack_sizes, []),
      recipe: safeJsonParse(r.recipe, []),
      active: Boolean(r.active),
      auto_generate_label: Boolean(r.auto_generate_label),
      featured: Boolean(r.featured),
      show_online: r.show_online === undefined ? true : Boolean(r.show_online),
    };
  });
  return json({ products }, 200);
}
```

- [ ] **Step 2: Router passes the auth-gated flag**

Replace router line 111:

```js
      if (path === '/api/products' && method === 'GET') return await listProducts(env, url.searchParams.get('include_hidden') === '1' && !!actorEmail);
```

- [ ] **Step 3: getProduct mapping**

Add to the `product` object in `getProduct`: `show_online: row.show_online === undefined ? true : Boolean(row.show_online),`

- [ ] **Step 4: PRODUCT_FIELDS + createProduct + coercion**

Add `'show_online'` to `PRODUCT_FIELDS` (after `'featured'`).
In `createProduct` INSERT: add `show_online` to the column list and one more `?`, with bind `body.show_online === false ? 0 : 1` (after `featured` bind).
In `updateProduct`: change the coercion line to `if (f === 'active' || f === 'featured' || f === 'auto_generate_label' || f === 'show_online') val = val ? 1 : 0;`

- [ ] **Step 5: Verify locally**

```bash
npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --local --file=orders/migrations/0019_show_online.sql
npx wrangler dev -c orders/wrangler.toml --local --port 8787 &
curl -s "localhost:8787/api/products" | python3 -c "import json,sys; ps=json.load(sys.stdin)['products']; print(len(ps), all('show_online' in p for p in ps))"
curl -s "localhost:8787/api/products?include_hidden=1" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['products']))"
```
Expected: first prints `11 True` (after 0020 applied in Task 9; 10 before), both counts equal until something is hidden.

- [ ] **Step 6: Commit**

```bash
git add orders/workers/api.js
git commit -m "feat(api): products.show_online — public filter, auth-gated include_hidden"
```

---

### Task 3: API — gallery filter + payment_sub_method + payments sync

**Files:**
- Modify: `orders/workers/api.js:474-496` (updateOrder), `:1269-1282` (listGallery)

**Interfaces:**
- Produces: `PATCH /api/orders/:id` accepts `payment_sub_method` and syncs latest active `payments` row on method change; `GET /api/gallery` excludes photos of hidden products.

- [ ] **Step 1: updateOrder — allow payment_sub_method + sync payments**

Replace the `allowed` array:
```js
  const allowed = ['status', 'payment_status', 'notes', 'pickup_date', 'pickup_time', 'payment_method', 'payment_sub_method', 'food_coloring'];
```

Insert after the orders `UPDATE` block (before the `order_events` insert):

```js
  // Keep the latest recorded payment in sync when the method is corrected
  if (body.payment_method !== undefined) {
    const latest = await env.DB.prepare(
      `SELECT id FROM payments WHERE order_id = ? AND active = 1 ORDER BY created_at DESC, id DESC LIMIT 1`
    ).bind(id).first();
    if (latest) {
      await env.DB.prepare(
        `UPDATE payments SET method = ?, method_details = COALESCE(?, method_details) WHERE id = ?`
      ).bind(body.payment_method, body.payment_sub_method ?? null, latest.id).run();
    }
  }
```

- [ ] **Step 2: listGallery — hide photos of hidden products**

Change the WHERE clause:
```sql
    WHERE g.active = 1
      AND (p.show_online IS NULL OR p.show_online = 1)
```

- [ ] **Step 3: Verify locally** (dev server from Task 2)

```bash
curl -s -X PATCH localhost:8787/api/orders/1 -H 'Content-Type: application/json' -d '{"payment_method":"cash","payment_sub_method":null}'
curl -s "localhost:8787/api/gallery" | python3 -c "import json,sys; print('photos:', len(json.load(sys.stdin)['photos']))"
```
Expected: `{"ok":true}`; gallery still lists photos (nothing hidden yet).

- [ ] **Step 4: Commit**

```bash
git add orders/workers/api.js
git commit -m "feat(api): gallery honors show_online; order PATCH accepts payment_sub_method and syncs payments"
```

---

### Task 4: cinnamon-roll.svg asset

**Files:**
- Create: `cinnamon-roll.svg`

**Interfaces:**
- Produces: icon file used by `prod_mrwvp8n0` and `prod_mini_cinnamon_rolls`, rendered by public toast/cart logic and admin ProductIcon.

- [ ] **Step 1: Create the icon** (same family as `bolillos.svg`: 140×100, radial-gradient crust, shadow)

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 100" fill="none">
  <defs>
    <radialGradient id="crDough" cx="50%" cy="45%" r="55%">
      <stop offset="0%" stop-color="#EBC37A"/>
      <stop offset="45%" stop-color="#DCA84F"/>
      <stop offset="80%" stop-color="#C4863A"/>
      <stop offset="100%" stop-color="#A8742C"/>
    </radialGradient>
  </defs>
  <ellipse cx="70" cy="80" rx="42" ry="8" fill="#C4A86C" opacity="0.25"/>
  <circle cx="70" cy="50" r="38" fill="url(#crDough)"/>
  <path d="M70 50 m0 -26 a26 26 0 1 1 -18 7.5" stroke="#8B5C1A" stroke-width="6" fill="none" stroke-linecap="round"/>
  <path d="M70 50 m0 -15 a15 15 0 1 1 -10.4 4.2" stroke="#8B5C1A" stroke-width="5.5" fill="none" stroke-linecap="round"/>
  <path d="M70 50 m0 -5 a5 5 0 1 1 -3.5 1.4" stroke="#8B5C1A" stroke-width="5" fill="none" stroke-linecap="round"/>
  <path d="M44 34 C50 22 90 22 96 34" stroke="#F7EBD2" stroke-width="4.5" fill="none" stroke-linecap="round" opacity="0.85"/>
  <path d="M40 46 C34 52 36 60 44 62" stroke="#F7EBD2" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.7"/>
  <circle cx="52" cy="68" r="2" fill="#D4964A" opacity="0.4"/>
  <circle cx="88" cy="66" r="1.8" fill="#D4A24E" opacity="0.35"/>
  <circle cx="76" cy="72" r="1.5" fill="#DEB060" opacity="0.3"/>
</svg>
```

- [ ] **Step 2: Verify it renders** (serve root, open in Playwright, screenshot shows a swirl roll with glaze)

- [ ] **Step 3: Commit**

```bash
git add cinnamon-roll.svg
git commit -m "feat: cinnamon-roll.svg product icon"
```

---

### Task 5: Admin — include_hidden fetch + ProductIcon + type

**Files:**
- Modify: `home-bakery-management-system/src/utils/api.ts` (products fetch line ~179)
- Modify: `home-bakery-management-system/src/types.ts:32-53` (Product)
- Create: `home-bakery-management-system/src/components/ProductIcon.tsx`

**Interfaces:**
- Produces: `Product.show_online?: boolean`; `<ProductIcon emoji size className/>` used by Tasks 6-8.

- [ ] **Step 1: api.ts products fetch**

Change `apiFetch<{ products: ApiProduct[] }>("/api/products")` to `apiFetch<{ products: ApiProduct[] }>("/api/products?include_hidden=1")`.

- [ ] **Step 2: types.ts**

Add to `Product`: `show_online?: boolean;`

- [ ] **Step 3: ProductIcon component**

```tsx
export default function ProductIcon({ emoji, size = 18, className = "" }: {
  emoji?: string | null;
  size?: number;
  className?: string;
}) {
  if (emoji && emoji.endsWith(".svg")) {
    return (
      <img
        src={`/${emoji}`}
        alt=""
        width={size}
        height={size}
        className={className}
        style={{ objectFit: "contain", display: "inline-block", verticalAlign: "middle" }}
      />
    );
  }
  return (
    <span className={className} style={{ fontSize: size, lineHeight: 1 }}>
      {emoji || "\u{1F35E}"}
    </span>
  );
}
```

- [ ] **Step 4: Verify build compiles**

```bash
cd home-bakery-management-system && npx tsc --noEmit 2>&1 | head -5 || true
```
Expected: no errors mentioning ProductIcon/show_online.

- [ ] **Step 5: Commit**

```bash
git add home-bakery-management-system/src/utils/api.ts home-bakery-management-system/src/types.ts home-bakery-management-system/src/components/ProductIcon.tsx
git commit -m "feat(admin): include_hidden product fetch, ProductIcon, show_online type"
```

---

### Task 6: Admin — Products page toggle + Hidden badge + icon rendering

**Files:**
- Modify: `home-bakery-management-system/src/pages/Products.tsx` (~:150 emoji cell, ~:157 Inactive badge, ~:538 Active checkbox)

**Interfaces:**
- Consumes: ProductIcon, `Product.show_online`.

- [ ] **Step 1: List row icon + Hidden badge**

Import `ProductIcon` from `../components/ProductIcon`.
Replace the `{p.emoji}` cell (~line 150) with `<ProductIcon emoji={p.emoji} size={22} />`.
After the `{!p.active && (... Inactive ...)}` badge add:

```tsx
              {p.show_online === false && (
                <span className="rounded-full bg-sand-200 px-2 py-0.5 text-[10px] font-semibold text-cocoa-muted">
                  Hidden
                </span>
              )}
```

- [ ] **Step 2: Editor toggle**

After the Active checkbox block (~line 538-540), add:

```tsx
            <label className="flex items-center gap-2 text-sm text-cocoa">
              <input
                type="checkbox"
                checked={draft.show_online !== false}
                onChange={(e) => setDraft({ ...draft, show_online: e.target.checked })}
              />
              Show on website
              <span className="text-xs text-cocoa-muted">(off = sellable in manual orders only)</span>
            </label>
```

- [ ] **Step 3: openEdit includes show_online**

In `openEdit`, ensure the draft spread carries `show_online: p.show_online !== false` (add explicitly after spreading p, so older API rows without the field default to true).

- [ ] **Step 4: Verify** — `npx tsc --noEmit` clean; manual check in dev that toggling persists through `apiUpdateProduct`.

- [ ] **Step 5: Commit**

```bash
git add home-bakery-management-system/src/pages/Products.tsx
git commit -m "feat(admin): Show-on-website toggle + Hidden badge in Products"
```

---

### Task 7: Admin — OrderModal pack pills + hidden products in select

**Files:**
- Modify: `home-bakery-management-system/src/components/OrderModal.tsx` (:16-18 state, :32-37 derived, :42-61 addItem, :318-340 select UI, :364-374 item rows)

**Interfaces:**
- Consumes: ProductIcon, pack_sizes on products.
- Produces: item names identical to website convention `Name (PackLabel) (Flavor: X)`.

- [ ] **Step 1: Pack state + derived values**

Add state: `const [packPick, setPackPick] = useState("");` (reset when product changes).
Derive after `pickedFlavorGroups`:

```tsx
  const pickedPacks = pickedProduct?.pack_sizes ?? [];
  const activePack = pickedPacks.find((pk) => pk.id === packPick) ?? pickedPacks[0] ?? null;
```

- [ ] **Step 2: addItem uses the pack**

Replace the item push line inside `addItem`:

```tsx
      const packLabel = activePack ? ` (${currentLangLabel(activePack)})` : "";
      const packPrice = activePack ? Number(activePack.price) : p.price;
      return [...prev, { productId: p.id, name: p.name + packLabel + flavorNote, emoji: p.emoji, qty: 1, price: packPrice, flavorNote: packLabel + flavorNote }];
```
where `currentLangLabel` is a small helper in the file: `const currentLangLabel = (pk: PackSize) => pk.label;` (admin is English-first; keep label as stored). Also update the `existing` find/map comparisons to use the new `flavorNote` value consistently, and reset `setPackPick("")` after adding.

- [ ] **Step 3: Product select shows hidden badge, no raw filenames**

Replace the options block:

```tsx
              {activeProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.show_online === false ? "[Hidden] " : ""}{p.name} — ${(p.pack_sizes?.[0]?.price ?? p.price).toFixed(2)}
                </option>
              ))}
```

- [ ] **Step 4: Pack pills UI**

Between the product select row and the flavor selects, add:

```tsx
          {pickedPacks.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {pickedPacks.map((pk) => (
                <button
                  key={pk.id}
                  type="button"
                  onClick={() => setPackPick(pk.id)}
                  className={`rounded-xl border px-3 py-2 text-left text-xs transition ${
                    (activePack?.id ?? "") === pk.id
                      ? "border-palm bg-palm/10 text-cocoa"
                      : "border-sand-200 text-cocoa-muted hover:border-sand-300"
                  }`}
                >
                  <span className="block font-semibold">{pk.label}</span>
                  <span className="block">{pk.unit_label || `$${Number(pk.price).toFixed(2)}`}</span>
                  {pk.badge && <span className="mt-0.5 inline-block rounded bg-hibiscus px-1.5 py-0.5 text-[10px] font-bold text-white">{pk.badge}</span>}
                </button>
              ))}
            </div>
          )}
```

- [ ] **Step 5: Item rows use ProductIcon**

Replace `{item.emoji} {item.name}` with `<ProductIcon emoji={item.emoji} size={18} /> {item.name}`.

- [ ] **Step 6: Verify** — tsc clean; manual: pick Cupcakes → pills appear (Half Dozen $18 / Dozen $30 Save $6) → add → item shows `Cupcakes (6) (Dozen (12))` at $30.

- [ ] **Step 7: Commit**

```bash
git add home-bakery-management-system/src/components/OrderModal.tsx
git commit -m "feat(admin): pack-size pills + hidden products in New Order modal"
```

---

### Task 8: Admin — Orders payment edit

**Files:**
- Modify: `home-bakery-management-system/src/pages/Orders.tsx` (:22-25 state, :228-234 payment line, after :334 add modal)

**Interfaces:**
- Consumes: `apiUpdateOrder`, `refreshOrders` from StoreContext.

- [ ] **Step 1: State**

Add: `const [editPayFor, setEditPayFor] = useState<Order | null>(null);` and `const [editPayMethod, setEditPayMethod] = useState<PaymentMethod>("cash");` and `const [editPaySub, setEditPaySub] = useState("");`

- [ ] **Step 2: Edit action on the Payment line**

In the order detail modal payment block (~line 228), append an Edit button:

```tsx
              <button
                onClick={() => { setEditPayFor(selected); setEditPayMethod(selected.paymentMethod || "cash"); setEditPaySub(selected.paymentSubMethod || ""); }}
                className="ml-2 text-xs font-semibold text-coral hover:underline"
              >
                Edit
              </button>
```

- [ ] **Step 3: Edit modal + save**

After the Record Payment modal, add:

```tsx
      <Modal open={!!editPayFor} onClose={() => setEditPayFor(null)} title="Edit Payment Method">
        {editPayFor && (
          <div className="space-y-4">
            <p className="text-sm text-cocoa-muted">
              Correct how order {editPayFor.orderNumber} was paid. Records only; does not charge or refund. Already-sent receipts are not resent.
            </p>
            <select
              value={editPayMethod}
              onChange={(e) => setEditPayMethod(e.target.value as PaymentMethod)}
              className="w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-coral"
            >
              {enabledMethods.map((m) => (
                <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
              ))}
            </select>
            <input
              value={editPaySub}
              onChange={(e) => setEditPaySub(e.target.value)}
              placeholder="Sub-method (optional, e.g. card brand or handle)"
              className="w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-coral"
            />
            <button
              onClick={async () => {
                await apiUpdateOrder(Number(editPayFor.id), { payment_method: editPayMethod, payment_sub_method: editPaySub.trim() || null });
                await refreshOrders();
                setEditPayFor(null);
                setSelected(null);
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-mid-green to-palm py-2.5 text-sm font-semibold text-white transition hover:shadow-md"
            >
              <CheckCircle2 size={16} /> Save Payment Method
            </button>
          </div>
        )}
      </Modal>
```

- [ ] **Step 4: Verify** — tsc clean; edit an order's method; order detail + Payments page both show the new method.

- [ ] **Step 5: Commit**

```bash
git add home-bakery-management-system/src/pages/Orders.tsx
git commit -m "feat(admin): edit payment method on existing orders (syncs payment record)"
```

---

### Task 9: Full local verification

**Files:** none (verification only)

- [ ] **Step 1: Apply both migrations locally**

```bash
npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --local --file=orders/migrations/0019_show_online.sql
npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --local --file=orders/migrations/0020_menu_updates.sql
```

- [ ] **Step 2: API assertions** (dev server on 8787)

```bash
# cupcakes dozen pack
curl -s localhost:8787/api/products/prod_cupcakes | python3 -c "import json,sys; p=json.load(sys.stdin)['product']; print([ (pk['label'], pk['price']) for pk in p['pack_sizes'] ])"
# new flavors on both
curl -s localhost:8787/api/products/prod_custom_cake | python3 -c "import json,sys; print(json.load(sys.stdin)['product']['flavor_groups'][0]['options'])"
# mini rolls present + emoji svg
curl -s localhost:8787/api/products | python3 -c "import json,sys; ps=json.load(sys.stdin)['products']; m=[p for p in ps if p['id']=='prod_mini_cinnamon_rolls'][0]; print(m['name'], m['emoji'], m['show_online'])"
# hide something, check public vs include_hidden
curl -s -X PATCH localhost:8787/api/products/prod_empanadas -H 'Content-Type: application/json' -d '{"show_online": false}'
curl -s localhost:8787/api/products | python3 -c "import json,sys; print('public has empanadas:', any(p['id']=='prod_empanadas' for p in json.load(sys.stdin)['products']))"
curl -s "localhost:8787/api/products?include_hidden=1" | python3 -c "import json,sys; print('admin has empanadas:', any(p['id']=='prod_empanadas' for p in json.load(sys.stdin)['products']))"
curl -s -X PATCH localhost:8787/api/products/prod_empanadas -H 'Content-Type: application/json' -d '{"show_online": true}'
```
Expected: `[('Half Dozen (6)', 18), ('Dozen (12)', 30)]` · `['Chocolate','Vanilla','Strawberry','Funfetti','Red Velvet','Marble','Lemon']` · `Mini Cinnamon Rolls cinnamon-roll.svg True` · `False` then `True`.

- [ ] **Step 3: Build admin + Playwright pass**

`npm run build`; serve repo root; log into the built admin locally (bypass: local dev, actor `local@dev`); check Products toggle, Hidden badge, pack pills, payment edit modal. Screenshot each.

- [ ] **Step 4: Public order page against local API** — cupcakes tile shows both packs; mini rolls tile renders; add-to-cart toast shows the SVG icon.

---

### Task 10: Deploy + live verification

**Files:** none (deploy only)

- [ ] **Step 1: Deploy API worker**

```bash
npx wrangler deploy -c orders/wrangler.toml
```

- [ ] **Step 2: Apply migration 0019 remote**

```bash
npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0019_show_online.sql
```

- [ ] **Step 3: Rebuild admin + deploy assets**

```bash
npm run build
npx wrangler versions upload --name muyrico --assets . --compatibility-date 2025-03-21
npx wrangler versions deploy --name muyrico <VERSION_ID>@100%
```

- [ ] **Step 4: Apply migration 0020 remote**

```bash
npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0020_menu_updates.sql
```

- [ ] **Step 5: Live verification**

```bash
curl -s https://muy-rico-orders-api.bexgarcia0208.workers.dev/api/products/prod_cupcakes | python3 -c "import json,sys; print([(p['label'],p['price']) for p in json.load(sys.stdin)['product']['pack_sizes']])"
curl -s https://muy-rico.com/order -o /tmp/live-order.html && echo OK
```
Expected: dozen pack present. Playwright on live: mini rolls tile, flavors, SVG toast, hidden product absent from menu but in admin modal.

- [ ] **Step 6: Commit plan + any fixes**

```bash
git add docs/superpowers/plans/2026-07-24-operational-fixes.md
git commit -m "docs: Spec A implementation plan"
```

---

## Self-Review

- **Spec coverage:** hidden products (Tasks 1,2,3,5,6,7), payment edit (3,8), manual packs (7), cupcakes dozen (1,9,10), mini rolls (1,4,9,10), flavors (1,9,10), emoji->svg (1,4,5). Spec B excluded per decision 7. ✓
- **Placeholders:** Step 10.3 `<VERSION_ID>` is inherently runtime output — captured from upload output, documented. No other placeholders. ✓
- **Type consistency:** `show_online` naming consistent across SQL/API/types/UI; `payment_sub_method` matches existing API convention; `PackSize` fields match `types.ts`. ✓
