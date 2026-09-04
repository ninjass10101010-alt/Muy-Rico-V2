-- Muy Rico — Homepage CTA band slideshow (owner-managed, independent of products)
-- Run:
--   npx -y wrangler@4.127.0 d1 execute muy-rico-orders --config orders/wrangler.toml --local --file=orders/migrations/0045_slideshow.sql
--   npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0045_slideshow.sql

CREATE TABLE IF NOT EXISTS slideshow_slides (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  title_es      TEXT,
  description   TEXT,
  description_es TEXT,
  image_url     TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_slideshow_active ON slideshow_slides(active);
CREATE INDEX IF NOT EXISTS idx_slideshow_order  ON slideshow_slides(display_order);
