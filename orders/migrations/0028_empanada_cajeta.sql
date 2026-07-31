-- Empanada dough (4 ingredients) + La Lechera Cajeta filling sub-ingredients.
-- Per Michigan Cottage Food Law, sub-ingredients of any commercial
-- ingredient must be listed. La Lechera Cajeta is a brand-name goat's
-- milk caramel; its declared sub-ingredients are listed below.
-- Also enable auto-generate label for empanadas (was disabled).
UPDATE products SET
  ingredients = 'Dough: enriched flour (wheat flour, niacin, reduced iron, thiamine mononitrate, riboflavin, folic acid), water, vegetable shortening (manteca vegetal), sugar. Filling: La Lechera cajeta (goat''s milk, sugar, corn syrup, carrageenan, baking soda).',
  allergens  = 'Contains: wheat, milk.',
  auto_generate_label = 1
WHERE id = 'prod_empanadas';