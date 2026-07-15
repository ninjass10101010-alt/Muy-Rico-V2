-- Link orders to customer records so the Customers page can show real order history/stats.
ALTER TABLE orders ADD COLUMN customer_id TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
