-- Muy Rico Label Studio — compliance + canvas fields
-- Run:
--   npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --file=orders/migrations/0014_label_studio.sql
--   npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0014_label_studio.sql

ALTER TABLE label_templates ADD COLUMN disclaimer_variant TEXT DEFAULT 'standard';
ALTER TABLE label_templates ADD COLUMN product_type       TEXT DEFAULT 'standard';
ALTER TABLE label_templates ADD COLUMN net_weight_us      TEXT;
ALTER TABLE label_templates ADD COLUMN net_weight_metric  TEXT;
ALTER TABLE label_templates ADD COLUMN allergen_tags      TEXT;
ALTER TABLE label_templates ADD COLUMN no_allergens_confirmed INTEGER DEFAULT 0;
ALTER TABLE label_templates ADD COLUMN nutrient_claim     INTEGER DEFAULT 0;
ALTER TABLE label_templates ADD COLUMN bg_image           TEXT;
ALTER TABLE label_templates ADD COLUMN avery_preset       TEXT DEFAULT 'single';

ALTER TABLE business_profile ADD COLUMN business_type     TEXT DEFAULT 'cottage';
UPDATE business_profile SET business_type = 'cottage' WHERE business_type IS NULL OR business_type = '';
