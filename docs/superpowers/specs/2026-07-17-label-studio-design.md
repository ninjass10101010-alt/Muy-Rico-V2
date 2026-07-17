# Muy Rico Label Studio — Design Spec

**Date:** 2026-07-17  
**Status:** Approved for implementation

## Stack

| Prompt-specified | Actual (bent into existing stack) |
|---|---|
| Next.js full-stack | React 19 + Vite single-file SPA |
| PostgreSQL + Prisma | Cloudflare D1 (SQLite) + `ALTER TABLE` migrations |
| NextAuth / Clerk | Cloudflare Access (already) — no multi-tenant |
| Fabric.js / Konva | Hand-rolled DOM canvas (shipped in prev. iteration) |
| jsPDF / react-to-print | `jspdf` + existing `html-to-image` + `window.print()` |
| Vercel / Railway | Cloudflare Workers Assets (already) |
| Stripe SaaS tiers | Dropped — private tool for Muy Rico |

## New dependencies

- `jspdf` (PDF export)
- `vitest` + `jsdom` (test runner, devDeps)

## Schema (single migration `0014_label_studio.sql`)

### label_templates additions
```sql
ALTER TABLE label_templates ADD COLUMN disclaimer_variant TEXT DEFAULT 'standard';
ALTER TABLE label_templates ADD COLUMN product_type     TEXT DEFAULT 'standard';
ALTER TABLE label_templates ADD COLUMN net_weight_us     TEXT;
ALTER TABLE label_templates ADD COLUMN net_weight_metric TEXT;
ALTER TABLE label_templates ADD COLUMN allergen_tags     TEXT;        -- JSON array
ALTER TABLE label_templates ADD COLUMN no_allergens_confirmed INTEGER DEFAULT 0;
ALTER TABLE label_templates ADD COLUMN nutrient_claim    INTEGER DEFAULT 0;
ALTER TABLE label_templates ADD COLUMN bg_image          TEXT;
ALTER TABLE label_templates ADD COLUMN avery_preset      TEXT;        -- 'single'|'5164'|'5163'|'8163'
```

### business_profile additions
```sql
ALTER TABLE business_profile ADD COLUMN business_type TEXT DEFAULT 'cottage';
```

## File structure

### Pure modules (new in `src/utils/`)
- `compliance.ts` — `FDA_ALLERGENS`, `PO_BOX_REGEX`, `detectAllergens`, `usToMetric`, `cqwToPt`, `ptToCqw`, `wcagContrast`, `luminance`, `validateLabel`, `computeScore`
- `disclaimer.ts` — three variant statutory strings (single source of truth)
- `miLaw.ts` — allowed foods, thresholds, channels, MDARD contact, MCL link
- `nfp.ts` — `NUTRIENT_CLAIM_KEYWORDS`, `requiresNFP`, default NFP row values

### React components (new under `src/components/label/`)
- `ComplianceChecklist.tsx` — 8 verdicts + Fix-It
- `ComplianceScore.tsx` — score pill + Ready-to-Print badge
- `FontCompliancePanel.tsx` — sub-floor element list
- `AllergenPicker.tsx` — 9-allergen grid + tree-nut dropdown
- `IngredientSorter.tsx` — validate+sort textarea button
- `ProductTypeSelector.tsx` — 4-button selector
- `NetWeightInput.tsx` — dual US/metric with auto-convert
- `NutritionFactsPanel.tsx` — black-bordered FDA panel element
- `MILawReference.tsx` — collapsible law reference
- `ColorInput.tsx` — hex+swatch+OS wheel composite
- `ShapePalette.tsx` — add rect/circle/line buttons
- `ZoomControl.tsx` — slider 25–200%
- `UndoRedoBar.tsx` — undo/redo + keyboard hook
- `AverySheet.tsx` — print grid for Avery 5164/5163/8163

### New pages
- `src/pages/LabelProjects.tsx` — saved-labels card grid

### Modified files (detailed in plan)
- `src/types.ts`, `LabelDesigner.tsx`, `Settings.tsx`, `LabelCanvas.tsx`, `LabelElementView.tsx`, `PropertiesInspector.tsx`, `LayersPanel.tsx`, `useElementDrag.ts`, `defaultElements.ts`, `App.tsx`, `Sidebar.tsx`, `src/index.css`, `index.html`, `StoreContext.tsx`, `api.ts`, `orders/workers/api.js`, `package.json`

## Compliance engine (`validateLabel`)

8 checks returning `{ score: 0–100, issues: Issue[], isCompliant: boolean }`:

1. Business ID — name non-empty AND (address non-empty + PO-box-free) OR (reg-mode + phone + reg#)
2. Product name — non-empty
3. Ingredients — non-empty
4. Allergens — tags non-empty OR noAllergensConfirmed
5. Net weight — US > 0 and metric auto-filled
6. Disclaimer — ON + ≥11pt + WCAG AA 4.5:1
7. NFP — present if nutrient claim detected OR `nutrientClaim` flag set
8. Product type — valid enum (always passes; wedding shows invoice notice)

## Build order

1. Compliance core (A) + disclaimer fix (G)
2. Canvas power-ups (B)
3. Design tools polish (C)
4. Export (D)
5. Law reference (E)
6. Onboarding + business type (F)
7. NFP builder
8. Tests (H)
