# Quote Save/Email Split + Full Item Editor + iPad Field Fixes — Design

**Date:** 2026-08-25
**Status:** Approved by owner (Option C "complete"; UI fixes scoped)
**Branch:** main (repo deploys from main per owner pattern)

## Goals

1. **Save ≠ Send:** saving price/notes never emails the customer; emailing is a deliberate, repeatable action (also serves as re-send after changes).
2. **Full quote item editor:** add, edit (replace details/photo), and remove items on an existing quote — for when customers call back with changes.
3. **UI fixes:** iPad rendering of the Desired date/Budget pair in QuoteModal; missing `$` on Convert modal's Quoted price line.

## Owner requirements (gathered)

- Separate **Save** and **Email Quote** buttons (owner chose explicit actions over combined).
- Items: **add + remove + edit existing** (Option C — "I need this to be complete").
- Editing must work for cakes/cupcakes/cakepops/custom alike; same field sets as the New Quote form.

## Non-goals

- No DB migrations (`cake_quote_items` already has sort_order + reference_image_url).
- No customer-facing website changes (this is dashboard + API only).
- No editing of quotes in `converted`/`archived` status.
- No event-log table for quotes.

---

## Feature 1 — Backend (`orders/workers/api.js`)

### 1a. PATCH `/api/quotes/:id` becomes pure save

Remove the auto-email block from `updateQuote` (currently: on null→priced while status='new', flips status to 'replied', sends priced email, fires Telegram). After this change PATCH only writes `quoted_price`, `admin_notes`, `status` (+updated_at). Status transitions now happen only via explicit actions (email endpoint below, archive/unarchive as today).

### 1b. New `POST /api/quotes/:id/email`

Handler `emailQuote(id, env, ctx)`:
1. Load quote row (QUOTE_FIELDS) + items via `getQuoteItems(env, [id])`. 404 if quote missing.
2. Guard: `quoted_price == null` → 400 `{ error: "Save a quoted price before emailing" }`.
3. Guard: status `converted` or `archived` → 400 `{ error: "Quote is ${status}; cannot email" }`.
4. `ctx.waitUntil(sendQuoteAutoReply(env, quoteRow, items, true))` — sends the branded itemized document (existing builder).
5. If `status === 'new'`: UPDATE status='replied' (awaited, not waitUntil), and fire `notifyQuoteReplied` Telegram ping (first-reply only).
6. Return `{ ok: true, status }`.

Route registration before other regex routes: `/^\/api\/quotes\/(\d+)\/email$/`.

### 1c. Item endpoints

Shared guard helper `assertQuoteEditable(quote)` → returns error response if status converted/archived (400 `"Quote is ${status}; items cannot be changed"`).

- **POST `/api/quotes/:id/items`** — body `{ product_type, details, reference_image_url? }`.
  - Validate product_type ∈ cake|cakepops|cupcakes|custom (400 otherwise); custom requires non-empty `details.name` (400 `"Custom items require a name in details"`); details must be object.
  - INSERT with `sort_order = (SELECT COALESCE(MAX(sort_order),-1)+1 FROM cake_quote_items WHERE quote_id=?)`.
  - Return the created row mapped like `getQuoteItems` rows (`{id, product_type, details, reference_image_url}`), 201.
- **PATCH `/api/quotes/:id/items/:itemId`** — body `{ details?, reference_image_url? }` (at least one present).
  - Verify item exists AND belongs to quote (404 otherwise). Same validation rules on details when provided.
  - Wholesale-replace `details` JSON when provided (composer always submits complete valid set); update reference_image_url when provided (null clears).
  - Return updated row, 200.
- **DELETE `/api/quotes/:id/items/:itemId`** — verify belongs to quote, delete, return `{ok:true}`.
  - Deleting the last item is allowed (legacy-style zero-item quote reappears via existing fallback card).
- All three: run guard BEFORE any write. Route regexes: `/^\/api\/quotes\/(\d+)\/items$/` and `/^\/api\/quotes\/(\d+)\/items\/(\d+)$/`.

## Feature 2 — Frontend (SPA)

### 2a. Shared composer extraction — new file `src/components/QuoteItemComposer.tsx`

Extract the per-type compose fields + validation from `QuoteModal.tsx` into a reusable component:

```ts
interface QuoteItemComposerProps {
  initial?: { product_type: QuoteItemType; details: Record<string, any>; reference_image_url?: string | null };
  submitLabel: string;
  onSubmit: (item: { product_type: QuoteItemType; details: Record<string, any>; reference_image_url?: string | null }) => void;
  onCancel?: () => void;   // renders a Cancel button when provided
}
```

- Internal state = type select + per-type fields (same option lists as today: serving sizes, toppings, pop/cupcake selects, custom name/desc/qty). Seeded from `initial` when provided (edit mode hides the type select — type is immutable after creation, keeps details validation coherent).
- Add-button enablement logic identical to current QuoteModal (`composeValid`).
- Reference image upload NOT included in composer for edits v1 (per-item photos come from customers; owner-added photo upload is YAGNI — noted as future).
- `QuoteModal.tsx` refactors to render `QuoteItemComposer` instead of its inline fields (behavior identical).

### 2b. api.ts + StoreContext wiring

- `emailQuote(id): Promise<{ ok: boolean; status: string }>` → POST `/api/quotes/${id}/email`
- `addQuoteItem(id, item): Promise<ApiQuoteItem>` ; `updateQuoteItem(id, itemId, patch): Promise<ApiQuoteItem>` ; `deleteQuoteItem(id, itemId): Promise<{ ok: boolean }>`.
- StoreContext handlers mirroring existing quote handlers: call API then `refreshQuotes()`; expose in context value + interface: `handleEmailQuote`, `handleAddQuoteItem`, `handleUpdateQuoteItem`, `handleDeleteQuoteItem`.

### 2c. Quotes.tsx detail modal changes

- **Buttons row** (replaces "Save & Email Quote"):
  - `[Save]` — saves price + notes only (existing saveQuote minus the misleading copy). Success msg: "Saved."
  - `[Email Quote]` — disabled until `selected.quotedPrice != null` (saved price, same rule as Convert); title hint "Save a quoted price first". On click: `handleEmailQuote`, success msg "Quote emailed." Errors inline.
  - `[Convert to Order]` unchanged.
  - Row visible for statuses new/replied only (unchanged gating).
- **Items section:**
  - Each card header gains `Edit` (pencil) + `✕` remove buttons (hidden when converted/archived; ✕ uses window.confirm "Remove this item from the quote?").
  - Edit swaps card body for `<QuoteItemComposer initial={item} submitLabel="Save item" onSubmit={patch => handleUpdateQuoteItem(...)} onCancel={...} />` (one editor open at a time).
  - "Add item" button under items list opens composer (empty) → `handleAddQuoteItem`.
  - Small helper text under Add/Edit controls: "Price isn't updated automatically — adjust and Email Quote when ready."

## Feature 3 — UI fixes

### 3a. iPad date/budget overflow in QuoteModal

The `Desired date | Budget` pair (`grid grid-cols-2 gap-2`) breaks on iPad: iOS `<input type="date">` has a large intrinsic min-width and won't shrink, overlapping the budget input. Fixes:
- Children get `min-w-0`; inputs keep `w-full`.
- Pair becomes `grid grid-cols-1 min-[480px]:grid-cols-2 gap-2` so it stacks until there's comfortable room (modal column ≈ 300–360px on iPad split view).
- Global CSS (index.css): `input[type="date"] { -webkit-appearance: none; appearance: none; }` + ensure `min-width: 0; width: 100%;` so iOS respects container sizing. Audit other date inputs (OrderModal dueDate is full-width single col — unaffected but benefits from the global rule).

### 3b. Missing `$` in QuoteConvertModal

Line ~89: Quoted price value renders `{(quotedCents / 100).toFixed(2)}` → prefix `$` to match every other amount in that modal.

## Error handling summary

- Email without saved price → 400 surfaced inline (button also disabled).
- Items endpoints on converted/archived → 400 surfaced inline.
- Item not found / wrong quote → 404 surfaced inline.
- Network failures → existing inline error patterns.

## Testing / verification gates

- `cd orders && npm test` green (30 tests; no new lib tests — endpoints verified by local smoke).
- Local smoke via `wrangler dev`: email-without-price → 400; add item → appears; patch item details → replaced; delete item → gone; guards on archived quote → 400. Document outputs in implementation report.
- `cd home-bakery-management-system && npm test` (201+) and `npx tsc --noEmit` — zero NEW errors in touched files.
- Bundle rebuild committed; live smoke after deploy (owner: create quote → save w/o email received; email arrives; edit item; re-email shows updated doc; iPad check of date/budget row).

## Files touched

- `orders/workers/api.js` (updateQuote change, 4 new endpoints/routes)
- `home-bakery-management-system/src/components/QuoteItemComposer.tsx` (new)
- `src/components/QuoteModal.tsx` (use shared composer)
- `src/components/QuoteConvertModal.tsx` ($ fix)
- `src/pages/Quotes.tsx` (buttons + item editor UI)
- `src/utils/api.ts`, `src/context/StoreContext.tsx` (client + wiring)
- `src/index.css` (date input rule)
- Rebuild → `admin/index.html`
