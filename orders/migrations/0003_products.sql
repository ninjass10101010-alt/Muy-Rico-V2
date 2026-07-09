-- Muy Rico — Products table (single source of truth for menu items)
-- Authoritative list. Dashboard CRUDs via /api/products. order.html reads via GET /api/products.
-- Run:
--   npx wrangler d1 execute muy-rico-orders --file=migrations/0003_products.sql
--   npx wrangler d1 execute muy-rico-orders --remote --file=migrations/0003_products.sql

CREATE TABLE IF NOT EXISTS products (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,                -- default (English) name
  name_es         TEXT,                          -- Spanish name (for order.html)
  description     TEXT,
  description_es  TEXT,                          -- Spanish description
  category        TEXT NOT NULL,
  price           REAL NOT NULL,
  cost            REAL NOT NULL DEFAULT 0,
  sku             TEXT,
  emoji           TEXT NOT NULL,
  image_url       TEXT,                          -- optional; falls back to emoji
  active          INTEGER NOT NULL DEFAULT 1,
  ingredients     TEXT,
  allergens       TEXT,
  flavors         TEXT,                          -- JSON array of strings: ["Vanilla","Chocolate"]
  recipe          TEXT,                          -- JSON: [{inventoryItemId, qtyPerUnit}]
  display_order   INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_products_active   ON products(active);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_order    ON products(display_order);

-- Seed: dashboard admin products (matched to seedData.ts IDs)
INSERT OR IGNORE INTO products
  (id, name, name_es, description, description_es, category, price, cost, sku, emoji, active, ingredients, allergens, recipe, display_order)
VALUES
  ('prod_cookie',
   'Chocolate Chip Cookie',
   'Galleta de Chispas de Chocolate',
   'Classic soft-baked chocolate chip cookie. Dozen Pricing: $40.',
   'Chocolate chip cookie. Hold. Up. 4oz of pure happiness. These chocolate chip cookies are a staple comfort treat. The definition of "Treat yo self".',
   'Cookies', 4, 1.2, 'MR-CKE', '🍪', 1,
   'Enriched flour (wheat flour, niacin, reduced iron, thiamine mononitrate, riboflavin, folic acid), butter (cream, salt), chocolate chips (sugar, chocolate liquor, cocoa butter, butterfat, soy lecithin), sugar, brown sugar, eggs, vanilla extract, baking soda, salt.',
   'Contains: wheat, milk, eggs, soy.',
   '[{"inventoryItemId":"inv_flour","qtyPerUnit":0.1},{"inventoryItemId":"inv_choc_chips","qtyPerUnit":0.08},{"inventoryItemId":"inv_butter","qtyPerUnit":0.06}]',
   10),
  ('prod_conchas',
   'Conchas',
   'Conchas',
   'This Mexican bread is an Icon. Light fluffy with vanilla and cinnamon mixed into the dough. The beautiful shell stamped topping comes in vanilla, chocolate, and strawberry. Honestly, you need it to go with your coffee.',
   'Este pan mexicano es un ícono. Suave y esponjoso con vainilla y canela en la masa. La hermosa cobertura en forma de concha viene en vainilla, chocolate y fresa. Honestamente, lo necesitas para acompañar tu café.',
   'Bread', 4, 1.0, 'MR-CON', '🍞', 1,
   'Enriched flour (wheat flour, niacin, reduced iron, thiamine mononitrate, riboflavin, folic acid), sugar, butter (cream, salt), eggs, milk, vanilla extract, cinnamon, salt, yeast.',
   'Contains: wheat, milk, eggs.',
   '[{"inventoryItemId":"inv_flour","qtyPerUnit":0.12},{"inventoryItemId":"inv_sugar","qtyPerUnit":0.04},{"inventoryItemId":"inv_butter","qtyPerUnit":0.05},{"inventoryItemId":"inv_eggs","qtyPerUnit":0.02}]',
   20),
  ('prod_bolillos',
   'Bolillos',
   'Bolillos',
   'This Mexican French inspired bread has a crunchy crust and soft center. These Bolillos are perfect for all your sandwich/Torta needs. But let''s be real, warm that Bolillo up, cover it in butter, and let the happiness wash over you.',
   'Este pan de inspiración mexicano-francesa tiene una corteza crujiente y un centro suave. Estos bolillos son perfectos para todas tus necesidades de sándwich/torta. Pero seamos sinceros, calienta ese bolillo, úntale mantequilla y deja que la felicidad te invada.',
   'Bread', 2, 0.6, 'MR-BOL', '🥖', 1,
   'Enriched flour (wheat flour, niacin, reduced iron, thiamine mononitrate, riboflavin, folic acid), water, butter (cream, salt), sugar, salt, yeast.',
   'Contains: wheat, milk.',
   '[{"inventoryItemId":"inv_flour","qtyPerUnit":0.15},{"inventoryItemId":"inv_butter","qtyPerUnit":0.02}]',
   30),
  ('prod_tortillas',
   'Flour Tortillas (dozen)',
   'Tortillas de Harina (1 docena)',
   'Handmade, soft, light, and buttery tortillas. Imagine with me... Tacos, quesadillas, with butter and salt...there really isn''t a time that a tortilla is not needed. So, in conclusion...you need some.',
   'Tortillas hechas a mano, suaves, ligeras y mantecosas. Imagina conmigo... tacos, quesadillas, con mantequilla y sal... realmente no hay momento en que una tortilla no sea necesaria. Así que, en conclusión... necesitas algunas.',
   'Bread', 6, 1.5, 'MR-TOR12', '🫓', 1,
   'Enriched flour (wheat flour, niacin, reduced iron, thiamine mononitrate, riboflavin, folic acid), water, shortening (palm oil), salt, baking powder.',
   'Contains: wheat.',
   '[{"inventoryItemId":"inv_flour","qtyPerUnit":0.3},{"inventoryItemId":"inv_butter","qtyPerUnit":0.08}]',
   40),
  ('prod_cakepop',
   'Cakepops',
   'Cakepops Básicos',
   'Such a sweet perfect little ball of customizable bliss. Choose your cake flavor, choose your chocolate dip, choose your topping. These are the kind of life choices we live to make! (Please keep in mind that custom cakepops may vary in pricing.)',
   'Such a sweet perfect little ball of customizable bliss. Choose your cake flavor, choose your chocolate dip, choose your topping. These are the kind of life choices we live to make! (Please keep in mind that custom cakepops may vary in pricing.)',
   'Cakepops', 3, 0.9, 'MR-CKP', '🍭', 1,
   'Enriched flour (wheat flour, niacin, reduced iron, thiamine mononitrate, riboflavin, folic acid), sugar, butter (cream, salt), eggs, milk, cocoa powder, vanilla extract, candy coating (sugar, palm oil, cocoa, soy lecithin), baking soda, salt.',
   'Contains: wheat, milk, eggs, soy.',
   '[{"inventoryItemId":"inv_flour","qtyPerUnit":0.03},{"inventoryItemId":"inv_cocoa","qtyPerUnit":0.02},{"inventoryItemId":"inv_choc_chips","qtyPerUnit":0.04}]',
   50),
  ('prod_custom_cake',
   'Custom Cake',
   'Custom Cake',
   '8-inch, 2-layer cake made fresh to order. Choose your cake flavor and frosting to create your perfect combination.',
   '8-inch, 2-layer cake made fresh to order. Choose your cake flavor and frosting to create your perfect combination.',
   'Cakes', 35, 10, 'MR-CKE', '🎂', 1,
   'Enriched flour (wheat flour, niacin, reduced iron, thiamine mononitrate, riboflavin, folic acid), sugar, butter (cream, salt), eggs, milk, cocoa powder, vanilla extract, baking powder, baking soda, salt.',
   'Contains: wheat, milk, eggs.',
   '[{"inventoryItemId":"inv_flour","qtyPerUnit":1.0},{"inventoryItemId":"inv_sugar","qtyPerUnit":0.8},{"inventoryItemId":"inv_butter","qtyPerUnit":0.6},{"inventoryItemId":"inv_eggs","qtyPerUnit":0.4},{"inventoryItemId":"inv_cocoa","qtyPerUnit":0.2}]',
   60),
  ('prod_cupcakes',
   'Cupcakes (6)',
   'Cupcakes (6)',
   'Six standard-size cupcakes made fresh to order. Choose your cake flavor and frosting. One flavor per batch.',
   'Six standard-size cupcakes made fresh to order. Choose your cake flavor and frosting. One flavor per batch.',
   'Cupcakes', 18, 5, 'MR-CUP6', '🧁', 1,
   'Enriched flour (wheat flour, niacin, reduced iron, thiamine mononitrate, riboflavin, folic acid), sugar, butter (cream, salt), eggs, milk, cocoa powder, vanilla extract, baking powder, baking soda, salt.',
   'Contains: wheat, milk, eggs.',
   '[{"inventoryItemId":"inv_flour","qtyPerUnit":0.3},{"inventoryItemId":"inv_butter","qtyPerUnit":0.2},{"inventoryItemId":"inv_eggs","qtyPerUnit":0.1},{"inventoryItemId":"inv_cocoa","qtyPerUnit":0.05}]',
   70),
  ('prod_cookies_dozen','Cookies (dozen)','Cookies (1 docena)','Full dozen soft-baked chocolate chip cookies.','Docena completa de galletas con chispas de chocolate horneadas suaves.','Cookies',40,10,'MR-CKE12','🍪',1,'Enriched flour (wheat flour, niacin, reduced iron, thiamine mononitrate, riboflavin, folic acid), butter (cream, salt), chocolate chips (sugar, chocolate liquor, cocoa butter, butterfat, soy lecithin), sugar, brown sugar, eggs, vanilla extract, baking soda, salt.','Contains: wheat, milk, eggs, soy.','[{"inventoryItemId":"inv_flour","qtyPerUnit":0.6},{"inventoryItemId":"inv_choc_chips","qtyPerUnit":0.5},{"inventoryItemId":"inv_butter","qtyPerUnit":0.4}]',80);

-- Seed flavors for items that had flavor-select dropdowns in order.html
UPDATE products SET flavors = '["Vanilla","Chocolate","Strawberry"]' WHERE id = 'prod_conchas';
UPDATE products SET flavors = '[]' WHERE id IN ('prod_cookie','prod_bolillos','prod_tortillas','prod_cakepop','prod_cookies_dozen');
UPDATE products SET flavors = '["Chocolate","Vanilla"]' WHERE id IN ('prod_custom_cake','prod_cupcakes');
