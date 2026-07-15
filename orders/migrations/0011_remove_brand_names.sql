-- Muy Rico — Migration 0011
-- Removes all brand names from product ingredient strings.
-- Lists only raw sub-ingredients per Michigan Cottage Food Law best practices.
--
-- Run:
--   npx wrangler d1 execute muy-rico-orders --local  --file=migrations/0011_remove_brand_names.sql
--   npx wrangler d1 execute muy-rico-orders --remote --file=migrations/0011_remove_brand_names.sql

-- ── Cupcakes (6) — all three cake mix flavors + frosting, no brand names ─────
UPDATE products
SET
  ingredients = 'Enriched Flour Bleached (wheat flour, niacin, iron, thiamin mononitrate, riboflavin, folic acid), sugar, corn syrup, leavening (baking soda, sodium aluminum phosphate, monocalcium phosphate), modified corn starch, corn starch, palm oil, salt, natural and artificial flavor, water, butter (cream, salt), eggs, vanilla extract. Frosting: sugar, palm oil, water, corn syrup, canola oil, corn starch, and 2% or less of: mono- and diglycerides, natural and artificial flavor, modified corn starch, cellulose gel, salt, propylene glycol monostearate, carrageenan, polysorbate 80, potassium sorbate (preservative), cellulose gum, citric acid, sodium stearoyl lactylate, antioxidants (ascorbyl palmitate, mixed tocopherols). Chocolate varieties additionally contain: cocoa processed with alkali. Strawberry variety additionally contains: Red 40.',
  allergens = 'Contains: wheat, milk, eggs. Strawberry variety contains Red 40 artificial color.'
WHERE id = 'prod_cupcakes';

-- ── Cakepops — chocolate cake mix + chocolate frosting binder, no brand names ─
UPDATE products
SET
  ingredients = 'Enriched Flour Bleached (wheat flour, niacin, iron, thiamin mononitrate, riboflavin, folic acid), sugar, cocoa processed with alkali, corn syrup, leavening (baking soda, sodium aluminum phosphate, monocalcium phosphate), modified corn starch, corn starch, palm oil, salt, artificial flavor, water, butter (cream, salt), eggs, vanilla extract. Frosting binder: sugar, palm oil, water, corn syrup, canola oil, cocoa (processed with alkali), corn starch, and 2% or less of: mono- and diglycerides, natural and artificial flavor, modified corn starch, cellulose, salt, propylene glycol monostearate, carrageenan, distilled monoglycerides, polysorbate 80, potassium sorbate (preservative), cellulose gum, sodium stearoyl lactylate, antioxidants (citric acid, ascorbyl palmitate, mixed tocopherols, chamomile and rosemary extracts). Candy coating: sugar, palm oil, cocoa, soy lecithin.',
  allergens = 'Contains: wheat, milk, eggs, soy.'
WHERE id = 'prod_cakepop';

-- ── Custom Cake — vanilla base, no brand names ────────────────────────────────
UPDATE products
SET
  ingredients = 'Enriched Flour Bleached (wheat flour, niacin, iron, thiamin mononitrate, riboflavin, folic acid), sugar, corn syrup, leavening (baking soda, sodium aluminum phosphate, monocalcium phosphate), modified corn starch, corn starch, propylene glycol mono and diesters of fatty acids, salt, monoglycerides, palm oil, natural and artificial flavor, water, butter (cream, salt), eggs, vanilla extract.',
  allergens = 'Contains: wheat, milk, eggs.'
WHERE id = 'prod_custom_cake';
