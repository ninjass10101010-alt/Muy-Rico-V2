-- Site content: dashboard-editable homepage slots + testimonials + featured products
-- Run: npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0017_site_content.sql

CREATE TABLE IF NOT EXISTS site_content (
  key         TEXT PRIMARY KEY,
  value_en    TEXT,
  value_es    TEXT,
  image_url   TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS testimonials (
  id            TEXT PRIMARY KEY,
  quote_en      TEXT NOT NULL,
  quote_es      TEXT,
  author        TEXT,
  occasion      TEXT,
  published     INTEGER NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE products ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;
