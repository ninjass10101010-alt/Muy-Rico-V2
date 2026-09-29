-- Link auto-converted orders back to their source quote, and guarantee at most
-- one order per quote (the unique index is the serialization point for conversion).
-- Run:
--   npx -y wrangler@4.127.0 d1 execute muy-rico-orders --config orders/wrangler.toml --local --file=orders/migrations/0050_orders_quote_id.sql
--   npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0050_orders_quote_id.sql

ALTER TABLE orders ADD COLUMN quote_id INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_quote_id ON orders(quote_id) WHERE quote_id IS NOT NULL;
