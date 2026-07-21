# Per-Flavor Automatic Label Generation — Design

Date: 2026-07-20
Status: Approved by user (design phase)

## Problem

When an order contains multiple flavors of the same product (e.g. chocolate + vanilla + strawberry cupcakes), the system generates only ONE label for that product. Root causes:

1. **Worker dedupe bug** — `generateLabelsForOrder` (orders/workers/api.js) creates one label per *product name* (`Order #12 - Cupcakes (6)`). The first flavor's label is inserted; subsequent flavors are skipped as "duplicates" because the dedupe key ignores the flavor.
2. **No flavor capture in manual orders** — the admin New Order modal (OrderModal.tsx) has no flavor picker, so manual orders can't distinguish flavors at all.
3. **Broken "View Labels" filter** — the Orders page filters the LabelDesigner by order number `MR-12`, but generated labels are named `Order #12 - …`, so the filter never matches anything.

### Legal grounding

Michigan Cottage Food Law (MDARD): "You are required to individually label your Cottage Foods prior to sale." Different flavors are legally different products (different names, ingredients, possibly allergens), so each flavor requires its own complete label. Per-flavor label generation is therefore the compliant behavior, not merely a convenience. The sources are silent on assortment boxes and nothing authorizes a single combined multi-product label; per-flavor labels are the conservative, defensible approach. (Mixed-box outer-label questions are out of scope — refer to MDARD-CottageFood@michigan.gov if ever needed.)

Confirmed with user: the shared per-product ingredient list accurately covers all flavors, so **no per-flavor ingredient data model is needed**.

## Decisions (from brainstorming)

- Manual orders capture flavors via **dropdowns** in the OrderModal (like the website), not free text.
- **One label per distinct line item**, regardless of quantity (2× chocolate cupcakes = 1 chocolate label; print extra copies as needed).
- **New orders only** — no backfill of existing orders.

## Design

### 1. Worker label generation (`orders/workers/api.js`)

In `generateLabelsForOrder`:

- Label identity = the line item's own name (`item.name`). Website orders already send flavor-inclusive names (`Cupcakes (6) (Cupcake flavor: Chocolate)`); manual orders will too after §2.
- Label `name` = `MR-{orderId} - {itemName}` (replaces `Order #{orderId} - {product.name}`). This also fixes the "View Labels" filter, which passes `MR-{id}`.
- Dedupe: `SELECT id FROM label_templates WHERE name = ?` using the new full name → distinct flavors produce distinct labels; identical items (same flavor) produce exactly one.
- Label `product_name` = `item.name` so the flavor prints on the label.
- Product resolution for content (ingredients, allergens, emoji, image_url, description, price fallback) stays as-is: match by `item.productId` first, then name matching (product name ⊂ item name).
- Price: `(item.price || product.price)` as today.
- Food-coloring ingredient/allergen appending logic unchanged.
- `generateLabelsForOrderById` (on-demand "(Re)Generate Labels" button) uses the same naming automatically.
- `backfillAllOrderLabels`: change the "already has labels" check prefix from `Order #{id} - %` to `MR-{id} - %` for consistency. The endpoint remains manual; we will NOT run it (new orders only).

### 2. OrderModal flavor dropdowns (`home-bakery-management-system/src/components/OrderModal.tsx`)

- When the picked product has a non-empty `flavor_groups` array, render one `<select>` per group below the product picker, populated with that group's `options`.
- **All groups must have a selection before the item can be added** (the label needs the flavor).
- On Add, compose the item name in the website's exact format:
  `{product.name}` + ` (` + `{Group}: {Option}, {Group2}: {Option2}` + `)`.
  Example: `Cupcakes (6) (Cupcake flavor: Chocolate)`.
- `OrderItem` gains an optional `flavorNote?: string` field used only as the line-item identity: qty +/- and remove key on `productId + (flavorNote || '')` instead of `productId` alone. Same product + same flavor merges qty; same product + different flavor = separate lines.
- `items_json` sent to the API is unchanged in shape: `{ name, qty, price, productId }` where `name` is the composed flavor-inclusive name. The order's item list UI shows the composed name (flavor visible on the order).
- The food-coloring prompt (`COLORABLE_PRODUCTS` by productId) is unaffected.
- Products without flavor groups behave exactly as today.

### 3. Frontend orders → labels flow (no code change needed)

- Orders page "View Labels for MR-12" passes `MR-{id}` as the filter; new labels named `MR-{id} - …` now match. LabelDesigner renders `product_name` (which includes the flavor).
- "(Re)Generate Labels" button continues to call `POST /api/orders/:id/generate-labels`; regenerated labels use the new naming (old-style `Order #…` labels for that order, if any, are left untouched and simply won't match the filter — acceptable since only new orders matter).

### 4. Data flow (end state)

Website order (flavor already in item name) OR manual order (flavor composed in OrderModal) → `createOrder` → `ctx.waitUntil(generateLabelsForOrder)` → one label per distinct line-item name in `label_templates`, named `MR-{id} - {itemName}`, with flavor shown as the product name and the shared product ingredients/allergens.

### 5. Error handling

- Item whose product can't be resolved → skipped (existing behavior), order still succeeds.
- Duplicate label name → skipped (existing behavior).
- Label insert failure → logged, does not fail the order (existing behavior).
- OrderModal: Add-item button disabled until all flavor groups for the picked product have selections.

### 6. Out of scope

- Per-flavor ingredient/allergen overrides (user confirmed shared list is accurate for all flavors).
- Mixed-box/assortment combined labels (legally unsupported by available sources).
- Label layout, typography, or the MDARD 11-point disclaimer rendering (existing LabelDesigner concern, unchanged here).
- Backfilling labels for historical orders.
- Editing/deleting labels on order change or cancellation (existing behavior).

### 7. Verification (no test framework in repo)

Local reproduction harness: `wrangler dev` (local D1, migrations applied) + `npm run dev` (vite) + Playwright, same as the customer_id fix.

1. Manual order via UI with 2 cupcake flavors → `GET /api/labels` returns 2 labels named `MR-{id} - Cupcakes (6) (Cupcake flavor: Chocolate)` and `… Vanilla)`.
2. Website-format order via curl with 3 flavors → 3 distinct labels.
3. Same flavor twice → still one label.
4. Orders page → "View Labels" → LabelDesigner shows exactly that order's labels (filter works).
5. Label content spot-check: `product_name` includes the flavor; ingredients/allergens match the product.

## Files to change

- `orders/workers/api.js` — `generateLabelsForOrder`, `backfillAllOrderLabels` (naming + dedupe).
- `home-bakery-management-system/src/components/OrderModal.tsx` — flavor dropdowns, composed item names, line-item keying.
- `home-bakery-management-system/src/types.ts` — `OrderItem.flavorNote?: string`.
- `admin/index.html` — regenerated build artifact (committed with source).
- `orders/migrations/` — none (no schema change).
