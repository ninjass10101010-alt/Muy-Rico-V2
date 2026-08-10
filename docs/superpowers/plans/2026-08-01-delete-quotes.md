# Delete Cake Quotes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the ability to permanently delete cake quotes from the admin SPA via a new `DELETE /api/quotes/:id` endpoint, with a danger confirmation dialog (including a warning for converted quotes).

**Architecture:** Three layers, each independently deployable:
1. **API worker** (`orders/workers/api.js`) — new route branch + `deleteQuote` handler that deletes the `cake_quotes` row; `cake_quote_items` rows cascade via the existing FK (`ON DELETE CASCADE`, migration 0026). No new migration.
2. **SPA data layer** (`src/utils/api.ts` + `src/context/StoreContext.tsx`) — `deleteQuote` fetch wrapper + `handleDeleteQuote` context handler that refreshes the quotes list after deletion.
3. **SPA UI** (`src/pages/Quotes.tsx`) — "Delete quote" button in the quote detail modal + custom confirmation `Modal` with danger styling and a converted-quote warning.

**Tech Stack:** Cloudflare Worker (api.js, D1), React 19 + Vite + Tailwind (admin SPA), lucide-react icons, no new dependencies.

## Global Constraints

- No new dependencies, no new migrations, no changes to the `cake_quotes` schema.
- Do not modify archive behavior, convert flow, or R2 image handling.
- API returns snake_case wire fields; SPA uses camelCase — follow existing `apiToQuote` mapping conventions.
- All API calls in the SPA go through the existing `apiFetch` helper in `src/utils/api.ts`.
- `orders/workers/api.js`, `src/utils/api.ts`, and `src/context/StoreContext.tsx` may contain pre-existing uncommitted changes (inventory enrichment / label work in progress). Commit whole files normally; do not attempt to separate unrelated edits.
- Exact paths: worker config is `orders/wrangler.toml` (worker name `muy-rico-orders-api`, D1 binding `DB`, database name `muy-rico-orders`). SPA commands run from `home-bakery-management-system/`.

---

### Task 1: API endpoint `DELETE /api/quotes/:id`

**Files:**
- Modify: `orders/workers/api.js:252-257` (quote route block)
- Modify: `orders/workers/api.js` — add `deleteQuote` function between `updateQuote` (ends line 2622) and `convertQuote` (starts line 2624)

**Interfaces:**
- Produces: `deleteQuote(id, env)` → `json({ ok: true }, 200)` on success, `json({ error: 'Not found' }, 404)` when the quote does not exist.

- [ ] **Step 1: Add the DELETE route branch**

Edit the `qm` route block (currently lines 252-257) so it becomes:

```js
      const qm = path.match(/^\/api\/quotes\/(\d+)$/);
      if (qm) {
        const id = Number(qm[1]);
        if (method === 'GET')    return await getQuote(id, env);
        if (method === 'PATCH')  return await updateQuote(id, request, env, ctx, actorName);
        if (method === 'DELETE') return await deleteQuote(id, env);
      }
```

- [ ] **Step 2: Add the `deleteQuote` handler**

Insert between `updateQuote` (ends with `}` at line 2622) and `convertQuote`:

```js
async function deleteQuote(id, env) {
  const r = await env.DB.prepare('DELETE FROM cake_quotes WHERE id = ?').bind(id).run();
  if (!r.meta.changes) return json({ error: 'Not found' }, 404);
  return json({ ok: true }, 200);
}
```

The `cake_quote_items` rows for this quote are removed automatically by the FK cascade. Converted quotes are not blocked here — the SPA warns instead.

- [ ] **Step 3: Verify end-to-end against the dev worker**

Run in a terminal (uses the remote D1 database; a disposable quote is created and deleted, so no real data is harmed — note the auto-reply/admin emails will fire for the test quote):

```bash
npx wrangler dev -c orders/wrangler.toml
```

In a second terminal:

```bash
# 1. Create a disposable quote (note its id from the response)
curl -s -X POST http://localhost:8787/api/quotes -H 'Content-Type: application/json' -d '{"customer_name":"Delete Test","email":"delete-test@example.com","items":[{"product_type":"cake","details":{"cake_flavor":"Test Flavor"}}]}'
# Expected: {"ok":true,"id":N}

# 2. Delete it
curl -s -X DELETE http://localhost:8787/api/quotes/N
# Expected: {"ok":true}

# 3. Delete again → 404
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE http://localhost:8787/api/quotes/N
# Expected: 404

# 4. Verify items cascaded
npx wrangler d1 execute muy-rico-orders --remote --command "SELECT COUNT(*) AS n FROM cake_quote_items WHERE quote_id = N"
# Expected: n = 0
```

- [ ] **Step 4: Commit**

```bash
git add orders/workers/api.js
git commit -m "feat(quotes): add DELETE /api/quotes/:id endpoint"
```

---

### Task 2: SPA data layer — `deleteQuote` wrapper + `handleDeleteQuote`

**Files:**
- Modify: `home-bakery-management-system/src/utils/api.ts` (add after `updateQuote`, line 838)
- Modify: `home-bakery-management-system/src/context/StoreContext.tsx` (import line 25, interface ~line 70-71, handler after line 641, context value after line 698, deps array line 702)

**Interfaces:**
- Consumes: `apiFetch` (already in `src/utils/api.ts:54`)
- Produces:
  - `deleteQuote(id: number): Promise<{ ok: boolean }>` in `api.ts`
  - `handleDeleteQuote(id: number): Promise<void>` on `useStore()` (context type `StoreContextValue`)

- [ ] **Step 1: Add the `deleteQuote` wrapper**

In `src/utils/api.ts`, directly after the `updateQuote` function (line 838):

```ts
export async function deleteQuote(id: number): Promise<{ ok: boolean }> {
  return apiFetch(`/api/quotes/${id}`, { method: "DELETE" });
}
```

- [ ] **Step 2: Wire up StoreContext — import**

In `src/context/StoreContext.tsx` line 25, add `deleteQuote as apiDeleteQuote` to the import list (alphabetical, after `convertQuote as apiConvertQuote,`):

```ts
deleteQuote as apiDeleteQuote,
```

- [ ] **Step 3: Wire up StoreContext — interface**

Add to the `StoreContextValue` interface, directly after the `handleConvertQuote` line (line 71):

```ts
  handleDeleteQuote: (id: number) => Promise<void>;
```

- [ ] **Step 4: Wire up StoreContext — handler**

Add directly after `handleConvertQuote` (line 641):

```ts
  const handleDeleteQuote = useCallback(async (id: number) => {
    await apiDeleteQuote(id);
    await refreshQuotes();
  }, [refreshQuotes]);
```

- [ ] **Step 5: Wire up StoreContext — context value + deps**

In the `value` useMemo, add after `handleConvertQuote,` (line 698):

```ts
      handleDeleteQuote,
```

In the `useMemo` deps array (line 702), add `handleDeleteQuote` after `handleConvertQuote,`:

```ts
    handleConvertQuote, handleDeleteQuote, handleMergeCustomers, handleRelinkOrder],
```

- [ ] **Step 6: Typecheck and build**

```bash
cd home-bakery-management-system
npx tsc --noEmit
npm run build
```

Expected: tsc exits 0 with no errors; build completes and copies `dist/index.html` → `../admin/index.html`.

- [ ] **Step 7: Commit**

```bash
git add home-bakery-management-system/src/utils/api.ts home-bakery-management-system/src/context/StoreContext.tsx
git commit -m "feat(quotes): add deleteQuote API wrapper and store handler"
```

---

### Task 3: SPA UI — Delete button + confirmation modal

**Files:**
- Modify: `home-bakery-management-system/src/pages/Quotes.tsx` (destructure line 13, state block lines 18-21, admin actions block lines 322-345, render after the detail `Modal` closing tag line 354)

**Interfaces:**
- Consumes: `handleDeleteQuote` from `useStore()` (Task 2), `Modal` component (`src/components/ui/Modal.tsx`)
- Produces: "Delete quote" button + confirmation dialog in the quote detail modal

- [ ] **Step 1: Destructure the new handler and add state**

Line 13, change:

```tsx
  const { quotes, handleUpdateQuote, loading } = useStore();
```

to:

```tsx
  const { quotes, handleUpdateQuote, handleDeleteQuote, loading } = useStore();
```

In the state block (after `archivedFrom` on line 21), add:

```tsx
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
```

- [ ] **Step 2: Add the delete handler**

After `archiveQuote` (line 70), add:

```tsx
  async function deleteQuote() {
    if (!selected) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await handleDeleteQuote(selected.id);
      setConfirmDeleteOpen(false);
      setSelected(null);
    } catch (err) {
      setDeleteError("Failed to delete. Try again.");
      setDeleting(false);
    }
  }
```

- [ ] **Step 3: Add the "Delete quote" button**

In the Admin section, directly after the Archive-quote button block (lines 322-332), add:

```tsx
              <button
                onClick={() => {
                  setDeleteError(null);
                  setDeleting(false);
                  setConfirmDeleteOpen(true);
                }}
                className="text-xs font-medium text-hibiscus hover:underline"
              >
                Delete quote
              </button>
```

- [ ] **Step 4: Add the confirmation modal**

After the closing `</Modal>` of the detail modal (line 354), before the `{selected && (<QuoteConvertModal ...` block, add:

```tsx
      <Modal
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        title={selected?.convertedOrderId ? "Delete converted quote?" : "Delete this quote?"}
      >
        {selected && (
          <div className="space-y-4">
            <p className="text-sm text-cocoa">
              This permanently removes quote #{selected.id} and all its items.{" "}
              <span className="font-semibold">This cannot be undone.</span>
            </p>
            {selected.convertedOrderId && (
              <p className="rounded-xl bg-coral-light/20 p-3 text-sm text-cocoa">
                Order #{selected.convertedOrderId} stays, but the link from this quote will be lost.
              </p>
            )}
            {deleteError && <p className="text-xs text-hibiscus">{deleteError}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDeleteOpen(false)} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={deleteQuote}
                disabled={deleting}
                className="rounded-xl bg-hibiscus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete permanently"}
              </button>
            </div>
          </div>
        )}
      </Modal>
```

- [ ] **Step 5: Typecheck and build**

```bash
cd home-bakery-management-system
npx tsc --noEmit
npm run build
```

Expected: tsc exits 0; build completes and copies `dist/index.html` → `../admin/index.html`.

- [ ] **Step 6: Manual smoke test**

With `npx wrangler dev -c orders/wrangler.toml` still running (or the deployed worker), run `npm run dev` in `home-bakery-management-system/` and open `http://localhost:5173`:

1. Quotes tab → open a `new`/`replied` quote → "Delete quote" → dialog appears with "This cannot be undone." → Cancel closes it.
2. Confirm delete → quote disappears from the list; sidebar "Cake Quotes" badge count drops.
3. Open a `converted` quote → "Delete quote" → dialog title is "Delete converted quote?" and shows the "Order #N stays" warning → confirm → quote gone; Orders page still shows the order.
4. With the worker stopped, confirm delete → "Failed to delete. Try again." shows in the dialog and the quote stays selected.

- [ ] **Step 7: Commit**

```bash
git add home-bakery-management-system/src/pages/Quotes.tsx
git commit -m "feat(quotes): add delete quote button with confirmation dialog"
```
