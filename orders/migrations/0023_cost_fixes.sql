-- 0023: Fix inventory costs, correct recipes, add flavor deduction support

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Fix Chocolate Chips: restore unit to lb, cost to $4.40/lb
--    (was changed to oz/$4.89 at some point, making cost 17x too high)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE inventory
SET unit = 'lb', cost_per_unit = 4.40, unit_weight = 1.0
WHERE id = 'inv_choc_chips';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Fix Chocolate Chip Coqui recipe (King Arthur conversions, 48-cookie yield)
--    Batch: 2 sticks butter, 2 cups packed brown sugar, 1 cup sugar,
--    2 eggs + 2 yolks, 4 tbsp vanilla, 4 cups AP flour,
--    1 tsp baking soda, 1 tsp baking powder, 1 tsp salt, 24 oz choc chips
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE products SET recipe = '[
  {"inventoryItemId":"inv_butter","qtyPerUnit":0.01042},
  {"inventoryItemId":"inv_brown_sugar","qtyPerUnit":0.01837},
  {"inventoryItemId":"inv_sugar","qtyPerUnit":0.00919},
  {"inventoryItemId":"inv_eggs","qtyPerUnit":0.00434},
  {"inventoryItemId":"inv_vanilla","qtyPerUnit":0.00521},
  {"inventoryItemId":"inv_flour","qtyPerUnit":0.02208},
  {"inventoryItemId":"inv_baking_soda","qtyPerUnit":0.00005},
  {"inventoryItemId":"inv_baking_powder","qtyPerUnit":0.00004},
  {"inventoryItemId":"inv_salt","qtyPerUnit":0.00005},
  {"inventoryItemId":"inv_choc_chips","qtyPerUnit":0.03125}
]'
WHERE id = 'prod_cookie';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Fix Chocolate Chip Coqui Pie (same cookie recipe + graham crust)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE products SET recipe = '[
  {"inventoryItemId":"inv_butter","qtyPerUnit":0.01042},
  {"inventoryItemId":"inv_brown_sugar","qtyPerUnit":0.01837},
  {"inventoryItemId":"inv_sugar","qtyPerUnit":0.00919},
  {"inventoryItemId":"inv_eggs","qtyPerUnit":0.00434},
  {"inventoryItemId":"inv_vanilla","qtyPerUnit":0.00521},
  {"inventoryItemId":"inv_flour","qtyPerUnit":0.02208},
  {"inventoryItemId":"inv_baking_soda","qtyPerUnit":0.00005},
  {"inventoryItemId":"inv_baking_powder","qtyPerUnit":0.00004},
  {"inventoryItemId":"inv_salt","qtyPerUnit":0.00005},
  {"inventoryItemId":"inv_choc_chips","qtyPerUnit":0.03125},
  {"inventoryItemId":"inv_graham_crust_9","qtyPerUnit":1.0}
]'
WHERE id = 'prod_mrzgdqza';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Add flavor_deduction_map to products
--    Maps flavor group names → option names → inventory item IDs to deduct
--    e.g. {"Cake":{"Chocolate":["inv_betty_crocker_chocolate"]},...}
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE products ADD COLUMN flavor_deduction_map TEXT DEFAULT NULL;

-- Populate for cupcakes
UPDATE products SET flavor_deduction_map = '{"Cake":{"Chocolate":["inv_betty_crocker_chocolate"],"Vanilla":["inv_betty_crocker_vanilla"],"Strawberry":["inv_betty_crocker_strawberry"],"Funfetti":["inv_betty_crocker_vanilla"],"Red Velvet":["inv_betty_crocker_chocolate"],"Marble":["inv_betty_crocker_chocolate"],"Lemon":["inv_betty_crocker_vanilla"]},"Frosting":{"Vanilla Buttercream":["inv_frosting_vanilla"],"Chocolate Buttercream":["inv_frosting_chocolate"]}}'
WHERE id = 'prod_cupcakes';

-- Populate for custom cake
UPDATE products SET flavor_deduction_map = '{"Cake":{"Chocolate":["inv_betty_crocker_chocolate"],"Vanilla":["inv_betty_crocker_vanilla"],"Strawberry":["inv_betty_crocker_strawberry"],"Funfetti":["inv_betty_crocker_vanilla"],"Red Velvet":["inv_betty_crocker_chocolate"],"Marble":["inv_betty_crocker_chocolate"],"Lemon":["inv_betty_crocker_vanilla"]},"Frosting":{"Vanilla Buttercream":["inv_frosting_vanilla"],"Chocolate Buttercream":["inv_frosting_chocolate"]}}'
WHERE id = 'prod_custom_cake';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Add inventory_deducted flag to orders
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN inventory_deducted INTEGER DEFAULT 0;
