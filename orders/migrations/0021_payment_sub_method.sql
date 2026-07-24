-- Add payment_sub_method to orders and method_details to payments.
-- Both store a JSON string describing the specific instrument the customer used
-- (e.g. {"type":"card","brand":"visa","funding":"credit","last4":"4242"}).
-- Nullable so existing rows remain valid.
ALTER TABLE orders   ADD COLUMN payment_sub_method TEXT;
ALTER TABLE payments ADD COLUMN method_details    TEXT;
