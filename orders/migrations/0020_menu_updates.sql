-- 0020: menu updates — cupcakes dozen pack, new cake flavors, mini cinnamon rolls, emoji -> svg icons

-- Cupcakes: half-dozen base pack + dozen discount pack
UPDATE products SET pack_sizes = '[{"id":"half-dozen","label":"Half Dozen (6)","label_es":"Media Docena (6)","price":18,"qty":6,"unit_label":"$3.00 ea","unit_label_es":"$3.00 c/u"},{"id":"dozen","label":"Dozen (12)","label_es":"Docena (12)","price":30,"qty":12,"badge":"Save $6","badge_es":"¡Ahorra $6!","unit_label":"$2.50 ea","unit_label_es":"$2.50 c/u"}]'
WHERE id = 'prod_cupcakes';

-- New cake flavors on cupcakes + custom cake (Cake group; Frosting untouched)
UPDATE products SET flavors = '[{"name":"Cake","name_es":"Bizcocho","options":["Chocolate","Vanilla","Strawberry","Funfetti","Red Velvet","Marble","Lemon"]},{"name":"Frosting","name_es":"Betún","options":["Vanilla Buttercream","Chocolate Buttercream"]}]'
WHERE id = 'prod_cupcakes';
UPDATE products SET flavors = '[{"name":"Cake","name_es":"Bizcocho","options":["Chocolate","Vanilla","Strawberry","Funfetti","Red Velvet","Marble","Lemon"]},{"name":"Frosting","name_es":"Betún","options":["Vanilla Buttercream","Chocolate Buttercream"]}]'
WHERE id = 'prod_custom_cake';

-- Mini Cinnamon Rolls (new product; ingredients/allergens intentionally blank for owner to fill)
INSERT OR REPLACE INTO products
  (id, name, name_es, description, description_es, category, price, cost, sku, emoji, image_url,
   active, show_online, ingredients, allergens, flavors, pack_sizes, recipe, display_order, auto_generate_label, featured)
VALUES
  ('prod_mini_cinnamon_rolls', 'Mini Cinnamon Rolls', 'Mini Roles de Canela',
   'Bite-size cinnamon rolls, soft and swirled with cinnamon sugar. Sold by the half dozen or by the dozen.',
   'Roles de canela en tamaño mini, suaves y llenos de azúcar y canela. Por media docena o por docena.',
   'Cinnamon Rolls', 12, 0, 'MR-MCR', 'cinnamon-roll.svg', NULL,
   1, 1, '', '', '[]',
   '[{"id":"half-dozen","label":"Half Dozen (6)","label_es":"Media Docena (6)","price":12,"qty":6,"unit_label":"$2.00 ea","unit_label_es":"$2.00 c/u"},{"id":"dozen","label":"Dozen (12)","label_es":"Docena (12)","price":20,"qty":12,"badge":"Save $4","badge_es":"¡Ahorra $4!","unit_label":"$1.67 ea","unit_label_es":"$1.67 c/u"}]',
   '[]', 100, 1, 0);

-- Emoji -> SVG icon filenames (public order page already renders .svg icons)
UPDATE products SET emoji = 'cookies.svg'      WHERE id = 'prod_cookie';
UPDATE products SET emoji = 'conchas.svg'      WHERE id = 'prod_conchas';
UPDATE products SET emoji = 'bolillos.svg'     WHERE id = 'prod_bolillos';
UPDATE products SET emoji = 'tortilla.svg'     WHERE id = 'prod_tortillas';
UPDATE products SET emoji = 'empanada.svg'     WHERE id = 'prod_empanadas';
UPDATE products SET emoji = 'cakepop.svg'      WHERE id = 'prod_cakepop';
UPDATE products SET emoji = 'cake.svg'         WHERE id = 'prod_custom_cake';
UPDATE products SET emoji = 'cupcake.svg'      WHERE id = 'prod_cupcakes';
UPDATE products SET emoji = 'cookies.svg'      WHERE id = 'prod_mrzgdqza';
UPDATE products SET emoji = 'cinnamon-roll.svg' WHERE id = 'prod_mrwvp8n0';
