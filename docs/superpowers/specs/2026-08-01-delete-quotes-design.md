# Delete Cake Quotes

**Date:** 2026-08-01
**Status:** Approved — transitioning to implementation planning

## Goal

Allow the admin to permanently delete (remove) cake quotes from the admin SPA. Archive remains as the existing soft-hide option.

## Context

The quotes system (multi-item, shipped 2026-07-30) has an `archived` status for hiding quotes without destroying data. There is currently no way to permanently remove a quote. The user wants a delete feature so stale/spam/wrong submissions can be removed for good.

`cake_quote_items` already has `FOREIGN KEY (quote_id) REFERENCES cake_quotes(id) ON DELETE CASCADE` (migration 0026), so deleting a parent quote row removes its items automatically. No new migration is needed.

## Scope

### In scope
- `DELETE /api/quotes/:id` endpoint in `orders/workers/api.js`.
- Admin SPA: `deleteQuote` wrapper in `api.ts`, `handleDeleteQuote` in `StoreContext`, "Delete quote" action in the `Quotes.tsx` detail modal with a custom danger confirmation dialog.
- Converted quotes: deletable with a warning (order link lost; the order itself stays intact).

### Out of scope
- R2 reference image cleanup — images remain in the bucket after quote deletion.
- Notifications (email/customer) on delete.
- Row-level delete icons in the quotes table — delete lives in the detail modal only.
- Any change to archive behavior.
- No new migration — cascade FK handles items.

## Design

### 1. API — `orders/workers/api.js`

Add route next to the existing quote routes (api.js:252):

```js
const qm = path.match(/^\/api\/quotes\/(\d+)$/);
if (qm) {
  const id = Number(qm[1]);
  if (method === 'GET')   return await getQuote(id, env);
  if (method === 'PATCH') return await updateQuote(id, request, env, ctx, actorName);
  if (method === 'DELETE') return await deleteQuote(id, env);
}
```

New handler:

```js
async function deleteQuote(id, env) {
  const r = await env.DB.prepare('DELETE FROM cake_quotes WHERE id = ?').bind(id).run();
  if (!r.meta.changes) return json({ error: 'Not found' }, 404);
  return json({ ok: true }, 200);
}
```

- Items in `cake_quote_items` cascade-delete via the FK.
- Converted quotes are not blocked here — the UI warns instead.
- No audit trail (none exists in this codebase for quotes).

### 2. Admin SPA

**`src/utils/api.ts`** — add:

```ts
export async function deleteQuote(id: number): Promise<{ ok: boolean }> {
  return apiFetch(`/api/quotes/${id}`, { method: "DELETE" });
}
```

**`src/context/StoreContext.tsx`** — add `handleDeleteQuote` that calls the API then `refreshQuotes()`. Expose via context value + provider, matching the existing `handleUpdateQuote` pattern (StoreContext.tsx:634).

**`src/pages/Quotes.tsx`** — in the detail modal's Admin section (below "Archive quote", Quotes.tsx:322), add a danger-styled "Delete quote" button. Clicking opens a custom confirmation modal (`Modal` component) with:
- Title: "Delete this quote?" / "Delete converted quote?"
- Body: "This permanently removes quote #N and all its items. This cannot be undone."
- If converted (`convertedOrderId` set): extra warning "Order #N stays, but the link from this quote will be lost."
- Confirm button: danger styling (e.g. `bg-hibiscus` / `text-hibiscus`), explicit label "Delete permanently".
- On confirm: call `handleDeleteQuote(selected.id)`, close both modals, clear selection. List + sidebar badge refresh automatically via `refreshQuotes()`.
- On error: show inline error message in the confirm modal, keep the quote selected.

State: `confirmDeleteOpen: boolean` (reuse existing `Modal` component; no new components).

### 3. Error handling

- API: 404 when the quote does not exist; SPA shows "Failed to delete. Try again." inline.
- No partial states — single DELETE statement, cascade is atomic per statement.

## Verification

1. Deploy API worker. `curl -X DELETE https://<worker>/api/quotes/:id` → 200; repeat → 404.
2. Verify items gone: `SELECT COUNT(*) FROM cake_quote_items WHERE quote_id = :id` → 0.
3. Verify converted quote deletion: quote deleted, linked order still exists and renders.
4. Build admin SPA. Open Quotes tab → open a quote → Delete quote → confirm dialog shows → confirm → quote disappears from list, sidebar badge updates.
5. Open an archived quote → still deletable.
6. Converted quote shows the "order link will be lost" warning; deletion still proceeds.
