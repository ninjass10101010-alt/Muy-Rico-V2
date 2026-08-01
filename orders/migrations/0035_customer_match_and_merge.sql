-- 0035_customer_match_and_merge.sql
-- Add normalized columns + merge audit ledger for customer dedup system.

-- Add columns to customers
ALTER TABLE customers ADD COLUMN merged_into_id TEXT;
ALTER TABLE customers ADD COLUMN email_normalized TEXT;
ALTER TABLE customers ADD COLUMN phone_normalized TEXT;

-- Indexes on normalized columns
CREATE INDEX IF NOT EXISTS idx_customers_email_norm ON customers(email_normalized);
CREATE INDEX IF NOT EXISTS idx_customers_phone_norm ON customers(phone_normalized);

-- Audit ledger (append-only)
CREATE TABLE IF NOT EXISTS customer_merges (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  surviving_id        TEXT NOT NULL,
  merged_id           TEXT NOT NULL,
  matched_by          TEXT NOT NULL,       -- 'email_exact' | 'phone_exact' | 'admin_manual'
  matched_fields_json TEXT,
  merged_by           TEXT NOT NULL,       -- admin actor email
  merged_at           TEXT NOT NULL DEFAULT (datetime('now')),
  reversed_by         TEXT,
  reversed_at         TEXT
);

CREATE INDEX IF NOT EXISTS idx_merges_surviving ON customer_merges(surviving_id);
CREATE INDEX IF NOT EXISTS idx_merges_merged    ON customer_merges(merged_id);

-- Backfill normalized columns from existing data (idempotent)
UPDATE customers SET
  email_normalized = LOWER(TRIM(email))
WHERE active = 1 AND email IS NOT NULL AND email_normalized IS NULL;

UPDATE customers SET
  phone_normalized = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
    phone, '-', ''), ' ', ''), '(', ''), ')', ''), '.', ''), '+', '')
WHERE active = 1 AND phone IS NOT NULL AND phone_normalized IS NULL;
