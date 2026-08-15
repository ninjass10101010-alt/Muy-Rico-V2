# Inventory Ingredient Groups — Design

**Date:** 2026-08-15
**Status:** Approved (user confirmed: Approach 2 — ingredient families + bulk recipe rewrite)
**Depends on:** existing Orders Worker + D1 (`muy-rico-orders`), admin SPA (`home-bakery-management-system/`), Cloudflare Access auth.

## 1. Problem

Bakery ingredients are interchangeable in practice, but the data model isn't.

- `products.recipe` is `[{ inventoryItemId, qtyPerUnit }]` — a hard link to one concrete stock item (e.g. `inv_flour`).
- When the bakery runs out of one brand of flour (or finds better pricing) and switches to another, the admin would have to edit **every product's** recipe by hand to repoint it at the new item.
- There are also different *types* of the same ingredient (all-purpose flour vs. bread flour); switching all-purpose flour must **not** affect products that use bread flour.
- The scan flow (`ScanModal`) can create new inventory items, but there's no step that asks *"what is this used for?"*, so a newly stocked brand is not linked to anything until the admin manually edits recipes in the Products page.

## 2. Goal

Let the admin model an **ingredient** (All-Purpose Flour, Bread Flour) as a group of interchangeable **stock items** (King Arthur AP, Great Value AP), with one item marked **active**. Switching the active item updates every product that uses that ingredient at once, and product labels re-compose automatically. The scan flow prompts the admin to say what a new item is used for.

## 3. Non-goals (this phase)

- Recipe lines referencing ingredient **group ids** directly (Approach 1). The recipe stays `[{ inventoryItemId, qtyPerUnit }]`; the swap rewrites those ids.
- A full `ingredient_groups` CRUD UI (group delete is out of scope; groups are created/renamed inline from the inventory flows).
- Automatic "used for" inference from OFF product data — the admin always confirms the group.
- Changing how deduction, cost, prep-list, or label-print engines work. They keep operating on concrete item ids, unchanged.

## 4. Architecture fit (verified)

- **Deduction** (`orders/workers/api.js:683 deductOrderInventory`) iterates `product.recipe` lines and deducts from `rec.inventoryItemId`. Since the swap rewrites recipe lines to a concrete id, **no change needed here**.
- **Labels**: `composeLabelFromRecipe` (`src/utils/label.ts:38`) composes `product.ingredients`/`allergens` from the recipe's items at product-save time (frontend, `Products.tsx:88-89`). The worker reads those stored fields at print time (`api.js:2456`). So after a swap, the SPA must re-save affected products with freshly composed fields — the compose logic stays in one place (frontend).
- **Scan flow** (`src/components/ScanModal.tsx`) already handles lookup / bind / create for inventory items; group assignment slots into the existing new-item and adjust panels.
- **Store** (`src/context/StoreContext.tsx`) already loads `products` + `inventory`; add `groups` alongside.

## 5. Data model

**Migration: `orders/migrations/0041_inventory_ingredient_groups.sql`**

```sql
CREATE TABLE IF NOT EXISTS ingredient_groups (
  id              TEXT PRIMARY KEY,          -- e.g. 'grp_all_purpose_flour'
  name            TEXT NOT NULL,             -- 'All-Purpose Flour'
  category        TEXT,                      -- mirrors inventory category ('Dry Goods')
  active_item_id  TEXT,                      -- stock item currently in use
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT
);

ALTER TABLE inventory ADD COLUMN group_id TEXT;
CREATE INDEX IF NOT EXISTS idx_inventory_group ON inventory(group_id);

-- Backfill: every existing item becomes its own 1:1 ingredient group.
INSERT INTO ingredient_groups (id, name, category, active_item_id)
  SELECT 'grp_' || id, name, category, id FROM inventory WHERE active = 1;
UPDATE inventory SET group_id = 'grp_' || id WHERE group_id IS NULL;
```

- `inventory.group_id` is nullable. `NULL` = standalone item, behaves exactly like today.
- Group membership means "these stock items are interchangeable — the active one is what's used."
- `product.recipe` is **not** migrated; it keeps concrete item ids.

## 6. Worker API changes (`orders/workers/api.js`)

All admin-only (under the existing inventory routing + Access gate). Recipe-rewrite logic extracted into a pure, testable module `orders/workers/groups-lib.js` (mirrors `enrich-lib.js` / `order-date.js` pattern).

1. **`GET /api/inventory/groups`** — list groups with members + usage:
   - Loads `ingredient_groups` (active=1), then members (`inventory WHERE group_id = ?`), then derives `used_by` (product names) by scanning `products.recipe` for any member id.
   - Returns `{ groups: [{ id, name, category, active_item_id, active_item, members: [...], used_by: ["Bolillos", "Conchas"] }] }`.

2. **`PATCH /api/inventory/:id`** — add `'group_id'` to `INVENTORY_FIELDS` (api.js:1816) so existing edit/create flows can assign, change, or clear (`null`) an item's group. Validates the group exists when non-null. Reassigning does **not** rewrite recipes.

3. **`POST /api/inventory/groups`** — create a group `{ id?, name, category?, active_item_id? }`; id auto-`grp_…` when omitted. Returns the group.

4. **`PATCH /api/inventory/groups/:id`** — rename / change category, and set the active item:
   - Body `{ active_item_id?: string, name?, category? }`.
   - When `active_item_id` provided and differs from current:
     - Validate the item exists and has `group_id = :id` (else 400).
     - Set `ingredient_groups.active_item_id`.
     - **Rewrite recipes atomically** via `env.DB.batch`: for every product whose `recipe` contains a line whose `inventoryItemId` is any member of this group, set that line's `inventoryItemId` → the new active id (preserving `qtyPerUnit`).
     - Log `scan_events` entry (`action: 'group_activate'`, `meta: { groupId, from, to }`).
     - Return `{ ok, affectedProductIds: ["prod_bolillos", …] }` so the SPA can refresh labels.

`groups-lib.js` exports the pure helper:

```js
// recipeArray: [{ inventoryItemId, qtyPerUnit }]
// memberIds:   Set of inventory ids in the group
// newActiveId: the group's new active item id
rewriteRecipeForGroup(recipeArray, memberIds, newActiveId)
```

Behavior: lines referencing any member → new active id (qty preserved, deduped if already the active id); lines referencing non-members untouched.

## 7. Admin SPA changes (`home-bakery-management-system/`)

### 7a. Types & plumbing

- `src/types.ts`: add `IngredientGroup { id, name, category, activeItemId, members, usedBy }`; add `groupId?: string | null` to `InventoryItem`.
- `src/utils/api.ts`:
  - `ApiInventoryItem.group_id?: string | null`.
  - `IngredientGroup` API shape + `GroupResponse`.
  - `fetchInventoryGroups()`, `createInventoryGroup(g)`, `updateInventoryGroup(id, patch)` (returns `{ ok, affectedProductIds }`).
  - Include `group_id` in `InventoryItemCreate` / `InventoryItemUpdate`.
- `StoreContext.tsx`: `groups` state + `refreshGroups()`; map `group_id` in `apiToInventoryItem`; handlers `handleCreateGroup` / `handleUpdateGroup` that refresh groups + inventory + products; add `groups` to `refreshAll`.
- New `src/utils/ingredientGroups.ts`:
  - `productsUsingGroup(group, products)` → product names (match by any member id in `product.recipe`).
  - `isActiveMember(item, group)` → `item.id === group.activeItemId`.

### 7b. Inventory page (`src/pages/Inventory.tsx`)

- Under each item name, show the group's **"Used in: Bolillos, Conchas"** (or "Standalone" when `group_id` is null).
- Active member of a group → **"✓ active"** badge; non-active members → a **"Make active"** action: confirm → `updateInventoryGroup(id, { active_item_id })` → re-compose affected product labels → refresh.
- Edit/Add modal: **Ingredient group** selector (existing groups + "New group…"). When the group is new or has no active member, a checkbox *"Use for all products (make active)"* sets it active on save.

### 7c. Scan flow (`src/components/ScanModal.tsx`) — "what is this used for?"

- New-item panels (`suggestCreate` / `manualCreate`): after name/category/unit, a **"What is this used for?"** step — pick an existing ingredient group (each shows the products that use it) or create a new one. On add, item gets `group_id`; a checkbox offers to make it active.
- Adjust panel (existing item found): if the scanned item is a *non-active* member of a group → prompt **"AP Flour is currently using Great Value AP — switch to King Arthur AP?"** with a one-tap swap button. If active → **"Active for AP Flour · used in Bolillos, Conchas"**.

### 7d. Products page (`src/pages/Products.tsx`)

- Recipe editor (currently lists all inventory items with a checkbox + qty) groups items under their ingredient group headers, and shows the group's active badge on each row.

### 7e. Label re-composition after a swap

- After `updateInventoryGroup(groupId, { active_item_id })` returns `affectedProductIds`, the SPA re-saves each affected product with freshly composed `ingredients` / `allergens` via `composeLabelFromRecipe` (only when `auto_generate_label` is on), then refreshes.
- Toast: *"Switched AP Flour → King Arthur. 3 products updated, labels refreshed."*
- Keeps compose logic in one place (frontend `label.ts`); the worker's label-print path is untouched.

## 8. Testing

- **`orders/tests/groups-lib.test.js`** — `rewriteRecipeForGroup`: member lines rewritten, non-member lines untouched, `qtyPerUnit` preserved, dedup when a line already references the active id, empty input.
- **`home-bakery-management-system/src/utils/ingredientGroups.test.ts`** — `productsUsingGroup` (matches by any member id), `isActiveMember`.
- **Manual E2E** — via the running SPA: add a second AP-flour brand via scan → assign to the AP-flour group → make active → confirm Bolillos/Conchas recipes repointed and their stored label fields updated.

## 9. Deployment

1. `cd home-bakery-management-system && npm install && npm run build` (postbuild copies to `admin/index.html`).
2. `npx wrangler d1 execute muy-rico-orders --remote --file=orders/migrations/0041_inventory_ingredient_groups.sql`.
3. `npx wrangler deploy -c orders/wrangler.toml` (worker: new group endpoints + `group_id` field).
4. `npx wrangler versions upload --name muyrico --assets . --compatibility-date 2025-03-21` then deploy the version (frontend incl. new admin bundle).

Rollback safety: the migration is additive (new table + nullable column). Recipes keep concrete item ids throughout, so deduction behavior is unchanged; a bad assignment is undone by reassigning `group_id` or setting a different active item.

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Swap unifies products that intentionally use different brands of the same ingredient | Rare for this bakery; note in UI copy ("switching affects every product using {group}"). A "pin" escape hatch can come later. |
| Stale stored `product.ingredients`/`allergens` after a swap | Swap response returns `affectedProductIds`; SPA re-composes + re-saves immediately (respecting `auto_generate_label`). |
| Recipe rewrite race with concurrent order deduction | `env.DB.batch` is atomic; deduction reads current recipes at order-complete time. Acceptable. |
| Scan flow friction (extra step) | The group step is optional — an item can be added standalone without a group, exactly like today. |

## 11. Out of scope / later

- Group delete / archive UI.
- Pinning a product to a specific non-active member of a group.
- Recipe referencing group ids directly (Approach 1) as a cleaner long-term model.