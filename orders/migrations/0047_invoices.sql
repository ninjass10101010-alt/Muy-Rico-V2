-- Muy Rico — standalone customer-payable invoices.
-- Run:
--   npx -y wrangler@4.127.0 d1 execute muy-rico-orders --config orders/wrangler.toml --local --file=orders/migrations/0047_invoices.sql
--   npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0047_invoices.sql

CREATE TABLE IF NOT EXISTS invoices (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  number             TEXT NOT NULL,                  -- 'INV-1001', set from id after insert
  status             TEXT NOT NULL DEFAULT 'draft',  -- 'draft' | 'sent' | 'converted' | 'void'
  customer_name      TEXT NOT NULL,
  email              TEXT NOT NULL,
  phone              TEXT,
  language           TEXT NOT NULL DEFAULT 'es',     -- 'en' | 'es'
  customer_id        TEXT,
  issue_date         TEXT NOT NULL DEFAULT (datetime('now')),
  due_date           TEXT,
  payment_options    TEXT NOT NULL DEFAULT 'both',   -- 'full' | 'deposit' | 'both'
  total_cents        INTEGER NOT NULL DEFAULT 0,
  notes              TEXT,
  admin_notes        TEXT,
  public_token       TEXT NOT NULL,
  paid_cents         INTEGER NOT NULL DEFAULT 0,
  paid_at            TEXT,
  payment_method     TEXT,
  payment_sub_method TEXT,
  payment_ref        TEXT,
  converted_order_id INTEGER,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  created_by         TEXT NOT NULL DEFAULT 'jeff'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_public_token ON invoices(public_token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number       ON invoices(number);
CREATE INDEX IF NOT EXISTS idx_invoices_status   ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_created  ON invoices(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);

CREATE TABLE IF NOT EXISTS invoice_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id       INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description      TEXT NOT NULL,
  qty              INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
