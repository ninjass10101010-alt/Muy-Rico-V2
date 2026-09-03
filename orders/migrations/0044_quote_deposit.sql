ALTER TABLE cake_quotes ADD COLUMN public_token TEXT;
ALTER TABLE cake_quotes ADD COLUMN deposit_paid_cents INTEGER;
ALTER TABLE cake_quotes ADD COLUMN deposit_paid_at TEXT;
ALTER TABLE cake_quotes ADD COLUMN deposit_method TEXT;
ALTER TABLE cake_quotes ADD COLUMN deposit_ref TEXT;
UPDATE cake_quotes SET public_token = lower(hex(randomblob(16))) WHERE public_token IS NULL;
CREATE UNIQUE INDEX idx_cake_quotes_public_token ON cake_quotes(public_token);
