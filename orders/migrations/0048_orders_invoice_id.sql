-- Link auto-converted orders back to their source invoice, and guarantee at most
-- one order per invoice (the unique index is the serialization point for conversion).
-- Run:
--   npx -y wrangler@4.127.0 d1 execute muy-rico-orders --config orders/wrangler.toml --local --file=orders/migrations/0048_orders_invoice_id.sql
--   npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0048_orders_invoice_id.sql

ALTER TABLE orders ADD COLUMN invoice_id INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_invoice_id ON orders(invoice_id) WHERE invoice_id IS NOT NULL;
