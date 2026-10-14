# Guided Quote Wizard — `quote.html` — Design

**Date:** 2026-10-14
**Status:** Approved by owner (wizard only; AI deferred to Future Work)
**Branch:** main

## Problem

`quote.html` is a single long form: identity, occasion, date, budget, item cards,
reference upload, gallery picker, and comments all on one page, with one submit button at
the bottom. Three costs follow from that shape:

1. **The first screen asks for commitment before it asks for a decision.** A customer who
   does not yet know what they want sees a request for name, email, and flavor at the same
   moment they are asked to pick a design.
2. **Nothing tracks progress.** There is no step indicator, so a customer who abandons at the
   gallery has no sense of how much is left.
3. **Cards are not all equal.** The questions that gate a quote (when, how many servings,
   which product) are mixed in with optional ones (budget, toppings), so nothing signals what
   actually matters.

BakeStreet's custom-order flow solves this with a 7-step gated wizard and a progress bar.
This design brings that structure to `quote.html` without changing the wire contract, the
dashboard, or the database.

## Reference: what BakeStreet does (reverse-engineered)

Observed directly, for the record — this design borrows the *structure* only.

The flow is a Next.js + MUI wizard at `/get-quote/step/*` with a `LinearProgress` bar:

| Step | Route | Question |
|---|---|---|
| 1 | `/get-quote` | "Let's pick a design" — Search / Browse / Upload |
| 2 | `/get-quote/occasion` | "What are you celebrating?" — 4 tiles + 4 chips |
| 3 | `/get-quote/occasion/birthday` | "Who's birthday is it?" — baby / small kid / teen / adult |
| 4 | `/get-quote/search` | Photo grid in 3 tiers + AI tag chips |
| 5 | `/get-quote/customize` | Photos, Cake Type, No-customization vs Customize, dietary |
| 6 | `/get-quote/event` | Location (ZIP), date, servings, budget |
| 7 | `/get-quote/contact` | Name, email, mobile, SMS consent, UTM |
| 8 | `/verify/{phone}/{id}` | SMS OTP before the request counts |

Their design step returns three tiers from
`GET /site/{id}/photo?q=&type=cake&occasion=`: `catalog` ("Express Options"), `ltd`
("Our Custom Designs"), and `goog`/`exp` ("Trending Designs"); each result carries
`{ id, src, pic, img, tags[], rank }` and the response also returns `tags[]` for
suggestion chips. Photo tags are vision-model generated
(e.g. `["sesame street","elmo","big bird","cookie monster"]`). The gallery is sorted by
`rank` descending, then randomised.

**Adopted:** gated steps, progress bar, occasion-first framing, servings as a first-class
question, occasion tiles.

**Deliberately not adopted:** external (Google) inspiration tier, ZIP/location capture, SMS
OTP verification, UTM capture. Reasons in Non-goals.

## Goals

1. Restructure `quote.html` into **6 gated steps** with a progress bar, in English and Spanish,
   with no change to the fields the API receives other than adding quote-level `serving_size`.
2. Make each step answerable without seeing the others, and make **Back** lossless.
3. Reduce the submission payload to exactly what it is today, plus `serving_size`, so the
   owner dashboard, `QuoteModal`, the conversion flow, and the database are untouched.
4. Ship the gallery contract **tag-ready**, so the deferred AI tagging work is additive
   (one migration + one backfill) and requires no client change.
5. Keep the page self-contained, dependency-free, and offline-testable.

## Owner requirements (gathered during brainstorming)

- **Scope:** the guided wizard only. The 3-tier design gallery, ZIP/location capture,
  servings-to-size pricing, and SMS verification are out of scope.
- **Location:** extend `quote.html` in place. No new page, no React route, no new bundle.
- **Items:** product type first, then that product's details. Multiple products on one quote
  stay supported, with the existing 3-item cap and the existing per-type fields.
- **Deep links:** `?type=` and `?inspiration=` from menu items and gallery cards must keep
  working, and must resolve into wizard state rather than a one-shot preselection.
- **AI:** deferred, but the gallery response must be shaped to accept it later.
- **Ordering note:** design is step 3, not step 1. BakeStreet leads with design because
  discovery drives conversion, but our `?type=` deep links assume the product is already
  known, and occasion/servings are what actually gate a quote. Leading with those keeps
  deep-linked visitors coherent.

## Non-goals

- **No pricing in the wizard.** Website submissions never carry `quoted_price` — the server
  enforces this at `orders/workers/api.js:3940` (`isAdmin` is false for `actor === 'website'`).
  The wizard must not attempt to send one.
- **No 3-tier gallery** (Express / Custom / Trending). One flat gallery for now. Reasoning:
  "Trending" requires fetching third-party imagery, and "Express" would duplicate the menu,
  which `order.html` already serves.
- **No ZIP/location capture.** Our quotes are priced manually and pickup is in-person in
  Holland, MI. A ZIP code adds a field without changing any decision.
- **No SMS OTP verification and no SMS consent capture.** The worker has no SMS provider
  wired; adding one is a separate project with its own compliance surface.
- **No UTM capture.** Not requested; can be added later as a passive field.
- **No draft persistence across refresh.** Wizard state is in-memory, so a mid-flow refresh
  restarts at step 1 with the deep-link seeds freshly applied. Persisting would mean serialising
  the DOM-held card values as well as the scalar answers, which adds restore-path failure modes
  to a customer-facing form that is hard to debug in production. The cheap follow-up, if the
  need is demonstrated, is to serialise `wizard` plus one `{ type, values }` record per card into
  `sessionStorage` on every step change and rehydrate in `initializeQuoteForm`.
- **No backend change.** No migration, no new endpoint, no worker deploy.

## Design

### Architecture

One file changes: `quote.html`. The inline script is restructured into three concerns, with
all existing logic moved rather than rewritten:

```
STEP_DEFS     ordered descriptors: id, heading (es/en), panel id, canAdvance(), reason
wizard        single object holding every answer across all steps
show(step)    hides all panels, reveals current, syncs progress, nav, focus, URL
```

Every mechanism the page already has is reused as-is:

| Existing mechanism | Where | Reused for |
|---|---|---|
| `itemTypeTemplates` | `quote.html:714` | Step 5 per-product fields, unchanged |
| `createItemCard` / `removeItem` | `quote.html:847`, `:866` | Step 4→5 item cards, unchanged |
| `updateAddButtonVisibility` (3-item cap) | `quote.html:872` | Step 4 cap, unchanged |
| dropzone + `handleFile` upload | `quote.html:648`, `:674` | Step 3 upload, unchanged |
| inspiration picker | `quote.html:1082`+ | Step 3 gallery, unchanged |
| `initCustomQtyToggles` | `quote.html:905` | Step 5 quantity fields, unchanged |
| `enforceMinimumDesiredDate` | `quote.html:922` | Step 2 date, moved |
| `applyLangToDOM` / `data-es`/`data-en` | `quote.html:582` | All new strings, unchanged |
| submit collection + `POST /api/quotes` | `quote.html:957`+ | Final submit, unchanged |

Because the submit handler already collects from the DOM (`document.querySelectorAll('.item-card')`),
moving panels in the document does not affect it.

### Wizard state

A single module-scope object, written only through `set(patch)`:

```js
const wizard = {
  step: 'occasion',      // current step id; never persisted or mirrored to the URL
  // step 1
  occasion: '',
  // step 2
  servings: '',          // string, digits only
  desired_date: '',
  budget: '',
  // step 3
  inspiration: [],       // [{ id, product_id, title, image_url }]
  referenceImageUrl: '', // set by upload success
  // step 4 / 5
  productTypes: [],      // ['cake'] | ['cake','cakepops'] … max 3
  // (item field values live in the DOM inside their cards, as today)
  // step 6
  customer_name: '',
  email: '',
  phone: '',
  comments: '',
};
```

Item field values stay in the DOM inside `.item-card` elements, exactly as today, so
`updateAddButtonVisibility`, `initCustomQtyToggles`, and the submit collector keep working
without a parallel data model. Only the answers that live *outside* cards are held in `wizard`.

### The steps

| # | id | Heading (EN / ES) | Question | Gate (`canAdvance`) |
|---|---|---|---|---|
| 1 | `occasion` | What are we celebrating? / ¿Qué vamos a celebrar? | 6 tiles | an occasion chosen |
| 2 | `event` | When, and for how many? / ¿Cuándo y para cuántos? | Servings (number), event date, budget (optional) | servings ≥ 1 and a date not in the past |
| 3 | `design` | Pick a design / Elige un diseño | Gallery grid + drag/drop upload | always (both optional) |
| 4 | `product` | What are we making? / ¿Qué vamos a hacer? | 4 product tiles, multi-select | ≥ 1 product |
| 5 | `details` | Tell us the details / Cuéntanos los detalles | One card per product, dietary, and design intent | each card's existing `required` fields filled |
| 6 | `contact` | Almost done / Casi listo | Name, email, phone, comments | name, email present; email matches the existing regex |

Progress: step 1 = 10%, then 30 / 50 / 65 / 80 / 95, matching the six-segment bar. The
`submit` state (100%) is not a step; it is the disabled nav during the existing in-flight POST.

Occasion tiles (step 1), all mapping to the existing `occasion` field, using exactly the values
`QuoteModal` already offers so the dashboard filter and the customer form agree —
`src/components/QuoteModal.tsx:8`:

> Birthday · Quinceañera · Wedding · Baby Shower · Anniversary · Other

Tiles are displayed in that order (most common first), and each carries the exact string above
(casing included, e.g. `"Baby Shower"` not `"Baby shower"`), because `occasion` is stored and
filtered as a free string and a casing drift would split the dashboard's filter.

Product tiles (step 4): **Cake 🎂, Cakepops 🍭, Cupcakes 🧁, Something else**. The first three
map to `cake`/`cakepops`/`cupcakes` in `itemTypeTemplates`; "Something else" maps to a new
`custom` template whose `name` input carries `required`, so the submit collector's existing
required-field sweep validates it with no new code.

> **New work required — three additions, all mandatory.** `itemTypeTemplates` currently has
> `cake`, `cakepops`, and `cupcakes` only (`quote.html:714`):
>
> 1. Add a `custom` entry to `itemTypeTemplates` with `name` (required — mirrors the server rule
>    at `orders/workers/api.js:3935`), `description`, and `quantity`. `QuoteItemComposer`
>    already produces exactly this shape, so stored records stay consistent.
> 2. Add `custom` to `itemIcons` (`quote.html:838`).
> 3. Add `custom` to `itemLabels` (`quote.html:839`), e.g. `{ es: 'Otra cosa', en: 'Something else' }`.
>
> Items 2 and 3 are not optional cosmetic work: `createItemCard` reads
> `itemIcons[type]` and `itemLabels[type].es` (`quote.html:855-861`), so a `custom` card without
> them throws a `TypeError` and takes down the whole init — the same failure mode the existing
> `?type=` guard at `quote.html:935` was added to prevent.

### Data mapping

Every wizard answer maps onto a field the server already accepts. Nothing new except
quote-level `serving_size`, which is already in the INSERT (`orders/workers/api.js:3996`).

| Wizard answer | Wire field | Notes |
|---|---|---|
| `occasion` | `occasion` | Free string; unchanged |
| `servings` | `serving_size` (quote level) | **New to this page.** Server-inserted today |
| `servings` | `items[].details.serving_size` where `product_type === 'cake'` | Bucket replaced by exact count |
| `desired_date` | `desired_date` | Min-date guard unchanged |
| `budget` | `budget` | Optional |
| `inspiration` | `inspiration` | Same `{id, product_id, title, image_url}` shape |
| `referenceImageUrl` | `reference_image_url` | Set only by a successful upload |
| `productTypes` | `items[].product_type` | Validated server-side against the 4 allowed types |
| card fields | `items[].details` | Collected from the DOM, unchanged |
| `customer_name` / `email` / `phone` | same | Lowercased email is the server's job |
| `comments` | `comments` | Step 6's notes, combined with step 5's design note — see below |

**Dietary and design intent have defined homes.** Two free-text answers in step 5 could easily
collide with step 6's `comments`, so both are pinned down:

- **Dietary** is a quote-level answer, matching how the record already stores it. The step-5
  field takes free text ("nut-free, eggless") and is split on commas, trimmed, and dropped when
  empty, producing the `string[]` the server expects for `body.dietary`
  (`orders/workers/api.js:3956`). It does **not** go into any item's `details`, because dietary
  applies to the whole request.
- **Design intent** is the BakeStreet "No customization / Customize this design" choice, kept
  because it tells the baker whether to match a reference exactly or expect changes. It has no
  dedicated column, so on submit it is folded into `comments` as a prefix — the selected intent
  label, then the customer's free text when they chose to customize, then step 6's notes:

  ```js
  const comments = [designNote, customerComments].filter(Boolean).join('\n\n');
  ```

  `comments` is a single nullable TEXT field, so one combined value is the only lossless option
  without a schema change, and the owner reads one coherent block instead of two fields that
  fight for the same column.

**Serving size becomes an exact number.** Step 2 asks "how many guests" and stores the digit
string in both places above. `QuoteModal.tsx:16` renders it as `` `${d.serving_size} servings` ``
and `Quotes.tsx:368` renders the quote-level value raw, so `"25"` reads correctly as
"25 servings" in both. A bucket ("20-30") is a guess; an exact count is a spec the baker can
size and price against. See the targeted improvement below for the one place this needs help.

### Progress and gating

`canAdvance()` per step. While false, **Next** is `disabled` and a single inline reason renders
in the step body (`role="status"`), for example "Choose an occasion to continue." No modal, no
toast, no scroll-hunt — the reason is visible at the point of the button that refused.

**Back** is enabled on steps 2–6 and restores the previous panel with all state intact:
uploaded image, selected inspiration, item cards and their typed values, and every text field.
Item cards are never rebuilt on a step change (they stay in the DOM), so nothing can be lost.

### Deep links

The current page resolves `?type=` and `?inspiration=` at init (`quote.html:930`). The wizard
keeps both, resolved into wizard state at load rather than a one-shot preselection:

- `?type=cake` → pre-selects the `cake` product tile **and** appends its card, so step 5 already
  has the card. Unknown values keep the existing guard (`quote.html:935`) and fall back to `cake`.
- `?inspiration=<id>` → the gallery loads at init and that card starts selected. Because the
  gallery is fetched at init and not at step entry, preselection behaves exactly as today.

**No `?step=` parameter, and no `history.replaceState`.** Wizard state lives in memory only, so
a URL that claimed to restore a step could never honour it — a refresh would land on a step whose
gating answers no longer exist. A stale deep link must not be able to strand a customer, so the
wizard always opens at step 1 and the URL is left alone. Draft persistence across refresh is
listed as a non-goal below with the cheap follow-up path.

### Design gallery: tag-ready contract

The public gallery endpoint is `GET /api/gallery` → `{ photos: [...] }`, mapped by
`mapGalleryRow` (`orders/workers/api.js:2038`). Step 3 renders a **search box** that filters
the loaded photos on the client, and each card shows tag chips when tags exist.

The client must be written so that adding tags later requires **no client change**:

- Treat `photo.tags` as `string[]`, defaulting to `[]` when the field is absent
  (`(photo.tags || [])`). Every current row lacks it, so this must not throw or render `undefined`.
- Search matches `title`, `title_es`, and every entry in `tags`, case- and accent-insensitively.
- Cards with no tags render exactly as today — no empty chip row.
- If `photo.tags` is present but not an array, ignore it and fall back to `[]`.

No backend change ships now. When AI tagging lands, it adds a `tags` column, a backfill, and a
`tags: ...` line in `mapGalleryRow` — and the search box immediately gets smarter.

### UI

New classes are added to the existing inline `<style>` block in `quote.html`, built from the
existing tokens (`--forest`, `--clay`, `--cream-deep`, `--hairline`, `--r-widget`,
`--r-media`), so no change to `style.css` is required:

`.wz-progress`, `.wz-progress-seg`, `.wz-panel`, `.wz-heading`, `.wz-tile-grid`, `.wz-tile`,
`.wz-tile.is-selected`, `.wz-chip`, `.wz-nav`, `.wz-reason`, `.wz-search`.

Tiles follow the `.inspiration-card` treatment already in the file: 2px transparent border,
`var(--clay)` border when selected, a subtle lift on hover, and a check affordance. Search input
reuses `.form-input`. Nav is a sticky bar (Back / Next); below 640px it becomes full-width
stacked buttons. The existing `.item-card`, `.dropzone`, `.checkbox-grid`, and
`.inspiration-card` styles are untouched.

### Accessibility and mobile

- Each panel is `role="group"` with `aria-labelledby` pointing at its heading.
- On step change, focus moves to the step heading (`tabindex="-1"`), so keyboard and screen
  reader users are not left at the bottom of the page.
- The gating reason renders in a `role="status"` element, announced when it appears.
- The progress bar exposes `role="progressbar"` with `aria-valuenow` / `aria-valuemin` /
  `aria-valuemax` and an accessible label.
- Tiles are real `<button type="button">` elements, so Enter/Space work without key handlers.
- Selected state uses `aria-pressed="true"` on tiles, matching the gallery's existing pattern.
- All panel transitions respect `prefersReduced` (already read at `quote.html:569`); with
  reduced motion the panel swaps with no animation.
- The sticky nav must not cover the last field at 320px — verified by the overflow tests.

### Error handling

| Failure | Behaviour |
|---|---|
| Upload fails (network/4xx/5xx) | Existing inline error retained; step does not advance on a failed upload attempt, and the customer may continue without a photo (upload is optional) |
| Gallery fetch fails | Existing "gallery is coming soon" empty state; step 3 still advances |
| Validation fails on Next | Next disabled + inline `role="status"` reason naming the missing answer |
| Submit fails (network/4xx) | Existing `showError` path and existing button re-enable, unchanged |
| Submit succeeds | Existing `#form-success` panel, unchanged; notice hidden, form hidden |
| Unknown `?type=` | Falls back to `cake` via the existing guard |
| Deselect a product tile at step 4 | That product's card is removed, taking its typed values with it; reselecting appends a fresh empty card. `productTypes` and the DOM cards are kept in exact correspondence so the step-5 gate cannot pass on a stale card, and the payload cannot carry an item the customer un-chose |

### Targeted improvement: `QuoteItemComposer` serving size

`QuoteItemComposer.tsx:134` renders `serving_size` as a `<select>` over the fixed buckets
`["6-8", "10-12", "15-20", "20-30", "30+"]`. Once the wizard submits an exact count, that
select has no matching option: React keeps the value but the field *displays* as unselected,
which would look like lost data to the owner even though the value survives a save.

Small, contained fix in the file we are already affecting: when the initial `serving_size` is
not one of the buckets, append it as an extra option so it renders selected and writable. No
change to what is submitted, and no change to the dashboard's rendering of saved quotes.

## Testing

New file `tests/quote-wizard.spec.ts`, following the conventions in `tests/cta-band.spec.ts`
(`page.route` mocks, `python3 -m http.server` on 8901 via `playwright.config.ts`, overflow
assertions, reduced-motion contexts, `setLang` swap). `/api/gallery` and
`/api/quotes/upload-image` are mocked so the suite runs offline.

Cases:

1. **Happy path** — walk all 6 steps; assert the exact `POST /api/quotes` body, including
   `serving_size` at quote level and `items[0].details.serving_size` for a cake.
2. **Gating** — Next disabled at each step until satisfied; the inline reason names the missing
   answer; no modal appears.
3. **Back is lossless** — type a flavor, upload a photo, select an inspiration, then step back
   to 1 and forward to 5; assert all three survive.
4. **Multiple products** — select Cake then Cakepops; assert 2 item cards and 2 entries in
   `items[]`; assert the cap hides the add affordance at 3.
5. **Deep link `?type=cakepops`** — tile selected, card present, `items[0].product_type` is
   `cakepops`.
6. **Deep link `?inspiration=<id>`** — that gallery card is selected and appears in `inspiration[]`.
7. **Refresh restarts cleanly** — fill steps 1–3, reload, assert step 1 is shown, no partial state
   leaks into the form, and the deep-link seeds (`?type=`) are re-applied.
8. **Deselect a product** — select Cake and Cakepops, type a cake flavor, go back to step 4 and
   deselect Cake; assert one card remains and the payload contains only `cakepops`.
9. **Tag-ready gallery** — with a mocked response containing a `tags` array, search filters by
   tag; with tags absent, cards render as today and search still filters by title.
10. **Upload failure** — mocked 500; inline error shows, page does not advance, and the submit
    payload carries `reference_image_url: null`.
11. **ES and EN** — every step heading renders in both, via `setLang`.
12. **No overflow** at 1024 / 861 / 390 / 320, asserting
    `scrollWidth - clientWidth <= 0`.
13. **Reduced motion** — step changes produce no animated transition and nav still advances.

Run: `npx playwright test tests/quote-wizard.spec.ts`.
No frontend or worker unit tests change, since no file in
`home-bakery-management-system/src` is modified except the one targeted composer fix, which is
covered by the existing `OrderModal`/quotes suites and does not alter their fixtures.

## Future work: AI (deferred, in this order)

Recorded so the wizard does not paint us into a corner. **Not built now.**

**Tier 1 — Photo auto-tagging.** The highest value and lowest risk. BakeStreet's design search is
a vision model tagging each photo once (`tags: ["sesame street","elmo","big bird"]`), after which
search is cheap keyword matching. For us: `ALTER TABLE gallery ADD COLUMN tags TEXT`, a backfill
pass over the R2 objects, a `tags` line in `mapGalleryRow`, and tag chips in the wizard's search.
Enabled by the tag-ready contract above at zero extra client cost.

**Tier 2 — Post-submit quote assist.** After a customer submits, normalize free-text `comments`
and item `details` into structured suggestions and draft a price from comparable past quotes.
Safe because the owner still sets `quoted_price`; a poor suggestion is simply ignored. No
customer-facing surface.

**Tier 3 — Instant quotes.** Sequenced last, and it is mostly a data-modeling project rather
than an AI one. It needs a surcharge-rules table that does not exist today (size base, flavor
and frosting surcharges, add-ons, lead-time and rush multipliers, dietary modifiers). The raw
materials exist — `Product.pack_sizes` (qty + price per pack) and `flavor_groups`
(`src/types.ts:48`) — but the rule model does not. The AI is only the final step that maps free
text onto those rules.

**The seam already exists for all three.** The worker already calls an external enrichment API
with an LRU cache and graceful fallback — USDA FoodData Central at
`orders/workers/api.js:2440`, cached at `:2419`, with provenance fields
(`nutritionSource`, `nutritionFetchedAt`) on the record. AI enrichment should follow that same
shape: worker-side call, cache, demo/fallback path, provenance.

**POS gap (separate product, not planned).** BakeStreet sells a register; we built a back
office. They have the counter (till screen, cake builder at checkout, split tender, cash
reconciliation, staff accounts, delivery dispatch). We have the kitchen: `computePrepList`
explodes orders into ingredient needs against real inventory (`src/utils/prepList.ts:26`),
`CalendarView` schedules by due date, and `LabelStudio` prints FDA-compliant labels. Closing
that gap means building a register, which is a different project with different risk.

## Risks

| Risk | Mitigation |
|---|---|
| Restructuring a 1,178-line page could break existing behaviour | Existing mechanisms are moved, not rewritten; the submit collector is unchanged; the 13-case Playwright suite covers the deep links, the payload, and both item-selection paths |
| Multi-step forms can reduce completion if gating is too strict | Only steps 1, 2, 4, 5, 6 gate; step 3 never does; budget is optional; the reason for each block is shown inline |
| Exact servings break the dashboard edit select | Targeted `QuoteItemComposer` fix above |
| Tag-ready code could throw on missing `tags` | Value is normalised with `(photo.tags || [])` and a non-array guard, and case 9 tests both shapes |
| A refresh mid-flow loses the draft | Accepted and documented as a non-goal; the customer restarts at step 1 with the same deep-link seeds. `sessionStorage` rehydration is the recorded follow-up if the drop-off proves real |

## Rollout

Single static file plus one test file. Deploy is the normal site upload; no migration, no worker
deploy, no dashboard rebuild. `quote.html` is not bundled, so there is no cache-busting concern
beyond the browser's own cache. If the wizard underperforms, reverting the file restores the
current form exactly, because no backend contract changed.
