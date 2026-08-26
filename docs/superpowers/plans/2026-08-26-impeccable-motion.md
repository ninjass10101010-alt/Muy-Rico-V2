# Impeccable Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the duplicated per-page GSAP bootstrap with one shared motion system (`motion.js`) delivering a cohesive, elevated-but-tasteful motion language across all 4 public pages.

**Architecture:** A single vanilla-JS file (`motion.js`) owns GSAP CDN-failure stubbing, declarative scroll reveals (`data-motion` attributes), group staggers, scrubbed parallax, and magnetic CTAs. Per-page hero timelines pass through a small config object. Ambient floats are pure CSS (`translate` property, so inline `rotate()` transforms are preserved). Initial hidden states live in CSS gated behind `html.js-motion`, added only when motion is actually active — content can never get stuck hidden.

**Tech Stack:** HTML5/CSS3/vanilla JS, GSAP 3.12.5 + ScrollTrigger (CDN, unchanged), Playwright (already in devDependencies) for verification screenshots.

**Spec:** `docs/superpowers/specs/2026-08-26-impeccable-motion-design.md`

## Global Constraints

- Motion tokens (exact values): `--m-fast: 0.22s`, `--m-reveal: 0.8s`, `--m-hero: 1.1s`, stagger step `0.09s`, rise distance `24px`, parallax range ≤ `40px`.
- Eases: `power3.out` for scroll reveals, `expo.out` for hero/photo entrances. Never bouncy (`back.out` is removed wherever touched).
- Only animate `opacity`, `transform`, `clip-path` — never layout properties.
- `prefers-reduced-motion: reduce` → zero motion: no reveals-hidden state, no parallax, no magnetic, no floats.
- GSAP CDN failure → `.no-gsap` on `<html>`, everything visible statically.
- No horizontal overflow introduced by parallax (y-axis drift only).
- Cart feedback animations on `order.html` (badge pop, row slide-in, cart pulse, floating-cart `gsap-shown` logic) stay untouched/local.
- Do not touch `admin/` or `home-bakery-management-system/`.
- No new dependencies. No comments in code except where mirroring existing file style.

---

### Task 1: CSS foundation — motion tokens, `js-motion` gating, variants, float

**Files:**
- Modify: `style.css` (:root block ends line 60; `.reveal` rule at line 1458; `.no-gsap` block lines 1461–1474)

**Interfaces:**
- Produces: CSS custom props `--m-fast/--m-reveal/--m-hero`; hidden initial states for `[data-motion="rise|fade|clip|scale"]` and legacy `.reveal` under `html.js-motion`; `[data-float]` keyframe animation; extended `.no-gsap` overrides. Tasks 2–6 rely on these selectors existing exactly as written here.

- [ ] **Step 1: Add motion tokens to `:root`**

In `style.css`, find (lines 57–59):

```css
  --transition-elastic: all 0.3s ease;
  --transition-smooth: all 0.25s ease;
  --sidebar-width: 0px;
```

Replace with:

```css
  --transition-elastic: all 0.3s ease;
  --transition-smooth: all 0.25s ease;
  --m-fast: 0.22s;
  --m-reveal: 0.8s;
  --m-hero: 1.1s;
  --m-stagger: 0.09s;
  --sidebar-width: 0px;
```

- [ ] **Step 2: Gate hidden reveal states behind `html.js-motion` and add variants + float**

Find (line 1458):

```css
.reveal { opacity: 0; transform: translateY(20px); }
.lang-fade { transition: opacity 0.25s ease; }
```

Replace with:

```css
/* Hidden initial states apply ONLY when the shared motion system is active
   (motion.js adds html.js-motion). No JS / reduced-motion / CDN failure =>
   everything visible statically. */
html.js-motion .reveal,
html.js-motion [data-motion="rise"] { opacity: 0; transform: translateY(24px); }
html.js-motion [data-motion="fade"] { opacity: 0; }
html.js-motion [data-motion="clip"] { opacity: 0; clip-path: inset(100% 0% 0% 0%); }
html.js-motion [data-motion="scale"] { opacity: 0; }
.lang-fade { transition: opacity 0.25s ease; }

/* Ambient float — uses the independent `translate` property so any inline
   transform (e.g. rotate on decorative engravings) is preserved. */
@keyframes mr-float {
  0%, 100% { translate: 0 0; }
  50% { translate: 0 -8px; }
}
[data-float] { animation: mr-float var(--float-dur, 8s) ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  [data-float] { animation: none; translate: 0 0 !important; }
}
```

- [ ] **Step 3: Extend the `.no-gsap` fallbacks to cover the new variants**

Find (lines 1463–1470):

```css
.no-gsap .reveal,
.no-gsap .hero-anim,
.no-gsap .hero-photo,
.no-gsap .hero-ctas > * {
  opacity: 1 !important;
  transform: none !important;
  visibility: visible !important;
}
```

Replace with:

```css
.no-gsap .reveal,
.no-gsap .hero-anim,
.no-gsap .hero-photo,
.no-gsap .hero-ctas > *,
.no-gsap [data-motion] {
  opacity: 1 !important;
  transform: none !important;
  clip-path: none !important;
  visibility: visible !important;
}
```

- [ ] **Step 4: Normalize card-lift hover transitions to tokens** (spec: micro-interaction timing normalized)

Three edits in `style.css`:

Line 662 (`.oven-card`):

```css
  transition: transform var(--m-fast) ease, box-shadow var(--m-fast) ease, border-color var(--m-fast) ease;
```

Line 1222 (`.product-tile`):

```css
  transition: transform var(--m-fast) ease, box-shadow var(--m-fast) ease, border-color var(--m-fast) ease;
```

Line ~1406 (`.gallery-card`):

```css
  transition: transform var(--m-fast) ease, box-shadow var(--m-fast) ease;
```

- [ ] **Step 5: Verify**

Run: `grep -n "m-reveal\|mr-float\|js-motion \[data-motion\|var(--m-fast) ease" style.css | head -12`
Expected: matches for token, keyframes, variant selectors, and three normalized transitions.

- [ ] **Step 6: Commit**

```bash
git add style.css
git commit -m "feat(motion): css tokens + js-motion gated reveal states + ambient float"
```

---

### Task 2: Create `motion.js` — shared motion system

**Files:**
- Create: `motion.js`

**Interfaces:**
- Consumes: global `gsap` + `ScrollTrigger` from CDN includes already present on pages.
- Produces: `window.MuyRicoMotion` with:
  - `init(config?)` — config `{ hero?: (ctx: {gsap, ScrollTrigger, TOKENS}) => void }`; binds reveals, parallax, magnetic; calls `config.hero` last. No-op when reduced-motion or CDN failure.
  - `bindReveals(root?)` — scans `[data-motion], .reveal` under `root` (default `document`), skipping already-bound nodes (`dataset.motionBound`). Used for dynamically injected content.
  - `refresh()` — `ScrollTrigger.refresh()` when active.
  - `TOKENS` — `{ fast:0.22, revealDur:0.8, heroDur:1.1, stagger:0.09, riseY:24, maxParallax:40, startReveal:'top 88%' }`.

- [ ] **Step 1: Write `motion.js`**

Create `motion.js` with exactly this content:

```js
/* Muy Rico — shared motion system (Editorial Panadería)
   Warm, confident, unhurried. One orchestrated moment per viewport.
   Owns: GSAP CDN-failure stubbing, scroll reveals (data-motion), group
   staggers, scrubbed parallax, magnetic CTAs. Ambient floats are CSS. */
(function () {
  'use strict';

  var docEl = document.documentElement;

  /* Resilience: if the GSAP CDN failed, stub the animation API and reveal
     all content via CSS (.no-gsap). Mirrors the previous per-page stubs,
     including the onComplete-after-delay `to` used by the order cart. */
  if (typeof window.gsap === 'undefined') {
    var noop = function () {};
    var chain = {
      add: function () { return this; },
      from: function () { return this; },
      to: function () { return this; },
      fromTo: function () { return this; },
      set: function () { return this; }
    };
    window.gsap = {
      registerPlugin: noop,
      set: noop,
      from: noop,
      fromTo: noop,
      to: function (t, vars) {
        if (vars && vars.onComplete) setTimeout(vars.onComplete, ((vars.delay || 0) * 1000) + 400);
      },
      getProperty: function () { return 0; },
      timeline: function () {
        var t = {};
        ['add', 'from', 'to', 'fromTo', 'set'].forEach(function (m) { t[m] = chain[m]; });
        return t;
      },
      utils: { toArray: function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); } }
    };
    window.ScrollTrigger = window.ScrollTrigger || { getAll: function () { return []; }, create: noop };
    docEl.classList.add('no-gsap');
  }

  gsap.registerPlugin(ScrollTrigger);

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var active = !reduced && !docEl.classList.contains('no-gsap');
  if (active) docEl.classList.add('js-motion');

  var TOKENS = {
    fast: 0.22,
    revealDur: 0.8,
    heroDur: 1.1,
    stagger: 0.09,
    riseY: 24,
    maxParallax: 40,
    startReveal: 'top 88%'
  };

  var FROM = {
    rise: { y: TOKENS.riseY, autoAlpha: 0 },
    fade: { autoAlpha: 0 },
    clip: { y: 14, clipPath: 'inset(100% 0% 0% 0%)', autoAlpha: 1 },
    scale: { scale: 1.06, autoAlpha: 0 }
  };
  var TO = {
    rise: { y: 0, autoAlpha: 1 },
    fade: { autoAlpha: 1 },
    clip: { y: 0, clipPath: 'inset(0% 0% 0% 0%)', autoAlpha: 1 },
    scale: { scale: 1, autoAlpha: 1 }
  };

  function variantOf(el) {
    var v = el.getAttribute('data-motion');
    if (!v && el.classList.contains('reveal')) v = 'rise';
    return FROM[v] ? v : 'rise';
  }

  function bindSingle(el) {
    el.dataset.motionBound = '1';
    var v = variantOf(el);
    var vars = {};
    for (var k in TO[v]) vars[k] = TO[v][k];
    vars.scrollTrigger = { trigger: el, start: TOKENS.startReveal, toggleActions: 'play none none reverse' };
    vars.duration = TOKENS.revealDur;
    vars.ease = 'power3.out';
    gsap.fromTo(el, FROM[v], vars);
  }

  function bindGroup(group) {
    group.dataset.groupBound = '1';
    var kids = Array.prototype.slice.call(group.children).filter(function (c) {
      return c.matches('[data-motion], .reveal') && !c.dataset.motionBound;
    });
    if (!kids.length) return;
    var tl = gsap.timeline({
      scrollTrigger: { trigger: group, start: TOKENS.startReveal, toggleActions: 'play none none reverse' }
    });
    kids.forEach(function (kid, i) {
      kid.dataset.motionBound = '1';
      var v = variantOf(kid);
      var to = {};
      for (var k in TO[v]) to[k] = TO[v][k];
      to.duration = TOKENS.revealDur;
      to.ease = 'power3.out';
      tl.fromTo(kid, FROM[v], to, i * TOKENS.stagger);
    });
  }

  function targets(root) {
    var scope = root && root !== document ? root : document;
    return gsap.utils.toArray('[data-motion], .reveal').filter(function (el) {
      return scope === document || scope.contains(el);
    }).filter(function (el) { return !el.dataset.motionBound; });
  }

  /* Idempotent: safe to call again after dynamic content injection. */
  function bindReveals(root) {
    if (!active) return;
    targets(root).forEach(function (el) {
      var group = el.parentElement ? el.parentElement.closest('[data-motion-group]') : null;
      if (group && !group.dataset.groupBound) {
        bindGroup(group);
      } else if (!group) {
        bindSingle(el);
      }
    });
    ScrollTrigger.refresh();
  }

  function bindParallax() {
    if (!active) return;
    gsap.utils.toArray('[data-parallax]').forEach(function (el) {
      var n = parseFloat(el.getAttribute('data-parallax')) || 30;
      n = Math.min(Math.abs(n), TOKENS.maxParallax);
      var scope = el.closest('section, figure, .section') || el;
      gsap.fromTo(el, { y: n }, {
        y: -n, ease: 'none',
        scrollTrigger: { trigger: scope, start: 'top bottom', end: 'bottom top', scrub: true }
      });
    });
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function bindMagnetic() {
    if (!active) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    gsap.utils.toArray('[data-magnetic]').forEach(function (el) {
      var xTo = gsap.quickTo(el, 'x', { duration: 0.35, ease: 'power3.out' });
      var yTo = gsap.quickTo(el, 'y', { duration: 0.35, ease: 'power3.out' });
      el.addEventListener('mousemove', function (e) {
        var r = el.getBoundingClientRect();
        xTo(clamp((e.clientX - (r.left + r.width / 2)) * 0.18, -6, 6));
        yTo(clamp((e.clientY - (r.top + r.height / 2)) * 0.18, -6, 6));
      });
      el.addEventListener('mouseleave', function () { xTo(0); yTo(0); });
      el.addEventListener('mousedown', function () { gsap.to(el, { scale: 0.97, duration: 0.12 }); });
      el.addEventListener('mouseup', function () { gsap.to(el, { scale: 1, duration: 0.2 }); });
    });
  }

  function init(config) {
    config = config || {};
    if (!active) return;
    bindReveals(document);
    bindParallax();
    bindMagnetic();
    if (typeof config.hero === 'function') {
      config.hero({ gsap: gsap, ScrollTrigger: ScrollTrigger, TOKENS: TOKENS });
    }
  }

  window.MuyRicoMotion = {
    init: init,
    bindReveals: bindReveals,
    refresh: function () { if (active) ScrollTrigger.refresh(); },
    TOKENS: TOKENS
  };
})();
```

- [ ] **Step 2: Syntax check**

Run: `node --check motion.js && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add motion.js
git commit -m "feat(motion): shared MuyRicoMotion system (reveals, groups, parallax, magnetic)"
```

---

### Task 3: Wire Home (`index.html`) onto the shared system

**Files:**
- Modify: `index.html` (CDN includes lines 32–33; inline script lines 455–525 and 663; markup: oven strip lines 175ff, story photo line 222, engravings lines 396–397, masthead/CTA buttons lines 111/138/406)

**Interfaces:**
- Consumes: `window.MuyRicoMotion` from Task 2; CSS states from Task 1.
- Produces: home page hero entrance via `init({hero})`; `data-*` attributes as canonical examples for Tasks 4–6.

- [ ] **Step 1: Add the motion.js include**

After line 33 (`<script src=".../ScrollTrigger.min.js"></script>`), insert:

```html
  <script src="motion.js"></script>
```

(It must load before the page's main inline script — plain script tag at that position guarantees order.)

- [ ] **Step 2: Delete the duplicated bootstrap + reveal/hero code**

In the main inline `<script>`:

Delete lines 456–469 (the "Resilience: if the GSAP CDN failed…" stub block through `document.documentElement.classList.add('no-gsap');` and its closing brace) AND line 471 (`gsap.registerPlugin(ScrollTrigger);`).

Keep the `const prefersReduced = …` line (still used by smooth-anchor scrolling).

Delete the whole "Motion" section: `function initReveals() { … }` (lines 503–515), the `if (!prefersReduced) { gsap.fromTo('.hero-photo'…)` hero block (lines 516–525), and the standalone `initReveals();` call at line 663.

In their place, insert:

```js
    /* ---------------- Motion (shared system) ---------------- */
    MuyRicoMotion.init({
      hero: function (ctx) {
        ctx.gsap.fromTo('.hero-photo',
          { x: 40, scale: 1.04, autoAlpha: 0 },
          { x: 0, scale: 1, autoAlpha: 1, duration: ctx.TOKENS.heroDur, ease: 'expo.out', clearProps: 'all' });
        ctx.gsap.fromTo('.hero-copy .hero-anim',
          { y: 26, autoAlpha: 0 },
          { y: 0, autoAlpha: 1, duration: ctx.TOKENS.revealDur, stagger: ctx.TOKENS.stagger,
            ease: 'expo.out', delay: 0.15, clearProps: 'opacity,visibility,transform' });
      }
    });
```

- [ ] **Step 3: Add declarative attributes to markup**

a) Oven strip — change (line 175):

```html
<div class="oven-strip reveal" id="oven-strip">
```

to:

```html
<div class="oven-strip" id="oven-strip" data-motion-group>
```

b) Each of the four `<a class="oven-card"` elements: add `data-motion="rise"`, e.g.:

```html
<a class="oven-card" data-motion="rise" href="order.html#tile-prod_conchas">
```

c) Each of the four `<img class="frame-img"` elements: add `data-motion="scale"`, e.g.:

```html
<img class="frame-img" data-motion="scale" src="menu-conchas.webp" alt="Conchas" loading="lazy"/>
```

d) Story portrait — change (line 222):

```html
<img class="story-photo-img" id="story-img" src="story-rebecca-jeff.webp" alt="Rebecca y Jeffery García con la bandera de Puerto Rico y México" loading="lazy"/>
```

to:

```html
<img class="story-photo-img" id="story-img" src="story-rebecca-jeff.webp" alt="Rebecca y Jeffery García con la bandera de Puerto Rico y México" loading="lazy" data-parallax="30"/>
```

e) Monstera engravings — add `data-float` (second gets slower cadence via `--float-dur`):

```html
<img class="engraving" src="monstera-leaf.svg" alt="" aria-hidden="true" data-float style="width:180px;top:-30px;left:-40px;transform:rotate(-15deg);"/>
<img class="engraving" src="monstera-leaf.svg" alt="" aria-hidden="true" data-float style="--float-dur:10s;width:150px;bottom:-40px;right:-30px;transform:rotate(140deg);"/>
```

f) Magnetic CTAs — add `data-magnetic` to:
- line 111 masthead button `<a href="order.html" class="btn btn-forest masthead-order"`
- line 138 hero `<a href="order.html" class="btn btn-forest btn-xl">`
- line 406 CTA band `<a href="order.html" class="btn btn-forest btn-xl">`

Example:

```html
<a href="order.html" class="btn btn-forest btn-xl" data-magnetic><span class="lang-fade" data-es="Hacer un Pedido" data-en="Place an Order">Place an Order</span></a>
```

- [ ] **Step 4: Verify locally**

Run: `python3 -m http.server 8099 &` then open `http://localhost:8099/index.html` in a browser.
Expected: hero photo + copy animate in with settle-scale; oven cards stagger; story image drifts subtly while scrolling; monstera leaves float gently; scrolling up re-plays reveals (reverse); console shows no errors; no horizontal scrollbar.

Also test CDN-blocked resilience: in DevTools Network, block `cdnjs.cloudflare.com`, reload → all content fully visible (no blank sections), `html` gets class `no-gsap`.

Kill server afterwards: `kill %1`

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(home): wire onto shared motion system (hero expo timeline, stagger, parallax, float)"
```

---

### Task 4: Wire Gallery (`gallery.html`)

**Files:**
- Modify: `gallery.html` (includes line 26–27; stub block 149–164; reveal engine 302–321; `renderGallery` template line 249 and gallery-grid/card markup lines 254–269)

**Interfaces:**
- Consumes: `MuyRicoMotion.bindReveals(root)` for post-fetch album injection; `data-motion="clip"` variant; `data-motion-group` stagger.
- Spec deviation (verified): the spec's "lightbox fade+scale" item is void — gallery.html has no lightbox; gallery cards link directly to `quote.html?inspiration=…`. Nothing to animate.

- [ ] **Step 1: Add include**

After line 27 (`ScrollTrigger.min.js`), insert:

```html
  <script src="motion.js"></script>
```

- [ ] **Step 2: Delete the stub + old reveal engine**

Delete lines 149–164 (comment + stub through `gsap.registerPlugin(ScrollTrigger);`).

Replace the entire reveal block (lines 302–321):

```js
    if (!prefersReduced) {
      const animateEl = (el, delay = 0) => { … };
      gsap.utils.toArray('.reveal').forEach(el => animateEl(el));
      window.initGalleryReveals = function () { … };
    } else {
      window.initGalleryReveals = function () {};
      gsap.set('.reveal', { autoAlpha: 1, y: 0 });
    }
```

with:

```js
    MuyRicoMotion.init({});
    window.initGalleryReveals = function () {
      MuyRicoMotion.bindReveals(document.getElementById('gallery-root'));
    };
```

(`prefersReduced` stays defined above — still used by hash-scroll.)

- [ ] **Step 3: Declarative markup in the render template**

In `renderGallery`, change the album opening tag (line 249):

```js
        <section class="gallery-album reveal" id="album-${escapeHtml(g.product_id)}">
```

to:

```js
        <section class="gallery-album" id="album-${escapeHtml(g.product_id)}" data-motion="clip">
```

Change the grid div (line 254):

```js
          <div class="gallery-grid">
```

to:

```js
          <div class="gallery-grid" data-motion-group>
```

And each card article (line 260):

```js
                <article class="gallery-card">
```

to:

```js
                <article class="gallery-card" data-motion="rise">
```

- [ ] **Step 4: Verify locally**

Serve (`python3 -m http.server 8099`), open `http://localhost:8099/gallery.html` (with the orders API running or accepting the empty/error state — reveals must still initialize).
Expected: albums wipe in upward (clip) on scroll; cards within an album stagger; no console errors; with CDN blocked everything is visible statically.

- [ ] **Step 5: Commit**

```bash
git add gallery.html
git commit -m "feat(gallery): clip-reveal albums + card stagger via shared motion system"
```

---

### Task 5: Wire Order (`order.html`)

**Files:**
- Modify: `order.html` (include line 31; stub block ~1448–1464; motion block 1697–1744)

**Interfaces:**
- Consumes: `MuyRicoMotion.init({hero})`, `MuyRicoMotion.bindReveals(grid)` replacing the hand-rolled `initProductReveals`.
- Preserves: local cart animations (badge pop, slideInRow, cartPulse, floating-cart `gsap-shown` logic at line ~2212) — do not touch those blocks.

- [ ] **Step 1: Add include**

After line 31 (`ScrollTrigger.min.js`), insert:

```html
  <script src="motion.js"></script>
```

- [ ] **Step 2: Delete the stub block**

Delete the "Resilience: if the GSAP CDN failed…" stub through `gsap.registerPlugin(ScrollTrigger);` (~lines 1448–1464). The identical centralized stub lives in motion.js now.

- [ ] **Step 3: Replace the motion block**

Replace the entire block from `if (!prefersReduced) {` (line 1697) through the closing `}` of the `else` branch (line 1744) with:

```js
      const productsGrid = document.getElementById('products-grid');
      window.initProductReveals = function () {
        ScrollTrigger.getAll().forEach(st => st.kill());
        MuyRicoMotion.bindReveals(productsGrid);
      };

      MuyRicoMotion.init({
        hero: function (ctx) {
          const g = ctx.gsap, T = ctx.TOKENS;
          const tl = g.timeline({ defaults: { ease: 'expo.out' } });
          tl.from('.hero-eyebrow', { y: 30, autoAlpha: 0, duration: T.revealDur })
            .from('.hero-headline-top', { y: 40, autoAlpha: 0, duration: T.heroDur }, '-=0.5')
            .from('.hero-headline-bottom', { y: 40, autoAlpha: 0, duration: T.heroDur }, '-=0.8')
            .from('.hero-divider', { scaleX: 0, autoAlpha: 0, duration: T.revealDur, transformOrigin: 'left center' }, '-=0.6')
            .from('.hero-description', { y: 20, autoAlpha: 0, duration: 0.7 }, '-=0.5');

          g.to('.hero-ctas > *', {
            y: 0, autoAlpha: 1, duration: 0.6, stagger: 0.12,
            ease: 'power3.out', delay: 1.5
          });

          g.from('.sidebar-brand, .sidebar-nav, .lang-switch-wrap, .cookie-card',
            { x: -40, autoAlpha: 0, duration: T.revealDur, stagger: 0.1, ease: 'power3.out', delay: 0.2 });

          g.from('.footer-hib-row', { scale: 0.94, autoAlpha: 0, duration: T.revealDur, ease: 'power3.out', scrollTrigger: { trigger: '.site-footer', start: 'top 95%' } });
          g.from('.footer-coqui-divider > *', { scale: 0.85, autoAlpha: 0, duration: 0.5, stagger: 0.08, ease: 'power3.out', scrollTrigger: { trigger: '.site-footer', start: 'top 92%' } });
          g.from('.footer-copyright, .footer-tagline', { y: 15, autoAlpha: 0, duration: 0.6, stagger: 0.1, ease: 'power3.out', scrollTrigger: { trigger: '.site-footer', start: 'top 90%' } });
        }
      });

      window.initProductReveals();
      loadProducts();
```

Notes:
- Footer entrances normalized from `back.out` to `power3.out` (calm, editorial).
- The old `else` (reduced-motion) branch disappears: motion.js skips activation, and Task 1's CSS gating means nothing starts hidden. `loadProducts()` still runs because `renderProducts` → `initProductReveals()` is a safe no-op when inactive (bindReveals returns early).
- Verified: there is NO CSS rule hiding `.hero-ctas > *` in order.html's `<style>` (the "CSS starts them hidden" comment is stale). The `g.to('.hero-ctas > *', …)` call is kept verbatim to preserve current live behavior exactly.

- [ ] **Step 4: Verify locally**

Serve and open `http://localhost:8099/order.html` (plus `http://localhost:8787` orders API if available).
Expected: hero choreography intact; sidebar slides in; injected product tiles stagger after live fetch; category pill switch re-runs reveals without killing the page; footer fades in calmly; add-to-cart badge pop and cart drawer animations unchanged; floating cart appears after first item; console clean.

- [ ] **Step 5: Commit**

```bash
git add order.html
git commit -m "feat(order): shared motion system wiring; calm footer easing; cart anims preserved"
```

---

### Task 6: Wire Quote (`quote.html`) — first-class motion for the form page

**Files:**
- Modify: `quote.html` (head includes after line 24; hero section line 323; form sections lines 364/391/451/485/529/548)

**Interfaces:**
- Consumes: `MuyRicoMotion.init({})` only — forms stay calm per spec (no focus-in effects, no hero timeline needed since this page's hero mirrors order's structure but should remain quiet).

- [ ] **Step 1: Add GSAP + motion includes**

After line 24 (`<link rel="stylesheet" href="style.css?v=2">`), insert:

```html
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js"></script>
  <script src="motion.js"></script>
```

(The existing `<noscript>` fallback at line 25 already covers no-JS.)

- [ ] **Step 2: Call init in the page's inline script**

Locate the main inline `<script>` block at line 584. At the very top of that block, add:

```js
    MuyRicoMotion.init({});
```

(The include tags from Step 1 are plain non-deferred scripts appearing earlier in the document, so ordering is guaranteed.)

- [ ] **Step 3: Declarative markup**

a) Hero — quiet fade for the whole block (line 323):

```html
    <section class="hero-section" data-motion="fade">
```

b) Each `<div class="form-section">` (lines 364, 391, 451, 485, 529, 548) gets `data-motion="rise"`. The inspiration one (line 515) already has an id; give it the attribute too:

```html
<div class="form-section" data-motion="rise">
```

```html
<div class="form-section" id="inspiration-section" data-motion="rise">
```

Leave the submit-area section (line 548, `style="text-align: center;"`) as rise as well.

- [ ] **Step 4: Verify locally**

Open `http://localhost:8099/quote.html`.
Expected: hero fades in; form sections rise gently on scroll; submitting the form still works (validation + Formspree flow untouched); reduced-motion emulation shows everything instantly; console clean.

- [ ] **Step 5: Commit**

```bash
git add quote.html
git commit -m "feat(quote): bring quote page onto shared motion system"
```

---

### Task 7: README truthfulness + full verification matrix

**Files:**
- Modify: `README.md` (line 8)

- [ ] **Step 1: Update the motion description**

Change line 8:

```markdown
- [GSAP 3](https://gsap.com/) for scroll animations (fade + rise only; no infinite loops)
```

to:

```markdown
- [GSAP 3](https://gsap.com/) via a shared motion system (`motion.js`): orchestrated entrances, declarative scroll reveals (`data-motion`), subtle parallax, gentle ambient accents; honors `prefers-reduced-motion` and degrades gracefully without the CDN
```

- [ ] **Step 2: Run the full verification matrix**

For each page in `index.html`, `gallery.html`, `order.html`, `quote.html` × each mode:

1. **Normal:** serve with `python3 -m http.server 8099`, walk the full page; confirm choreography + zero console errors.
2. **Reduced motion:** DevTools → Rendering → Emulate `prefers-reduced-motion: reduce`; confirm all content instantly visible, no parallax/floats/magnetics.
3. **CDN blocked:** Network-block `cdnjs.cloudflare.com`; confirm `no-gsap` class applied and every section visible.
4. **Playwright regression screenshots** (compare against pre-change expectations, catch blank-content bugs):

```bash
mkdir -p /var/folders/w0/5j65kxjn693dnzhmpjflj4_w0000gn/T/opencode/motion && node - <<'EOF'
const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  for (const p of ['index.html', 'gallery.html', 'order.html', 'quote.html']) {
    await page.goto('http://localhost:8099/' + p, { waitUntil: 'networkidle' });
    await page.evaluate(() => new Promise(r => setTimeout(r, 1600)));
    await page.screenshot({ path: '/var/folders/w0/5j65kxjn693dnzhmpjflj4_w0000gn/T/opencode/motion/' + p.replace('.', '-') + '-top.png' });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1200);
    await page.screenshot({ path: '/var/folders/w0/5j65kxjn693dnzhmpjflj4_w0000gn/T/opencode/motion/' + p.replace('.', '-') + '-bottom.png' });
  }
  await browser.close();
})();
EOF
```

Check every screenshot: no blank/invisible sections, no horizontal overflow.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): motion system description supersedes fade+rise-only rule"
```
