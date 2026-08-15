# Inventory Low-Stock Dashboard Widget — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard's passive low-stock alert chips with an actionable widget offering inline +/- steppers and a Restock dialog (amount received is added to stock).

**Architecture:** A pure sorting helper in `src/utils/lowStock.ts` feeds a new presentational component `src/components/InventoryLowStockWidget.tsx`, which reads/writes inventory through the existing `useStore()` API and is rendered by `Dashboard.tsx` in place of the alert chips.

**Tech Stack:** React 19 + TypeScript, Tailwind 4, lucide-react icons, Vitest 4 (jsdom, `react-dom/client` `createRoot` + `act` — no testing-library).

## Global Constraints

- Working directory for all commands: `home-bakery-management-system/`
- Test command: `npm test` (runs `vitest run`); single file: `npx vitest run <path>`
- Typecheck: `npx tsc --noEmit` (strict, `noUnusedLocals`, `noUnusedParameters` — unused imports fail)
- Build: `npm run build` (vite + postbuild copies `dist/index.html` to `../admin/index.html`)
- UI tokens: `palm` (green CTA), `hibiscus` (danger), `coral` (warn/link), `sand`/`cocoa` (neutrals), `font-serif` for card headings; cards use `rounded-xl border border-sand-200 bg-white shadow-sm`
- Writes to inventory ALWAYS go through `apiUpdateInventoryItem(id, patch)` from `useStore()` — never direct API calls
- Quantity values: clamp at 0, round to 2 decimals via `+(n).toFixed(2)`
- No `alert()` — errors are inline text
- Spec: `docs/superpowers/specs/2026-08-15-inventory-lowstock-widget-design.md`

---

### Task 1: `sortLowStock` Sorting Helper

**Files:**
- Create: `src/utils/lowStock.ts`
- Test: `src/utils/lowStock.test.ts`

**Interfaces:**
- Produces: `sortLowStock(items: InventoryItem[], limit?: number): InventoryItem[]` — filters to items with `quantity <= reorderLevel`, sorts out-of-stock first (qty <= 0), then by percentage shortfall below reorder level descending, ties alphabetically by name; returns at most `limit` items when provided.

- [ ] **Step 1: Write the failing test**

Create `src/utils/lowStock.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sortLowStock } from "./lowStock";
import type { InventoryItem } from "../types";

const mk = (partial: Partial<InventoryItem>): InventoryItem => ({
  id: "inv-1", name: "Item", category: "Dry Goods", quantity: 1, unit: "each",
  reorderLevel: 5, costPerUnit: 1, supplier: "", active: true, ...partial,
});

describe("sortLowStock", () => {
  it("returns only items at or below reorder level", () => {
    const out = sortLowStock([
      mk({ id: "a", name: "Low", quantity: 2, reorderLevel: 5 }),
      mk({ id: "b", name: "Fine", quantity: 8, reorderLevel: 5 }),
    ]);
    expect(out.map((i) => i.id)).toEqual(["a"]);
  });

  it("sorts out-of-stock first, then by shortfall percentage descending, ties alphabetically", () => {
    const out = sortLowStock([
      mk({ id: "a", name: "Zeta", quantity: 3, reorderLevel: 5 }),
      mk({ id: "b", name: "Beta", quantity: 3, reorderLevel: 5 }),
      mk({ id: "c", name: "Empty", quantity: 0, reorderLevel: 2 }),
      mk({ id: "d", name: "Almost", quantity: 1, reorderLevel: 10 }),
    ]);
    expect(out.map((i) => i.id)).toEqual(["c", "d", "b", "a"]);
  });

  it("caps results at the given limit", () => {
    const items = Array.from({ length: 5 }, (_, n) =>
      mk({ id: `i${n}`, name: `Item ${n}`, quantity: 0, reorderLevel: 1 }),
    );
    expect(sortLowStock(items, 3)).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/lowStock.test.ts`
Expected: FAIL — `Failed to resolve import "./lowStock"` (file does not exist).

- [ ] **Step 3: Write the implementation**

Create `src/utils/lowStock.ts`:

```ts
import type { InventoryItem } from "../types";

export function sortLowStock(items: InventoryItem[], limit?: number): InventoryItem[] {
  const low = items
    .filter((i) => i.quantity <= i.reorderLevel)
    .map((i) => ({ item: i, shortfall: shortfallPct(i) }));
  low.sort((a, b) => {
    const aOut = a.item.quantity <= 0 ? 1 : 0;
    const bOut = b.item.quantity <= 0 ? 1 : 0;
    if (aOut !== bOut) return bOut - aOut;
    if (a.shortfall !== b.shortfall) return b.shortfall - a.shortfall;
    return a.item.name.localeCompare(b.item.name);
  });
  const result = low.map((x) => x.item);
  return limit == null ? result : result.slice(0, limit);
}

function shortfallPct(i: InventoryItem): number {
  if (i.reorderLevel <= 0) return i.quantity <= 0 ? 1 : 0;
  return Math.max(0, (i.reorderLevel - i.quantity) / i.reorderLevel);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/lowStock.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add home-bakery-management-system/src/utils/lowStock.ts home-bakery-management-system/src/utils/lowStock.test.ts
git commit -m "feat(inventory): low-stock sort helper with tests"
```

---

### Task 2: `InventoryLowStockWidget` Component

**Files:**
- Create: `src/components/InventoryLowStockWidget.tsx`
- Create: `src/components/InventoryLowStockWidget.test.tsx`
- Modify: `src/components/ui/Badge.tsx` (add `out` tone)
- Modify: `docs/superpowers/specs/2026-08-15-inventory-lowstock-widget-design.md` (badge color note — see Step 7)

**Interfaces:**
- Consumes: `sortLowStock` from Task 1; `useStore()` → `{ inventory, apiUpdateInventoryItem }`; `Modal` (`open, onClose, title, children`), `Badge` (`children, tone`).
- Produces: `<InventoryLowStockWidget onManageInventory: () => void />` — used by Task 3. Rows carry `aria-label`s: `Decrease <name>`, `Increase <name>`, `Restock <name>`. Restock dialog submit button text is `Add to stock`.

- [ ] **Step 1: Write the failing test**

Create `src/components/InventoryLowStockWidget.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import InventoryLowStockWidget from "./InventoryLowStockWidget";
import type { InventoryItem } from "../types";

vi.mock("../context/StoreContext", () => ({ useStore: vi.fn() }));

import { useStore } from "../context/StoreContext";

const mockedUseStore = useStore as unknown as ReturnType<typeof vi.fn>;

const mkItem = (partial: Partial<InventoryItem>): InventoryItem => ({
  id: "inv-1", name: "Flour", category: "Dry Goods", quantity: 2, unit: "lb",
  reorderLevel: 5, costPerUnit: 1, supplier: "", active: true, ...partial,
});

function renderWidget(inventory: InventoryItem[]) {
  const apiUpdateInventoryItem = vi.fn().mockResolvedValue(undefined);
  mockedUseStore.mockReturnValue({ inventory, apiUpdateInventoryItem });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<InventoryLowStockWidget onManageInventory={() => {}} />));
  return { container, root, apiUpdateInventoryItem };
}

function cleanup(root: ReturnType<typeof createRoot>, container: HTMLElement) {
  act(() => root.unmount());
  container.remove();
}

function click(container: HTMLElement, selector: string) {
  const el = container.querySelector<HTMLButtonElement>(selector);
  expect(el).toBeTruthy();
  act(() => el!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function clickByText(container: HTMLElement, text: string) {
  const btn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);
  expect(btn).toBeTruthy();
  act(() => btn!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function setNumberInput(container: HTMLElement, value: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="number"]');
  expect(input).toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function flush() {
  await act(async () => { await Promise.resolve(); });
}

describe("InventoryLowStockWidget", () => {
  beforeEach(() => mockedUseStore.mockReset());

  it("renders low-stock rows sorted by severity and skips healthy items", () => {
    const { container, root } = renderWidget([
      mkItem({ id: "ok", name: "Healthy", quantity: 10, reorderLevel: 5 }),
      mkItem({ id: "zero", name: "Empty Box", quantity: 0, reorderLevel: 2 }),
      mkItem({ id: "low", name: "Almost Out", quantity: 1, reorderLevel: 10 }),
    ]);
    const text = container.textContent ?? "";
    expect(text).not.toContain("Healthy");
    expect(text.indexOf("Empty Box")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Empty Box")).toBeLessThan(text.indexOf("Almost Out"));
    expect(text).toContain("Out");
    expect(text).toContain("Low");
    expect(text).toContain("(2)");
    cleanup(root, container);
  });

  it("shows the empty state when nothing is low", () => {
    const { container, root } = renderWidget([
      mkItem({ id: "ok", name: "Healthy", quantity: 10, reorderLevel: 5 }),
    ]);
    expect(container.textContent).toContain("All stocked up");
    cleanup(root, container);
  });

  it("increments stock when the + stepper is clicked", async () => {
    const { container, root, apiUpdateInventoryItem } = renderWidget([
      mkItem({ id: "zero", name: "Empty Box", quantity: 0, reorderLevel: 2 }),
    ]);
    click(container, 'button[aria-label="Increase Empty Box"]');
    await flush();
    expect(apiUpdateInventoryItem).toHaveBeenCalledWith("zero", { quantity: 1 });
    cleanup(root, container);
  });

  it("disables the − stepper at zero stock", () => {
    const { container, root } = renderWidget([
      mkItem({ id: "zero", name: "Empty Box", quantity: 0, reorderLevel: 2 }),
    ]);
    const btn = container.querySelector<HTMLButtonElement>('button[aria-label="Decrease Empty Box"]');
    expect(btn?.disabled).toBe(true);
    cleanup(root, container);
  });

  it("restock dialog adds the received amount to current stock", async () => {
    const { container, root, apiUpdateInventoryItem } = renderWidget([
      mkItem({ id: "f", name: "Flour", quantity: 2, reorderLevel: 5 }),
    ]);
    click(container, 'button[aria-label="Restock Flour"]');
    expect(container.textContent).toContain("Current stock");
    setNumberInput(container, "3");
    clickByText(container, "Add to stock");
    await flush();
    expect(apiUpdateInventoryItem).toHaveBeenCalledWith("f", { quantity: 5 });
    cleanup(root, container);
  });

  it("rejects a non-positive restock amount and shows an error", async () => {
    const { container, root, apiUpdateInventoryItem } = renderWidget([
      mkItem({ id: "f", name: "Flour", quantity: 2, reorderLevel: 5 }),
    ]);
    click(container, 'button[aria-label="Restock Flour"]');
    setNumberInput(container, "0");
    clickByText(container, "Add to stock");
    await flush();
    expect(apiUpdateInventoryItem).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Enter a positive amount received");
    cleanup(root, container);
  });

  it("shows a +N more footer when more than 8 items are low", () => {
    const items = Array.from({ length: 10 }, (_, n) =>
      mkItem({ id: `i${n}`, name: `Item ${n}`, quantity: 0, reorderLevel: 1 }),
    );
    const { container, root } = renderWidget(items);
    expect(container.textContent).toContain("+2 more");
    expect(container.textContent).not.toContain("Item 9");
    cleanup(root, container);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/InventoryLowStockWidget.test.tsx`
Expected: FAIL — `Failed to resolve import "./InventoryLowStockWidget"` (file does not exist).

- [ ] **Step 3: Write the component**

Create `src/components/InventoryLowStockWidget.tsx`:

```tsx
import { useMemo, useState } from "react";
import { Minus, PackageX, Plus } from "lucide-react";
import { useStore } from "../context/StoreContext";
import Modal from "./ui/Modal";
import Badge from "./ui/Badge";
import { sortLowStock } from "../utils/lowStock";
import type { InventoryItem } from "../types";

const MAX_ROWS = 8;

export default function InventoryLowStockWidget({ onManageInventory }: { onManageInventory: () => void }) {
  const { inventory, apiUpdateInventoryItem } = useStore();
  const [restockItem, setRestockItem] = useState<InventoryItem | null>(null);
  const [received, setReceived] = useState("");
  const [restockErr, setRestockErr] = useState("");
  const [rowErr, setRowErr] = useState<string | null>(null);

  const visible = useMemo(() => sortLowStock(inventory, MAX_ROWS), [inventory]);
  const totalLow = useMemo(() => sortLowStock(inventory).length, [inventory]);
  const hiddenCount = Math.max(0, totalLow - visible.length);

  async function step(item: InventoryItem, delta: number) {
    const next = Math.max(0, +(item.quantity + delta).toFixed(2));
    if (next === item.quantity) return;
    setRowErr(null);
    try {
      await apiUpdateInventoryItem(item.id, { quantity: next });
    } catch (err: any) {
      setRowErr(`Couldn't update "${item.name}": ${err?.message || "request failed"}`);
    }
  }

  function openRestock(item: InventoryItem) {
    setRestockItem(item);
    setReceived("");
    setRestockErr("");
  }

  async function submitRestock() {
    if (!restockItem) return;
    const amount = Number(received);
    if (!received.trim() || !Number.isFinite(amount) || amount <= 0) {
      setRestockErr("Enter a positive amount received.");
      return;
    }
    try {
      await apiUpdateInventoryItem(restockItem.id, { quantity: +(restockItem.quantity + amount).toFixed(2) });
      setRestockItem(null);
    } catch (err: any) {
      setRestockErr(`Failed to restock: ${err?.message || err}`);
    }
  }

  return (
    <div className="rounded-xl border border-sand-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-sand-100 px-5 py-4">
        <h3 className="font-serif text-sm font-semibold text-cocoa">
          Low stock
          {totalLow > 0 && <span className="ml-1.5 text-hibiscus">({totalLow})</span>}
        </h3>
        <button onClick={onManageInventory} className="text-xs font-medium text-coral hover:underline">
          Manage inventory →
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-5 py-10 text-center">
          <PackageX size={22} className="text-palm" />
          <p className="text-sm text-cocoa-muted">All stocked up — nothing is low right now.</p>
        </div>
      ) : (
        <div className="divide-y divide-sand-100">
          {visible.map((i) => (
            <div key={i.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-cocoa">{i.name}</p>
                <p className="text-xs text-cocoa-muted">
                  {i.quantity} {i.unit} left · reorder at {i.reorderLevel} {i.unit}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={i.quantity <= 0 ? "out" : "low"}>{i.quantity <= 0 ? "Out" : "Low"}</Badge>
                <button
                  onClick={() => step(i, -1)}
                  disabled={i.quantity <= 0}
                  aria-label={`Decrease ${i.name}`}
                  className="rounded-md border border-sand-200 p-1 text-cocoa-muted hover:bg-sand-100 disabled:opacity-40"
                >
                  <Minus size={12} />
                </button>
                <button
                  onClick={() => step(i, 1)}
                  aria-label={`Increase ${i.name}`}
                  className="rounded-md border border-sand-200 p-1 text-cocoa-muted hover:bg-sand-100"
                >
                  <Plus size={12} />
                </button>
                <button
                  onClick={() => openRestock(i)}
                  aria-label={`Restock ${i.name}`}
                  className="rounded-lg border border-palm/30 px-2.5 py-1.5 text-xs font-medium text-palm transition hover:bg-palm/5"
                >
                  Restock
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {rowErr && (
        <div className="border-t border-sand-100 px-5 py-2.5">
          <p className="text-xs text-hibiscus">{rowErr}</p>
        </div>
      )}

      {hiddenCount > 0 && (
        <div className="border-t border-sand-100 px-5 py-3">
          <button onClick={onManageInventory} className="text-xs font-medium text-coral hover:underline">
            +{hiddenCount} more — view all in Inventory
          </button>
        </div>
      )}

      <Modal
        open={!!restockItem}
        onClose={() => setRestockItem(null)}
        title={restockItem ? `Restock — ${restockItem.name}` : "Restock"}
      >
        <div className="space-y-3">
          <p className="text-sm text-cocoa-muted">
            Current stock: <span className="font-semibold text-cocoa">{restockItem?.quantity} {restockItem?.unit}</span>
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium text-cocoa-muted">Amount received</label>
            <input
              type="number"
              step="0.01"
              min="0"
              autoFocus
              value={received}
              onChange={(e) => setReceived(e.target.value)}
              className="input"
            />
          </div>
          {restockErr && <p className="text-xs text-hibiscus">{restockErr}</p>}
          <button
            onClick={submitRestock}
            className="w-full rounded-xl bg-palm py-2.5 text-sm font-semibold text-white transition hover:shadow-md"
          >
            Add to stock
          </button>
        </div>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 4: Add the `out` badge tone**

In `src/components/ui/Badge.tsx`, add one line to `STATUS_STYLES` (after the `overdue` entry, before `today`):

```ts
  overdue: "bg-hibiscus/10 text-hibiscus ring-hibiscus/30",
  out: "bg-hibiscus text-white ring-hibiscus",
  today: "bg-coral-light/30 text-coral ring-coral/30",
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/InventoryLowStockWidget.test.tsx src/utils/lowStock.test.ts`
Expected: PASS — 10 tests (7 widget + 3 helper).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Update the design doc badge note**

In `docs/superpowers/specs/2026-08-15-inventory-lowstock-widget-design.md`, replace:

```
  - Severity badge: "Out" (qty <= 0, hibiscus) or "Low" (coral)
```

with:

```
  - Severity badge: "Out" (qty <= 0, new solid-hibiscus `out` Badge tone) or "Low" (existing `low` tone, matching the Inventory page badge)
```

- [ ] **Step 8: Commit**

```bash
git add home-bakery-management-system/src/components/InventoryLowStockWidget.tsx home-bakery-management-system/src/components/InventoryLowStockWidget.test.tsx home-bakery-management-system/src/components/ui/Badge.tsx docs/superpowers/specs/2026-08-15-inventory-lowstock-widget-design.md
git commit -m "feat(inventory): actionable low-stock dashboard widget"
```

---

### Task 3: Wire the Widget into the Dashboard

**Files:**
- Modify: `src/pages/Dashboard.tsx` (replace low-stock alert chips section; remove now-unused `AlertTriangle` import; add widget import)

**Interfaces:**
- Consumes: `InventoryLowStockWidget` with `onManageInventory` from Task 2.
- Produces: Dashboard renders the widget where the alert chips section was; the "Low stock items" StatCard and its `stats` computation stay unchanged.

- [ ] **Step 1: Replace the alert chips section**

In `src/pages/Dashboard.tsx`, replace this entire block (the `{/* Low stock alerts */}` section through its closing `)}`):

```tsx
      {/* Low stock alerts */}
      {stats.lowStock.length > 0 && (
        <div className="rounded-xl border border-hibiscus-light/30 bg-hibiscus-light/10 p-5">
          {(() => {
            const critical = stats.lowStock.filter((i) => i.quantity <= 0);
            const low = stats.lowStock.filter((i) => i.quantity > 0);
            return (
              <>
                {critical.length > 0 && (
                  <div className="mb-3">
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-hibiscus">
                      <AlertTriangle size={16} /> Critical ({critical.length})
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {critical.map((i) => (
                        <span key={i.id} className="flex items-center gap-1.5 rounded-full bg-hibiscus/15 px-3 py-1.5 text-xs font-medium text-hibiscus ring-1 ring-inset ring-hibiscus/30">
                          {i.name} — {i.quantity} {i.unit} left
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {low.length > 0 && (
                  <div>
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-coral">
                      <PackageX size={16} /> Low ({low.length})
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {low.map((i) => (
                        <span key={i.id} className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-coral shadow-sm ring-1 ring-inset ring-coral/20">
                          {i.name} — {i.quantity} {i.unit} left
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            );
          })()}
          <button onClick={() => setPage("inventory")} className="mt-3 text-xs font-medium text-hibiscus hover:underline">
            Manage inventory →
          </button>
        </div>
      )}
```

with:

```tsx
      <InventoryLowStockWidget onManageInventory={() => setPage("inventory")} />
```

- [ ] **Step 2: Fix imports**

In `src/pages/Dashboard.tsx`, remove `AlertTriangle,` from the lucide-react import list (it was only used by the chips section; leaving it breaks `noUnusedLocals` typecheck). `PackageX` stays — the StatCard still uses it.

Add the widget import after the `DashboardUpcomingWidget` import:

```tsx
import InventoryLowStockWidget from "../components/InventoryLowStockWidget";
```

- [ ] **Step 3: Typecheck and run the full test suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 4: Manual smoke check**

Run `npm run dev`, open the dashboard in the browser, and verify:
- Widget replaces the old chips section; low items appear sorted (zero-quantity first).
- Clicking +/− updates stock (watch the number change after refresh).
- Restock opens the dialog; entering `5` and submitting adds 5 to current stock.
- Empty state renders when no item is low.

- [ ] **Step 5: Commit**

```bash
git add home-bakery-management-system/src/pages/Dashboard.tsx
git commit -m "feat(dashboard): actionable low-stock widget replaces alert chips"
```

---

### Task 4: Full Verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass, including `lowStock.test.ts` and `InventoryLowStockWidget.test.tsx`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds; postbuild copies `dist/index.html` to `../admin/index.html`. If that file changes on disk, inspect `git status` — commit it only if `admin/index.html` shows a diff (it will, since the bundle embeds the new widget):

```bash
git status --short
git add admin/index.html
git commit -m "build(admin): ship inventory low-stock widget bundle"
```

If there is no diff, skip the commit.

- [ ] **Step 4: Final review of diff**

Run: `git log --oneline -5` — expect the four commits from Tasks 1–4 in order.

---

## Self-Review Notes

- Spec coverage: sorting helper (Task 1) ✓; widget rows/badges/steppers/restock/empty state/+N footer (Task 2) ✓; replaces chips, StatCard unchanged (Task 3) ✓; error handling inline, no alerts (Task 2 code) ✓; testing via vitest + createRoot (Tasks 1–2) ✓.
- Out of scope honored: Inventory page untouched, no scan-history writes, no optimistic updates, no supplier/shopping-list features.
