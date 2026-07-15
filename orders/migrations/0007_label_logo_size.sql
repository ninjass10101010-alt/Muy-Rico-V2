-- Add a persisted logo size (cqw units) to label templates.
-- Run:
--   npx wrangler d1 execute muy-rico-orders --file=migrations/0007_label_logo_size.sql
--   npx wrangler d1 execute muy-rico-orders --remote --file=migrations/0007_label_logo_size.sql

ALTER TABLE label_templates ADD COLUMN logo_size REAL;
