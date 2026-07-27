-- 0022: cookie recipe update + baking powder inventory item

INSERT INTO inventory (id, name, category, quantity, unit, reorder_level, cost_per_unit, supplier, active)
VALUES ('inv_baking_powder', 'Baking Powder', 'Pantry', 0, 'lb', 1, 3.00, '', 1)
ON CONFLICT(id) DO NOTHING;

-- Recipe: 2 sticks butter, 2 cups brown sugar, 1 cup sugar, 2 eggs + 2 yolks, 4 tbsp vanilla,
-- 4 cups AP flour, 1 tsp baking soda, 1 tsp baking powder, 1 tsp salt, 3 types chocolate chips
-- Yield: ~48 cookies (4 dozen); qtyPerUnit = amount per 1 cookie in inventory units
UPDATE products SET
  recipe = '[{"inventoryItemId":"inv_butter","qtyPerUnit":0.01042},{"inventoryItemId":"inv_brown_sugar","qtyPerUnit":0.04021},{"inventoryItemId":"inv_sugar","qtyPerUnit":0.01771},{"inventoryItemId":"inv_eggs","qtyPerUnit":0.00694},{"inventoryItemId":"inv_vanilla","qtyPerUnit":0.00521},{"inventoryItemId":"inv_flour","qtyPerUnit":0.04375},{"inventoryItemId":"inv_baking_soda","qtyPerUnit":0.00013},{"inventoryItemId":"inv_baking_powder","qtyPerUnit":0.00013},{"inventoryItemId":"inv_salt","qtyPerUnit":0.00013},{"inventoryItemId":"inv_choc_chips","qtyPerUnit":0.75}]',
  ingredients = 'Enriched flour (wheat flour, niacin, reduced iron, thiamine mononitrate, riboflavin, folic acid), Brown sugar, Butter (cream, salt), Granulated sugar, Eggs, Vanilla extract, Baking soda, Baking powder, Salt, Chocolate chips (sugar, chocolate liquor, cocoa butter, butterfat, soy lecithin)',
  allergens = 'Contains: milk, eggs, wheat, soybeans.'
WHERE id = 'prod_cookie';
