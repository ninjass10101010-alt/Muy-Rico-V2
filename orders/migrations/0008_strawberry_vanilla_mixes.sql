-- Muy Rico — Add Betty Crocker Strawberry & Vanilla Cake Mixes + update label ingredients
--
-- Run:
--   npx wrangler d1 execute muy-rico-orders --file=migrations/0008_strawberry_vanilla_mixes.sql
--   npx wrangler d1 execute muy-rico-orders --remote --file=migrations/0008_strawberry_vanilla_mixes.sql

-- ── Add Betty Crocker Super Moist Strawberry Cake Mix ─────────────────────────
INSERT OR IGNORE INTO inventory
  (id, name, category, quantity, unit, reorder_level, cost_per_unit, supplier,
   ingredients_label, allergens, unit_weight)
VALUES
  ('inv_betty_crocker_strawberry',
   'Betty Crocker Super Moist Strawberry Cake Mix',
   'Baking', 5, 'box', 2, 2.50, 'Costco',
   'Enriched Flour Bleached (wheat flour, niacin, iron, thiamin mononitrate, riboflavin, folic acid), Sugar, Corn Syrup, Leavening (baking soda, sodium aluminum phosphate, monocalcium phosphate), Modified Corn Starch, Corn Starch, Propylene Glycol Mono and Diesters of Fatty Acids, Salt, Monoglycerides, Palm Oil, Dicalcium Phosphate, Sodium Stearoyl Lactylate, Xanthan Gum, Cellulose Gum, Natural and Artificial Flavor, Red 40',
   '["Wheat"]', 0.95);

-- ── Add Betty Crocker Super Moist Vanilla Cake Mix ────────────────────────────
INSERT OR IGNORE INTO inventory
  (id, name, category, quantity, unit, reorder_level, cost_per_unit, supplier,
   ingredients_label, allergens, unit_weight)
VALUES
  ('inv_betty_crocker_vanilla',
   'Betty Crocker Super Moist Vanilla Cake Mix',
   'Baking', 5, 'box', 2, 2.50, 'Costco',
   'Enriched Flour Bleached (wheat flour, niacin, iron, thiamin mononitrate, riboflavin, folic acid), Sugar, Corn Syrup, Leavening (baking soda, sodium aluminum phosphate, monocalcium phosphate), Modified Corn Starch, Corn Starch, Propylene Glycol Mono and Diesters of Fatty Acids, Salt, Monoglycerides, Palm Oil, Dicalcium Phosphate, Sodium Stearoyl Lactylate, Xanthan Gum, Cellulose Gum, Natural and Artificial Flavor',
   '["Wheat"]', 0.95);

-- ── Cupcakes (6) — now lists all three cake mix flavors on the label ─────────
-- Recipe uses 0.25 box per 6-pack (24 cupcakes per box).
-- We represent the "primary" mix used as the main recipe item, but the
-- label now correctly discloses all three mix options (chocolate, vanilla, strawberry).
UPDATE products
SET
  ingredients = 'Betty Crocker Super Moist Cake Mix — Chocolate Fudge (Enriched Flour Bleached [wheat flour, niacin, iron, thiamin mononitrate, riboflavin, folic acid], Sugar, Cocoa Processed with Alkali, Corn Syrup, Leavening [baking soda, sodium aluminum phosphate, monocalcium phosphate], Modified Corn Starch, Corn Starch, Palm Oil, Salt, Artificial Flavor) OR Strawberry (Enriched Flour Bleached [wheat flour, niacin, iron, thiamin mononitrate, riboflavin, folic acid], Sugar, Corn Syrup, Leavening [baking soda, sodium aluminum phosphate, monocalcium phosphate], Modified Corn Starch, Corn Starch, Propylene Glycol Mono and Diesters of Fatty Acids, Salt, Monoglycerides, Palm Oil, Natural and Artificial Flavor, Red 40) OR Vanilla (Enriched Flour Bleached [wheat flour, niacin, iron, thiamin mononitrate, riboflavin, folic acid], Sugar, Corn Syrup, Leavening [baking soda, sodium aluminum phosphate, monocalcium phosphate], Modified Corn Starch, Corn Starch, Propylene Glycol Mono and Diesters of Fatty Acids, Salt, Monoglycerides, Palm Oil, Natural and Artificial Flavor), water, butter (cream, salt), eggs, vanilla extract.',
  allergens = 'Contains: wheat, milk, eggs. May contain: milk (strawberry variety).',
  recipe = '[
    {"inventoryItemId":"inv_betty_crocker_chocolate","qtyPerUnit":0.083},
    {"inventoryItemId":"inv_betty_crocker_strawberry","qtyPerUnit":0.083},
    {"inventoryItemId":"inv_betty_crocker_vanilla","qtyPerUnit":0.083},
    {"inventoryItemId":"inv_butter","qtyPerUnit":0.0625},
    {"inventoryItemId":"inv_eggs","qtyPerUnit":0.0625},
    {"inventoryItemId":"inv_vanilla","qtyPerUnit":0.025}
  ]'
WHERE id = 'prod_cupcakes';

-- ── Custom Cake — update label to use Betty Crocker Vanilla as the base ───────
UPDATE products
SET
  ingredients = 'Betty Crocker Super Moist Vanilla Cake Mix (Enriched Flour Bleached [wheat flour, niacin, iron, thiamin mononitrate, riboflavin, folic acid], Sugar, Corn Syrup, Leavening [baking soda, sodium aluminum phosphate, monocalcium phosphate], Modified Corn Starch, Corn Starch, Propylene Glycol Mono and Diesters of Fatty Acids, Salt, Monoglycerides, Palm Oil, Natural and Artificial Flavor), water, butter (cream, salt), eggs, vanilla extract.',
  allergens = 'Contains: wheat, milk, eggs.',
  recipe = '[
    {"inventoryItemId":"inv_betty_crocker_vanilla","qtyPerUnit":1.0},
    {"inventoryItemId":"inv_butter","qtyPerUnit":0.25},
    {"inventoryItemId":"inv_eggs","qtyPerUnit":0.25},
    {"inventoryItemId":"inv_vanilla","qtyPerUnit":0.05}
  ]'
WHERE id = 'prod_custom_cake';
