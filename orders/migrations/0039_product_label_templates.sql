-- Muy Rico Label Studio — product templates vs. order labels
-- Run:
--   npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --file=orders/migrations/0039_product_label_templates.sql
--   npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0039_product_label_templates.sql

ALTER TABLE label_templates ADD COLUMN template_kind TEXT DEFAULT 'custom';
ALTER TABLE label_templates ADD COLUMN product_id TEXT;

CREATE INDEX IF NOT EXISTS idx_label_templates_kind ON label_templates(template_kind, active);

-- Backfill: existing auto-generated order labels (named 'MR-{id} - {item}') → 'order'
UPDATE label_templates SET template_kind = 'order' WHERE name LIKE 'MR-% - %';
