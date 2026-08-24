# Quote Detail Modal Redesign + Reference-Photo Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the dashboard quote detail modal so the owner sees customer intent at a glance (images first, friendly item cards, budget next to price, customer history), and fix the website bug that drops the customer's uploaded reference image.

**Architecture:** Two workstreams: (1) a one-line payload fix in `quote.html`; (2) a presentational restructure of the detail modal inside `home-bakery-management-system/src/pages/Quotes.tsx` — no backend/API changes anywhere. Admin bundle rebuilt and committed at the end (existing postbuild pattern).

**Tech Stack:** static HTML/JS website (`quote.html`), React 19 + Vite + Tailwind SPA, TypeScript, vitest.

## Global Constraints

1. Work on `main`. `git add` only the exact files listed in each task — never `git add -A`.
2. No backend changes (`orders/workers/api.js` is untouched). No new npm dependencies.
3. The public website quote flow must keep working exactly as before (form fields, validation, success screen); the only behavioral change is that `reference_image_url` is now sent.
4. Dashboard UI is English-only; customer-facing pages stay bilingual — this plan touches only the dashboard.
5. Follow existing code style in `Quotes.tsx`: Tailwind utilities with project palette (`palm`, `coral`, `sand-*`, `cocoa`, `cocoa-muted`, `hibiscus`, `mid-green`, `cream-deep`), `Modal` from `components/ui/Modal`, `btn-primary`/`btn-secondary`/`input` classes, lucide-react icons.
6. Test gates per task: `cd home-bakery-management-system && npm test` passes (201 tests) and `npx tsc --noEmit` produces zero NEW errors in touched files. Baseline tsc errors currently exist in `src/context/StoreContext.tsx` (lines 23, 123, 184) — pre-existing, do not touch.
   - These are presentational UI changes with no component-test harness for modals in this repo (existing *.test.tsx files cover widgets/pages only). Per repo convention do NOT add new component tests; verification is tsc + existing suite + manual visual review.
7. Never touch the remote D1 database during implementation.

---

### Task 1: Website — send reference_image_url in quote payload

**Files:**
- Modify: `quote.html` (submit handler `fetch('/api/quotes', {...})` body, ~line 997)

**Interfaces:**
- Consumes: `uploadedImageUrl` (existing module-level `let` in quote.html, set by the upload handler at ~line 717).
- Produces: `POST /api/quotes` body now includes `reference_image_url: string | null` — already accepted by the backend (`orders/workers/api.js` createQuote binds `body.reference_image_url || null`) and already displayed by the dashboard (`Quote.referenceImageUrl`). No other task depends on this one.

- [ ] **Step 1: Add the field to the payload**

In `quote.html`, in the submit handler's `JSON.stringify({...})`, add one line after `inspiration: selectedInspiration,`:

```js
          items,
          inspiration: selectedInspiration,
          reference_image_url: uploadedImageUrl || null,
```

- [ ] **Step 2: Verify JS still parses**

Run:

```bash
node -e "
const s=require('fs').readFileSync('quote.html','utf8');
const blocks=[...s.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const block=blocks.find(b=>b.includes(\"addEventListener('submit'\"));
if(!block) throw new Error('submit block not found');
new Function(block);
console.log('JS OK');
"
```

Expected output: `JS OK`.

- [ ] **Step 3: Commit**

```bash
git add quote.html
git commit -m "fix(quote-form): include uploaded reference image in submit payload"
```

---

### Task 2: Dashboard — friendly item cards + legacy fallback

**Files:**
- Modify: `home-bakery-management-system/src/pages/Quotes.tsx` (add module-level helpers; replace the items section inside the detail modal)

**Interfaces:**
- Consumes: existing `selected: Quote | null`; `selected.items: QuoteItem[]`; `ProductIcon` (`emoji`, `imageUrl`, `size` props); quote-level legacy fields `selected.cakeFlavor` (`string`), `selected.filling`/`selected.frosting` (`string | null`), `selected.servingSize` (`string | null`), `selected.toppings` (`string[]`).
- Produces: module-level constants/functions used again by Task 3: `ITEM_DETAIL_LABELS`, `ITEM_EMOJI`, `itemCardTitle(item)`, plus a full replacement items-section JSX block (with a legacy single-card fallback when `selected.items.length === 0`).

- [ ] **Step 1: Add module-level helpers**

In `home-bakery-management-system/src/pages/Quotes.tsx`, add immediately before `export default function Quotes(...)` (after the imports):

```tsx
const ITEM_DETAIL_LABELS: Record<string, Record<string, string>> = {
  cake: {
    cake_flavor: "Cake flavor",
    filling: "Filling",
    frosting: "Frosting",
    serving_size: "Serving size",
    toppings: "Toppings",
  },
  cakepops: {
    cake_flavor: "Cake flavor",
    chocolate_dip: "Chocolate dip",
    topping_style: "Topping style",
    quantity: "Quantity",
    design_theme: "Design theme",
  },
  cupcakes: {
    cake_flavor: "Cake flavor",
    frosting: "Frosting",
    quantity: "Quantity",
  },
  custom: {
    name: "Name",
    description: "Description",
    quantity: "Quantity",
  },
};

const ITEM_EMOJI: Record<string, string> = {
  cake: "🎂",
  cakepops: "🍭",
  cupcakes: "🧁",
  custom: "✨",
};

function itemCardTitle(item: Quote["items"][number]): string {
  const d = item.details || {};
  switch (item.product_type) {
    case "cake":
      return d.cake_flavor ? `Custom Cake — ${d.cake_flavor}` : "Custom Cake";
    case "cakepops":
      return `Cakepops ×${Number(d.quantity) || 6}`;
    case "cupcakes":
      return `Cupcakes ×${Number(d.quantity) || 6}`;
    case "custom": {
      const qty = Number(d.quantity) || 1;
      const base = String(d.name || "Custom item");
      return qty > 1 ? `${base} ×${qty}` : base;
    }
    default:
      return item.product_type;
  }
}
```

- [ ] **Step 2: Replace the items-section markup**

Replace the entire current `{/* Items Section */}` block (the `<div className="space-y-3">` containing the count `<h3>` and the `selected.items.map(...)`) with EXACTLY:

```tsx
            {/* Items Section */}
            <div className="space-y-3">
              {selected.items.length > 0 && (
                <h3 className="text-xs font-semibold uppercase tracking-wide text-cocoa-muted">
                  {selected.items.length} {selected.items.length === 1 ? "Item" : "Items"}
                </h3>
              )}
              {selected.items.length === 0 && (
                <div className="rounded-xl bg-cream-deep/50 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <ProductIcon emoji="🎂" size={28} imageUrl={null} />
                    <span className="font-semibold text-cocoa">
                      {selected.cakeFlavor ? `Custom Cake — ${selected.cakeFlavor}` : "Custom Cake"}
                    </span>
                  </div>
                  {selected.filling && (
                    <div className="flex justify-between gap-4">
                      <span className="text-cocoa-muted text-xs">Filling</span>
                      <span className="font-medium text-cocoa text-sm text-right">{selected.filling}</span>
                    </div>
                  )}
                  {selected.frosting && (
                    <div className="flex justify-between gap-4">
                      <span className="text-cocoa-muted text-xs">Frosting</span>
                      <span className="font-medium text-cocoa text-sm text-right">{selected.frosting}</span>
                    </div>
                  )}
                  {selected.servingSize && (
                    <div className="flex justify-between gap-4">
                      <span className="text-cocoa-muted text-xs">Serving size</span>
                      <span className="font-medium text-cocoa text-sm text-right">{selected.servingSize}</span>
                    </div>
                  )}
                  {selected.toppings.length > 0 && (
                    <div>
                      <p className="text-cocoa-muted text-xs">Toppings</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {selected.toppings.map((t) => (
                          <span key={t} className="rounded-full bg-coral-light/20 px-2 py-0.5 text-xs font-medium text-coral ring-1 ring-coral-light">
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {selected.items.map((item, idx) => {
                const labels = ITEM_DETAIL_LABELS[item.product_type] || {};
                const skipDetail = (key: string) =>
                  (item.product_type === "custom" && key === "name") ||
                  ((item.product_type === "cakepops" || item.product_type === "cupcakes" || item.product_type === "custom") && key === "quantity");
                return (
                  <div key={item.id} className="rounded-xl bg-cream-deep/50 p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <ProductIcon
                        emoji={ITEM_EMOJI[item.product_type] || "🍞"}
                        size={28}
                        imageUrl={item.reference_image_url}
                      />
                      <span className="font-semibold text-cocoa">{itemCardTitle(item)}</span>
                      {selected.items.length > 1 && (
                        <span className="text-xs text-cocoa-muted">#{idx + 1}</span>
                      )}
                    </div>
                    {Object.entries(item.details).map(([key, value]) => {
                      if (skipDetail(key)) return null;
                      const label = labels[key] || key.replace(/_/g, " ");
                      if (key === "toppings" && Array.isArray(value) && value.length > 0) {
                        return (
                          <div key={key}>
                            <p className="text-cocoa-muted text-xs">{label}</p>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {value.map((t: string) => (
                                <span key={t} className="rounded-full bg-coral-light/20 px-2 py-0.5 text-xs font-medium text-coral ring-1 ring-coral-light">
                                  {t}
                                </span>
                              ))}
                            </div>
                          </div>
                        );
                      }
                      if (value && String(value).trim()) {
                        return (
                          <div key={key} className="flex justify-between gap-4">
                            <span className="text-cocoa-muted text-xs">{label}</span>
                            <span className="font-medium text-cocoa text-sm text-right">
                              {Array.isArray(value) ? value.join(", ") : String(value)}
                            </span>
                          </div>
                        );
                      }
                      return null;
                    })}
                    {item.reference_image_url && (
                      <a
                        href={item.reference_image_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-palm hover:underline"
                      >
                        📷 View photo
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
```

- [ ] **Step 3: Verify**

```bash
cd home-bakery-management-system
npx tsc --noEmit 2>&1 | grep "Quotes.tsx"
```

Expected: no output (grep exits 1).

```bash
npm test 2>&1 | tail -4
```

Expected: `Tests 201 passed (201)`.

- [ ] **Step 4: Commit**

```bash
git add home-bakery-management-system/src/pages/Quotes.tsx
git commit -m "feat(quotes): friendly item cards in quote detail modal"
```

---

### Task 3: Dashboard — two-column modal layout + visuals zone

**Files:**
- Modify: `home-bakery-management-system/src/pages/Quotes.tsx` (detail-modal body restructure only)

**Interfaces:**
- Consumes: `ITEM_EMOJI`, `itemCardTitle`, `ITEM_DETAIL_LABELS` from Task 2; `selected.referenceImageUrl`, `selected.inspiration`, `selected.comments`, `selected.occasion`, `selected.desiredDate`, `selected.dietary`.
- Produces: detail-modal body wrapped in a desktop two-column grid (`grid gap-6 sm:grid-cols-2`, single-column stack on phone in priority order). Column A = customer request (section label → visuals zone → items → comments → meta facts). Column B = the existing admin card (moved verbatim). Old bottom "reference image" block and old standalone "inspiration" block are deleted; the budget row is removed from the meta facts block (it moves in Task 4).

- [ ] **Step 1: Restructure the modal body**

In the detail modal, AFTER the customer info header and BEFORE the created/updated footer, the body currently contains, in order: order-level-details block, items section, inspiration block, comments block, reference-image block, admin-actions card. Replace that whole middle region with the two-column structure below. The items-section markup is exactly the Task 2 Step 2 code — do not retype it differently; wrap it as-is.

The new structure (shown as the full JSX for the region between the customer-info header and the `"Created {formatDate(...)}"` footer line):

```tsx
            <div className="grid gap-6 sm:grid-cols-2">
              {/* Column A — what the customer asked for */}
              <div className="space-y-5">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-cocoa-muted/60">
                  Customer request
                </h3>

                {/* Visuals zone */}
                {(selected.referenceImageUrl || (selected.inspiration && selected.inspiration.length > 0)) && (
                  <div className="space-y-3">
                    {selected.referenceImageUrl && (
                      <div>
                        <p className="mb-1 text-xs font-medium text-cocoa-muted">Reference photo</p>
                        <a href={selected.referenceImageUrl} target="_blank" rel="noopener noreferrer">
                          <img
                            src={selected.referenceImageUrl}
                            alt="Customer reference"
                            className="max-h-64 w-full rounded-xl border border-sand-200 object-cover"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        </a>
                      </div>
                    )}
                    {selected.inspiration && selected.inspiration.length > 0 && (
                      <div>
                        <p className="mb-1 text-xs font-medium text-cocoa-muted">Inspiration they picked</p>
                        <div className="flex flex-wrap gap-2">
                          {selected.inspiration.map((insp, idx) => (
                            <a
                              key={idx}
                              href={insp.image_url || undefined}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 rounded-xl bg-cream-deep/50 p-2"
                            >
                              {insp.image_url && (
                                <img
                                  src={insp.image_url}
                                  alt={insp.title || "Inspiration"}
                                  onError={(e) => {
                                    e.currentTarget.style.display = "none";
                                  }}
                                  className="h-16 w-16 rounded-lg border border-sand-200 object-cover"
                                />
                              )}
                              <span className="text-sm font-medium text-cocoa">{insp.title}</span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Items Section — paste the exact markup produced by Task 2 Step 2 here, unchanged */}

                {/* Comments */}
                {selected.comments && (
                  <div className="rounded-xl bg-coral-light/20 p-3 text-sm italic text-cocoa">
                    "{selected.comments}"
                  </div>
                )}

                {/* Meta facts (budget lives next to the price input now) */}
                <div className="rounded-xl border border-sand-100 bg-sand-50 p-4 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-cocoa-muted">Occasion</span>
                    <span className="font-medium text-cocoa">{selected.occasion || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-cocoa-muted">Desired date</span>
                    <span className="font-medium text-cocoa">{selected.desiredDate || "—"}</span>
                  </div>
                  {selected.dietary.length > 0 && (
                    <div>
                      <p className="text-cocoa-muted">Dietary</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {selected.dietary.map((t) => (
                          <span
                            key={t}
                            className="rounded-full bg-mid-green-light/20 px-2 py-0.5 text-xs font-medium text-palm ring-1 ring-mid-green-light"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Column B — pricing & admin */}
              <div className="space-y-5">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-cocoa-muted/60">
                  Pricing &amp; admin
                </h3>
                {/* Paste the EXISTING admin actions card here verbatim:
                    the entire block beginning
                      <div className="rounded-xl border border-sand-200 p-4 space-y-3">
                        <p className="text-xs font-semibold uppercase text-cocoa-muted/60">Admin</p>
                        ... (quote-document EN/ES/Print group, quoted price input, admin notes,
                        Save & Email Quote / Convert row, View Order link, saveMsg, Archive link,
                        Delete link, Unarchive link) ...
                      </div>
                    It moves into this column without modification (Task 4 edits inside it). */}
              </div>
            </div>
```

**Explicit delete list after the move:**
- Delete the OLD order-level-details block (`{/* Order-level details */}` … including its budget row).
- Delete the OLD standalone `{/* Inspiration */}` block.
- Delete the OLD `{/* Comments */}` block at its old position (it's now inside column A).
- Delete the OLD bottom `{/* Reference image */}` block (now the visuals zone).
- Delete the OLD items section from its old position (it's inside column A now).

The customer info header (name/email/phone/language chip/Badge) stays untouched above the grid. The created/updated footer line stays untouched below the grid.

- [ ] **Step 2: Verify**

```bash
cd home-bakery-management-system
npx tsc --noEmit 2>&1 | grep "Quotes.tsx"
```

Expected: no output.

```bash
npm test 2>&1 | tail -4
```

Expected: `Tests 201 passed (201)`.

**Manual visual review (required before commit):** run `npm run dev`, open Quotes, open a quote detail, and check on a narrow window (phone width): images → items → comments → meta → pricing read top-to-bottom. Close dev server.

- [ ] **Step 3: Commit**

```bash
git add home-bakery-management-system/src/pages/Quotes.tsx
git commit -m "feat(quotes): two-column quote modal with images front and center"
```

---

### Task 4: Dashboard — budget next to price + customer history strip

**Files:**
- Modify: `home-bakery-management-system/src/pages/Quotes.tsx`

**Interfaces:**
- Consumes: store `orders: Order[]` (`Order.customerId: string | null`), store `customers: Customer[]` (`Customer.email: string`, `Customer.id: string`), store `quotes: Quote[]`, `selected.budget`, `selected.email`, `selected.phone`, `selected.customerName`.
- Produces: budget line directly above the price input in the admin card; full-width customer-history strip below the grid.

**Customer history matching rule (exact):** `Order` has NO email field, so orders are matched via the customer record: `customers.find(c => (c.email || "").toLowerCase() === selected.email.toLowerCase())` → `customer.id`; then `orders.filter(o => o.customerId === customer.id).length`. Quote history: `quotes.filter(q => q.id !== selected.id && q.email.toLowerCase() === selected.email.toLowerCase()).length`. No name-based fallback.

- [ ] **Step 1: Pull orders/customers from the store**

Change the destructure line:

```tsx
  const { quotes, handleUpdateQuote, handleDeleteQuote, loading } = useStore();
```

to:

```tsx
  const { quotes, orders, customers, handleUpdateQuote, handleDeleteQuote, loading } = useStore();
```

- [ ] **Step 2: Add history computation**

Add after the `deleteQuote` function (before `return (`):

```tsx
  const history = useMemo(() => {
    if (!selected || !selected.email) return null;
    const email = selected.email.toLowerCase();
    const customer = customers.find((c) => (c.email || "").toLowerCase() === email);
    const pastOrders = customer
      ? orders.filter((o) => o.customerId === customer.id).length
      : 0;
    const otherQuotes = quotes.filter(
      (q) => q.id !== selected.id && q.email.toLowerCase() === email,
    ).length;
    return { pastOrders, otherQuotes };
  }, [selected, customers, orders, quotes]);
```

- [ ] **Step 3: Budget above the price input**

In the admin card, replace the quoted-price block with (complete replacement):

```tsx
              <div>
                <p className="text-xs font-medium text-cocoa-muted">Budget customer shared</p>
                <p className={`mb-2 mt-0.5 text-sm font-semibold ${selected.budget ? "text-cocoa" : "text-cocoa-muted/60"}`}>
                  {selected.budget || "Not shared"}
                </p>
                <label className="mb-1 block text-xs font-medium text-cocoa-muted">
                  Your quoted price ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={quotedPrice}
                  onChange={(e) => setQuotedPrice(e.target.value)}
                  placeholder="0.00"
                  className="input"
                  disabled={selected.status === "converted" || selected.status === "archived"}
                />
              </div>
```

- [ ] **Step 4: Add the history strip**

Immediately after the closing `</div>` of the two-column grid (i.e., right before the existing footer `<div className="flex items-center justify-between text-xs text-cocoa-muted">` with "Created / Updated"), add:

```tsx
            {/* Customer history */}
            <div className="rounded-xl border border-sand-100 bg-sand-50 px-4 py-3 text-xs text-cocoa-muted">
              <span className="font-semibold text-cocoa">{selected.customerName}</span>
              {" · "}{selected.email}
              {selected.phone && <>{" · "}{selected.phone}</>}
              {history && (
                <span className="text-cocoa-muted/80">
                  {" — "}
                  {history.pastOrders} past {history.pastOrders === 1 ? "order" : "orders"}
                  {" · "}
                  {history.otherQuotes} other {history.otherQuotes === 1 ? "quote" : "quotes"}
                </span>
              )}
            </div>
```

- [ ] **Step 5: Verify**

```bash
cd home-bakery-management-system
npx tsc --noEmit 2>&1 | grep "Quotes.tsx"
```

Expected: no output.

```bash
npm test 2>&1 | tail -4
```

Expected: `Tests 201 passed (201)`.

- [ ] **Step 6: Commit**

```bash
git add home-bakery-management-system/src/pages/Quotes.tsx
git commit -m "feat(quotes): budget next to price input + customer history strip"
```

---

### Task 5: Rebuild admin bundle

**Files:**
- Modify: `admin/index.html` (generated by the build)

**Interfaces:**
- Consumes: Tasks 2-4 output.
- Produces: rebuilt single-file admin bundle containing the redesigned modal.

- [ ] **Step 1: Build**

```bash
cd home-bakery-management-system
npm run build
```

Expected: `✓ built in <time>` and postbuild copies to `admin/index.html`. If the build fails with `ENFILE: file table overflow`, kill orphaned dev processes first (`ps aux | grep -E 'wrangler|vite' | grep -v grep`, then `kill -9 <pids>`), then retry.

- [ ] **Step 2: Sanity-check the bundle**

```bash
grep -c "Customer request" admin/index.html
grep -c "Budget customer shared" admin/index.html
```

Expected: both output `1` or more.

- [ ] **Step 3: Commit**

```bash
git add admin/index.html
git commit -m "chore(admin): rebuild bundle — quote detail redesign + reference photos"
```

---

## Post-implementation (manual, after next deployment)

Not part of this plan's tasks — do at deploy time:

1. Frontend-only deploy per `orders/DEPLOY.md`: `npx wrangler versions upload --name muyrico --assets . --compatibility-date 2025-03-21` then `npx wrangler versions deploy --name muyrico <VERSION_ID>@100%`. (No worker changes in this plan; skip `wrangler deploy -c orders/wrangler.toml`.)
2. Live smoke: submit a test quote from `quote.html` with a photo attached → open it in the dashboard → confirm the photo appears at the top → delete the test quote.
3. Owner check on phone: open a real quote; confirm single-column reads top-to-bottom: images → items → comments → meta → pricing → history.
