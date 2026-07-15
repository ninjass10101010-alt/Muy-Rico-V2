-- Muy Rico — Add Betty Crocker Cake Mix to Inventory and update recipes
--
-- Run:
--   npx wrangler d1 execute muy-rico-orders --file=migrations/0007_betty_crocker_recipes.sql
--   npx wrangler d1 execute muy-rico-orders --remote --file=migrations/0007_betty_crocker_recipes.sql

-- Add Betty Crocker Super Moist Triple Chocolate Fudge Cake Mix to inventory
INSERT OR IGNORE INTO inventory
  (id, name, category, quantity, unit, reorder_level, cost_per_unit, supplier, ingredients_label, allergens, unit_weight)
VALUES
  ('inv_betty_crocker_chocolate', 'Betty Crocker Triple Chocolate Fudge Cake Mix', 'Baking', 5, 'box', 2, 2.50, 'Costco',
   'Enriched Flour Bleached (wheat flour, niacin, iron, thiamin mononitrate, riboflavin, folic acid), Sugar, Cocoa Processed with Alkali, Corn Syrup, Baking Soda, Corn Starch, Palm Oil, Salt, Artificial Flavor',
   '["Wheat"]', 0.95); -- 15.25 oz is ~0.95 lb

-- Update Cakepops (prod_cakepop) recipe and ingredients
-- Assuming 1 oz cake pop = 1/36 box of cake mix (approx 0.028)
-- Plus some binder/frosting and typical egg/oil adjustments if needed. 
UPDATE products
SET ingredients = 'Betty Crocker Triple Chocolate Fudge Cake Mix (Enriched Flour Bleached [wheat flour, niacin, iron, thiamin mononitrate, riboflavin, folic acid], Sugar, Cocoa Processed with Alkali, Corn Syrup, Baking Soda, Corn Starch, Palm Oil, Salt, Artificial Flavor), water, butter (cream, salt), eggs, candy coating (sugar, palm oil, cocoa, soy lecithin), vanilla extract.',
    allergens = 'Contains: wheat, milk, eggs, soy.',
    recipe = '[
  {"inventoryItemId":"inv_betty_crocker_chocolate","qtyPerUnit":0.028},
  {"inventoryItemId":"inv_butter","qtyPerUnit":0.007},
  {"inventoryItemId":"inv_eggs","qtyPerUnit":0.007},
  {"inventoryItemId":"inv_choc_chips","qtyPerUnit":0.04},
  {"inventoryItemId":"inv_vanilla","qtyPerUnit":0.005}
]'
WHERE id = 'prod_cakepop';

-- Update Cupcakes (6) (prod_cupcakes) recipe and ingredients
-- Assuming 6 cupcakes = 1/4 box of cake mix (0.25)
UPDATE products
SET ingredients = 'Betty Crocker Triple Chocolate Fudge Cake Mix (Enriched Flour Bleached [wheat flour, niacin, iron, thiamin mononitrate, riboflavin, folic acid], Sugar, Cocoa Processed with Alkali, Corn Syrup, Baking Soda, Corn Starch, Palm Oil, Salt, Artificial Flavor), water, butter (cream, salt), eggs, vanilla extract.',
    allergens = 'Contains: wheat, milk, eggs.',
    recipe = '[
  {"inventoryItemId":"inv_betty_crocker_chocolate","qtyPerUnit":0.25},
  {"inventoryItemId":"inv_butter","qtyPerUnit":0.0625},
  {"inventoryItemId":"inv_eggs","qtyPerUnit":0.0625},
  {"inventoryItemId":"inv_vanilla","qtyPerUnit":0.025}
]'
WHERE id = 'prod_cupcakes';
