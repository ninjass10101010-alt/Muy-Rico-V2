-- Add source column to existing orders
ALTER TABLE orders ADD COLUMN source TEXT NOT NULL DEFAULT 'in-person';
