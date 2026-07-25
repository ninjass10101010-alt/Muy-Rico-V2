# Muy Rico — Spec C: Label Maker Reliability Overhaul

**Date:** 2026-07-24
**Status:** Ready for implementation plan (pending user spec review)
**Sequencing:** Spec C of 3 (label maker first, then Spec B dashboard visual overhaul). Spec A (operational fixes) already shipped.

## Goal

Make the label maker reliable enough to be the trusted tool it needs to be: swap the fragile `html-to-image` rasterization for **pdf-lib** vector PDFs (font-stable, instant, multi-label sheets), and fix the five correctness gaps that make auto-generated labels start non-compliant or drift over time.

## Approved decisions

| # | Decision |
|---|---|
| 1 | Export engine: **pdf-lib** (client-side, vector PDF, embedded fonts). Replace `html-to-image` + `jsPDF` rasterization. |
| 2 | Bundle the two brand fonts (Cormorant Garamond + Quicksand) as `.ttf` locally so exports never depend on Google Fonts CORS/woff2 issues. The 6 other FONT_CHOICES fall back to pdf-lib StandardFonts (Helvetica) with a one-line console note. |
| 3 | Avery multi-label sheets: render a real multi-page PDF with labels placed on a letter-size sheet at published Avery grid coordinates. Single label = one-page PDF. |
| 4 | Wire up `composeLabelFromRecipe` (currently dead code) so auto-generated labels compose ingredients by recipe weight order, not verbatim copy. |
| 5 | Fix auto-generated labels starting non-compliant: populate `net_weight_us` from the product (needs a product field or a sensible default), set `allergen_tags` from the product's allergen text, set `no_allergens_confirmed` when appropriate. |
| 6 | Snapshot `bestByDate` at generation time (store the computed date on the label row), stop daily drift. |
| 7 | Fix `LabelProjects` thumbnail storm: lazy-generate thumbnails (on scroll-into-view, not on mount) or switch to lightweight SVG previews. |
| 8 | Fix order-filter matching: align the label-name convention (`MR-{orderId}`) with the `filterByOrder` value (Orders page sets `labelFilter = order.id` not `orderNumber`). |

## Non-goals

- No redesign of the label canvas editor itself (drag/resize/rotate stays). Chrome reskin happens in Spec B.
- No new label shapes or element types.
- No server-side rendering (pdf-lib runs in the browser).
- No changes to the NutritionFactsPanel HTML rendering for the editor preview; only the pdf-lib rendering of the NFP is new.

## 1. Export engine: pdf-lib

### 1.1 New module: `utils/labelExport.ts`

A pure-function module that takes a `LabelTemplate` + business profile and returns `Uint8Array` PDF bytes. No React, no DOM.

```
export async function renderLabelPdf(label: LabelTemplate, opts: { sheet?: AverySheet; copies?: number }): Promise<Uint8Array>
```

**Coordinate mapping:** the editor uses normalized 0..1 coordinates with `fontSize` in `cqw` (container query width = % of label width). pdf-lib uses points. Conversion:
- Label dimensions in inches → page size in points (1 inch = 72 pt).
- Element `x,y,w,h` (0..1) → points: `x * pageW`, `(1 - y - h) * pageH` (flip Y axis: editor top-left origin → PDF bottom-left origin).
- `fontSize` in cqw → points: `fontSize / 100 * pageW`.

**Element rendering** (mirrors `LabelElementView.tsx` field mapping):
- `text` fields: `page.drawText(content, { x, y, size, font, color, rotate })`. Word-wrap via `font.widthOfTextAtSize`.
- `logo`: if `logoImage` is a data URL or R2 URL, fetch bytes → `embedPng`/`embedJpg` → `drawImage`. If emoji, draw as text (best-effort; emoji in PDF is unreliable — fall back to the brand "MR" monogram or skip).
- `qr`: generate QR as PNG via `qrcode` library (server-compatible, no DOM) → `embedPng` → `drawImage`.
- `divider`/`line`: `page.drawLine({ start, end, thickness, color })`.
- `rect`/`circle`: `page.drawRectangle` / `page.drawEllipse`.
- `nfp`: draw the FDA nutrition facts table as rectangles + text (fixed structure, ~30 draw calls; values from `nfpData`).

**Fonts:** load bundled TTFs at module init:
```ts
import cormorantBytes from '../assets/fonts/CormorantGaramond-Regular.ttf';
import cormorantBoldBytes from '../assets/fonts/CormorantGaramond-Bold.ttf';
import quicksandBytes from '../assets/fonts/Quicksand-Regular.ttf';
import quicksandBoldBytes from '../assets/fonts/Quicksand-SemiBold.ttf';
```
Register via `pdfDoc.registerFontkit(fontkit)` + `pdfDoc.embedFont(bytes)`. Map FONT_CHOICES → embedded font or `StandardFonts.Helvetica`.

**Color parsing:** hex `#1e4636` → `rgb(r/255, g/255, b/255)`. Handle `rgba(...)` strings too.

### 1.2 Avery sheet layout

`AverySheet` presets with published dimensions (letter 8.5×11"):

| Preset | Label W×H | Cols×Rows | Left margin | Top margin | Gap |
|---|---|---|---|---|---|
| single | label W×H | 1×1 | — | — | — |
| 5164 | 3.33×4 | 2×3 | 0.156" | 0.5" | 0.25" H, 0" V |
| 5163 | 4×2 | 2×4 | 0.156" | 0.5" | 0.19" H, 0" V |
| 8163 | 4×2 | 2×4 | 0.156" | 0.5" | 0.19" H, 0" V |

Multi-label PDF: one letter-size page per sheet-fill; place each label copy at its grid cell. `copies` param fills the sheet left-to-right, top-to-bottom.

### 1.3 Replace export functions in LabelDesigner

Replace `exportPng`, `exportJpg`, `exportPdf`, `printLabel` with calls to `renderLabelPdf`:
- **Download PDF:** `renderLabelPdf(label, {})` → download as `MR-label-{name}.pdf`.
- **Print:** `renderLabelPdf(label, { sheet: averyPreset })` → open in hidden iframe → `iframe.contentWindow.print()`. (Print from a real PDF = vector, font-stable, correct multi-label layout.)
- **Preview thumbnail (LabelProjects):** `renderLabelPdf` → render first page to a canvas via `pdf-lib` + `pdfjs-dist` OR keep a lightweight SVG preview. (Decision: SVG preview — cheaper, no rasterization.)

### 1.4 Dependencies

- Add: `pdf-lib`, `@pdf-lib/fontkit`, `qrcode` (for QR generation without DOM).
- Remove (eventually): `html-to-image`, `jsPDF` — keep until the new path is verified, then remove.

## 2. Fix: wire up `composeLabelFromRecipe`

`utils/label.ts` already has `composeLabelFromRecipe(product, inventory)` that sorts ingredients by weight and builds allergen tags. It's currently dead code — the worker (`api.js:1748-1749`) copies `product.ingredients`/`product.allergens` verbatim.

**Change in `api.js` `generateLabelsForOrder`:** before creating the label, if the product has a `recipe` array, call a server-side equivalent of `composeLabelFromRecipe` (port the ~86 lines of TS to JS in the worker, or fetch the composed string from the admin). Simpler: port the function to `orders/workers/labelCompose.js` and require it. Use the composed ingredients string + allergen tags when available; fall back to verbatim copy if the product has no recipe.

## 3. Fix: auto-generated labels start non-compliant

In `generateLabelsForOrder` (`api.js:1759-1801`):
- `net_weight_us`: add a `net_weight` column to products? No — simpler: derive from the product's `description` (no), or set a default `''` and surface a prominent "set net weight" prompt in the compliance checker (already flags it). **Decision:** leave `net_weight_us` empty in auto-generation (the compliance checker already flags it); the improvement is to make the flag prominent and the fix path easy (one-click "set weight" in the compliance panel). No schema change.
- `allergen_tags`: parse the product's `allergens` text into tags using the same `MAJOR_ALLERGEN_TAGS` mapping (port to the worker). Set `allergen_tags` as a JSON array. Set `no_allergens_confirmed = 0` (force the owner to confirm).
- `food_coloring` disclosure: already handled (`api.js:1747-1757`). Keep.

## 4. Fix: `bestByDate` drift

Currently `LabelCanvas.tsx:53-54` computes `bestByDate` from `bestByDays` at render time → the date shifts daily. **Fix:** snapshot the date at generation time. Add a `best_by_date` TEXT column to `label_templates` (migration `0021`). In `generateLabelsForOrder`, compute `bestByDate = today + bestByDays` and store it. In `LabelCanvas`, use the stored `best_by_date` if present; fall back to computed for legacy labels.

## 5. Fix: LabelProjects thumbnail storm

Replace the per-card `toPng` on mount with a **lazy SVG preview**:
- A lightweight `LabelPreviewSVG` component that renders the label's elements as SVG `<text>`/`<rect>`/`<image>` at a small viewport (no rasterization, instant).
- Generate the real PNG thumbnail only on hover or when explicitly requested.
- Remove the `toPng` call from `LabelCard` mount.

## 6. Fix: order-filter matching

`Orders.tsx:282` sets `labelFilter = selected.orderNumber` (human-readable). Labels are named `MR-{numeric id}`. **Fix:** set `labelFilter = String(selected.id)` (the numeric DB id) so `name.includes(filterByOrder)` matches `MR-42`. One-line change in `Orders.tsx`.

## 7. Migration `0021_label_best_by_date.sql`

```sql
ALTER TABLE label_templates ADD COLUMN best_by_date TEXT;
```

## 8. Verification

1. **Unit (local):** `renderLabelPdf` with a fixture label → assert PDF bytes are non-empty, page count matches (single=1, 5164=1 page with 6 slots). Use `pdf-lib`'s `PDFDocument.load` to re-parse.
2. **Visual:** render a few real labels (Conchas, Custom Cake with NFP, Cupcakes with flavors) → open the PDF → confirm fonts, text wrapping, QR code, NFP table, colors, disclaimer 11pt.
3. **Avery sheet:** 5164 preset → 6 labels on a letter page, correct grid positions.
4. **Print:** open the PDF in the browser's print dialog → single label + multi-label sheet print correctly.
5. **Auto-generation:** create an order with a recipe-linked product → verify label has composed ingredients (by weight), allergen tags, snapshot best-by date.
6. **LabelProjects:** open the page → no thumbnail storm (instant SVG previews), no console errors.
7. **Compliance:** auto-generated label compliance score (net weight still flags, allergen tags populated, best-by date stable).

## 9. Deploy order

1. Migration `0021` (local → remote).
2. Deploy API worker (labelCompose port + auto-gen fixes).
3. Rebuild admin SPA (pdf-lib export + LabelPreviewSVG + order-filter fix) + deploy assets.
4. Verify live: generate labels from a real order, download PDF, print a 5164 sheet.
