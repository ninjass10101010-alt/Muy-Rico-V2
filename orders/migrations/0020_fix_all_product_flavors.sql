-- Fix structured flavor groups for cakepops, custom cake, and cupcakes
-- Run: npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0020_fix_all_product_flavors.sql

UPDATE products SET
  flavors = '[{"name":"Cake","name_es":"Bizcocho","options":["Chocolate","Vanilla"]},{"name":"Chocolate Dip","name_es":"Baño de Chocolate","options":["Milk Chocolate","Dark Chocolate","White Chocolate"]},{"name":"Topping","name_es":"Decoración","options":["Sprinkles","Crushed Nuts","Coconut","Drizzle"]}]',
  updated_at = datetime('now')
WHERE id = 'prod_cakepop';

UPDATE products SET
  flavors = '[{"name":"Cake","name_es":"Bizcocho","options":["Chocolate","Vanilla"]},{"name":"Frosting","name_es":"Betún","options":["Vanilla Buttercream","Chocolate Buttercream"]}]',
  updated_at = datetime('now')
WHERE id IN ('prod_custom_cake', 'prod_cupcakes');
