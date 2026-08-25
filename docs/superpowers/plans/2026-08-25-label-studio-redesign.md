# Label Studio Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the DOM-based LabelDesigner with a full-screen, iPad-first Konva canvas editor (Figma-precise layout) that preserves every existing feature and fixes the PDF/image export bugs.

**Architecture:** react-konva Stage (background / elements / overlay layers) driven by a local zustand store; gestures mutate Konva nodes directly and commit once per gesture to history; the stage is the single rendering source of truth for PNG/JPG/raster-PDF exports, with the vector pdf-lib path kept (bug-fixed) as an option. Compliance engine, schema, and StoreContext API untouched.

**Tech Stack:** React 19 + Vite + Tailwind 4 (existing), konva + react-konva v19, zustand v5, qrcode (existing), pdf-lib (existing), vitest + jsdom (existing).

**Spec:** `docs/superpowers/specs/2026-08-25-label-studio-redesign-design.md`

## Global Constraints

- Work inside `home-bakery-management-system/` for all source changes.
- Build has NO tsc step (`"build": "vite build"`); tests run via `npx vitest run <file>` from `home-bakery-management-system/`.
- Data model unchanged: `LabelTemplate` / `LabelElement` in `src/types.ts`; no D1 migrations; no api.ts signature changes.
- Existing components are REUSED where the spec lists them; do not rewrite compliance/allergen/ingredient/net-weight/law-reference/Avery internals.
- All touch targets ≥44px; no hover-only affordances in new UI.
- One undo entry per gesture; history cap 100.
- Old `LabelDesigner.tsx` stays importable until Task 12 deletes it (transient duplication of small helpers is accepted and resolved there).
- Tailwind theme tokens available: `palm`, `palm-light`, `palm-50`, `palm-700`, `coral`, `coral-light`, `hibiscus`, `hibiscus-light`, `sand-50/100/200/300`, `cocoa`, `cocoa-muted`. `.input` utility class exists in `src/index.css`.
- Commit after every task; message style follows repo convention (`feat(labels): …` etc.).

---

### Task 1: Dependencies, webfonts, NfpData type fix

**Files:**
- Modify: `home-bakery-management-system/package.json` (via npm install)
- Modify: `home-bakery-management-system/index.html:9-12`
- Modify: `home-bakery-management-system/src/types.ts:183-210`
- Test: none new (run existing suite)

**Interfaces:**
- Produces: `konva`, `react-konva`, `zustand` packages installed; all 8 editor fonts actually loaded at runtime; corrected `NfpData` interface used by later tasks:
  ```ts
  export interface NfpData {
    servingSize: string; servings: string; calories: string;
    totalFat: string; satFat: string; transFat: string;
    cholesterol: string; sodium: string; totalCarb: string;
    fiber: string; sugars: string; addedSugars: string; protein: string;
    vitD: string; calcium: string; iron: string; potassium: string;
    vitA: string; vitC: string;
  }
  ```

- [ ] **Step 1: Install deps**

```bash
cd home-bakery-management-system && npm i konva react-konva zustand
```
Expected: installs without peer errors (react-konva must be ≥19 for React 19; if npm warns, verify installed major: `node -e "console.log(require('react-konva/package.json').version)")` → expect 19.x).

- [ ] **Step 2: Load all 8 fonts in index.html**

Replace the Google Fonts stylesheet link with:

```html
<link
  href="https://fonts.googleapis.com/css2?family=Caveat&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Lato:wght@400;700&family=Montserrat:wght@400;700&family=Oswald:wght@400;600&family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Poppins:wght@400;600&family=Quicksand:wght@400;500;600;700&display=swap"
  rel="stylesheet"
/>
```

- [ ] **Step 3: Fix the stale NfpData interface**

In `src/types.ts` replace the entire `NfpData` interface (lines 183–210) with:

```ts
export interface NfpData {
  servingSize: string;
  servings: string;
  calories: string;
  totalFat: string;
  satFat: string;
  transFat: string;
  cholesterol: string;
  sodium: string;
  totalCarb: string;
  fiber: string;
  sugars: string;
  addedSugars: string;
  protein: string;
  vitD: string;
  calcium: string;
  iron: string;
  potassium: string;
  vitA: string;
  vitC: string;
}
```

This matches the runtime shape already produced by `defaultElements.ts` and consumed by `NutritionFactsPanel.tsx`, `PropertiesInspector.tsx`, and the pdf exporter.

- [ ] **Step 4: Align utils/nfp.ts default data if needed**

Open `src/utils/nfp.ts`. Its `defaultNfpData()` must return an object satisfying the new interface — every key above present with `""` (empty string). Adjust keys that referenced old names (`fat`, `fatDaily`, `carbsDaily`, `vitaminD`, …) to the new names. Keep `requiresNFP` logic untouched.

- [ ] **Step 5: Run existing test suite**

Run: `cd home-bakery-management-system && npx vitest run`
Expected: all pass (no test references removed fields; labelExport.test.ts uses its own fixtures).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json index.html src/types.ts src/utils/nfp.ts
git commit -m "chore(labels): konva/zustand deps, load all editor fonts, fix stale NfpData type"
```

---

### Task 2: Editor store + per-gesture history

**Files:**
- Create: `src/pages/LabelStudio/history.ts`
- Create: `src/pages/LabelStudio/history.test.ts`
- Create: `src/pages/LabelStudio/state.ts`
- Create: `src/pages/LabelStudio/templateUtils.ts`

**Interfaces:**
- Consumes: `LabelTemplate`, `LabelElement` from `../../types`; `ensureElements` from `../../components/label/defaultElements`.
- Produces (used by ALL later tasks):
  - `pushHistory(past: LabelTemplate[], doc: LabelTemplate, cap?: number): LabelTemplate[]`
  - `undoHistory(doc, past, future): { doc; past; future } | null`
  - `redoHistory(doc, past, future): { doc; past; future } | null`
  - `normalizeLabel(t: LabelTemplate, profileWebsite: string): LabelTemplate`
  - `makeFallback(profileWebsite: string): LabelTemplate`
  - `fitElementsToAspect(elements: LabelElement[]): LabelElement[]`
  - `useEditorStore` zustand hook with state `{ doc, past, future, selection, editingId, zoom, panX, panY, leftTab, complianceOpen, dirty }` and actions:
    - `loadTemplate(t: LabelTemplate): void` — normalize, reset history/dirty/selection
    - `setDoc(next: LabelTemplate, record = true): void` — one history entry
    - `updateField<K extends keyof LabelTemplate>(key: K, value: LabelTemplate[K], record = true): void`
    - `patchElement(id: string, patch: Partial<LabelElement>, record = true): void`
    - `setElements(elements: LabelElement[], record = true): void`
    - `select(id: string | null): void`; `setEditingId(id: string | null): void`
    - `setZoom(z: number): void`; `setPan(x: number, y: number): void`
    - `setLeftTab(tab: "add" | "layers" | "templates"): void`; `toggleCompliance(): void`
    - `undo(): void`; `redo(): void`
    - `markClean(): void`
  - Derived selectors exported: `selectCanUndo(s): boolean`, `selectCanRedo(s): boolean`, `selectSortedElements(s): LabelElement[]` (by z asc), `selectSelected(s): LabelElement | null`.

- [ ] **Step 1: Write failing tests for history**

Create `src/pages/LabelStudio/history.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pushHistory, undoHistory, redoHistory } from "./history";
import type { LabelTemplate } from "../../types";

const doc = (n: string): LabelTemplate => ({ id: n, name: n }) as unknown as LabelTemplate;

describe("history", () => {
  it("caps past length at 100", () => {
    let past: LabelTemplate[] = [];
    for (let i = 0; i < 120; i++) past = pushHistory(past, doc(`d${i}`));
    expect(past.length).toBe(100);
    expect(past[0].id).toBe("d20");
  });

  it("undo pops last past entry into future", () => {
    const past = [doc("a")];
    const cur = doc("b");
    const r = undoHistory(cur, past, []);
    expect(r!.doc.id).toBe("a");
    expect(r!.past.length).toBe(0);
    expect(r!.future.length).toBe(1);
    expect(r!.future[0].id).toBe("b");
  });

  it("undo returns null when nothing to undo", () => {
    expect(undoHistory(doc("a"), [], [])).toBeNull();
  });

  it("redo mirrors undo", () => {
    const cur = doc("a");
    const future = [doc("b")];
    const r = redoHistory(cur, [], future);
    expect(r!.doc.id).toBe("b");
    expect(r!.past.map((d) => d.id)).toEqual(["a"]);
    expect(r!.future.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd home-bakery-management-system && npx vitest run src/pages/LabelStudio/history.test.ts`
Expected: FAIL — cannot resolve `./history`.

- [ ] **Step 3: Implement history.ts**

```ts
import type { LabelTemplate } from "../../types";

export const HISTORY_CAP = 100;

export function pushHistory(
  past: LabelTemplate[],
  doc: LabelTemplate,
  cap: number = HISTORY_CAP
): LabelTemplate[] {
  const next = [...past, doc];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

export function undoHistory(
  doc: LabelTemplate,
  past: LabelTemplate[],
  future: LabelTemplate[]
): { doc: LabelTemplate; past: LabelTemplate[]; future: LabelTemplate[] } | null {
  if (past.length === 0) return null;
  return {
    doc: past[past.length - 1],
    past: past.slice(0, -1),
    future: [...future, doc],
  };
}

export function redoHistory(
  doc: LabelTemplate,
  past: LabelTemplate[],
  future: LabelTemplate[]
): { doc: LabelTemplate; past: LabelTemplate[]; future: LabelTemplate[] } | null {
  if (future.length === 0) return null;
  return {
    doc: future[future.length - 1],
    past: [...past, doc],
    future: future.slice(0, -1),
  };
}
```

- [ ] **Step 4: Run history tests to green**

Run: `cd home-bakery-management-system && npx vitest run src/pages/LabelStudio/history.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write failing store test**

Create `src/pages/LabelStudio/state.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "./state";
import { makeFallback } from "./templateUtils";
import type { LabelElement } from "../../types";

function el(id: string, over: Partial<LabelElement> = {}): LabelElement {
  return { id, type: "text", x: 0.1, y: 0.1, w: 0.3, h: 0.1, z: 1, ...over };
}

describe("editor store", () => {
  beforeEach(() => {
    useEditorStore.getState().loadTemplate(makeFallback(""));
    useEditorStore.getState().setElements([el("a", { z: 2 }), el("b", { z: 1 })]);
    useEditorStore.getState().markClean();
  });

  it("patchElement records exactly one history entry", () => {
    const before = useEditorStore.getState().past.length;
    useEditorStore.getState().patchElement("a", { x: 0.5 });
    const s = useEditorStore.getState();
    expect(s.past.length).toBe(before + 1);
    expect(s.doc.elements.find((e) => e.id === "a")!.x).toBe(0.5);
    expect(s.dirty).toBe(true);
  });

  it("record=false mutates without history (gesture frames)", () => {
    const before = useEditorStore.getState().past.length;
    useEditorStore.getState().patchElement("a", { y: 0.4 }, false);
    const s = useEditorStore.getState();
    expect(s.past.length).toBe(before);
    expect(s.doc.elements.find((e) => e.id === "a")!.y).toBe(0.4);
  });

  it("sorted elements ascend by z", () => {
    expect(useEditorStore.getState().doc.elements.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("undo/redo round-trips a patch", () => {
    useEditorStore.getState().patchElement("a", { x: 0.7 });
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().doc.elements.find((e) => e.id === "a")!.x).toBe(0.1);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().doc.elements.find((e) => e.id === "a")!.x).toBe(0.7);
  });

  it("new edit invalidates redo stack", () => {
    useEditorStore.getState().patchElement("a", { x: 0.7 });
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().future.length).toBe(1);
    useEditorStore.getState().patchElement("a", { x: 0.9 });
    expect(useEditorStore.getState().future.length).toBe(0);
  });

  it("loadTemplate normalizes legacy templates", () => {
    useEditorStore.getState().loadTemplate({ id: "x", name: "MR-123" } as never);
    const s = useEditorStore.getState();
    expect(s.doc.templateKind).toBe("order");
    expect(s.doc.orientation).toBe("portrait");
    expect(s.doc.elements.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 6: Implement templateUtils.ts**

Move these three functions OUT of `src/pages/LabelDesigner.tsx` into a new shared module (old page keeps working off its own copies until Task 12):

```ts
import type { LabelElement, LabelTemplate } from "../../types";
import { defaultElementsFor } from "../../components/label/defaultElements";

export function normalizeLabel(t: LabelTemplate, profileWebsite: string): LabelTemplate {
  const legacyOrder = /^MR-\d+|^Order #\d+/.test(t.name);
  return {
    ...t,
    orientation: t.orientation || "portrait",
    websiteUrl: t.websiteUrl || profileWebsite || "https://muy-rico.com",
    elements: t.elements && t.elements.length > 0 ? t.elements : defaultElementsFor(t),
    showDisclaimer: t.showDisclaimer !== false,
    disclaimerVariant: "standard",
    productType: t.productType === "wedding" ? "wedding" : "standard",
    allergenTags: t.allergenTags || [],
    noAllergensConfirmed: Boolean(t.noAllergensConfirmed),
    nutrientClaim: Boolean(t.nutrientClaim),
    averyPreset: t.averyPreset || "single",
    netWeightUS: t.netWeightUS || "",
    netWeightMetric: t.netWeightMetric || "",
    templateKind: t.templateKind || (legacyOrder ? "order" : "custom"),
    productId: t.productId ?? null,
  };
}

export function makeFallback(profileWebsite: string): LabelTemplate {
  const base: LabelTemplate = {
    id: "new",
    name: "New Label",
    shape: "rounded",
    bgColor: "#FBF3E7",
    accentColor: "#C17A3F",
    textColor: "#4A3222",
    businessName: "",
    productName: "",
    details: "",
    ingredients: "",
    allergens: "",
    netWeight: "",
    netWeightUS: "",
    netWeightMetric: "",
    price: "",
    showPrice: false,
    showBestBy: false,
    bestByDays: 7,
    logoEmoji: "🧁",
    font: "'Cormorant Garamond', Georgia, serif",
    businessIdMode: "address",
    address: "",
    phoneNumber: "",
    registrationNumber: "",
    showDisclaimer: true,
    labelWidth: 3,
    labelHeight: 4,
    orientation: "portrait",
    websiteUrl: profileWebsite || "https://muy-rico.com",
    elements: [],
    disclaimerVariant: "standard",
    productType: "standard",
    allergenTags: [],
    noAllergensConfirmed: false,
    nutrientClaim: false,
    averyPreset: "single",
  };
  return { ...base, elements: defaultElementsFor(base) };
}

/** Scale/clamp elements so they fit inside 0..1 after a shape/aspect change. Only scales on overflow. */
export function fitElementsToAspect(elements: LabelElement[]): LabelElement[] {
  let maxRight = 0;
  let maxBottom = 0;
  for (const el of elements) {
    maxRight = Math.max(maxRight, el.x + el.w);
    maxBottom = Math.max(maxBottom, el.y + el.h);
  }
  if (maxRight <= 1 && maxBottom <= 1) return elements;
  const scale = Math.min(1 / Math.max(maxRight, 0.001), 1 / Math.max(maxBottom, 0.001), 1);
  return elements.map((el) => {
    const w = Math.min(el.w * scale, 1);
    const h = Math.min(el.h * scale, 1);
    const x = Math.min(Math.max(el.x * scale, 0), 1 - w);
    const y = Math.min(Math.max(el.y * scale, 0), 1 - h);
    return { ...el, x, y, w, h };
  });
}
```

- [ ] **Step 7: Implement state.ts**

```ts
import { create } from "zustand";
import type { LabelElement, LabelTemplate } from "../../types";
import { pushHistory, undoHistory, redoHistory } from "./history";
import { normalizeLabel } from "./templateUtils";
import { ensureElements } from "../../components/label/defaultElements";

export type LeftTab = "add" | "layers" | "templates";

interface EditorState {
  doc: LabelTemplate;
  past: LabelTemplate[];
  future: LabelTemplate[];
  selection: string | null;
  editingId: string | null;
  zoom: number; // percent, 25..400
  panX: number;
  panY: number;
  leftTab: LeftTab;
  complianceOpen: boolean;
  dirty: boolean;

  loadTemplate(t: LabelTemplate): void;
  setDoc(next: LabelTemplate, record?: boolean): void;
  updateField<K extends keyof LabelTemplate>(key: K, value: LabelTemplate[K], record?: boolean): void;
  setElements(elements: LabelElement[], record?: boolean): void;
  patchElement(id: string, patch: Partial<LabelElement>, record?: boolean): void;
  select(id: string | null): void;
  setEditingId(id: string | null): void;
  setZoom(z: number): void;
  setPan(x: number, y: number): void;
  setLeftTab(tab: LeftTab): void;
  toggleCompliance(): void;
  undo(): void;
  redo(): void;
  markClean(): void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  doc: normalizeLabel({ id: "boot", name: "…" } as unknown as LabelTemplate, ""),
  past: [],
  future: [],
  selection: null,
  editingId: null,
  zoom: 100,
  panX: 0,
  panY: 0,
  leftTab: "add",
  complianceOpen: false,
  dirty: false,

  loadTemplate: (t) =>
    set({
      doc: normalizeLabel(t, ""),
      past: [],
      future: [],
      selection: null,
      editingId: null,
      zoom: 100,
      panX: 0,
      panY: 0,
      dirty: false,
    }),

  setDoc: (next, record = true) =>
    set((s) => ({
      doc: next,
      past: record ? pushHistory(s.past, s.doc) : s.past,
      future: record ? [] : s.future,
      dirty: true,
    })),

  updateField: (key, value, record = true) =>
    get().setDoc({ ...get().doc, [key]: value }, record),

  setElements: (elements, record = true) =>
    get().setDoc({ ...get().doc, elements }, record),

  patchElement: (id, patch, record = true) =>
    get().setElements(
      get().doc.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      record
    ),

  select: (id) => set({ selection: id, editingId: null }),
  setEditingId: (id) => set({ editingId: id }),
  setZoom: (zoom) => set({ zoom: Math.min(400, Math.max(25, zoom)) }),
  setPan: (panX, panY) => set({ panX, panY }),
  setLeftTab: (leftTab) => set({ leftTab }),
  toggleCompliance: () => set((s) => ({ complianceOpen: !s.complianceOpen })),

  undo: () =>
    set((s) => {
      const r = undoHistory(s.doc, s.past, s.future);
      return r ? { doc: r.doc, past: r.past, future: r.future, dirty: true } : {};
    }),

  redo: () =>
    set((s) => {
      const r = redoHistory(s.doc, s.past, s.future);
      return r ? { doc: r.doc, past: r.past, future: r.future, dirty: true } : {};
    }),

  markClean: () => set({ dirty: false }),
}));

export const selectCanUndo = (s: EditorState) => s.past.length > 0;
export const selectCanRedo = (s: EditorState) => s.future.length > 0;
export const selectElements = (s: EditorState) => ensureElements(s.doc);
export const selectSortedElements = (s: EditorState) =>
  [...ensureElements(s.doc)].sort((a, b) => a.z - b.z);
export const selectSelected = (s: EditorState) =>
  ensureElements(s.doc).find((e) => e.id === s.selection) || null;
```

Note: `loadTemplate` normalizes with empty website; Task 6's shell re-normalizes with the real profile site via `setDoc(normalizeLabel(t, profile.website), false)` after loading — document this contract in the shell task.

- [ ] **Step 8: Run store + history tests**

Run: `cd home-bakery-management-system && npx vitest run src/pages/LabelStudio`
Expected: PASS (all).

- [ ] **Step 9: Commit**

```bash
git add src/pages/LabelStudio
git commit -m "feat(labels): editor store with per-gesture history + template utils"
```

---

### Task 3: Shared label math (text resolution, wrap, guides, best-by, NFP rows)

**Files:**
- Create: `src/pages/LabelStudio/labelMath.ts`
- Create: `src/pages/LabelStudio/labelMath.test.ts`

**Interfaces:**
- Consumes: types from `../../types`; `disclaimerText` from `../../utils/disclaimer`.
- Produces:
  - `resolveBestBy(label: LabelTemplate, now?: Date): Date`
  - `formatBestBy(d: Date): string` — `"Aug 31"` style (en-US short month/day)
  - `effectiveText(el: LabelElement, label: LabelTemplate, profile: BusinessProfile, bestByStr?: string): string` — single source used by Konva text nodes AND the vector exporter (replaces exporter's private copy).
  - `wrapWords(text: string, measure: (s: string) => number, maxWidth: number): string[]` — greedy word wrap shared by renderers.
  - `computeSnap(moving: Rect, others: Rect[], threshold: number): { dx: number; dy: number; guidesX: number[]; guidesY: number[] }` where `Rect = { x: number; y: number; w: number; h: number }` in normalized units; threshold also normalized.
  - `NFP_ROWS: { key: keyof NfpData; label: string; indent: 0 | 1; bold?: boolean; dvThreshold?: number; group: "header" | "core" | "micro" }[]` — canonical row list matching `NutritionFactsPanel.tsx` order incl. vitamins; consumed by Konva NFP renderer (Task 4), inspector display (already fine), and vector PDF renderer (Task 11).

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import {
  resolveBestBy, formatBestBy, wrapWords, computeSnap, NFP_ROWS,
} from "./labelMath";
import type { LabelTemplate } from "../../types";

describe("resolveBestBy", () => {
  it("prefers stored snapshot", () => {
    const l = { bestByDate: "2026-01-15", bestByDays: 7 } as unknown as LabelTemplate;
    expect(resolveBestBy(l, new Date("2026-08-25")).toISOString().slice(0, 10)).toBe("2026-01-15");
  });
  it("computes now + days when no snapshot", () => {
    const l = { bestByDays: 7 } as unknown as LabelTemplate;
    expect(resolveBestBy(l, new Date("2026-08-25")).toISOString().slice(0, 10)).toBe("2026-09-01");
  });
});

describe("formatBestBy", () => {
  it("formats en-US short", () => {
    expect(formatBestBy(new Date(2026, 7, 25))).toBe("Aug 25");
  });
});

describe("wrapWords", () => {
  const measure = (s: string) => s.length; // 1 unit per char
  it("breaks greedily", () => {
    expect(wrapWords("aa bb cc dd", measure, 5)).toEqual(["aa bb", "cc dd"]);
  });
  it("keeps long words intact on their own line", () => {
    expect(wrapWords("aaaaaa bb", measure, 5)).toEqual(["aaaaaa", "bb"]);
  });
  it("returns single empty line for empty text", () => {
    expect(wrapWords("", measure, 5)).toEqual([""]);
  });
});

describe("computeSnap", () => {
  const others = [{ x: 0.5, y: 0.0, w: 0.2, h: 0.2 }];
  it("snaps right edge to neighbor left edge within threshold", () => {
    const r = computeSnap({ x: 0.29, y: 0.05, w: 0.2, h: 0.1 }, others, 0.02);
    expect(r.dx).toBeCloseTo(0.01); // 0.29+0.2=0.49 → snap to 0.5
    expect(r.guidesX).toContain(0.5);
  });
  it("snaps centers", () => {
    const r = computeSnap({ x: 0.41, y: 0.05, w: 0.2, h: 0.1 }, [{ x: 0.4, y: 0, w: 0.2, h: 0.2 }], 0.02);
    // moving center .51 → target center .50 → dx=-.01
    expect(r.dx).toBeCloseTo(-0.01);
  });
  it("no snap beyond threshold", () => {
    const r = computeSnap({ x: 0.2, y: 0.05, w: 0.2, h: 0.1 }, others, 0.02);
    expect(r.dx).toBe(0);
    expect(r.guidesX.length).toBe(0);
  });
});

describe("NFP_ROWS", () => {
  it("covers every NfpData field exactly once", () => {
    const fields = [
      "servingSize","servings","calories","totalFat","satFat","transFat","cholesterol",
      "sodium","totalCarb","fiber","sugars","addedSugars","protein",
      "vitD","calcium","iron","potassium","vitA","vitC",
    ];
    const keys = NFP_ROWS.map((r) => r.key);
    for (const f of fields) expect(keys).toContain(f);
    expect(keys.length).toBe(fields.length);
  });
  it("orders vitamins after protein", () => {
    const idx = (k: string) => NFP_ROWS.findIndex((r) => r.key === k);
    expect(idx("vitD")).toBeGreaterThan(idx("protein"));
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd home-bakery-management-system && npx vitest run src/pages/LabelStudio/labelMath.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement labelMath.ts**

```ts
import type { BusinessProfile, LabelElement, LabelTemplate, NfpData } from "../../types";
import { disclaimerText } from "../../utils/disclaimer";

export interface Rect { x: number; y: number; w: number; h: number }

export function resolveBestBy(label: LabelTemplate, now: Date = new Date()): Date {
  if (label.bestByDate) {
    const d = new Date(label.bestByDate);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date(now.getTime() + (label.bestByDays || 7) * 86400000);
}

export function formatBestBy(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function effectiveText(
  el: LabelElement,
  label: LabelTemplate,
  profile: BusinessProfile,
  bestByStr?: string
): string {
  const effName = label.businessName || profile.name || "";
  const effPhone = label.phoneNumber || profile.phone || "";
  const effReg = label.registrationNumber || profile.registrationNumber || "";
  const effAddr = label.address || profile.address || "";
  const isReg = label.businessIdMode === "registration";
  switch (el.field) {
    case "businessName": return effName;
    case "businessId":
      return isReg ? `${effPhone} · ${effReg}` : effAddr;
    case "productName": return label.productName || "";
    case "details": return label.details || "";
    case "ingredients": return label.ingredients ? `Ingredients: ${label.ingredients}` : "";
    case "allergens": return label.allergens || "";
    case "netWeight": return label.netWeightUS || label.netWeight || "";
    case "price": return label.showPrice ? label.price || "" : "";
    case "bestBy":
      return label.showBestBy ? `Best by ${bestByStr ?? formatBestBy(resolveBestBy(label))}` : "";
    case "disclaimer": return label.showDisclaimer ? disclaimerText() : "";
    default: return el.type === "text" ? el.text || "" : "";
  }
}

/** Greedy word wrap. `measure(line)` returns rendered width; caller supplies metrics. */
export function wrapLines(
  text: string,
  measure: (line: string) => number,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (measure(candidate) > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Snap `moving` rect against sibling rects + canvas edges/center.
 * Returns pixel deltas to apply and guide positions (normalized) that fired.
 */
export function computeSnap(
  moving: Rect,
  others: Rect[],
  threshold: number
): { dx: number; dy: number; guidesX: number[]; guidesY: number[] } {
  const xs: number[] = [0, 0.5, 1];
  const ys: number[] = [0, 0.5, 1];
  for (const o of others) {
    xs.push(o.x, o.x + o.w / 2, o.x + o.w);
    ys.push(o.y, o.y + o.h / 2, o.y + o.h);
  }
  const mLeft = moving.x, mCenterX = moving.x + moving.w / 2, mRight = moving.x + moving.w;
  const mTop = moving.y, mCenterY = moving.y + moving.h / 2, mBottom = moving.y + moving.h;

  let dx = 0, dy = 0;
  const guidesX: number[] = [], guidesY: number[] = [];
  let bestDx = threshold, bestDy = threshold;

  for (const t of xs) {
    for (const [m, delta] of [
      [mLeft, t - mLeft],
      [mCenterX, t - mCenterX],
      [mRight, t - mRight],
    ] as const) {
      const d = Math.abs(delta);
      if (d < bestDx) { bestDx = d; dx = delta; guidesX.length = 0; guidesX.push(t); }
    }
  }
  for (const t of ys) {
    for (const [m, delta] of [
      [mTop, t - mTop],
      [mCenterY, t - mCenterY],
      [mBottom, t - mBottom],
    ] as const) {
      const d = Math.abs(delta);
      if (d < bestDy) { bestDy = d; dy = delta; guidesY.length = 0; guidesY.push(t); }
    }
  }
  if (guidesX.length === 0) dx = 0;
  if (guidesY.length === 0) dy = 0;
  return { dx, dy, guidesX, guidesY };
}

export interface NfpRow {
  key: keyof NfpData;
  label: string;
  indent: 0 | 1;
  bold?: boolean;
  dvThreshold?: number; // % Daily Value denominator (2000-cal diet)
  group: "header" | "core" | "micro";
}

export const NFP_ROWS: NfpRow[] = [
  { key: "servingSize", label: "Serving size", indent: 0, bold: true, group: "header" },
  { key: "servings", label: "Servings", indent: 0, group: "header" },
  { key: "calories", label: "Calories", indent: 0, bold: true, group: "core" },
  { key: "totalFat", label: "Total Fat", indent: 0, bold: true, dvThreshold: 78, group: "core" },
  { key: "satFat", label: "Saturated Fat", indent: 1, dvThreshold: 20, group: "core" },
  { key: "transFat", label: "Trans Fat", indent: 1, group: "core" },
  { key: "cholesterol", label: "Cholesterol", indent: 0, dvThreshold: 300, group: "core" },
  { key: "sodium", label: "Sodium", indent: 0, dvThreshold: 2300, group: "core" },
  { key: "totalCarb", label: "Total Carbohydrate", indent: 0, bold: true, dvThreshold: 275, group: "core" },
  { key: "fiber", label: "Dietary Fiber", indent: 1, dvThreshold: 28, group: "core" },
  { key: "sugars", label: "Total Sugars", indent: 1, group: "core" },
  { key: "addedSugars", label: "Includes Added Sugars", indent: 1, dvThreshold: 50, group: "core" },
  { key: "protein", label: "Protein", indent: 0, bold: true, group: "core" },
  { key: "vitD", label: "Vitamin D", indent: 0, dvThreshold: 20, group: "micro" },
  { key: "calcium", label: "Calcium", indent: 0, dvThreshold: 1300, group: "micro" },
  { key: "iron", label: "Iron", indent: 0, dvThreshold: 18, group: "micro" },
  { key: "potassium", label: "Potassium", indent: 0, dvThreshold: 4700, group: "micro" },
  { key: "vitA", label: "Vitamin A", indent: 0, group: "micro" },
  { key: "vitC", label: "Vitamin C", indent: 0, group: "micro" },
];

export function dvPercent(raw: string, threshold?: number): string {
  const v = parseFloat(raw);
  if (!threshold || isNaN(v) || v <= 0) return "";
  return `${Math.round((v / threshold) * 100)}%`;
}
```

Note: keep the export name `wrapLines` consistent everywhere (tests above import `wrapWords` only as example naming — align BOTH to `wrapLines`; update the test file imports to `wrapLines` before running).

- [ ] **Step 4: Run math tests to green**

Run: `cd home-bakery-management-system && npx vitest run src/pages/LabelStudio/labelMath.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/LabelStudio/labelMath.ts src/pages/LabelStudio/labelMath.test.ts
git commit -m "feat(labels): shared label math — effectiveText, wrap, snapping, best-by, NFP rows"
```

---

### Task 4: Konva stage rendering (read-only parity)

**Files:**
- Create: `src/pages/LabelStudio/capture.ts` (stage capture helpers — minimal now, expanded Task 11)
- Create: `src/pages/LabelStudio/elements/ElementNode.tsx`
- Create: `src/pages/LabelStudio/StageCanvas.tsx`

**Interfaces:**
- Consumes: `useEditorStore`, selectors; `effectiveDimensions`, `ensureElements` from `components/label/defaultElements`; `effectiveText`, `wrapLines`, `resolveBestBy`, `formatBestBy`, `NFP_ROWS`, `dvPercent` from `./labelMath`; `QRCode` from `"qrcode"`.
- Produces:
  - `<StageCanvas />` — self-contained; reads everything from the store; renders Stage with layers `bgLayer`, `elementsLayer`, `overlayLayer` (overlay content arrives in Task 5).
  - `<ElementNode el={LabelElement} W={number} H={number} selected={boolean} registerRef={(id, node|null)=>void} />` — registers its root Konva node by element id (Transformer wiring in Task 5 uses this registry).
  - `contentBoxPx(effWin, effHin, scalePxPerIn): {W:number;H:number}` helper exported from StageCanvas for tests.
  - Font-family resolver: `firstFamily(cssStack: string): string` exported from ElementNode (Konva needs a single family name, e.g. `'Cormorant Garamond'`).

Rendering rules (must mirror current `LabelElementView`):
- Coordinates normalized 0..1 against the CONTENT box (inside border+padding), same as today: node x = el.x*W, width = el.w*W.
- Text: Konva `Text` with `width={el.w*W}`, `fontSize={(el.fontSizeOverride ?? 4)/100*W}` px, `lineHeight:1.2`, `align:(el.alignOverride||"center")`, fill `el.colorOverride||label.textColor`, fontFamily `firstFamily(el.fontFamilyOverride||label.font)`, fontStyle from bold/italic, opacity, rotation. Vertical anchor top (matches flex-start).
- Logo: emoji → `Text` centered in box with fontSize = min(boxH,boxW)*0.9; image logo (dataURL/url) → `Image` via `useImage`-style loader hook `useHtmlImage(src)` (implement locally with useState/useEffect + `new window.Image()`).
- QR: generate once per value via `QRCode.toDataURL(qrValue||website,{margin:1,width:256})` cached in a module-level Map; render as `Image`.
- Shapes: rect→`Rect`, circle→`Ellipse`, line/divider→`Line` points `[0,mid,w,mid]`, stroke `strokeColor||textColor`, strokeWidth `(strokeWidth||1)*0.5*(96*scale)` scaled? — simpler: strokeWidth in px = (el.strokeWidth||2)*0.75 constant visual; acceptable parity.
- NFP: Group containing white bg Rect + black border Rect + header band + rows built from `NFP_ROWS` (labels + values + %DV via `dvPercent`) using Arial/Helvetica font; row height = boxH/(rows+3).
- Hidden elements skipped; empty text skipped unless `selected || editing` (parity with current behavior).
- Background layer: rounded Rect (corner radius per shape: circle=full, oval=50% approximated via Ellipse, square=8*s, rounded=12*s) filled `bgColor` + optional `bgImage` Konva Image clipped to shape + 4px-equivalent accent border stroke `accentColor`.
- Shape clip for oval/circle applied via Group `clipFunc` so children can't overflow the curve (matches CSS overflow-hidden today).

- [ ] **Step 1: Implement firstFamily + useHtmlImage + capture helpers**

`capture.ts`:

```ts
export function contentBoxPx(effWIn: number, effHIn: number, pxPerIn: number) {
  return { W: Math.round(effWIn * pxPerIn), H: Math.round(effHIn * pxPerIn) };
}

export function firstFamily(stack: string): string {
  const m = stack.match(/'([^']+)'|"([^"]+)"/);
  return (m?.[1] || m?.[2] || stack.split(",")[0] || "sans-serif").trim();
}

const imgCache = new Map<string, HTMLImageElement>();

export function useHtmlImage(src: string | undefined): HTMLImageElement | undefined {
  const [img, setImg] = useImgState(src);
  return img;
}

// split out to keep hook rules simple
import { useEffect, useState } from "react";
function useImgState(src: string | undefined) {
  const [img, setImg] = useState<HTMLImageElement | undefined>(() =>
    src ? imgCache.get(src) : undefined
  );
  useEffect(() => {
    if (!src) { setImg(undefined); return; }
    const cached = imgCache.get(src);
    if (cached) { setImg(cached); return; }
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => { imgCache.set(src, im); setImg(im); };
    im.onerror = () => setImg(undefined);
    im.src = src;
  }, [src]);
  return [img, setImg] as const;
}

const qrCache = new Map<string, string>();
export async function qrDataUrl(value: string): Promise<string> {
  const hit = qrCache.get(value);
  if (hit) return hit;
  const url = await (await import("qrcode")).toDataURL(value, { margin: 1, width: 256 });
  qrCache.set(value, url);
  return url;
}

/** Hook: resolves QR data URL for a value ("", null while pending). */
export function useQrDataUrl(value: string): string | "" {
  const [url, setUrl] = useState<string>(() => qrCache.get(value) ?? "");
  useEffect(() => {
    let alive = true;
    if (qrCache.get(value)) { setUrl(qrCache.get(value)!); return; }
    qrDataUrl(value).then((u) => alive && setUrl(u)).catch(() => alive && setUrl(""));
    return () => { alive = false; };
  }, [value]);
  return url;
}
```

- [ ] **Step 2: Implement ElementNode.tsx**

Full component implementing the rendering rules above. Structure:

```tsx
import { Group, Image as KImage, Line, Rect, Text, Ellipse } from "react-konva";
import type { LabelElement, LabelTemplate } from "../../types";
import { effectiveText, wrapLines, NFP_ROWS, dvPercent, formatBestBy, resolveBestBy } from "../labelMath";
import { firstFamily, useHtmlImage, useQrDataUrl } from "../capture";
import type { BusinessProfile } from "../../types";

interface Props {
  el: LabelElement;
  label: LabelTemplate;
  profile: BusinessProfile;
  W: number; H: number;
  selected: boolean;
  editing: boolean;
  registerRef: (id: string, node: unknown | null) => void;
}
```

Implement each branch (`el.type`) as a local sub-component in the same file: `TextNode`, `LogoNode`, `QrNode`, `ShapeNode`, `NfpNode`. Each computes px geometry as `x: el.x*W, y: el.y*H, width: el.w*W, height: el.h*H`, applies `rotation={el.rotation||0}` (with `offset` center rotation: set `offsetX=w/2, offsetY=h/2, x+=w/2, y+=h/2` so rotation pivots around center like CSS), opacity, and registers its root node:

```tsx
<Group ref={(n) => registerRef(el.id, n)} {...common}>
  {/* branch content */}
</Group>
```

TextNode wraps via `wrapLines(text, (s)=>ctxMeasure(s, fontFamily, fontSizePx), el.w*W)` producing explicit `\n` joined lines passed to a single Konva `Text` with `wrap="none"` so Konva never re-wraps differently from the exporter (metrics via a module-level `document.createElement("canvas").getContext("2d")`). This is the screen/exporter parity point required by the spec.

NfpNode builds rows from `NFP_ROWS` (skip fully-empty micro rows when value empty AND not editing) with `%DV` right column via `dvPercent`.

- [ ] **Step 3: Implement StageCanvas.tsx**

```tsx
import { useMemo, useRef } from "react";
import { Layer, Rect, Stage } from "react-konva";
import type Konva from "konva";
import { useEditorStore, selectSortedElements, selectSelected } from "./state";
import { effectiveDimensions } from "../../components/label/defaultElements";
import { contentBoxPx } from "./capture";
import ElementNode from "./elements/ElementNode";

const PX_PER_IN_BASE = 96;

export default function StageCanvas({
  baseScale,
}: { baseScale: number }) {
  const doc = useEditorStore((s) => s.doc);
  const zoom = useEditorStore((s) => s.zoom);
  const pan = useEditorStore((s) => ({ x: s.panX, y: s.panY }));
  const selection = useEditorStore((s) => s.selection);
  const editingId = useEditorStore((s) => s.editingId);
  const select = useEditorStore((s) => s.select);
  const refs = useRef<Map<string, Konva.Node>>(new Map());
  const registerRef = (id: string, node: unknown | null) => {
    if (node) refs.current.set(id, node as Konva.Node);
    else refs.current.delete(id);
  };

  const { effW, effH } = effectiveDimensions(
    doc.labelWidth, doc.labelHeight, doc.shape, doc.orientation || "portrait"
  );
  const pxPerIn = PX_PER_IN_BASE * baseScale * (zoom / 100);
  const { W, H } = contentBoxPx(effW, effH, pxPerIn);

  const sorted = useEditorStore(selectSortedElements);
  const selectedEl = useEditorStore(selectSelected);
  void selectedEl; // overlay consumes selection in Task 5

  return (
    <Stage
      width={W}
      height={H}
      scaleX={1} scaleY={1}
      x={pan.x} y={pan.y}
      onMouseDown={(e) => {
        if (e.target === e.target.getStage()) select(null);
      }}
      onTouchStart={(e) => {
        if (e.target === e.target.getStage()) select(null);
      }}
    >
      <Layer ref={(l: Konva.Layer | null) => void (bgLayerRef.current = l)} listening={false}>
        {/* background rect + border + bgImage per rules */}
      </Layer>
      <Layer>
        {sorted.map((el) =>
          el.hidden ? null : (
            <ElementNode
              key={el.id}
              el={el}
              label={doc}
              profile={profileProp}
              W={W} H={H}
              selected={selection === el.id}
              editing={editingId === el.id}
              registerRef={registerRef}
            />
          )
        )}
      </Layer>
      <Layer>{/* Task 5: transformer + guides */}</Layer>
    </Stage>
  );
}
```

Complete the background layer per the rendering rules (shape corner radius map: circle → radius=W/2 on square Rect sized W×H; oval → Ellipse; square → radius 8*pxPerIn/96; rounded → 12*pxPerIn/96), accent border via `stroke={doc.accentColor} strokeWidth={4*pxPerInBaseScaleFactor}` where factor = baseScale*zoom/100 (≈3pt print parity), padding inset: elements live in content box, so draw bg/border on a slightly larger frame: outer frame = W+2*padPx × H+2*padPx with padPx = 3%(or 6% curved)*W, and offset the Stage coordinate origin accordingly (render outer frame at (-padPx,-padPx)). Keep this arithmetic in ONE local helper `frameGeometry(W,H,isCurved)` returning `{outer:{x,y,w,h}, radius}`.

`profileProp` comes from props: extend signature to `StageCanvas({ baseScale, profile }: { baseScale: number; profile: BusinessProfile })` — the shell (Task 6) passes it.

- [ ] **Step 4: Manual smoke check**

Run: `cd home-bakery-management-system && npm run dev` → open Labels page (still old designer — instead temporarily mount StageCanvas anywhere, e.g. add below old designer in App for this check, then remove).
Expected: template renders identically to old preview (fonts, positions, QR, shapes). Remove temp mount before commit.

- [ ] **Step 5: Commit**

```bash
git add src/pages/LabelStudio
git commit -m "feat(labels): konva stage renders templates read-only with exporter-parity text wrapping"
```

---

### Task 5: Gestures — drag, transform, pinch/pan, snapping

**Files:**
- Create: `src/pages/LabelStudio/hooks/useGestures.ts`
- Modify: `src/pages/LabelStudio/StageCanvas.tsx` (wire Transformer, drag handlers, guides overlay)

**Interfaces:**
- Consumes: store actions `patchElement(id, patch, record=true)`, `select`, `setZoom`, `setPan`; `computeSnap` from `../labelMath`; node registry refs from Task 4.
- Produces:
  - `useGestures(stageRef, containerRef, refs)` returning `{ bindStage: { onPointerDown... handled internally via Konva events }, beginPan, beginPinch }` — implementation attaches Konva event listeners internally; exposes nothing else.
  - Overlay: Konva `Transformer` configured:
    - `rotateEnabled`, `rotationSnaps={[0,15,30,…,345]}`, `rotationSnapTolerance={4}`
    - `keepRatio={selected is logo|qr|nfp}`
    - `enabledAnchors` all corners+mids except rotate knob separate (default)
    - anchor sizes scaled for touch: `anchorSize={12}`, `anchorStrokeWidth={2}`, `borderStroke={selection color}`, plus invisible hit-area: set `anchorSize` 12 but `hitStrokeWidth` large; ALSO enlarge touch via `boundBoxFunc` min size clamp `MIN_PX=24` on both axes (44px guidance applies to toolbar buttons; anchors at 12px visual + generous hit tolerated because Transformer anchors include ~10px invisible padding via `anchorCornerRadius` + stage `hitCanvas` pixel ratio — document acceptance: manual iPad check in Task 12).
  - Drag pipeline per element node: `draggable={!locked}`, `onDragStart` (store orig, hide guides), `onDragMove` (apply `computeSnap` deltas vs siblings in NORMALIZED space converted to px, position node, save guide coords to local state), `onDragEnd` (commit `patchElement(id, {x,y}, true)` with snapped values clamped 0..1-w/h; clear guides).
  - Transform end: convert node box back to normalized `{x,y,w,h,rotation}` and commit once.
  - Pinch/pan: two-pointer tracking on the Stage container div (pointer events, pointerId map): distance ratio → zoom around midpoint (call `setZoom(clamped)` + adjust pan so focal point stays fixed); single-finger drag on empty stage → pan (`setPan`). Wheel + ctrlKey/metaKey → zoom (trackpad pinch desktop); plain wheel scrolls page normally (do not hijack).

- [ ] **Step 1: Implement useGestures.ts**

Implement per interfaces above. Key conversion helpers inside the hook:

```ts
const toNorm = (node: Konva.Node, W: number, H: number) => {
  const box = node.getClientRect({ relativeTo: node.getParent() as Konva.Container });
  return {
    x: clamp01(box.x / W),
    y: clamp01(box.y / H),
    w: Math.min(1, box.width / W),
    h: Math.min(1, box.height / H),
    rotation: Math.round(node.rotation()) % 360,
  };
};
```

Pinch math (two pointers p1,p2):

```ts
const startDist = dist(p1, p2);
const startZoom = store.zoom;
// on move:
const k = dist(p1, p2) / startDist;
store.setZoom(startZoom * k);
// focal anchoring: keep midpoint stable by adjusting pan proportionally (standard formula)
```

- [ ] **Step 2: Wire overlay in StageCanvas**

Add to overlay layer: guides (two Konva Lines colored `#f43f5e` dashed when guides state non-empty), Transformer attached via `useEffect` on `selection`: `tr.nodes(selected ? [refs.current.get(selection)].filter(Boolean) : [])`. Add `onTransformEnd`/drag handlers onto ElementNode via new optional props threaded through (`onBeginInteract`, `onCommitGeometry(patch)`).

- [ ] **Step 3: Manual gesture check (desktop)**

Dev server: drag element → moves freely with snap near centers/edges, red guide flashes; release → single ⌘Z restores pre-drag position (ONE step, not many). Resize corner → aspect locked for logo/QR. Rotate → snaps near 15° multiples. Ctrl+wheel zooms about cursor.
Expected: fluid, no visible lag; console clean.

- [ ] **Step 4: Commit**

```bash
git add src/pages/LabelStudio
git commit -m "feat(labels): konva gestures — drag/transform/pinch/pan with smart snapping, one undo per gesture"
```

---

### Task 6: Full-screen shell, routing, top bar, keyboard

**Files:**
- Create: `src/pages/LabelStudio/index.tsx`
- Create: `src/pages/LabelStudio/panels/CompliancePanel.tsx` (stub this task: pill + slide-over scaffold; contents wired Task 9)
- Modify: `src/App.tsx`
- Modify: `src/components/Sidebar.tsx` (none expected — labels nav stays; verify no change needed)

**Interfaces:**
- Consumes: store; `useStore()` from `context/StoreContext` (`profile`, `labelTemplates`, `products`, `handleCreateLabel`, `handleUpdateLabel`, `handleDeleteLabel`, `handleUpdateProfile`); `validateLabel` from `utils/compliance`; `ComplianceScore` component (pill reuse).
- Produces:
  - `<LabelStudio filterByOrder?: string|null; filterByProduct?: string|null; onBack: () => void />`
  - App.tsx: when `page === "labels"`, AdminApp returns ONLY `<LabelStudio …/>` (no Sidebar/Topbar/main wrapper). Back restores prior page via new `returnTo` state (defaults `"dashboard"`).

Shell layout:

```
<div class="flex h-screen w-full flex-col bg-sand-50">
  <TopBar/>                      ← h-14, border-b
  <div class="flex min-h-0 flex-1">
    <LeftRail/>                  ← lg+: 280px column; <lg: bottom drawer (Task 8 adds tabs UI)
    <StageArea/>                 ← flex-1 centers StageCanvas with fit-to-view baseScale
    <InspectorColumn/>           ← lg+: 300px; placeholder this task
  </div>
</div>
```

TopBar contents L→R: Back button (ArrowLeft + "Dashboard"/prior page label), divider, editable template name input (updates `name` via `updateField("name",…)`), Undo/Redo buttons (disabled states from selectors), zoom out/percent/zoom in + "Fit" button (resets zoom 100 & pan 0), ComplianceScore pill (button → `toggleCompliance()`), Save button (primary palm; opens menu: Save / Duplicate as new — wire to handlers below), Export popover button (Download/PNG/JPG/"PDF exact"/"PDF vector"/Print/Open&Print/Share — buttons stubbed this task, wired Task 11; on <lg show compact icon set matching current mobile behavior).

Save logic (from old designer, adapted to store):
- If `doc.id !== "new"` and exists in `labelTemplates`: `handleUpdateLabel(doc.id, doc)` then `markClean()`.
- Else: `const saved = { ...doc, id: newId("label") }`; `await handleCreateLabel(saved)`; `setDoc(saved, false)`; `markClean()`.
- Duplicate-as-new: copy with `newId("label")`, name "Untitled Label", `templateKind:"custom"`, `productId:null`, create, load.

Launch params effect: on mount (and when filters change) — if `filterByProduct`, find product template (`templateKind==="product"` && productId match): load it or flag "missing product template" banner (reuse createProductTemplate flow from old designer, adapted). Else if `filterByOrder`, pick first matching order template else newest custom. Else first template or `makeFallback(profile.website)`. After load, call `setDoc(normalizeLabel(t, profile.website), false)` then `markClean()`.

Keyboard hook (window keydown, skip when target is input/textarea/contentEditable):
- ⌘/Ctrl+Z undo, +Shift redo, ⌘Y redo
- Delete/Backspace: delete selected (unless field==="disclaimer")
- ⌘D duplicate selected (offset +3%, z+1, select copy)
- ArrowKeys nudge selected by 1% (Shift: 5%), record=true but COALESCE rapid presses: maintain ref timestamp — if <600ms since previous arrow patch of same element, use `record=false` then a trailing timeout commits a marker entry via `setDoc(currentDoc, true)` trick: simplest correct approach — arrows always `record=true` EXCEPT within coalesce window where they `record=false` and schedule `commitCheckpoint()` = `setDoc(store.doc, true)` after 600ms idle. Implement `commitCheckpoint()` action? Avoid API growth: reuse `setDoc(get().doc, true)` from component via `useEditorStore.getState()`.

Unsaved guard: `beforeunload` when `dirty`; Back button when dirty → confirm modal ("Discard unsaved changes?" Keep editing / Discard) before `onBack()`.

Autosave draft (spec): debounced 800ms effect writing `localStorage["muyrico.labelstudio.draft"] = JSON.stringify({ id: doc.id, doc })` when dirty; cleared on markClean+save success. Restore flow lands with Templates tab (Task 8) — this task only writes the draft.

- [ ] **Step 1: Implement CompliancePanel stub** (slide-over right drawer, open state from store, title "Compliance", close X; body placeholder text "Wired in a later task").

- [ ] **Step 2: Implement index.tsx** per layout above (~220 lines). Fit-to-view `baseScale`: measure StageArea with ResizeObserver; `baseScale = min(availW*0.92/(effW*96), availH*0.92/(effH*96))` capped ≤3.

- [ ] **Step 3: Rewire App.tsx**

Track `returnTo`:

```tsx
const openLabels = (opts?: { order?: string | null; product?: string | null }) => {
  setReturnTo(page === "labels" ? returnTo : (page as Page));
  setLabelFilter(opts?.order ?? null);
  setLabelProductFilter(opts?.product ?? null);
  setPage("labels");
};
```

Replace existing `setPage("labels")` call sites (Products onOpenLabels, Orders setLabelFilter path, Topbar?) to use it; early-return render:

```tsx
if (page === "labels") {
  return (
    <LabelStudio
      filterByOrder={labelFilter}
      filterByProduct={labelProductFilter}
      onBack={() => setPage(returnTo || "dashboard")}
    />
  );
}
```

placed AFTER hooks, BEFORE the chrome JSX (hooks order safe: all hooks above the conditional return remain unconditional).

- [ ] **Step 4: Verify flows manually**

Dev server: Sidebar→Labels opens full-screen studio rendering current template; Products→Label opens that product context; Back returns; undo/redo/name-edit/save work; ⌘Z/⌘D/Delete/arrows behave; reload with dirty shows browser confirm.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/pages/LabelStudio
git commit -m "feat(labels): full-screen studio shell — top bar, routing, keyboard, autosave draft"
```

---

### Task 7: Left rail — Add tab (insert + document design controls)

**Files:**
- Create: `src/pages/LabelStudio/panels/AddTab.tsx`
- Modify: `src/pages/LabelStudio/index.tsx` (mount tab content; mobile drawer comes Task 8)

**Interfaces:**
- Consumes: store actions; reused components `ColorInput`, `ShapePalette`(adapted to call insert), `ProductTypeSelector` NOT here (compliance panel), `NetWeightInput` NOT here (inspector). Local constants moved/copied from old designer: `FONT_CHOICES`, `COLOR_PRESETS`, `SHAPES`, `LABEL_SIZES`, `EMOJI_CHOICES` (copy verbatim from `LabelDesigner.tsx:46-84`).
- Produces: `<AddTab />` sections stacked & scrollable:

1. **Insert element**: buttons grid — Text (adds free `type:"text"` element `text:"Double-tap to edit"`, field undefined), Divider, Rect, Circle, Line (via existing `defaultShapeElement`), Nutrition Facts (via `defaultNfpElement`). New ids via `newId("el")`, z = maxZ+1, centered defaults (x .3/y .42/w .4/h .08 for text), then `select(newId)`.
2. **Shape**: 4 shape buttons; on change apply `fitElementsToAspect` (from templateUtils) like old `changeShape` (prev/next effective dims comparison) — port that function's logic to use `fitElementsToAspect(els)` directly (it already handles overflow-only scaling).
3. **Size**: LABEL_SIZES grid + custom W/H inputs (min 1.57/1, max 4.3/8, step .1, onBlur commit both fields record=true) + Portrait/Landscape segmented control (disabled for square-ish).
4. **Palette**: COLOR_PRESETS swatch circles + 3 `ColorField`s (bg/accent/text) — recreate tiny `ColorField` locally (color input + label, from old :1748).
5. **Font**: select bound to `font` field (FONT_CHOICES).
6. **Logo**: upload button (FileReader dataURL ≤5MB, PNG/JPG/SVG validation identical to old `handleImageUpload`), None/X clear buttons, emoji grid, size range slider 8..40 → `logoSize` field.
7. **Background image**: upload/clear (`bgImage` field).
8. **Website & QR**: url input + "Show QR" checkbox toggling qr element hidden flag (find `field==="qr"`; if absent do nothing) — mirrors old behavior including `updateField("showDisclaimer"…)`-style sync NOT needed here.

All inputs write through `updateField(...)` (record=true) or `patchElement`/`setElements` as appropriate; every discrete user action = one history entry.

- [ ] **Step 1: Implement AddTab.tsx** (~260 lines JSX following the section list; reuse `.input`, Section card pattern `rounded-xl border border-sand-200 bg-white p-3`)
- [ ] **Step 2: Mount in shell left rail** under tab key `"add"`
- [ ] **Step 3: Manual check** — insert each element type; shape switch refits overflow; uploads validate; QR toggle works; each action undoable in ONE step.
- [ ] **Step 4: Commit**

```bash
git add src/pages/LabelStudio
git commit -m "feat(labels): Add tab — inserts, shape/size/orientation, palette, fonts, logo/bg, QR"
```

---

### Task 8: Left rail — Layers + Templates tabs, mobile drawers, onboarding

**Files:**
- Create: `src/pages/LabelStudio/panels/LayersTab.tsx`
- Create: `src/pages/LabelStudio/panels/TemplatesTab.tsx`
- Create: `src/pages/LabelStudio/OnboardingModal.tsx`
- Modify: `src/pages/LabelStudio/index.tsx` (rail tabs + <lg drawer behavior)

**Interfaces:**
- Consumes: store; `ELEMENT_LABELS` from defaultElements; StoreContext template collections/handlers; `makeFallback`,`normalizeLabel`.
- Produces: `<LayersTab/>`, `<TemplatesTab/>`, `<OnboardingModal/>`; index.tsx gains `ui.leftTab` segmented control (Add/Layers/Templates icons ≥44px) and `<lg` presentation: rail becomes bottom sheet drawer opened from a bottom bar (three icons), canvas full-width behind.

LayersTab rows (top-first = highest z): eye toggle (also syncs disclaimer master flag when field==="disclaimer" exactly like old LayersPanel usage), lock toggle, drag-to-reorder (HTML5 drag on desktop + long-press lift on touch is heavy — implement simple ▲▼ buttons for reorder instead: spec said drag reorder; ACCEPT simpler up/down arrows for v1, note deviation in PR), tap selects. Reorder assigns z sequentially via `setElements(reordered)`.

TemplatesTab: banner when `filterByOrder` ("Showing labels for MR-x — n generated"); "+ Duplicate as new" primary; groups Product / Custom / Order labels (collapsible) using recreated TemplateRow (open/delete/current-highlight styling from old :1542); product-missing card with "Create {product} template" (port `createProductTemplate` from old :337); auto-load-product effect ported from old :188 (guarded by loadedProductRef); recents pinned: store `localStorage["muyrico.labelstudio.recent"]` array of template ids (unshift on open, cap 6) rendered as chip row at top.

Draft restore banner (from Task 6 autosave): on mount, if stored draft exists AND draft.doc differs (JSON inequality) from loaded template with same id → amber banner "Restore unsaved changes from last session?" [Restore][Discard]; Restore → `setDoc(parsed.doc,false)+markClean? no—dirty=true`; Discard → clear storage key.

OnboardingModal: copy verbatim from `src/pages/LabelDesigner.tsx:1605-1737` (whole component + its steps array), adding imports (`useState`, types, lucide none). Trigger logic copied from old :209 (first-launch localStorage gate). Render inside studio root.

- [ ] **Step 1:** Implement LayersTab, TemplatesTab, OnboardingModal, drawer behavior
- [ ] **Step 2: Manual check** — iPad-size viewport (devtools iPad Pro): bottom tabs open sheets; reorder via arrows; template open/delete/duplicate; onboarding appears on fresh profile; draft restore banner appears after edit+reload.
- [ ] **Step 3: Commit**

```bash
git add src/pages/LabelStudio
git commit -m "feat(labels): layers/templates tabs, iPad drawers, onboarding, draft restore"
```

---

### Task 9: Right inspector (contextual properties) + compliance panel contents

**Files:**
- Create: `src/pages/LabelStudio/panels/Inspector.tsx`
- Create: `src/pages/LabelStudio/panels/DocumentInspector.tsx`
- Create: `src/pages/LabelStudio/panels/ElementInspector.tsx`
- Modify: `src/pages/LabelStudio/panels/CompliancePanel.tsx` (fill contents)

**Interfaces:**
- Consumes: `PropertiesInspector` (existing component — feed `el`, `onChange={(patch)=>patchElement(el.id,patch)}`); `ComplianceChecklist` (props `label`,`profile`,`onFix`,`onSelectElement` — map onFix targets: set store `fixTarget` field + open relevant surface: content fields focus DocumentInspector input via `data-fix-target` scroll-into-view like old `focusFixTarget`, element fixes call `select(elementId)`); `FontCompliancePanel` (`onFix={(id,cqw)=>patchElement(id,{fontSizeOverride:cqw})}`); `MILawReference`; `AllergenPicker`; `IngredientSorter`; `ProductTypeSelector`; `NetWeightInput`.
- Produces:
  - `<Inspector/>` switches on selection: none → `DocumentInspector`; element → `ElementInspector` (wraps PropertiesInspector + quick-action row: duplicate/lock/hide/front/back/delete mirroring old ElementToolbar semantics).
  - DocumentInspector form fields (each `data-fix-target` named as old): businessName, productName, details textarea, IngredientSorter, NetWeightInput pair, price+Show, bestByDays+Show, nutrientClaim checkbox + warning paragraph, businessIdMode segmented (registration/address) + phone/reg/address inputs, website fallback note. (AllergenPicker intentionally lives in compliance panel per spec.)
  - CompliancePanel body (slide-over): ComplianceScore summary, ComplianceChecklist, AllergenPicker block, MDARD disclaimer toggle + confirm modal (port modal JSX from old :1483-1512), ProductTypeSelector, nutrient-claim NFP notice, FontCompliancePanel, MILawReference.

- [ ] **Step 1:** Implement three panels; wire Inspector into shell right column (<lg: inspector becomes second bottom-sheet tab "Properties").
- [ ] **Step 2: Manual check** — selecting text shows font controls incl. pt floor warnings; checklist Fix buttons scroll/focus correct inputs; hiding disclaimer shows confirm modal + red banner parity.
- [ ] **Step 3: Commit**

```bash
git add src/pages/LabelStudio
git commit -m "feat(labels): contextual inspector + compliance slide-over with fix-it wiring"
```

---

### Task 10: Inline text editing

**Files:**
- Create: `src/pages/LabelStudio/InlineTextEdit.tsx`
- Modify: `src/pages/LabelStudio/StageCanvas.tsx` (dblclick/dbltap → setEditingId; render overlay portal outside Stage)

**Interfaces:**
- Consumes: store `editingId`, `doc`, `profile`; `effectiveText` (initial value), field writer: for field-backed elements commit via `updateField(field, value)`; for free text elements `patchElement(id,{text:value})`.
- Produces: floating absolutely-positioned `textarea` overlaid on the stage container at the element's screen rect (computed from stage container bounding rect + normalized geometry × current stage scale), styled transparent background matching color/font/size/align; "Done" pill button; commits on Done/blur; Esc cancels; iPad: listen `window.visualViewport` resize to keep Done button above keyboard.

Trigger: Konva `dblclick` + `dbltap` on text nodes (single tap still selects/moves).

- [ ] **Step 1:** Implement; wire trigger in ElementNode TextNode branch (`onDblClick`/`onDblTap` props from StageCanvas callbacks).
- [ ] **Step 2: Manual check** — double-tap ingredient text on iPad emulator: keyboard opens, edits land in DocumentInspector field too (same store), undo collapses typing session into entries per blur (accept multiple; refinement: coalesce via record=false during typing + checkpoint on blur — implement this way).
- [ ] **Step 3: Commit**

```bash
git add src/pages/LabelStudio
git commit -m "feat(labels): inline text editing overlay with iPad keyboard handling"
```

---

### Task 11: Export overhaul — raster-exact pipeline + vector fixes

**Files:**
- Modify: `src/pages/LabelStudio/capture.ts` (finish)
- Create: `src/utils/labelRasterPdf.ts`
- Modify: `src/utils/labelExport.ts` (targeted fixes only)
- Modify: `src/utils/labelExport.test.ts` (add cases)
- Modify: `src/pages/LabelStudio/index.tsx` (wire Export popover buttons)
- Test: `src/utils/labelRasterPdf.test.ts`, additions to `labelExport.test.ts`

**Interfaces:**
- Produces:
  - `capture.exportStagePng(stage: Konva.Stage, opts:{ dpi: number; effWIn: number }): Promise<{ dataUrl: string; widthPx: number }>` — hides overlay layer (`layer.visible(false)`, `stage.draw()`), computes `pixelRatio = effWIn*dpi/stage.width()`, `await document.fonts.ready`, `stage.toDataURL({ pixelRatio, mimeType })`, restore visibility. Throws Error with user-safe message on failure.
  - `labelRasterPdf.renderRasterPdf(dataUrl: string, opts: { effWIn; effHIn; sheet: AverySheetKey; copies?: number }): Promise<Uint8Array>` — Letter pages for sheet presets embedding the PNG ONCE and `drawImage` per cell (reuse AVERY layout table — EXPORT it from labelExport.ts as `AVERY_LAYOUTS`), single-label = page sized to label.
  - Vector fixes in labelExport.ts:
    1. `sniffImageMime(bytesOrDataUrl): "png"|"jpg"` — checks data-URL prefix then magic bytes (`89 50 4E 47` / `FF D8 FF`); `drawLogoElementOffset` uses it (kills silent logo drop).
    2. `drawLogoElementOffset` renders emoji logos: if `!label.logoImage && label.logoEmoji` → draw text via embedded font fallback Helvetica at size `min(w,h)*0.8` centered (emoji glyph may not embed — raster mode is the fidelity path; vector gets monochrome fallback char "●"? NO — draw emoji via Helvetica produces tofu; INSTEAD skip emoji with console.warn in vector mode and rely on raster default; log explicitly).
    3. `drawNfpElementOffset` rewritten to iterate `NFP_ROWS` (import from pages/LabelStudio/labelMath — or move NFP_ROWS to `src/utils/nfpRows.ts` to avoid utils→pages import; DO move it there and re-export from labelMath for compatibility) rendering label/value/%DV columns + vitamin block + footnote line; row height distributed by group counts.
    4. `effectiveText` replaced by import from `pages/LabelStudio/labelMath` (delete private copy; signatures already match).
    5. Best-by: use `resolveBestBy(label)` + `formatBestBy` (delete ad-hoc computation at :137-139).
    6. QR honors `el.qrValue || websiteUrl`.
    7. Empty catches: `catch {}` → `catch (err) { console.warn("labelExport:", err); throw new ExportError(...) }` where user-facing paths catch ExportError → toast.
- Wire-up: Export menu buttons call: PNG/JPG → download dataURL (existing link-click util pattern); "PDF exact" → `exportStagePng` + `renderRasterPdf` + existing `downloadPdf`/`printPdf`/`sharePdf`/`openPdfInNewTab`; "PDF vector"/Print-sheet(Avery)/Open&Print/Share keep calling `renderLabelPdf` paths unchanged. Avery preset selector stays in Add tab (moved from AverySheet? KEEP `AverySheet` component mounted in compliance? Spec places Avery printing under export menu: render `AverySheet` picker INSIDE Export popover).

- [ ] **Step 1: Write failing tests (vector fixes)**

Append to `labelExport.test.ts`:

```ts
import { sniffImageMime } from "./labelExport"; // adjust import list at top

describe("sniffImageMime", () => {
  it("detects png data url", () => {
    expect(sniffImageMime("data:image/png;base64,iVBOR")).toBe("png");
  });
  it("detects jpg data url", () => {
    expect(sniffImageMime("data:image/jpeg;base64,/9j/")).toBe("jpg");
  });
  it("detects png magic bytes", () => {
    expect(sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe("png");
  });
  it("detects jpeg magic bytes", () => {
    expect(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
  });
  it("throws on unknown", () => {
    expect(() => sniffImageMime(new Uint8Array([1, 2, 3]))).toThrow();
  });
});
```

Plus a regression test: render single-label vector PDF for template with `logoImage: tinyPngDataUrl` fixture (build 1×1 PNG base64 in test) → assert no throw AND `pdfDoc.embeddedImages` count ≥1 via `PDFDocument.load(bytes)` then `(doc.context.enumerateIndirectObjects().filter(([r]) => r instanceof PDFRawStream)).length >= 1`.

- [ ] **Step 2: Run to verify fail** — `npx vitest run src/utils/labelExport.test.ts` → sniffImageMime missing.

- [ ] **Step 3: Implement fixes** (per interfaces; move NFP_ROWS to `src/utils/nfpRows.ts` first, update labelMath to re-export).

- [ ] **Step 4: Tests green** — full utils suite passes.

- [ ] **Step 5: Raster path + tests**

`labelRasterPdf.test.ts`: fake 2×2px PNG dataUrl fixture → `renderRasterPdf(...,{effWIn:3,effHIn:4,sheet:"single"})` → loads as PDFDocument, page count 1, page size ≈216×288pt; sheet "5164" copies default 6 → 1 letter page 612×792.

- [ ] **Step 6: Wire Export popover** in studio top bar (buttons enabled/disabled by platform: Share hidden when `!navigator.canShare`).

- [ ] **Step 7: Manual export matrix** — PNG/JPG/PDF-exact/PDF-vector/Print/Open&Print/Share on desktop Safari; AirDrop PDF to iPad → Munbyn app prints exact-preview correctly; printed Avery 5164 sheet aligns (print one physical sheet).

- [ ] **Step 8: Commit**

```bash
git add src/utils src/pages/LabelStudio
git commit -m "feat(labels): raster-exact export pipeline + vector pdf fixes (logo mime, NFP rows, best-by, QR)"
```

---

### Task 12: Delete legacy designer + final verification

**Files:**
- Delete: `src/pages/LabelDesigner.tsx`
- Delete: `src/components/label/LabelCanvas.tsx`, `LabelElementView.tsx`, `useElementDrag.ts`, `ElementToolbar.tsx`, `ZoomControl.tsx`, `LayersPanel.tsx`, `UndoRedoBar.tsx`, `ShapePalette.tsx` (verify no remaining imports first — grep each)
- Keep: `PropertiesInspector`, `ComplianceChecklist`, `ComplianceScore`, `FontCompliancePanel`, `AllergenPicker`, `IngredientSorter`, `ProductTypeSelector`, `NetWeightInput`, `MILawReference`, `AverySheet`, `NutritionFactsPanel`, `defaultElements.ts`, `ColorInput`
- Modify: any files still importing deleted ones (App.tsx already switched in Task 6)

- [ ] **Step 1:** Grep imports of each deletion candidate; remove stragglers.
- [ ] **Step 2:** Full suite: `npx vitest run` → all pass.
- [ ] **Step 3:** Production build: `npm run build && bash postbuild.sh` → succeeds; note bundle size delta vs main (~+150KB gz expected from konva).
- [ ] **Step 4: iPad acceptance checklist (manual, record results in PR description):**
  - Drag each element type @60fps (no visible lag, no selection flicker)
  - Pinch-zoom smoothness; two-finger pan; Fit button
  - Handles reachable with finger; rotate snap at 15°
  - Double-tap inline edit with on-screen keyboard; Done commits; visualViewport keeps Done visible
  - Undo/redo via toolbar after each gesture type
  - Reprint path: Orders → labels → open → tweak date → Share → Munbyn prints
  - Both PDF modes printed once each; Avery 5164 physical alignment OK
  - Draft-restore banner after force-kill Safari mid-edit
- [ ] **Step 5: Commit**

```bash
git rm -r --cached src/pages/LabelDesigner.tsx >/dev/null 2>&1 || true
git add -A
git commit -m "refactor(labels): delete legacy DOM designer after studio parity verified"
```

---

## Self-Review Notes (completed during planning)

- **Spec coverage:** engine/tasks 4-5; layout 6-9; gestures 5,10; compliance 9; exports 11 (+spec correction on NFP direction honored); reliability 6 (autosave/guards) + 8 (restore); testing 2,3,11 + 12 checklist; compat 12. Deviation logged: layers reorder ships as ▲▼ buttons instead of drag (touch simplicity) — revisit post-v1.
- **Types consistency:** store API names used across tasks match Task 2 definitions; `wrapLines` naming unified; NFP_ROWS final home is `src/utils/nfpRows.ts` (Task 11 move) with labelMath re-export so Task 4 imports stay valid.
- **Known risk called out in-plan:** Konva anchor touch size — mitigated by manual checklist item; escalate if iPad test fails.
