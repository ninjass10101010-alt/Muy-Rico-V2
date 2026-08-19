-- Muy Rico Cake Quotes — customer inspiration/mood-board entries picked from the gallery
-- Run:
--   npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --file=orders/migrations/0040_quote_inspiration.sql
--   npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0040_quote_inspiration.sql

ALTER TABLE cake_quotes ADD COLUMN inspiration TEXT;
