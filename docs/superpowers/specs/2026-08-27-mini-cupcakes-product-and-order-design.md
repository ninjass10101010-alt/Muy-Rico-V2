# Mini Cupcakes Product + Judi Vanderstelt Special Order — Design

**Date:** 2026-08-27
**Status:** Approved (user confirmed all details through brainstorming dialogue)
**Depends on:** existing Orders Worker + D1 (`muy-rico-orders`), admin SPA, Cloudflare Access auth.

## 1. Background

Muy Rico wants to start selling **mini cupcakes**, made with:

- **Vanilla:** Betty Crocker Super Moist Vanilla Cake Mix (already in inventory: `inv_betty_crocker_vanilla`)
- **Chocolate:** Duncan Hines Perfectly Moist Dark Chocolate Fudge Cake Mix (**not** yet in inventory)

The first order is a special one for **Judy Vanderstelt** (website order #19, 2026-07-18, had a fulfillment misunderstanding): she receives **48 mini cupcakes** (24 vanilla + 24 chocolate) but is **charged for only 36** → $72 instead of $96. The order is for her photography business, **The Content Cove**; the invoice is made out to Judy personally. Deliverables include the **invoice** and **package labels** for this order.

### Confirmed facts from the live system (remote D1, 2026-08-27)

- `prod_cupcakes` ("Cupcakes (6)") exists with Spanish-first flavor groups:
  `[{"name":"Pastel","options":["Chocolate","Vainilla","Fresa","Funfetti","Red Velvet","Marmoleado","Limón"]},{"name":"Betún","options":["Betún de Vainilla","Betún de Chocolate"]}]`
  and an English-keyed `flavor_deduction_map` (Cake → BC mix ids, Frosting → Pillsbury frosting ids).
- No mini cupcake product and no Duncan Hines inventory item exist.
- Judy has **no customer record**; she exists only as order #19 (`customer_name = 'Judith A Vanderstelt'`, phone `6162600225`, `customer_id = NULL`). User confirmed her name is **Judy Vanderstelt**.
- BC Vanilla stock is **0.75 boxes** (reorder level 2). This order consumes ~0.48 box → owner warned to restock before Saturday.
- Migration 0011 convention: product ingredient labels list **raw sub-ingredients only, no brand names** (Michigan Cottage Food Law best practice). Inventory `ingredients_label` fields are likewise brand-free.
- Duncan Hines Perfectly Moist Dark Chocolate Fudge found on Open Food Facts: barcode **0644209307562**, brand owner Pinnacle Foods Group LLC, full ingredient list (see §5.1).

## 2. Goals

1. Add the Duncan Hines chocolate mix to inventory with correct brand-free ingredient label, barcode, and its own ingredient group.
2. Add a **Mini Cupcakes (12)** product with correct recipe, flavor deduction map, and brand-free ingredient label.
3. Create a customer record for Judy Vanderstelt and link the new order to it.
4. Create the special order: 48 mini cupcakes, subtotal $96, discount $24, total $72, unpaid, pickup Sat 2026-08-29 9:00 AM, notes "Order for business: The Content Cove."
5. Produce a correct **invoice** (prints subtotal/discount/notes; uses invoice wording since the order is unpaid) and **labels** (one per flavor line) for the order.

## 3. Non-goals

- Fixing pre-existing deduction quirks on `prod_cupcakes` (per-flavor vs all-lines deduction; pack-awareness). Mini cupcakes are designed to deduct correctly; regular cupcakes keep their current behavior.
- Volume-discount pack pricing for minis (flat $2/cupcake, dozens only).
- Product photo for mini cupcakes (uses `cupcake.svg` icon; owner can upload later).
- Email-sending the invoice to Judy (no email on file); invoice is generated for print from the dashboard.

## 4. Architecture fit (verified)

### 4.1 Why "Mini Cupcakes (12)" has no pack_sizes

The two inventory engines interpret `recipe.qtyPerUnit` differently:

- **Deduction** (`orders/workers/api.js:703 deductOrderInventory`): `used = qtyPerUnit × item.qty` where `item.qty` is the number of *packs* ordered. Not pack-aware — it cannot distinguish a 6-pack line from a 12-pack line.
- **Prep list** (`src/utils/prepList.ts`): `packMultiplierFor(item, product)` matches the line's price against `pack_sizes` to recover the per-unit count, then `amount = item.qty × multiplier × qtyPerUnit` — i.e. it assumes `qtyPerUnit` is per *single piece*.

With multiple pack sizes, one engine is always wrong. With **no pack_sizes and base unit = one dozen ($24)**, both engines agree: `packMultiplierFor` returns 1 (no packs), so both compute `qty × qtyPerUnit` with `qty` = number of dozens. This mirrors the original "Cupcakes (6)" base-unit pattern. Owner decision: **minis are sold by the dozen only, no discount tiers**.

### 4.2 Recipe quantities

Owner yields **~0.3 oz dry mix per mini cupcake** → a 15.25 oz box makes ~50 minis → **0.02 box per mini → 0.24 box per dozen**. A dozen minis uses roughly the same batter as a half-dozen regular cupcakes, so the non-mix quantities mirror `prod_cupcakes`' per-6-pack values.

### 4.3 Flavor-aware deduction

`deductOrderInventory` reads `item.flavorNote` from `items_json`; when it matches options in the product's `flavor_deduction_map`, only the mapped inventory ids are deducted (other recipe lines are skipped). The website cart and admin OrderModal do **not** send `flavorNote` (it is only embedded in the item name), so their orders deduct all recipe lines — pre-existing behavior, unchanged. The new order is created with an explicit `flavorNote` per line so it deducts exactly the right mix per flavor.

### 4.4 Order creation path

`POST /api/orders` is **public** (no Access auth; actor becomes `website`) and triggers `notifyOrderCreated` (Telegram/email to owners) and `generateLabelsForOrder` (auto label per item for products with `auto_generate_label = 1`). For `source: 'in-person'`, a client-provided `customer_id` is honored. This is the creation path used (labels + audit events come free), followed by a D1 touch-up of `created_by`.

### 4.5 Receipts / invoice

- `buildReceiptHtml` (`api.js:947`) renders item rows + total but currently: (a) never renders `notes`, (b) never renders subtotal/discount, (c) always uses paid wording ("RECEIPT", "TOTAL PAID", "Your payment was received"). Extended per §5.2.
- Receipt endpoints (`/api/receipts/*`, `/api/orders/:id/generate-receipt`) are admin-auth-only, unreachable from the CLI. The receipt **row** is therefore inserted via D1 exactly mirroring `logReceiptWithId` (`api.js:1162`), with `status = 'printed'`. The HTML renders dynamically from the live order when the owner opens it from the dashboard (Receipts → view/print), so the enhanced template applies.

## 5. Changes

### 5.1 Migration `orders/migrations/0042_mini_cupcakes.sql`

Run locally and remote:
`npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml [--remote] --file=orders/migrations/0042_mini_cupcakes.sql`

**a) Duncan Hines inventory item + ingredient group** (pattern of 0041 backfill: 1:1 group):

```sql
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
```

Notes: starting quantity **3 boxes** (owner assumption — covers the 0.48 box this order uses and stays above reorder level 2; adjustable later via dashboard/scan). `supplier` left NULL (filled when stocked). Barcode from Open Food Facts.

**b) Product `prod_mini_cupcakes`:**

```sql
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
   -- ingredients (brand-free, per 0011 convention; covers both mixes + add-ins + both frostings)
   'Enriched Flour Bleached (wheat flour, niacin, iron, thiamin mononitrate, riboflavin, folic acid), sugar, corn syrup, cocoa processed with alkali, leavening (baking soda, sodium aluminum phosphate, monocalcium phosphate, dicalcium phosphate), emulsified palm shortening (palm oil, propylene glycol mono- and diesters of fats and fatty acids, mono- and diglycerides, sodium stearoyl lactylate), dextrose, modified corn starch, corn starch, wheat starch, salt, cellulose gum, xanthan gum, natural and artificial flavor, water, butter (cream, salt), eggs, vanilla extract. Frosting: sugar, palm oil, water, corn syrup, canola oil, corn starch, cocoa (processed with alkali), and 2% or less of: mono- and diglycerides, natural and artificial flavor, modified corn starch, cellulose gel, salt, propylene glycol monostearate, carrageenan, polysorbate 80, potassium sorbate (preservative), cellulose gum, citric acid, sodium stearoyl lactylate, antioxidants (ascorbyl palmitate, mixed tocopherols, chamomile and rosemary extracts). Strawberry variety additionally contains: Red 40.',
   'Contains: wheat, milk, eggs. Strawberry variety contains Red 40 artificial color.',
   -- flavors: identical to live prod_cupcakes
   '[{"name":"Pastel","name_es":"Pastel","options":["Chocolate","Vainilla","Fresa","Funfetti","Red Velvet","Marmoleado","Limón"]},{"name":"Betún","name_es":"Betún","options":["Betún de Vainilla","Betún de Chocolate"]}]',
   '[]',
   -- recipe per DOZEN (base unit): 0.24 box mix; non-mix values mirror prod_cupcakes per-6-pack
   '[{"inventoryItemId":"inv_betty_crocker_vanilla","qtyPerUnit":0.24},
     {"inventoryItemId":"inv_duncan_hines_chocolate","qtyPerUnit":0.24},
     {"inventoryItemId":"inv_betty_crocker_strawberry","qtyPerUnit":0.24},
     {"inventoryItemId":"inv_butter","qtyPerUnit":0.0625},
     {"inventoryItemId":"inv_eggs","qtyPerUnit":0.0625},
     {"inventoryItemId":"inv_vanilla","qtyPerUnit":0.025},
     {"inventoryItemId":"inv_frosting_vanilla","qtyPerUnit":0.083},
     {"inventoryItemId":"inv_frosting_chocolate","qtyPerUnit":0.083}]',
   -- deduction map: mirrors prod_cupcakes, chocolate-family flavors -> Duncan Hines
   '{"Cake":{"Chocolate":["inv_duncan_hines_chocolate"],"Vanilla":["inv_betty_crocker_vanilla"],"Strawberry":["inv_betty_crocker_strawberry"],"Funfetti":["inv_betty_crocker_vanilla"],"Red Velvet":["inv_duncan_hines_chocolate"],"Marble":["inv_duncan_hines_chocolate"],"Lemon":["inv_betty_crocker_vanilla"]},"Frosting":{"Vanilla Buttercream":["inv_frosting_vanilla"],"Chocolate Buttercream":["inv_frosting_chocolate"]}}',
   75, 1, 0);
```

**c) Customer record:**

```sql
INSERT OR IGNORE INTO customers (id, name, phone, email, notes, created_at, active, phone_normalized)
VALUES ('cust_judyvanderstelt', 'Judy Vanderstelt', '6162600225', NULL,
        'Website order 2026-07-18 (order #19, completed/paid via Stripe). Orders for The Content Cove (photography business). 2026-08-29 special order: 48 mini cupcakes delivered, 36 charged — service recovery for the July misunderstanding.',
        datetime('now'), 1, '6162600225');
```

Idempotency: all inserts use `INSERT OR IGNORE` so re-running the migration is safe.

### 5.2 Worker change: invoice-ready `buildReceiptHtml` (`orders/workers/api.js:947`)

Single function edit; no signature change (still `(order, isEn)`; `order` already carries `notes`, `subtotal_cents`, `discount_cents`, `payment_status`).

1. **Payment-status-aware wording** — `isPaid = order.payment_status === 'paid'`, `isPartial = order.payment_status === 'partial'`:
   - Header: EN `RECEIPT` / `INVOICE`; ES `RECIBO` / `FACTURA` (paid vs not).
   - Intro note: paid → existing copy; unpaid → EN "Your order is confirmed. Payment is due at pickup." / ES "Tu pedido está confirmado. El pago se realiza al recoger."; partial → EN "Your order is confirmed. Deposit received — balance due at pickup." / ES equivalent.
   - Total label: paid → `TOTAL PAID` / `TOTAL PAGADO`; unpaid → `TOTAL DUE` / `TOTAL A PAGAR`; partial → `TOTAL` / `TOTAL`.
2. **Subtotal & discount rows** in the items table footer when `Number(order.discount_cents) > 0`: a `Subtotal` row (`subtotal_cents`, falling back to `total_cents + discount_cents` when subtotal is 0/missing) and a `Discount` row rendered as `−$24.00`, above the total row. EN/ES labels (`Subtotal`/`Descuento`).
3. **Notes row** in the meta table when `order.notes` is non-empty: label EN `Notes` / ES `Notas`, value HTML-escaped.

Existing paid receipts are byte-identical except the notes row (additive; notes were previously invisible).

Deploy after the edit: `npx wrangler deploy -c orders/wrangler.toml`.

### 5.3 Order creation — public `POST https://muy-rico-orders-api.bexgarcia0208.workers.dev/api/orders`

Payload (validated against `createOrder` requirements: `customer_name`, `pickup_date`, `items_json`, `payment_method` required; `status ∈ ALLOWED_STATUS`, `source ∈ ALLOWED_SOURCE`, `payment_status ∈ ALLOWED_PAYSTAT`):

```json
{
  "customer_name": "Judy Vanderstelt",
  "customer_id": "cust_judyvanderstelt",
  "phone": "6162600225",
  "pickup_date": "2026-08-29",
  "pickup_time": "09:00",
  "items_json": [
    {
      "name": "Mini Cupcakes (12) (Cake: Vanilla, Frosting: Vanilla Buttercream)",
      "name_en": "Mini Cupcakes (12) (Cake: Vanilla, Frosting: Vanilla Buttercream)",
      "name_es": "Mini Cupcakes (12) (Pastel: Vainilla, Betún: Betún de Vainilla)",
      "qty": 2, "price": 24,
      "productId": "prod_mini_cupcakes",
      "flavorNote": " (Cake: Vanilla, Frosting: Vanilla Buttercream)",
      "emoji": "cupcake.svg"
    },
    {
      "name": "Mini Cupcakes (12) (Cake: Chocolate, Frosting: Chocolate Buttercream)",
      "name_en": "Mini Cupcakes (12) (Cake: Chocolate, Frosting: Chocolate Buttercream)",
      "name_es": "Mini Cupcakes (12) (Pastel: Chocolate, Betún: Betún de Chocolate)",
      "qty": 2, "price": 24,
      "productId": "prod_mini_cupcakes",
      "flavorNote": " (Cake: Chocolate, Frosting: Chocolate Buttercream)",
      "emoji": "cupcake.svg"
    }
  ],
  "total_cents": 7200,
  "subtotal_cents": 9600,
  "discount_cents": 2400,
  "payment_method": "cash",
  "payment_status": "unpaid",
  "status": "pending",
  "notes": "Order for business: The Content Cove.",
  "source": "in-person",
  "language": "es"
}
```

Effects on creation: owner Telegram/email notification fires; two order labels auto-generate (`MR-<id> - Mini Cupcakes (12) (Cake: Vanilla…)` / `(Cake: Chocolate…)`) with the product's brand-free ingredients and $24.00 dozen price.

Post-creation D1 touch-up:

```sql
UPDATE orders SET created_by = 'bexgarcia0208' WHERE id = <new_order_id>;
```

(Public POST stamps `created_by = 'website'`; the order is owner-created.)

### 5.4 Invoice row (receipt with `status = 'printed'`)

Mirrors `logReceiptWithId` exactly (admin endpoint unreachable from CLI):

```sql
INSERT INTO receipts
  (id, order_id, order_number, customer_name, email, items_json, total_cents,
   payment_method, payment_sub_method, order_status, status, message_id, language, sent_at, created_at)
VALUES
  ('rcpt_<order_id>_<rand>', <order_id>, 'MR-<order_id>', 'Judy Vanderstelt', NULL,
   '<items_json from 5.3>', 7200, 'cash', NULL, 'pending', 'printed', NULL, 'es',
   datetime('now'), datetime('now'));
INSERT INTO order_events (order_id, actor, event) VALUES (<order_id>, 'system', 'receipt:printed');
```

Owner then opens the invoice from the dashboard (Receipts list → view/print); it renders in Spanish with: items 2×$24 + 2×$24, Subtotal $96.00, Descuento −$24.00, **TOTAL A PAGAR $72.00**, notes "Order for business: The Content Cove.", pickup 2026-08-29 09:00, status pending, payment cash.

## 6. Expected deduction on completion (reference)

When the owner marks the order completed (dashboard → `POST /api/orders/:id/deduct`), `flavorNote` matching deducts exactly:

| Inventory item | Amount |
|---|---|
| `inv_betty_crocker_vanilla` | 2 dozen × 0.24 = **0.48 box** (0.75 → ~0.27 left — restock!) |
| `inv_duncan_hines_chocolate` | 2 dozen × 0.24 = **0.48 box** (3 → 2.52 left) |
| `inv_frosting_vanilla` | 2 × 0.083 = 0.17 can |
| `inv_frosting_chocolate` | 2 × 0.083 = 0.17 can |

Butter/eggs/vanilla-extract lines are skipped by design of the flavor-map path (same behavior as `prod_cupcakes` today). The discount does not affect deduction — all 48 cupcakes are physical.

## 7. Testing & verification

1. **Local dry run (full flow):**
   - `npx wrangler d1 export muy-rico-orders -c orders/wrangler.toml --remote --output=/tmp/muyrico-backup.sql` then load into the local DB (`--local --file=…`) so local mirrors production schema+data.
   - Apply 0042 locally; start `npx wrangler dev -c orders/wrangler.toml` (localhost is treated as authenticated).
   - POST the §5.3 payload to `http://localhost:8787/api/orders` → expect `201 { ok, id }`.
   - `POST /api/orders/<id>/generate-receipt` → then `GET /api/receipts/<rid>/html` → assert HTML contains: `FACTURA`, `TOTAL A PAGAR`, `Subtotal $96.00`, `Descuento −$24.00` (or EN equivalents), notes line, both item rows.
   - Assert two `label_templates` rows named `MR-<id> - Mini Cupcakes (12) (…)` exist with the product's ingredients.
   - Assert inventory unchanged (deduction only on completion); optionally `POST /api/orders/<id>/deduct` and verify 0.48-box deltas.
2. **Remote verification (after real creation):** D1 SELECTs confirming the order row (totals 9600/2400/7200, customer_id linked, flavorNotes present), the two label rows, the receipt row, the customer row, and `GET /api/products` (public) includes `prod_mini_cupcakes`.

## 8. Deployment sequence

1. Edit `buildReceiptHtml` in `orders/workers/api.js`; run local dry run (§7.1).
2. `npx wrangler deploy -c orders/wrangler.toml` (template live before any receipt is generated).
3. Apply migration 0042 remote.
4. POST the order (public endpoint) → capture `<order_id>`.
5. D1 touch-ups: `created_by`, receipt row + event.
6. Remote verification (§7.2); report order id, invoice location (dashboard → Receipts), and label names to the owner.

Rollback: migration is additive (new rows only) — rollback = delete the product/inventory/group/customer rows if needed. Worker change is additive to a single function; revert = redeploy previous version. The order itself can be cancelled from the dashboard.

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Public POST fires owner notifications (Telegram/email) for an order they already know about | Acceptable — confirms creation; expected side effect |
| Labels show $24.00/dozen on a partially-complimentary order | Owner aware; can toggle price off per label in Label Studio |
| BC Vanilla already below reorder level (0.75 box) | Owner explicitly warned to restock before 2026-08-29 |
| Future website/admin orders for minis won't carry `flavorNote` → all recipe lines deduct (same quirk as regular cupcakes) | Documented; out of scope. Fix would be sending `flavorNote` from order.html/OrderModal |
| `auto_generate_label` re-composes the hand-written ingredients string if the product is later saved from the dashboard | Composed result draws from the same brand-free inventory labels — acceptable drift, same as all other products |
| Starting DH quantity (3 boxes) is an assumption | Flagged to owner; correctable via dashboard or barcode scan |

## 10. Out of scope / later

- Sending `flavorNote` from the website cart and admin OrderModal (would make per-flavor deduction work for all cupcake orders).
- Pack-aware deduction in `deductOrderInventory`.
- Mini cupcake product photo and homepage featuring.
- Emailing invoices to customers (Judy has no email on file).
