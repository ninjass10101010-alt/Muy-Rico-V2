CREATE TABLE IF NOT EXISTS cake_quotes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  status          TEXT NOT NULL DEFAULT 'new',
  customer_name   TEXT NOT NULL,
  email           TEXT NOT NULL,
  phone           TEXT,
  language        TEXT NOT NULL DEFAULT 'es',

  occasion        TEXT,
  serving_size    TEXT,
  cake_flavor     TEXT NOT NULL,
  filling         TEXT,
  frosting        TEXT,
  toppings        TEXT,
  dietary         TEXT,

  reference_image_url TEXT,

  comments        TEXT,
  desired_date    TEXT,
  budget          TEXT,

  quoted_price    INTEGER,
  admin_notes     TEXT,
  converted_order_id INTEGER,

  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (converted_order_id) REFERENCES orders(id)
);

CREATE INDEX IF NOT EXISTS idx_cake_quotes_status ON cake_quotes(status);
CREATE INDEX IF NOT EXISTS idx_cake_quotes_created ON cake_quotes(created_at);