-- Muy Rico — Migration 0009
-- Adds Pillsbury Whipped frostings to inventory, food_coloring to orders table,
-- and updates cupcake/cakepop product ingredient labels with frosting sub-ingredients.
--
-- Run:
--   npx wrangler d1 execute muy-rico-orders --local  --file=migrations/0009_frosting_coloring.sql
--   npx wrangler d1 execute muy-rico-orders --remote --file=migrations/0009_frosting_coloring.sql

-- ── Add food_coloring column to orders ───────────────────────────────────────
ALTER TABLE orders ADD COLUMN food_coloring TEXT;

-- ── Pillsbury Whipped Vanilla Frosting ────────────────────────────────────────
INSERT OR IGNORE INTO inventory
  (id, name, category, quantity, unit, reorder_level, cost_per_unit, supplier,
   ingredients_label, allergens, unit_weight)
VALUES
  ('inv_frosting_vanilla',
   'Pillsbury Whipped Vanilla Frosting',
   'Baking', 6, 'can', 2, 2.00, 'Costco',
   'Sugar, Palm Oil, Water, Corn Syrup, Canola Oil, Corn Starch, and 2% or less of: Mono- and Diglycerides, Natural and Artificial Flavor, Modified Corn Starch, Cellulose Gel, Salt, Propylene Glycol Monostearate, Carrageenan, Polysorbate 80, Potassium Sorbate (Preservative), Cellulose Gum, Citric Acid, Sodium Stearoyl Lactylate, Antioxidants (Ascorbyl Palmitate, Mixed Tocopherols, Chamomile and Rosemary Extracts)',
   '[]', 0.92);

-- ── Pillsbury Whipped Strawberry Frosting (contains Red 40) ─────────────────
INSERT OR IGNORE INTO inventory
  (id, name, category, quantity, unit, reorder_level, cost_per_unit, supplier,
   ingredients_label, allergens, unit_weight)
VALUES
  ('inv_frosting_strawberry',
   'Pillsbury Whipped Strawberry Frosting',
   'Baking', 6, 'can', 2, 2.00, 'Costco',
   'Sugar, Palm Oil, Water, Corn Syrup, Canola Oil, Corn Starch, and 2% or less of: Natural and Artificial Flavors, Mono- and Diglycerides, Modified Corn Starch, Salt, Cellulose, Propylene Glycol Monostearate, Carrageenan, Distilled Monoglycerides, Cellulose Gum, Polysorbate 80, Potassium Sorbate (Preservative), Sodium Stearoyl Lactylate, Antioxidants (Citric Acid, Ascorbyl Palmitate, Mixed Tocopherols), Red 40',
   '[]', 0.92);

-- ── Pillsbury Whipped Chocolate Frosting ─────────────────────────────────────
INSERT OR IGNORE INTO inventory
  (id, name, category, quantity, unit, reorder_level, cost_per_unit, supplier,
   ingredients_label, allergens, unit_weight)
VALUES
  ('inv_frosting_chocolate',
   'Pillsbury Whipped Chocolate Frosting',
   'Baking', 6, 'can', 2, 2.00, 'Costco',
   'Sugar, Palm Oil, Water, Corn Syrup, Canola Oil, Cocoa (processed with alkali), Corn Starch, and 2% or less of: Natural and Artificial Flavor, Mono- and Diglycerides, Modified Corn Starch, Cellulose, Salt, Propylene Glycol Monostearate, Carrageenan, Distilled Monoglycerides, Polysorbate 80, Potassium Sorbate (Preservative), Cellulose Gum, Sodium Stearoyl Lactylate, Antioxidants (Citric Acid, Ascorbyl Palmitate, Mixed Tocopherols, Chamomile and Rosemary Extracts)',
   '[]', 0.92);

-- ── Update Cupcakes (6) — add frosting sub-ingredients ───────────────────────
UPDATE products
SET
  ingredients = 'Betty Crocker Super Moist Cake Mix (Chocolate Fudge, Strawberry, or Vanilla variety — see flavor; Enriched Flour Bleached [wheat flour, niacin, iron, thiamin mononitrate, riboflavin, folic acid], Sugar, Corn Syrup, Leavening [baking soda, sodium aluminum phosphate, monocalcium phosphate], Corn Starch, Palm Oil, Salt, Natural and Artificial Flavor), water, butter (cream, salt), eggs, vanilla extract. Frosting (Vanilla or Chocolate variety): Sugar, Palm Oil, Water, Corn Syrup, Canola Oil, Corn Starch, and 2% or less of: Mono- and Diglycerides, Natural and Artificial Flavor, Modified Corn Starch, Cellulose Gel, Salt, Propylene Glycol Monostearate, Carrageenan, Polysorbate 80, Potassium Sorbate (Preservative), Cellulose Gum, Citric Acid, Sodium Stearoyl Lactylate, Antioxidants (Ascorbyl Palmitate, Mixed Tocopherols). Frosting (Strawberry variety): same base as above plus Red 40.',
  allergens = 'Contains: wheat, milk, eggs. Strawberry frosting variety contains Red 40 artificial color.',
  recipe = '[
    {"inventoryItemId":"inv_betty_crocker_chocolate","qtyPerUnit":0.083},
    {"inventoryItemId":"inv_betty_crocker_strawberry","qtyPerUnit":0.083},
    {"inventoryItemId":"inv_betty_crocker_vanilla","qtyPerUnit":0.083},
    {"inventoryItemId":"inv_butter","qtyPerUnit":0.0625},
    {"inventoryItemId":"inv_eggs","qtyPerUnit":0.0625},
    {"inventoryItemId":"inv_vanilla","qtyPerUnit":0.025},
    {"inventoryItemId":"inv_frosting_vanilla","qtyPerUnit":0.083},
    {"inventoryItemId":"inv_frosting_strawberry","qtyPerUnit":0.083},
    {"inventoryItemId":"inv_frosting_chocolate","qtyPerUnit":0.083}
  ]'
WHERE id = 'prod_cupcakes';

-- ── Update Cakepops — add frosting (used as binder) sub-ingredients ───────────
UPDATE products
SET
  ingredients = 'Betty Crocker Triple Chocolate Fudge Cake Mix (Enriched Flour Bleached [wheat flour, niacin, iron, thiamin mononitrate, riboflavin, folic acid], Sugar, Cocoa Processed with Alkali, Corn Syrup, Leavening [baking soda, sodium aluminum phosphate, monocalcium phosphate], Modified Corn Starch, Corn Starch, Palm Oil, Salt, Artificial Flavor), water, butter (cream, salt), eggs, vanilla extract. Frosting binder (Chocolate variety): Sugar, Palm Oil, Water, Corn Syrup, Canola Oil, Cocoa (processed with alkali), Corn Starch, and 2% or less of: Natural and Artificial Flavor, Mono- and Diglycerides, Modified Corn Starch, Cellulose, Salt, Propylene Glycol Monostearate, Carrageenan, Distilled Monoglycerides, Polysorbate 80, Potassium Sorbate (Preservative), Cellulose Gum, Sodium Stearoyl Lactylate, Antioxidants (Citric Acid, Ascorbyl Palmitate, Mixed Tocopherols, Chamomile and Rosemary Extracts). Candy coating: sugar, palm oil, cocoa, soy lecithin.',
  allergens = 'Contains: wheat, milk, eggs, soy.',
  recipe = '[
    {"inventoryItemId":"inv_betty_crocker_chocolate","qtyPerUnit":0.028},
    {"inventoryItemId":"inv_butter","qtyPerUnit":0.007},
    {"inventoryItemId":"inv_eggs","qtyPerUnit":0.007},
    {"inventoryItemId":"inv_choc_chips","qtyPerUnit":0.04},
    {"inventoryItemId":"inv_vanilla","qtyPerUnit":0.005},
    {"inventoryItemId":"inv_frosting_chocolate","qtyPerUnit":0.014}
  ]'
WHERE id = 'prod_cakepop';
