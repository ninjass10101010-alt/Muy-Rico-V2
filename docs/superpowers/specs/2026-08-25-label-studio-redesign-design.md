# Label Studio Redesign — Design Spec

**Date:** 2026-08-25
**Status:** Approved (pending implementation plan)
**Supersedes:** the editor UI portions of `2026-07-17-label-studio-design.md` (compliance engine, schema, and export flows carry forward)

## Problem

The label maker (`src/pages/LabelDesigner.tsx`, 1,760 lines) is slow and clumsy on iPad:

- Every pointer-move during a drag calls `setElements` → full `LabelDesigner` re-render (~60/sec) AND pushes a full-template undo snapshot (~60/sec).
- `normalizeLabel(label)` runs 3–4× per render frame; compliance components re-run per drag frame.
- Hand-rolled DOM dragging fights CSS layout; no pinch-zoom, small touch handles.
- The PDF pipeline has drifted from the screen renderer: logos silently drop (data-URL mime sniffing by filename), Nutrition Facts exports blank rows (`totalFat`/`totalCarb`/`sugars` vs actual `fat`/`carbs`/`sugar` fields), 6 of 8 fonts degrade to Helvetica in print, emoji logos never export, best-by date can differ between screen and paper.

## Goals

1. iPad-first fluidity: 60fps drags, native pinch-zoom/two-finger pan, touch-sized handles.
2. Figma-precise desktop-class layout: layers tree left, contextual inspector right, everything findable.
3. All existing features preserved and reorganized; zero data migration.
4. Export correctness: what-you-see-is-what-you-print, with the vector path's bugs fixed.

## Non-goals

- No multi-select editing, no artboard pages, no collaboration/cursors.
- No new backend endpoints or D1 schema changes.
- No redesign of other admin pages.

## Decisions (user-approved)

| Question | Decision |
|---|---|
| Design vibe | **Figma-precise** — dense pro-tool layout, layers + inspector always visible |
| Workflow priority | Both reprint-speed AND freeform design equally |
| Compliance UX | Score pill in top bar → slide-over panel |
| Engine | **Konva.js + react-konva** (official React bindings, layered canvases, batched redraws, native multi-touch). Fabric.js rejected: no React story. DOM-only optimization rejected: hard ceiling on fluidity |
| Page | Full-screen editor route replacing in-frame page for `page === "labels"` |

## Architecture

### Routing & shell

- `App.tsx`: when `page === "labels"`, render `<LabelStudio>` **full-screen**, bypassing Sidebar/Topbar. Editor has its own back button restoring the previous page.
- Launch params unchanged: `filterByOrder`, `filterByProduct` pass through (Orders→print labels, Products→label buttons keep working).
- Build note: `vite-plugin-singlefile` inlines everything — Konva (+~150KB gz) joins the single bundle; acceptable for a cached internal tool. No lazy chunks.

### Module layout

```
src/pages/LabelStudio/
  index.tsx              shell: top bar + panels + stage
  state.ts               zustand store: doc, selection, ui, history
  history.ts             per-gesture undo/redo
  StageCanvas.tsx        react-konva Stage, 3 Konva layers
  elements/              renderers: TextEl, ShapeEl, LogoEl, QrEl, NfpEl
  panels/LeftPanel.tsx   tabs: Add | Layers | Templates
  panels/Inspector.tsx   right contextual properties
  panels/CompliancePanel.tsx  score-pill slide-over
  hooks/useGestures.ts   pinch-zoom, pan plumbing
```

### Reuse, don't rewrite

Move into new panels as-is (minor prop adaptations only): `ComplianceChecklist`, `ComplianceScore`, `FontCompliancePanel`, `AllergenPicker`, `IngredientSorter`, `NetWeightInput`, `MILawReference`, `AverySheet`, `PropertiesInspector` (adapted), `ProductTypeSelector`. Compliance engine (`utils/compliance.ts`), disclaimers, NFP utils untouched. `LabelDesigner.tsx` and its canvas/drag internals are deleted after parity is verified.

### Data model

Unchanged. Same `LabelTemplate` / `LabelElement` types, same D1 tables, same StoreContext API calls. Existing templates load with zero migration.

## Layout & interaction

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Back │ [template name] │ ↶ ↷ │ − 100% + │ ●92 Ready │ Save ⌄ │
├───────────┬─────────────────────────────────────┬───────────────┤
│ LEFT rail │        CANVAS (Konva stage)         │ RIGHT         │
│ Add       │   pinch-zoom · two-finger pan       │ Inspector     │
│ Layers    │   drag · floating selection toolbar │ (contextual)  │
│ Templates │   smart alignment guides             │               │
└───────────┴─────────────────────────────────────┴───────────────┘
```

- **Left rail tabs:**
  - *Add* — text/shapes/logo/QR/NFP insert buttons; shape, size+custom+orientation, palette, font, logo upload/emoji, background image, website/QR controls.
  - *Layers* — z-order tree; tap select, hide/lock toggles, drag to reorder.
  - *Templates* — product/order/custom template browser with recents pinned (replaces old sidebar list); "duplicate as new"; order-label filter banner when launched from an order.
- **Right inspector:** properties of current selection. Text element → font/size/color/align/etc. Background tap → document setup (shape/colors/bg-image). Nothing selected → document defaults. One context at a time.
- **Compliance:** top-bar pill shows live score ("●92 Ready"). Tap → slide-over panel containing checklist, font-size compliance, allergen picker, disclaimer toggle, MI law reference, product type, business-ID mode. Existing Fix-It jump behavior preserved (focuses the relevant field).
- **iPad portrait:** rails become slide-over drawers from a bottom tab bar; landscape uses full 3-column layout.
- **Touch rules:** ≥44px hit targets; transform handles have enlarged invisible touch zones; no hover-only affordances; long-press on element = duplicate/delete/lock menu.

## Canvas engine & performance

### Stage structure

- Layer 1 — background: bg color/image, accent border, shape clip; redraws on design changes only.
- Layer 2 — elements: one node per element (Konva Text/Image/Group; QR rendered to bitmap once per value change).
- Layer 3 — overlay: selection box, Transformer handles, snap guides, safe margin; isolated so chrome never dirties element pixels.

### Drag pipeline (the core fix)

- During gesture: Konva mutates node attrs directly; overlay draws guides. **Zero React re-renders per frame.**
- On release: commit final coords to store once → exactly ONE undo entry per gesture (move/resize/rotate).
- Resize/rotate via Konva `Transformer`: logo/QR anchors always aspect-locked (matches current behavior); rotation auto-snaps to 15° increments when within 4°; desktop keeps Shift modifiers for axis-lock and free-angle override.

### State & history

- Zustand store local to the editor: `doc` (LabelTemplate), `selection`, `ui` (zoom, panels), `history`.
- Panels subscribe via selectors; opening panels never re-renders the stage.
- History: snapshot-per-gesture (and per discrete edit action), cap 100 entries; keyboard undo/redo preserved (⌘Z/⌘⇧Z/⌘Y).

### Gestures & editing

- Pinch-zoom + two-finger pan on stage background; one-finger drag moves elements; zoom slider retained for desktop.
- Snapping: 5% grid plus smart guides (element edges/centers vs siblings and canvas center) while dragging.
- Inline text edit: double-tap text element → floating HTML input positioned over it; commits on Done/blur. Desktop keeps double-click.
- Keyboard (desktop): arrows nudge, ⇧+arrows 5× nudge, Delete, ⌘D duplicate.

## Export overhaul & reliability

### Single rendering source of truth

The Konva stage is the canonical preview. Exports derive from it so screen == paper.

| Output | Mechanism | Notes |
|---|---|---|
| PNG / JPG | `stage.toDataURL({ pixelRatio })` sized to 300dpi | Replaces html-to-image; no font races |
| PDF default — "Exact preview" | Stage rasterized at 300dpi → single embedded image per pdf-lib page | Emoji ✓ all fonts ✓ NFP ✓; Munbyn/AirPrint rasterize anyway. Image embedded ONCE per sheet, drawn per copy |
| PDF option — "Vector text" | Existing pdf-lib vector path, bug-fixed below | For laser-printed Avery sheets wanting crisp text |
| Print / Open&Print / Share | Existing iOS flows unchanged | Sync window-open anti-popup-blocker preserved |

### Vector-path bug fixes (required regardless)

1. **Logo embed:** detect PNG/JPG from data-URL mime header, not filename substring; remove silent empty catches — log and surface errors.
2. **NFP mapping:** read actual `NfpData` fields (`fat`, `satFat`, `carbs`, `fiber`, `sugar`, …); delete phantom fields (`servings`, `totalFat`, `addedSugars`). Editor panel and PDF must render identical rows from one shared row-spec constant.
3. **Best-by parity:** one shared `resolveBestBy(label): Date` used by editor AND exporter (stored snapshot wins; else now + bestByDays).
4. **QR value:** honor `el.qrValue` falling back to website URL (both renderers).
5. **Vector font honesty:** vector mode documents/embeds Cormorant + Quicksand; other families map to closest embedded face rather than silently Helvetica. (Raster default makes this a non-issue day-to-day.)

### Reliability

- Autosave working draft to localStorage (debounced ~1s) keyed by template id; restore prompt on reopen. Explicit Save still writes D1.
- Unsaved-changes guard on back navigation.
- Export failures → dismissable toast with actionable message; never silent.

## Testing

- **Vitest units:** history (one entry per gesture, cap, redo invalidation), snap/guide math, `resolveBestBy`, logo mime sniffing, NFP row-spec mapping, Code128 (existing suite stays green).
- **Component tests:** store reducers (select/patch/commit cycles).
- **Manual iPad acceptance checklist:** drag fluidity (no visible lag), pinch-zoom smoothness, inline edit with Apple Pencil/finger keyboard, Share→Munbyn flow, AirPrint of both PDF modes, Avery 5164 sheet alignment printed once on a physical sheet.

## Risks & mitigations

- **Konva text wrapping ≠ CSS wrapping:** wrap manually using measured widths (same algorithm as pdf-lib `wrapText`) so all three renderers agree; golden tests on sample strings.
- **Inline HTML input over canvas:** caret positioning quirks on iPad Safari — mitigate with explicit Done button committing on blur; test early in implementation.
- **Single-file bundle growth:** +~150KB gz accepted (internal tool, cached).
- **Parity regressions:** keep old designer importable behind a flag until manual checklist passes, then delete.

## Build order (high level, detailed in plan)

1. Shell + store + history + stage rendering existing templates read-only.
2. Gesture pipeline (drag/resize/rotate/pinch) + snapping.
3. Left panel (Add/Layers/Templates) + inspector + compliance slide-over.
4. Text inline editing + keyboard shortcuts.
5. Export overhaul (raster default, vector fixes) + autosave/guards.
6. Tests + iPad acceptance pass + delete old designer.
