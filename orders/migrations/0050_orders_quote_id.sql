-- Link auto-converted orders back to their source quote, and guarantee at most
-- one order per quote (the unique index is the serialization point for conversion).
-- Run:
--   npx -y wrangler@4.127.0 d1 execute muy-rico-orders --config orders/wrangler.toml --local --file=orders/migrations/0050_orders_quote_id.sql
--   npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0050_orders_quote_id.sql

ALTER TABLE orders ADD COLUMN quote_id INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_quote_id ON orders(quote_id) WHERE quote_id IS NOT NULL;

-- Backfill the conversions that predate this file: they recorded
-- cake_quotes.converted_order_id but never wrote orders.quote_id, so the index
-- above guarded none of them. Idempotent — rows with no source quote are
-- skipped rather than rewritten as NULL, so a re-run touches nothing — and it
-- declines any quote id another order already holds, so it cannot violate the
-- unique index it backfills under.
UPDATE orders
   SET quote_id = (SELECT MIN(q.id) FROM cake_quotes q WHERE q.converted_order_id = orders.id)
 WHERE quote_id IS NULL
   AND EXISTS (SELECT 1 FROM cake_quotes q WHERE q.converted_order_id = orders.id)
   AND NOT EXISTS (
     SELECT 1 FROM cake_quotes q
      WHERE q.converted_order_id = orders.id
        AND EXISTS (SELECT 1 FROM orders o WHERE o.quote_id = q.id)
   );
