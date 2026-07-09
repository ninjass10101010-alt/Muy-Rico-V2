-- Muy Rico Order Tracker — D1 schema
-- Run: npx wrangler d1 execute muy-rico-orders --file=migrations/0001_initial.sql

CREATE TABLE IF NOT EXISTS orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  customer_name   TEXT    NOT NULL,
  phone           TEXT,
  pickup_date     TEXT    NOT NULL,
  pickup_time     TEXT,
  items_json      TEXT    NOT NULL,              -- [{name, qty, price}]
  total_cents     INTEGER NOT NULL DEFAULT 0,    -- store in cents, no float math
  payment_method  TEXT    NOT NULL,              -- 'venmo' | 'cashapp' | 'applepay' | 'cash'
  payment_status  TEXT    NOT NULL DEFAULT 'unpaid',  -- 'unpaid' | 'paid'
  status          TEXT    NOT NULL DEFAULT 'pending', -- 'pending' | 'ready' | 'done' | 'cancelled'
  notes           TEXT,
  created_by      TEXT    NOT NULL DEFAULT 'jeff',
  source          TEXT    NOT NULL DEFAULT 'in-person'
);

CREATE INDEX IF NOT EXISTS idx_orders_status   ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_pickup   ON orders(pickup_date);
CREATE INDEX IF NOT EXISTS idx_orders_created  ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_paymeth  ON orders(payment_method);

-- Audit trail (who did what)
CREATE TABLE IF NOT EXISTS order_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  actor      TEXT    NOT NULL,    -- 'jeff' | 'rebecca' | 'system'
  event      TEXT    NOT NULL     -- 'order:created' | 'order:updated' | 'order:cancelled'
);

CREATE INDEX IF NOT EXISTS idx_events_order ON order_events(order_id);
