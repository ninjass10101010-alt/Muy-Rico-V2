# Menu Pack Pricing — 4 / 6 / 12 Packs with Volume Discounts

Date: 2026-07-31
Status: Approved (user confirmed pricing structure, single-item removal, cupcake/pie/tortilla exclusions)

## Goal

Standardize the online menu so every item sold by the piece offers the same
pack ladder — **4, 6, 12** — with volume discounts (more = cheaper per unit).
Items whose recipes don't allow singles keep only packs (no Single option).

## Decisions (confirmed with owner)

| Product | Category | Base price | Packs (all prices USD) |
|---|---|---|---|
| Cinnamon Rolls (`prod_mrwvp8n0`) | Cinnamon Rolls | $4 | 4/$16 · 6/$22 (Save $2) · 12/$40 (Save $8) |
| Conchas (`prod_conchas`) | Bread | $4 | 4/$16 · 6/$22 (Save $2) · 12/$40 (Save $8) |
| Chocolate Chip Coqui (`prod_cookie`) | Cookies | $4 | 4/$16 · 6/$22 (Save $2) · 12/$40 (Save $8) |
| Bolillos (`prod_bolillos`) | Bread | $2 | 4/$8 · 6/$11 (Save $1) · 12/$20 (Save $4) |
| Empanadas (`prod_empanadas`) | Bread | $3 | 4/$12 · 6/$15 (Save $3) · 12/$28 (Save $8) |
| Cakepops (`prod_cakepop`) | Cakepops | $3 | 4/$12 · 6/$15 (Save $3) · 12/$28 (Save $8) |

- **No Single option** on the six products above — recipes don't allow
  individual sales; smallest purchase is a pack of 4.
- **Unchanged:** Coqui Pie ($25 whole, single item), Tortillas (1/2/3 dozen),
  Cupcakes (base 6 @ $18, dozen @ $30 Save $6 — already discounted).
- Mini Cinnamon Rolls stays in DB but hidden (`show_online = 0`).

## Implementation

1. Migration `orders/migrations/0029_menu_packs.sql` — UPDATE `pack_sizes`
   (JSON, bilingual labels + "Save $" badges) on the six products; also backfill
   missing Spanish name/description for Cinnamon Rolls.
2. Apply via `wrangler d1 execute muy-rico-orders --remote --file ...`.
3. Align static fallback tiles in `order.html` with the new packs (fallback
   shows only when the products API is unreachable).
4. Verify `/api/products` returns the new `pack_sizes`; verify tile renders
   first pack (4) as the default selection (order.html treats `pack_sizes[0]`
   as the default).

## Pack JSON shape (per product price tier)

```json
[
  {"id":"4-pack","label":"Pack of 4","label_es":"Paquete de 4","price":16,"qty":4,"unit_label":"$4.00 ea","unit_label_es":"$4.00 c/u"},
  {"id":"half-dozen","label":"Half Dozen (6)","label_es":"Media Docena (6)","price":22,"qty":6,"badge":"Save $2","badge_es":"¡Ahorra $2!","unit_label":"$3.67 ea","unit_label_es":"$3.67 c/u"},
  {"id":"dozen","label":"Dozen (12)","label_es":"Docena (12)","price":40,"qty":12,"badge":"Save $8","badge_es":"¡Ahorra $8!","unit_label":"$3.33 ea","unit_label_es":"$3.33 c/u"}
]
```

## Risks / Notes

- Owner can later edit packs from the admin dashboard (Products page manages
  `pack_sizes`); migration is the source of truth for now.
- No frontend code changes needed for dynamic tiles — order.html already
  renders arbitrary `pack_sizes` with badges and unit labels.
