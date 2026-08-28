-- Muy Rico — Migration 0042
-- Mini Cupcakes product + Duncan Hines chocolate mix + customer record for Judy Vanderstelt.
-- Spec: docs/superpowers/specs/2026-08-27-mini-cupcakes-product-and-order-design.md
--
-- Run:
--   npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --local  --file=orders/migrations/0042_mini_cupcakes.sql
--   npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0042_mini_cupcakes.sql

-- ── Duncan Hines Perfectly Moist Dark Chocolate Fudge Cake Mix ───────────────
-- Barcode 0644209307562 (Open Food Facts). Brand-free ingredients label per 0011 convention.
INSERT OR IGNORE INTO inventory
  (id, name, category, quantity, unit, reorder_level, cost_per_unit, supplier,
   ingredients_label, allergens, unit_weight, active, barcode, group_id)
VALUES
  ('inv_duncan_hines_chocolate',
   'Duncan Hines Perfectly Moist Dark Chocolate Fudge Cake Mix',
   'Baking', 3, 'box', 2, 2.50, NULL,
   'Sugar, Enriched Bleached Wheat Flour (wheat flour, niacin, reduced iron, thiamine mononitrate, riboflavin, folic acid), Emulsified Palm Shortening (palm oil, propylene glycol mono- and diesters of fats and fatty acids, mono- and diglycerides, sodium stearoyl lactylate), Cocoa Powder Processed with Alkali, Dextrose, Leavening (baking soda, dicalcium phosphate, sodium aluminum phosphate, monocalcium phosphate), Contains 2% or less of: Wheat Starch, Salt, Cellulose Gum, Xanthan Gum.',
   '["Wheat"]', 0.95, 1, '0644209307562', 'grp_inv_duncan_hines_chocolate');

INSERT OR IGNORE INTO ingredient_groups (id, name, category, active_item_id)
VALUES ('grp_inv_duncan_hines_chocolate',
        'Duncan Hines Perfectly Moist Dark Chocolate Fudge Cake Mix',
        'Baking', 'inv_duncan_hines_chocolate');

-- ── Mini Cupcakes (12) — sold by the dozen, $24, no pack sizes ───────────────
-- Recipe per DOZEN: 0.24 box of mix (owner yield 0.3 oz dry mix per mini cupcake);
-- non-mix quantities mirror prod_cupcakes' per-6-pack values (a dozen minis ≈
-- same batter as a half-dozen regular cupcakes).
INSERT OR IGNORE INTO products
  (id, name, name_es, description, description_es, category, price, cost, sku, emoji, image_url,
   active, show_online, ingredients, allergens, flavors, pack_sizes, recipe,
   flavor_deduction_map, display_order, auto_generate_label, featured)
VALUES
  ('prod_mini_cupcakes',
   'Mini Cupcakes (12)', 'Mini Cupcakes (12)',
   'One dozen mini cupcakes made fresh to order. Choose your cake flavor and frosting. One flavor per dozen.',
   'Una docena de mini cupcakes hechos frescos a pedido. Elige el sabor del pastel y el betún. Un sabor por docena.',
   'Cupcakes', 24, 5, 'MR-MCUP12', 'cupcake.svg', NULL,
   1, 1,
   'Enriched Flour Bleached (wheat flour, niacin, iron, thiamin mononitrate, riboflavin, folic acid), sugar, corn syrup, cocoa processed with alkali, leavening (baking soda, sodium aluminum phosphate, monocalcium phosphate, dicalcium phosphate), emulsified palm shortening (palm oil, propylene glycol mono- and diesters of fats and fatty acids, mono- and diglycerides, sodium stearoyl lactylate), dextrose, modified corn starch, corn starch, wheat starch, salt, cellulose gum, xanthan gum, natural and artificial flavor, water, butter (cream, salt), eggs, vanilla extract. Frosting: sugar, palm oil, water, corn syrup, canola oil, corn starch, cocoa (processed with alkali), and 2% or less of: mono- and diglycerides, natural and artificial flavor, modified corn starch, cellulose gel, salt, propylene glycol monostearate, carrageenan, polysorbate 80, potassium sorbate (preservative), cellulose gum, citric acid, sodium stearoyl lactylate, antioxidants (ascorbyl palmitate, mixed tocopherols, chamomile and rosemary extracts). Strawberry variety additionally contains: Red 40.',
   'Contains: wheat, milk, eggs. Strawberry variety contains Red 40 artificial color.',
   '[{"name":"Pastel","name_es":"Pastel","options":["Chocolate","Vainilla","Fresa","Funfetti","Red Velvet","Marmoleado","Limón"]},{"name":"Betún","name_es":"Betún","options":["Betún de Vainilla","Betún de Chocolate"]}]',
   '[]',
   '[{"inventoryItemId":"inv_betty_crocker_vanilla","qtyPerUnit":0.24},{"inventoryItemId":"inv_duncan_hines_chocolate","qtyPerUnit":0.24},{"inventoryItemId":"inv_betty_crocker_strawberry","qtyPerUnit":0.24},{"inventoryItemId":"inv_butter","qtyPerUnit":0.0625},{"inventoryItemId":"inv_eggs","qtyPerUnit":0.0625},{"inventoryItemId":"inv_vanilla","qtyPerUnit":0.025},{"inventoryItemId":"inv_frosting_vanilla","qtyPerUnit":0.083},{"inventoryItemId":"inv_frosting_chocolate","qtyPerUnit":0.083}]',
   '{"Cake":{"Chocolate":["inv_duncan_hines_chocolate"],"Vanilla":["inv_betty_crocker_vanilla"],"Strawberry":["inv_betty_crocker_strawberry"],"Funfetti":["inv_betty_crocker_vanilla"],"Red Velvet":["inv_duncan_hines_chocolate"],"Marble":["inv_duncan_hines_chocolate"],"Lemon":["inv_betty_crocker_vanilla"]},"Frosting":{"Vanilla Buttercream":["inv_frosting_vanilla"],"Chocolate Buttercream":["inv_frosting_chocolate"]}}',
   75, 1, 0);

-- ── Customer: Judy Vanderstelt (from website order #19, 2026-07-18) ──────────
INSERT OR IGNORE INTO customers (id, name, phone, email, notes, created_at, active, phone_normalized)
VALUES ('cust_judyvanderstelt', 'Judy Vanderstelt', '6162600225', NULL,
        'Website order 2026-07-18 (order #19, completed/paid via Stripe). Orders for The Content Cove (photography business). 2026-08-29 special order: 48 mini cupcakes delivered, 36 charged — service recovery for the July misunderstanding.',
        datetime('now'), 1, '6162600225');
