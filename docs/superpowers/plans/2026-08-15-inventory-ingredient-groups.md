# Inventory Ingredient Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Model bakery ingredients as groups of interchangeable stock items with one active item, so swapping a brand updates every product recipe that uses it at once and product labels re-compose.

**Architecture:** Add an `ingredient_groups` table and `inventory.group_id`; `product.recipe` stays `[{ inventoryItemId, qtyPerUnit }]`. A "make active" action on a group rewrites every product recipe line that references any member of the group to the new active item's id, then the SPA re-saves affected products' label fields. Deduction, cost, prep-list, and label-print engines are untouched.

**Tech Stack:** Cloudflare Workers + D1 (SQLite), admin React SPA (Vite, single-file bundle), Vitest for both worker and SPA tests.

## Global Constraints

- Do NOT modify `deductOrderInventory` (api.js:683), `composeLabelFromRecipe` (label.ts:38), `calcRecipeCost`, `prepList`, or label-print code. They keep operating on concrete item ids.
- `product.recipe` format stays `[{ inventoryItemId, qtyPerUnit }]` — never change it.
- `inventory.group_id` is nullable; `NULL` = standalone item, behaves exactly like today.
- No new dependencies.
- Run worker commands from the repo root (the plan shows exact commands).
- Verify SPA with `npm test` + `npm run build` in `home-bakery-management-system/`; worker with `npm test` in `orders/` and `node --check`.
- Migration run command (repo convention): `npx wrangler d1 execute muy-rico-orders --file=orders/migrations/0041_inventory_ingredient_groups.sql` (add `--remote` for production).

---

### Task 1: Migration `0041_inventory_ingredient_groups.sql`

**Files:**
- Create: `orders/migrations/0041_inventory_ingredient_groups.sql`

**Interfaces:**
- Produces: `ingredient_groups` table (`id, name, category, active_item_id, active, created_at, updated_at`); `inventory.group_id` nullable TEXT column; backfilled 1:1 groups for all existing active items.

- [ ] **Step 1: Create the migration file**

```sql
-- 0041: inventory ingredient groups (substitution via active item)
-- Models an *ingredient* (All-Purpose Flour, Bread Flour) as a group of
-- interchangeable stock items, one of which is active. product.recipe keeps
-- concrete inventoryItemId values; "make active" rewrites those ids to the
-- new active item. Deduction/label/cost/prep engines are untouched.
--
-- Run:
--   npx wrangler d1 execute muy-rico-orders --file=orders/migrations/0041_inventory_ingredient_groups.sql
--   npx wrangler d1 execute muy-rico-orders --remote --file=orders/migrations/0041_inventory_ingredient_groups.sql

CREATE TABLE IF NOT EXISTS ingredient_groups (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  category        TEXT,
  active_item_id  TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT
);

ALTER TABLE inventory ADD COLUMN group_id TEXT;
CREATE INDEX IF NOT EXISTS idx_inventory_group ON inventory(group_id);

-- Backfill: every existing active item becomes its own 1:1 group.
INSERT INTO ingredient_groups (id, name, category, active_item_id)
  SELECT 'grp_' || id, name, category, id FROM inventory WHERE active = 1;
UPDATE inventory SET group_id = 'grp_' || id WHERE group_id IS NULL;
```

- [ ] **Step 2: Verify against the local D1 database**

Run: `npx wrangler d1 execute muy-rico-orders --local --file=orders/migrations/0041_inventory_ingredient_groups.sql`
Expected: applies cleanly (repeat `--local` runs are idempotent thanks to `IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`).

- [ ] **Step 3: Spot-check the backfill**

Run:
```bash
npx wrangler d1 execute muy-rico-orders --local --command="SELECT id, name, active_item_id FROM ingredient_groups ORDER BY name LIMIT 5"
npx wrangler d1 execute muy-rico-orders --local --command="SELECT COUNT(*) AS n FROM inventory WHERE group_id IS NULL"
```
Expected: groups named after the seed items (e.g. `All-Purpose Flour`), each `active_item_id` equal to its own item id, and `n` = 0.

- [ ] **Step 4: Commit**

```bash
git add orders/migrations/0041_inventory_ingredient_groups.sql
git commit -m "feat(inventory): ingredient groups migration (0041)"
```

---

### Task 2: `groups-lib.js` rewrite helper + unit tests

**Files:**
- Create: `orders/workers/groups-lib.js`
- Create: `orders/tests/groups-lib.test.js`

**Interfaces:**
- Produces: `export function rewriteRecipeForGroup(recipeArray, memberIds, newActiveId)` where `memberIds` is a `Set` of inventory ids. Returns a new recipe array; lines referencing a member are repointed to `newActiveId` (qty preserved), all other lines unchanged. Non-array input returns `[]`.
- Consumes: nothing.
- Task 3 consumes `rewriteRecipeForGroup` from `./groups-lib.js`.

- [ ] **Step 1: Write the failing test**

```js
// orders/tests/groups-lib.test.js
import { describe, it, expect } from "vitest";
import { rewriteRecipeForGroup } from "../workers/groups-lib.js";

const memberIds = new Set(["inv_flour", "inv_flour_b"]);

describe("rewriteRecipeForGroup", () => {
  it("repoints member lines to the new active id, preserving qtyPerUnit", () => {
    const recipe = [
      { inventoryItemId: "inv_flour", qtyPerUnit: 0.12 },
      { inventoryItemId: "inv_eggs", qtyPerUnit: 1 },
    ];
    expect(rewriteRecipeForGroup(recipe, memberIds, "inv_flour_b")).toEqual([
      { inventoryItemId: "inv_flour_b", qtyPerUnit: 0.12 },
      { inventoryItemId: "inv_eggs", qtyPerUnit: 1 },
    ]);
  });

  it("leaves lines already pointing at the active id untouched", () => {
    const recipe = [{ inventoryItemId: "inv_flour_b", qtyPerUnit: 0.1 }];
    expect(rewriteRecipeForGroup(recipe, memberIds, "inv_flour_b")).toEqual(recipe);
  });

  it("handles empty and non-array input", () => {
    expect(rewriteRecipeForGroup([], memberIds, "x")).toEqual([]);
    expect(rewriteRecipeForGroup(null, memberIds, "x")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd orders && npx vitest run tests/groups-lib.test.js`
Expected: FAIL — `Cannot find module '../workers/groups-lib.js'` or `rewriteRecipeForGroup is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// orders/workers/groups-lib.js
// Pure recipe rewrite for ingredient-group "make active". No DB access.
// Recipe lines reference concrete inventory ids; when a group's active item
// changes, every line referencing a member is repointed to the new active id.
export function rewriteRecipeForGroup(recipeArray, memberIds, newActiveId) {
  if (!Array.isArray(recipeArray)) return [];
  return recipeArray.map((rec) => {
    if (rec && rec.inventoryItemId && memberIds.has(rec.inventoryItemId)) {
      return { ...rec, inventoryItemId: newActiveId };
    }
    return rec;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd orders && npx vitest run tests/groups-lib.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add orders/workers/groups-lib.js orders/tests/groups-lib.test.js
git commit -m "feat(inventory): recipe rewrite helper for ingredient-group activation"
```

---

### Task 3: Worker API endpoints (`orders/workers/api.js`)

**Files:**
- Modify: `orders/workers/api.js` — import line (after line 65), routes (before the `im` regex at line 216), `INVENTORY_FIELDS` (line 1816), `createInventory` (line 2013), `updateInventoryItem` (line 2064), and new handler functions appended near the scan-history section (after `itemScanHistory`, ~line 2011).

**Interfaces:**
- Consumes: `rewriteRecipeForGroup` from `./groups-lib.js` (Task 2); existing `safeJsonParse`, `json`, `logScanEvent`, `actorName` in scope.
- Produces:
  - `GET /api/inventory/groups` → `{ groups: [{ id, name, category, active_item_id, active_item, members, used_by }] }`
  - `POST /api/inventory/groups` body `{ id?, name, category?, active_item_id? }` → `{ ok, id }` (201)
  - `PATCH /api/inventory/groups/:id` body `{ name?, category?, active_item_id? }` → `{ ok, affectedProductIds: string[] }`
  - `PATCH /api/inventory/:id` accepts `group_id` (assign/change/clear), clearing the old group's `active_item_id` if the moved item was its active member.
  - `POST /api/inventory` accepts `group_id`.

- [ ] **Step 1: Add the import**

After the existing imports at api.js:63-65:

```js
import { rewriteRecipeForGroup } from './groups-lib.js';
```

- [ ] **Step 2: Add routes — insert after the enrich route (api.js:133), before the `im` regex**

```js
      // Ingredient groups (must precede the /api/inventory/:id regex below)
      if (path === '/api/inventory/groups' && method === 'GET') return await listInventoryGroups(env);
      if (path === '/api/inventory/groups' && method === 'POST') return await createInventoryGroup(request, env);
      const igm = path.match(/^\/api\/inventory\/groups\/([A-Za-z0-9_-]+)$/);
      if (igm && method === 'PATCH') return await updateInventoryGroup(igm[1], request, env, actorName);
```

- [ ] **Step 3: Add `group_id` to `INVENTORY_FIELDS`**

Change (api.js:1816-1821):

```js
const INVENTORY_FIELDS = [
  'name', 'category', 'quantity', 'unit',
  'reorder_level', 'cost_per_unit', 'supplier',
  'ingredients_label', 'allergens', 'unit_weight',
  'active', 'barcode', 'nutrition_source', 'nutrition_fetched_at',
  'group_id',
];
```

- [ ] **Step 4: Add `group_id` to `createInventory` INSERT (api.js:2022-2044)**

Change the INSERT column list and bind:

```js
    await env.DB.prepare(`
      INSERT INTO inventory
        (id, name, category, quantity, unit, reorder_level, cost_per_unit, supplier,
         ingredients_label, allergens, unit_weight, active, barcode,
         nutrition_source, nutrition_fetched_at, group_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      body.group_id || null,
    ).run();
```

- [ ] **Step 5: Keep `updateInventoryItem` consistent when `group_id` changes**

In `updateInventoryItem` (api.js:2064), before building the UPDATE, add a guard that clears the old group's `active_item_id` when the item was its active member and is being moved:

```js
  // Moving an item out of a group: if it was the group's active item, clear the
  // group's active_item_id so the group stays consistent (its active must be a member).
  if (body.group_id !== undefined) {
    const prev = await env.DB.prepare('SELECT group_id FROM inventory WHERE id = ?').bind(id).first();
    if (prev && prev.group_id && prev.group_id !== (body.group_id || null)) {
      await env.DB.prepare(
        `UPDATE ingredient_groups SET active_item_id = NULL, updated_at = datetime('now')
         WHERE id = ? AND active_item_id = ?`
      ).bind(prev.group_id, id).run();
    }
  }
```

Place this right after `const body = await request.json();` and before the `const sets = []` loop.

- [ ] **Step 6: Add the three handler functions**

Insert after `itemScanHistory` (after api.js:2011):

```js
// ─── Ingredient groups ───────────────────────────────────────────────────────

// GET /api/inventory/groups — groups with member items and the products that
// reference any member (used for the "used in" display + swap prompts).
async function listInventoryGroups(env) {
  const { results: groups } = await env.DB.prepare(
    'SELECT * FROM ingredient_groups WHERE active = 1 ORDER BY name ASC'
  ).all();
  const { results: items } = await env.DB.prepare(
    'SELECT * FROM inventory WHERE active = 1'
  ).all();
  const { results: prods } = await env.DB.prepare('SELECT id, name, recipe FROM products').all();

  const groupsOut = groups.map((g) => {
    const members = items.filter((i) => i.group_id === g.id);
    const memberIds = new Set(members.map((m) => m.id));
    const usedBy = prods
      .filter((p) => {
        const recipe = safeJsonParse(p.recipe, []);
        return recipe.some((r) => r && r.inventoryItemId && memberIds.has(r.inventoryItemId));
      })
      .map((p) => p.name);
    const active = members.find((m) => m.id === g.active_item_id) || null;
    return {
      id: g.id,
      name: g.name,
      category: g.category,
      active_item_id: g.active_item_id,
      active_item: active,
      members,
      used_by: usedBy,
    };
  });
  return json({ groups: groupsOut }, 200);
}

// POST /api/inventory/groups — create an ingredient group.
async function createInventoryGroup(request, env) {
  const body = await request.json();
  const name = String(body.name || '').trim();
  if (!name) return json({ error: 'Missing required field: name' }, 400);
  const id = typeof body.id === 'string' && body.id ? body.id : `grp_${Date.now().toString(36)}`;
  const category = body.category || null;
  const activeItemId = body.active_item_id || null;
  try {
    await env.DB.prepare(
      'INSERT INTO ingredient_groups (id, name, category, active_item_id) VALUES (?, ?, ?, ?)'
    ).bind(id, name, category, activeItemId).run();
  } catch (err) {
    return json({ error: String(err) }, 400);
  }
  return json({ ok: true, id }, 201);
}

// PATCH /api/inventory/groups/:id — rename / recategorize / set the active item.
// Setting a new active item rewrites every product recipe line that references
// any member of the group to the new active id (all-or-nothing via batch).
async function updateInventoryGroup(id, request, env, actor) {
  const body = await request.json();
  const group = await env.DB.prepare('SELECT * FROM ingredient_groups WHERE id = ?').bind(id).first();
  if (!group) return json({ error: 'Not found' }, 404);

  const sets = [];
  const binds = [];
  const stmts = [];
  let newActiveId = group.active_item_id;
  const oldActiveId = group.active_item_id;

  if (body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (!name) return json({ error: 'name must be a non-empty string' }, 400);
    sets.push('name = ?'); binds.push(name);
  }
  if (body.category !== undefined) {
    sets.push('category = ?'); binds.push(body.category || null);
  }

  const affectedProductIds = [];
  if (body.active_item_id !== undefined) {
    newActiveId = body.active_item_id || null;
    if (newActiveId === null) {
      return json({ error: 'active_item_id cannot be null; assign a member item' }, 400);
    }
    if (newActiveId !== oldActiveId) {
      {
        const member = await env.DB.prepare(
          'SELECT id FROM inventory WHERE id = ? AND group_id = ? AND active = 1'
        ).bind(newActiveId, id).first();
        if (!member) return json({ error: 'Item is not an active member of this group' }, 400);
      }
      const { results: members } = await env.DB.prepare(
        'SELECT id FROM inventory WHERE group_id = ?'
      ).bind(id).all();
      const memberIds = new Set(members.map((m) => m.id));
      const { results: prods } = await env.DB.prepare('SELECT id, recipe FROM products').all();
      for (const p of prods) {
        const recipe = safeJsonParse(p.recipe, []);
        const rewritten = rewriteRecipeForGroup(recipe, memberIds, newActiveId);
        if (JSON.stringify(rewritten) !== JSON.stringify(recipe)) {
          affectedProductIds.push(p.id);
          stmts.push(env.DB.prepare(
            `UPDATE products SET recipe = ?, updated_at = datetime('now') WHERE id = ?`
          ).bind(JSON.stringify(rewritten), p.id));
        }
      }
      sets.push('active_item_id = ?'); binds.push(newActiveId);
    }
  }

  if (!sets.length) return json({ error: 'Nothing to update' }, 400);
  sets.push("updated_at = datetime('now')");
  binds.push(id);
  stmts.push(env.DB.prepare(
    `UPDATE ingredient_groups SET ${sets.join(', ')} WHERE id = ?`
  ).bind(...binds));

  await env.DB.batch(stmts);

  if (newActiveId !== oldActiveId) {
    logScanEvent(env, {
      inventory_id: newActiveId,
      code: 'group:' + id,
      action: 'group_activate',
      meta: { groupId: id, from: oldActiveId, to: newActiveId, affected: affectedProductIds },
      source: 'manual',
      actor,
    });
  }
  return json({ ok: true, affectedProductIds }, 200);
}
```

- [ ] **Step 7: Syntax-check the worker and run the existing worker tests**

Run: `node --check orders/workers/api.js && cd orders && npm test`
Expected: no syntax errors; all worker tests pass.

- [ ] **Step 8: Commit**

```bash
git add orders/workers/api.js orders/workers/groups-lib.js
git commit -m "feat(api): ingredient group endpoints with atomic recipe rewrite"
```

---

### Task 4: Frontend types + API client

**Files:**
- Modify: `home-bakery-management-system/src/types.ts`
- Modify: `home-bakery-management-system/src/utils/api.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `types.ts`: `IngredientGroup { id; name; category: string | null; activeItemId: string | null; active: boolean; members: InventoryItem[]; usedBy: string[] }`; `InventoryItem.groupId?: string | null`.
  - `api.ts`: `ApiInventoryItem.group_id?: string | null`; `ApiIngredientGroup` (snake_case mirror); `fetchInventoryGroups(): Promise<ApiIngredientGroup[]>`; `createInventoryGroup(g): Promise<{ ok: boolean; id: string }>`; `updateInventoryGroup(id, patch): Promise<{ ok: boolean; affectedProductIds: string[] }>`; `group_id` added to `InventoryItemCreate` / `InventoryItemUpdate`.
  - Task 6 consumes these from `StoreContext.tsx`.

- [ ] **Step 1: Add the frontend types**

In `types.ts`, after the `InventoryItem` interface (line 87):

```ts
export interface IngredientGroup {
  id: string;
  name: string;
  category: string | null;
  activeItemId: string | null;
  active: boolean;
  members: InventoryItem[];
  usedBy: string[];
}
```

In `InventoryItem` (line 71), add `groupId`:

```ts
  barcode?: string | null;
  groupId?: string | null;
  nutritionSource?: string;
```

- [ ] **Step 2: Add the API types and functions**

In `api.ts`, in the `ApiInventoryItem` interface (line 300):

```ts
  barcode?: string | null;
  group_id?: string | null;
  nutrition_source?: string | null;
```

In `InventoryItemCreate` (line 320), add:

```ts
  barcode?: string | null;
  group_id?: string | null;
  nutrition_source?: string | null;
```

After `adjustInventoryQuantity` (line 398), add:

```ts
// ─── Ingredient groups ─────────────────────────────────────────────────────────

export interface ApiIngredientGroup {
  id: string;
  name: string;
  category: string | null;
  active_item_id: string | null;
  active: number;
  members: ApiInventoryItem[];
  used_by: string[];
}

export interface IngredientGroupCreate {
  id?: string;
  name: string;
  category?: string | null;
  active_item_id?: string | null;
}

export async function fetchInventoryGroups(): Promise<ApiIngredientGroup[]> {
  const data = await apiFetch<{ groups: ApiIngredientGroup[] }>("/api/inventory/groups");
  return data.groups;
}

export async function createInventoryGroup(g: IngredientGroupCreate): Promise<{ ok: boolean; id: string }> {
  return apiFetch("/api/inventory/groups", {
    method: "POST",
    body: JSON.stringify(g),
  });
}

export async function updateInventoryGroup(
  id: string,
  patch: { name?: string; category?: string | null; active_item_id?: string | null }
): Promise<{ ok: boolean; affectedProductIds: string[] }> {
  return apiFetch(`/api/inventory/groups/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}
```

- [ ] **Step 3: Verify compile + existing tests**

Run: `cd home-bakery-management-system && npm test && npm run build`
Expected: all tests pass; build succeeds (bundles the admin SPA).

- [ ] **Step 4: Commit**

```bash
git add home-bakery-management-system/src/types.ts home-bakery-management-system/src/utils/api.ts
git commit -m "feat(admin): ingredient group types and API client"
```

---

### Task 5: `ingredientGroups.ts` util + unit tests

**Files:**
- Create: `home-bakery-management-system/src/utils/ingredientGroups.ts`
- Create: `home-bakery-management-system/src/utils/ingredientGroups.test.ts`

**Interfaces:**
- Consumes: `IngredientGroup`, `InventoryItem`, `Product` from `../types`.
- Produces:
  - `productsUsingGroup(group: IngredientGroup, products: Product[]): string[]` — names of products whose recipe references any member id.
  - `isActiveMember(item: InventoryItem, group: IngredientGroup): boolean` — `item.id === group.activeItemId`.

- [ ] **Step 1: Write the failing test**

```ts
// home-bakery-management-system/src/utils/ingredientGroups.test.ts
import { describe, it, expect } from "vitest";
import { productsUsingGroup, isActiveMember } from "./ingredientGroups";
import type { IngredientGroup, InventoryItem, Product } from "../types";

const group: IngredientGroup = {
  id: "grp_ap_flour",
  name: "All-Purpose Flour",
  category: "Dry Goods",
  activeItemId: "inv_flour_b",
  active: true,
  members: [
    { id: "inv_flour", name: "King Arthur AP", category: "Dry Goods", quantity: 10, unit: "lb", reorderLevel: 5, costPerUnit: 0.5, supplier: "" },
    { id: "inv_flour_b", name: "Great Value AP", category: "Dry Goods", quantity: 20, unit: "lb", reorderLevel: 5, costPerUnit: 0.4, supplier: "" },
  ] as InventoryItem[],
  usedBy: [],
};

const products = [
  { id: "prod_bolillos", name: "Bolillos", recipe: [{ inventoryItemId: "inv_flour", qtyPerUnit: 0.15 }] },
  { id: "prod_conchas", name: "Conchas", recipe: [{ inventoryItemId: "inv_flour_b", qtyPerUnit: 0.12 }] },
  { id: "prod_cookie", name: "Cookie", recipe: [{ inventoryItemId: "inv_choc_chips", qtyPerUnit: 0.08 }] },
] as unknown as Product[];

describe("productsUsingGroup", () => {
  it("returns products whose recipe references any member id", () => {
    expect(productsUsingGroup(group, products)).toEqual(["Bolillos", "Conchas"]);
  });
});

describe("isActiveMember", () => {
  it("is true only for the group's active item", () => {
    expect(isActiveMember(group.members[1], group)).toBe(true);
    expect(isActiveMember(group.members[0], group)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd home-bakery-management-system && npx vitest run src/utils/ingredientGroups.test.ts`
Expected: FAIL — cannot resolve `./ingredientGroups`.

- [ ] **Step 3: Write minimal implementation**

```ts
// home-bakery-management-system/src/utils/ingredientGroups.ts
import type { IngredientGroup, InventoryItem, Product } from "../types";

// Names of products whose recipe references any member of the group — i.e. the
// products that would switch when this group's active item changes.
export function productsUsingGroup(group: IngredientGroup, products: Product[]): string[] {
  const memberIds = new Set(group.members.map((m) => m.id));
  return products
    .filter((p) => (p.recipe || []).some((r) => memberIds.has(r.inventoryItemId)))
    .map((p) => p.name);
}

export function isActiveMember(item: InventoryItem, group: IngredientGroup): boolean {
  return !!group.activeItemId && item.id === group.activeItemId;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd home-bakery-management-system && npx vitest run src/utils/ingredientGroups.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add home-bakery-management-system/src/utils/ingredientGroups.ts home-bakery-management-system/src/utils/ingredientGroups.test.ts
git commit -m "feat(admin): ingredient-group helpers (used-in + active member)"
```

---

### Task 6: Store wiring (`StoreContext.tsx`)

**Files:**
- Modify: `home-bakery-management-system/src/context/StoreContext.tsx`

**Interfaces:**
- Consumes: `fetchInventoryGroups`, `createInventoryGroup`, `updateInventoryGroup`, `ApiIngredientGroup` from `../utils/api` (Task 4); `IngredientGroup`, `InventoryItem` from `../types` (Task 4).
- Produces (context additions):
  - `groups: IngredientGroup[]`
  - `refreshGroups: () => Promise<void>`
  - `apiCreateGroup: (g) => Promise<{ id: string }>`
  - `apiUpdateGroup: (id, patch) => Promise<{ ok: boolean; affectedProductIds: string[] }>`
  - `InventoryItem.groupId` populated in `apiToInventoryItem`.
  - Tasks 7, 8, 9, 10 consume these.

- [ ] **Step 1: Extend the API import**

In the big `import ... from "../utils/api"` (line 25), add `fetchInventoryGroups, createInventoryGroup as apiCreateInventoryGroupApi, updateInventoryGroup as apiUpdateInventoryGroupApi` and `type ApiIngredientGroup`. (Keep names distinct from the context-facing `apiCreateGroup`/`apiUpdateGroup`.)

- [ ] **Step 2: Add to the context interface**

In `interface StoreContextValue`, after the `apiDeleteInventoryItem` line (line 39):

```ts
  groups: IngredientGroup[];
  refreshGroups: () => Promise<void>;
  apiCreateGroup: (g: Parameters<typeof apiCreateInventoryGroupApi>[0]) => Promise<{ id: string }>;
  apiUpdateGroup: (id: string, patch: Parameters<typeof apiUpdateInventoryGroupApi>[1]) => Promise<{ ok: boolean; affectedProductIds: string[] }>;
```

- [ ] **Step 3: Map `group_id` in `apiToInventoryItem`**

In `apiToInventoryItem` (line 197), after `barcode: row.barcode || null,` add:

```ts
      groupId: row.group_id || null,
```

- [ ] **Step 4: Add the group state + mapper + refresh**

After the `apiToInventoryItem` function (line 222), add:

```ts
  function apiToIngredientGroup(row: ApiIngredientGroup): IngredientGroup {
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      activeItemId: row.active_item_id,
      active: !!row.active,
      members: (row.members || []).map(apiToInventoryItem),
      usedBy: row.used_by || [],
    };
  }

  const refreshGroups = useCallback(async () => {
    try {
      const rows = await fetchInventoryGroups();
      setGroups(rows.map(apiToIngredientGroup));
    } catch (err) {
      console.warn("Failed to fetch ingredient groups from API:", err);
      setGroups([]);
    }
  }, []);
```

Add the state near `const [inventory, setInventory] = ...` (line 81):

```ts
  const [groups, setGroups] = useState<IngredientGroup[]>([]);
```

- [ ] **Step 5: Add handlers + include in refreshAll + context value**

Add after `handleApiDeleteInventoryItem` (line 549):

```ts
  const handleCreateGroup = useCallback(async (g: Parameters<typeof apiCreateInventoryGroupApi>[0]) => {
    const result = await apiCreateInventoryGroupApi(g);
    await refreshGroups();
    await refreshInventory();
    return result;
  }, [refreshGroups, refreshInventory]);

  const handleUpdateGroup = useCallback(async (id: string, patch: Parameters<typeof apiUpdateInventoryGroupApi>[1]) => {
    const result = await apiUpdateInventoryGroupApi(id, patch);
    await refreshGroups();
    return result;
  }, [refreshGroups]);
```

Add `refreshGroups()` to `refreshAll`'s `Promise.all` (line 469), and add `groups, refreshGroups, apiCreateGroup: handleCreateGroup, apiUpdateGroup: handleUpdateGroup` to the `value` object and its `useMemo` dependency array (line 666-717).

- [ ] **Step 6: Verify**

Run: `cd home-bakery-management-system && npm test && npm run build`
Expected: tests pass; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add home-bakery-management-system/src/context/StoreContext.tsx
git commit -m "feat(admin): ingredient groups in store context"
```

---

### Task 7: Shared `GroupPicker` component + `useIngredientGroups` hook

**Files:**
- Create: `home-bakery-management-system/src/components/GroupPicker.tsx`
- Create: `home-bakery-management-system/src/hooks/useIngredientGroups.ts`

**Interfaces:**
- Consumes: `IngredientGroup`, `InventoryItem`, `Product` from `../types`; `useStore`; `composeLabelFromRecipe` from `../utils/label`; `isActiveMember` from `../utils/ingredientGroups`.
- Produces:
  - `GroupPicker` props: `{ groups: IngredientGroup[]; choice: GroupChoice; setChoice: (c: GroupChoice) => void; makeActive: boolean; setMakeActive: (b: boolean) => void; canMakeActive: boolean }` with `export type GroupChoice = { kind: "none" } | { kind: "existing"; id: string } | { kind: "new"; name: string }`.
  - `useIngredientGroups(): { activateItem: (group: IngredientGroup, item: InventoryItem) => Promise<{ affected: number; relabeled: number; message: string }> }`.
  - Tasks 8 and 9 consume both.

- [ ] **Step 1: Write the `GroupPicker` component**

```tsx
// home-bakery-management-system/src/components/GroupPicker.tsx
import type { IngredientGroup } from "../types";

export type GroupChoice =
  | { kind: "none" }
  | { kind: "existing"; id: string }
  | { kind: "new"; name: string };

export function GroupPicker({ groups, choice, setChoice, makeActive, setMakeActive, canMakeActive }: {
  groups: IngredientGroup[];
  choice: GroupChoice;
  setChoice: (c: GroupChoice) => void;
  makeActive: boolean;
  setMakeActive: (b: boolean) => void;
  canMakeActive: boolean;
}) {
  const selectValue =
    choice.kind === "existing" ? choice.id : choice.kind === "new" ? "__new__" : "";
  return (
    <div className="space-y-2">
      <label className="mb-1 block text-xs font-medium text-stone-500">
        What is this used for?
      </label>
      <select
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "") setChoice({ kind: "none" });
          else if (v === "__new__") setChoice({ kind: "new", name: "" });
          else setChoice({ kind: "existing", id: v });
        }}
        className="w-full rounded-lg border border-stone-300 px-3 py-2"
      >
        <option value="">Standalone (not linked to an ingredient)</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
            {g.usedBy.length ? ` — used in: ${g.usedBy.join(", ")}` : ""}
          </option>
        ))}
        <option value="__new__">Create new ingredient group…</option>
      </select>
      {choice.kind === "new" && (
        <input
          autoFocus
          type="text"
          value={choice.name}
          onChange={(e) => setChoice({ kind: "new", name: e.target.value })}
          placeholder="e.g. All-Purpose Flour"
          className="w-full rounded-lg border border-stone-300 px-3 py-2"
        />
      )}
      {canMakeActive && (
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input
            type="checkbox"
            checked={makeActive}
            onChange={(e) => setMakeActive(e.target.checked)}
          />
          Use for all products (make active)
        </label>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write the `useIngredientGroups` hook**

```ts
// home-bakery-management-system/src/hooks/useIngredientGroups.ts
import { useCallback } from "react";
import { useStore } from "../context/StoreContext";
import { composeLabelFromRecipe } from "../utils/label";
import type { IngredientGroup, InventoryItem } from "../types";

// Activates `item` as the group's active ingredient, then re-saves the label
// fields (ingredients + allergens) of every affected product so the swap is
// reflected in the stored label data immediately.
export function useIngredientGroups() {
  const { products, inventory, apiUpdateGroup, apiUpdateProduct, refreshProducts, refreshInventory } = useStore();

  const activateItem = useCallback(async (group: IngredientGroup, item: InventoryItem) => {
    const res = await apiUpdateGroup(group.id, { active_item_id: item.id });
    const affected = (res && res.affectedProductIds) || [];
    const memberIds = new Set(group.members.map((m) => m.id));
    let relabeled = 0;
    for (const pid of affected) {
      const prod = products.find((p) => p.id === pid);
      if (!prod || prod.auto_generate_label === false) continue;
      // After the swap every member line resolves to the new active item; mirror
      // that locally (closure products are pre-refresh) before composing.
      const patched: typeof prod = {
        ...prod,
        recipe: (prod.recipe || []).map((r) =>
          memberIds.has(r.inventoryItemId) ? { ...r, inventoryItemId: item.id } : r
        ),
      };
      const composed = composeLabelFromRecipe(patched, inventory);
      await apiUpdateProduct(pid, { ingredients: composed.ingredients, allergens: composed.allergens });
      relabeled += 1;
    }
    await refreshProducts();
    await refreshInventory();
    return {
      affected: affected.length,
      relabeled,
      message: `${group.name} → ${item.name}. ${affected.length} product${affected.length === 1 ? "" : "s"} switched, ${relabeled} relabeled.`,
    };
  }, [products, inventory, apiUpdateGroup, apiUpdateProduct, refreshProducts, refreshInventory]);

  return { activateItem };
}
```

- [ ] **Step 3: Verify compile**

Run: `cd home-bakery-management-system && npm run build`
Expected: build succeeds (components not yet imported, so no runtime effect).

- [ ] **Step 4: Commit**

```bash
git add home-bakery-management-system/src/components/GroupPicker.tsx home-bakery-management-system/src/hooks/useIngredientGroups.ts
git commit -m "feat(admin): shared GroupPicker + useIngredientGroups hook"
```

---

### Task 8: Inventory page — used-in display, make-active, group selector

**Files:**
- Modify: `home-bakery-management-system/src/pages/Inventory.tsx`

**Interfaces:**
- Consumes: `groups`, `apiCreateGroup` from `useStore`; `GroupPicker`, `GroupChoice` from `../components/GroupPicker`; `useIngredientGroups` from `../hooks/useIngredientGroups`; `isActiveMember` from `../utils/ingredientGroups`.
- Produces: table rows show "used in" + active/"Make active"; edit/add modal has the group picker with optional "make active".

- [ ] **Step 1: Add imports and store destructure**

Change the import block and `useStore()` destructure (line 32):

```tsx
import { GroupPicker, type GroupChoice } from "../components/GroupPicker";
import { useIngredientGroups } from "../hooks/useIngredientGroups";
import { isActiveMember } from "../utils/ingredientGroups";
```

```tsx
  const { inventory, products, orders, apiCreateInventoryItem, apiUpdateInventoryItem, apiDeleteInventoryItem, groups, apiCreateGroup } = useStore();
  const { activateItem } = useIngredientGroups();
```

- [ ] **Step 2: Add group state + status message**

Near the existing state (line 35):

```tsx
  const [groupChoice, setGroupChoice] = useState<GroupChoice>({ kind: "none" });
  const [makeActiveChecked, setMakeActiveChecked] = useState(false);
  const [groupStatus, setGroupStatus] = useState("");
```

In `openNew()` (line 62), add resets:

```tsx
    setGroupChoice({ kind: "none" });
    setMakeActiveChecked(false);
    setGroupStatus("");
```

In `openEdit(i)` (line 75), add:

```tsx
    setGroupChoice(i.groupId ? { kind: "existing", id: i.groupId } : { kind: "none" });
    setMakeActiveChecked(false);
    setGroupStatus("");
```

- [ ] **Step 3: Add the make-active action**

Add after `unbind` (line 166):

```tsx
  async function makeActive(item: InventoryItem, group: IngredientGroup) {
    const activeName = group.members.find((m) => m.id === group.activeItemId)?.name || "no active item";
    if (!confirm(`${group.name} currently uses ${activeName}. Make "${item.name}" the active one? Every product using ${group.name} will switch to it.`)) return;
    try {
      const r = await activateItem(group, item);
      setGroupStatus(r.message);
    } catch (err: any) {
      alert(`Failed to switch: ${err.message || err}`);
    }
  }
```

Add `IngredientGroup` to the `types` import at the top (`import type { InventoryItem, IngredientGroup } from "../types";`).

- [ ] **Step 4: Show "used in" + active/make-active in the row**

In the row `<td>` for the item name (line 285), after the `<div>{i.name}</div>`:

```tsx
                      {(() => {
                        const grp = i.groupId ? groups.find((g) => g.id === i.groupId) || null : null;
                        if (!grp) {
                          return <div className="mt-0.5 text-[10px] text-cocoa-muted">Standalone</div>;
                        }
                        const active = isActiveMember(i, grp);
                        return (
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                            <span className="rounded bg-sand-100 px-1.5 py-0.5 text-[10px] text-cocoa-muted">{grp.name}</span>
                            <span className="text-[10px] text-cocoa-muted">
                              used in: {grp.usedBy.length ? grp.usedBy.join(", ") : "—"}
                            </span>
                            {active ? (
                              <Badge tone="ok">active</Badge>
                            ) : (
                              <button
                                onClick={() => makeActive(i, grp)}
                                title={`Make ${i.name} the active ${grp.name}`}
                                className="rounded border border-palm/30 px-1.5 py-0.5 text-[10px] font-medium text-palm hover:bg-palm/5"
                              >
                                Make active
                              </button>
                            )}
                          </div>
                        );
                      })()}
```

Render the status message near the header (after the header buttons, line 259):

```tsx
      {groupStatus && (
        <div className="rounded-lg bg-palm/10 px-3 py-2 text-sm text-palm">{groupStatus}</div>
      )}
```

- [ ] **Step 5: Add the group picker to the edit/add modal**

In the modal (line 375), after the Barcode field and before the label-info block, insert:

```tsx
          <GroupPicker
            groups={groups}
            choice={groupChoice}
            setChoice={setGroupChoice}
            makeActive={makeActiveChecked}
            setMakeActive={setMakeActiveChecked}
            canMakeActive={
              groupChoice.kind === "new" ||
              (groupChoice.kind === "existing" &&
                !(groups.find((g) => g.id === groupChoice.id)?.activeItemId))
            }
          />
```

- [ ] **Step 6: Handle groups in `save()`**

Rewrite `save()` (line 88) to create/assign the group and optionally activate. The item id is generated upfront so a brand-new group can be created with the new item as its active member:

```tsx
  async function save() {
    if (!draft.name.trim()) return;
    const allergens = allergensText.split(",").map((s) => s.trim()).filter(Boolean);
    const basePayload: Record<string, any> = {
      name: draft.name,
      category: draft.category,
      quantity: draft.quantity,
      unit: draft.unit,
      reorder_level: draft.reorderLevel,
      cost_per_unit: draft.costPerUnit,
      supplier: draft.supplier,
      ingredients_label: draft.ingredients_label,
      unit_weight: draft.unit_weight,
      allergens: allergens.length ? allergens : undefined,
      barcode: draft.barcode ? draft.barcode : null,
      nutrition_source: draft.nutritionSource,
      nutrition_fetched_at: draft.nutritionFetchedAt,
    };
    try {
      const itemId = editingId || `inv_${Date.now().toString(36)}`;
      let groupId: string | null = null;
      if (groupChoice.kind === "existing") {
        groupId = groupChoice.id;
      } else if (groupChoice.kind === "new" && groupChoice.name.trim()) {
        const g = await apiCreateGroup({
          name: groupChoice.name.trim(),
          category: draft.category || null,
          active_item_id: makeActiveChecked ? itemId : null,
        });
        groupId = g.id;
      }
      basePayload.group_id = groupId;
      if (editingId) {
        await apiUpdateInventoryItem(editingId, basePayload);
      } else {
        await apiCreateInventoryItem({ ...basePayload, id: itemId, active: draft.active ?? true } as any);
      }
      if (groupChoice.kind === "existing" && groupId && makeActiveChecked) {
        const grp = groups.find((g) => g.id === groupId);
        if (grp) {
          const r = await activateItem(grp, { ...draft, id: itemId } as InventoryItem);
          setGroupStatus(r.message);
        }
      }
      setModalOpen(false);
    } catch (err: any) {
      console.error("Save inventory item failed:", err);
      alert(`Failed to save item: ${err.message || err}`);
    }
  }
```

Notes:
- "New group + make active" needs no `activateItem` call — the group is created with `active_item_id` already set, and no products reference the new group's members yet, so nothing is rewritten.
- "Existing group + make active" goes through `activateItem`, which rewrites recipes server-side and re-saves the affected products' label fields.

- [ ] **Step 7: Verify**

Run: `cd home-bakery-management-system && npm test && npm run build`
Expected: tests pass; build succeeds.

- [ ] **Step 8: Commit**

```bash
git add home-bakery-management-system/src/pages/Inventory.tsx
git commit -m "feat(admin): ingredient group UI in inventory page"
```

---

### Task 9: Scan flow — "what is this used for?" + swap prompt

**Files:**
- Modify: `home-bakery-management-system/src/components/ScanModal.tsx`

**Interfaces:**
- Consumes: `groups` from `useStore`; `createInventoryGroup` from `../utils/api`; `GroupPicker`, `GroupChoice` from `../components/GroupPicker`; `useIngredientGroups` from `../hooks/useIngredientGroups`; `isActiveMember` from `../utils/ingredientGroups`.
- Produces: new-item panels ask the group; adjust panel shows active/swap info; new-item creation assigns `group_id` and optionally activates.

- [ ] **Step 1: Add imports + store/hook access**

In ScanModal's imports, add `createInventoryGroup` to the `../utils/api` import; add:

```tsx
import { GroupPicker, type GroupChoice } from "./GroupPicker";
import { useIngredientGroups } from "../hooks/useIngredientGroups";
import { isActiveMember } from "../utils/ingredientGroups";
```

In the component body (line 41):

```tsx
  const { inventory, groups, refreshInventory } = useStore();
  const { activateItem } = useIngredientGroups();
```

Add state near the other useState (line 52):

```tsx
  const [groupChoice, setGroupChoice] = useState<GroupChoice>({ kind: "none" });
  const [makeActiveChecked, setMakeActiveChecked] = useState(false);
  const [swapMsg, setSwapMsg] = useState("");
```

- [ ] **Step 2: Add the swap action**

After `unbindCurrent` (line 418):

```tsx
  // Swap a scanned (non-active) member in as the group's active ingredient.
  const swapToItem = useCallback(async (group: IngredientGroup, it: ApiInventoryItem) => {
    setBusy(true);
    setErrMsg("");
    try {
      const r = await activateItem(group, it as any);
      setSwapMsg(r.message);
    } catch (e: any) {
      setErrMsg(String(e?.message || "Switch failed"));
    } finally {
      setBusy(false);
    }
  }, [activateItem]);
```

Add `IngredientGroup` to the `import type { InventoryItem } from "../types";` line → `import type { IngredientGroup, InventoryItem } from "../types";`.

- [ ] **Step 3: Pass group props into `NewItemPanel`**

In the render for `(mode === "suggestCreate" || mode === "manualCreate")` (line 541), add props:

```tsx
            groups={groups}
            groupChoice={groupChoice}
            setGroupChoice={setGroupChoice}
            makeActive={makeActiveChecked}
            setMakeActive={setMakeActiveChecked}
```

- [ ] **Step 4: Update `createNewItem` to assign a group**

Replace `createNewItem` (line 344) with:

```tsx
  const createNewItem = useCallback(async () => {
    const nm = newName.trim();
    if (!nm) return;
    setBusy(true);
    setErrMsg("");
    const payload: InventoryItemCreate = {
      id: `inv_${Date.now().toString(36)}`,
      name: nm,
      category: newCategory.trim() || "Uncategorized",
      unit: newUnit.trim() || "ea",
      quantity: 0,
      barcode: code,
    };
    if (offProduct) {
      payload.nutrition_source = `off:${code}`;
      payload.nutrition_fetched_at = new Date().toISOString();
      if (offProduct.brand) payload.supplier = offProduct.brand;
      if (offProduct.ingredients) payload.ingredients_label = offProduct.ingredients;
      if (offProduct.allergens.length) payload.allergens = offProduct.allergens;
      if (offProduct.unitWeightLb != null) payload.unit_weight = offProduct.unitWeightLb;
    }
    try {
      let groupId: string | null = null;
      if (groupChoice.kind === "existing") {
        groupId = groupChoice.id;
      } else if (groupChoice.kind === "new" && groupChoice.name.trim()) {
        const g = await createInventoryGroup({
          name: groupChoice.name.trim(),
          category: newCategory.trim() || null,
          active_item_id: makeActiveChecked ? payload.id : null,
        });
        groupId = g.id;
      }
      if (groupId) payload.group_id = groupId;

      await createInventoryItem(payload);
      await refreshInventory();

      if (groupChoice.kind === "existing" && groupId && makeActiveChecked) {
        const grp = groups.find((g) => g.id === groupId);
        if (grp) {
          const r = await activateItem(grp, { id: payload.id, name: nm } as any);
          setSwapMsg(r.message);
        }
      }
    } catch (e: any) {
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
        setErrMsg(String(e?.message || "Add failed"));
        setMode("error");
      }
      setBusy(false);
      return;
    }
    try {
      await gotoAdjust();
    } catch (e: any) {
      setErrMsg(String(e?.message || "Item added but re-lookup failed"));
      setMode("error");
    } finally {
      setBusy(false);
    }
  }, [newName, newCategory, newUnit, offProduct, code, groupChoice, makeActiveChecked, groups, activateItem, gotoAdjust, refreshInventory]);
```

- [ ] **Step 5: Extend `NewItemPanel` component props + render the picker**

Update the `NewItemPanel` signature and add the `GroupPicker` after the unit field (before the footer buttons):

```tsx
function NewItemPanel({ code, offProduct, name, setName, category, setCategory, unit, setUnit, categories, groups, groupChoice, setGroupChoice, makeActive, setMakeActive, onAdd, onBind, onCancel, busy }: {
  code: string;
  offProduct: OffProduct | null;
  name: string;
  setName: (s: string) => void;
  category: string;
  setCategory: (s: string) => void;
  unit: string;
  setUnit: (s: string) => void;
  categories: string[];
  groups: IngredientGroup[];
  groupChoice: GroupChoice;
  setGroupChoice: (c: GroupChoice) => void;
  makeActive: boolean;
  setMakeActive: (b: boolean) => void;
  onAdd: () => void;
  onBind: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
```

Inside the `<div className="mt-3 space-y-3">` block, after the category/unit grid, add:

```tsx
        <GroupPicker
          groups={groups}
          choice={groupChoice}
          setChoice={setGroupChoice}
          makeActive={makeActive}
          setMakeActive={setMakeActive}
          canMakeActive={
            groupChoice.kind === "new" ||
            (groupChoice.kind === "existing" &&
              !(groups.find((g) => g.id === groupChoice.id)?.activeItemId))
          }
        />
```

- [ ] **Step 6: Show active/swap info in the adjust panel**

In the `adjust` render (line 512), pass the group to `AdjustPanel`:

```tsx
          <AdjustPanel
            item={item}
            group={item.group_id ? groups.find((g) => g.id === item.group_id) || null : null}
            swapMsg={swapMsg}
            onSwap={swapToItem}
            recognized={recognized}
            ...
          />
```

Update `AdjustPanel`'s signature to accept `group`, `swapMsg`, `onSwap` and render a banner at the top (after the header, before the out-of-stock block):

```tsx
function AdjustPanel({ item, group, swapMsg, onSwap, recognized, countMode, countValue, setCountValue, onSwitchMode, onSave, onCancel, onUnbind, busy }: {
  item: ApiInventoryItem;
  group: IngredientGroup | null;
  swapMsg: string;
  onSwap: (group: IngredientGroup, item: ApiInventoryItem) => void;
  recognized: RecognizedInfo | null;
  countMode: "add" | "set";
  countValue: number;
  setCountValue: (n: number) => void;
  onSwitchMode: (m: "add" | "set") => void;
  onSave: () => void;
  onCancel: () => void;
  onUnbind: () => void;
  busy: boolean;
}) {
  const active = group ? isActiveMember(item, group) : false;
  const activeName = group ? group.members.find((m) => m.id === group.activeItemId)?.name : "";
  ...
```

In the JSX, right after the header `<div className="flex items-start justify-between gap-3">…</div>` block, add:

```tsx
      {group && active && (
        <div className="mt-3 rounded-lg border border-palm/30 bg-palm/5 px-3 py-2 text-sm text-stone-700">
          <CheckCircle2 className="mr-1.5 inline h-4 w-4 text-palm" />
          Active for <strong>{group.name}</strong>
          {group.usedBy.length ? ` · used in ${group.usedBy.join(", ")}` : ""}.
        </div>
      )}
      {group && !active && (
        <div className="mt-3 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p>
            <strong>{group.name}</strong> currently uses{" "}
            <strong>{activeName || "no active item"}</strong>. Use <strong>{item.name}</strong> for every
            product in this group instead?
          </p>
          <button
            onClick={() => onSwap(group, item)}
            disabled={busy}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" /> Switch to {item.name}
          </button>
        </div>
      )}
      {swapMsg && (
        <div className="mt-3 rounded-lg border border-palm/30 bg-palm/5 px-3 py-2 text-sm text-palm">{swapMsg}</div>
      )}
```

- [ ] **Step 7: Verify**

Run: `cd home-bakery-management-system && npm test && npm run build`
Expected: tests pass; build succeeds.

- [ ] **Step 8: Commit**

```bash
git add home-bakery-management-system/src/components/ScanModal.tsx
git commit -m "feat(admin): scan flow asks ingredient group + offers swap"
```

---

### Task 10: Products page — group the recipe editor

**Files:**
- Modify: `home-bakery-management-system/src/pages/Products.tsx`

**Interfaces:**
- Consumes: `groups` from `useStore`; `isActiveMember` from `../utils/ingredientGroups`.
- Produces: recipe editor groups inventory items under ingredient-group headers with an active badge.

- [ ] **Step 1: Add the store access + grouping memo**

Add to the destructure (line 37): `groups` from `useStore`. Add a memo after `composedLabelPreview` (line 50):

```tsx
  const groupedInventory = useMemo(() => {
    const buckets = new Map<string | null, typeof inventory[number][]>();
    for (const it of inventory) {
      const key = it.groupId || null;
      const arr = buckets.get(key) || [];
      arr.push(it);
      buckets.set(key, arr);
    }
    return [...buckets.entries()].map(([key, items]) => ({
      group: key ? groups.find((g) => g.id === key) || null : null,
      items,
    }));
  }, [inventory, groups]);
```

- [ ] **Step 2: Replace the flat recipe list with grouped sections**

Replace the `{inventory.map((item) => { ... })}` block (lines 577-604) with:

```tsx
              {groupedInventory.map(({ group, items }) => (
                <div key={group?.id ?? "__standalone__"} className="rounded-lg bg-sand-50 p-2">
                  <div className="flex items-center justify-between px-1 pb-1 text-[11px] font-medium text-cocoa-muted">
                    <span>{group?.name ?? "Standalone"}</span>
                    {group?.activeItemId && (
                      <span className="text-palm">
                        active: {items.find((i) => i.id === group.activeItemId)?.name ?? ""}
                      </span>
                    )}
                  </div>
                  {items.map((item) => {
                    const rec = draft.recipe.find((r) => r.inventoryItemId === item.id);
                    const active = group ? isActiveMember(item, group) : false;
                    return (
                      <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2">
                        <label className="flex items-center gap-2 text-sm text-cocoa-muted">
                          <input type="checkbox" checked={!!rec} onChange={() => toggleRecipe(item.id)} />
                          {item.name}
                          {active && (
                            <span className="rounded bg-palm/10 px-1.5 py-0.5 text-[10px] text-palm">active</span>
                          )}
                          {item.barcode && item.barcode !== item.id && (
                            <span className="rounded bg-sand-100 px-1.5 py-0.5 font-mono text-[10px] text-cocoa-muted" title="Scanned barcode bound to this ingredient">
                              {item.barcode}
                            </span>
                          )}
                        </label>
                        {rec && (
                          <div className="flex items-center gap-1 text-xs text-cocoa-muted">
                            <input
                              type="number"
                              step="0.01"
                              value={rec.qtyPerUnit}
                              onChange={(e) => updateRecipeQty(item.id, Number(e.target.value))}
                              className="w-16 rounded-md border border-sand-200 px-1.5 py-1 text-right"
                            />
                            {item.unit}/unit
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
```

- [ ] **Step 3: Verify**

Run: `cd home-bakery-management-system && npm test && npm run build`
Expected: tests pass; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add home-bakery-management-system/src/pages/Products.tsx
git commit -m "feat(admin): group recipe editor by ingredient group"
```

---

### Task 11: Full verification + build

**Files:**
- None (verification only).

- [ ] **Step 1: Worker tests**

Run: `cd orders && npm test`
Expected: all worker tests pass (incl. `groups-lib.test.js`).

- [ ] **Step 2: SPA tests**

Run: `cd home-bakery-management-system && npm test`
Expected: all SPA tests pass (incl. `ingredientGroups.test.ts`).

- [ ] **Step 3: SPA build**

Run: `cd home-bakery-management-system && npm run build`
Expected: succeeds; postbuild copies bundle to `admin/index.html`.

- [ ] **Step 4: Migration (production)**

Run: `npx wrangler d1 execute muy-rico-orders --remote --file=orders/migrations/0041_inventory_ingredient_groups.sql`
Expected: applies cleanly.

- [ ] **Step 5: Worker deploy**

Run: `npx wrangler deploy -c orders/wrangler.toml`
Expected: deploy succeeds (new endpoints + `group_id` field).

- [ ] **Step 6: Frontend deploy**

Run: `npx wrangler versions upload --name muyrico --assets . --compatibility-date 2025-03-21` then `npx wrangler versions deploy --name muyrico <VERSION>@100%`
Expected: admin SPA with the new group UI is live.

- [ ] **Step 7: Manual E2E smoke test**

In the live admin SPA:
1. Inventory → add a second all-purpose flour item (e.g. "Great Value AP Flour") with the group picker set to the existing AP-flour group.
2. In the row, click **Make active** → confirm → row shows "active", and Bolillos/Conchas recipes now reference the new item (verify in Products → recipe editor).
3. Scan that item's barcode → adjust panel shows "Active for All-Purpose Flour · used in …".
4. Add a genuinely new ingredient (e.g. a new brand of bread flour) → picker → "Create new ingredient group…" → name "Bread Flour" → checkbox "Use for all products" → saves as active.

**Rollback:** a bad swap is undone by setting another member active (or reassigning `group_id`); recipes always hold concrete ids, so deduction is never blocked.