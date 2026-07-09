-- Muy Rico — Inventory table (admin-only)
-- Mirrors the localStorage-backed `seedInventory` plus 3 new fields used by
-- the label composition util (Part 11):
--   ingredients_label : legal sub-ingredient text printed on cottage-food labels
--                       e.g. "Enriched flour (wheat flour, niacin, …)"
--   allergens          : JSON array of major-food-allergen tags
--                        e.g. '["Wheat","Milk"]' — used to build the "Contains: …" callout
--   unit_weight        : weight (lb) of one `unit`. Used by composeLabelFromRecipe to
--                        sort ingredient strings by descending weight (MCL 289.4102).
--                        Defaults to 1 (for 'lb'-based units). Eggs/dz ≈ 1.5, vanilla/bottle ≈ 0.25.
--
-- Run:
--   npx wrangler d1 execute muy-rico-orders --file=migrations/0004_inventory.sql
--   npx wrangler d1 execute muy-rico-orders --remote --file=migrations/0004_inventory.sql

CREATE TABLE IF NOT EXISTS inventory (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  category           TEXT NOT NULL,
  quantity           REAL NOT NULL DEFAULT 0,
  unit               TEXT NOT NULL,
  reorder_level      REAL NOT NULL DEFAULT 0,
  cost_per_unit      REAL NOT NULL DEFAULT 0,
  supplier           TEXT,
  ingredients_label  TEXT,
  allergens          TEXT,
  unit_weight        REAL,
  active             INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT
);

CREATE INDEX IF NOT EXISTS idx_inventory_category ON inventory(category);
CREATE INDEX IF NOT EXISTS idx_inventory_active   ON inventory(active);

-- Seed all current seedInventory items plus 3 new ones the cookie recipe needs
INSERT OR IGNORE INTO inventory
  (id, name, category, quantity, unit, reorder_level, cost_per_unit, supplier, ingredients_label, allergens, unit_weight)
VALUES
  ('inv_flour','All-Purpose Flour','Dry Goods',20,'lb',10,0.55,'Restaurant Depot',
   'Enriched flour (wheat flour, niacin, reduced iron, thiamine mononitrate, riboflavin, folic acid)',
   '["Wheat"]',1.0),
  ('inv_sugar','Granulated Sugar','Dry Goods',15,'lb',8,0.6,'Restaurant Depot',
   'Sugar','[]',1.0),
  ('inv_brown_sugar','Brown Sugar','Dry Goods',5,'lb',3,0.7,'Restaurant Depot',
   'Brown sugar','[]',1.0),
  ('inv_butter','Unsalted Butter','Dairy',10,'lb',6,3.2,'Costco',
   'Butter (cream, salt)','["Milk"]',1.0),
  ('inv_eggs','Eggs','Dairy',4,'dozen',4,3.8,'Local Farm',
   'Eggs','["Eggs"]',1.5),
  ('inv_cocoa','Cocoa Powder','Baking',5,'lb',3,5.1,'Costco',
   'Cocoa powder','[]',1.0),
  ('inv_vanilla','Vanilla Extract','Baking',1.5,'bottle',2,9.5,'Restaurant Depot',
   'Vanilla extract','[]',0.25),
  ('inv_creamcheese','Cream Cheese','Dairy',6,'block',4,2.1,'Costco',
   'Cream cheese (pasteurized milk, cheese culture, salt, enzymes)','["Milk"]',0.5),
  ('inv_choc_chips','Chocolate Chips','Baking',7,'lb',5,4.4,'Restaurant Depot',
   'Chocolate chips (sugar, chocolate liquor, cocoa butter, butterfat, soy lecithin)','["Soy","Milk"]',1.0),
  ('inv_baking_soda','Baking Soda','Baking',2,'lb',1,1.1,'Restaurant Depot',
   'Baking soda','[]',1.0),
  ('inv_salt','Salt','Baking',2,'lb',1,0.5,'Restaurant Depot',
   'Salt','[]',1.0),
  ('inv_box_small','Small Bakery Boxes','Packaging',18,'each',15,0.65,'Uline',NULL,NULL,NULL),
  ('inv_box_large','Large Cake Boxes','Packaging',10,'each',8,1.4,'Uline',NULL,NULL,NULL),
  ('inv_labels','Label Sticker Sheets','Packaging',40,'sheet',20,0.2,'Uline',NULL,NULL,NULL);
