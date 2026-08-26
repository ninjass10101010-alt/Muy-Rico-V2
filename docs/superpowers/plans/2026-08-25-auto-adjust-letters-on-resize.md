# Auto-Adjust Letters on Template Resize — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a template's size/shape/orientation changes, text fonts keep their physical printed size (pt-parity) and text boxes auto-grow so nothing clips — one undo step.

**Architecture:** One pure function `rescaleTemplateForDimensions(prev, nextDims, measure?)` in `templateUtils.ts` (pt-parity conversion → existing overflow fit → measured auto-grow of text box heights, clamped at label bottom). `AddTab.tsx` routes all four dimension-change handlers through it via a single `setDoc(..., true)`. Exports unchanged (they derive print size from stored cqw).

**Tech Stack:** Existing stack only — no new deps.

**Spec:** `docs/superpowers/specs/2026-08-25-auto-adjust-letters-on-resize-design.md`

## Global Constraints

- Work in `home-bakery-management-system/`; vitest from that dir; tsc gate = zero errors in `src/pages/LabelStudio`.
- One history entry per dimension change (`setDoc(..., true)` exactly once per user action).
- Compliance floors ride for free: physical size preserved means 11pt disclaimer stays 11pt.
- Canvas measurement must be LAZY (no module-top canvas creation — store imports this file).
- Tests inject a deterministic measure function (jsdom has no real canvas metrics).
- Stage ONLY the three files listed; owner works in parallel — never `git add -A`, never `git stash`.

---

### Task 1: rescaleTemplateForDimensions + AddTab wiring

**Files:**
- Modify: `src/pages/LabelStudio/templateUtils.ts`
- Modify: `src/pages/LabelStudio/templateUtils.test.ts`
- Modify: `src/pages/LabelStudio/panels/AddTab.tsx`

**Interfaces:**
- Consumes: `effectiveDimensions` (components/label/defaultElements), `cqwToPt`/`ptToCqw` (utils/compliance), `wrapLines` (./labelMath), existing `fitElementsToAspect` (same file).
- Produces:
  ```ts
  export interface TemplateDims {
    labelWidth: number;
    labelHeight: number;
    shape: LabelShape;
    orientation: LabelOrientation;
  }
  export type TextMeasure = (
    line: string,
    fontFamily: string,
    px: number,
    bold: boolean
  ) => number;
  export function rescaleTemplateForDimensions(
    prev: LabelTemplate,
    next: TemplateDims,
    measure?: TextMeasure
  ): LabelTemplate;
  ```
  Returns a NEW doc with `labelWidth/labelHeight/shape/orientation` set from `next`, elements transformed (pt-parity fonts, box fit, auto-grow), and `logoSize` converted when width changed. `measure` defaults to a lazy offscreen-canvas measurer.

- [ ] **Step 1: Write failing tests**

Append to `src/pages/LabelStudio/templateUtils.test.ts`:

```ts
import { rescaleTemplateForDimensions } from "./templateUtils";
import { cqwToPt, ptToCqw } from "../../utils/compliance";
import { defaultElementsFor } from "../../components/label/defaultElements";
import type { LabelElement, LabelTemplate } from "../../types";

const fakeMeasure = (line: string, _f: string, px: number) => line.length * px * 0.5;

function docWith(over: Partial<LabelTemplate>, els: Partial<LabelElement>[]): LabelTemplate {
  const base = makeFallback("");
  return {
    ...base,
    ...over,
    elements: els.map((e, i) => ({
      id: `el${i}`, type: "text", x: 0.05, y: 0.1, w: 0.9, h: 0.08, z: 5,
      fontSizeOverride: 4, ...e,
    })) as LabelElement[],
  };
}

describe("rescaleTemplateForDimensions", () => {
  it("keeps physical pt size when width changes (pt-parity)", () => {
    const disclaimerCqw = ptToCqw(11, 3); // 11pt on a 3in-wide label
    const prev = docWith(
      { labelWidth: 3, labelHeight: 4, shape: "rounded", orientation: "portrait" },
      [{ field: "disclaimer", fontSizeOverride: disclaimerCqw }]
    );
    const next = rescaleTemplateForDimensions(
      prev, { labelWidth: 2, labelHeight: 4, shape: "rounded", orientation: "portrait" }, fakeMeasure
    );
    const el = next.elements.find((e) => e.field === "disclaimer")!;
    expect(cqwToPt(el.fontSizeOverride!, 2)).toBeCloseTo(11, 5);
  });

  it("converts logoSize with the same parity", () => {
    const prev = docWith(
      { labelWidth: 3, labelHeight: 4, shape: "rounded", orientation: "portrait", logoSize: 16 },
      []
    );
    const next = rescaleTemplateForDimensions(
      prev, { labelWidth: 1.5, labelHeight: 4, shape: "rounded", orientation: "portrait" }, fakeMeasure
    );
    expect(cqwToPt(next.logoSize!, 1.5)).toBeCloseTo(cqwToPt(16, 3), 5);
  });

  it("auto-grows a text box whose wrapped text exceeds its height, clamped at label bottom", () => {
    // 40-char word at 4cqw on 3in → px = 0.04*288 = 11.52; width px = 0.9*288 = 259.2
    // fakeMeasure: 40 chars * 11.52 * 0.5 = 230.4 < 259.2 → 1 line. Use a long word list instead:
    const longText = "word ".repeat(30).trim(); // wraps to multiple lines
    const prev = docWith(
      { labelWidth: 3, labelHeight: 4, shape: "rounded", orientation: "portrait" },
      [{ y: 0.5, h: 0.05, text: longText, fontSizeOverride: 4 }]
    );
    const next = rescaleTemplateForDimensions(
      prev, { labelWidth: 3, labelHeight: 4, shape: "rounded", orientation: "portrait" }, fakeMeasure
    );
    const el = next.elements[0];
    const px = (4 / 100) * 3 * 96;
    const lines = Math.ceil((longText.length * px * 0.5) / (0.9 * 3 * 96));
    const needed = Math.min((lines * px * 1.2) / (4 * 96), 1 - 0.5);
    expect(el.h).toBeCloseTo(needed, 5);
    expect(el.h).toBeGreaterThan(0.05);
  });

  it("is a no-op when effective dimensions are unchanged", () => {
    const prev = docWith({ labelWidth: 3, labelHeight: 4, shape: "rounded", orientation: "portrait" },
      [{ fontSizeOverride: 7, h: 0.2, text: "hello world" }]);
    const next = rescaleTemplateForDimensions(
      prev, { labelWidth: 3, labelHeight: 4, shape: "rounded", orientation: "portrait" }, fakeMeasure
    );
    expect(next.elements).toEqual(prev.elements);
    expect(next.labelWidth).toBe(3);
  });

  it("handles orientation swap (3x4 portrait → 4x3 landscape)", () => {
    const prev = docWith(
      { labelWidth: 3, labelHeight: 4, shape: "rounded", orientation: "portrait" },
      [{ fontSizeOverride: ptToCqw(11, 3) }]
    );
    const next = rescaleTemplateForDimensions(
      prev, { labelWidth: 3, labelHeight: 4, shape: "rounded", orientation: "landscape" }, fakeMeasure
    );
    expect(cqwToPt(next.elements[0].fontSizeOverride!, 4)).toBeCloseTo(11, 5);
  });

  it("square-ification: circle shape collapses to min dimension for parity math", () => {
    const prev = docWith(
      { labelWidth: 3, labelHeight: 4, shape: "rounded", orientation: "portrait" },
      [{ fontSizeOverride: ptToCqw(11, 3) }]
    );
    const next = rescaleTemplateForDimensions(
      prev, { labelWidth: 3, labelHeight: 4, shape: "circle", orientation: "portrait" }, fakeMeasure
    );
    expect(cqwToPt(next.elements[0].fontSizeOverride!, 3)).toBeCloseTo(11, 5); // effW stays 3 (min)
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd home-bakery-management-system && npx vitest run src/pages/LabelStudio/templateUtils.test.ts`
Expected: FAIL — `rescaleTemplateForDimensions` is not exported.

- [ ] **Step 3: Implement in templateUtils.ts**

Add imports at top:

```ts
import { cqwToPt, ptToCqw } from "../../utils/compliance";
import { wrapLines } from "./labelMath";
import type { LabelShape, LabelOrientation } from "../../types";
```

Add (after `fitElementsToAspect`):

```ts
export interface TemplateDims {
  labelWidth: number;
  labelHeight: number;
  shape: LabelShape;
  orientation: LabelOrientation;
}

export type TextMeasure = (line: string, fontFamily: string, px: number, bold: boolean) => number;

let cachedCtx: CanvasRenderingContext2D | null | undefined;
function defaultMeasure(line: string, fontFamily: string, px: number, bold: boolean): number {
  if (cachedCtx === undefined) {
    try {
      cachedCtx = document.createElement("canvas").getContext("2d");
    } catch {
      cachedCtx = null;
    }
  }
  if (!cachedCtx) return line.length * px * 0.5;
  cachedCtx.font = `${bold ? 700 : 400} ${px}px ${fontFamily}`;
  return cachedCtx.measureText(line).width;
}

const PX_PER_IN = 96;

/**
 * Re-fit a template for a new dimension set: fonts keep their PHYSICAL size
 * (pt-parity), boxes keep relative positions, text boxes auto-grow to fit
 * their re-wrapped content (clamped at the label bottom). Pure; one store
 * commit per user action happens at the call site.
 */
export function rescaleTemplateForDimensions(
  prev: LabelTemplate,
  next: TemplateDims,
  measure: TextMeasure = defaultMeasure
): LabelTemplate {
  const prevEff = effectiveDimensions(
    prev.labelWidth, prev.labelHeight, prev.shape, prev.orientation || "portrait"
  );
  const nextEff = effectiveDimensions(
    next.labelWidth, next.labelHeight, next.shape, next.orientation
  );

  let elements = fitElementsToAspect(prev.elements || []);

  if (Math.abs(prevEff.effW - nextEff.effW) > 1e-9) {
    elements = elements.map((el) => {
      if (el.type === "text" && el.fontSizeOverride != null) {
        const pt = cqwToPt(el.fontSizeOverride, prevEff.effW);
        return { ...el, fontSizeOverride: Math.round(ptToCqw(pt, nextEff.effW) * 100) / 100 };
      }
      return el;
    });
  }

  // Auto-grow text boxes whose re-wrapped content exceeds their height.
  const nextWpx = nextEff.effW * PX_PER_IN;
  const nextHpx = nextEff.effH * PX_PER_IN;
  elements = elements.map((el) => {
    if (el.type !== "text" || el.hidden) return el;
    const text = el.text ?? "";
    if (!text.trim()) return el;
    const family = firstFamilyOf(el.fontFamilyOverride || prev.font);
    const px = ((el.fontSizeOverride ?? 4) / 100) * nextWpx;
    const lines = wrapLines(
      text,
      (s) => measure(s, family, px, Boolean(el.bold)),
      Math.max(1, el.w * nextWpx)
    );
    const neededNorm = (lines.length * px * 1.2) / nextHpx;
    if (neededNorm > el.h) {
      return { ...el, h: Math.min(neededNorm, Math.max(0.01, 1 - el.y)) };
    }
    return el;
  });

  const widthChanged = Math.abs(prevEff.effW - nextEff.effW) > 1e-9;
  const logoSize =
    widthChanged && prev.logoSize != null
      ? Math.round(ptToCqw(cqwToPt(prev.logoSize, prevEff.effW), nextEff.effW) * 100) / 100
      : prev.logoSize;

  return { ...prev, ...next, elements, logoSize };
}

function firstFamilyOf(stack: string): string {
  const m = stack.match(/'([^']+)'|"([^"]+)"/);
  return (m?.[1] || m?.[2] || stack.split(",")[0] || "sans-serif").trim();
}
```

Note: `firstFamilyOf` intentionally mirrors `firstFamily` in `capture.ts` — do NOT import from capture.ts (keeps templateUtils DOM-light and test-friendly); duplication is two lines and acceptable here (DRY exception documented in plan).

- [ ] **Step 4: Run tests to green**

Run: `npx vitest run src/pages/LabelStudio/templateUtils.test.ts`
Expected: PASS (all new + existing).

- [ ] **Step 5: Wire AddTab handlers**

In `src/pages/LabelStudio/panels/AddTab.tsx`:

1. Import: `import { rescaleTemplateForDimensions, fitElementsToAspect } from "../templateUtils";` (keep existing imports; `fitElementsToAspect` may already be imported for the shape handler — remove that separate usage).
2. Size preset button onClick — replace the two `updateField` calls:

```tsx
onClick={() => {
  const next = rescaleTemplateForDimensions(doc, {
    labelWidth: s.w, labelHeight: s.h, shape: doc.shape, orientation: doc.orientation || "portrait",
  });
  setDoc(next, true);
  setCustomW(String(s.w));
  setCustomH(String(s.h));
}}
```

3. Custom W and H `onBlur` handlers — replace each `updateField("labelWidth"/"labelHeight", n)` with:

```tsx
onBlur={() => {
  const n = Number(customW) || 3;
  setCustomW(String(n));
  setDoc(rescaleTemplateForDimensions(doc, {
    labelWidth: n, labelHeight: Number(customH) || doc.labelHeight,
    shape: doc.shape, orientation: doc.orientation || "portrait",
  }), true);
}}
```

(mirror for H with `Number(customH) || 4` and `labelWidth: Number(customW) || doc.labelWidth`).

4. Orientation buttons — replace `updateField("orientation", "portrait"/"landscape")` with:

```tsx
onClick={() => setDoc(rescaleTemplateForDimensions(doc, {
  labelWidth: doc.labelWidth, labelHeight: doc.labelHeight,
  shape: doc.shape, orientation: "portrait",
}), true)}
```

(keep the `disabled={isSquareShape}` guards exactly as-is; mirror for landscape).

5. Shape buttons — replace the existing `setDoc({ ...doc, shape, elements: fitElementsToAspect(elements) }, true)` with:

```tsx
onClick={() => setDoc(rescaleTemplateForDimensions(doc, {
  labelWidth: doc.labelWidth, labelHeight: doc.labelHeight,
  shape: s.value, orientation: doc.orientation || "portrait",
}), true)}
```

If `fitElementsToAspect`/`elements` become unused imports in AddTab, remove them.

- [ ] **Step 6: Full gates**

```
cd home-bakery-management-system
npx vitest run            # all green (256 + 6 new)
npx tsc --noEmit 2>&1 | grep -E "src/pages/LabelStudio"   # zero lines
npm run build             # success; git restore admin/index.html (do NOT stage)
```

- [ ] **Step 7: Commit**

```bash
git add src/pages/LabelStudio/templateUtils.ts src/pages/LabelStudio/templateUtils.test.ts src/pages/LabelStudio/panels/AddTab.tsx
git commit -m "feat(labels): letters keep physical size + boxes auto-grow on template resize"
```
