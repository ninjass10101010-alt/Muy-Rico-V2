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
    // Assert existence and structure, not on-screen visibility: from Task 2 onward
    // this card lives inside the hidden "details" step panel, so a visibility
    // assertion would fail for a reason unrelated to what this test proves.
    await expect(card).toHaveCount(1);
    await expect(card.locator('input[name="name"]')).toHaveCount(1);
    await expect(card.locator('input[name="name"]')).toHaveAttribute('required', '');
  });
});

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

  test('progress marks the current step on load', async ({ page }) => {
    await mockApi(page);
    await openQuote(page);
    // updateProgress() marks every segment up to and including the current step,
    // so step 1 on load means exactly one segment is done.
    await expect(page.locator('.wz-progress-seg.done')).toHaveCount(1);
  });
});

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

  test('advancing to step 2 marks two progress segments done', async ({ page }) => {
    await mockApi(page);
    await openQuote(page);
    await expect(page.locator('.wz-progress-seg.done')).toHaveCount(1);
    await page.click('.wz-tile[data-kind="occasion"][data-value="Birthday"]');
    await page.click('#wz-next');
    await expect(page.locator('.wz-panel[data-step="event"]')).toBeVisible();
    await expect(page.locator('.wz-progress-seg.done')).toHaveCount(2);
    await expect(page.locator('#wz-progress')).toHaveAttribute('aria-valuenow', '30');
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

  test('a failed upload shows the inline error while still on the design step', async ({ page }) => {
    await mockApi(page, { uploadStatus: 500 });
    await openQuote(page);
    await page.click('.wz-tile[data-kind="occasion"][data-value="Birthday"]');
    await page.click('#wz-next');
    await page.fill('#servings', '20');
    await page.fill('#desired_date', '2099-06-01');
    await page.click('#wz-next');
    await expect(page.locator('.wz-panel[data-step="design"]')).toBeVisible();

    await page.setInputFiles('#reference_image', {
      name: 'cake.png',
      mimeType: 'image/png',
      buffer: Buffer.from('89504e470d0a1a0a', 'hex'),
    });

    // #form-error lives outside the panels (next to the nav) precisely so this
    // message is visible on the step that produced it, not stranded until step 6.
    await expect(page.locator('#form-error')).toBeVisible();
    await expect(page.locator('#form-error')).not.toBeEmpty();
  });

  test('advancing clears a stale error from the previous step', async ({ page }) => {
    await mockApi(page, { uploadStatus: 500 });
    await openQuote(page);
    await page.click('.wz-tile[data-kind="occasion"][data-value="Birthday"]');
    await page.click('#wz-next');
    await page.fill('#servings', '20');
    await page.fill('#desired_date', '2099-06-01');
    await page.click('#wz-next');
    await page.setInputFiles('#reference_image', {
      name: 'cake.png',
      mimeType: 'image/png',
      buffer: Buffer.from('89504e470d0a1a0a', 'hex'),
    });
    await expect(page.locator('#form-error')).toBeVisible();
    await page.click('#wz-next');
    await expect(page.locator('.wz-panel[data-step="product"]')).toBeVisible();
    await expect(page.locator('#form-error')).toBeHidden();
  });

  test('a selected card keeps its selected state through a filter round-trip', async ({ page }) => {
    await gotoDesign(page);
    await page.click('.inspiration-card[data-photo-id="g1"]');
    await expect(page.locator('.inspiration-card[data-photo-id="g1"]')).toHaveAttribute('aria-pressed', 'true');
    await page.fill('#wz-search', 'sesame');
    await expect(page.locator('.inspiration-card[data-photo-id="g1"]')).toHaveCount(0);
    await page.fill('#wz-search', '');
    await expect(page.locator('.inspiration-card[data-photo-id="g1"]')).toHaveCount(1);
    await expect(page.locator('.inspiration-card[data-photo-id="g1"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#inspiration-count')).toContainText('1');
  });

  test('the no-results empty state appears and clears', async ({ page }) => {
    await gotoDesign(page);
    await page.fill('#wz-search', 'zzzz');
    await expect(page.locator('.inspiration-card')).toHaveCount(0);
    await expect(page.locator('.gallery-empty')).toContainText('No designs matched');
    await page.fill('#wz-search', '');
    await expect(page.locator('.inspiration-card')).toHaveCount(2);
    await expect(page.locator('.gallery-empty')).toHaveCount(0);
  });
});
