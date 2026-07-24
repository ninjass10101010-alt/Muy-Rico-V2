-- Receipt history: one row per receipt email send attempt (sent or failed).
-- Captures a snapshot of the order at send time so history survives order edits.
CREATE TABLE IF NOT EXISTS receipts (
  id                  TEXT PRIMARY KEY,
  order_id            INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_number        TEXT,
  customer_name       TEXT NOT NULL,
  email               TEXT,
  items_json          TEXT NOT NULL,
  total_cents         INTEGER NOT NULL DEFAULT 0,
  payment_method      TEXT NOT NULL,
  payment_sub_method  TEXT,
  order_status        TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'sent',
  message_id          TEXT,
  sent_at             TEXT NOT NULL DEFAULT (datetime('now')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_receipts_order   ON receipts(order_id);
CREATE INDEX IF NOT EXISTS idx_receipts_email   ON receipts(email);
CREATE INDEX IF NOT EXISTS idx_receipts_created ON receipts(created_at DESC);
