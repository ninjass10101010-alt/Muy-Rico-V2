-- Empanadas: add flavor options (fillings)
-- Run: npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0019_empanada_flavors.sql

UPDATE products SET
  flavors = '[{"name":"Filling","name_es":"Relleno","options":["Cajeta","Piña","Fresa","Guayaba"]}]',
  updated_at = datetime('now')
WHERE id = 'prod_empanadas' AND (flavors IS NULL OR flavors = '[]');
