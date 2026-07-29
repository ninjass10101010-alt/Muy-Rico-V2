-- Fix empanadas description: remove guava (not actually offered) and ensure
-- Spanish/English descriptions match in structure.
-- Run:
--   npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0025_empanada_description_fix.sql

UPDATE products SET
  description    = 'Flaky, golden empanadas with a soft dough and your choice of filling — cajeta, pineapple, or strawberry. Baked fresh daily.',
  description_es = 'Empanadas doradas y hojaldradas con masa suave y tu relleno favorito: cajeta, piña o fresa. Horneadas frescas cada día.',
  updated_at = datetime('now')
WHERE id = 'prod_empanadas';
