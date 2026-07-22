-- Muy Rico — Pay-first checkout columns
-- Adds email (for customer confirmations) and language (bilingual emails)
ALTER TABLE orders ADD COLUMN email TEXT;
ALTER TABLE orders ADD COLUMN language TEXT NOT NULL DEFAULT 'es';
