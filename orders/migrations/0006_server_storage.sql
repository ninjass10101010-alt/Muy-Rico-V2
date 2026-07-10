-- Muy Rico — server-side storage for customers, payments, labels, profile
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

-- Seed from src/data/seedData.ts (kept in lock-step for offline fallback).
-- INSERT OR IGNORE so re-running never clobbers rows the user created.
INSERT OR IGNORE INTO customers (id, name, phone, email, notes, created_at)
VALUES
  ('cust_1','Maria Gonzalez','(616) 555-0142','maria.g@example.com','Regular — allergic to nuts.',datetime('now','-120 days')),
  ('cust_2','James Whitfield','(616) 555-0290','jwhitfield@example.com','Prefers pickup after 5pm.',datetime('now','-88 days')),
  ('cust_3','Aisha Thompson','(616) 555-0345','aisha.t@example.com','Orders birthday cakes monthly.',datetime('now','-64 days')),
  ('cust_4','Kevin Park','(616) 555-0321','kevin.park@example.com','',datetime('now','-30 days')),
  ('cust_5','Sophie Nguyen','(616) 555-0098','sophie.n@example.com','Found us via Instagram.',datetime('now','-14 days'));

INSERT OR IGNORE INTO label_templates
  (id, name, shape, bg_color, accent_color, text_color, business_name, product_name,
   details, ingredients, allergens, net_weight, price, show_price, show_best_by,
   best_by_days, logo_emoji, font, business_id_mode, address, phone_number,
   registration_number, show_disclaimer, label_width, label_height, display_order)
VALUES
  ('label_default','Classic Kraft Round','circle','#FBF3E7','#d93d59','#2c2523','Muy Rico',
   'Chocolate Chip Cookie','Made fresh with real butter & love',
   'Enriched flour (wheat flour, niacin, reduced iron, thiamine mononitrate, riboflavin, folic acid), butter (cream, salt), chocolate chips (sugar, chocolate liquor, cocoa butter, butterfat, soy lecithin), sugar, brown sugar, eggs, vanilla extract, baking soda, salt.',
   'Contains: wheat, milk, eggs, soy.','Net Wt. 3 oz','$4.00',1,1,3,'🍪',
   '''Cormorant Garamond'', serif','registration','','(616) 218-3582','',1,3,4,0);

INSERT OR IGNORE INTO business_profile
  (id, name, tagline, address, phone, email, registration_number,
   accepted_methods, cashtag, venmo_handle, apple_pay_enabled, stripe_connected)
VALUES
  ('singleton','Muy Rico','Familia · Tradición · Sabor','Holland, MI','(616) 218-3582',
   'hello@muy-rico.com','',
   '{"stripe":false,"cashapp":true,"venmo":true,"applepay":true,"cash":true}',
   '$MuyRicoBakery','@Muy-Rico',1,0);
