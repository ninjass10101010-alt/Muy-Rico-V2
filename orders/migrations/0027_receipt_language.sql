-- Track which language each receipt email was sent in so resends
-- reproduce the original language and the admin can audit history.
ALTER TABLE receipts ADD COLUMN language TEXT NOT NULL DEFAULT 'es';