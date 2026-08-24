# Dashboard Quote Creation, Custom Items & Quote Documents — Implementation Plan

**Date:** 2026-08-24
**Branch:** main (repo deploys from main per owner pattern)
**Status:** Approved by owner

## Goal

Let the owner create quotes from the admin dashboard (today only customers can submit them via quote.html), quote off-menu custom items, email customers an itemized branded quote, and download/print the quote from a phone like receipts.

## Background (verified in codebase)

- Quote schema: `cake_quotes` (status: new/replied/converted/archived, quoted_price, language es/en, …) + `cake_quote_items` (product_type cake|cakepops|cupcakes, details JSON blob). No migration needed for this plan.
- Backend `orders/workers/api.js`:
  - `POST /api/quotes` (public, `createQuote` ~line 2897): validates `customer_name`, `email`, `items[]` with `validTypes = ['cake','cakepops','cupcakes']`; inserts quote + items; fires `notifyQuoteCreated` (Telegram+email to owner) and `sendQuoteAutoReply(..., includePrice=false)` (ack email). Route dispatch line 264 does NOT pass `actorName` (it is in scope).
  - `PATCH /api/quotes/:id` (`updateQuote` ~3078): when `quoted_price` goes null→set and status is `new`, sets `status='replied'` and sends `sendQuoteAutoReply(env, existing.email, existing.language, id, true, newPrice)` + `notifyQuoteReplied`.
  - `POST /api/quotes/:id/convert` (`convertQuote` ~3139): requires quoted_price + deposit ≥ 50%; ALWAYS creates one order line `{productId:'prod_custom_cake', name:'Custom Cake', emoji:'🎂', qty:1, price: quoted_price/100, flavorNote}` regardless of quote items.
  - `sendQuoteAutoReply(env, email, lang, quoteId, includePrice, priceCents)` (~3331): plain-text ES/EN ack or price email via Resend with logo header. Call sites: createQuote (ack), updateQuote (price).
  - `getQuoteItems(env, quoteIds)` (~3036) returns items grouped by quote_id.
  - Receipt pattern to mirror: `getReceiptHtml` (~1216) serves `GET /api/receipts/:id/html` — standalone branded HTML + EN/ES toggle bar + auto `window.print()` when no `?lang=` param. Route at line 282 (Access-gated like other admin endpoints).
- Admin SPA `home-bakery-management-system/` (React 19 + Vite + Tailwind, builds to single file copied to `admin/index.html` by postbuild.sh):
  - `src/utils/api.ts`: `fetchQuotes`, `updateQuote`, `deleteQuote`, `convertQuote`, `uploadQuoteImage` (already exists), `ApiQuote`/`ApiQuoteItem` interfaces (~930). `receiptHtmlUrl(id, lang?)` builds receipt URLs — mirror for quotes.
  - `src/types.ts`: `Quote`, `QuoteItem` (~299).
  - `src/context/StoreContext.tsx`: `quotes` state, `refreshQuotes`, `handleUpdateQuote`, `handleConvertQuote`, `handleDeleteQuote`, `handleCreateCustomer`, `apiToQuote` mapper (~344), context value (~727+).
  - `src/pages/Quotes.tsx`: list + detail modal, "Save & Email Quote", convert, archive, delete. No create UI.
  - `src/components/QuoteConvertModal.tsx`: `itemToLineItem` switch on product_type (cake/cakepops/cupcakes).
  - `src/components/OrderModal.tsx`: the pattern to model QuoteModal on (existing/new customer mode, language toggle, payment, items, modal layout classes like `input`, `btn-primary`).
  - `src/pages/Receipts.tsx`: EN/ES/Print button group pattern (`window.open(receiptHtmlUrl(r.id, 'en'))`).
- Website quote form `quote.html` submits `{customer_name, email, phone, language, occasion, dietary[], comments, desired_date, budget, items:[{product_type, details}], inspiration}`. Item templates: cake (cake_flavor text, filling, frosting, serving_size select 6-8/10-12/15-20/20-30/30+, toppings checkboxes Sprinkles/Fresh Fruit/Chocolate Ganache/Caramel Drip/Edible Flowers/Fondant Decorations), cakepops (cake_flavor select, chocolate_dip select, topping_style select, quantity 6/12/24/custom, design_theme), cupcakes (cake_flavor select, frosting select Vanilla/Chocolate Buttercream, quantity).
- Deploy per `orders/DEPLOY.md`: build SPA (`npm run build` in home-bakery-management-system), `npx wrangler deploy -c orders/wrangler.toml`, then `npx wrangler versions upload --name muyrico ...` + `versions deploy`.

## Global Constraints

1. Work on `main`. Implementers MUST only `git add` the exact files listed in their task — never `git add -A` or whole-directory adds.
2. No DB migrations. No new npm dependencies.
3. The public website quote flow (quote.html → POST /api/quotes) must keep working exactly as before: ack email sent, owner notification sent, status `new`.
4. All customer-facing text (emails, printable doc) must have full ES and EN versions, selected by the quote's `language` field.
5. Follow existing code style: api.js uses section comment banners (`// ─── X ───`), inline HTML email templates, `json()` helper, `ctx.waitUntil` for notifications. SPA uses Tailwind utility classes with the project palette (palm, coral, sand-*, cocoa, hibiscus, mid-green), lucide-react icons, `Modal` from components/ui/Modal.
6. Test gates: `cd orders && npm test` passes; `cd home-bakery-management-system && npm test` passes; tsc: zero NEW errors in touched files (repo has pre-existing tsc errors — baseline filter).
7. Do not deploy until the final task.
8. Never touch the remote D1 database during implementation (no wrangler d1 execute --remote). Local verification only where possible.
9. Escape user-provided content in generated HTML (customer names, item details, comments) to avoid broken markup/XSS in emails and the printable doc. Use a small shared escape helper.

## Task 1: Backend — createQuote: admin-created quotes + custom item type

**File:** `orders/workers/api.js`

1. Route dispatch (line ~264): pass the actor — `return await createQuote(request, env, ctx, actorName);` and change signature to `async function createQuote(request, env, ctx, actor)`.
2. Add `'custom'` to `validTypes` (line ~2908). For custom items require `item.details.name` to be a non-empty string — return 400 `Custom items require a name in details` otherwise.
3. `cakeFlavor` extraction (line ~2920): extend fallback — `firstItemDetails.cake_flavor || firstItemDetails.flavor || (firstItem.product_type === 'custom' ? (firstItemDetails.name || '') : '') || ''` so the legacy NOT NULL column gets the custom item name and the quotes list shows something meaningful.
4. Accept optional `quoted_price` (integer cents) from body. Admin detection: `const isAdmin = !!actor && actor !== 'website' && actor !== 'unknown';`
   - Add `quoted_price` and `status` to the INSERT. Values: `quoted_price` = validated `Number(body.quoted_price)` or null (validate: if provided must be a positive integer, else 400); `status` = `isAdmin && quoted_price != null ? 'replied' : 'new'`.
5. Post-insert behavior:
   - Website (non-admin): unchanged — `notifyQuoteCreated` + ack auto-reply.
   - Admin: skip `notifyQuoteCreated` and skip the ack. If `quoted_price` set → `ctx.waitUntil(sendQuoteAutoReply(...includePrice=true...))` (Task 3 refactors this function's signature — until then call with current signature `(env, body.email, body.language || 'es', quoteId, true, quotedPrice)`), and `ctx.waitUntil(notifyQuoteReplied(env, quoteId, body.customer_name, quotedPrice))`.
6. Add tests in `orders/tests/quotes-lib.test.js` ONLY if pure functions are extracted; otherwise verify via local `wrangler dev` smoke (document in report). Existing tests must keep passing: `cd orders && npm test`.
7. Commit: `git add orders/workers/api.js` (+ new test file if any) — message `feat(quotes): admin-created quotes + custom item type`.

## Task 2: Backend — convertQuote uses real item names

**File:** `orders/workers/api.js` (`convertQuote`, ~line 3139)

1. Fetch the quote's items via `getQuoteItems(env, [id])` and use them to build the order line (replacing the hardcoded Custom Cake block at ~3192):
   - Item display names (mirror `QuoteConvertModal.itemToLineItem`):
     - cake → `Custom Cake — {cake_flavor}`
     - cakepops → `Cakepops ({chocolate_dip}, {topping_style})` (omit empty parts gracefully)
     - cupcakes → `Cupcakes ({frosting})`
     - custom → `{details.name}`
   - Quantities: cake → 1; cakepops/cupcakes → `Number(details.quantity) || 6`; custom → `Number(details.quantity) || 1`.
   - Order line: single line, `name` = item names with quantities joined by ` + ` (format `Name ×qty` when qty > 1), `qty: 1`, `price: quote.quoted_price / 100` (full quoted price on the single line keeps totals exact).
   - `emoji`: 🎂 if any cake item, else 🍭 if any cakepops, else 🧁 if any cupcakes, else ✨.
   - `productId`: `'prod_custom_cake'` if any cake item present, else `null` (inventory deduction safely skips unknown/null product ids — verified in `deductOrderInventory`).
   - `flavorNote`: keep existing cake-level flavorNote when a cake item exists; otherwise join per-item detail summaries (`key: value` pairs, skipping arrays → join with `/`). Fallback `''`.
   - If the quote has zero items (legacy), fall back to the current behavior (Custom Cake line from quote-level fields).
2. Append the itemized breakdown to `orderNotes` (one line per quote item: `- Name ×qty — key details`) so the order detail shows everything.
3. Verify: `cd orders && npm test` passes; local smoke with `wrangler dev` if practical (document).
4. Commit: `git add orders/workers/api.js` — message `feat(quotes): convert quotes to orders with real item names`.

## Task 3: Backend — itemized branded quote email + printable quote HTML

**File:** `orders/workers/api.js`

1. Add a shared HTML builder `buildQuoteDocumentHtml(quote, items, lang, opts)` producing the itemized branded document used by BOTH the email and the printable endpoint:
   - Logo header (same `https://muy-rico.com/muy_rico_logo_email.png` block as `sendQuoteAutoReply`).
   - Title: `Cotización #id` / `Quote #id`.
   - Customer name greeting; occasion + desired date lines when present.
   - Itemized table: one row per quote item — display name (same naming as Task 2), key details line, quantity.
   - If `quoted_price` null → a "price pending / precio por confirmar" line instead of totals.
   - Totals block when priced: Total; `Deposit (50%) to secure your date` = `Math.ceil(quoted_price * 0.5)`; `Balance at pickup` = total − deposit.
   - How-to-proceed line (reply to email / call — ES: responde a este correo; EN: reply to this email) + allergen/cottage-law disclaimer line (short, ES/EN).
   - Footer matching `sendQuoteAutoReply` (Muy Rico Bakery · Holland, MI · tagline).
   - ALL dynamic content escaped (add a small `escapeHtml` helper near the quote section if none exists — check label/receipt code first and reuse if one exists).
2. Refactor `sendQuoteAutoReply` → new signature `sendQuoteAutoReply(env, quote, items, includePrice)` where `quote` is the DB row (needs email, language, id, quoted_price, customer_name, occasion, desired_date) and `items` is the array from `getQuoteItems`. Keep the ack (includePrice=false) text content as-is but wrap in the branded layout; the price email body becomes `buildQuoteDocumentHtml` output (no duplicate plain text needed). Update ALL call sites:
   - `createQuote` ack (website): fetch items for the new quote id (they were just inserted — build from `body.items` directly, mapping to `{product_type, details}` shape) and pass quote row `{id: quoteId, email: body.email, language: body.language || 'es', quoted_price: null, customer_name: body.customer_name, occasion: body.occasion, desired_date: body.desired_date}`.
   - `createQuote` admin-priced path (Task 1): same, with includePrice=true and quoted_price set.
   - `updateQuote` price path (~3119): fetch the quote row (already have `existing`) + `await getQuoteItems(env, [id])` before `ctx.waitUntil`.
3. New endpoint `GET /api/quotes/:id/html` (mirror `getReceiptHtml` + route registration near line 282, BEFORE the `/api/quotes/:id` regex if order matters — check routing):
   - Load quote + items; 404 if missing.
   - Language: quote.language, overridable with `?lang=en|es` (same toggle behavior as receipts).
   - Response: toggle bar (same markup as `getReceiptHtml`, paths adjusted to `/api/quotes/${id}/html`) + `buildQuoteDocumentHtml(...)` + auto `window.print()` script only when no `?lang=` param.
   - Content-Type `text/html; charset=utf-8` + CORS, Access-gated (default path — do NOT add to public allowlist).
4. Verify: `cd orders && npm test` passes. Add unit tests for `buildQuoteDocumentHtml` IF it can be exported/tested via the existing test harness pattern (check how other tests import from workers/*.js); otherwise local smoke and document.
5. Commit: `git add orders/workers/api.js` (+ tests) — message `feat(quotes): itemized branded quote email + printable quote document`.

## Task 4: Frontend — API client, types, store wiring

**Files:** `home-bakery-management-system/src/utils/api.ts`, `src/types.ts`, `src/context/StoreContext.tsx`

1. `api.ts`:
   - Add `'custom'` to `ApiQuoteItem.product_type` union.
   - Add `createQuote(payload: { customer_name: string; email: string; phone?: string | null; language: 'es' | 'en'; occasion?: string | null; dietary?: string[]; comments?: string | null; desired_date?: string | null; budget?: string | null; reference_image_url?: string | null; quoted_price?: number | null; items: { product_type: 'cake' | 'cakepops' | 'cupcakes' | 'custom'; details: Record<string, unknown>; reference_image_url?: string | null }[] }): Promise<{ ok: boolean; id: number }>` → `apiFetch('/api/quotes', { method: 'POST', body: JSON.stringify(payload) })`.
   - Add `quoteHtmlUrl(id: number | string, lang?: 'en' | 'es'): string` returning `${API_BASE}/api/quotes/${id}/html${lang ? `?lang=${lang}` : ''}` — mirror `receiptHtmlUrl` exactly (check its exact implementation first).
2. `types.ts`: add `'custom'` to `QuoteItem.product_type` union.
3. `StoreContext.tsx`:
   - Import `createQuote as apiCreateQuote` (+ types as needed).
   - Add `handleCreateQuote: (payload: Parameters<typeof apiCreateQuote>[0], newCustomer?: { id: string; name: string; phone: string; email: string }) => Promise<{ id: number }>` — if `newCustomer` provided, call `handleCreateCustomer(newCustomer)` first (swallow+log errors like OrderModal does), then `const result = await apiCreateQuote(payload); await refreshQuotes(); return result;`.
   - Expose in context value + the context type interface (near `handleUpdateQuote` declarations ~line 75 and value ~line 751).
4. Verify: `cd home-bakery-management-system && npm test` passes; `npx tsc --noEmit` produces no NEW errors in these three files vs baseline.
5. Commit: `git add home-bakery-management-system/src/utils/api.ts home-bakery-management-system/src/types.ts home-bakery-management-system/src/context/StoreContext.tsx` — message `feat(quotes): admin create-quote API client + store wiring`.

## Task 5: Frontend — QuoteModal component

**File (new):** `home-bakery-management-system/src/components/QuoteModal.tsx`

Model on `OrderModal.tsx` (read it first; reuse its structure, classes, customer new/existing pattern, language toggle). Props: `{ open: boolean; onClose: () => void }`. Uses `useStore()` for `products` (not needed for items — item types are fixed), `customers`, `handleCreateCustomer` (via `handleCreateQuote`'s newCustomer param), `handleCreateQuote`.

Form state/fields:
- Customer mode `existing | new` (OrderModal pattern). Existing: select from `customers`, prefills name/email/phone into state. New: name/phone/email inputs. Email REQUIRED (validate non-empty; show error).
- Language toggle es/en (default `es`, OrderModal pattern).
- Occasion select: `''`, Birthday, Wedding, Anniversary, Baby Shower, Quinceañera, Other.
- Desired date (`<input type="date">`), budget text input, comments textarea.
- Dietary checkboxes: Gluten-Free, Vegan, Nut-Free, Dairy-Free, Egg-Free, Sugar-Free.
- Reference image: file input → `uploadQuoteImage(file)` (from utils/api) → store returned URL, show thumbnail preview + remove button; upload errors shown inline.
- Items builder:
  - State: `items: { product_type: 'cake'|'cakepops'|'cupcakes'|'custom'; details: Record<string, any> }[]`.
  - Add-item controls: type select (Cake / Cakepops / Cupcakes / Custom item) + Add button; per-type field sets rendered for the item being composed (same pattern as quote.html templates):
    - cake: cake_flavor text (required), filling text, frosting text, serving_size select ('', 6-8, 10-12, 15-20, 20-30, 30+), toppings checkboxes (Sprinkles, Fresh Fruit, Chocolate Ganache, Caramel Drip, Edible Flowers, Fondant Decorations).
    - cakepops: cake_flavor select (Chocolate, Vanilla, Strawberry), chocolate_dip select (Milk Chocolate, White Chocolate), topping_style select (Marble, Sprinkles, Chocolate Drizzle, Chocolate Accessories, Fondant Accessories), quantity select (6, 12, 24, custom → number input), design_theme text.
    - cupcakes: cake_flavor select (Chocolate, Vanilla, Strawberry), frosting select (Vanilla Buttercream, Chocolate Buttercream), quantity select (6, 12, 24, custom → number input).
    - custom: name text (required), description textarea, quantity number (default 1).
  - Validation on add: cake requires cake_flavor; cakepops/cupcakes require cake_flavor (+ frosting for cupcakes); custom requires name. Disable Add until valid.
  - Added items list with remove buttons, showing a readable summary line (type label + key details + qty).
- Optional quoted price input ($, number, step 0.01). Helper text: if set, customer receives the quote email immediately; if empty, quote stays "new" and can be priced later.
- Submit:
  - Require ≥ 1 item + customer name + valid email; inline error otherwise.
  - Build payload per Task 4 `createQuote` type; `quoted_price` = cents (`Math.round(parseFloat * 100)`) or null; `customer_id` NOT sent (prefill-only by decision); when mode=new and name non-empty, generate `cust_${Math.random().toString(36).slice(2,9)}` customer and pass as `newCustomer` (OrderModal pattern).
  - On success: close modal, reset form. On error: inline error message.
- Reset form state when modal opens/closes (OrderModal `resetForm` pattern).

Verify: `npm test` passes; tsc no new errors in this file. Add a component test ONLY if a light pattern exists in repo (check existing *.test.tsx — if none exist for modals, skip; manual verification later).
Commit: `git add home-bakery-management-system/src/components/QuoteModal.tsx` — message `feat(quotes): QuoteModal — create quotes from the dashboard`.

## Task 6: Frontend — Quotes page integration + convert modal custom case

**Files:** `home-bakery-management-system/src/pages/Quotes.tsx`, `home-bakery-management-system/src/components/QuoteConvertModal.tsx`

1. `Quotes.tsx`:
   - Import `QuoteModal`, `quoteHtmlUrl`, `Download`/`Printer` icon from lucide-react.
   - Add `const [createOpen, setCreateOpen] = useState(false);` and a "New Quote" button (use `btn-primary` or match the page's existing button styles — check Orders page header if needed) in the header row next to the filter (right side near the `{filtered.length} quotes` counter or left of it). Render `<QuoteModal open={createOpen} onClose={() => setCreateOpen(false)} />`.
   - Detail modal item rendering: the title mapping currently handles cake/cakepops/cupcakes — add custom: title = `item.details.name || 'Custom item'`; `ProductIcon` type prop: pass a safe fallback for custom (check ProductIcon's props — it takes `type`/`emoji`/`imageUrl`; use the custom item's reference image if present, else default icon usage consistent with existing calls).
   - Detail modal admin section: add an EN / ES / Print button group (Receipts.tsx pattern) that opens `quoteHtmlUrl(selected.id, 'en' | 'es')` / `quoteHtmlUrl(selected.id)` via `window.open`, placed above or beside "Save & Email Quote". Works for all statuses.
2. `QuoteConvertModal.tsx`: add `case 'custom'` to `itemToLineItem` → `{ name: String(d.name || 'Custom item'), quantity: Number(d.quantity) || 1 }`.
3. Verify: `npm test` passes; tsc no new errors in touched files.
4. Commit: `git add home-bakery-management-system/src/pages/Quotes.tsx home-bakery-management-system/src/components/QuoteConvertModal.tsx` — message `feat(quotes): New Quote button, downloadable quote doc, custom item display`.

## Task 7: Full verification, build, deploy (controller-run)

1. `cd orders && npm test` — all pass.
2. `cd home-bakery-management-system && npm test` — all pass; `npx tsc --noEmit` — no new errors in touched files.
3. `cd home-bakery-management-system && npm run build` — succeeds; postbuild copies to `admin/index.html`. Commit the bundle: `git add admin/index.html` — message `chore(admin): rebuild bundle — dashboard quote creation`.
4. Deploy API worker: `npx wrangler deploy -c orders/wrangler.toml`.
5. Deploy frontend: `npx wrangler versions upload --name muyrico --assets . --compatibility-date 2025-03-21` then `npx wrangler versions deploy --name muyrico <VERSION_ID>@100%`.
6. Smoke tests (live):
   - `GET https://muy-rico-orders-api.bexgarcia0208.workers.dev/api/quotes` → 401 without Access (expected).
   - Public POST /api/quotes with a test payload (website flow) → creates quote, verify via remote SQL SELECT, then DELETE the test quote via API or SQL cleanup. Confirm no regression: items stored, status new.
   - Verify live `admin/index.html` contains "New Quote" string.
   - Owner manual checks (document as owner actions): create a real quote in the admin UI with their own email (custom item + price), confirm itemized email arrives, download/print the quote from phone, convert a test quote and confirm order line name.
