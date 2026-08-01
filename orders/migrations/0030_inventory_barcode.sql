-- 0030: inventory barcode column + unique partial index + seed
-- Adds `barcode` to inventory items for phone-camera / scanner-gun lookup.
-- Seed each item with its existing id so cycle-counting + label-printing work
-- out of the box; supplier codes overwrite via the "bind this code" flow.
--
-- Run:
--   npx wrangler d1 execute muy-rico-orders --remote --file=migrations/0030_inventory_barcode.sql

ALTER TABLE inventory ADD COLUMN barcode TEXT;

CREATE UNIQUE INDEX idx_inventory_barcode
  ON inventory(barcode) WHERE barcode IS NOT NULL;

UPDATE inventory SET barcode = id WHERE barcode IS NULL;
