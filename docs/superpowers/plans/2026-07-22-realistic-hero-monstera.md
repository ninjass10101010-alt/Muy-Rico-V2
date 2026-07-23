# Realistic Hero Monstera Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the geometric monstera decoration with a realistic, filled forest/sage illustration and contain the hero instance inside the text column so it cannot cover the conchas photo.

**Architecture:** Keep one shared transparent SVG asset for the hero and CTA decorations. Move only the hero `<img>` into the positioned `.hero-copy` grid cell, then use a bounded absolute position and clipping on that cell; the photo remains a separate grid item. No JavaScript or content changes are needed.

**Tech Stack:** Static HTML, CSS, SVG, Wrangler/Cloudflare Workers assets, npm build script, Playwright-based browser verification.

## Global Constraints

- The hero uses one realistic filled monstera illustration with a transparent background.
- The leaf uses forest/sage tones that belong to the Muy Rico palette.
- Fenestrations are transparent and do not appear as hard-coded white patches.
- At desktop widths, no part of the leaf covers or sits above the conchas hero image.
- At mobile widths, the leaf remains inside the text column, does not overlap the photo, and does not create horizontal scrolling.
- The CTA decorations remain subtle and do not reduce text contrast.
- The leaf remains non-interactive and hidden from assistive technology.
- Do not change JavaScript, navigation, copy, or image-loading behavior.

## File Map

- Modify `monstera-leaf.svg`: own the realistic transparent botanical illustration and its internal shading, cutouts, and veins.
- Modify `index.html:97-132`: make the hero decoration a child of `.hero-copy`; leave the CTA asset references intact.
- Modify `style.css:494-499,605-612,943,1487-1506`: contain the decoration in the text column, layer it behind hero content, and tune desktop/mobile/CTA opacity.
- No application test file is required; browser geometry assertions and SVG/build checks cover this static visual change.

---

### Task 1: Replace the Leaf Artwork

**Files:**
- Modify: `monstera-leaf.svg`

**Interfaces:**
- Consumes: Existing static asset URL `monstera-leaf.svg` used by `index.html`.
- Produces: A transparent SVG with a `viewBox` of `0 0 280 340`, a masked leaf silhouette, internal depth layers, and no opaque background rectangle.

- [ ] **Step 1: Write the failing structural check**

Run this from the repository root before editing the asset:

```bash
if grep -q '<mask id="leaf-cutouts"' monstera-leaf.svg && grep -q 'fill="black"' monstera-leaf.svg; then
  printf '%s\n' 'unexpectedly passed: the old asset already has realistic cutout structure'
  exit 1
fi
printf '%s\n' 'FAIL: monstera-leaf.svg has no masked transparent cutouts yet'
exit 1
```

Expected: FAIL with `FAIL: monstera-leaf.svg has no masked transparent cutouts yet`.

- [ ] **Step 2: Replace the simplified illustration with the layered SVG**

Keep the asset transparent and use the following construction:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 340" fill="none">
  <defs>
    <linearGradient id="leaf-base" x1="38" y1="42" x2="222" y2="308" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#5f8b63"/>
      <stop offset="0.48" stop-color="#356c4d"/>
      <stop offset="1" stop-color="#1d4b38"/>
    </linearGradient>
    <linearGradient id="leaf-highlight" x1="72" y1="72" x2="190" y2="274" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#a3bd91" stop-opacity="0.64"/>
      <stop offset="0.52" stop-color="#6e9a70" stop-opacity="0.2"/>
      <stop offset="1" stop-color="#1d4b38" stop-opacity="0"/>
    </linearGradient>
    <mask id="leaf-cutouts" maskUnits="userSpaceOnUse" x="0" y="0" width="280" height="340">
      <rect width="280" height="340" fill="black"/>
      <path fill="white" d="M140 315C125 292 98 277 71 254C45 231 29 207 24 184C20 164 27 153 41 153C52 153 65 162 80 177C66 156 45 143 38 124C32 107 38 95 52 91C68 87 86 101 101 115C89 95 68 78 68 60C68 44 80 35 96 38C116 42 132 63 140 86C148 63 164 42 184 38C200 35 212 44 212 60C212 78 191 95 179 115C194 101 212 87 228 91C242 95 248 107 242 124C235 143 214 156 200 177C215 162 228 153 239 153C253 153 260 164 256 184C251 207 235 231 209 254C182 277 155 292 140 315Z"/>
      <g fill="black">
        <path d="M39 123C55 117 74 121 95 133C75 129 57 133 42 141C37 137 35 130 39 123Z"/>
        <path d="M241 123C225 117 206 121 185 133C205 129 223 133 238 141C243 137 245 130 241 123Z"/>
        <path d="M24 183C42 177 61 184 83 199C60 192 43 196 30 204C25 198 22 191 24 183Z"/>
        <path d="M256 183C238 177 219 184 197 199C220 192 237 196 250 204C255 198 258 191 256 183Z"/>
        <path d="M53 231C70 224 86 231 103 246C84 239 70 243 60 251C56 246 53 239 53 231Z"/>
        <path d="M227 231C210 224 194 231 177 246C196 239 210 243 220 251C224 246 227 239 227 231Z"/>
        <path d="M92 153C101 144 115 147 119 156C121 166 111 174 99 175C89 176 86 166 92 153Z"/>
        <path d="M188 153C179 144 165 147 161 156C159 166 169 174 181 175C191 176 194 166 188 153Z"/>
        <path d="M82 194C91 183 106 184 111 194C113 204 102 214 90 214C79 214 75 204 82 194Z"/>
        <path d="M198 194C189 183 174 184 169 194C167 204 178 214 190 214C201 214 205 204 198 194Z"/>
        <path d="M106 239C113 228 124 229 128 238C130 247 122 256 113 257C104 256 101 248 106 239Z"/>
        <path d="M174 239C167 228 156 229 152 238C150 247 158 256 167 257C176 256 179 248 174 239Z"/>
      </g>
    </mask>
    <clipPath id="leaf-shape">
      <path d="M140 315C125 292 98 277 71 254C45 231 29 207 24 184C20 164 27 153 41 153C52 153 65 162 80 177C66 156 45 143 38 124C32 107 38 95 52 91C68 87 86 101 101 115C89 95 68 78 68 60C68 44 80 35 96 38C116 42 132 63 140 86C148 63 164 42 184 38C200 35 212 44 212 60C212 78 191 95 179 115C194 101 212 87 228 91C242 95 248 107 242 124C235 143 214 156 200 177C215 162 228 153 239 153C253 153 260 164 256 184C251 207 235 231 209 254C182 277 155 292 140 315Z"/>
    </clipPath>
  </defs>

  <g mask="url(#leaf-cutouts)">
    <path d="M140 315C125 292 98 277 71 254C45 231 29 207 24 184C20 164 27 153 41 153C52 153 65 162 80 177C66 156 45 143 38 124C32 107 38 95 52 91C68 87 86 101 101 115C89 95 68 78 68 60C68 44 80 35 96 38C116 42 132 63 140 86C148 63 164 42 184 38C200 35 212 44 212 60C212 78 191 95 179 115C194 101 212 87 228 91C242 95 248 107 242 124C235 143 214 156 200 177C215 162 228 153 239 153C253 153 260 164 256 184C251 207 235 231 209 254C182 277 155 292 140 315Z" fill="url(#leaf-base)"/>
    <path d="M140 89C111 78 81 82 51 103C77 97 99 106 122 125C102 111 83 112 61 123C89 121 111 136 140 157C169 136 191 121 219 123C197 112 178 111 158 125C181 106 203 97 229 103C199 82 169 78 140 89Z" fill="url(#leaf-highlight)" opacity="0.8"/>
    <g clip-path="url(#leaf-shape)" stroke="#a4c295" stroke-linecap="round" fill="none">
      <path d="M140 315C139 254 140 178 140 86" stroke-width="5"/>
      <path d="M139 143C115 122 89 104 57 96" stroke-width="2.3" opacity="0.72"/>
      <path d="M139 164C111 148 80 132 40 124" stroke-width="2.2" opacity="0.62"/>
      <path d="M139 188C108 175 74 161 28 158" stroke-width="2.1" opacity="0.58"/>
      <path d="M139 213C107 204 72 193 28 185" stroke-width="2" opacity="0.54"/>
      <path d="M139 239C110 235 79 227 46 213" stroke-width="1.9" opacity="0.48"/>
      <path d="M141 143C165 122 191 104 223 96" stroke-width="2.3" opacity="0.72"/>
      <path d="M141 164C169 148 200 132 240 124" stroke-width="2.2" opacity="0.62"/>
      <path d="M141 188C172 175 206 161 252 158" stroke-width="2.1" opacity="0.58"/>
      <path d="M141 213C173 204 208 193 252 185" stroke-width="2" opacity="0.54"/>
      <path d="M141 239C170 235 201 227 234 213" stroke-width="1.9" opacity="0.48"/>
      <path d="M140 315C132 303 119 291 101 279" stroke-width="2" opacity="0.52"/>
      <path d="M140 315C148 303 161 291 179 279" stroke-width="2" opacity="0.52"/>
    </g>
    <path d="M140 309C137 262 137 207 138 157C138 122 139 99 140 86C143 99 145 123 144 157C143 207 143 262 140 309Z" fill="#b0ca99" opacity="0.48"/>
    <path d="M140 315C125 292 98 277 71 254C45 231 29 207 24 184C20 164 27 153 41 153C52 153 65 162 80 177C66 156 45 143 38 124C32 107 38 95 52 91C68 87 86 101 101 115C89 95 68 78 68 60C68 44 80 35 96 38C116 42 132 63 140 86C148 63 164 42 184 38C200 35 212 44 212 60C212 78 191 95 179 115C194 101 212 87 228 91C242 95 248 107 242 124C235 143 214 156 200 177C215 162 228 153 239 153C253 153 260 164 256 184C251 207 235 231 209 254C182 277 155 292 140 315Z" stroke="#1b4030" stroke-width="3.2" stroke-linejoin="round"/>
  </g>

  <path d="M140 315C139 326 137 333 136 338" stroke="#315b42" stroke-width="6" stroke-linecap="round"/>
</svg>
```

The mask is the important transparency boundary: the outer shape is white in the mask and the lobed slits/inner fenestrations are black. Do not replace those black mask shapes with paper-colored fills.

- [ ] **Step 3: Run the asset checks**

```bash
xmllint --noout monstera-leaf.svg
grep -q '<mask id="leaf-cutouts"' monstera-leaf.svg
grep -q 'fill="url(#leaf-base)"' monstera-leaf.svg
grep -q 'stroke="#1b4030"' monstera-leaf.svg
```

Expected: `xmllint` exits 0 and all `grep` checks exit 0.

- [ ] **Step 4: Commit the asset independently**

```bash
git add monstera-leaf.svg
git commit -m "feat: redraw monstera as layered botanical illustration"
```

### Task 2: Contain the Hero Decoration in the Copy Column

**Files:**
- Modify: `index.html:97-126`
- Modify: `style.css:494-499,605-612,943,1487-1506`

**Interfaces:**
- Consumes: `monstera-leaf.svg` from Task 1 and the existing `.hero-copy` positioned grid cell.
- Produces: A hero decoration whose containing block is `.hero-copy`, with no geometry that can intersect `.hero-photo`.

- [ ] **Step 1: Write the failing markup check**

Run this before moving the element:

```bash
node <<'NODE'
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const expected = /<div class="hero-copy">\s*<img class="engraving hero-engraving"/s;
if (expected.test(html)) {
  console.error('unexpectedly passed: hero leaf is already inside hero-copy');
  process.exit(1);
}
console.error('FAIL: hero leaf is still positioned against the full-width hero');
process.exit(1);
NODE
```

Expected: FAIL with `FAIL: hero leaf is still positioned against the full-width hero`.

- [ ] **Step 2: Move the hero image into `.hero-copy`**

Change the beginning of the hero from:

```html
<section class="hero">
  <img class="engraving hero-engraving" src="monstera-leaf.svg" alt="" aria-hidden="true"/>
  <div class="hero-copy">
```

to:

```html
<section class="hero">
  <div class="hero-copy">
    <img class="engraving hero-engraving" src="monstera-leaf.svg" alt="" aria-hidden="true"/>
```

Leave the closing `</div>` for `.hero-copy` after the existing proof row, immediately before the `<figure class="hero-photo hero-anim">` element. Do not modify the CTA-band image references.

- [ ] **Step 3: Add containment and layering styles**

Keep the existing `.hero-copy` spacing and add `overflow: hidden` so the decorative child cannot escape the left grid cell:

```css
.hero-copy {
  position: relative;
  z-index: 1;
  overflow: hidden;
  padding-left: max(var(--gutter), calc((100vw - var(--shell-max)) / 2));
  padding-right: 1.5rem;
}
.hero-copy > :not(.hero-engraving) {
  position: relative;
  z-index: 1;
}
```

Replace the current global hero decoration rules with:

```css
.engraving {
  position: absolute;
  pointer-events: none;
  opacity: 0.72;
  z-index: 0;
}
.hero-engraving {
  top: 0.35rem;
  right: clamp(0.7rem, 2vw, 2rem);
  width: clamp(100px, 11vw, 150px);
  max-width: calc(100% - 2rem);
  transform: rotate(7deg);
  z-index: 0;
}
.cta-band .engraving { opacity: 0.16; }
```

Update the mobile override to keep the image bounded inside the stacked copy column:

```css
  .hero-engraving {
    top: 0.4rem;
    right: 0.6rem;
    width: 106px;
    max-width: calc(100% - 1.2rem);
    transform: rotate(7deg);
  }
```

- [ ] **Step 4: Run the markup and CSS checks**

```bash
node <<'NODE'
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
if (!/<div class="hero-copy">\s*<img class="engraving hero-engraving"/s.test(html)) throw new Error('hero leaf is not the first child of hero-copy');
if (!/<figure class="hero-photo hero-anim">/.test(html)) throw new Error('hero photo is missing');
console.log('hero markup check passed');
NODE
grep -q 'overflow: hidden;' style.css
grep -q 'max-width: calc(100% - 2rem);' style.css
grep -q '\.cta-band \.engraving { opacity: 0.16; }' style.css
```

Expected: `hero markup check passed` and all `grep` checks exit 0.

- [ ] **Step 5: Commit the layout change independently**

```bash
git add index.html style.css
git commit -m "fix: keep hero monstera inside copy column"
```

### Task 3: Verify Responsive Geometry and Production Assets

**Files:**
- Verify: `monstera-leaf.svg`, `index.html`, `style.css`
- No source changes expected unless a verification failure identifies a concrete sizing or overflow defect.

**Interfaces:**
- Consumes: The completed asset and layout from Tasks 1-2.
- Produces: Verified desktop/mobile geometry and a production deployment serving the new SVG.

- [ ] **Step 1: Run the project build**

```bash
npm run build
```

Expected: the existing `home-bakery-management-system` build completes successfully. This command may install that subproject's dependencies as defined by the root `package.json`.

- [ ] **Step 2: Start the local Worker asset server**

```bash
npx wrangler dev --local
```

Expected: Wrangler reports a local URL, normally `http://localhost:8787`. Keep this process running while browser checks execute.

- [ ] **Step 3: Verify desktop and mobile geometry in a browser**

At a 1440px-wide desktop viewport, evaluate the following assertions in Playwright against `/`:

```js
const leaf = await page.locator('.hero-engraving').boundingBox();
const photo = await page.locator('.hero-photo-img').boundingBox();
const copy = await page.locator('.hero-copy').boundingBox();
if (!leaf || !photo || !copy) throw new Error('hero geometry is missing');
if (leaf.x < copy.x || leaf.x + leaf.width > copy.x + copy.width + 1) {
  throw new Error('desktop leaf escaped hero-copy');
}
if (leaf.x + leaf.width > photo.x + 1) {
  throw new Error('desktop leaf overlaps hero photo');
}
```

At a 390px-wide mobile viewport, run the same containment check and add:

```js
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
if (overflow) throw new Error('mobile page has horizontal overflow');
```

Expected: both viewports keep the leaf inside `.hero-copy`, the leaf's right edge is left of the photo's left edge on desktop, and the mobile document has no horizontal overflow. Capture screenshots at both sizes for visual review of the leaf scale and text layering.

- [ ] **Step 4: Confirm the production asset reference**

```bash
curl -fsS https://muy-rico.com/ | grep -q 'monstera-leaf.svg'
curl -fsSI https://muy-rico.com/monstera-leaf.svg | grep -q '200'
```

Expected: both commands exit 0 after deployment.

- [ ] **Step 5: Deploy the verified Worker version**

```bash
UPLOAD_OUTPUT="$(npx wrangler versions upload --name muyrico --assets . 2>&1)"
printf '%s\n' "$UPLOAD_OUTPUT"
VERSION_ID="$(printf '%s\n' "$UPLOAD_OUTPUT" | perl -ne 'print "$1\n" if /^Worker Version ID: (.+)$/')"
test -n "$VERSION_ID"
npx wrangler versions deploy --name muyrico "${VERSION_ID}@100%"
```

Expected: Wrangler reports `SUCCESS Deployed muyrico version ... at 100%`.

- [ ] **Step 6: Re-run the production checks after propagation**

```bash
curl -fsS https://muy-rico.com/ | grep -q 'monstera-leaf.svg'
curl -fsSI https://muy-rico.com/monstera-leaf.svg | grep -q '200'
```

Expected: both commands exit 0, confirming the production page and static asset are live.
