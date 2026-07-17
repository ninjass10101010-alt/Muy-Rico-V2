-- Canva-style label canvas: element positions, website URL, orientation
-- Run:
--   npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --file=orders/migrations/0013_label_canvas.sql
--   npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0013_label_canvas.sql

ALTER TABLE label_templates ADD COLUMN elements TEXT;
ALTER TABLE label_templates ADD COLUMN website_url TEXT;
ALTER TABLE label_templates ADD COLUMN orientation TEXT DEFAULT 'portrait';

ALTER TABLE business_profile ADD COLUMN website TEXT;

UPDATE business_profile SET website = 'https://muy-rico.com' WHERE website IS NULL OR website = '';
