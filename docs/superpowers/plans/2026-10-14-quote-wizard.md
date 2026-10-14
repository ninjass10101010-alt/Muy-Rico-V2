# Quote Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `quote.html` from one long form into a 6-step gated wizard with a progress bar, bilingual throughout, with no backend change.

**Architecture:** One file (`quote.html`) gains a three-part inline script: a `STEP_DEFS` descriptor list, a single `wizard` state object, and a `show(stepId)` renderer. Every existing mechanism — `itemTypeTemplates`, `createItemCard`, the dropzone upload, the inspiration gallery, `applyLangToDOM`, and the `POST /api/quotes` submit collector — is **moved, not rewritten**. The only wire-contract change is that `serving_size` is now sent at quote level (already in the server's INSERT) and injected into cake items' details.

**Tech Stack:** Vanilla HTML/CSS/JS (classic script, no modules, no build step). Playwright (`@playwright/test`) for tests against a static server.

**Spec:** `docs/superpowers/specs/2026-10-14-quote-wizard-design.md`

## Global Constraints

- **Only two source files may change:** `quote.html` and `home-bakery-management-system/src/components/QuoteItemComposer.tsx`. No worker, no migration, no dashboard rebuild.
- **Website submissions must never send `quoted_price`.** The server rejects nothing but silently treats `actor === 'website'` as non-admin (`orders/workers/api.js:3940`).
- **No new dependencies, no new asset requests.** All CSS goes in the existing inline `<style>` block in `quote.html`; all JS stays in the existing inline script.
- **Every new user-facing string needs both languages** via `data-es` / `data-en`, and must survive `applyLangToDOM` (`quote.html:582`).
- **The occasion strings must be exactly** `Birthday`, `Wedding`, `Anniversary`, `Baby Shower`, `Quinceañera`, `Other` — casing included, matching `src/components/QuoteModal.tsx:8`.
- **Never use `innerHTML` with untrusted data.** Gallery titles and tags come from the API; set them with `textContent` / `setAttribute` only.
- **Respect `prefersReduced`** (`quote.html:569`) for every transition added.
- **Do not change `style.css`.** Only consume existing tokens: `--cream`, `--cream-deep`, `--paper`, `--forest`, `--forest-deep`, `--forest-soft`, `--clay`, `--clay-deep`, `--hairline`, `--hairline-strong`, `--font-serif`, `--font-sans`, `--r-widget`, `--r-media`.
- **Test command:** `npx playwright test tests/quote-wizard.spec.ts`
- **Playwright is already configured** (`playwright.config.ts`): `testDir: './tests'`, `baseURL: http://localhost:8901`, webServer `python3 -m http.server 8901`.
- **Commits:** one per task, conventional-commit style (`feat(quotes): …`, `test(quotes): …`, `fix(quotes): …`), matching `git log` in this repo.
- **Stage files explicitly.** `opencode.json` is untracked and must never be committed.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `quote.html` | The whole customer-facing wizard: markup panels, inline CSS, inline JS state machine | Modify throughout |
| `home-bakery-management-system/src/components/QuoteItemComposer.tsx` | Owner-side per-item editor; must display an exact serving count | Modify line 134 region only |
| `tests/quote-wizard.spec.ts` | Playwright coverage for the wizard | Create |

**Not touched:** `style.css`, `orders/workers/api.js`, `orders/migrations/*`, `src/pages/Quotes.tsx`, `order.html`, `gallery.html`.

### Interface contract (names every task must use)

These are the exact ids/classes/hooks the tests and later tasks depend on. Do not rename them.

| Hook | Meaning |
|---|---|
| `.wz-progress` | Progress bar container, `role="progressbar"`, `aria-valuenow` 0–100 |
| `.wz-progress-seg` | One of 6 segments; gains `.done` when its step is complete |
| `.wz-panel[data-step="<id>"]` | A step panel; `hidden` attribute when inactive |
| Step ids, in order | `occasion`, `event`, `design`, `product`, `details`, `contact` |
| `.wz-heading` | A panel heading, `tabindex="-1"`, receives focus on step change |
| `#wz-back` / `#wz-next` | Nav buttons |
| `#wz-reason` | Inline gating reason, `role="status"`, `hidden` when there is none |
| `.wz-tile[data-kind="occasion"][data-value="Birthday"]` | Occasion tile |
| `.wz-tile[data-kind="product"][data-value="cake"]` | Product tile |
| `#occasion` | Existing `<select>`, retained and hidden, is the occasion value source |
| `#servings` | Servings number input (step 2) |
| `#wz-search` | Gallery search input (step 3) |
| `#dietary` | Dietary text input (step 5) |
| `input[name="wz_design_intent"]` | Radios, values `match` / `customize` (step 5) |
| `#wz_design_note` | Design-changes textarea, shown when intent is `customize` (step 5) |

---

## Task 1: Add the `custom` product type

The wizard's step 4 offers "Something else". `createItemCard('custom')` currently throws because `itemLabels` has no `custom` key (`quote.html:855` reads `itemLabels[type].es`), and the `?type=` guard silently rewrites `custom` to `cake`.

**Files:**
- Modify: `quote.html:838-844` (the `itemIcons` / `itemLabels` maps)
- Modify: `quote.html:714+` (add a `custom` entry to `itemTypeTemplates`)
- Test: `tests/quote-wizard.spec.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `itemTypeTemplates.custom`, `itemIcons.custom`, `itemLabels.custom` exist, so `createItemCard('custom')` renders a card whose `name` input carries `required`.

- [ ] **Step 1: Write the failing test**

Create `tests/quote-wizard.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test';

const GALLERY = {
  photos: [
    {
      id: 'g1', product_id: 'p1', title: 'Unicorn Cake', title_es: 'Pastel de Unicornio',
      image_url: 'https://example.test/u.jpg', active: true, display_order: 0,
      tags: ['unicorn', 'magic'],
    },
    {
      id: 'g2', product_id: 'p1', title: 'Sesame Street', title_es: 'Plaza Sésamo',
      image_url: 'https://example.test/s.jpg', active: true, display_order: 1,
    },
  ],
};

async function mockApi(
  page: Page,
  opts: { gallery?: unknown; uploadStatus?: number } = {},
) {
  await page.route('**/api/gallery', (r) => r.fulfill({ json: opts.gallery ?? GALLERY }));
  await page.route('**/api/quotes/upload-image', (r) =>
    opts.uploadStatus && opts.uploadStatus >= 400
      ? r.fulfill({ status: opts.uploadStatus, json: { error: 'nope' } })
      : r.fulfill({ json: { url: 'https://example.test/up.jpg' } }),
  );
}

async function openQuote(page: Page, query = '') {
  await page.goto('/quote.html' + query, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(250);
}

test.describe('custom product type', () => {
  test('?type=custom renders a card with a required name field', async ({ page }) => {
    await mockApi(page);
    await openQuote(page, '?type=custom');
    const card = page.locator('.item-card[data-type="custom"]');
    await expect(card).toHaveCount(1);
    await expect(card.locator('input[name="name"]')).toBeVisible();
    await expect(card.locator('input[name="name"]')).toHaveAttribute('required', '');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/quote-wizard.spec.ts -g "type=custom"`
Expected: FAIL — `toHaveCount(1)` receives 0, because the guard rewrites `custom` to `cake`.

- [ ] **Step 3: Add `custom` to the icon and label maps**

In `quote.html`, replace the `itemIcons` / `itemLabels` block (currently lines 838-843) with:

```js
  const itemIcons = { cake: '🎂', cakepops: '🍭', cupcakes: '🧁', custom: '✨' };
  const itemLabels = {
    cake: { es: 'Pastel', en: 'Cake' },
    cakepops: { es: 'Cakepops', en: 'Cakepops' },
    cupcakes: { es: 'Pastelitos', en: 'Cupcakes' },
    custom: { es: 'Otra cosa', en: 'Something else' },
  };
```

- [ ] **Step 4: Add the `custom` template**

In `quote.html`, append this entry to the `itemTypeTemplates` object. The `cupcakes` entry ends with the `` `, `` on line 834, and the object closes with `};` on line 835 — insert between them:

```js
    custom: `
      <div class="form-group">
        <label class="form-label lang-fade" data-es="¿Qué quieres? *" data-en="What would you like? *">What would you like? *</label>
        <input type="text" name="name" required class="form-input" data-es-placeholder="ej. Galletas decoradas, flan" data-en-placeholder="e.g. Decorated cookies, flan">
      </div>
      <div class="form-group">
        <label class="form-label lang-fade" data-es="Descripción" data-en="Description">Description</label>
        <textarea name="description" rows="3" class="form-input" data-es-placeholder="Cuéntanos más sobre lo que quieres" data-en-placeholder="Tell us more about what you want"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label lang-fade" data-es="Cantidad" data-en="Quantity">Quantity</label>
        <input type="number" name="quantity" min="1" class="form-input" placeholder="12">
      </div>
    `,
```

Note the `<textarea>`: the submit collector at `quote.html:981` selects only `'input, select'`, so a textarea's value would be dropped. Update that selector in the same step.

- [ ] **Step 5: Include textareas in the item collector**

In `quote.html`, find this line inside the submit handler (around line 981):

```js
      card.querySelectorAll('input, select').forEach(el => {
```

Replace it with:

```js
      card.querySelectorAll('input, select, textarea').forEach(el => {
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx playwright test tests/quote-wizard.spec.ts -g "type=custom"`
Expected: PASS

- [ ] **Step 7: Verify the existing cake deep link still works**

Run: `npx playwright test tests/cta-band.spec.ts`
Expected: PASS (8 tests) — proves the shared page still loads and no inline-script error was introduced.

- [ ] **Step 8: Commit**

```bash
git add quote.html tests/quote-wizard.spec.ts
git commit -m "feat(quotes): add the custom product type to the quote form"
```

---

## Task 2: Wizard shell — CSS, panels, progress, nav, gating

Split the form into 6 panels inside the existing `<form>`, add the progress bar and sticky Back/Next nav, and make the existing fields reachable one step at a time. **No field is removed or renamed in this task**; the panels merely wrap what already exists, in the new order.

**Files:**
- Modify: `quote.html` inline `<style>` block (ends at `quote.html:275`)
- Modify: `quote.html:378-548` (the `<form>` markup)
- Modify: `quote.html:946-1010` region (submit handler variable swap)
- Test: `tests/quote-wizard.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `STEP_DEFS` (array of `{ id, title_es, title_en, canAdvance }`), `wizard` object, `show(stepId)`, `updateProgress()`, `setReason(msg)`, `syncNextLabel()`, `toggleProduct(type)`, `updateProductTiles()`, `productTypes` inside `wizard`. Later tasks extend `STEP_DEFS[].canAdvance` and the panel bodies.

- [ ] **Step 1: Write the failing tests**

Append to `tests/quote-wizard.spec.ts`:

```ts
test.describe('wizard shell', () => {
  test('opens on the occasion step with progress and a Back that is disabled', async ({ page }) => {
    await mockApi(page);
    await openQuote(page);
    await expect(page.locator('.wz-panel[data-step="occasion"]')).toBeVisible();
    await expect(page.locator('.wz-panel[data-step="contact"]')).toBeHidden();
    await expect(page.locator('#wz-progress')).toHaveAttribute('aria-valuenow', '10');
    await expect(page.locator('#wz-back')).toBeDisabled();
  });

  test('exactly one panel is visible at a time', async ({ page }) => {
    await mockApi(page);
    await openQuote(page);
    const visible = page.locator('.wz-panel:visible');
    await expect(visible).toHaveCount(1);
  });

  test('Next is gated on step 1 and explains why', async ({ page }) => {
    await mockApi(page);
    await openQuote(page);
    await expect(page.locator('#wz-next')).toBeDisabled();
    await expect(page.locator('#wz-reason')).toBeVisible();
    await expect(page.locator('#wz-reason')).not.toBeEmpty();
  });

  test('progress segments fill as steps complete', async ({ page }) => {
    await mockApi(page);
    await openQuote(page);
    await expect(page.locator('.wz-progress-seg.done')).toHaveCount(0);
    await page.click('.wz-tile[data-kind="occasion"][data-value="Birthday"]');
    await expect(page.locator('.wz-progress-seg.done')).toHaveCount(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test tests/quote-wizard.spec.ts -g "wizard shell"`
Expected: FAIL — `#wz-progress` and `.wz-panel` do not exist.

- [ ] **Step 3: Add the wizard CSS**

Inside the existing inline `<style>` block in `quote.html`, insert this immediately before the closing `</style>` (currently line 275):

```css
    /* ── Wizard shell ── */
    .wz-progress { display: flex; gap: 4px; margin: 0 0 2rem; }
    .wz-progress-seg {
      flex: 1; height: 4px; border-radius: 999px; background: var(--hairline);
      transition: background 0.25s ease;
    }
    .wz-progress-seg.done { background: var(--forest); }

    .wz-panel[hidden] { display: none; }
    .wz-panel { animation: wz-in 0.28s ease both; }
    @keyframes wz-in {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: none; }
    }

    .wz-heading {
      font-family: var(--font-serif); font-size: 1.35rem; font-weight: 500;
      color: var(--forest); margin: 0 0 0.4rem; outline: none;
    }
    .wz-sub {
      font-family: var(--font-sans); font-size: 0.9rem;
      color: var(--forest-soft); margin: 0 0 1.4rem;
    }

    .wz-tile-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 0.85rem;
    }
    .wz-tile {
      display: flex; flex-direction: column; align-items: center; gap: 0.35rem;
      padding: 1.1rem 0.75rem; background: var(--paper);
      border: 2px solid transparent; border-radius: var(--r-widget, 14px);
      cursor: pointer; font: inherit; text-align: center;
      transition: border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
    }
    .wz-tile:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(30, 70, 54, 0.08); }
    .wz-tile[aria-pressed="true"] {
      border-color: var(--clay); box-shadow: 0 0 0 3px rgba(188, 85, 72, 0.15);
    }
    .wz-tile:disabled { opacity: 0.45; cursor: default; }
    .wz-tile:disabled:hover { transform: none; box-shadow: none; }
    .wz-tile-icon { font-size: 1.6rem; line-height: 1; }
    .wz-tile-label { font-family: var(--font-sans); font-size: 0.88rem; font-weight: 600; color: var(--forest); }
    .wz-tile-desc { font-family: var(--font-sans); font-size: 0.74rem; color: var(--forest-soft); line-height: 1.3; }

    .wz-chip {
      font-family: var(--font-sans); font-size: 0.68rem; color: var(--forest-soft);
      background: var(--cream-deep); border-radius: 999px; padding: 0.12rem 0.5rem;
    }
    .wz-search { margin-bottom: 1rem; }

    .wz-reason {
      font-family: var(--font-sans); font-size: 0.82rem;
      color: var(--clay-deep); margin: 0.9rem 0 0;
    }
    .wz-reason[hidden] { display: none; }

    .wz-nav {
      position: sticky; bottom: 0; display: flex; gap: 0.75rem;
      padding: 1rem 0; margin-top: 1.5rem;
      background: linear-gradient(to top, var(--cream) 70%, transparent);
    }
    .wz-nav #wz-next { margin-left: auto; }
    @media (max-width: 640px) {
      .wz-nav { flex-direction: column-reverse; }
      .wz-nav .btn { width: 100%; }
    }
    @media (prefers-reduced-motion: reduce) {
      .wz-panel { animation: none !important; }
      .wz-tile { transition: none !important; }
      .wz-progress-seg { transition: none !important; }
    }
```

- [ ] **Step 4: Replace the form markup with panels**

In `quote.html`, replace the entire `<form id="quote-form" novalidate>` … `</form>` block (currently lines 378-536) with the markup below. Every field keeps its original `id` and `name`; only placement and the wrappers change. Fields that later tasks add tiles for are retained exactly as they are for now.

```html
        <form id="quote-form" novalidate>

          <!-- Step 1 · Occasion -->
          <section class="wz-panel" data-step="occasion" role="group" aria-labelledby="wz-h-occasion">
            <h2 class="wz-heading lang-fade" id="wz-h-occasion" tabindex="-1"
                data-es="¿Qué vamos a celebrar?" data-en="What are we celebrating?">What are we celebrating?</h2>
            <p class="wz-sub lang-fade"
               data-es="Elige la ocasión para tu pedido."
               data-en="Pick the occasion for your order.">Pick the occasion for your order.</p>

            <!-- The select is the value source; step-1 tiles drive it in Task 3. -->
            <div hidden>
              <select id="occasion" name="occasion" class="form-input">
                <option value="" data-es="Seleccionar..." data-en="Select...">Select...</option>
                <option value="Birthday" data-es="Cumpleaños" data-en="Birthday">Birthday</option>
                <option value="Wedding" data-es="Boda" data-en="Wedding">Wedding</option>
                <option value="Anniversary" data-es="Aniversario" data-en="Anniversary">Anniversary</option>
                <option value="Baby Shower" data-es="Baby Shower" data-en="Baby Shower">Baby Shower</option>
                <option value="Quinceañera" data-es="Quinceañera" data-en="Quinceañera">Quinceañera</option>
                <option value="Other" data-es="Otro" data-en="Other">Other</option>
              </select>
            </div>
          </section>

          <!-- Step 2 · Event -->
          <section class="wz-panel" data-step="event" role="group" aria-labelledby="wz-h-event" hidden>
            <h2 class="wz-heading lang-fade" id="wz-h-event" tabindex="-1"
                data-es="¿Cuándo y para cuántos?" data-en="When, and for how many?">When, and for how many?</h2>
            <p class="wz-sub lang-fade"
               data-es="Esto nos ayuda a cotizar con precisión."
               data-en="This helps us quote accurately.">This helps us quote accurately.</p>
            <div class="form-row form-row-2">
              <div class="form-group">
                <label for="desired_date" class="form-label lang-fade" data-es="Fecha del evento *" data-en="Event date *">Event date *</label>
                <input type="date" id="desired_date" name="desired_date" required class="form-input">
              </div>
              <div class="form-group">
                <label for="budget" class="form-label lang-fade" data-es="Presupuesto estimado" data-en="Estimated budget">Estimated budget</label>
                <input type="text" id="budget" name="budget" class="form-input"
                       data-es-placeholder="ej. $100-150" data-en-placeholder="e.g. $100-150"
                       placeholder="e.g. $100-150">
              </div>
            </div>
          </section>

          <!-- Step 3 · Design -->
          <section class="wz-panel" data-step="design" role="group" aria-labelledby="wz-h-design" hidden>
            <h2 class="wz-heading lang-fade" id="wz-h-design" tabindex="-1"
                data-es="Elige un diseño" data-en="Pick a design">Pick a design</h2>
            <p class="wz-sub lang-fade"
               data-es="Opcional — explora nuestros trabajos o sube tu propia idea."
               data-en="Optional — browse our past work or upload your own idea.">Optional — browse our past work or upload your own idea.</p>

            <div class="form-section" id="inspiration-section">
              <div id="inspiration-grid">
                <p class="form-help lang-fade" style="margin-bottom: 0;" data-es="Cargando galería…" data-en="Loading gallery…">Loading gallery…</p>
              </div>
              <p id="inspiration-count">0 selected</p>
            </div>

            <div class="form-section">
              <p class="form-help lang-fade"
                 data-es="O sube una imagen de referencia (JPG/PNG/WEBP, máx. 5MB)"
                 data-en="Or upload a reference image (JPG/PNG/WEBP, max 5MB)">
                 Or upload a reference image (JPG/PNG/WEBP, max 5MB)
              </p>
              <div id="image-dropzone" class="dropzone" style="
                border: 2px dashed var(--hairline-strong);
                border-radius: 14px;
                padding: 32px;
                text-align: center;
                cursor: pointer;
                transition: border-color 0.2s;
                background: var(--cream-deep);
              ">
                <p class="dropzone-text lang-fade"
                   data-es="Arrastra una imagen aquí o haz clic para seleccionar"
                   data-en="Drag an image here or click to select">
                   Drag an image here or click to select
                </p>
                <input type="file" id="reference_image" accept="image/jpeg,image/png,image/webp" style="display:none;">
              </div>
              <div id="image-preview" style="display:none; margin-top: 12px;">
                <img id="preview-img" src="" alt="Preview" style="max-width: 100%; max-height: 200px; border-radius: 12px; border: 1px solid var(--hairline);">
                <p id="preview-filename" class="form-help" style="margin-top: 4px;"></p>
              </div>
            </div>
          </section>

          <!-- Step 4 · Product -->
          <section class="wz-panel" data-step="product" role="group" aria-labelledby="wz-h-product" hidden>
            <h2 class="wz-heading lang-fade" id="wz-h-product" tabindex="-1"
                data-es="¿Qué vamos a hacer?" data-en="What are we making?">What are we making?</h2>
            <p class="wz-sub lang-fade"
               data-es="Elige uno o más — puedes combinar."
               data-en="Pick one or more — you can combine.">Pick one or more — you can combine.</p>
            <div class="wz-tile-grid" id="wz-product-tiles"></div>
          </section>

          <!-- Step 5 · Details -->
          <section class="wz-panel" data-step="details" role="group" aria-labelledby="wz-h-details" hidden>
            <h2 class="wz-heading lang-fade" id="wz-h-details" tabindex="-1"
                data-es="Cuéntanos los detalles" data-en="Tell us the details">Tell us the details</h2>
            <p class="wz-sub lang-fade"
               data-es="Mientras más detalle, más rápida la cotización."
               data-en="The more detail, the faster the quote.">The more detail, the faster the quote.</p>
            <div id="items-container" class="space-y-6"></div>
          </section>

          <!-- Step 6 · Contact -->
          <section class="wz-panel" data-step="contact" role="group" aria-labelledby="wz-h-contact" hidden>
            <h2 class="wz-heading lang-fade" id="wz-h-contact" tabindex="-1"
                data-es="Casi listo" data-en="Almost done">Almost done</h2>
            <p class="wz-sub lang-fade"
               data-es="¿A dónde te enviamos la cotización?"
               data-en="Where should we send the quote?">Where should we send the quote?</p>

            <div class="form-row">
              <div class="form-group">
                <label for="customer_name" class="form-label lang-fade" data-es="Nombre *" data-en="Name *">Name *</label>
                <input type="text" id="customer_name" name="customer_name" required class="form-input" placeholder="e.g. María García">
              </div>
            </div>
            <div class="form-row form-row-2">
              <div class="form-group">
                <label for="email" class="form-label lang-fade" data-es="Correo electrónico *" data-en="Email *">Email *</label>
                <input type="email" id="email" name="email" required class="form-input" placeholder="maria@ejemplo.com">
              </div>
              <div class="form-group">
                <label for="phone" class="form-label lang-fade" data-es="Teléfono" data-en="Phone">Phone</label>
                <input type="tel" id="phone" name="phone" class="form-input" placeholder="(616) 555-0123">
              </div>
            </div>
            <div class="form-group">
              <label for="comments" class="form-label lang-fade" data-es="¿Algo más?" data-en="Anything else?">Anything else?</label>
              <textarea id="comments" name="comments" rows="4" class="form-input"
                        data-es-placeholder="ej. Imagino un pastel de dos pisos con flores frescas…"
                        data-en-placeholder="e.g. I'm imagining a two-tier cake with fresh flowers…"
                        placeholder="e.g. I'm imagining a two-tier cake with fresh flowers…"></textarea>
            </div>

            <div id="form-error" style="display:none; background: rgba(188,85,72,0.10); border: 1px solid var(--clay); border-radius: 12px; padding: 12px 16px; margin-top: 16px; font-size: 14px; color: var(--clay-deep);"></div>
          </section>

          <!-- Nav -->
          <div class="wz-nav">
            <button type="button" id="wz-back" class="btn btn-ghost lang-fade"
                    data-es="Atrás" data-en="Back" disabled>Back</button>
            <button type="button" id="wz-next" class="btn btn-coral lang-fade"
                    data-es="Siguiente" data-en="Next" disabled>Next</button>
          </div>
          <p id="wz-reason" class="wz-reason" role="status" aria-live="polite"></p>
        </form>
```

- [ ] **Step 5: Remove the JS the new markup no longer has**

Step 4 deleted `#add-item-btn` and `#item-type-picker` from the markup, but the script still attaches listeners to both. `document.getElementById('add-item-btn')` now returns `null`, so `addEventListener` throws and the entire inline script aborts — which would break every later step. Replace the block at `quote.html:866-903` (the `removeItem` function through the `.item-type-btn` loop) with this minimal version:

```js
  function removeItem(itemId) {
    const card = document.querySelector(`[data-item-id="${itemId}"]`);
    if (card) card.remove();
  }

  function updateAddButtonVisibility() {
    // The add-item modal was replaced by the step-4 product tiles; Task 6 owns
    // the replacement. Kept as a no-op so initializeQuoteForm stays callable.
  }
```

- [ ] **Step 6: Add the step machine**

In `quote.html`, insert this immediately after the existing `initCustomQtyToggles` function (currently ends at line 920), before the `enforceMinimumDesiredDate` IIFE:

```js
  // ─── Wizard step machine ────────────────────────────────────────────────
  const STEP_ORDER = ['occasion', 'event', 'design', 'product', 'details', 'contact'];
  const STEP_PROGRESS = { occasion: 10, event: 30, design: 50, product: 65, details: 80, contact: 95 };

  const wizard = {
    step: 'occasion',
    productTypes: [],
  };

  const wzPanels = Array.from(document.querySelectorAll('.wz-panel'));
  const wzSegs = Array.from(document.querySelectorAll('.wz-progress-seg'));
  const wzProgress = document.getElementById('wz-progress');
  const wzBack = document.getElementById('wz-back');
  const wzNext = document.getElementById('wz-next');
  const wzReason = document.getElementById('wz-reason');

  const REASONS = {
    occasion: { es: 'Elige una ocasión para continuar.', en: 'Choose an occasion to continue.' },
    event: { es: 'Agrega la fecha y el número de porciones.', en: 'Add the date and number of servings.' },
    product: { es: 'Elige al menos un producto.', en: 'Choose at least one product.' },
    details: { es: 'Completa los campos obligatorios de cada artículo.', en: 'Fill in the required fields for each item.' },
    contact: { es: 'Agrega tu nombre y correo electrónico.', en: 'Add your name and email.' },
  };

  function canAdvance(stepId) {
    if (stepId === 'occasion') return !!document.getElementById('occasion').value;
    if (stepId === 'event') {
      const date = document.getElementById('desired_date').value;
      if (!date) return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return new Date(date + 'T00:00:00') >= today;
    }
    if (stepId === 'design') return true;
    if (stepId === 'product') return wizard.productTypes.length > 0;
    if (stepId === 'details') {
      for (const card of document.querySelectorAll('.item-card')) {
        const missing = Array.from(card.querySelectorAll('[required]')).some(el => !String(el.value).trim());
        if (missing) return false;
      }
      return true;
    }
    if (stepId === 'contact') {
      const name = document.getElementById('customer_name').value.trim();
      const email = document.getElementById('email').value.trim();
      return !!name && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }
    return true;
  }

  function syncNav() {
    const idx = STEP_ORDER.indexOf(wizard.step);
    const ok = canAdvance(wizard.step);
    wzNext.disabled = !ok;
    wzBack.disabled = idx === 0;

    const reason = REASONS[wizard.step];
    if (!ok && reason) {
      wzReason.textContent = currentLang === 'es' ? reason.es : reason.en;
      wzReason.hidden = false;
    } else {
      wzReason.textContent = '';
      wzReason.hidden = true;
    }

    const onContact = wizard.step === 'contact';
    wzNext.setAttribute('data-es', onContact ? 'Enviar Solicitud' : 'Siguiente');
    wzNext.setAttribute('data-en', onContact ? 'Submit Quote Request' : 'Next');
    wzNext.textContent = currentLang === 'es'
      ? wzNext.getAttribute('data-es')
      : wzNext.getAttribute('data-en');
  }

  function updateProgress() {
    const idx = STEP_ORDER.indexOf(wizard.step);
    wzSegs.forEach((seg, i) => seg.classList.toggle('done', i <= idx));
    const value = STEP_PROGRESS[wizard.step] || 0;
    wzProgress.setAttribute('aria-valuenow', String(value));
  }

  function show(stepId) {
    wizard.step = stepId;
    wzPanels.forEach(p => { p.hidden = p.dataset.step !== stepId; });
    updateProgress();
    syncNav();
    const heading = document.querySelector(`.wz-panel[data-step="${stepId}"] .wz-heading`);
    if (heading) heading.focus({ preventScroll: true });
    document.getElementById('quote-form-section').scrollIntoView({
      behavior: prefersReduced ? 'auto' : 'smooth',
      block: 'start',
    });
    reapplyLang();
  }

  function reapplyLang() {
    applyLangToDOM(currentLang);
    syncNav();
  }

  wzBack.addEventListener('click', () => {
    const idx = STEP_ORDER.indexOf(wizard.step);
    if (idx > 0) show(STEP_ORDER[idx - 1]);
  });

  wzNext.addEventListener('click', () => {
    if (!canAdvance(wizard.step)) { syncNav(); return; }
    if (wizard.step === 'contact') { document.getElementById('quote-form').requestSubmit(); return; }
    const idx = STEP_ORDER.indexOf(wizard.step);
    if (idx < STEP_ORDER.length - 1) show(STEP_ORDER[idx + 1]);
  });
```

- [ ] **Step 7: Add the progress bar to the markup**

In `quote.html`, insert this immediately before `<form id="quote-form" novalidate>`:

```html
        <div class="wz-progress" id="wz-progress" role="progressbar"
             aria-valuemin="0" aria-valuemax="100" aria-valuenow="10"
             aria-label="Quote request progress">
          <span class="wz-progress-seg"></span>
          <span class="wz-progress-seg"></span>
          <span class="wz-progress-seg"></span>
          <span class="wz-progress-seg"></span>
          <span class="wz-progress-seg"></span>
          <span class="wz-progress-seg"></span>
        </div>
```

- [ ] **Step 8: Point the submit handler at the nav button**

In `quote.html`, in the submit handler region, change the `submitBtn` lookup (around line 950) from:

```js
  const submitBtn = document.getElementById('submit-btn');
```

to:

```js
  const submitBtn = document.getElementById('wz-next');
```

Then, in the same handler's failure paths, replace both occurrences of:

```js
        submitBtn.textContent = currentLang === 'es' ? 'Enviar Solicitud' : 'Submit Quote Request';
```

with:

```js
        syncNav();
```

- [ ] **Step 9: Initialize on the first step**

In `quote.html`, change the `DOMContentLoaded` listener at the end of the script (currently line 1174) from:

```js
  document.addEventListener('DOMContentLoaded', () => {
    initializeQuoteForm();
  });
```

to:

```js
  document.addEventListener('DOMContentLoaded', () => {
    initializeQuoteForm();
    show('occasion');
  });
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npx playwright test tests/quote-wizard.spec.ts -g "wizard shell"`
Expected: PASS (4 tests)

- [ ] **Step 11: Verify nothing regressed**

Run: `npx playwright test`
Expected: PASS (all suites). If the custom-type test fails, the `initializeQuoteForm` rewrite in Task 6 is the cause — check that Task 1's changes are intact.

- [ ] **Step 12: Commit**

```bash
git add quote.html tests/quote-wizard.spec.ts
git commit -m "feat(quotes): wizard shell with progress bar and gated steps"
```

---

## Task 3: Step 1 — occasion tiles

Replace the hidden `<select>`-only experience with six tappable tiles. The `<select>` stays in the DOM (hidden) as the value source so the submit collector and `applyLangToDOM` need no change.

**Files:**
- Modify: `quote.html` (step-1 panel markup, plus one JS block)
- Test: `tests/quote-wizard.spec.ts`

**Interfaces:**
- Consumes: `show()`, `syncNav()`, `updateProgress()`, `wizard` from Task 2.
- Produces: `OCCASION_TILES` array of `{ value, icon, es, en }`; tiles with `data-kind="occasion"`.

- [ ] **Step 1: Write the failing test**

Append to `tests/quote-wizard.spec.ts`:

```ts
test.describe('step 1 · occasion tiles', () => {
  test('renders six tiles and selecting one unlocks Next', async ({ page }) => {
    await mockApi(page);
    await openQuote(page);
    await expect(page.locator('.wz-tile[data-kind="occasion"]')).toHaveCount(6);
    await expect(page.locator('#wz-next')).toBeDisabled();
    await page.click('.wz-tile[data-kind="occasion"][data-value="Quinceañera"]');
    await expect(page.locator('#wz-next')).toBeEnabled();
    await expect(page.locator('#occasion')).toHaveValue('Quinceañera');
  });

  test('selected tile is marked pressed and only one stays pressed', async ({ page }) => {
    await mockApi(page);
    await openQuote(page);
    await page.click('.wz-tile[data-kind="occasion"][data-value="Wedding"]');
    await page.click('.wz-tile[data-kind="occasion"][data-value="Birthday"]');
    await expect(page.locator('.wz-tile[data-kind="occasion"][aria-pressed="true"]')).toHaveCount(1);
    await expect(page.locator('.wz-tile[data-kind="occasion"][data-value="Birthday"]')).toHaveAttribute('aria-pressed', 'true');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/quote-wizard.spec.ts -g "occasion tiles"`
Expected: FAIL — 0 tiles found.

- [ ] **Step 3: Replace the step-1 panel body**

In `quote.html`, inside the step-1 panel, replace the comment and the whole `<div hidden>…</div>` wrapper with:

```html
            <div class="wz-tile-grid" id="wz-occasion-tiles"></div>

            <!-- The select is the value source for the submit collector; the tiles drive it. -->
            <div hidden>
              <select id="occasion" name="occasion" class="form-input">
                <option value="" data-es="Seleccionar..." data-en="Select...">Select...</option>
                <option value="Birthday" data-es="Cumpleaños" data-en="Birthday">Birthday</option>
                <option value="Wedding" data-es="Boda" data-en="Wedding">Wedding</option>
                <option value="Anniversary" data-es="Aniversario" data-en="Anniversary">Anniversary</option>
                <option value="Baby Shower" data-es="Baby Shower" data-en="Baby Shower">Baby Shower</option>
                <option value="Quinceañera" data-es="Quinceañera" data-en="Quinceañera">Quinceañera</option>
                <option value="Other" data-es="Otro" data-en="Other">Other</option>
              </select>
            </div>
```

- [ ] **Step 4: Render and wire the tiles**

In `quote.html`, add this inside the wizard block from Task 2, immediately after the `wzNext.addEventListener(...)` block:

```js
  const OCCASION_TILES = [
    { value: 'Birthday', icon: '🎂', es: 'Cumpleaños', en: 'Birthday' },
    { value: 'Quinceañera', icon: '👑', es: 'Quinceañera', en: 'Quinceañera' },
    { value: 'Wedding', icon: '💍', es: 'Boda', en: 'Wedding' },
    { value: 'Baby Shower', icon: '🧸', es: 'Baby Shower', en: 'Baby Shower' },
    { value: 'Anniversary', icon: '💐', es: 'Aniversario', en: 'Anniversary' },
    { value: 'Other', icon: '✨', es: 'Otro', en: 'Other' },
  ];

  function buildOccasionTiles() {
    const grid = document.getElementById('wz-occasion-tiles');
    if (!grid) return;
    const frag = document.createDocumentFragment();
    OCCASION_TILES.forEach(t => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wz-tile';
      btn.dataset.kind = 'occasion';
      btn.dataset.value = t.value;
      btn.setAttribute('aria-pressed', 'false');

      const icon = document.createElement('span');
      icon.className = 'wz-tile-icon';
      icon.textContent = t.icon;
      icon.setAttribute('aria-hidden', 'true');

      const label = document.createElement('span');
      label.className = 'wz-tile-label lang-fade';
      label.setAttribute('data-es', t.es);
      label.setAttribute('data-en', t.en);
      label.textContent = t.en;

      btn.appendChild(icon);
      btn.appendChild(label);
      btn.addEventListener('click', () => selectOccasion(t.value));
      frag.appendChild(btn);
    });
    grid.appendChild(frag);
  }

  function selectOccasion(value) {
    document.getElementById('occasion').value = value;
    document.querySelectorAll('.wz-tile[data-kind="occasion"]').forEach(tile => {
      tile.setAttribute('aria-pressed', tile.dataset.value === value ? 'true' : 'false');
    });
    syncNav();
    updateProgress();
  }

  buildOccasionTiles();
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx playwright test tests/quote-wizard.spec.ts`
Expected: PASS (all tests so far)

- [ ] **Step 6: Commit**

```bash
git add quote.html tests/quote-wizard.spec.ts
git commit -m "feat(quotes): occasion tiles for wizard step 1"
```

---

## Task 4: Step 2 — event details and the servings question

Add the servings number input, keep the date min-guard, and confirm the three fields gate the step.

**Files:**
- Modify: `quote.html` (step-2 panel markup, the `enforceMinimumDesiredDate` IIFE, `wizard` object)
- Test: `tests/quote-wizard.spec.ts`

**Interfaces:**
- Consumes: `show()`, `syncNav()`, `wizard` from Task 2.
- Produces: `#servings` input whose value is read on submit as `wizard.servings`; `wizard.servings` added to the state object.

- [ ] **Step 1: Write the failing test**

Append to `tests/quote-wizard.spec.ts`:

```ts
test.describe('step 2 · event details', () => {
  test('servings and date are required to advance; budget is not', async ({ page }) => {
    await mockApi(page);
    await openQuote(page);
    await page.click('.wz-tile[data-kind="occasion"][data-value="Birthday"]');
    await page.click('#wz-next');
    await expect(page.locator('.wz-panel[data-step="event"]')).toBeVisible();
    await expect(page.locator('#wz-next')).toBeDisabled();

    await page.fill('#servings', '25');
    await expect(page.locator('#wz-next')).toBeDisabled();

    await page.fill('#desired_date', '2099-06-01');
    await expect(page.locator('#wz-next')).toBeEnabled();
    await expect(page.locator('#budget')).toHaveValue('');
  });

  test('a past date does not advance', async ({ page }) => {
    await mockApi(page);
    await openQuote(page);
    await page.click('.wz-tile[data-kind="occasion"][data-value="Birthday"]');
    await page.click('#wz-next');
    await page.fill('#servings', '10');
    await page.fill('#desired_date', '2000-01-01');
    await expect(page.locator('#wz-next')).toBeDisabled();
    await expect(page.locator('#wz-reason')).toBeVisible();
  });

  test('a valid step 2 answer survives Back and Forward', async ({ page }) => {
    await mockApi(page);
    await openQuote(page);
    await page.click('.wz-tile[data-kind="occasion"][data-value="Birthday"]');
    await page.click('#wz-next');
    await page.fill('#servings', '40');
    await page.fill('#desired_date', '2099-06-01');
    await page.click('#wz-back');
    await expect(page.locator('.wz-panel[data-step="occasion"]')).toBeVisible();
    await page.click('#wz-next');
    await expect(page.locator('#servings')).toHaveValue('40');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test tests/quote-wizard.spec.ts -g "step 2"`
Expected: FAIL — `#servings` does not exist.

- [ ] **Step 3: Add the servings input**

In `quote.html`, inside the step-2 panel, insert this `<div class="form-group">` as the first child of the `.form-row.form-row-2`, before the `desired_date` group:

```html
              <div class="form-group">
                <label for="servings" class="form-label lang-fade" data-es="Número de porciones *" data-en="Number of servings *">Number of servings *</label>
                <input type="number" id="servings" name="servings" min="1" required class="form-input" placeholder="25">
                <p class="form-help lang-fade"
                   data-es="¿Cuántos invitados planeas servir?"
                   data-en="How many guests do you plan to serve?">How many guests do you plan to serve?</p>
              </div>
```

- [ ] **Step 4: Track servings in wizard state and gate on it**

In `quote.html`, extend the `wizard` object from Task 2 to:

```js
  const wizard = {
    step: 'occasion',
    productTypes: [],
    servings: '',
  };
```

Then add a listener so `wizard.servings` stays in sync. Insert immediately after the `wzNext.addEventListener(...)` block:

```js
  document.getElementById('servings').addEventListener('input', (e) => {
    wizard.servings = e.target.value.trim();
    syncNav();
  });
  document.getElementById('desired_date').addEventListener('change', syncNav);
```

- [ ] **Step 5: Gate step 2 on the servings value**

In `quote.html`, in `canAdvance`, replace the `event` branch with:

```js
    if (stepId === 'event') {
      const servings = Number(document.getElementById('servings').value);
      if (!Number.isFinite(servings) || servings < 1) return false;
      const date = document.getElementById('desired_date').value;
      if (!date) return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return new Date(date + 'T00:00:00') >= today;
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx playwright test tests/quote-wizard.spec.ts -g "step 2"`
Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
git add quote.html tests/quote-wizard.spec.ts
git commit -m "feat(quotes): servings, date and budget step for the quote wizard"
```

---

## Task 5: Step 3 — gallery search and the tag-ready contract

Add a client-side search box over the loaded gallery, render tag chips when the API supplies them, and make the code prove it works whether or not `tags` exists.

**Files:**
- Modify: `quote.html` (step-3 panel markup, `renderInspirationGrid`, `loadInspirationGallery`)
- Test: `tests/quote-wizard.spec.ts`

**Interfaces:**
- Consumes: `applyLangToDOM` (`quote.html:582`), `toggleInspiration`, `renderInspirationGrid`, `loadInspirationGallery`.
- Produces: `#wz-search`; `wzAllPhotos` module-scope array; `renderInspirationGrid(photos)` unchanged signature but now also renders chips; `photoTags(ph)` helper returning `string[]`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/quote-wizard.spec.ts`:

```ts
test.describe('step 3 · gallery search and tags', () => {
  async function gotoDesign(page: Page) {
    await mockApi(page);
    await openQuote(page);
    await page.click('.wz-tile[data-kind="occasion"][data-value="Birthday"]');
    await page.click('#wz-next');
    await page.fill('#servings', '20');
    await page.fill('#desired_date', '2099-06-01');
    await page.click('#wz-next');
    await expect(page.locator('.wz-panel[data-step="design"]')).toBeVisible();
  }

  test('searches by title, accent- and case-insensitively', async ({ page }) => {
    await gotoDesign(page);
    await expect(page.locator('.inspiration-card')).toHaveCount(2);
    await page.fill('#wz-search', 'PLAZA SESAMO');
    await expect(page.locator('.inspiration-card')).toHaveCount(1);
    await expect(page.locator('.inspiration-card')).toContainText('Sesame Street');
  });

  test('searches by tag when tags are present', async ({ page }) => {
    await gotoDesign(page);
    await page.fill('#wz-search', 'magic');
    await expect(page.locator('.inspiration-card')).toHaveCount(1);
    await expect(page.locator('.inspiration-card')).toContainText('Unicorn');
  });

  test('renders tag chips only for photos that have tags', async ({ page }) => {
    await gotoDesign(page);
    await expect(page.locator('.inspiration-card[data-photo-id="g1"] .wz-chip')).toHaveCount(2);
    await expect(page.locator('.inspiration-card[data-photo-id="g2"] .wz-chip')).toHaveCount(0);
  });

  test('a missing or malformed tags field does not break rendering', async ({ page }) => {
    await mockApi(page, {
      gallery: {
        photos: [
          { id: 'x1', product_id: 'p1', title: 'No Tags', image_url: 'https://example.test/a.jpg', tags: 'not-an-array' },
          { id: 'x2', product_id: 'p1', title: 'Plain', image_url: 'https://example.test/b.jpg' },
        ],
      },
    });
    await openQuote(page);
    await page.click('.wz-tile[data-kind="occasion"][data-value="Birthday"]');
    await page.click('#wz-next');
    await page.fill('#servings', '20');
    await page.fill('#desired_date', '2099-06-01');
    await page.click('#wz-next');
    await expect(page.locator('.inspiration-card')).toHaveCount(2);
    await expect(page.locator('.wz-chip')).toHaveCount(0);
    await expect(page.locator('#wz-search')).toBeVisible();
  });

  test('step 3 never blocks advancing', async ({ page }) => {
    await gotoDesign(page);
    await expect(page.locator('#wz-next')).toBeEnabled();
    await page.click('#wz-next');
    await expect(page.locator('.wz-panel[data-step="product"]')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test tests/quote-wizard.spec.ts -g "step 3"`
Expected: FAIL — `#wz-search` does not exist.

- [ ] **Step 3: Add the search input to the panel**

In `quote.html`, inside the step-3 panel, insert this immediately before `<div class="form-section" id="inspiration-section">`:

```html
            <input type="search" id="wz-search" class="form-input wz-search" autocomplete="off"
                   data-es-placeholder="Busca un diseño (ej. unicornio, flores)"
                   data-en-placeholder="Search designs (e.g. unicorn, flowers)"
                   placeholder="Search designs (e.g. unicorn, flowers)">
```

- [ ] **Step 4: Add the tag helper and accent-insensitive search**

In `quote.html`, inside the wizard block, add after the `buildOccasionTiles()` call:

```js
  const PHOTO_TAGS_FALLBACK = Object.freeze([]);

  function photoTags(ph) {
    return Array.isArray(ph && ph.tags) ? ph.tags.filter(t => typeof t === 'string') : PHOTO_TAGS_FALLBACK;
  }

  function normalizeSearch(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function matchesSearch(ph, needle) {
    if (!needle) return true;
    const haystack = [ph.title, ph.title_es, ...photoTags(ph)].map(normalizeSearch);
    return haystack.some(h => h.includes(needle));
  }
```

- [ ] **Step 5: Track the loaded photos and filter on input**

In `quote.html`, inside the wizard block, add after the helpers from Step 4:

```js
  let wzAllPhotos = [];

  function applySearchFilter() {
    const input = document.getElementById('wz-search');
    const needle = normalizeSearch(input ? input.value : '').trim();
    renderInspirationGrid(wzAllPhotos.filter(ph => matchesSearch(ph, needle)), needle);
  }

  document.getElementById('wz-search').addEventListener('input', applySearchFilter);
```

- [ ] **Step 6: Render tag chips and an empty-search state**

In `quote.html`, replace the whole `renderInspirationGrid` function (currently lines 1087-1129) with:

```js
  function renderInspirationGrid(photos, needle) {
    const grid = document.getElementById('inspiration-grid');
    if (!grid) return;
    grid.innerHTML = '';
    if (!photos.length) {
      const empty = document.createElement('p');
      empty.className = 'gallery-empty lang-fade';
      if (needle) {
        empty.setAttribute('data-es', 'No encontramos diseños con ese nombre. Prueba otra palabra.');
        empty.setAttribute('data-en', 'No designs matched that search. Try another word.');
        empty.textContent = 'No designs matched that search. Try another word.';
      } else {
        empty.setAttribute('data-es', 'La galería llegará pronto.');
        empty.setAttribute('data-en', 'The gallery is coming soon.');
        empty.textContent = 'The gallery is coming soon.';
      }
      grid.appendChild(empty);
      applyLangToDOM(currentLang);
      return;
    }
    const frag = document.createDocumentFragment();
    photos.forEach(ph => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'inspiration-card';
      card.dataset.photoId = String(ph.id);
      card.setAttribute('aria-pressed', 'false');
      const img = document.createElement('img');
      img.className = 'gallery-card-img';
      img.src = ph.image_url;
      img.alt = ph.title_es || ph.title || 'Muy Rico';
      img.loading = 'lazy';
      const title = document.createElement('span');
      title.className = 'inspiration-card-title lang-fade';
      title.setAttribute('data-es', ph.title_es || ph.title || '');
      title.setAttribute('data-en', ph.title || '');
      title.textContent = ph.title || '';
      const check = document.createElement('span');
      check.className = 'inspiration-check';
      check.textContent = '✓';
      card.appendChild(img);
      card.appendChild(title);

      const tags = photoTags(ph);
      if (tags.length) {
        const chipRow = document.createElement('span');
        chipRow.style.display = 'flex';
        chipRow.style.flexWrap = 'wrap';
        chipRow.style.gap = '0.25rem';
        tags.slice(0, 4).forEach(t => {
          const chip = document.createElement('span');
          chip.className = 'wz-chip';
          chip.textContent = t;
          chipRow.appendChild(chip);
        });
        card.appendChild(chipRow);
      }

      card.appendChild(check);
      card.addEventListener('click', () => toggleInspiration(ph, card));
      frag.appendChild(card);
    });
    grid.appendChild(frag);
    applyLangToDOM(currentLang);
  }
```

- [ ] **Step 7: Store the full list on load and re-apply the filter**

In `quote.html`, inside `loadInspirationGallery`, replace the line:

```js
      const photos = data.photos || [];
      renderInspirationGrid(photos);
```

with:

```js
      const photos = data.photos || [];
      wzAllPhotos = photos;
      applySearchFilter();
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx playwright test tests/quote-wizard.spec.ts -g "step 3"`
Expected: PASS (5 tests)

- [ ] **Step 9: Commit**

```bash
git add quote.html tests/quote-wizard.spec.ts
git commit -m "feat(quotes): gallery search and tag-ready rendering in the wizard"
```

---

## Task 6: Steps 4 and 5 — product tiles, item cards, dietary, design intent

Replace the modal picker with tiles, keep one card per product type (max 3), and add the dietary and design-intent questions. The `itemTypes` model changes from "a list of cards" to "a set of selected product types", which makes deselect unambiguous.

**Files:**
- Modify: `quote.html` (step-4 and step-5 panels, item-card machinery, submit payload)
- Test: `tests/quote-wizard.spec.ts`

**Interfaces:**
- Consumes: `wizard.productTypes`, `createItemCard`, `initCustomQtyToggles`, `removeItem`, `itemIcons`, `itemLabels`, `itemTypeTemplates`.
- Produces: `PRODUCT_TILES`, `toggleProduct(type)`, `updateProductTiles()`, `#dietary`, `input[name="wz_design_intent"]`, `#wz_design_note`. Removes `#add-item-btn`, `#item-type-picker`, `updateAddButtonVisibility`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/quote-wizard.spec.ts`:

```ts
test.describe('steps 4 and 5 · products and details', () => {
  async function gotoProduct(page: Page) {
    await mockApi(page);
    await openQuote(page);
    await page.click('.wz-tile[data-kind="occasion"][data-value="Birthday"]');
    await page.click('#wz-next');
    await page.fill('#servings', '20');
    await page.fill('#desired_date', '2099-06-01');
    await page.click('#wz-next');
    await page.click('#wz-next');
    await expect(page.locator('.wz-panel[data-step="product"]')).toBeVisible();
  }

  test('offers four product tiles and gates on at least one', async ({ page }) => {
    await gotoProduct(page);
    await expect(page.locator('.wz-tile[data-kind="product"]')).toHaveCount(4);
    await expect(page.locator('#wz-next')).toBeDisabled();
    await page.click('.wz-tile[data-kind="product"][data-value="cake"]');
    await expect(page.locator('#wz-next')).toBeEnabled();
  });

  test('two products produce two cards; the third is allowed; the fourth is blocked', async ({ page }) => {
    await gotoProduct(page);
    await page.click('.wz-tile[data-kind="product"][data-value="cake"]');
    await page.click('.wz-tile[data-kind="product"][data-value="cakepops"]');
    await page.click('.wz-tile[data-kind="product"][data-value="cupcakes"]');
    await expect(page.locator('.item-card')).toHaveCount(3);
    await expect(page.locator('.wz-tile[data-kind="product"][data-value="custom"]')).toBeDisabled();
    await expect(page.locator('.wz-tile[data-kind="product"][data-value="custom"]')).toHaveAttribute('aria-pressed', 'false');
  });

  test('deselecting a product removes its card and its typed values', async ({ page }) => {
    await gotoProduct(page);
    await page.click('.wz-tile[data-kind="product"][data-value="cake"]');
    await page.click('.wz-tile[data-kind="product"][data-value="cakepops"]');
    await page.click('#wz-next');
    await page.fill('.item-card[data-type="cake"] input[name="cake_flavor"]', 'Chocolate');
    await page.click('#wz-back');
    await page.click('.wz-tile[data-kind="product"][data-value="cake"]');
    await expect(page.locator('.item-card')).toHaveCount(1);
    await expect(page.locator('.item-card[data-type="cake"]')).toHaveCount(0);
  });

  test('step 5 gates until each card has its required fields', async ({ page }) => {
    await gotoProduct(page);
    await page.click('.wz-tile[data-kind="product"][data-value="cake"]');
    await page.click('#wz-next');
    await expect(page.locator('.wz-panel[data-step="details"]')).toBeVisible();
    await expect(page.locator('#wz-next')).toBeDisabled();
    await page.fill('.item-card[data-type="cake"] input[name="cake_flavor"]', 'Vanilla');
    await expect(page.locator('#wz-next')).toBeEnabled();
  });

  test('design intent reveals the note field only when customizing', async ({ page }) => {
    await gotoProduct(page);
    await page.click('.wz-tile[data-kind="product"][data-value="cake"]');
    await page.click('#wz-next');
    await page.fill('.item-card[data-type="cake"] input[name="cake_flavor"]', 'Vanilla');
    await expect(page.locator('#wz_design_note')).toBeHidden();
    await page.check('input[name="wz_design_intent"][value="customize"]');
    await expect(page.locator('#wz_design_note')).toBeVisible();
    await page.check('input[name="wz_design_intent"][value="match"]');
    await expect(page.locator('#wz_design_note')).toBeHidden();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test tests/quote-wizard.spec.ts -g "products and details"`
Expected: FAIL — the product tiles do not exist (the markup still has `#add-item-btn` and `#item-type-picker`).

- [ ] **Step 3: Replace the step-4 and step-5 panel bodies**

In `quote.html`, replace the step-4 panel's `<div class="wz-tile-grid" id="wz-product-tiles"></div>` line with:

```html
            <div class="wz-tile-grid" id="wz-product-tiles"></div>
            <p id="wz-product-count" class="form-help" style="margin-top: 0.9rem;"></p>
```

Then replace the step-5 panel's `<div id="items-container" class="space-y-6"></div>` line with:

```html
            <div id="items-container" class="space-y-6"></div>

            <div class="form-section" style="margin-top: 2rem;">
              <div class="form-group">
                <label for="dietary" class="form-label lang-fade" data-es="Restricciones alimentarias" data-en="Dietary needs">Dietary needs</label>
                <input type="text" id="dietary" name="dietary" class="form-input"
                       data-es-placeholder="ej. sin nueces, sin huevo, vegano"
                       data-en-placeholder="e.g. nut-free, eggless, vegan"
                       placeholder="e.g. nut-free, eggless, vegan">
              </div>

              <div class="form-group" style="margin-top: 1.2rem;">
                <span class="form-label lang-fade" data-es="¿Quieres cambios al diseño?" data-en="Any changes to the design?">Any changes to the design?</span>
                <label class="checkbox-label" style="display:flex; margin-top:0.4rem;">
                  <input type="radio" name="wz_design_intent" value="match" checked>
                  <span class="lang-fade" data-es="Cópialo lo más parecido posible" data-en="Match it as closely as possible">Match it as closely as possible</span>
                </label>
                <label class="checkbox-label" style="display:flex; margin-top:0.4rem;">
                  <input type="radio" name="wz_design_intent" value="customize">
                  <span class="lang-fade" data-es="Quiero cambiar algunas cosas" data-en="I'd like to change some things">I'd like to change some things</span>
                </label>
              </div>

              <div class="form-group" id="wz_design_note_group" style="margin-top: 1rem;" hidden>
                <label for="wz_design_note" class="form-label lang-fade" data-es="¿Qué te gustaría cambiar?" data-en="What would you like to change?">What would you like to change?</label>
                <textarea id="wz_design_note" name="wz_design_note" rows="3" class="form-input"
                          data-es-placeholder="ej. cambiar los pisos, quitar los juguetes, más flores"
                          data-en-placeholder="e.g. change the tiers, remove the toys, more flowers"
                          placeholder="e.g. change the tiers, remove the toys, more flowers"></textarea>
              </div>
            </div>
```

- [ ] **Step 4: Remove the modal picker markup**

In `quote.html`, delete the entire `<!-- Item Type Picker (hidden by default) -->` block — the `<div id="item-type-picker">` through its closing `</div>` (previously lines 442-463). It was already removed by Task 2's markup replacement; verify with `grep -c 'item-type-picker' quote.html` which must print `0`. If it prints more than 0, delete each remaining occurrence.

- [ ] **Step 5: Replace the add/remove machinery**

Task 2 left `removeItem` minimal and `updateAddButtonVisibility` as a no-op. Replace both with the `productTypes`-aware version. In `quote.html`, replace the `removeItem` function and the `updateAddButtonVisibility` stub from Task 2 Step 5 with:

```js
  function removeItem(itemId) {
    const card = document.querySelector(`[data-item-id="${itemId}"]`);
    if (!card) return;
    const type = card.dataset.type;
    const i = wizard.productTypes.indexOf(type);
    if (i >= 0) wizard.productTypes.splice(i, 1);
    card.remove();
    updateProductTiles();
    syncNav();
  }
```

`updateAddButtonVisibility` is now unreferenced — delete it entirely. Then add the product-tile machinery in its place:

```js
  const PRODUCT_TILES = [
    { value: 'cake', icon: '🎂', es: 'Pastel', en: 'Cake', descEs: 'Pasteles personalizados', descEn: 'Custom cakes' },
    { value: 'cakepops', icon: '🍭', es: 'Cakepops', en: 'Cakepops', descEs: 'Por docena', descEn: 'By the dozen' },
    { value: 'cupcakes', icon: '🧁', es: 'Pastelitos', en: 'Cupcakes', descEs: 'Por docena', descEn: 'By the dozen' },
    { value: 'custom', icon: '✨', es: 'Otra cosa', en: 'Something else', descEs: 'Galletas, flan y más', descEn: 'Cookies, flan and more' },
  ];

  function buildProductTiles() {
    const grid = document.getElementById('wz-product-tiles');
    if (!grid) return;
    const frag = document.createDocumentFragment();
    PRODUCT_TILES.forEach(t => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wz-tile';
      btn.dataset.kind = 'product';
      btn.dataset.value = t.value;
      btn.setAttribute('aria-pressed', 'false');

      const icon = document.createElement('span');
      icon.className = 'wz-tile-icon';
      icon.textContent = t.icon;
      icon.setAttribute('aria-hidden', 'true');

      const label = document.createElement('span');
      label.className = 'wz-tile-label lang-fade';
      label.setAttribute('data-es', t.es);
      label.setAttribute('data-en', t.en);
      label.textContent = t.en;

      const desc = document.createElement('span');
      desc.className = 'wz-tile-desc lang-fade';
      desc.setAttribute('data-es', t.descEs);
      desc.setAttribute('data-en', t.descEn);
      desc.textContent = t.descEn;

      btn.appendChild(icon);
      btn.appendChild(label);
      btn.appendChild(desc);
      btn.addEventListener('click', () => toggleProduct(t.value));
      frag.appendChild(btn);
    });
    grid.appendChild(frag);
  }

  function updateProductTiles() {
    const atCap = wizard.productTypes.length >= 3;
    document.querySelectorAll('.wz-tile[data-kind="product"]').forEach(tile => {
      const on = wizard.productTypes.includes(tile.dataset.value);
      tile.setAttribute('aria-pressed', on ? 'true' : 'false');
      tile.disabled = !on && atCap;
    });
    document.querySelectorAll('.item-card .remove-item-btn').forEach(btn => {
      btn.style.display = wizard.productTypes.length > 1 ? '' : 'none';
    });
    const count = document.getElementById('wz-product-count');
    if (count) {
      const n = wizard.productTypes.length;
      count.textContent = currentLang === 'es'
        ? `${n} de 3 productos elegidos`
        : `${n} of 3 products selected`;
    }
    syncNav();
  }

  function toggleProduct(type) {
    const idx = wizard.productTypes.indexOf(type);
    if (idx >= 0) {
      const card = document.querySelector(`.item-card[data-type="${type}"]`);
      if (card) removeItem(card.dataset.itemId);
      return;
    }
    if (wizard.productTypes.length >= 3) return;
    wizard.productTypes.push(type);
    const container = document.getElementById('items-container');
    container.appendChild(createItemCard(type));
    initCustomQtyToggles();
    updateProductTiles();
    applyLangToDOM(currentLang);
  }

  buildProductTiles();
  updateProductTiles();
```

`removeItem` looks up by `data-item-id`, so `toggleProduct` resolves the card's id first. Deselecting runs through `removeItem`, which is why that function is the one place `productTypes` and the DOM are kept in step.

- [ ] **Step 6: Wire the design-intent toggle**

In `quote.html`, inside the wizard block, add after `buildProductTiles(); updateProductTiles();`:

```js
  const designNoteGroup = document.getElementById('wz_design_note_group');
  document.querySelectorAll('input[name="wz_design_intent"]').forEach(radio => {
    radio.addEventListener('change', () => {
      designNoteGroup.hidden = document.querySelector('input[name="wz_design_intent"]:checked').value !== 'customize';
    });
  });
  designNoteGroup.hidden = true;
```

- [ ] **Step 7: Update `initializeQuoteForm` to use the tile model**

In `quote.html`, replace the body of `initializeQuoteForm` (currently lines 930-944) with:

```js
  function initializeQuoteForm() {
    const params = new URLSearchParams(window.location.search);
    const requestedType = params.get('type') || 'cake';
    // Guard: an unknown ?type= would crash createItemCard (itemLabels[type] is
    // undefined) and take down the whole init (no item card, gallery stuck).
    const type = itemTypeTemplates[requestedType] ? requestedType : 'cake';
    const inspirationId = params.get('inspiration');
    toggleProduct(type);
    applyLangToDOM(currentLang);
    loadInspirationGallery(inspirationId);
  }
```

This drops `initCustomQtyToggles()` (now called by `toggleProduct`) and `updateAddButtonVisibility()` (now `updateProductTiles()`).

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx playwright test tests/quote-wizard.spec.ts`
Expected: PASS (all tests through Task 6)

- [ ] **Step 9: Commit**

```bash
git add quote.html tests/quote-wizard.spec.ts
git commit -m "feat(quotes): product tiles, per-product details, dietary and design intent"
```

---

## Task 7: Step 6 — contact, and the submit payload

Wire the final payload: hoist the exact servings into the cake items and the quote, split the dietary text into the array the server expects, and fold the design intent into `comments`.

**Files:**
- Modify: `quote.html` (submit handler)
- Test: `tests/quote-wizard.spec.ts`

**Interfaces:**
- Consumes: `wizard.servings`, `#dietary`, `input[name="wz_design_intent"]`, `#wz_design_note`, `#comments`.
- Produces: a `POST /api/quotes` body containing `serving_size`, `dietary`, and a combined `comments`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/quote-wizard.spec.ts`:

```ts
test.describe('step 6 · submit payload', () => {
  async function fillToContact(page: Page) {
    await mockApi(page);
    await openQuote(page);
    await page.click('.wz-tile[data-kind="occasion"][data-value="Wedding"]');
    await page.click('#wz-next');
    await page.fill('#servings', '25');
    await page.fill('#desired_date', '2099-06-01');
    await page.fill('#budget', '$150-200');
    await page.click('#wz-next');
    await page.click('.inspiration-card[data-photo-id="g1"]');
    await page.click('#wz-next');
    await page.click('.wz-tile[data-kind="product"][data-value="cake"]');
    await page.click('#wz-next');
    await page.fill('.item-card[data-type="cake"] input[name="cake_flavor"]', 'Chocolate');
    await page.fill('#dietary', 'nut-free, eggless');
    await page.check('input[name="wz_design_intent"][value="customize"]');
    await page.fill('#wz_design_note', 'Add gold leaf');
    await page.click('#wz-next');
    await expect(page.locator('.wz-panel[data-step="contact"]')).toBeVisible();
  }

  test('Next becomes the submit action on the last step', async ({ page }) => {
    await fillToContact(page);
    await expect(page.locator('#wz-next')).toHaveText(/Submit Quote Request/);
  });

  test('posts servings, dietary and the combined comment', async ({ page }) => {
    let body: any = null;
    await page.route('**/api/quotes', async (route) => {
      if (route.request().method() !== 'POST') return route.fulfill({ status: 404, json: {} });
      body = JSON.parse(route.request().postData() || '{}');
      return route.fulfill({ status: 201, json: { ok: true, id: 1 } });
    });
    await fillToContact(page);
    await page.fill('#customer_name', 'Maria');
    await page.fill('#email', 'maria@example.test');
    await page.fill('#comments', 'Please deliver at noon');
    await page.click('#wz-next');

    await expect(page.locator('#form-success')).toBeVisible();
    expect(body.occasion).toBe('Wedding');
    expect(body.serving_size).toBe('25');
    expect(body.budget).toBe('$150-200');
    expect(body.desired_date).toBe('2099-06-01');
    expect(body.dietary).toEqual(['nut-free', 'eggless']);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].product_type).toBe('cake');
    expect(body.items[0].details.cake_flavor).toBe('Chocolate');
    expect(body.items[0].details.serving_size).toBe('25');
    expect(body.inspiration).toHaveLength(1);
    expect(body.inspiration[0].id).toBe('g1');
    expect(body.reference_image_url).toBeNull();
    expect(body.comments).toContain('Add gold leaf');
    expect(body.comments).toContain('Please deliver at noon');
    expect(body.quoted_price).toBeUndefined();
  });

  test('contact step gates until name and a valid email are present', async ({ page }) => {
    await fillToContact(page);
    await expect(page.locator('#wz-next')).toBeDisabled();
    await page.fill('#customer_name', 'Maria');
    await page.fill('#email', 'not-an-email');
    await expect(page.locator('#wz-next')).toBeDisabled();
    await page.fill('#email', 'maria@example.test');
    await expect(page.locator('#wz-next')).toBeEnabled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test tests/quote-wizard.spec.ts -g "step 6"`
Expected: FAIL — `body.serving_size` is `undefined`.

- [ ] **Step 3: Extend wizard state with the contact fields**

In `quote.html`, in the wizard block, add listeners so the contact gate re-evaluates as the customer types. Insert after the design-intent wiring from Task 6:

```js
  ['customer_name', 'email'].forEach(id => {
    document.getElementById(id).addEventListener('input', syncNav);
  });
```

- [ ] **Step 4: Hoist servings and build the final payload**

In `quote.html`, inside the submit handler, replace the items-collection block and the `fetch` body. Find the block that currently reads:

```js
    // Collect items
    const items = [];
    document.querySelectorAll('.item-card').forEach(card => {
      const type = card.dataset.type;
      const details = {};
      card.querySelectorAll('input, select, textarea').forEach(el => {
        if (el.name) {
          if (el.type === 'checkbox') {
            if (!details[el.name]) details[el.name] = [];
            if (el.checked) details[el.name].push(el.value);
          } else if (el.name === 'quantity' && el.value === 'custom') {
            const customInput = card.querySelector('input[name="custom_quantity"]');
            details.quantity = customInput ? customInput.value : '';
          } else if (el.name === 'custom_quantity') {
            // resolved into details.quantity above when quantity === 'custom'
          } else {
            details[el.name] = el.value;
          }
        }
      });
      items.push({ product_type: type, details });
    });
```

Replace it with:

```js
    // Collect items
    const items = [];
    document.querySelectorAll('.item-card').forEach(card => {
      const type = card.dataset.type;
      const details = {};
      card.querySelectorAll('input, select, textarea').forEach(el => {
        if (el.name) {
          if (el.type === 'checkbox') {
            if (!details[el.name]) details[el.name] = [];
            if (el.checked) details[el.name].push(el.value);
          } else if (el.name === 'quantity' && el.value === 'custom') {
            const customInput = card.querySelector('input[name="custom_quantity"]');
            details.quantity = customInput ? customInput.value : '';
          } else if (el.name === 'custom_quantity') {
            // resolved into details.quantity above when quantity === 'custom'
          } else {
            details[el.name] = el.value;
          }
        }
      });
      // Servings is a wizard-level question (step 2) so it is asked once and
      // stamped onto every cake in the request.
      if (type === 'cake' && wizard.servings) details.serving_size = wizard.servings;
      items.push({ product_type: type, details });
    });
```

Then, immediately after that block and before the `submitBtn.disabled = true;` line, insert the derived fields:

```js
    const dietary = document.getElementById('dietary').value
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const intent = (document.querySelector('input[name="wz_design_intent"]:checked') || {}).value;
    const designNote = document.getElementById('wz_design_note').value.trim();
    const designParts = [];
    if (intent === 'customize') {
      designParts.push(currentLang === 'es'
        ? `Cambios al diseño: ${designNote}`
        : `Design changes: ${designNote}`);
    }
    const customerComments = document.getElementById('comments').value.trim();
    if (customerComments) designParts.push(customerComments);
    const comments = designParts.filter(Boolean).join('\n\n');
```

- [ ] **Step 5: Send the new fields**

In `quote.html`, inside the same handler, replace the `body:` property of the `fetch` call with:

```js
        body: JSON.stringify({
          customer_name: customerName,
          email,
          phone: document.getElementById('phone').value.trim() || null,
          language: currentLang,
          occasion: document.getElementById('occasion').value || null,
          serving_size: wizard.servings || null,
          dietary,
          comments: comments || null,
          desired_date: document.getElementById('desired_date').value || null,
          budget: document.getElementById('budget').value.trim() || null,
          items,
          inspiration: selectedInspiration,
          reference_image_url: uploadedImageUrl || null,
        }),
```

- [ ] **Step 6: Hide the nav on success**

In `quote.html`, in the success branch of the submit handler, add this immediately after `formSuccess.style.display = 'block';`:

```js
        const nav = document.querySelector('.wz-nav');
        if (nav) nav.style.display = 'none';
        wzReason.hidden = true;
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx playwright test tests/quote-wizard.spec.ts -g "step 6"`
Expected: PASS (3 tests)

- [ ] **Step 8: Commit**

```bash
git add quote.html tests/quote-wizard.spec.ts
git commit -m "feat(quotes): wizard submit sends servings, dietary and combined comments"
```

---

## Task 8: Deep links

Make `?type=` and `?inspiration=` resolve into wizard state rather than a one-shot preselection, and pin the fallback for unknown values.

**Files:**
- Modify: `quote.html` (`initializeQuoteForm`, `loadInspirationGallery`)
- Test: `tests/quote-wizard.spec.ts`

**Interfaces:**
- Consumes: `toggleProduct`, `selectOccasion`, `loadInspirationGallery`.
- Produces: no new names; changes only how the existing seeds are applied.

- [ ] **Step 1: Write the failing tests**

Append to `tests/quote-wizard.spec.ts`:

```ts
test.describe('deep links', () => {
  test('?type=cakepops pre-selects the tile and its card', async ({ page }) => {
    await mockApi(page);
    await openQuote(page, '?type=cakepops');
    await expect(page.locator('.wz-tile[data-kind="product"][data-value="cakepops"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.item-card[data-type="cakepops"]')).toHaveCount(1);
  });

  test('an unknown ?type= falls back to cake without throwing', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await mockApi(page);
    await openQuote(page, '?type=lasagna');
    await expect(page.locator('.item-card[data-type="cake"]')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('?inspiration=<id> pre-selects that gallery card', async ({ page }) => {
    await mockApi(page);
    await openQuote(page, '?inspiration=g2');
    await expect(page.locator('.inspiration-card[data-photo-id="g2"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.inspiration-card[data-photo-id="g1"]')).toHaveAttribute('aria-pressed', 'false');
  });

  test('a wizard always opens on step 1 even with seeds', async ({ page }) => {
    await mockApi(page);
    await openQuote(page, '?type=cake&inspiration=g1');
    await expect(page.locator('.wz-panel[data-step="occasion"]')).toBeVisible();
    await expect(page.locator('#wz-progress')).toHaveAttribute('aria-valuenow', '10');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test tests/quote-wizard.spec.ts -g "deep links"`
Expected: FAIL — `?type=cakepops` is applied by `toggleProduct` already, so the first test may pass; the `?inspiration=` test fails because `loadInspirationGallery` scrolls the old section and the wizard is on step 1, leaving the card unselected only if the fetch raced. Confirm at least one failure, then proceed.

- [ ] **Step 3: Drop the dead scroll on inspiration preselection**

In `quote.html`, inside `loadInspirationGallery`, replace the preselection block:

```js
        if (match) {
          const card = Array.from(grid.querySelectorAll('.inspiration-card'))
            .find(c => c.dataset.photoId === String(match.id));
          if (card) {
            toggleInspiration(match, card);
            const section = document.getElementById('inspiration-section');
            if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
```

with:

```js
        if (match) {
          const card = Array.from(grid.querySelectorAll('.inspiration-card'))
            .find(c => c.dataset.photoId === String(match.id));
          if (card) toggleInspiration(match, card);
        }
```

The scroll is removed because the wizard owns navigation now and scrolling away from step 1 would strand the visitor below the fold.

- [ ] **Step 4: Re-run to confirm the deep links resolve against the filter**

Because `renderInspirationGrid` is now called through `applySearchFilter()`, verify preselection still finds its card. Run the tests from Step 1.

Run: `npx playwright test tests/quote-wizard.spec.ts -g "deep links"`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add quote.html tests/quote-wizard.spec.ts
git commit -m "feat(quotes): resolve type and inspiration deep links into wizard state"
```

---

## Task 9: `QuoteItemComposer` serving-size custom option

The wizard submits an exact count, but the owner's editor renders `serving_size` as a fixed-bucket `<select>`, so an exact count displays as unselected.

**Files:**
- Modify: `home-bakery-management-system/src/components/QuoteItemComposer.tsx:134`
- Test: `home-bakery-management-system/src/components/QuoteItemComposer.test.tsx` (create)

**Interfaces:**
- Consumes: `CAKE_SERVINGS` (new) and the existing `servingSize` state.
- Produces: a select that always contains the initial value as an option.

- [ ] **Step 1: Write the failing test**

Create `home-bakery-management-system/src/components/QuoteItemComposer.test.tsx`:

```tsx
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import QuoteItemComposer from "./QuoteItemComposer";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mountCake(servingSize: string) {
  act(() => {
    root.render(
      <QuoteItemComposer
        initial={{ product_type: "cake", details: { cake_flavor: "Chocolate", serving_size: servingSize } }}
        submitLabel="Save item"
        submitting={false}
        onSubmit={vi.fn()}
      />
    );
  });
}

// The composer's serving select carries no name attribute (and must not gain one —
// it is rendered inside QuoteModal's form), so find it by its bucket options.
function servingSelect(): HTMLSelectElement | null {
  return (
    Array.from(container.querySelectorAll<HTMLSelectElement>("select")).find((s) =>
      Array.from(s.options).some((o) => o.value === "20-30")
    ) ?? null
  );
}

describe("QuoteItemComposer serving size", () => {
  it("offers the bucket options for a stored bucket value", () => {
    mountCake("20-30");
    const select = servingSelect();
    expect(select).not.toBeNull();
    expect(select!.value).toBe("20-30");
  });

  it("renders an exact wizard count as selected instead of blank", () => {
    mountCake("25");
    const select = servingSelect();
    expect(select).not.toBeNull();
    expect(select!.value).toBe("25");
    expect(Array.from(select!.options).some((o) => o.value === "25")).toBe(true);
  });

  it("does not duplicate an option when the value is a bucket", () => {
    mountCake("10-12");
    const select = servingSelect();
    const tens = Array.from(select!.options).filter((o) => o.value === "10-12");
    expect(tens).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- QuoteItemComposer` in `home-bakery-management-system`
Expected: FAIL — the second case, "renders an exact wizard count as selected instead of blank", because `"25"` is not among the options.

- [ ] **Step 3: Add the constant and the conditional option**

In `home-bakery-management-system/src/components/QuoteItemComposer.tsx`, add this near the other option constants (around line 17, next to `CAKE_TOPPINGS`):

```tsx
const CAKE_SERVINGS = ["6-8", "10-12", "15-20", "20-30", "30+"];
```

Then replace the select block at line 134 with:

```tsx
          <select
            value={servingSize}
            onChange={(e) => setServingSize(e.target.value)}
            className={inputCls}
          >
            <option value="">Serving size…</option>
            {CAKE_SERVINGS.map((s) => (
              <option key={s} value={s}>{s} servings</option>
            ))}
            {/* The customer wizard collects an exact count (e.g. "25"); render it as
                a real option so it shows as selected instead of appearing blank. */}
            {servingSize && !CAKE_SERVINGS.includes(servingSize) && (
              <option value={servingSize}>{servingSize} servings</option>
            )}
          </select>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- QuoteItemComposer` in `home-bakery-management-system`
Expected: PASS (3 tests)

- [ ] **Step 5: Verify the whole frontend suite and typecheck**

Run: `npm test` then `npm run typecheck` in `home-bakery-management-system`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add home-bakery-management-system/src/components/QuoteItemComposer.tsx home-bakery-management-system/src/components/QuoteItemComposer.test.tsx
git commit -m "fix(quotes): show an exact serving count in the item composer"
```

---

## Task 10: Bilingual, reduced-motion, and overflow polish

Final pass: prove both languages render every step, prove no horizontal overflow at four widths, and prove reduced motion does not break navigation.

**Files:**
- Modify: `quote.html` (only if a test fails)
- Test: `tests/quote-wizard.spec.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: no new names.

- [ ] **Step 1: Write the failing tests**

Append to `tests/quote-wizard.spec.ts`:

```ts
test.describe('bilingual, motion and layout', () => {
  test('every step heading renders in Spanish and English', async ({ page }) => {
    await mockApi(page);
    await openQuote(page);
    const heads = [
      ['occasion', '¿Qué vamos a celebrar?'],
      ['event', '¿Cuándo y para cuántos?'],
      ['design', 'Elige un diseño'],
      ['product', '¿Qué vamos a hacer?'],
      ['details', 'Cuéntanos los detalles'],
      ['contact', 'Casi listo'],
    ] as const;

    for (const [step, es] of heads) {
      await page.evaluate((s) => (window as any).__wz.show(s), step);
      await expect(page.locator(`.wz-panel[data-step="${step}"] .wz-heading`)).toContainText(es);
    }

    await page.evaluate(() => (window as any).__wz.setLang('en'));
    await page.evaluate(() => (window as any).__wz.show('occasion'));
    await expect(page.locator('.wz-panel[data-step="occasion"] .wz-heading')).toContainText('What are we celebrating?');
  });

  test('no horizontal overflow at any width', async ({ page }) => {
    await mockApi(page);
    for (const width of [1024, 861, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await openQuote(page, '?type=cake');
      for (const step of ['occasion', 'event', 'design', 'product', 'details', 'contact']) {
        await page.evaluate((s) => (window as any).__wz.show(s), step);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `overflow at ${width}px on ${step}`).toBeLessThanOrEqual(0);
      }
    }
  });

  test('reduced motion still navigates every step', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await mockApi(page);
    await openQuote(page);
    await page.click('.wz-tile[data-kind="occasion"][data-value="Birthday"]');
    await page.click('#wz-next');
    await expect(page.locator('.wz-panel[data-step="event"]')).toBeVisible();
    const anim = await page.evaluate(
      () => getComputedStyle(document.querySelector('.wz-panel[data-step="event"]')!).animationName,
    );
    expect(anim).toBe('none');
    await ctx.close();
  });

  test('focus lands on the step heading after advancing', async ({ page }) => {
    await mockApi(page);
    await openQuote(page);
    await page.click('.wz-tile[data-kind="occasion"][data-value="Birthday"]');
    await page.click('#wz-next');
    const focused = await page.evaluate(() => document.activeElement?.id || '');
    expect(focused).toBe('wz-h-event');
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx playwright test tests/quote-wizard.spec.ts -g "bilingual, motion and layout"`
Expected: the ES/EN test fails with `show is not defined` because `show` is script-local.

- [ ] **Step 3: Expose the wizard hooks for testing**

In `quote.html`, add this just before the `DOMContentLoaded` listener at the end of the script:

```js
  // Test seam: Playwright drives step changes that would otherwise need a full
  // click path. Namespaced so it cannot collide with a global named "show".
  window.__wz = { show, setLang };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx playwright test tests/quote-wizard.spec.ts -g "bilingual, motion and layout"`
Expected: PASS (4 tests)

- [ ] **Step 5: Fix any overflow the test reports**

If Step 4 fails on overflow, the cause is almost always the sticky `.wz-nav` or the `auto-fit` grid at 320px. Apply the narrowest fix: for the grid, `.wz-tile-grid { grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); }` inside a `@media (max-width: 400px)` block; for the nav, it already stacks at 640px, so check that `.wz-nav .btn { width: 100%; }` is present. Re-run until it passes.

- [ ] **Step 6: Run the full suite**

Run: `npx playwright test`
Expected: PASS (all suites including `cta-band.spec.ts`).

- [ ] **Step 7: Commit**

```bash
git add quote.html tests/quote-wizard.spec.ts
git commit -m "test(quotes): bilingual, reduced-motion and overflow coverage for the wizard"
```

---

## Self-Review

**1. Spec coverage**

| Spec requirement | Task |
|---|---|
| 6 gated steps with progress bar | 2 |
| Occasion tiles, exact `QuoteModal` strings | 3 |
| Servings as a first-class exact number | 4, 7 |
| Design gallery + upload as one step | 5 |
| Product type first, then details | 6 |
| Dietary and design intent with defined homes | 6, 7 |
| Tag-ready gallery contract, no client change later | 5 |
| Back is lossless, cards never rebuilt | 2 (panels only toggle `hidden`), 6 (cards persist across step changes) |
| Deep links `?type=` / `?inspiration=` | 8 |
| No `?step=`, no draft persistence | 2 (never written), 8 (test asserts step 1 always) |
| Exact servings break the owner's select | 9 |
| Bilingual, a11y, reduced motion, overflow | 2, 10 |
| No pricing in the wizard | 7 (test asserts `quoted_price` is `undefined`) |
| No backend change | Global Constraints; no task touches the worker |
| `custom` product type needs 3 additions or it crashes | 1 |

**2. Placeholder scan**

No `TBD`, `TODO`, or "implement later". Every code step contains the code. Task 6 Step 4 uses a `grep` verification instead of a pasted deletion because Task 2's markup replacement already removed the block — the instruction says to verify and delete any remainder, which is deterministic.

**3. Type and name consistency**

- `wizard` gains exactly one field per task: `productTypes` (Task 2), `servings` (Task 4). No task reads a field before it exists.
- `show(stepId)`, `syncNav()`, `updateProgress()`, `toggleProduct(type)`, `updateProductTiles()`, `photoTags(ph)`, `normalizeSearch(s)`, `matchesSearch(ph, needle)`, `renderInspirationGrid(photos, needle)`, `applySearchFilter()` are each defined once and used with the same arity everywhere afterward.
- `removeItem(itemId)` keeps its existing single-argument signature; `toggleProduct` resolves the card's `data-item-id` before calling it.
- `submitBtn` is rewired to `#wz-next` in Task 2 and never looked up again.
- The interface contract table lists every hook the tests use, and each is created in the task that first needs it.

**4. Known limitation, deliberate**

A quote with two cakes gets the same `serving_size` on both, because servings is a quote-level question (spec, Data mapping). One cake per product type, max 3. Both follow from "Product type first, then details" and are recorded here rather than discovered later.
