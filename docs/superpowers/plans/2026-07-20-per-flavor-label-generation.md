# Per-Flavor Automatic Label Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate one label per distinct order line item (including flavor), so an order with chocolate + vanilla + strawberry cupcakes produces 3 labels.

**Architecture:** The Cloudflare worker already auto-generates labels per order; the fix keys label identity off the line-item name (which includes flavor) instead of the product name, and renames labels to `MR-{orderId} - {itemName}` so the existing Orders→LabelDesigner filter works. The admin OrderModal gains flavor dropdowns that compose item names in the website's exact format.

**Tech Stack:** Cloudflare Worker + D1 (vanilla JS, `orders/workers/api.js`), React 19 + Vite + Tailwind (`home-bakery-management-system/`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-20-per-flavor-label-generation-design.md` — follow it exactly.
- Label name format (verbatim): `MR-{orderId} - {itemName}` (e.g. `MR-12 - Cupcakes (6) (Cupcake flavor: Chocolate)`).
- Manual-order item name format (verbatim, must match website `order.html:1256-1265`): `{product.name}` + ` (` + `{Group}: {Option}, {Group2}: {Option2}` + `)`.
- No test framework exists in this repo (no vitest/jest). Verification = local worker (`wrangler dev` + local D1) + vite + Playwright scripts, exactly as the spec's §7. Each task runs its verification BEFORE (expect failure) and AFTER (expect pass).
- Do NOT run the label backfill endpoint against production (spec: new orders only).
- No schema migrations; no label layout changes; no per-flavor ingredient data.
- `admin/index.html` is the committed build artifact: regenerate via `npm run build` (runs `postbuild.sh`) and commit with source.
- Work on branch `main`.

---

### Task 1: Worker — per-item label identity in `generateLabelsForOrder`

**Files:**
- Modify: `orders/workers/api.js` (function `generateLabelsForOrder`, lines ~908-1011; function `backfillAllOrderLabels`, lines ~1022-1039)

**Interfaces:**
- Consumes: existing order `items_json` entries shaped `{ name, qty, price, productId? }` (website sends flavor-inclusive `name`).
- Produces: labels in `label_templates` with `name = "MR-{orderId} - {itemName}"` and `product_name = itemName`. The Orders page filter (`MR-{id}`) and the LabelDesigner rely on these exact strings.

- [ ] **Step 1: Start the local worker and reproduce the current (broken) behavior**

Local D1 was already migrated in the earlier session (state in `orders/.wrangler/`). Start the worker:

```bash
cd /Users/garciafam/Documents/website/Muy-Rico-V2/orders
nohup npx --yes wrangler dev --local --port 8787 > /tmp/wrangler.log 2>&1 &
sleep 8
tail -5 /tmp/wrangler.log   # expect: Ready on http://localhost:8787
```

Create a 3-flavor order exactly as the website would (flavor embedded in each item name):

```bash
curl -s -X POST http://localhost:8787/api/orders -H 'Content-Type: application/json' -d '{
  "customer_name": "FlavorTest", "phone": "555", "pickup_date": "2026-07-22",
  "items_json": [
    {"name":"Cupcakes (6) (Cupcake flavor: Chocolate)","qty":1,"price":18,"productId":"prod_cupcakes"},
    {"name":"Cupcakes (6) (Cupcake flavor: Vanilla)","qty":1,"price":18,"productId":"prod_cupcakes"},
    {"name":"Cupcakes (6) (Cupcake flavor: Strawberry)","qty":1,"price":18,"productId":"prod_cupcakes"}
  ],
  "total_cents": 5400, "payment_method": "cash", "payment_status": "paid", "source": "website"
}'
# note the returned {"ok":true,"id":N}
```

Wait ~2s for `ctx.waitUntil(generateLabelsForOrder)`, then inspect generated labels for that order:

```bash
curl -s http://localhost:8787/api/labels | python3 -c "
import sys, json
for t in json.load(sys.stdin)['labelTemplates']:
    if 'Order #' in t['name'] or t['name'].startswith('MR-'):
        print(t['name'])
"
```

Expected (CURRENT, broken): exactly ONE line — `Order #N - Cupcakes (6)` — the vanilla/strawberry labels were skipped as duplicates.

- [ ] **Step 2: Edit the order prefix constant**

In `orders/workers/api.js`, find (line ~916-917):

```js
  const foodColoring = (body.food_coloring || '').trim();
  const orderId_str = `Order #${orderId}`;
```

Replace with:

```js
  const foodColoring = (body.food_coloring || '').trim();
  const orderPrefix = `MR-${orderId}`;
```

- [ ] **Step 3: Edit the dedupe + label-name block**

Find (lines ~934-943):

```js
    if (!product || !product.auto_generate_label) continue;

    // Skip if label already exists for this order + product
    const existing = await env.DB.prepare(
      `SELECT id FROM label_templates WHERE name = ? LIMIT 1`
    ).bind(`${orderId_str} - ${product.name}`).first();
    if (existing) continue;

    const labelId = `label_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const labelName = `${orderId_str} - ${product.name}`;
```

Replace with:

```js
    if (!product || !product.auto_generate_label) continue;

    // Label identity = the line item's own name (includes flavor/pack, e.g.
    // "Cupcakes (6) (Cupcake flavor: Chocolate)") so each flavor gets its own label.
    const itemName = (item.name || product.name).trim();

    // Skip if label already exists for this order + item
    const existing = await env.DB.prepare(
      `SELECT id FROM label_templates WHERE name = ? LIMIT 1`
    ).bind(`${orderPrefix} - ${itemName}`).first();
    if (existing) continue;

    const labelId = `label_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const labelName = `${orderPrefix} - ${itemName}`;
```

- [ ] **Step 4: Put the flavor on the printed label**

Find (line ~965):

```js
      product_name: product.name,
```

Replace with:

```js
      product_name: itemName,
```

- [ ] **Step 5: Update the backfill prefix check**

In `backfillAllOrderLabels`, find (lines ~1029-1031):

```js
    const before = await env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM label_templates WHERE name LIKE ?`
    ).bind(`Order #${order.id} - %`).first();
```

Replace the bind line with:

```js
    ).bind(`MR-${order.id} - %`).first();
```

- [ ] **Step 6: Verify per-flavor labels now generate**

`wrangler dev` hot-reloads on save. Create a second 3-flavor order (same curl as Step 1, change customer_name to `FlavorTest2`), wait 2s, then:

```bash
curl -s http://localhost:8787/api/labels | python3 -c "
import sys, json
for t in json.load(sys.stdin)['labelTemplates']:
    if t['name'].startswith('MR-'):
        print(t['name'], '| product_name:', t['product_name'])
"
```

Expected: THREE lines for the new order, e.g.
```
MR-N - Cupcakes (6) (Cupcake flavor: Chocolate) | product_name: Cupcakes (6) (Cupcake flavor: Chocolate)
MR-N - Cupcakes (6) (Cupcake flavor: Vanilla) | product_name: Cupcakes (6) (Cupcake flavor: Vanilla)
MR-N - Cupcakes (6) (Cupcake flavor: Strawberry) | product_name: Cupcakes (6) (Cupcake flavor: Strawberry)
```

Also verify qty-merge dedupe: POST another order with the SAME chocolate item twice as one line (qty 2) plus vanilla — expect exactly 2 labels (one chocolate, one vanilla), proving identical items still dedupe.

- [ ] **Step 7: Commit**

```bash
cd /Users/garciafam/Documents/website/Muy-Rico-V2
git add orders/workers/api.js
git commit -m "feat(labels): generate one label per order line item (per flavor)

Label identity switches from product name to the line-item name, so
chocolate/vanilla/strawberry cupcakes each get their own label (MDARD
requires individually labeled cottage food products). Labels are now
named 'MR-{orderId} - {itemName}', which also fixes the Orders page
'View Labels' filter that passes the MR- order number."
```

---

### Task 2: OrderModal — flavor dropdowns for manual orders

**Files:**
- Modify: `home-bakery-management-system/src/types.ts` (`OrderItem`, line ~79-85)
- Modify: `home-bakery-management-system/src/components/OrderModal.tsx`

**Interfaces:**
- Consumes: `products` from `useStore()` — each product may have `flavor_groups?: FlavorGroup[]` where `FlavorGroup = { name: string; name_es?: string; options: string[] }` (already mapped in `StoreContext.tsx:114-142`).
- Produces: `items_json` entries `{ name, qty, price, productId }` where `name` matches the website format `Cupcakes (6) (Cupcake flavor: Chocolate)` — Task 1's worker logic reads `item.name` verbatim. `OrderItem` gains `flavorNote?: string` used only as the line-item key.

- [ ] **Step 1: Add `flavorNote` to `OrderItem`**

In `home-bakery-management-system/src/types.ts`, find:

```ts
export interface OrderItem {
  productId: string;
  name: string;
  emoji: string;
  qty: number;
  price: number;
}
```

Replace with:

```ts
export interface OrderItem {
  productId: string;
  name: string;
  emoji: string;
  qty: number;
  price: number;
  flavorNote?: string;
}
```

- [ ] **Step 2: Add flavor-selection state and derived values**

In `home-bakery-management-system/src/components/OrderModal.tsx`, after line 15 (`const [items, setItems] = useState<OrderItem[]>([]);`), add:

```tsx
  const [flavorSelections, setFlavorSelections] = useState<Record<string, string>>({});
```

After the `activeProducts` line (line ~30), add:

```tsx
  const pickedProduct = products.find((p) => p.id === productPick);
  const pickedFlavorGroups = pickedProduct?.flavor_groups ?? [];
  const flavorsComplete = pickedFlavorGroups.every((g) => !!flavorSelections[g.name]);
```

- [ ] **Step 3: Rewrite `addItem` to compose flavor-inclusive names**

Replace the current `addItem` (lines ~38-48):

```tsx
  function addItem() {
    const p = products.find((pr) => pr.id === productPick);
    if (!p) return;
    setItems((prev) => {
      const existing = prev.find((i) => i.productId === p.id);
      if (existing) {
        return prev.map((i) => (i.productId === p.id ? { ...i, qty: i.qty + 1 } : i));
      }
      return [...prev, { productId: p.id, name: p.name, emoji: p.emoji, qty: 1, price: p.price }];
    });
  }
```

with:

```tsx
  function addItem() {
    const p = products.find((pr) => pr.id === productPick);
    if (!p) return;
    const groups = p.flavor_groups ?? [];
    if (groups.some((g) => !flavorSelections[g.name])) return; // all groups required
    const flavorNote = groups.length
      ? ` (${groups.map((g) => `${g.name}: ${flavorSelections[g.name]}`).join(", ")})`
      : "";
    const displayName = p.name + flavorNote;
    setItems((prev) => {
      const existing = prev.find((i) => i.productId === p.id && (i.flavorNote || "") === flavorNote);
      if (existing) {
        return prev.map((i) =>
          i.productId === p.id && (i.flavorNote || "") === flavorNote ? { ...i, qty: i.qty + 1 } : i,
        );
      }
      return [...prev, { productId: p.id, name: displayName, emoji: p.emoji, qty: 1, price: p.price, flavorNote }];
    });
    setFlavorSelections({});
  }
```

- [ ] **Step 4: Key line items by productId + flavorNote**

Replace `updateQty` and `removeItem` (lines ~50-60):

```tsx
  function updateQty(productId: string, delta: number) {
    setItems((prev) =>
      prev
        .map((i) => (i.productId === productId ? { ...i, qty: Math.max(1, i.qty + delta) } : i))
        .filter(Boolean),
    );
  }

  function removeItem(productId: string) {
    setItems((prev) => prev.filter((i) => i.productId !== productId));
  }
```

with:

```tsx
  const itemKey = (i: OrderItem) => `${i.productId}|${i.flavorNote || ""}`;

  function updateQty(key: string, delta: number) {
    setItems((prev) =>
      prev
        .map((i) => (itemKey(i) === key ? { ...i, qty: Math.max(1, i.qty + delta) } : i))
        .filter(Boolean),
    );
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((i) => itemKey(i) !== key));
  }
```

- [ ] **Step 5: Reset flavors on product change and in `resetForm`**

In the product-pick `<select>` (line ~285), replace:

```tsx
              onChange={(e) => setProductPick(e.target.value)}
```

with:

```tsx
              onChange={(e) => {
                setProductPick(e.target.value);
                setFlavorSelections({});
              }}
```

In `resetForm` (lines ~62-75), add at the end (before the closing brace):

```tsx
    setFlavorSelections({});
```

- [ ] **Step 6: Disable the Add button until flavors are chosen, and render the dropdowns**

Replace the coral Add button (lines ~302-307):

```tsx
            <button
              onClick={addItem}
              className="rounded-xl bg-coral px-3 py-2 text-sm font-medium text-white hover:bg-coral/80"
            >
              <Plus size={16} />
            </button>
```

with:

```tsx
            <button
              onClick={addItem}
              disabled={!flavorsComplete}
              className="rounded-xl bg-coral px-3 py-2 text-sm font-medium text-white hover:bg-coral/80 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus size={16} />
            </button>
```

Immediately after the closing `</div>` of that product-pick row (line ~308), insert:

```tsx
          {pickedFlavorGroups.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {pickedFlavorGroups.map((g) => (
                <select
                  key={g.name}
                  value={flavorSelections[g.name] || ""}
                  onChange={(e) => setFlavorSelections((s) => ({ ...s, [g.name]: e.target.value }))}
                  className="rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-coral"
                >
                  <option value="">{g.name}…</option>
                  {g.options.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ))}
            </div>
          )}
```

- [ ] **Step 7: Update the items list rendering to use `itemKey`**

In the items render block (lines ~314-347), make these three replacements:
- `key={item.productId}` → `key={itemKey(item)}`
- `onClick={() => updateQty(item.productId, -1)}` → `onClick={() => updateQty(itemKey(item), -1)}`
- `onClick={() => updateQty(item.productId, 1)}` → `onClick={() => updateQty(itemKey(item), 1)}`
- `onClick={() => removeItem(item.productId)}` → `onClick={() => removeItem(itemKey(item))}`

- [ ] **Step 8: Type-check and verify in the browser**

```bash
cd /Users/garciafam/Documents/website/Muy-Rico-V2/home-bakery-management-system
npx tsc --noEmit   # expect: no errors
```

Start vite (worker from Task 1 still running on :8787):

```bash
nohup npm run dev -- --port 5173 --host > /tmp/vite.log 2>&1 &
sleep 6
```

Write `/tmp/verify_flavors.py`:

```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page()
    pg.on("pageerror", lambda e: print("pageerror:", e))
    pg.goto("http://localhost:5173", wait_until="networkidle")
    pg.wait_for_timeout(2000)
    pg.get_by_text("New Order").first.click()
    pg.wait_for_timeout(800)

    pg.locator("input[placeholder='Customer name']").fill("FlavorModalTest")
    # pick Cupcakes (has flavor groups) in the product select (2nd select on page)
    prod = pg.locator("select").nth(1)
    prod.select_option(label=[o for o in prod.locator("option").all_inner_texts() if "Cupcake" in o][0])
    pg.wait_for_timeout(400)

    # flavor dropdowns should now be visible; count them
    flavor_selects = pg.locator("select").count()
    print("flavor dropdowns present (expect >2 total selects):", flavor_selects)

    # Add button must be DISABLED before flavor selection
    add_btn = pg.locator("button.bg-coral").first
    print("add disabled before flavor pick (expect True):", add_btn.is_disabled())

    # select Chocolate in the first flavor dropdown (3rd select overall)
    pg.locator("select").nth(2).select_option(index=1)
    print("add disabled after flavor pick (expect False):", add_btn.is_disabled())
    add_btn.click()
    pg.wait_for_timeout(400)

    # switch flavor to Vanilla and add again -> second line item
    pg.locator("select").nth(2).select_option(index=2)
    add_btn.click()
    pg.wait_for_timeout(400)

    names = pg.locator("div.min-h-\\[160px\\] p.font-medium").all_inner_texts()
    print("line items:", names)
    assert any("Chocolate" in n for n in names), "chocolate line missing"
    assert any("Vanilla" in n for n in names), "vanilla line missing"

    pg.get_by_role("button", name="Create Order").click()
    pg.wait_for_timeout(2500)

    # check generated labels via the API
    import urllib.request, json
    labels = json.load(urllib.request.urlopen("http://localhost:8787/api/labels"))["labelTemplates"]
    mine = [t["name"] for t in labels if "Cupcake flavor" in t["name"]]
    print("generated flavor labels:", mine)
    assert any("Chocolate" in n for n in mine), "chocolate label missing"
    assert any("Vanilla" in n for n in mine), "vanilla label missing"

    # Orders page -> View Labels filter shows them
    pg.get_by_text("Orders").first.click()
    pg.wait_for_timeout(1200)
    pg.locator("tr, div", has_text="FlavorModalTest").first.click()
    pg.wait_for_timeout(800)
    pg.get_by_text("View Labels").first.click()
    pg.wait_for_timeout(1500)
    body = pg.inner_text("body")
    assert "Chocolate" in body and "Vanilla" in body, "View Labels filter did not show flavor labels"
    print("View Labels filter: PASS")
    b.close()
```

Run:

```bash
python3 /tmp/verify_flavors.py
```

Expected: all assertions pass — two line items, two `MR-` labels, and the View Labels filter shows them.

- [ ] **Step 9: Commit**

```bash
cd /Users/garciafam/Documents/website/Muy-Rico-V2
git add home-bakery-management-system/src/types.ts home-bakery-management-system/src/components/OrderModal.tsx
git commit -m "feat(orders): flavor dropdowns in New Order modal

Products with flavor_groups now show one dropdown per group (all
required before adding). Item names are composed in the website's
exact format (e.g. 'Cupcakes (6) (Cupcake flavor: Chocolate)') so the
worker generates one label per flavor. Line items key on
productId+flavorNote so different flavors coexist as separate lines."
```

---

### Task 3: Build, end-to-end verify, housekeeping, commit

**Files:**
- Modify: `.gitignore`
- Modify: `admin/index.html` (regenerated)

**Interfaces:**
- Consumes: Tasks 1-2 source changes.
- Produces: the committed, deployable `admin/index.html` artifact.

- [ ] **Step 1: Ignore root-level wrangler local state**

The repo `.gitignore` already covers `orders/.wrangler/` and `workers/.wrangler/` but local testing created a root `.wrangler/`. In `.gitignore`, add a line:

```
/.wrangler/
```

- [ ] **Step 2: Build the SPA (regenerates admin/index.html)**

```bash
cd /Users/garciafam/Documents/website/Muy-Rico-V2/home-bakery-management-system
npm run build   # vite build + postbuild.sh copies dist/index.html -> ../admin/index.html
```

Expected tail: `✓ built` then postbuild runs with no error.

- [ ] **Step 3: Full end-to-end sweep**

With worker + vite still running, re-run both verifications:
- Task 1 Step 6 curl (3-flavor website order → 3 `MR-` labels).
- Task 2 Step 8 Playwright script (manual order → 2 flavor labels + working View Labels filter).

Also spot-check no regressions in the modal: create an order with a NO-flavor product (e.g. Chocolate Chip Cookie) and confirm it adds without any flavor dropdown and creates its label.

- [ ] **Step 4: Commit**

```bash
cd /Users/garciafam/Documents/website/Muy-Rico-V2
git add .gitignore admin/index.html
git commit -m "chore: rebuild admin bundle with per-flavor label generation; ignore root .wrangler"
```

- [ ] **Step 5: Hand off deploy (do NOT deploy without user confirmation)**

Report to the user:
- Worker change needs `cd orders && npx wrangler deploy` to go live.
- `admin/index.html` needs the usual Pages upload.
- Do NOT run the backfill endpoint (spec: new orders only).
- Offer to deploy the worker now or leave it to them.

---

## Self-Review Notes

- Spec coverage: worker per-item generation (§1) → Task 1; OrderModal dropdowns + composed names + keying (§2) → Task 2; build artifact + verification (§3-§5) → Task 3. Backfill prefix covered in Task 1 Step 5. No-backfill constraint restated in Task 3 Step 5.
- Type consistency: `OrderItem.flavorNote?: string` (Task 2 Step 1) matches `i.flavorNote` usages; `itemKey` signature `(i: OrderItem) => string` used consistently in Steps 4 & 7; worker reads `item.name` which Task 2 Step 3 composes in the website format.
- Placeholder scan: none — all code and commands are complete.
