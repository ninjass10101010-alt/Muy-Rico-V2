# Impeccable Motion — Design Spec

**Date:** 2026-08-26
**Status:** Approved (design phase)
**Scope:** All 4 public pages (`index.html`, `gallery.html`, `order.html`, `quote.html`)

## Goal

Upgrade the site from "fade + rise only" to a cohesive, premium motion language — elevated but tasteful: subtle parallax, gentle floating accents, image scale-on-scroll, magnetic CTAs. Calm and editorial; never bouncy or gimmicky.

## Motion Language ("Editorial Panadería" motion spec)

One feeling: *warm, confident, unhurried* — like bread rising. Content is never blocked from reading; motion only supports hierarchy.

### Tokens

| Token | Value | Used for |
|---|---|---|
| `--m-fast` | 0.22s | hovers, presses |
| `--m-reveal` | 0.8s | scroll reveals |
| `--m-hero` | 1.1s | hero entrance |
| Ease-reveal | `power3.out` | scroll reveals |
| Ease-hero | `expo.out` | hero/photo entrances |
| Stagger step | 0.09s | grouped children |
| Parallax range | ≤ 40px scrubbed drift | images, decorative accents |

### Rules

- One orchestrated moment per viewport.
- Text rises ≤ 24px on reveal.
- Photos may scale-settle 1.06→1 or clip-reveal upward.
- Ambient floats: ±8px over 6–9s, decorative elements only. **This consciously relaxes the old "no infinite loops" rule** (README updated accordingly).
- Initial hidden states live in CSS scoped under `html.js-motion`; `motion.js` adds that class synchronously as soon as it executes (deferred = post-parse, pre-`DOMContentLoaded`), so below-fold content never flashes. No layout shift: hidden states animate only `opacity`/`transform`.

## Architecture

### Shared motion system: `motion.js`

New ~200-line vanilla JS file, loaded `<script defer>`, after the GSAP CDN scripts. Owns:

- Token constants (mirroring CSS custom properties).
- GSAP CDN-failure detection and API stubbing + `.no-gsap` class (centralizes the pattern currently duplicated in index/gallery/order inline scripts).
- Scroll reveal engine driven by declarative attributes.
- Hero entrance timelines via per-page config.
- Micro-interaction bindings.

### Declarative attributes

| Attribute | Effect |
|---|---|
| `data-motion="rise"` (default) | rise 24px + fade in on enter (88% viewport) |
| `data-motion="fade"` | opacity only |
| `data-motion="clip"` | clip-path reveal upward |
| `data-motion="scale"` (images) | scale 1.06→1 + fade on enter |
| `data-motion-group` | container staggers children by 0.09s |
| `data-parallax="30"` | ScrollTrigger scrub y-drift ±N px |
| `data-magnetic` | magnetic hover on CTAs (fine pointer only) |

### Page integration

Each page keeps its GSAP CDN includes, then calls:

```js
MuyRicoMotion.init({ hero: { /* optional per-page timeline config */ } });
```

Per-page inline animation bootstrap code is deleted (≈50 duplicated lines ×3).

### CSS changes (`style.css`)

- `:root` motion token block.
- Initial-state classes for each `data-motion` variant (visible-by-default when JS absent, hidden only under `html.js-motion`).
- Extended `.no-gsap` fallbacks (force final states).
- Card/tile hover transitions normalized onto `--m-fast`.

### Kept local (not migrated)

- `order.html` cart feedback animations (badge pop, row slide-in, cart pulse) — interaction feedback, not page choreography.
- `.lang-fade` crossfade for the ES/EN toggle.
- Existing smooth-anchor scrolling.

## Per-page choreography

### Home (`index.html`)

- **Hero:** orchestrated `expo.out` timeline — photo slides from right (x:40) with scale-settle 1.04→1; copy staggers 0.09s; CTAs enter last. Replaces current `power3.out` version.
- **Del Horno tiles:** group-stagger rise; tile photos scale 1.06→1 on enter.
- **Story:** portrait scrub parallax ±30px; text rises.
- **Testimonials / Visit / Cottage Food Law:** standard rise.
- **Decorative SVGs (monstera/fern):** ambient float where present.

### Gallery (`gallery.html`)

- Album covers clip-reveal + stagger by column position (unified through tokens).
- Lightbox open/close: fade + scale 0.98→1.

### Order (`order.html`)

- Hero entrance via shared system; product tiles group-stagger.
- Cart drawer/badge/pulse unchanged (local).

### Quote (`quote.html`)

- Currently has no motion. Gets shared reveals only (`rise` on form sections). Forms stay calm — no focus-in stagger.

## Micro-interactions

- Primary CTAs: magnetic pull ≤6px toward cursor; press-down scale 0.97. Fine pointers only.
- Cards/tiles: lift −3px + shadow deepen (CSS, token durations).
- Hover states normalized across pages.

## Resilience & Error Handling

- **GSAP CDN failure:** motion.js stubs the API, adds `.no-gsap`, all content visible statically (existing pattern, now centralized).
- **`prefers-reduced-motion`:** reveals jump to final state instantly; parallax, magnetic, and float effects disabled entirely.
- **No-JS:** `<noscript>` style keeps everything visible (existing pattern retained).
- **Performance:** entrance/reveal animates only `opacity`, `transform`, `clip-path`. LCP hero image unaffected (no delayed paint of the image itself). Parallax constrained vertically to prevent horizontal overflow.

## Testing

- Local server pass on all 4 pages × {normal, reduced-motion, CPU-throttled, CDN-blocked}.
- Playwright screenshots before/after per page for visual regression.
- Verify: no CLS on hero, no horizontal scrollbar from parallax, cart flow animations intact on order page, lightbox works on gallery.

## Out of Scope

- Admin dashboard (React) motion.
- Backend/Workers changes.
- New dependencies beyond what's already shipped (GSAP 3.12.5 CDN).
