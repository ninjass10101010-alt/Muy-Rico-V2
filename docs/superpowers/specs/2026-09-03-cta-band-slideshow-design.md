# CTA Band Photo Slideshow — Design (v2)

**Date:** 2026-09-03
**Scope:** Homepage CTA band photo column + new dashboard Slideshow section + Workers API + D1 migration. No changes to products, gallery, or existing pages.
**Status:** Approved (brainstorming session, same day)
**Supersedes:** v1 gallery-hydration approach in this same file's git history (source changed from product-tied gallery to a dedicated dashboard-managed entity).

## Goal

Give the owner a dashboard-managed photo slideshow for the homepage CTA band, fully
separate from products and the gallery: they upload images and write EN/ES titles and
descriptions themselves. The band ships with a static concha photo and becomes a
slideshow the moment the first slide is published.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Source of slides | New dashboard-managed "Slideshow" entity (not menu photos, not the product-tied gallery) |
| Dashboard location | New "Slideshow" sidebar section, mirroring the Gallery page pattern |
| Text fields per slide | Title EN/ES + description EN/ES (R2 image upload) |
| Empty fallback | Static concha photo exactly as the band is today (no dots, no JS) |
| Slide mechanics | 5s autoplay + clickable dots, 800ms CSS crossfade, no arrows |
| Mechanism | Approach A: vanilla JS + CSS opacity transitions (no GSAP coupling, no libraries) |
| Cap | Max 8 active slides rendered client-side |

## Non-Goals

- No swipe/drag gestures; no arrows; no lightbox/zoom.
- No changes to `motion.js`, existing endpoints, or the Gallery/Testimonials features.
- No new npm dependencies (dashboard keeps its existing React/Vite/Tailwind stack).
- No reordering drag-and-drop (up/down buttons like Gallery).

## Architecture Overview

```
D1 table slideshow_slides
  ↓
Workers /api/slideshow (public GET, admin CRUD)
  ↓                      ↓
Dashboard Slideshow.tsx  Homepage CTA band (index.html)
(slideshow CRUD + R2     fetch once → ≥1 slide: slideshow UI
upload via /api/upload)               → 0 slides: static concha photo
```

## 1. Database (migration `0045_slideshow.sql`)

```sql
CREATE TABLE IF NOT EXISTS slideshow_slides (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  title_es TEXT,
  description TEXT,
  description_es TEXT,
  image_url TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_slideshow_order ON slideshow_slides(active, display_order);
```

Follows the `0015_gallery.sql` conventions (TEXT PK, integer booleans, datetime defaults).
Numbering continues from the latest migration (`0044_quote_deposit.sql`).

## 2. Workers API (`orders/workers/api.js`)

Same flat route-guard pattern as gallery (lines ~207-221) and testimonials:

| Route | Auth | Handler |
|---|---|---|
| `GET /api/slideshow` | Public (`isPublicSlideshowGet` flag, active-only, `display_order ASC`) | `listSlideshow(env)` |
| `GET /api/slideshow/all` | Admin | `listSlideshowAdmin(env)` |
| `POST /api/slideshow` | Admin, actor recorded | `createSlideshowSlide(request, env, actor)` |
| `PATCH /api/slideshow/:id` | Admin | `updateSlideshowSlide(id, request, env, actor)` |
| `DELETE /api/slideshow/:id` | Admin | `deleteSlideshowSlide(id, env)` |

- `SLIDESHOW_FIELDS = ['title','title_es','description','description_es','image_url','active','display_order']`
  (allow-list PATCH loop, boolean coercion 0/1, `updated_at` bump — same as GALLERY_FIELDS).
- IDs: `sld_` + `Date.now().toString(36)` + random suffix (gallery convention); client may
  supply `body.id`.
- Validation: `title` and `image_url` required on create (400 otherwise).
- Public GET returns only `active = 1` rows, ordered; no product joins.

## 3. Dashboard (`home-bakery-management-system/`)

- **`src/utils/api.ts`**: `ApiSlideshowSlide` type (`id, title, title_es?, description?,
  description_es?, image_url, active, display_order`) + client functions:
  `fetchSlideshow()` (`GET /api/slideshow/all`), `createSlide(p)` (POST; client computes
  `display_order = max + 1`, `active: true`), `updateSlide(id, patch)` (PATCH),
  `deleteSlide(id)` (DELETE).
- **`src/pages/Slideshow.tsx`**: modeled on `Gallery.tsx` structure (header + count,
  add-slide form/modal, list of rows with inline preview):
  - Image: hidden file input → `uploadImage(file)` (existing R2 helper) → preview.
  - Text: title EN (required), title ES (optional), description EN, description ES.
  - Row actions: eye/eye-off `active` toggle, up/down arrows swapping `display_order`
    (two parallel PATCHes, same as gallery), delete with confirm.
- **`src/components/Sidebar.tsx`**: add `{ id: 'slideshow', label: 'Slideshow', icon }`
  to `NAV` (icon from the existing icon set — picture/carousel glyph).
- **`src/App.tsx`**: extend the `Page` union with `'slideshow'`; map to the new page in
  the page switch.

## 4. Homepage CTA Band (`index.html` + `style.css`)

### Static default (0 slides / API down) — unchanged behavior
The band keeps its current static concha `.frame` photo and serif caption. No dots, no
slideshow JS runs. This is the no-JS, reduced-motion, and error state simultaneously.

### Slideshow state (≥1 active slide)

Markup (progressive enhancement — the static img is replaced client-side only after a
successful fetch):

```html
<figure class="cta-band-photo" data-motion="scale">
  <div class="frame cta-band-slides" aria-roledescription="carousel" aria-label="Muy Rico photos">
    <div class="slide-well"><!-- stacked <img class="cta-slide">, injected by JS --></div>
  </div>
  <div class="cta-band-dots" role="tablist" aria-label="Choose photo"><!-- buttons --></div>
  <figcaption class="cta-band-photo-caption"><!-- title + description swap --></figcaption>
</figure>
```

- `.cta-band-slides` keeps `aspect-ratio: 3 / 2` (via `.ratio-3-2`) and the frame padding;
  `.slide-well` fills the frame content box with `border-radius` + `overflow: hidden`.
- `.cta-slide`: absolute inset-0, `object-fit: cover`, `opacity 0`, `transition: opacity
  0.8s ease`; `.is-active → opacity 1`. Only opacity animates.
- Hydrated images: `loading="lazy"` (stack sits in viewport only when scrolled to); first
  slide `eager`. Explicit width/height where known; frame ratio fixed regardless → no CLS.
- Caption block: slide title (serif italic, existing caption style) + description
  (smaller sans line beneath). Fades out/in (0.3s) when the slide changes.
- Dots: 8-9px cream circles at 35% opacity, active = full cream + slight scale; real
  `<button>`s, `aria-label="Slide N: <title>"`, `aria-current="true"` on active; global
  clay focus ring applies. `role="tablist"` container.

### Behavior (vanilla JS, inline script near existing hydration code)

`initCtaSlideshow()` — self-contained, ~60 lines, mirroring the validated demo:

- State: `slides[]`, `index`, single `setInterval` timer (`PAUSE_MS = 5000`).
- Autoplay gated on: document visible (`visibilitychange` resets timer), figure not
  hovered, figure has no focus-within, `prefers-reduced-motion` not set (then dots are
  manual-only navigation).
- `goTo(i, manual)`: wraps modulo, toggles classes, swaps caption, resets timer on manual.
- Fetch `GET /api/slideshow` (same `ORDER_API` base the page defines). On success with
  ≥1 photo: build slide array (cap 8), render imgs + dots, swap static frame content.
  On failure/empty: do nothing (static default stays). Fire-and-forget after first paint;
  never blocks LCP.
- Bilingual: slides carry `title/title_es/description/description_es`; caption renders
  per `currentLang`; `setLang()` re-renders the caption (hook into existing
  `applyLangToDOM` flow via a caption render function).

### Removal

Delete the throwaway demo page `slideshow-sample.html` (untracked) once integrated.

## 5. Error Handling

- API unreachable / non-200 / empty list → static concha default, zero visual disruption.
- Hydrated image fails to load (`onerror`) → drop the slide (and its dot), re-render,
  clamp index. If all fail → revert to static default.
- Reorder/toggle in dashboard mid-session → next page load reflects it (no live sync
  needed; band fetches once per load).
- >8 active slides → client renders first 8 by `display_order`.

## 6. Accessibility

- `aria-roledescription="carousel"` + `aria-label` on the frame container.
- Dots: keyboard-focusable buttons in `role="tablist"`, `aria-label` per slide,
  `aria-current` on active; global `:focus-visible` clay ring.
- Alts from slide title (active language). Decorative frame elements `aria-hidden`.
- Autoplay pauses on hover and focus-within; disabled under reduced motion (dots only).
- Caption is a real `<figcaption>`; description line is real text (screen-reader friendly).

## 7. Performance

- Static default adds zero bytes (current state ships today).
- Slides lazy-load (first slide eager); cap 8; R2-served, browser-cached.
- Opacity-only animation (GPU-friendly); single timer; no layout thrash.
- Zero CLS: `aspect-ratio` frame fixed before/during/after hydration.

## 8. Testing (extend the existing Playwright CTA-band suite)

1. **Default**: with API blocked/empty → static concha frame, zero `.cta-slide` elements,
   no dots, no overflow (all breakpoints 1440/1024/861/390/320).
2. **Hydration**: mock `/api/slideshow` with 3 test slides → imgs + 3 dots render,
   first active, caption shows title + description.
3. **Autoplay**: advances within ~6s (real wait), wraps modulo.
4. **Dot click**: jumps to slide, `aria-current` moves, timer resets.
5. **Hover pause**: no advance while hovering figure; resumes after leave.
6. **Reduced motion**: no autoplay; manual dot navigation works.
7. **Bilingual**: `setLang('es')` swaps caption to `title_es`/`description_es`.
8. **Degraded slide**: `onerror` slide drops from rotation.
9. **Dashboard API** (route-level): POST/PATCH/DELETE validate fields, public GET filters
   inactive, order respected, cap behavior.
10. Existing CTA-band checks (reveals, geometry alignment, single-line CTAs, magnetic
    hook, ES swap, no-gsap fallback) still green.

## 9. Risks

- **Arbitrary image aspect ratios** → `object-fit: cover` + fixed frame crops; acceptable
  (owner uploads product-style photography). Dashboard form will note "landscape ~3:2
  works best".
- **Owners forget ES text** → optional fields; caption renders EN fallback when `title_es`
  missing (existing site convention).
- **Two motion systems adjacent** → slideshow opacity is independent of the GSAP entrance
  (`data-motion="scale"` on the figure, transform+autoAlpha); orthogonal properties, no
  conflict (validated in demo architecture).
