-- Muy Rico — Migration 0049
-- Betty Crocker 432 g → 375 g box relaunch + consolidation of Aug-26 scan duplicates.
--
-- Findings this migration fixes:
--   1. New Betty Crocker Super Moist boxes are 13.25 oz (375 g ≈ 0.83 lb), down from
--      15.25 oz (432 g ≈ 0.95 lb). UPCs moved from the 016000-4xxxx range to
--      016000-2xxxx (vanilla 375 g = 016000207523).
--   2. Scanning the new boxes created duplicates because gun codes (12-digit UPC-A,
--      e.g. 644209307562) missed stored 13-digit / placeholder barcodes:
--        inv_mtaqjos6 "Betty Cracker Super Moist Vanilla cake mix"    → dup of inv_betty_crocker_vanilla
--        inv_mtaqi5vj "Perfectly moist dark chocolate fudge cake mix" → dup of inv_duncan_hines_chocolate
--        inv_mtaqh1p9 "Classic white cake mix" → NEW product (DH Classic White), kept + normalized
--   3. inv_betty_crocker_chocolate was retired earlier, but cakepops/cupcakes/custom-cake
--      recipes + flavor_deduction_maps still referenced it (silent costing breakage).
--      Chocolate mixes now resolve to Duncan Hines (per 0042 convention).
--
-- Assumption to verify on next cycle count: the scanned vanilla duplicate was counted
-- as "2" with unit lb only because the scan-create form defaults unit to the OFF
-- weight unit; the owner intended 2 boxes, so its quantity merges 1:1 into the
-- canonical box row (0.75 → 2.75).
--
-- Run:
--   npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --local  --file=orders/migrations/0049_betty_crocker_375g.sql
--   npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0049_betty_crocker_375g.sql

-- ── 1. Retire scanned vanilla duplicate (merge stock into canonical) ─────────
UPDATE inventory
SET quantity = quantity + (SELECT quantity FROM inventory WHERE id = 'inv_mtaqjos6' AND active = 1),
    updated_at = datetime('now')
WHERE id = 'inv_betty_crocker_vanilla'
  AND EXISTS (SELECT 1 FROM inventory WHERE id = 'inv_mtaqjos6' AND active = 1);

-- Barcode freed here so the new UPC can bind to the canonical row below
-- without tripping idx_inventory_barcode.
UPDATE inventory
SET barcode = NULL, active = 0, updated_at = datetime('now')
WHERE id = 'inv_mtaqjos6' AND active = 1;

-- ── 2. Retire scanned Duncan Hines chocolate duplicate (merge stock) ─────────
-- (Canonical holds the 13-digit 0644209307562; the gun emitted the 12-digit form.
-- The UPC-A↔EAN-13 lookup fix in the API makes either form scan to this row now.)
UPDATE inventory
SET quantity = quantity + (SELECT quantity FROM inventory WHERE id = 'inv_mtaqi5vj' AND active = 1),
    updated_at = datetime('now')
WHERE id = 'inv_duncan_hines_chocolate'
  AND EXISTS (SELECT 1 FROM inventory WHERE id = 'inv_mtaqi5vj' AND active = 1);

UPDATE inventory
SET barcode = NULL, active = 0, updated_at = datetime('now')
WHERE id = 'inv_mtaqi5vj' AND active = 1;

-- ── 3. Betty Crocker Vanilla — bind new-box barcode + 375 g weight ───────────
-- Carries over the OFF enrichment cache from the scanned duplicate; keeps the
-- existing ingredients label (the OFF row for 016000207523 has no usable label).
UPDATE inventory
SET barcode = '016000207523',
    unit_weight = 0.83,
    nutrition_source = 'off:016000207523',
    nutrition_fetched_at = '2026-08-26T23:39:08.214Z',
    updated_at = datetime('now')
WHERE id = 'inv_betty_crocker_vanilla';

-- ── 4. Betty Crocker Strawberry — already bound to its 375 g UPC, fix weight ─
-- 016000207776 = "Betty Crocker Super Moist Strawberry 375 g" (Open Food Facts).
UPDATE inventory
SET unit_weight = 0.83,
    updated_at = datetime('now')
WHERE id = 'inv_betty_crocker_strawberry';

-- ── 5. Normalize DH Classic White (genuinely new stock, keep as canonical) ───
UPDATE inventory
SET name = 'Duncan Hines Classic White Cake Mix',
    category = 'Baking',
    unit = 'box',
    reorder_level = 2,
    cost_per_unit = 2.50,
    unit_weight = 0.95,
    ingredients_label = 'Sugar, Enriched Bleached Wheat Flour (flour, niacin, reduced iron, thiamine mononitrate, riboflavin, folic acid), Emulsified Palm Shortening (palm oil, propylene glycol mono- and diesters of fats and fatty acids, mono- and diglycerides, sodium stearoyl lactylate), Leavening (baking soda, dicalcium phosphate, sodium aluminum phosphate, monocalcium phosphate), Wheat Starch, Contains 2% or less of: Modified Food Starch, Dextrose, Salt, Palm Oil, Soy Lecithin, Natural and Artificial Flavor, Guar Gum, Xanthan Gum.',
    allergens = '["Wheat","Soy"]',
    updated_at = datetime('now')
WHERE id = 'inv_mtaqh1p9';

INSERT OR IGNORE INTO ingredient_groups (id, name, category, active_item_id)
VALUES ('grp_inv_mtaqh1p9', 'Duncan Hines Classic White Cake Mix', 'Baking', 'inv_mtaqh1p9');

UPDATE inventory
SET group_id = 'grp_inv_mtaqh1p9', updated_at = datetime('now')
WHERE id = 'inv_mtaqh1p9' AND group_id IS NULL;

-- ── 6. Repoint dangling Betty Crocker Chocolate refs → Duncan Hines ──────────
-- The BC Triple Chocolate Fudge row is gone; chocolate deduction must resolve to
-- the mix actually in use (Duncan Hines Dark Chocolate Fudge, per 0042).
UPDATE products
SET recipe = replace(recipe, 'inv_betty_crocker_chocolate', 'inv_duncan_hines_chocolate'),
    updated_at = datetime('now')
WHERE recipe LIKE '%inv_betty_crocker_chocolate%';

UPDATE products
SET flavor_deduction_map = replace(flavor_deduction_map, 'inv_betty_crocker_chocolate', 'inv_duncan_hines_chocolate'),
    updated_at = datetime('now')
WHERE flavor_deduction_map LIKE '%inv_betty_crocker_chocolate%';

-- Belt & suspenders: retire the old BC chocolate row if a stale copy still exists.
UPDATE inventory
SET active = 0, updated_at = datetime('now')
WHERE id = 'inv_betty_crocker_chocolate' AND active = 1;
