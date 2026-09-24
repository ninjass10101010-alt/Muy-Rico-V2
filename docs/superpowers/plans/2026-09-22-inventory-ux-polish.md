# Inventory UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four confirmed Inventory UX pain points: native popups, flat table, bloated edit modal, and slow adjustments.

**Architecture:** Frontend-only polish inside `home-bakery-management-system/`. Two shared context providers (Toast, ConfirmDialog) mount in `App.tsx`. A pure `filterAndSortInventory` helper backs the table. A `useOptimisticInventoryAdjust` hook does instant local writes with a debounced PATCH and rollback. No worker or D1 changes.

**Tech Stack:** React 19, TypeScript 5.9, Tailwind 4, Vitest 4 + jsdom, existing `ui/Modal`, existing `updateInventoryItem` API.

## Global Constraints

- Frontend only: no D1 migrations, no Orders Worker changes, no new npm dependencies.
- Popup replacement scope: `Inventory.tsx` and `ScanModal.tsx` only. Other pages keep native dialogs.
- `StoreContext` already exposes `setInventory`; use it for optimistic writes instead of adding a new store action.
- No comments in new code.
- Quantity writes stay absolute PATCHes, clamped `>= 0`, rounded to 2 decimals.
- Optimistic debounce: 800 ms per item id, coalesced, flushed on unmount.
- Existing component style: `rounded-xl border border-sand-200 bg-white`, palm = primary, hibiscus = destructive, `cn()` from `src/utils/cn.ts`.
- Commit style: `feat(inventory): …` / `refactor(scan): …` matching recent history.

---

### Task 1: Toast provider

**Files:**
- Create: `home-bakery-management-system/src/components/ui/Toast.tsx`
- Create: `home-bakery-management-system/src/components/ui/Toast.test.tsx`
- Modify: `home-bakery-management-system/src/App.tsx:177-185`

**Interfaces:**
- Produces: `ToastProvider({ children }: { children: ReactNode })`, `useToast(): { success(message: string): void; error(message: string): void }`

- [ ] **Step 1: Write the failing test** `Toast.test.tsx` covering: aria-live region present, success and error messages render, auto-dismiss after 3.5 s with fake timers, click dismisses.
- [ ] **Step 2: Run** `npm run test -- Toast.test.tsx` — expect failure (module not found).
- [ ] **Step 3: Implement `Toast.tsx`** — `ToastContext` with `push(tone, message)`, `nextId` ref, 3500 ms `window.setTimeout` auto-dismiss, bottom-right fixed container at `z-[60]` with `aria-live="polite"`, `CheckCircle2`/`XCircle` icons, `cn()` tone classes, `useToast` throwing outside the provider.
- [ ] **Step 4: Run test** — expect pass.
- [ ] **Step 5: Mount in `App.tsx`** — wrap `AppRouter` in `ToastProvider` inside `StoreProvider`.
- [ ] **Step 6: Commit** `feat(ui): toast provider with success and error variants`.

### Task 2: Confirm dialog provider

**Files:**
- Create: `home-bakery-management-system/src/components/ui/ConfirmDialog.tsx`
- Create: `home-bakery-management-system/src/components/ui/ConfirmDialog.test.tsx`
- Modify: `home-bakery-management-system/src/App.tsx`

**Interfaces:**
- Produces: `ConfirmOptions { title; message; confirmLabel?; cancelLabel?; danger? }`, `ConfirmProvider`, `useConfirm(): (options: ConfirmOptions) => Promise<boolean>`

- [ ] **Step 1: Write the failing test** — resolves `true` on confirm, `false` on cancel and overlay close, `danger` renders `bg-hibiscus`, default labels `Confirm`/`Cancel`.
- [ ] **Step 2: Run** `npm run test -- ConfirmDialog.test.tsx` — expect failure.
- [ ] **Step 3: Implement** — `useRef` resolver, `settle(ok)` resolves and clears options, renders existing `ui/Modal`, Cancel/Confirm buttons, danger → `bg-hibiscus`, otherwise `bg-palm`.
- [ ] **Step 4: Run test** — expect pass.
- [ ] **Step 5: Mount in `App.tsx`** — wrap `AppRouter` in `ConfirmProvider` inside `ToastProvider`.
- [ ] **Step 6: Commit** `feat(ui): promise-based confirm dialog`.

### Task 3: Inventory table filter/sort helper

**Files:**
- Create: `home-bakery-management-system/src/utils/inventoryTable.ts`
- Create: `home-bakery-management-system/src/utils/inventoryTable.test.ts`

**Interfaces:**
- Produces: `InventoryStatusFilter = "all" | "low" | "out"`, `InventorySortKey = "name" | "quantity" | "reorderLevel" | "costPerUnit"`, `InventoryTableQuery`, `filterAndSortInventory(items, query)`, `distinctInventoryValues(items, "category" | "unit")`

- [ ] **Step 1: Write the failing test** — search filter (case-insensitive), low (`quantity <= reorderLevel`), out (`quantity <= 0`), combined filters, name asc/desc, numeric sort by quantity and cost, input array not mutated, empty query returns all, distinct values sorted and blanks dropped.
- [ ] **Step 2: Run** `npm run test -- inventoryTable.test.ts` — expect failure.
- [ ] **Step 3: Implement** — filter then `[...out].sort(...)` only when `sortKey` set; compare names with `localeCompare`, numbers by subtraction times direction.
- [ ] **Step 4: Run test** — expect pass.
- [ ] **Step 5: Commit** `feat(inventory): filter and sort helper for inventory table`.

### Task 4: Optimistic inventory adjust hook

**Files:**
- Create: `home-bakery-management-system/src/hooks/useOptimisticInventoryAdjust.ts`
- Create: `home-bakery-management-system/src/hooks/useOptimisticInventoryAdjust.test.tsx`

**Interfaces:**
- Consumes: `useStore()` (`inventory`, `setInventory`), `useToast()`, `updateInventoryItem(id, { quantity })`
- Produces: `{ adjust(id: string, delta: number): void; restock(id: string, amount: number): void; dirtyIds: string[] }`

- [ ] **Step 1: Write the failing test** with a real-`useState` harness and fake timers: three rapid `adjust` calls produce one PATCH with the final total; rejected PATCH rolls back to baseline and calls `toast.error`; unmount flushes a pending PATCH immediately; `adjust(-5)` at quantity 1 persists 0; `dirtyIds` contains the id while pending and clears after success.
- [ ] **Step 2: Run** `npm run test -- useOptimisticInventoryAdjust.test.tsx` — expect failure.
- [ ] **Step 3: Implement** — `inventoryRef` mirroring `inventory`; `pending` map of `{ qty, baseline }`; per-id timer map; `clampQty`; `markDirty`; `persist` deletes pending, PATCHes, on failure maps the item back to `baseline` and toasts; unmount effect clears timers and fires remaining PATCHes with `.catch(() => {})`.
- [ ] **Step 4: Run test** — expect pass.
- [ ] **Step 5: Commit** `feat(inventory): optimistic debounced quantity adjustments`.

### Task 5: Inventory table filters and sortable headers

**Files:**
- Create: `home-bakery-management-system/src/pages/Inventory.test.tsx`
- Modify: `home-bakery-management-system/src/pages/Inventory.tsx:2,37-56,266-267,318-339`

**Interfaces:**
- Consumes: `filterAndSortInventory`, `distinctInventoryValues` from Task 3

- [ ] **Step 1: Write the failing page test** — chip counts render (`All (3)`, `Low (2)`, `Out (1)`), clicking `Low` hides healthy rows, category `<select>` filters, clicking the Quantity header sorts ascending then descending. Mock `../context/StoreContext` and `../hooks/useIngredientGroups`; wrap in real `ToastProvider`/`ConfirmProvider`.
- [ ] **Step 2: Run** `npm run test -- Inventory.test.tsx` — expect failure.
- [ ] **Step 3: Implement** — add `statusFilter`/`categoryFilter`/`sortKey`/`sortDir` state, replace the inline `filtered` computation, derive `outCount`/`categories`/`units`, add `toggleSort` + `sortIndicator`, render the filter row below the group-status banner, convert Item/Quantity/Reorder at/Cost per unit headers into sort buttons.
- [ ] **Step 4: Run test** — expect pass.
- [ ] **Step 5: Commit** `feat(inventory): status filters category filter and sortable columns`.

### Task 6: Tabbed inventory edit modal

**Files:**
- Modify: `home-bakery-management-system/src/pages/Inventory.tsx` (state near `groupStatus`, `openNew`/`openEdit`, modal body)
- Modify: `home-bakery-management-system/src/pages/Inventory.test.tsx`

- [ ] **Step 1: Write the failing test** — Add Item opens on Basics; clicking "Label info" hides Supplier and shows the sub-ingredients label; missing-label dot `button span.bg-hibiscus` present for a new draft and absent for an item with `ingredients_label`; category and unit datalists list existing values.
- [ ] **Step 2: Run** `npm run test -- Inventory.test.tsx` — expect failure.
- [ ] **Step 3: Implement** — `tab` state reset in `openNew`/`openEdit`; `labelDot` from draft label + `allergensText`; pill tab bar; wrap existing basics fields and the existing label-info block in `tab === …` conditionals; add `list` attributes plus datalists for category and unit. Save button stays outside both branches.
- [ ] **Step 4: Run test** — expect pass.
- [ ] **Step 5: Commit** `feat(inventory): tabbed edit modal with value suggestions`.

### Task 7: Optimistic steppers, row restock, in-app dialogs

**Files:**
- Modify: `home-bakery-management-system/src/pages/Inventory.tsx`
- Modify: `home-bakery-management-system/src/pages/Inventory.test.tsx`

- [ ] **Step 1: Write the failing test** — stepper button click calls `setInventory` with a functional updater producing `quantity + 1` and does not PATCH before 800 ms, then PATCHes `{ quantity: 11 }`; restock dialog adds the received amount; deleting an item opens the in-app confirm and calls `apiDeleteInventoryItem` only after confirming; row action buttons expose `aria-label`s.
- [ ] **Step 2: Run** `npm run test -- Inventory.test.tsx` — expect failure.
- [ ] **Step 3: Implement** — consume `useOptimisticInventoryAdjust`, `useConfirm`, `useToast`; delete the old `adjust`; add `restockItem`/`restockAmount`/`restockErr` state, `openRestock`, `submitRestock` (positive numeric validation), restock Modal; replace `confirm()` calls in `remove`, `unbind`, `makeActive`, and the save-time no-label-data guard; replace `alert()` calls with `toast.error`; quantity cell gets `animate-pulse` while dirty, a disabled minus at 0, and the Restock button; add aria-labels to history/edit/remove buttons.
- [ ] **Step 4: Run test** — expect pass.
- [ ] **Step 5: Commit** `feat(inventory): optimistic steppers row restock and in-app dialogs`.

### Task 8: ScanModal native confirm replacement

**Files:**
- Modify: `home-bakery-management-system/src/components/ScanModal.tsx:71,440-447,481-484,511-515`

**Interfaces:**
- Consumes: `useConfirm()` from Task 2

- [ ] **Step 1: Replace the three `window.confirm` calls** — no-label-data activation guard in the create flow (decline skips activation and still advances to the count step), unbind guard, and swap guard; add `confirm` to each `useCallback` dependency array.
- [ ] **Step 2: Verify** `grep -n "window.confirm" src/components/ScanModal.tsx src/pages/Inventory.tsx` returns nothing; `npm run typecheck` passes.
- [ ] **Step 3: Commit** `refactor(scan): replace native confirms with in-app dialog`.

### Task 9: Full verification

**Files:**
- Rebuilt: `admin/index.html`, `app/index.html`

- [ ] **Step 1: Run** `npm run test` — all suites pass.
- [ ] **Step 2: Run** `npm run typecheck` — clean.
- [ ] **Step 3: Run** `npm run build` — bundle and postbuild succeed.
- [ ] **Step 4: Confirm** `git status` shows only intended source, test, plan, spec, and rebuilt bundle changes.
- [ ] **Step 5: Commit** `chore(inventory): rebuild admin bundle for inventory UX polish`.
