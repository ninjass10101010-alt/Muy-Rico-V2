# Dashboard Quote Detail — Modal Redesign + Reference-Image Fix — Design

**Date:** 2026-08-24
**Status:** Approved by owner (approach + layout sketch)
**Branch:** main (repo deploys from main per owner pattern)

## Problem

1. **Bug:** Customers upload reference images on `quote.html`. The image uploads to R2 and `uploadedImageUrl` is set, but the submit payload (quote.html ~line 997) never includes it, so the dashboard never receives it. `reference_image_url` support already exists end-to-end (API column + store mapping + UI rendering) — only the website payload omits it.
2. **Design:** The quote detail modal buries customer intent. Reference image sits at the very bottom as a tiny link, inspiration picks are small, item details render as raw `key: value` rows, and the customer's budget is far from the price input. Owner review flow is "mostly look, then act later" — the modal should prioritize comprehension, with pricing/convert tools still present.

## Owner requirements (gathered)

- Review flow: **look first, act later** — pricing/convert stays available but not dominant.
- Content priorities (all four requested):
  1. All images front & center — customer reference uploads AND picked gallery inspirations, large and tappable.
  2. Budget ↔ price side by side — see the gap instantly.
  3. Cleaner item details — friendly labeled cards instead of raw key/value rows.
  4. Customer history — past orders/quotes for the same email.
- **Both desktop and phone equally** — desktop two-column, phone single-column stack.

## Non-goals (YAGNI)

- No full-page quote view; stay inside the existing modal pattern.
- No parsing of free-text budget into the price field (budget like "$60–80" can't be reliably parsed — just display it prominently next to the price input).
- No changes to convert/save behavior, email content, or API responses.
- No lightbox component — images tap through to `window.open(url)` (existing pattern).

## Design

### Fix 1 — Website payload (quote.html)

In the submit handler, add to the JSON body:
```js
reference_image_url: uploadedImageUrl || null,
```
While an upload is in flight the submit button remains enabled (same as today); upload failures already surface via `showError`. One-line change.

Verify: submit a quote with an image via local `wrangler dev` smoke (or live after deploy) and confirm `cake_quotes.reference_image_url` is populated — document in the implementation report.

### Fix 2 — Modal layout redesign (`home-bakery-management-system/src/pages/Quotes.tsx` detail modal)

Structure (all in the existing `Modal wide`):

**Header strip (existing, keep):** title `Quote #N`, status Badge, language chip, and the existing EN/ES/Print quote-document buttons.

**Two-column grid on desktop** (`grid gap-6 sm:grid-cols-2`), single natural stack on phone in this order:

#### Column A — "Customer request"
1. **Visuals zone** (top of column):
   - Reference image (quote-level `referenceImageUrl` and any per-item `reference_image_url`): rendered ~full-width, `max-h-64`, rounded-xl, wrapped in `<a target="_blank">` for tap-to-zoom. Label: "Reference photo".
   - Inspiration row below: thumbnails `h-16 w-16` + title text, each linked to its `image_url` in a new tab. Existing inspiration block enlarged from `h-10 w-10` to `h-16 w-16`.
   - If neither exists, omit the zone entirely (no empty states).
2. **Item cards** — one rounded card per item, friendly labels:
   - Card header: ProductIcon emoji (existing 🎂/🍭/🧁/✨ mapping) + display name:
     - cake → `Custom Cake — {cake_flavor}`; cakepops → `Cakepops ×{qty}`; cupcakes → `Cupcakes ×{qty}`; custom → `{details.name}`.
   - Detail rows per type with label map (English, dashboard is EN):
     - cake: `cake_flavor` → Cake flavor, `filling` → Filling, `frosting` → Frosting, `serving_size` → Serving size, `toppings` → Toppings (coral chips, existing chip style)
     - cakepops: `cake_flavor` → Cake flavor, `chocolate_dip` → Chocolate dip, `topping_style` → Topping style, `quantity` → Quantity, `design_theme` → Design theme
     - cupcakes: `cake_flavor` → Cake flavor, `frosting` → Frosting, `quantity` → Quantity
     - custom: `description` → Description, `quantity` → Quantity
   - Unknown keys still render (fallback `key.replace(/_/g,' ')` → value) so nothing is ever hidden.
   - Per-item `reference_image_url` shows as a small chip-link "Photo" inside that item's card (tappable).
3. **Comments callout** (existing coral italic block — keep, move up under items).
4. **Meta facts block** (existing occasion/date/budget/dietary block — keep as-is, minus budget which moves).

#### Column B — "Pricing & admin"
1. **Budget ↔ price panel** at top of admin card:
   - `Budget (what customer shared): {budget || "Not shared"}` — 13px, cocoa-muted, directly above the price input.
   - Price input (existing) + Admin notes textarea (existing).
   - Existing Save & Email Quote + Convert to Order row, Archive/Delete links.
   - Quote-document button group stays in the admin card.
2. Created/updated footer line (existing).

**Full-width footer strip (bottom of modal, spans both columns; stacks last on phone) — Customer history:**
   - Match `customers`/`orders`/`quotes` by email (case-insensitive, all already in store).
   - One line: `Ana García · ana@… · 3 past orders · 1 other quote`.
   - Static summary line only — no expandable drill-down (YAGNI).

**Empty states:** items array empty (legacy quotes) falls back to existing quote-level flavor/filling/frosting/toppings rendering path (the current items map already handles the empty list gracefully — keep that behavior).

### Files touched

- `quote.html` — one-line payload fix.
- `home-bakery-management-system/src/pages/Quotes.tsx` — detail modal restructure only. No backend changes.
- Bundle rebuilt → `admin/index.html` committed (existing postbuild pattern).

### Error handling

- Image load failure: existing `onError` hide pattern for inspiration thumbnails; add the same for reference photo.
- Customer when no email match for history: shows customerName only, no counts.
- Legacy quote with no items: fallback rendering described above.

### Testing / verification

- `cd home-bakery-management-system && npm test` — suite stays green.
- `npx tsc --noEmit` — zero NEW errors in `Quotes.tsx` vs the recorded baseline (pre-existing repo errors elsewhere remain).
- Manual live smoke after deploy (owner): open a real customer quote → verify photo/inspo visible, price-budget adjacency, history line; submit a fresh test quote from the site with a photo → confirm it appears in the dashboard; then delete/cleanup.
