-- 0029: menu pack pricing — 4/6/12 packs with volume discounts, no singles
-- Cinnamon Rolls, Conchas, Chocolate Chip Coqui, Bolillos, Empanadas, Cakepops
-- Unchanged: Coqui Pie (single), Tortillas (1/2/3 dozen), Cupcakes (6 + 12)

-- $4 tier: Cinnamon Rolls, Conchas, Chocolate Chip Coqui
UPDATE products SET pack_sizes = '[
  {"id":"4-pack","label":"Pack of 4","label_es":"Paquete de 4","price":16,"qty":4,"unit_label":"$4.00 ea","unit_label_es":"$4.00 c/u"},
  {"id":"half-dozen","label":"Half Dozen (6)","label_es":"Media Docena (6)","price":22,"qty":6,"badge":"Save $2","badge_es":"¡Ahorra $2!","unit_label":"$3.67 ea","unit_label_es":"$3.67 c/u"},
  {"id":"dozen","label":"Dozen (12)","label_es":"Docena (12)","price":40,"qty":12,"badge":"Save $8","badge_es":"¡Ahorra $8!","unit_label":"$3.33 ea","unit_label_es":"$3.33 c/u"}
]'
WHERE id IN ('prod_mrwvp8n0', 'prod_conchas', 'prod_cookie');

-- $2 tier: Bolillos
UPDATE products SET pack_sizes = '[
  {"id":"4-pack","label":"Pack of 4","label_es":"Paquete de 4","price":8,"qty":4,"unit_label":"$2.00 ea","unit_label_es":"$2.00 c/u"},
  {"id":"half-dozen","label":"Half Dozen (6)","label_es":"Media Docena (6)","price":11,"qty":6,"badge":"Save $1","badge_es":"¡Ahorra $1!","unit_label":"$1.83 ea","unit_label_es":"$1.83 c/u"},
  {"id":"dozen","label":"Dozen (12)","label_es":"Docena (12)","price":20,"qty":12,"badge":"Save $4","badge_es":"¡Ahorra $4!","unit_label":"$1.67 ea","unit_label_es":"$1.67 c/u"}
]'
WHERE id = 'prod_bolillos';

-- $3 tier: Empanadas, Cakepops
UPDATE products SET pack_sizes = '[
  {"id":"4-pack","label":"Pack of 4","label_es":"Paquete de 4","price":12,"qty":4,"unit_label":"$3.00 ea","unit_label_es":"$3.00 c/u"},
  {"id":"half-dozen","label":"Half Dozen (6)","label_es":"Media Docena (6)","price":15,"qty":6,"badge":"Save $3","badge_es":"¡Ahorra $3!","unit_label":"$2.50 ea","unit_label_es":"$2.50 c/u"},
  {"id":"dozen","label":"Dozen (12)","label_es":"Docena (12)","price":28,"qty":12,"badge":"Save $8","badge_es":"¡Ahorra $8!","unit_label":"$2.33 ea","unit_label_es":"$2.33 c/u"}
]'
WHERE id IN ('prod_empanadas', 'prod_cakepop');

-- Backfill missing Spanish name/description on Cinnamon Rolls
UPDATE products
SET name_es = 'Roles de Canela',
    description_es = 'Roles de canela suaves y esponjosos, enrollados con azúcar moreno y canela, horneados frescos y servidos calientes. Nuestro desayuno de autor.'
WHERE id = 'prod_mrwvp8n0' AND name_es IS NULL;
