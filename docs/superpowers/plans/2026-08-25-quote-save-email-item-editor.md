# Quote Save/Email Split + Full Item Editor + iPad Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split saving from emailing (deliberate, re-sendable email action), give the dashboard a complete item editor (add/edit/remove) for existing quotes, and fix iPad date/budget rendering + a missing `$`.

**Architecture:** API gains one email action and three item endpoints (`orders/workers/api.js`, no migrations); the per-type item composer is extracted from `QuoteModal.tsx` into a shared component reused by the detail-modal editor; store wiring follows the existing handler pattern. Bundle rebuilt at the end.

**Tech Stack:** Cloudflare Worker (D1), React 19 + Vite + Tailwind SPA, TypeScript, vitest.

## Global Constraints

1. Work on `main`. `git add` only the exact files listed per task — never `git add -A`.
2. No DB migrations. No new npm dependencies.
3. Public website flow untouched: `quote.html`, `order.html` must not be modified.
4. Guards: email/items actions return 400 on quotes with status `converted` or `archived`; email additionally requires a saved `quoted_price`.
5. Spanish customer-facing copy unchanged (dashboard is English-only).
6. Test gates: `cd orders && npm test` passes (30 tests); `cd home-bakery-management-system && npm test` passes (201 tests); `npx tsc --noEmit` zero NEW errors in touched files (pre-existing baseline elsewhere: StoreContext lines ~23/123/184 — leave alone). Repo has no route-level/modal-level test harnesses (existing *.test.* cover libs/widgets/pages) — do NOT add new component/route tests; verification = suites + tsc + documented smoke.
7. Follow existing style: api.js `json()` helper + section banners; SPA Tailwind palette classes (`palm`, `coral`, `sand-*`, `cocoa(-muted)`, `hibiscus`, `cream-deep`, `mid-green`), `btn-primary`/`btn-secondary`/`input`.

---

### Task 1: Backend — pure-save PATCH + email endpoint

**Files:**
- Modify: `orders/workers/api.js` (updateQuote auto-email removal; new `emailQuote` handler; route)

**Interfaces:**
- Consumes: existing `QUOTE_FIELDS`, `getQuoteItems(env, [id])`, `sendQuoteAutoReply(env, quoteRow, items, includePrice)`, `notifyQuoteReplied(env, id, customerName, priceCents)`, `json()` helper.
- Produces: `POST /api/quotes/:id/email` → `{ok:true,status}` | 400/404. PATCH no longer sends anything.

- [ ] **Step 1: Remove the auto-email block from updateQuote**

Delete this entire block (the comment + conditional) from `updateQuote` — the lines after the UPDATE statement:

```js
    // If quoted_price changed from null → set, auto-send quote reply with price
    const oldPrice = existing.quoted_price;
    const newPrice = body.quoted_price !== undefined ? body.quoted_price : oldPrice;
    if (oldPrice == null && newPrice != null && existing.status === 'new') {
      await env.DB.prepare(
        "UPDATE cake_quotes SET status = 'replied', updated_at = datetime('now') WHERE id = ?"
      ).bind(id).run();

      const itemsByQuote = await getQuoteItems(env, [id]);
      ctx.waitUntil(sendQuoteAutoReply(env, { ...existing, quoted_price: newPrice }, itemsByQuote[id] || [], true));
      ctx.waitUntil(notifyQuoteReplied(env, id, existing.customer_name, newPrice));
    }
```

Leave everything else in `updateQuote` untouched (it still writes quoted_price/admin_notes/status/updated_at).

- [ ] **Step 2: Add the emailQuote handler**

Insert directly AFTER the closing brace of `updateQuote`'s catch block (before `deleteQuote`):

```js
// ─── Quote email (deliberate send / re-send) ─────────────────────────────────

async function emailQuote(id, env, ctx) {
  const quote = await env.DB.prepare(
    `SELECT ${QUOTE_FIELDS.join(', ')} FROM cake_quotes WHERE id = ?`
  ).bind(id).first();
  if (!quote) return json({ error: 'Not found' }, 404);
  if (quote.status === 'converted' || quote.status === 'archived') {
    return json({ error: `Quote is ${quote.status}; cannot email` }, 400);
  }
  if (quote.quoted_price == null) {
    return json({ error: 'Save a quoted price before emailing' }, 400);
  }
  const itemsByQuote = await getQuoteItems(env, [id]);
  ctx.waitUntil(sendQuoteAutoReply(env, quote, itemsByQuote[id] || [], true));
  let status = quote.status;
  if (quote.status === 'new') {
    await env.DB.prepare(
      "UPDATE cake_quotes SET status = 'replied', updated_at = datetime('now') WHERE id = ?"
    ).bind(id).run();
    status = 'replied';
    ctx.waitUntil(notifyQuoteReplied(env, id, quote.customer_name, quote.quoted_price));
  }
  return json({ ok: true, status }, 200);
}
```

- [ ] **Step 3: Register the route**

In the fetch router, immediately after the existing `qhm` html route registration:

```js
      const qhm = path.match(/^\/api\/quotes\/(\d+)\/html$/);
      if (qhm && method === 'GET') return await getQuoteDocumentHtml(Number(qhm[1]), env, url);

      const qem = path.match(/^\/api\/quotes\/(\d+)\/email$/);
      if (qem && method === 'POST') return await emailQuote(Number(qem[1]), env, ctx);
```

- [ ] **Step 4: Verify**

```bash
node --check orders/workers/api.js && echo SYNTAX_OK
cd orders && npm test 2>&1 | tail -3
```

Expected: `SYNTAX_OK`, `Tests 30 passed (30)`.

- [ ] **Step 5: Commit**

```bash
git add orders/workers/api.js
git commit -m "feat(quotes): split save from send — deliberate email endpoint"
```

---

### Task 2: Backend — item add/edit/delete endpoints

**Files:**
- Modify: `orders/workers/api.js`

**Interfaces:**
- Consumes: `QUOTE_FIELDS`, `json()`.
- Produces: `validateQuoteItem(item)` (returns error string or null), `assertQuoteEditable(quote)` (returns error Response or null) — used by all three handlers; endpoints `POST /api/quotes/:id/items`, `PATCH|DELETE /api/quotes/:id/items/:itemId`.

- [ ] **Step 1: Add validation + guard helpers**

Immediately above the `emailQuote` handler added in Task 1:

```js
const QUOTE_ITEM_TYPES = ['cake', 'cakepops', 'cupcakes', 'custom'];

function validateQuoteItem(item) {
  if (!item || typeof item !== 'object') return 'Invalid item';
  if (!QUOTE_ITEM_TYPES.includes(item.product_type)) return 'Invalid product type';
  const d = (item.details && typeof item.details === 'object') ? item.details : {};
  if (item.product_type === 'custom' && !String(d.name || '').trim()) return 'Custom items require a name in details';
  return null;
}

function assertQuoteEditable(quote) {
  if (quote.status === 'converted' || quote.status === 'archived') {
    return json({ error: `Quote is ${quote.status}; items cannot be changed` }, 400);
  }
  return null;
}

async function loadQuoteOr404(id, env) {
  return env.DB.prepare(
    `SELECT ${QUOTE_FIELDS.join(', ')} FROM cake_quotes WHERE id = ?`
  ).bind(id).first();
}

async function loadQuoteItemOr404(quoteId, itemId, env) {
  return env.DB.prepare(
    'SELECT * FROM cake_quote_items WHERE id = ? AND quote_id = ?'
  ).bind(itemId, quoteId).first();
}
```

- [ ] **Step 2: Add the three handlers**

Below the helpers from Step 1 (after `emailQuote`):

```js
async function addQuoteItem(id, request, env) {
  try {
    const quote = await loadQuoteOr404(id, env);
    if (!quote) return json({ error: 'Not found' }, 404);
    const guard = assertQuoteEditable(quote);
    if (guard) return guard;
    const body = await request.json();
    const err = validateQuoteItem(body);
    if (err) return json({ error: err }, 400);
    const refUrl = body.reference_image_url === undefined ? null : body.reference_image_url;
    const result = await env.DB.prepare(`
      INSERT INTO cake_quote_items (quote_id, product_type, sort_order, details, reference_image_url)
      VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM cake_quote_items WHERE quote_id = ?), ?, ?)
    `).bind(id, body.product_type, id, JSON.stringify(body.details || {}), refUrl).run();
    return json({
      ok: true,
      item: { id: result.meta.last_row_id, product_type: body.product_type, details: body.details || {}, reference_image_url: refUrl },
    }, 201);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}

async function updateQuoteItem(id, itemId, request, env) {
  try {
    const quote = await loadQuoteOr404(id, env);
    if (!quote) return json({ error: 'Not found' }, 404);
    const guard = assertQuoteEditable(quote);
    if (guard) return guard;
    const item = await loadQuoteItemOr404(id, itemId, env);
    if (!item) return json({ error: 'Not found' }, 404);
    const body = await request.json();
    const sets = [];
    const binds = [];
    if (body.details !== undefined) {
      const err = validateQuoteItem({ product_type: item.product_type, details: body.details });
      if (err) return json({ error: err }, 400);
      sets.push('details = ?');
      binds.push(JSON.stringify(body.details));
    }
    if (body.reference_image_url !== undefined) {
      sets.push('reference_image_url = ?');
      binds.push(body.reference_image_url);
    }
    if (sets.length === 0) return json({ error: 'Nothing to update' }, 400);
    await env.DB.prepare(`UPDATE cake_quote_items SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, itemId).run();
    return json({
      ok: true,
      item: {
        id: itemId,
        product_type: item.product_type,
        details: body.details !== undefined ? body.details : JSON.parse(item.details || '{}'),
        reference_image_url: body.reference_image_url !== undefined ? body.reference_image_url : item.reference_image_url,
      },
    }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}

async function deleteQuoteItemHandler(id, itemId, env) {
  try {
    const quote = await loadQuoteOr404(id, env);
    if (!quote) return json({ error: 'Not found' }, 404);
    const guard = assertQuoteEditable(quote);
    if (guard) return guard;
    const item = await loadQuoteItemOr404(id, itemId, env);
    if (!item) return json({ error: 'Not found' }, 404);
    await env.DB.prepare('DELETE FROM cake_quote_items WHERE id = ?').bind(itemId).run();
    return json({ ok: true }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}
```

- [ ] **Step 3: Register the routes**

Directly below the `qem` route from Task 1:

```js
      const qim = path.match(/^\/api\/quotes\/(\d+)\/items$/);
      if (qim && method === 'POST') return await addQuoteItem(Number(qim[1]), request, env);

      const qiim = path.match(/^\/api\/quotes\/(\d+)\/items\/(\d+)$/);
      if (qiim && method === 'PATCH') return await updateQuoteItem(Number(qiim[1]), Number(qiim[2]), request, env);
      if (qiim && method === 'DELETE') return await deleteQuoteItemHandler(Number(qiim[1]), Number(qiim[2]), env);
```

Note: `updateQuoteItem` here is the ITEM handler; it does not conflict with the existing quote-level `updateQuote` (different name).

- [ ] **Step 4: Verify**

```bash
node --check orders/workers/api.js && echo SYNTAX_OK
cd orders && npm test 2>&1 | tail -3
```

Expected: `SYNTAX_OK`, `Tests 30 passed (30)`.

- [ ] **Step 5: Commit**

```bash
git add orders/workers/api.js
git commit -m "feat(quotes): add/edit/remove items on existing quotes"
```

---

### Task 3: SPA — API client + store wiring

**Files:**
- Modify: `home-bakery-management-system/src/utils/api.ts` (end of Quotes section), `src/context/StoreContext.tsx`

**Interfaces:**
- Consumes: backend routes from Tasks 1-2; existing `ApiQuoteItem`, `apiFetch`.
- Produces: `emailQuote(id)`, `addQuoteItem(id, item)`, `updateQuoteItem(id, itemId, patch)`, `deleteQuoteItem(id, itemId)`; context handlers `handleEmailQuote`, `handleAddQuoteItem`, `handleUpdateQuoteItem`, `handleDeleteQuoteItem` (each returns API result and refreshes quotes).

- [ ] **Step 1: api.ts additions**

At the end of the Quotes section (after `quoteHtmlUrl`):

```ts
export interface QuoteItemInput {
  product_type: "cake" | "cakepops" | "cupcakes" | "custom";
  details: Record<string, unknown>;
  reference_image_url?: string | null;
}

export async function emailQuote(id: number): Promise<{ ok: boolean; status: string }> {
  return apiFetch(`/api/quotes/${id}/email`, { method: "POST" });
}

export async function addQuoteItem(id: number, item: QuoteItemInput): Promise<{ ok: boolean; item: ApiQuoteItem }> {
  return apiFetch(`/api/quotes/${id}/items`, { method: "POST", body: JSON.stringify(item) });
}

export async function updateQuoteItem(
  id: number,
  itemId: number,
  patch: { details?: Record<string, unknown>; reference_image_url?: string | null },
): Promise<{ ok: boolean; item: ApiQuoteItem }> {
  return apiFetch(`/api/quotes/${id}/items/${itemId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export async function deleteQuoteItem(id: number, itemId: number): Promise<{ ok: boolean }> {
  return apiFetch(`/api/quotes/${id}/items/${itemId}`, { method: "DELETE" });
}
```

- [ ] **Step 2: StoreContext import**

Extend the existing utils/api import list — add `emailQuote as apiEmailQuote, addQuoteItem as apiAddQuoteItem, updateQuoteItem as apiUpdateQuoteItem, deleteQuoteItem as apiDeleteQuoteItem` alongside the existing `createQuote as apiCreateQuote` segment.

- [ ] **Step 3: StoreContext handlers**

After `handleCreateQuote` (added previously), insert:

```tsx
  const handleEmailQuote = useCallback(async (id: number) => {
    const result = await apiEmailQuote(id);
    await refreshQuotes();
    return result;
  }, [refreshQuotes]);

  const handleAddQuoteItem = useCallback(async (id: number, item: Parameters<typeof apiAddQuoteItem>[1]) => {
    const result = await apiAddQuoteItem(id, item);
    await refreshQuotes();
    return result;
  }, [refreshQuotes]);

  const handleUpdateQuoteItem = useCallback(async (
    id: number,
    itemId: number,
    patch: Parameters<typeof apiUpdateQuoteItem>[2],
  ) => {
    const result = await apiUpdateQuoteItem(id, itemId, patch);
    await refreshQuotes();
    return result;
  }, [refreshQuotes]);

  const handleDeleteQuoteItem = useCallback(async (id: number, itemId: number) => {
    const result = await apiDeleteQuoteItem(id, itemId);
    await refreshQuotes();
    return result;
  }, [refreshQuotes]);
```

- [ ] **Step 4: Context interface + value**

Interface (next to `handleCreateQuote` declaration):

```ts
  handleEmailQuote: (id: number) => Promise<{ ok: boolean; status: string }>;
  handleAddQuoteItem: (id: number, item: Parameters<typeof apiAddQuoteItem>[1]) => Promise<{ ok: boolean; item: ApiQuoteItem }>;
  handleUpdateQuoteItem: (id: number, itemId: number, patch: Parameters<typeof apiUpdateQuoteItem>[2]) => Promise<{ ok: boolean; item: ApiQuoteItem }>;
  handleDeleteQuoteItem: (id: number, itemId: number) => Promise<{ ok: boolean }>;
```

Value object: add `handleEmailQuote, handleAddQuoteItem, handleUpdateQuoteItem, handleDeleteQuoteItem` next to `handleCreateQuote`; add the same four names to the useMemo deps array.

Also ensure `ApiQuoteItem` is imported as a type in StoreContext.tsx (extend the existing `type` import list from "../utils/api").

- [ ] **Step 5: Verify**

```bash
cd home-bakery-management-system
npx tsc --noEmit 2>&1 | grep -E "api\.ts|StoreContext\.tsx"
```

Expected: only pre-existing StoreContext baseline errors (~23/123/184), nothing new.

```bash
npm test 2>&1 | grep Tests
```

Expected: `Tests 201 passed (201)`.

- [ ] **Step 6: Commit**

```bash
git add home-bakery-management-system/src/utils/api.ts home-bakery-management-system/src/context/StoreContext.tsx
git commit -m "feat(quotes): email + item-editor API client and store wiring"
```

---

### Task 4: Shared QuoteItemComposer + QuoteModal refactor + iPad fixes

**Files:**
- Create: `home-bakery-management-system/src/components/QuoteItemComposer.tsx`
- Modify: `src/components/QuoteModal.tsx`, `src/index.css`

**Interfaces:**
- Produces: `QuoteItemComposer` with props `{ initial?, submitLabel, onSubmit, onCancel? }` where `initial?: DraftQuoteItem`, `DraftQuoteItem = { product_type: "cake"|"cakepops"|"cupcakes"|"custom"; details: Record<string, any> }`, `onSubmit: (item: DraftQuoteItem) => void`. Exports `TYPE_LABELS` map too (used by Quotes.tsx in Task 5).

- [ ] **Step 1: Create QuoteItemComposer.tsx**

Full file content (extracted verbatim-in-spirit from QuoteModal's current inline composer; edit mode hides the type select):

```tsx
import { useState } from "react";

export type QuoteItemType = "cake" | "cakepops" | "cupcakes" | "custom";

export interface DraftQuoteItem {
  product_type: QuoteItemType;
  details: Record<string, any>;
}

export const TYPE_LABELS: Record<QuoteItemType, string> = {
  cake: "Cake",
  cakepops: "Cakepops",
  cupcakes: "Cupcakes",
  custom: "Custom item",
};

const OCCASION-less constants moved from QuoteModal:
*/
const CAKE_TOPPINGS = ["Sprinkles", "Fresh Fruit", "Chocolate Ganache", "Caramel Drip", "Edible Flowers", "Fondant Decorations"];
const POP_FLAVORS = ["Chocolate", "Vanilla", "Strawberry"];
const DIPS = ["Milk Chocolate", "White Chocolate"];
const TOPPING_STYLES = ["Marble", "Sprinkles", "Chocolate Drizzle", "Chocolate Accessories", "Fondant Accessories"];
const FROSTING_OPTIONS = ["Vanilla Frosting", "Chocolate Frosting"];

const inputCls = "w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-palm";

interface QuoteItemComposerProps {
  initial?: DraftQuoteItem;
  submitLabel: string;
  onSubmit: (item: DraftQuoteItem) => void;
  onCancel?: () => void;
}

export default function QuoteItemComposer({ initial, submitLabel, onSubmit, onCancel }: QuoteItemComposerProps) {
  const lockedType = initial?.product_type;
  const [itemType, setItemType] = useState<QuoteItemType>(lockedType ?? "cake");

  const [cakeFlavorText, setCakeFlavorText] = useState(String(initial?.details?.cake_flavor ?? ""));
  const [filling, setFilling] = useState(String(initial?.details?.filling ?? ""));
  const [frostingText, setFrostingText] = useState(String(initial?.details?.frosting ?? ""));
  const [servingSize, setServingSize] = useState(String(initial?.details?.serving_size ?? ""));
  const [cakeToppings, setCakeToppings] = useState<string[]>(Array.isArray(initial?.details?.toppings) ? initial.details.toppings : []);
  const [popFlavor, setPopFlavor] = useState(String(initial?.details?.cake_flavor ?? ""));
  const [chocolateDip, setChocolateDip] = useState(String(initial?.details?.chocolate_dip ?? ""));
  const [toppingStyle, setToppingStyle] = useState(String(initial?.details?.topping_style ?? ""));
  const popQtyInit = initial?.product_type === "cakepops" ? String(Number(initial.details?.quantity) || "") : "";
  const [popQtyPick, setPopQtyPick] = useState(["6", "12", "24"].includes(popQtyInit) ? popQtyInit : popQtyInit ? "custom" : "");
  const [popQtyCustom, setPopQtyCustom] = useState(popQtyInit && !["6", "12", "24"].includes(popQtyInit) ? popQtyInit : "");
  const [popTheme, setPopTheme] = useState(String(initial?.details?.design_theme ?? ""));
  const [cupFlavor, setCupFlavor] = useState(String(initial?.details?.cake_flavor ?? ""));
  const [cupFrosting, setCupFrosting] = useState(String(initial?.details?.frosting ?? ""));
  const cupQtyInit = initial?.product_type === "cupcakes" ? String(Number(initial.details?.quantity) || "") : "";
  const [cupQtyPick, setCupQtyPick] = useState(["6", "12", "24"].includes(cupQtyInit) ? cupQtyInit : cupQtyInit ? "custom" : "");
  const [cupQtyCustom, setCupQtyCustom] = useState(cupQtyInit && !["6", "12", "24"].includes(cupQtyInit) ? cupQtyInit : "");
  const [customName, setCustomName] = useState(String(initial?.details?.name ?? ""));
  const [customDesc, setCustomDesc] = useState(String(initial?.details?.description ?? ""));
  const [customQty, setCustomQty] = useState(initial?.product_type === "custom" ? String(Number(initial.details?.quantity) || 1) : "1");

  const popQty = popQtyPick === "custom" ? Number(popQtyCustom) : Number(popQtyPick);
  const cupQty = cupQtyPick === "custom" ? Number(cupQtyCustom) : Number(cupQtyPick);

  const composeValid =
    itemType === "cake"
      ? cakeFlavorText.trim().length > 0
      : itemType === "cakepops"
        ? popFlavor !== "" && chocolateDip !== "" && toppingStyle !== "" && popQty > 0
        : itemType === "cupcakes"
          ? cupFlavor !== "" && cupFrosting !== "" && cupQty > 0
          : customName.trim().length > 0;

  function buildDetails(): Record<string, any> | null {
    if (itemType === "cake") {
      if (!composeValid) return null;
      return {
        cake_flavor: cakeFlavorText.trim(),
        ...(filling.trim() ? { filling: filling.trim() } : {}),
        ...(frostingText.trim() ? { frosting: frostingText.trim() } : {}),
        ...(servingSize ? { serving_size: servingSize } : {}),
        ...(cakeToppings.length ? { toppings: cakeToppings } : {}),
      };
    }
    if (itemType === "cakepops") {
      if (!composeValid) return null;
      return {
        cake_flavor: popFlavor,
        chocolate_dip: chocolateDip,
        topping_style: toppingStyle,
        quantity: popQty,
        ...(popTheme.trim() ? { design_theme: popTheme.trim() } : {}),
      };
    }
    if (itemType === "cupcakes") {
      if (!composeValid) return null;
      return { cake_flavor: cupFlavor, frosting: cupFrosting, quantity: cupQty };
    }
    if (!composeValid) return null;
    return {
      name: customName.trim(),
      ...(customDesc.trim() ? { description: customDesc.trim() } : {}),
      quantity: Number(customQty) > 0 ? Number(customQty) : 1,
    };
  }

  function handleSubmit() {
    const details = buildDetails();
    if (!details) return;
    onSubmit({ product_type: itemType, details });
  }

  const showQtyCustom = itemType === "cakepops" ? popQtyPick === "custom" : cupQtyPick === "custom";

  return (
    <div className="space-y-2">
      {!lockedType && (
        <div className="flex gap-2">
          <select
            value={itemType}
            onChange={(e) => setItemType(e.target.value as QuoteItemType)}
            className="flex-1 rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-palm"
          >
            {(Object.keys(TYPE_LABELS) as QuoteItemType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      )}

      {itemType === "cake" && (
        <>
          <input value={cakeFlavorText} onChange={(e) => setCakeFlavorText(e.target.value)} placeholder="Cake flavor *" className={inputCls} />
          <input value={filling} onChange={(e) => setFilling(e.target.value)} placeholder="Filling" className={inputCls} />
          <input value={frostingText} onChange={(e) => setFrostingText(e.target.value)} placeholder="Frosting" className={inputCls} />
          <select value={servingSize} onChange={(e) => setServingSize(e.target.value)} className={inputCls}>
            <option value="">Serving size…</option>
            {["6-8", "10-12", "15-20", "20-30", "30+"].map((s) => (
              <option key={s} value={s}>{s} servings</option>
            ))}
          </select>
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 pt-1">
            {CAKE_TOPPINGS.map((t) => (
              <label key={t} className="flex items-center gap-1.5 text-xs text-cocoa-muted">
                <input
                  type="checkbox"
                  checked={cakeToppings.includes(t)}
                  onChange={(e) =>
                    setCakeToppings((prev) => (e.target.checked ? [...prev, t] : prev.filter((x) => x !== t)))
                  }
                />
                {t}
              </label>
            ))}
          </div>
        </>
      )}

      {itemType === "cakepops" && (
        <>
          <select value={popFlavor} onChange={(e) => setPopFlavor(e.target.value)} className={inputCls}>
            <option value="">Cake flavor…</option>
            {POP_FLAVORS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          <select value={chocolateDip} onChange={(e) => setChocolateDip(e.target.value)} className={inputCls}>
            <option value="">Chocolate dip…</option>
            {DIPS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <select value={toppingStyle} onChange={(e) => setToppingStyle(e.target.value)} className={inputCls}>
            <option value="">Topping style…</option>
            {TOPPING_STYLES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <select value={popQtyPick} onChange={(e) => setPopQtyPick(e.target.value)} className={inputCls}>
              <option value="">Quantity…</option>
              {["6", "12", "24", "custom"].map((q) => (
                <option key={q} value={q}>{q === "custom" ? "Custom" : q}</option>
              ))}
            </select>
            {showQtyCustom && (
              <input
                type="number"
                min="1"
                value={popQtyCustom}
                onChange={(e) => setPopQtyCustom(e.target.value)}
                placeholder="Qty"
                className="w-24 rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-palm"
              />
            )}
          </div>
          <input value={popTheme} onChange={(e) => setPopTheme(e.target.value)} placeholder="Design theme" className={inputCls} />
        </>
      )}

      {itemType === "cupcakes" && (
        <>
          <select value={cupFlavor} onChange={(e) => setCupFlavor(e.target.value)} className={inputCls}>
            <option value="">Cake flavor…</option>
            {POP_FLAVORS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          <select value={cupFrosting} onChange={(e) => setCupFrosting(e.target.value)} className={inputCls}>
            <option value="">Frosting…</option>
            {FROSTING_OPTIONS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <select value={cupQtyPick} onChange={(e) => setCupQtyPick(e.target.value)} className={inputCls}>
              <option value="">Quantity…</option>
              {["6", "12", "24", "custom"].map((q) => (
                <option key={q} value={q}>{q === "custom" ? "Custom" : q}</option>
              ))}
            </select>
            {showQtyCustom && (
              <input
                type="number"
                min="1"
                value={cupQtyCustom}
                onChange={(e) => setCupQtyCustom(e.target.value)}
                placeholder="Qty"
                className="w-24 rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-palm"
              />
            )}
          </div>
        </>
      )}

      {itemType === "custom" && (
        <>
          <input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Item name *" className={inputCls} />
          <textarea value={customDesc} onChange={(e) => setCustomDesc(e.target.value)} rows={2} placeholder="Description" className={inputCls} />
          <input
            type="number"
            min="1"
            value={customQty}
            onChange={(e) => setCustomQty(e.target.value)}
            placeholder="Quantity"
            className={inputCls}
          />
        </>
      )}

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <button onClick={onCancel} className="rounded-xl border border-sand-200 px-3 py-1.5 text-xs font-medium text-cocoa-muted hover:border-sand-300">
            Cancel
          </button>
        )}
        <button
          onClick={handleSubmit}
          disabled={!composeValid}
          title={composeValid ? submitLabel : "Complete the required fields first"}
          className="rounded-xl bg-coral px-3 py-1.5 text-xs font-semibold text-white hover:bg-coral/80 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
```

IMPORTANT: remove the stray comment line "`OCCASION-less constants moved from QuoteModal:`*/" — the implementer should NOT copy that literal fragment; the constants block starts directly with `const CAKE_TOPPINGS`.

- [ ] **Step 2: Refactor QuoteModal.tsx to use the composer**

In `QuoteModal.tsx`:
1. Delete the now-duplicated declarations: `TYPE_LABELS`, `CAKE_TOPPINGS`, `POP_FLAVORS`, `DIPS`, `TOPPING_STYLES`, `FROSTINGS`, and the entire inline compose state block (itemType through customQty, `popQty`/`cupQty`, `composeValid`, `showQtyCustom`, and `addItem()`).
2. Import: `import QuoteItemComposer, { TYPE_LABELS, type DraftQuoteItem } from "./QuoteItemComposer";`
3. Keep the `items`/`setItems` state; reset in the open-effect becomes `setItems([])` (drop per-field resets).
4. Replace the whole "type select + Add button" div AND the bordered per-type fields box AND the old show/hide logic with:

```tsx
          <QuoteItemComposer
            submitLabel="+ Add item"
            onSubmit={(item: DraftQuoteItem) => setItems((prev) => [...prev, item])}
          />
```

5. The added-items list stays as-is but may use `TYPE_LABELS[item.product_type]` instead of its local copy.

- [ ] **Step 3: iPad date/budget fixes in QuoteModal**

Change the Desired-date/Budget wrapper:

```tsx
          <div className="grid grid-cols-1 min-[480px]:grid-cols-2 gap-2">
```

and add `min-w-0` to each of the two inner field `<div>`s.

- [ ] **Step 4: Global iOS date-input CSS**

Append to the end of `src/index.css` (outside any `@layer` blocks, plain rule):

```css
/* iOS Safari gives <input type=date> a large intrinsic width that overflows
   narrow containers; force it to respect layout sizing. */
input[type="date"] {
  -webkit-appearance: none;
  appearance: none;
  min-width: 0;
  width: 100%;
}
```

- [ ] **Step 5: Verify**

```bash
cd home-bakery-management-system
npx tsc --noEmit 2>&1 | grep -E "QuoteModal|QuoteItemComposer|index.css"
npm test 2>&1 | grep Tests
```

Expected: no tsc output for those files; `Tests 201 passed (201)`.

- [ ] **Step 6: Commit**

```bash
git add home-bakery-management-system/src/components/QuoteItemComposer.tsx home-bakery-management-system/src/components/QuoteModal.tsx home-bakery-management-system/src/index.css
git commit -m "refactor(quotes): shared item composer + iPad date/budget overflow fix"
```

---

### Task 5: Quotes.tsx — Save/Email buttons + item editor + Convert `$` fix

**Files:**
- Modify: `home-bakery-management-system/src/pages/Quotes.tsx`, `src/components/QuoteConvertModal.tsx`

**Interfaces:**
- Consumes: `handleSave`=existing `saveQuote`; `handleEmailQuote/handleAddQuoteItem/handleUpdateQuoteItem/handleDeleteQuoteItem` from store (Task 3); `QuoteItemComposer`, `TYPE_LABELS`, `DraftQuoteItem` (Task 4).
- Produces: dashboard editor UI.

- [ ] **Step 1: State + handlers**

Add imports:

```tsx
import QuoteItemComposer, { TYPE_LABELS, type DraftQuoteItem } from "../components/QuoteItemComposer";
```

(destructure the four new handlers from useStore alongside existing ones). Add state inside the component:

```tsx
  const [emailing, setEmailing] = useState(false);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
```

Reset them in `openDetail`: `setEditingItemId(null); setAddOpen(false);`

Add handler:

```tsx
  async function emailQuote() {
    if (!selected || emailing) return;
    setEmailing(true);
    setSaveMsg(null);
    try {
      await handleEmailQuote(selected.id);
      setSaveMsg("Quote emailed.");
    } catch (err: any) {
      setSaveMsg(err.message || "Failed to email quote.");
    } finally {
      setEmailing(false);
    }
  }
```

(Keep the modal OPEN on success so the confirmation shows; refreshQuotes updates the status badge live.)
```

Modify `saveQuote` success message to `"Saved."`.

- [ ] **Step 2: Buttons row**

Replace the current flex row containing `[Save & Email Quote]` + `[Convert to Order]` with:

```tsx
                  <button onClick={saveQuote} disabled={saving} className="btn-primary flex-1">
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button
                    onClick={emailQuote}
                    disabled={emailing || selected.quotedPrice == null}
                    className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={selected.quotedPrice == null ? "Save a quoted price first" : undefined}
                  >
                    {emailing ? "Emailing..." : "Email Quote"}
                  </button>
                  <button
                    onClick={() => setConvertOpen(true)}
                    disabled={selected.quotedPrice == null}
                    className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                    title={selected.quotedPrice == null ? "Save a quoted price first" : undefined}
                  >
                    Convert
                  </button>
```

- [ ] **Step 3: Item editor UI**

Compute once above the return: `const itemsEditable = !!selected && selected.status !== "converted" && selected.status !== "archived";`

Inside each rendered item card header row (the flex with ProductIcon + title), when `itemsEditable`, append after the `#{idx+1}` span:

```tsx
                      {itemsEditable && editingItemId !== item.id && (
                        <>
                          <button
                            onClick={() => { setEditingItemId(item.id); setAddOpen(false); }}
                            className="ml-auto text-xs font-medium text-palm hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => {
                              if (!window.confirm("Remove this item from the quote?")) return;
                              handleDeleteQuoteItem(selected.id, item.id).catch(() => setSaveMsg("Failed to remove item."));
                            }}
                            className="text-hibiscus hover:underline text-xs font-medium"
                          >
                            ✕
                          </button>
                        </>
                      )}
```

And at the top of the card's returned children — when `editingItemId === item.id`, render the composer INSTEAD of the detail rows:

```tsx
                    {editingItemId === item.id ? (
                      <QuoteItemComposer
                        initial={{ product_type: item.product_type, details: item.details }}
                        submitLabel="Save item"
                        onSubmit={(draft: DraftQuoteItem) =>
                          handleUpdateQuoteItem(selected.id, item.id, { details: draft.details })
                            .then(() => setEditingItemId(null))
                            .catch(() => setSaveMsg("Failed to update item."))
                        }
                        onCancel={() => setEditingItemId(null)}
                      />
                    ) : (
                      <> ...existing detail rows + 📷 link... </>
                    )}
```

After the items list closing tag (still inside Column A's items section div), add:

```tsx
              {itemsEditable && !addOpen && editingItemId === null && (
                <button
                  onClick={() => { setAddOpen(true); }}
                  className="w-full rounded-xl border border-dashed border-sand-200 py-2 text-sm font-medium text-cocoa-muted hover:border-palm hover:text-palm"
                >
                  + Add item
                </button>
              )}
              {itemsEditable && addOpen && selected && (
                <div className="rounded-xl border border-sand-200 p-4">
                  <QuoteItemComposer
                    submitLabel="Add item"
                    onSubmit={(draft: DraftQuoteItem) =>
                      handleAddQuoteItem(selected.id, draft)
                        .then(() => setAddOpen(false))
                        .catch(() => setSaveMsg("Failed to add item."))
                    }
                    onCancel={() => setAddOpen(false)}
                  />
                </div>
              )}
              {itemsEditable && (
                <p className="text-[10px] text-cocoa-muted/70">
                  Price isn't updated automatically — adjust it and press Email Quote when ready.
                </p>
              )}
```

Notes: reuse the existing `errorMsg` state (already used by delete flow) for these errors; `selected.items.length === 0` fallback card remains and disappears naturally once items exist.

- [ ] **Step 4: Convert modal `$` fix**

In `src/components/QuoteConvertModal.tsx` line ~89 change:

```tsx
              <span className="font-semibold text-coral">{(quotedCents / 100).toFixed(2)}</span>
```

to:

```tsx
              <span className="font-semibold text-coral">${(quotedCents / 100).toFixed(2)}</span>
```

- [ ] **Step 5: Verify**

```bash
cd home-bakery-management-system
npx tsc --noEmit 2>&1 | grep -E "Quotes\.tsx|QuoteConvertModal\.tsx"
npm test 2>&1 | grep Tests
```

Expected: no tsc matches; tests pass (201).

- [ ] **Step 6: Commit**

```bash
git add home-bakery-management-system/src/pages/Quotes.tsx home-bakery-management-system/src/components/QuoteConvertModal.tsx
git commit -m "feat(quotes): save-only + deliberate email, full item editor, convert $ fix"
```

---

### Task 6: Build + deploy + live smoke (controller-run)

- [ ] `npm run build` in home-bakery-management-system; commit bundle: `git add admin/index.html && git commit -m "chore(admin): rebuild bundle — quote save/email split + item editor"`
- [ ] `npx wrangler deploy -c orders/wrangler.toml` (worker changed!)
- [ ] `npx wrangler versions upload --name muyrico --assets . --compatibility-date 2025-03-21` then `versions deploy <ID>@100%`
- [ ] Live smoke (create → exercise → cleanup):
  1. POST public quote without price → PATCH price (must NOT email) → POST /email → verify status flipped replied
  2. POST /items add custom item → PATCH its details → DELETE it
  3. Email without price on fresh quote → 400 message
  4. Delete smoke quote(s)
- [ ] Push origin; update SDD ledger.
