-- 0036_customer_email_unique_index.sql
-- Hard backstop: enforce one active customer per normalized email.
-- DO NOT run until all existing duplicate customers are merged via admin UI.

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email_unique
  ON customers(email_normalized)
  WHERE active = 1 AND merged_into_id IS NULL AND email_normalized IS NOT NULL;
