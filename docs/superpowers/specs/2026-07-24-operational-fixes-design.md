# Muy Rico — Spec A: Operational Fixes (Menu, Orders, Payments)

**Date:** 2026-07-24
**Status:** Approved by owner, ready for implementation plan
**Sequencing:** Spec A of 2. Spec B (dashboard UX overhaul) follows in its own cycle.

## Goal

Six operational fixes across D1, the orders API, the admin dashboard, and the public order page, plus the data-level completion of the emoji-to-icon swap (the root cause of "website not updating": live product icons and cart toasts render from `products.emoji` in D1, not from static files).

## Approved decisions (from owner Q&A)

| # | Decision |
|---|---|
| 1 | Hidden products: "Show on website" toggle (default ON). OFF = hidden from public menu, homepage picks, and gallery; still listed in admin New Order modal with a "Hidden" badge. |
| 2 | Payment edit: any order (manual or website), order detail gets Edit on the Payment line. Updates the order + syncs the latest active `payments` row. Receipts are never auto-resent. |
| 3 | Manual orders get pack-size pills identical to the website (label + unit price + Save badge). Price comes from the pack; item name follows the website convention `Name (PackLabel) (Flavor: X)`. |
| 4 | Cupcakes: add `Dozen (12)` pack at $30, badge "Save $6" ($2.50 ea). Base pack becomes `Half Dozen (6)` $18. |
| 5 | Mini Cinnamon Rolls: new separate product. Packs: `Half Dozen (6)` $12 ($2.00 ea), `Dozen (12)` $20, badge "Save $4" ($1.67 ea). |
| 6 | Flavors: Strawberry, Funfetti, Red Velvet, Marble, Lemon appended to the Cake flavor group of BOTH `prod_cupcakes` and `prod_custom_cake`. Existing options untouched, no price change. |
| 7 | Dashboard redesign = full UX overhaul, but as Spec B, after Spec A ships. |

## Non-goals

- No dashboard visual redesign (Spec B).
- No changes to existing prices, existing flavor options, descriptions, or legal copy (append-only).
- No refunds/charges: payment edits are record corrections only ("does not move money").
- No public-site file changes to `index.html` / `order.html` / `gallery.html` (they consume the filtered endpoints as-is).

## 1. Schema — migration `0019_show_online.sql`

```sql
ALTER TABLE products ADD COLUMN show_online INTEGER NOT NULL DEFAULT 1;
```

Order items keep the current "name with pack/flavor baked in" string convention used by the website. No other structural changes.

## 2. API (`orders/workers/api.js`)

| Endpoint | Change |
|---|---|
| `GET /api/products` (public) | `WHERE active = 1 AND show_online = 1` |
| `GET /api/products?include_hidden=1` (auth) | `WHERE active = 1` (dashboard sees all sellable products) |
| `POST /api/products`, `PATCH /api/products/:id` | accept `show_online` (default true), include in row mapping |
| `GET /api/gallery` | exclude photos whose product has `show_online = 0` (hides albums + order-page "View album" links automatically) |
| `PATCH /api/orders/:id` | extend to accept `payment_sub_method`; after a `payment_method` change, sync the latest active `payments` row for that order (`UPDATE payments SET method = ? WHERE id = (latest active row for order)`); return the updated order |

## 3. Admin dashboard (`home-bakery-management-system/`)

- **`utils/api.ts` / StoreContext:** product fetches use `?include_hidden=1`.
- **`components/ProductIcon.tsx` (new):** renders `<img src={emoji}>` when the emoji field ends in `.svg`, emoji text otherwise. Used wherever `p.emoji` / `i.emoji` prints (OrderModal product select + item rows, Orders detail items, Products list).
- **`pages/Products.tsx`:** "Show on website" toggle in the product editor (default ON); "Hidden" badge on hidden products in the list.
- **`components/OrderModal.tsx`:**
  - Product select includes hidden products with a "Hidden" badge.
  - When the picked product has `pack_sizes`, render pill buttons matching the website (label + unit price + badge). First pack preselected. Item price = pack price; item name = `Name (PackLabel)` + flavor note, identical to website orders.
  - Qty stepper counts packs.
- **`pages/Orders.tsx`:** order detail Payment line gets an Edit action → small modal (method dropdown from `profile.acceptedMethods` minus `ONLINE_ONLY`, optional sub-method text) → `PATCH` with `payment_method` (+ `payment_sub_method`) → helper copy: "Records only; does not charge or refund."

## 4. Menu data — migration `0020_menu_updates.sql`

Idempotent: fixed ids, append-only-if-missing, `INSERT OR REPLACE` for the new product.

**4.1 Cupcakes (`prod_cupcakes`)** — set `pack_sizes`:
```json
[
  {"id":"half-dozen","label":"Half Dozen (6)","label_es":"Media Docena (6)","price":18,"qty":6,"unit_label":"$3.00 ea","unit_label_es":"$3.00 c/u"},
  {"id":"dozen","label":"Dozen (12)","label_es":"Docena (12)","price":30,"qty":12,"badge":"Save $6","badge_es":"¡Ahorra $6!","unit_label":"$2.50 ea","unit_label_es":"$2.50 c/u"}
]
```

**4.2 Flavors** — `prod_cupcakes` and `prod_custom_cake`, Cake group (`name:"Cake"`, `name_es:"Bizcocho"`):
`options` become `["Chocolate","Vanilla","Strawberry","Funfetti","Red Velvet","Marble","Lemon"]` (append the five if missing; Frosting group untouched).

**4.3 New product `prod_mini_cinnamon_rolls`:**
| Field | Value |
|---|---|
| name / name_es | Mini Cinnamon Rolls / Mini Roles de Canela |
| category | Cinnamon Rolls |
| price | 12 (base = first pack) |
| sku | MR-MCR |
| emoji | cinnamon-roll.svg |
| description | "Bite-size cinnamon rolls, soft and swirled with cinnamon sugar. Sold by the half dozen or by the dozen." |
| description_es | "Roles de canela en tamaño mini, suaves y llenos de azúcar y canela. Por media docena o por docena." |
| pack_sizes | `[{"id":"half-dozen","label":"Half Dozen (6)","label_es":"Media Docena (6)","price":12,"qty":6,"unit_label":"$2.00 ea","unit_label_es":"$2.00 c/u"},{"id":"dozen","label":"Dozen (12)","label_es":"Docena (12)","price":20,"qty":12,"badge":"Save $4","badge_es":"¡Ahorra $4!","unit_label":"$1.67 ea","unit_label_es":"$1.67 c/u"}]` |
| flags | active=1, show_online=1, featured=0, auto_generate_label=1, display_order=100, image_url NULL (owner uploads photo later) |
| ingredients / allergens | empty strings; **owner must fill before generating labels for this product** |

**4.4 Emoji → SVG map (`UPDATE products SET emoji`):**
`prod_cookie`→cookies.svg, `prod_conchas`→conchas.svg, `prod_bolillos`→bolillos.svg, `prod_tortillas`→tortilla.svg, `prod_empanadas`→empanada.svg, `prod_cakepop`→cakepop.svg, `prod_custom_cake`→cake.svg, `prod_cupcakes`→cupcake.svg, `prod_mrzgdqza` (Coqui Pie)→cookies.svg, `prod_mrwvp8n0` (Cinnamon Rolls)→cinnamon-roll.svg, `prod_mini_cinnamon_rolls`→cinnamon-roll.svg.

Public `order.html` already renders `.svg` toast icons (deployed). Admin coverage is via ProductIcon (Section 3).

## 5. New asset: `cinnamon-roll.svg`

Same illustration family as `bolillos.svg` (140×100 viewBox, golden radial-gradient crust, texture dots, soft shadow): a round swirl roll with a visible cinnamon spiral. Served from the site root like the other product icons.

## 6. Edge cases

- Hidden + featured: public endpoint filters it, so homepage picks cannot leak hidden products. Existing orders are name-string snapshots; history untouched.
- Hidden + gallery photos: excluded by the gallery endpoint filter.
- Payment edit on an order with no `payments` row: updates the order only. On Stripe-paid orders: records only, no money moves (helper copy in modal).
- OrderModal: first pack preselected (matches website `selectPack` behavior).
- `show_online` missing from an admin payload (older client): defaults to visible, so nothing can accidentally hide.

## 7. Verification

**Local:**
1. `npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --local --file=orders/migrations/0019_show_online.sql` and `0020_menu_updates.sql`
2. `wrangler dev -c orders/wrangler.toml`: assert public `/api/products` excludes a hidden product, `?include_hidden=1` includes it; `/api/gallery` excludes its photos; `PATCH /api/orders/:id` with a new `payment_method` updates the order and the latest `payments` row.
3. `npm run build` (admin) + Playwright: toggle persists; Hidden badge; pack pills price correctly (`Cupcakes Dozen = $30`); payment edit modal saves and the Payments page reflects it.

**Prod:**
1. `npx wrangler deploy -c orders/wrangler.toml`
2. `npx wrangler d1 execute ... --remote --file=0019...sql` then `0020...sql`
3. Rebuild admin + `npx wrangler versions upload --name muyrico --assets . --compatibility-date 2025-03-21` → `versions deploy <ID>@100%`
4. Live checks: cupcakes tile shows Half Dozen/Dozen pills; 5 new flavors on cupcakes + custom cake; Mini Cinnamon Rolls tile present with packs; add-to-cart toasts render SVG icons; hidden product absent from menu but present in admin New Order modal; payment edit persists.

## 8. Deploy order (important)

1. Deploy API worker; apply migration `0019` (local verified first, then `--remote`).
2. Rebuild + deploy the admin SPA (ProductIcon must be live before DB emoji become filenames).
3. Apply migration `0020` (`--remote`).
4. Verify live. The public site needs no redeploy.
