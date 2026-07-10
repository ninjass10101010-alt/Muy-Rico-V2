-- Muy Rico — server-side storage for customers, payments, labels, profile
-- Customers and label templates are NOT seeded (real data entered directly).
-- Only the business_profile singleton is seeded (Settings UI requires it).
-- Run:
--   npx wrangler d1 execute muy-rico-orders --file=migrations/0006_server_storage.sql
--   npx wrangler d1 execute muy-rico-orders --remote --file=migrations/0006_server_storage.sql

CREATE TABLE IF NOT EXISTS customers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT,
  email       TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT,
  active      INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_customers_active ON customers(active);

CREATE TABLE IF NOT EXISTS payments (
  id            TEXT PRIMARY KEY,
  order_id      INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  order_number  TEXT,
  customer_name TEXT,
  amount        REAL NOT NULL DEFAULT 0,
  method        TEXT NOT NULL,
  date          TEXT NOT NULL DEFAULT (datetime('now')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  active        INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_payments_order   ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_active  ON payments(active);

CREATE TABLE IF NOT EXISTS label_templates (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  shape            TEXT,
  bg_color         TEXT,
  accent_color     TEXT,
  text_color       TEXT,
  business_name    TEXT,
  product_name     TEXT,
  details          TEXT,
  ingredients      TEXT,
  allergens        TEXT,
  net_weight       TEXT,
  price            TEXT,
  show_price       INTEGER,
  show_best_by     INTEGER,
  best_by_days     INTEGER,
  logo_emoji       TEXT,
  logo_image       TEXT,
  font             TEXT,
  business_id_mode TEXT,
  address          TEXT,
  phone_number     TEXT,
  registration_number TEXT,
  show_disclaimer  INTEGER,
  label_width      REAL,
  label_height     REAL,
  display_order    INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT,
  active           INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_labels_active  ON label_templates(active);
CREATE INDEX IF NOT EXISTS idx_labels_display ON label_templates(display_order);

CREATE TABLE IF NOT EXISTS business_profile (
  id                  TEXT PRIMARY KEY DEFAULT 'singleton',
  name                TEXT,
  tagline             TEXT,
  address             TEXT,
  phone               TEXT,
  email               TEXT,
  registration_number TEXT,
  accepted_methods    TEXT,
  cashtag             TEXT,
  venmo_handle        TEXT,
  apple_pay_enabled   INTEGER,
  stripe_connected    INTEGER,
  updated_at          TEXT
);

-- Seed only the business profile (the Settings UI requires a singleton row to exist).
-- Customers and label templates are NOT seeded — the shop now enters real data directly.
-- Keep in lock-step with src/data/seedData.ts `seedProfile` for the offline fallback.
INSERT OR IGNORE INTO business_profile
  (id, name, tagline, address, phone, email, registration_number,
   accepted_methods, cashtag, venmo_handle, apple_pay_enabled, stripe_connected)
VALUES
  ('singleton','Muy Rico','Familia · Tradición · Sabor','Holland, MI','(616) 218-3582',
   'hello@muy-rico.com','',
   '{"stripe":false,"cashapp":true,"venmo":true,"applepay":true,"cash":true}',
   '$MuyRicoBakery','@Muy-Rico',1,0);
