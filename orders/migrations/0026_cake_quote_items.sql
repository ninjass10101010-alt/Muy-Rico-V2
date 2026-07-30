-- 0026_cake_quote_items.sql
-- Multi-item quote system: add cake_quote_items table and backfill existing data.

CREATE TABLE IF NOT EXISTS cake_quote_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id      INTEGER NOT NULL,
  product_type  TEXT NOT NULL,         -- 'cake' | 'cakepops' | 'cupcakes'
  sort_order    INTEGER NOT NULL DEFAULT 0,
  details       TEXT NOT NULL,         -- JSON blob of type-specific fields
  reference_image_url TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (quote_id) REFERENCES cake_quotes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON cake_quote_items(quote_id);

-- Backfill existing single-item quotes into the new items table (idempotent)
INSERT INTO cake_quote_items (quote_id, product_type, sort_order, details, reference_image_url)
  SELECT id, 'cake', 0,
    json_object(
      'cake_flavor', cake_flavor,
      'filling', filling,
      'frosting', frosting,
      'serving_size', serving_size,
      'toppings', toppings
    ),
    reference_image_url
  FROM cake_quotes
  WHERE cake_flavor IS NOT NULL
  AND id NOT IN (SELECT quote_id FROM cake_quote_items);
