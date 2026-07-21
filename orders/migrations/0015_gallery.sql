-- Muy Rico — Gallery table (portfolio albums of past product photos)
-- Linked to products for grouping + "Request this design" deep-links.
-- Run:
--   npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --file=orders/migrations/0015_gallery.sql
--   npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0015_gallery.sql

CREATE TABLE IF NOT EXISTS gallery (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL,
  title         TEXT NOT NULL,
  title_es      TEXT,
  image_url     TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_gallery_active  ON gallery(active);
CREATE INDEX IF NOT EXISTS idx_gallery_product ON gallery(product_id);
CREATE INDEX IF NOT EXISTS idx_gallery_order   ON gallery(display_order);
