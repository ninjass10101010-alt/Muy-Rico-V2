# Canva-style Label Designer — Design Spec

**Date:** 2026-07-16  
**Status:** Implemented

## Goals

- Drag / resize / rotate / z-order canvas editor for cottage-food labels
- Website URL field + QR code (default `https://muy-rico.com`, editable per label)
- Portrait / landscape orientation for non-square shapes
- Per-element styling overrides (font, size, color, align, opacity, bold/italic)
- Dual editing: on-canvas + right-side form panel
- Migrate existing labels lazily via default element layout

## Architecture

Hand-rolled interaction layer over the existing live-DOM preview (`html-to-image` export). Element positions stored as 0–1 fractions of the printable area.

### Key files

| Path | Role |
|------|------|
| `src/types.ts` | `LabelElement`, `LabelTemplate` canvas fields, `BusinessProfile.website` |
| `src/components/label/defaultElements.ts` | Default layout + `effectiveDimensions` |
| `src/components/label/useElementDrag.ts` | Pointer drag / resize / rotate |
| `src/components/label/LabelCanvas.tsx` | Printable surface |
| `src/components/label/LabelElementView.tsx` | Element render (text/logo/qr/divider) |
| `src/components/label/ElementToolbar.tsx` | Floating selection toolbar |
| `src/components/label/LayersPanel.tsx` | Layer list |
| `src/components/label/PropertiesInspector.tsx` | Per-element style controls |
| `src/pages/LabelDesigner.tsx` | Page shell + controls |
| `orders/migrations/0013_label_canvas.sql` | D1 schema |
| `orders/workers/api.js` | Field allow-lists |

### Data model

```ts
interface LabelElement {
  id: string;
  type: "text" | "logo" | "qr" | "divider";
  field: LabelElementField;
  x, y, w, h: number; // 0..1
  z: number;
  rotation: number;
  hidden: boolean;
  lock?: boolean;
  fontSizeOverride?, fontFamilyOverride?, colorOverride?;
  alignOverride?, opacity?, bold?, italic?;
  qrErrorLevel?: "L"|"M"|"Q"|"H";
}
```

`LabelTemplate` adds: `elements`, `websiteUrl`, `orientation`.

### Migration

```sql
ALTER TABLE label_templates ADD COLUMN elements TEXT;
ALTER TABLE label_templates ADD COLUMN website_url TEXT;
ALTER TABLE label_templates ADD COLUMN orientation TEXT DEFAULT 'portrait';
ALTER TABLE business_profile ADD COLUMN website TEXT;
```

Run remote:

```bash
npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0013_label_canvas.sql
```

Then redeploy the orders API worker.

### QR

`qrcode.react` `QRCodeSVG` — client-side, no network. Value = `label.websiteUrl || profile.website`.

### Export

PNG via `html-to-image` with `filter` skipping `.deco-layer` (handles, toolbars, guides).
