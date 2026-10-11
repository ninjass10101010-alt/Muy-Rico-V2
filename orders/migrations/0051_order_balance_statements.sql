-- Order balance statements: a stable per-order pay token, gateway refs on
-- payments for idempotent webhooks, and a statement send log.
-- Run:
--   npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --local  --file=orders/migrations/0051_order_balance_statements.sql
--   npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0051_order_balance_statements.sql

ALTER TABLE orders ADD COLUMN pay_token TEXT;

ALTER TABLE payments ADD COLUMN ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_ref ON payments(ref) WHERE ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_statements (
  id            TEXT PRIMARY KEY,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  email         TEXT,
  language      TEXT NOT NULL DEFAULT 'es',
  total_cents   INTEGER NOT NULL DEFAULT 0,
  paid_cents    INTEGER NOT NULL DEFAULT 0,
  balance_cents INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'sent',
  message_id    TEXT,
  sent_by       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_order_statements_order
  ON order_statements(order_id, created_at DESC);
