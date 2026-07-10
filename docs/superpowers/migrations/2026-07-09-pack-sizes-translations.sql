-- Migration: add pack_sizes column
ALTER TABLE products ADD COLUMN pack_sizes TEXT DEFAULT '[]';

-- ============================================================
-- PACK SIZES
-- ============================================================

-- Cookies: merge single + dozen into one product with pack_sizes
UPDATE products SET
  pack_sizes = '[{"id":"single","label":"Single","label_es":"Individual","qty":1,"price":4.00,"unit_label":"$4.00 ea","unit_label_es":"$4.00 c/u"},{"id":"dozen","label":"Dozen (12)","label_es":"Docena (12)","qty":12,"price":40.00,"badge":"Save $8","badge_es":"¡Ahorra $8!","unit_label":"$3.33 ea","unit_label_es":"$3.33 c/u"}]',
  description = 'Soft-baked chocolate chip cookies. Choose a single or save on a dozen.',
  description_es = 'Galletas con chispas de chocolate horneadas suaves. Elige una individual o ahorra en la docena.',
  name_es = 'Galletas de Chispas de Chocolate'
WHERE id = 'prod_cookie';

-- Delete the standalone dozen product (history preserved via items_json snapshots)
DELETE FROM products WHERE id = 'prod_cookies_dozen';

-- Bolillos: add dozen bulk tier
UPDATE products SET
  pack_sizes = '[{"id":"single","label":"Single","label_es":"Individual","qty":1,"price":2.00,"unit_label":"$2.00 ea","unit_label_es":"$2.00 c/u"},{"id":"dozen","label":"Dozen (12)","label_es":"Docena (12)","qty":12,"price":20.00,"badge":"Save $4","badge_es":"¡Ahorra $4!","unit_label":"$1.67 ea","unit_label_es":"$1.67 c/u"}]'
WHERE id = 'prod_bolillos';

-- ============================================================
-- TRANSLATION FIXES
-- ============================================================

-- Cakepops: translate description_es
UPDATE products SET
  description_es = 'Una bolita dulce y perfecta de dicha personalizable. Elige el sabor del pastel, elige tu baño de chocolate, elige tu cobertura. ¡Son el tipo de decisiones de vida que amamos tomar! (Ten en cuenta que los cakepops personalizados pueden variar en precio.)',
  name_es = 'Cakepops'
WHERE id = 'prod_cakepop';

-- Custom Cake: translate name + description
UPDATE products SET
  name_es = 'Pastel Personalizado',
  description_es = 'Pastel de 6 pulgadas y 2 capas, hecho fresco a la orden. Elige el sabor del pastel y el betún para crear tu combinación perfecta.',
  flavors = '[{"name":"Flavor","name_es":"Sabor","options":["Chocolate","Vanilla"]}]'
WHERE id = 'prod_custom_cake';

-- Cupcakes: translate description
UPDATE products SET
  description_es = 'Seis cupcakes de tamaño estándar hechos frescos a la orden. Elige el sabor del pastel y el betún. Un sabor por tanda.',
  flavors = '[{"name":"Flavor","name_es":"Sabor","options":["Chocolate","Vanilla"]}]'
WHERE id = 'prod_cupcakes';

-- Conchas: fix "Strawberry" -> "Fresa", add bilingual flavor group name
UPDATE products SET
  flavors = '[{"name":"Flavor","name_es":"Sabor","options":["Vanilla","Chocolate","Fresa"]}]'
WHERE id = 'prod_conchas';

-- Empanadas: fix "fresco" -> "frescas", restore Guayaba, add bilingual group name
UPDATE products SET
  description_es = 'Empanadas doradas y hojaldradas con masa suave y tu relleno favorito: cajeta, piña, fresa o guayaba. Horneadas frescas cada día.',
  flavors = '[{"name":"Filling","name_es":"Relleno","options":["Cajeta","Piña","Fresa","Guayaba"]}]'
WHERE id = 'prod_empanadas';
