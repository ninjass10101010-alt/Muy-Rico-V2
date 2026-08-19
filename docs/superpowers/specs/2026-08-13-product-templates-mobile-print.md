# Product Label Templates + Mobile Print Reliability — Design

**Date:** 2026-08-13
**Status:** Approved by user (implementation in progress)
**Sequencing:** Ship Phase 1 (mobile print) first, then Phase 2 (product templates).

## Problem

1. **Mobile download/print is unreliable.** `LabelDesigner.tsx:2` rasterizes the preview via `html-to-image` for PNG/JPG — breaks on iPhones (large-canvas OOM, CORS-tainted Google Fonts, flaky `<a download>` on iOS). Munbyn printers have no browser SDK; the supported path is: PDF → iOS share sheet → Munbyn Print App or AirPrint.
2. **Product designs don't reach order labels.** `generateLabelsForOrder` (`api.js:2318`) hard-codes styling; a user-designed "Cupcakes" label is never applied to order auto-labels. There is no template-per-product concept; `label_templates` is one flat list mixing designs and `MR-{orderId}` labels.

## Decisions

| # | Decision |
|---|---|
| 1 | PNG/JPG export stays **desktop-only** (≥1024px). Mobile shows **Save | PDF | Open & Print | Share**. |
| 2 | Mobile print = open the PDF blob in a new tab (native iOS PDF viewer → share → AirPrint/Munbyn). Share = Web Share API with `File`. No Munbyn deep-link scheme (undocumented; share sheet already lists the app). |
| 3 | New `template_kind` column: `'product'` (one design per product), `'order'` (auto-generated per-order instances), `'custom'` (manual). New `product_id` column links both to `products.id`. Backfill existing `MR-% - %` labels → `'order'`. |
| 4 | Auto-generation **clones the product template** (design + elements + content base), overriding only order-specific data: `product_name` (flavor-inclusive item name), `price`, `best_by_date`, food-coloring disclosure. Falls back to today's hard-coded defaults when no product template exists. |
| 5 | Product templates are **auto-created only when the user opens them** (Products → Label button, or the "Load from product" select). |
| 6 | LabelDesigner saved-templates list splits into **Product templates**, **Custom**, and collapsed **Order labels**. "Duplicate as new" produces a `custom` copy. |
| 7 | Delete `LabelProjects.tsx` (dead code, never imported). |

## 1. Migration `0039_product_label_templates.sql`

```sql
ALTER TABLE label_templates ADD COLUMN template_kind TEXT DEFAULT 'custom';
ALTER TABLE label_templates ADD COLUMN product_id TEXT;
CREATE INDEX idx_label_templates_kind ON label_templates(template_kind, active);
UPDATE label_templates SET template_kind = 'order' WHERE name LIKE 'MR-% - %';
```

## 2. Worker changes (`orders/workers/api.js`)

- `LABEL_FIELDS` (+ `template_kind`, `product_id`) → create/update/list handle them via existing `getBodyField` / `snakeToCamelObject` plumbing. Create defaults `template_kind` → `'custom'` when absent.
- `generateLabelsForOrder`: after product resolution, `SELECT * FROM label_templates WHERE template_kind='product' AND product_id=? AND active=1 LIMIT 1`. If found, clone design/content fields with order-specific overrides; insert with `template_kind='order'`, `product_id`. Else current behavior.

## 3. Frontend

- `types.ts` / `utils/api.ts`: `templateKind`, `productId` on `LabelTemplate` + `ApiLabelTemplate`/`LabelTemplateCreate`.
- `StoreContext.tsx` `apiToLabelTemplate`: map the two fields.
- `labelExport.ts`: `openPdfInNewTab(bytes, win?)` (popup-blocker-safe: caller opens window synchronously in the click handler, sets `location.href` after async render; fallback `downloadPdf`), `sharePdf(bytes, name)` (Web Share API `File`; returns false when unsupported).
- `LabelDesigner.tsx`:
  - Mobile export bar (`lg:hidden`): Save | Save PDF | Open & Print | Share. Desktop (`hidden lg:grid`): unchanged 5 buttons.
  - `filterByProduct` prop: auto-select the product's template; if none, show "Create template" banner (creates `templateKind:'product'` from product data). "Load from product" select switches to (and creates if needed) that product's template.
  - Sectioned saved list: Product templates / Custom / Order labels (collapsed with count).
  - `normalizeLabel` preserves `templateKind`/`productId`; `newTemplate` sets `custom`.
  - One-time mobile tip banner (localStorage `muyrico.printtip.v1`).
- `App.tsx`: `labelProductId` state (cleared on navigation away from labels); `Products.tsx` "Label" button opens the designer filtered to that product.

## 4. Verification

1. `npm test` — existing 387-line `labelExport` suite + new helper tests (mock `navigator.share` / `window.open`).
2. Local `wrangler dev` + vite: migration applies; create product template → place order with that product → order label inherits design, correct flavor/price/best-by.
3. iPhone Safari + Chrome: PDF saves/opens; Open & Print shows PDF viewer + share sheet; Share lists Munbyn Print App.
4. Desktop: PNG/JPG/PDF/Print unchanged; `compliance.test.ts` green.

## 5. Deploy order

1. Migration 0039 (local → remote).
2. Deploy API worker.
3. Rebuild admin SPA (`npm run build` → `postbuild.sh` copies to `../admin/index.html`) + deploy assets.
