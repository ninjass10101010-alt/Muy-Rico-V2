-- 0019: products.show_online — hide a product from the website while keeping it sellable in admin
ALTER TABLE products ADD COLUMN show_online INTEGER NOT NULL DEFAULT 1;
