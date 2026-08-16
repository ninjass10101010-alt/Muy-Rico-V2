-- 0041: inventory ingredient groups (substitution via active item)
-- Models an *ingredient* (All-Purpose Flour, Bread Flour) as a group of
-- interchangeable stock items, one of which is active. product.recipe keeps
-- concrete inventoryItemId values; "make active" rewrites those ids to the
-- new active item. Deduction/label/cost/prep engines are untouched.
--
-- Run (from orders/):
--   npx wrangler d1 execute muy-rico-orders -c wrangler.toml --file=migrations/0041_inventory_ingredient_groups.sql
--   npx wrangler d1 execute muy-rico-orders -c wrangler.toml --remote --file=migrations/0041_inventory_ingredient_groups.sql

CREATE TABLE IF NOT EXISTS ingredient_groups (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  category        TEXT,
  active_item_id  TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT
);

ALTER TABLE inventory ADD COLUMN group_id TEXT;
CREATE INDEX IF NOT EXISTS idx_inventory_group ON inventory(group_id);

-- Backfill: every existing active item becomes its own 1:1 group.
-- OR IGNORE makes re-runs safe (groups already created are left alone).
INSERT OR IGNORE INTO ingredient_groups (id, name, category, active_item_id)
  SELECT 'grp_' || id, name, category, id FROM inventory WHERE active = 1;
UPDATE inventory SET group_id = 'grp_' || id WHERE group_id IS NULL;