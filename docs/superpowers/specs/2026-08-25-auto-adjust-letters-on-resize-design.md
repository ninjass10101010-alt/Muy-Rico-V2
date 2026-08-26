# Auto-Adjust Letters on Template Resize — Design Spec

**Date:** 2026-08-25
**Status:** Approved
**Extends:** `2026-08-25-label-studio-redesign-design.md` (Label Studio)

## Problem

Changing a template's size preset, custom W×H, orientation, or shape re-flows text but never re-fits font sizes: on aspect changes letters can overflow their boxes (clipped) or leave dead space. Fonts are stored as cqw (% of width), so same-aspect resizes already scale proportionally — only dimension/aspect *changes* need handling.

## Decision (user-approved)

Letters keep their **physical printed size** (pt-parity) across template size/shape changes — compliance-safe (an 11pt disclaimer stays 11pt).

## Behavior

On any template-dimension change (size preset, custom W/H commit, orientation toggle, shape change), the studio applies ONE transformation, committed as ONE undo entry:

1. **Font pt-parity:** every text element's `fontSizeOverride` converts old-width-cqw → same physical pt on the new width: `new = ptToCqw(cqwToPt(old, oldEffW), newEffW)`.
2. **Logo parity:** `logoSize` converts identically (keeps printed logo size).
3. **Box fit:** existing `fitElementsToAspect` overflow scaling runs first; then each text element's box height auto-grows if its re-wrapped text (measured at the new width with the shared `wrapLines`/canvas metrics) exceeds the box — clamped to the label bottom edge. No horizontal changes. If no room exists, clipping + existing compliance flags apply (unchanged behavior).
4. Non-text elements (shapes, QR, NFP) are untouched beyond existing box-fit.

## Implementation

- New pure function `rescaleTemplateForDimensions(prev: LabelTemplate, nextDims: {labelWidth, labelHeight, shape, orientation}): LabelTemplate` in `src/pages/LabelStudio/templateUtils.ts` — takes prev doc + the new dimension set, returns the transformed doc (pure, no store access). Reuses `effectiveDimensions`, `cqwToPt`/`ptToCqw` (utils/compliance), `wrapLines` (labelMath).
- `AddTab.tsx` wires its four dimension-change handlers through `setDoc(rescaleTemplateForDimensions(doc, next), true)` (replacing the current field-only updates; shape handler folds its existing `fitElementsToAspect` call into the new function).
- Exports need no changes: both renderers already derive printed size from stored cqw at render time.

## Testing

- Vitest units: pt-parity (3×4→2×4 keeps an 11pt disclaimer at 11pt), logo conversion, auto-grow clamped at label bottom, no-op when effective dims unchanged, orientation swap, shape square-ification.
- Browser: flip orientation + shrink a populated template — nothing clips, one ⌘Z reverts the whole change.

## Non-goals

- Shrink-to-fit below physical size (approach C) — deferred.
- Per-element "lock font size" toggles.
- NFP internal layout changes.
