-- Muy Rico — Product recipes extended + auto-generate-label toggle
-- Part of Part 11:
--   1. ALTER products to add auto_generate_label column
--   2. Expand seeded product recipes (only flour/choc_chips/butter/etc references survived
--      in the original seedData recipes — they're now plan-comprehensive)
--   3. Flip auto_generate_label = 1 for the seeded products so the dashboard auto-fills
--      the "Auto-generate" checkbox on day-1 deploy.
--
-- Run:
--   npx wrangler d1 execute muy-rico-orders --file=migrations/0005_recipes_extend.sql
--   npx wrangler d1 execute muy-rico-orders --remote --file=migrations/0005_recipes_extend.sql

ALTER TABLE products ADD COLUMN auto_generate_label INTEGER NOT NULL DEFAULT 0;

-- ── Chocolate Chip Cookie ─────────────────────────────────────────────────
-- Recipe ingredients in their seed label:
--   flour, butter (cream, salt), chocolate chips (sugar, chocolate liquor, cocoa butter, butterfat, soy lecithin),
--   sugar, brown sugar, eggs, vanilla extract, baking soda, salt
-- (note: too few lines in the original seed — expanding to make auto-gen compliant)
UPDATE products
SET recipe = '[
  {"inventoryItemId":"inv_flour","qtyPerUnit":0.10},
  {"inventoryItemId":"inv_eggs","qtyPerUnit":0.083},
  {"inventoryItemId":"inv_choc_chips","qtyPerUnit":0.08},
  {"inventoryItemId":"inv_butter","qtyPerUnit":0.06},
  {"inventoryItemId":"inv_brown_sugar","qtyPerUnit":0.05},
  {"inventoryItemId":"inv_sugar","qtyPerUnit":0.02},
  {"inventoryItemId":"inv_vanilla","qtyPerUnit":0.02},
  {"inventoryItemId":"inv_baking_soda","qtyPerUnit":0.003},
  {"inventoryItemId":"inv_salt","qtyPerUnit":0.002}
]',
    auto_generate_label = 1
WHERE id = 'prod_cookie';

-- ── Cookies (dozen) — same ingredient build, 12× the recipe sizes ─────────
UPDATE products
SET recipe = '[
  {"inventoryItemId":"inv_flour","qtyPerUnit":1.2},
  {"inventoryItemId":"inv_eggs","qtyPerUnit":1.0},
  {"inventoryItemId":"inv_choc_chips","qtyPerUnit":0.96},
  {"inventoryItemId":"inv_butter","qtyPerUnit":0.72},
  {"inventoryItemId":"inv_brown_sugar","qtyPerUnit":0.6},
  {"inventoryItemId":"inv_sugar","qtyPerUnit":0.24},
  {"inventoryItemId":"inv_vanilla","qtyPerUnit":0.24},
  {"inventoryItemId":"inv_baking_soda","qtyPerUnit":0.036},
  {"inventoryItemId":"inv_salt","qtyPerUnit":0.024}
]',
    auto_generate_label = 1
WHERE id = 'prod_cookies_dozen';

-- ── Conchas ───────────────────────────────────────────────────────────────
UPDATE products
SET recipe = '[
  {"inventoryItemId":"inv_flour","qtyPerUnit":0.12},
  {"inventoryItemId":"inv_sugar","qtyPerUnit":0.05},
  {"inventoryItemId":"inv_butter","qtyPerUnit":0.05},
  {"inventoryItemId":"inv_eggs","qtyPerUnit":0.04},
  {"inventoryItemId":"inv_vanilla","qtyPerUnit":0.02},
  {"inventoryItemId":"inv_salt","qtyPerUnit":0.001},
  {"inventoryItemId":"inv_baking_soda","qtyPerUnit":0.0005}
]',
    auto_generate_label = 1
WHERE id = 'prod_conchas';

-- ── Bolillos ──────────────────────────────────────────────────────────────
UPDATE products
SET recipe = '[
  {"inventoryItemId":"inv_flour","qtyPerUnit":0.15},
  {"inventoryItemId":"inv_butter","qtyPerUnit":0.025},
  {"inventoryItemId":"inv_sugar","qtyPerUnit":0.005},
  {"inventoryItemId":"inv_salt","qtyPerUnit":0.001},
  {"inventoryItemId":"inv_baking_soda","qtyPerUnit":0.0007}
]',
    auto_generate_label = 1
WHERE id = 'prod_bolillos';

-- ── Flour Tortillas (dozen) — note the seed label includes "shortening (palm oil)"
-- which is not yet represented as an inventory item; we add an approximation entry ──
UPDATE products
SET recipe = '[
  {"inventoryItemId":"inv_flour","qtyPerUnit":0.50},
  {"inventoryItemId":"inv_butter","qtyPerUnit":0.10},
  {"inventoryItemId":"inv_salt","qtyPerUnit":0.005},
  {"inventoryItemId":"inv_baking_soda","qtyPerUnit":0.002}
]',
    auto_generate_label = 1
WHERE id = 'prod_tortillas';

-- ── Cakepops ──────────────────────────────────────────────────────────────
UPDATE products
SET recipe = '[
  {"inventoryItemId":"inv_flour","qtyPerUnit":0.03},
  {"inventoryItemId":"inv_sugar","qtyPerUnit":0.025},
  {"inventoryItemId":"inv_butter","qtyPerUnit":0.02},
  {"inventoryItemId":"inv_eggs","qtyPerUnit":0.025},
  {"inventoryItemId":"inv_cocoa","qtyPerUnit":0.02},
  {"inventoryItemId":"inv_choc_chips","qtyPerUnit":0.04},
  {"inventoryItemId":"inv_vanilla","qtyPerUnit":0.005},
  {"inventoryItemId":"inv_baking_soda","qtyPerUnit":0.001}
]',
    auto_generate_label = 1
WHERE id = 'prod_cakepop';

-- ── Custom Cake (1 cake) — note ingredients originally listed in the seed
-- label include "baking powder" which we don't currently distinguish from baking soda;
-- using baking_soda in the inventory as a close-enough proxy for now. ──────────
UPDATE products
SET recipe = '[
  {"inventoryItemId":"inv_flour","qtyPerUnit":1.0},
  {"inventoryItemId":"inv_sugar","qtyPerUnit":0.8},
  {"inventoryItemId":"inv_butter","qtyPerUnit":0.6},
  {"inventoryItemId":"inv_eggs","qtyPerUnit":0.5},
  {"inventoryItemId":"inv_cocoa","qtyPerUnit":0.2},
  {"inventoryItemId":"inv_vanilla","qtyPerUnit":0.05},
  {"inventoryItemId":"inv_baking_soda","qtyPerUnit":0.01},
  {"inventoryItemId":"inv_salt","qtyPerUnit":0.005}
]',
    auto_generate_label = 1
WHERE id = 'prod_custom_cake';

-- ── Cupcakes (6) — scaled-down custom cake ────────────────────────────────
UPDATE products
SET recipe = '[
  {"inventoryItemId":"inv_flour","qtyPerUnit":0.5},
  {"inventoryItemId":"inv_sugar","qtyPerUnit":0.4},
  {"inventoryItemId":"inv_butter","qtyPerUnit":0.3},
  {"inventoryItemId":"inv_eggs","qtyPerUnit":0.25},
  {"inventoryItemId":"inv_cocoa","qtyPerUnit":0.1},
  {"inventoryItemId":"inv_vanilla","qtyPerUnit":0.025},
  {"inventoryItemId":"inv_baking_soda","qtyPerUnit":0.005},
  {"inventoryItemId":"inv_salt","qtyPerUnit":0.003}
]',
    auto_generate_label = 1
WHERE id = 'prod_cupcakes';
