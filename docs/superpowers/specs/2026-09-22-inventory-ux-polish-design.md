# Inventory UX Polish — Design

**Date:** 2026-09-22
**Status:** Approved (user confirmed: Approach 1 — polish in place, inventory-only popup scope)
**Depends on:** admin SPA (`home-bakery-management-system/`), existing `ui/Modal` + `Badge`, `StoreContext`, `updateInventoryItem` API. No worker or D1 changes.

## 1. Problem

The Inventory page works but feels clunky in four ways (user-confirmed):

1. **Native popups** — errors use `alert()`, confirmations use `confirm()` (5 confirms + 2 alerts in `Inventory.tsx`, 3 confirms in `ScanModal.tsx`). Stepper failures are swallowed by `console.warn` — the user never learns a change failed.
2. **Flat table** — one long unsorted table; no status or category filtering beyond topbar text search. Category and Unit are free-text inputs, so values drift ("lb", "lbs", "pound").
3. **Bloated modal** — the Add/Edit form stacks item fields + ingredient-group picker + USDA search + label info into one long scroll. The 90% path (name/qty/cost) is buried.
4. **Sluggish adjustments** — each +/− click runs a PATCH **plus a full `refreshInventory()`** before the UI moves. No per-row restock; the restock dialog only exists on the dashboard low-stock widget.

## 2. Goal

Fix all four pain points surgically, preserving the current single-table architecture. No migrations, no worker changes, no new dependencies.

## 3. Non-goals

- Replacing native popups on other pages (Orders, Quotes, Invoices, etc.) — the shared components are built so pages can adopt later, but this change only wires Inventory + ScanModal.
- Bulk/batch restock mode, category-grouped table sections, side-drawer editing (Approach 2 ideas — can layer on later if still wanted).
- Changing inventory API semantics, deduction, scanning, or ingredient-group behavior.
- Toast persistence/queueing across page navigations (toasts are transient).

## 4. Shared feedback infrastructure

### 4a. `src/components/ui/Toast.tsx`

- `ToastProvider` (React context) + `useToast()` hook: `toast.success(msg)`, `toast.error(msg)`.
- Toasts stack bottom-right, auto-dismiss 3.5 s, dismiss on click. `aria-live="polite"`.
- `ToastProvider` mounts once in `App.tsx` alongside `StoreProvider`/`AuthProvider`.
- Styling matches app cards (`rounded-xl border bg-white shadow`), tone accents: palm (success), hibiscus (error).

### 4b. `src/components/ui/ConfirmDialog.tsx`

- Promise-based replacement for `window.confirm`, backed by the existing `ui/Modal`:

```ts
const ok = await confirm({
  title: "Remove flour?",
  message: "It's in the recipe of: Bolillos. Deactivating will skip its deduction…",
  confirmLabel: "Remove",
  danger: true,
});
```

- `danger: true` → destructive button uses hibiscus style; otherwise palm.
- Context-provided like toasts (each component exports its own provider/hook; one-component-per-file follows the `ui/` pattern). Both providers mount in `App.tsx`.

### 4c. Adoption (Inventory + ScanModal only)

- `Inventory.tsx`: delete/remove confirm (with recipe references), unbind confirm, make-active confirm (incl. no-label-data warning), save-failure `alert` → error toast, stepper failure `console.warn` → error toast + rollback (§7).
- `ScanModal.tsx`: unbind confirm, no-label-data activation confirms → ConfirmDialog; background save errors → error toasts.

## 5. Table organization

### 5a. Filter row (between stat cards and table)

- **Status chips:** `All · Low · Out of stock`. Low = `quantity <= reorderLevel` (matches existing badge logic); Out = `quantity <= 0`. Chips show counts, e.g. `Low (6)`.
- **Category dropdown:** distinct categories from current inventory + `All categories`. Default: All.
- Filters combine with existing topbar text search.

### 5b. Sorting

- Click-to-sort headers: Name, Quantity, Reorder level, Cost/unit. Click again to reverse; arrow indicator (▾/▴) on the active column. Default order unchanged.

### 5c. Kept as-is

Upcoming-demand toggle column, group badges ("used in", active/make-active), barcode rows + unbind, highlight-on-deeplink ring, `+/-` steppers (improved in §7), stat cards header.

### 5d. Pure helper

`src/utils/inventoryTable.ts` exports `filterAndSortInventory(items, { search, status, category, sort })` — unit-testable, keeps the page component lean.

### 5e. Datalist inputs (data hygiene, no migration)

Category and Unit inputs in the Add/Edit modal get `<datalist>` suggestions derived from distinct values in current inventory. Still free-text — no data model change, no new validation — just nudges consistency for new items.

## 6. Tabbed edit modal

### 6a. Structure

Two pill tabs at the top of the modal body (matching existing app tab styling):

- **Basics:** name, category (datalist), quantity, unit (datalist), reorder level, cost/unit, supplier, barcode, ingredient-group picker (affects recipes/deduction → main path).
- **Label info:** sub-ingredients label, USDA "Find ingredient data" search, allergens, weight per unit.

### 6b. Behavior

- Add Item opens on Basics; tabs always reachable both ways (no forced sequence).
- Validation unchanged (name required); Save works from either tab.
- **Tab indicator:** a small dot on "Label info" when the draft has no label data (`ingredients_label` empty and no allergens) — passive, always-visible nudge replacing the current surprise-confirm. The make-active-without-label-data ConfirmDialog (§4c) remains the guard at activation time.

## 7. Fast adjustments (optimistic steppers)

### 7a. Mechanics

- **Instant UI:** +/− applies to local inventory state immediately.
- **Debounced persist:** rapid clicks coalesce into a single PATCH with the final total, ~800 ms after the last click (per-item debounce).
- **Rollback on error:** on PATCH failure the row reverts to the last known server state; error toast explains what happened.
- **Saving indicator:** the quantity softly pulses (`animate-pulse`) while local changes are uncommitted; success is silent.
- **Restock per row:** row action opens a small dialog (mirrors `InventoryLowStockWidget`'s restock dialog): "Amount received" is added to current quantity, saved via the same optimistic path. Validation: numeric, > 0.

### 7b. Plumbing

- New hook `src/hooks/useOptimisticInventoryAdjust.ts`:
  - `adjust(id, delta)` and `setQuantity(id, qty)` / `restock(id, amount)` helpers.
  - Internally: apply local patch → debounce per item id → PATCH via existing `updateInventoryItem` API (absolute quantity, `Math.max(0, …)`, 2-decimal clamp) → on failure, rollback + `toast.error`.
  - **Safety flush:** on unmount, pending debounced saves fire immediately (not dropped).
- `StoreContext` already exposes `setInventory` (StoreContext.tsx:821) — the hook uses it directly for immediate local state writes; **no new store action needed**. Existing `apiUpdateInventoryItem` (API + full refresh) is untouched for modal saves.
- No worker/API changes: writes remain absolute-quantity PATCHes, same as today.

### 7c. Concurrency note

Two devices racing writes (absolute quantity) can clobber each other — unchanged from current behavior, acceptable for a single-admin bakery.

## 8. Testing

Vitest + React Testing Library, following existing patterns (`InventoryLowStockWidget.test.tsx`):

- **Toast/ConfirmDialog tests:** render; success/error variants; `aria-live` present; ConfirmDialog promise resolves `true` on confirm, `false` on cancel; `danger` styling applied.
- **`inventoryTable.test.ts`:** status × category × search combos; each sort key; reversed sort; cap/empty results.
- **`useOptimisticInventoryAdjust` tests (fake timers):** rapid clicks → one PATCH with final total; rollback + toast on rejection; unmount flushes pending save; quantity never below 0.
- **Page-level:** Inventory modal renders both tabs, tab switch works, datalists populated, label-info dot shows when label data missing.

Verification: `npm run test`, `npm run typecheck`, `npm run build` in `home-bakery-management-system/`.

## 9. Rollout

- Frontend-only: everything lives in `home-bakery-management-system/`. No D1 migrations, no worker deploys beyond the static bundle.
- `npm run build` postbuild copies to `admin/index.html`; deploy via the usual `wrangler versions upload` flow.

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Filter/sort bug hides rows | Pure helper heavily unit-tested; "All" resets everything; no data writes involved |
| Optimistic writes drift from server state | Rollback on failure + safety flush; write semantics unchanged from today |
| Debounced save lost on navigation | Unmount flush fires pending PATCHes |
| Toast/Confirm adoption creep into other pages | Explicitly out of scope; components are opt-in per page |
| Modal tab hides label data from users who forget it | Passive dot indicator + activation-time ConfirmDialog guard |

## 11. Out of scope / later

- App-wide popup replacement (other pages adopt Toast/ConfirmDialog gradually).
- Bulk restock mode, category-grouped sections, side-drawer editing.
- Toast on the marketing site or public pages.
