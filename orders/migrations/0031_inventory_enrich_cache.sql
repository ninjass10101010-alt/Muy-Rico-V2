-- 0031: inventory enrich cache columns
-- Tracks which external source (USDA, OFF) populated an item's ingredient/allergen data
-- and when, so we can re-fetch later and show provenance on the inventory page.
--
-- Run:
--   npx wrangler d1 execute muy-rico-orders --remote --file=migrations/0031_inventory_enrich_cache.sql

ALTER TABLE inventory ADD COLUMN nutrition_source TEXT;     -- e.g. 'fdc:2490378', 'off:0737628064502'
ALTER TABLE inventory ADD COLUMN nutrition_fetched_at TEXT; -- ISO 8601 UTC
