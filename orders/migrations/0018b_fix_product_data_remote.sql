-- Fix product data: empanadas product, image_urls, pack_sizes data, featured flags
-- (pack_sizes column already exists on remote)
-- Run:
--   npx wrangler d1 execute muy-rico-orders --remote --file=migrations/0018b_fix_product_data_remote.sql

-- 1. Add empanadas product
INSERT OR IGNORE INTO products
  (id, name, name_es, description, description_es, category, price, cost, sku, emoji, image_url, active, ingredients, allergens, display_order, auto_generate_label, featured)
VALUES
  ('prod_empanadas',
   'Empanadas',
   'Empanadas',
   'Golden, hand-filled empanadas. Crispy on the outside, savory on the inside. Made to order with your choice of filling.',
   'Empanadas doradas y rellenas a mano. Crujientes por fuera, sabrosas por dentro. Hechas a la orden con tu relleno favorito.',
   'Bread', 3, 0.8, 'MR-EMP', '🥟', 'menu-empanadas.webp', 1,
   'Enriched flour (wheat flour, niacin, reduced iron, thiamine mononitrate, riboflavin, folic acid), shortening (palm oil), water, salt, filling (varies by selection).',
   'Contains: wheat.',
   45, 1, 0);

-- 2. Set image_url for all existing products (static menu photos)
UPDATE products SET image_url = 'menu-cookies.webp'    WHERE id = 'prod_cookie'       AND image_url IS NULL;
UPDATE products SET image_url = 'menu-conchas.webp'    WHERE id = 'prod_conchas'      AND image_url IS NULL;
UPDATE products SET image_url = 'menu-bolillos.webp'   WHERE id = 'prod_bolillos'     AND image_url IS NULL;
UPDATE products SET image_url = 'menu-tortillas.webp'  WHERE id = 'prod_tortillas'    AND image_url IS NULL;
UPDATE products SET image_url = 'menu-cakepops.webp'   WHERE id = 'prod_cakepop'      AND image_url IS NULL;
UPDATE products SET image_url = 'menu-cake.webp'       WHERE id = 'prod_custom_cake'  AND image_url IS NULL;
UPDATE products SET image_url = 'menu-cupcakes.webp'   WHERE id = 'prod_cupcakes'     AND image_url IS NULL;
UPDATE products SET image_url = 'menu-cookies.webp'    WHERE id = 'prod_cookies_dozen' AND image_url IS NULL;

-- 3. Mark featured products for homepage Del Horno
UPDATE products SET featured = 1 WHERE id IN ('prod_conchas','prod_cookie','prod_empanadas','prod_custom_cake');

-- 4. Add pack_sizes (JSON format matching order.html renderProductTile expectations)
-- Cookies: single + dozen
UPDATE products SET pack_sizes = '[
  {"id":"single","label":"Single","label_es":"Individual","price":4,"qty":1,"unit_label":"$4.00 ea","unit_label_es":"$4.00 c/u"},
  {"id":"dozen","label":"Dozen (12)","label_es":"Docena (12)","price":40,"qty":12,"badge":"Save $8","badge_es":"¡Ahorra $8!","unit_label":"$3.33 ea","unit_label_es":"$3.33 c/u"}
]' WHERE id = 'prod_cookie';

-- Conchas: single + half-dozen + dozen
UPDATE products SET pack_sizes = '[
  {"id":"single","label":"Single","label_es":"Individual","price":4,"qty":1,"unit_label":"$4.00 ea","unit_label_es":"$4.00 c/u"},
  {"id":"half-dozen","label":"Half Dozen (6)","label_es":"Media Docena (6)","price":22,"qty":6,"badge":"Save $2","badge_es":"¡Ahorra $2!","unit_label":"$3.67 ea","unit_label_es":"$3.67 c/u"},
  {"id":"dozen","label":"Dozen (12)","label_es":"Docena (12)","price":40,"qty":12,"badge":"Save $8","badge_es":"¡Ahorra $8!","unit_label":"$3.33 ea","unit_label_es":"$3.33 c/u"}
]' WHERE id = 'prod_conchas';

-- Bolillos: single + dozen
UPDATE products SET pack_sizes = '[
  {"id":"single","label":"Single","label_es":"Individual","price":2,"qty":1,"unit_label":"$2.00 ea","unit_label_es":"$2.00 c/u"},
  {"id":"dozen","label":"Dozen (12)","label_es":"Docena (12)","price":20,"qty":12,"badge":"Save $4","badge_es":"¡Ahorra $4!","unit_label":"$1.67 ea","unit_label_es":"$1.67 c/u"}
]' WHERE id = 'prod_bolillos';

-- Flour Tortillas: dozen + 2-dozen + 3-dozen
UPDATE products SET pack_sizes = '[
  {"id":"dozen","label":"1 Dozen","label_es":"1 Docena","price":6,"qty":12,"unit_label":"$6.00 / dozen","unit_label_es":"$6.00 / docena"},
  {"id":"two-dozen","label":"2 Dozen","label_es":"2 Docenas","price":11,"qty":24,"badge":"Save $1","badge_es":"¡Ahorra $1!","unit_label":"$5.50 / dozen","unit_label_es":"$5.50 / docena"},
  {"id":"three-dozen","label":"3 Dozen","label_es":"3 Docenas","price":15,"qty":36,"badge":"Save $3","badge_es":"¡Ahorra $3!","unit_label":"$5.00 / dozen","unit_label_es":"$5.00 / docena"}
]' WHERE id = 'prod_tortillas';

-- Cakepops: half-dozen + dozen
UPDATE products SET pack_sizes = '[
  {"id":"half-dozen","label":"Half Dozen (6)","label_es":"Media Docena (6)","price":18,"qty":6,"unit_label":"$3.00 ea","unit_label_es":"$3.00 c/u"},
  {"id":"dozen","label":"Dozen (12)","label_es":"Docena (12)","price":33,"qty":12,"badge":"Save $3","badge_es":"¡Ahorra $3!","unit_label":"$2.75 ea","unit_label_es":"$2.75 c/u"}
]' WHERE id = 'prod_cakepop';

-- 5. Deactivate prod_cookies_dozen (replaced by pack_sizes on prod_cookie)
UPDATE products SET active = 0 WHERE id = 'prod_cookies_dozen';
