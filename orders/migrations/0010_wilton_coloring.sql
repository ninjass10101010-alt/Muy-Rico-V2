-- Muy Rico — Migration 0010
-- Adds Wilton gel food coloring set to inventory.
--
-- Run:
--   npx wrangler d1 execute muy-rico-orders --local  --file=migrations/0010_wilton_coloring.sql
--   npx wrangler d1 execute muy-rico-orders --remote --file=migrations/0010_wilton_coloring.sql

-- Wilton Gel Food Coloring — sold as a set, tracked as one inventory unit.
-- Typical colors: Red (Red 40), Pink (Red 3, Red 40), Blue (Blue 1),
-- Green (Yellow 5, Blue 1), Yellow (Yellow 5), Orange (Red 40, Yellow 6),
-- Purple (Red 40, Blue 1), Black (Blue 1, Red 40, Yellow 5, Yellow 6)
INSERT OR IGNORE INTO inventory
  (id, name, category, quantity, unit, reorder_level, cost_per_unit, supplier,
   ingredients_label, allergens, unit_weight)
VALUES
  ('inv_wilton_coloring',
   'Wilton Gel Food Coloring Set',
   'Baking', 2, 'set', 1, 12.00, 'Michaels',
   'Water, Sugar, Glycerin, Sorbitol, Modified Food Starch, Potassium Sorbate, Sodium Benzoate; color-dependent FD&C dyes: Red 40, Red 3, Blue 1, Yellow 5, Yellow 6',
   '[]', 0.5);
