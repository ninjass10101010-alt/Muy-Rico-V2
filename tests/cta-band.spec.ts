import { test, expect, type Page } from '@playwright/test';

const WORKER = 'http://localhost:8787';

const MOCK_SLIDES = [
  {
    id: 'sld_test1',
    title: 'Conchas',
    title_es: 'Conchas',
    description: 'Vanilla and chocolate',
    description_es: 'Vainilla y chocolate',
    image_url: '/menu-conchas.webp',
    active: true,
    display_order: 0,
  },
  {
    id: 'sld_test2',
    title: 'Bolillos',
    title_es: 'Bolillos',
    description: 'Crusty rolls',
    description_es: 'Pan crujiente',
    image_url: '/menu-bolillos.webp',
    active: true,
    display_order: 1,
  },
];

async function mockSlideshow(page: Page, slides: unknown[] | 'error') {
  await page.route('**/api/slideshow', (route) => {
    if (slides === 'error') return route.abort();
    return route.fulfill({ json: { slides } });
  });
}

async function openBand(page: Page) {
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.locator('.cta-band').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
}

test.describe('CTA band slideshow', () => {
  test('static fallback when API is down: no slides, no dots, no overflow', async ({ page }) => {
    await mockSlideshow(page, 'error');
    await openBand(page);
    await expect(page.locator('.cta-slide')).toHaveCount(0);
    await expect(page.locator('#cta-band-dots')).toHaveCount(0);
    await expect(page.locator('#cta-band-frame .frame-img')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('hydration renders slides, dots, caption; autoplay advances', async ({ page }) => {
    await mockSlideshow(page, MOCK_SLIDES);
    await openBand(page);
    await expect(page.locator('.cta-slide')).toHaveCount(2);
    await expect(page.locator('.cta-dot')).toHaveCount(2);
    await expect(page.locator('.cta-slide').first()).toHaveClass(/is-active/);
    await expect(page.locator('#cta-band-caption')).toContainText('Conchas');
    await expect(page.locator('#cta-band-caption')).toContainText('Vanilla and chocolate');
    // autoplay: after ~5.5s the second slide should be active
    await page.waitForTimeout(5600);
    await expect(page.locator('.cta-slide').nth(1)).toHaveClass(/is-active/);
    await expect(page.locator('.cta-dot').nth(1)).toHaveAttribute('aria-current', 'true');
  });

  test('dot click jumps and updates aria-current', async ({ page }) => {
    await mockSlideshow(page, MOCK_SLIDES);
    await openBand(page);
    await page.locator('.cta-dot').nth(1).click();
    await expect(page.locator('.cta-slide').nth(1)).toHaveClass(/is-active/);
    await expect(page.locator('#cta-band-caption')).toContainText('Crusty rolls');
  });

  test('hover pauses autoplay', async ({ page }) => {
    await mockSlideshow(page, MOCK_SLIDES);
    await openBand(page);
    await page.locator('.cta-band-photo').hover();
    await page.waitForTimeout(5600);
    await expect(page.locator('.cta-slide').first()).toHaveClass(/is-active/);
  });

  test('ES language swap renders ES caption', async ({ page }) => {
    await mockSlideshow(page, MOCK_SLIDES);
    await openBand(page);
    await page.evaluate(() => setLang('es'));
    await expect(page.locator('#cta-band-caption')).toContainText('Vainilla y chocolate');
  });

  test('reduced motion: no autoplay, manual dots still work', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await mockSlideshow(page, MOCK_SLIDES);
    await openBand(page);
    await page.waitForTimeout(5600);
    await expect(page.locator('.cta-slide').first()).toHaveClass(/is-active/);
    await page.locator('.cta-dot').nth(1).click();
    await expect(page.locator('.cta-slide').nth(1)).toHaveClass(/is-active/);
    await ctx.close();
  });

  test('no overflow at tablet and mobile widths', async ({ page }) => {
    await mockSlideshow(page, MOCK_SLIDES);
    for (const width of [1024, 861, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await openBand(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    }
  });

  test('slide well is positioned and clipped inside the frame', async ({ page }) => {
    await mockSlideshow(page, MOCK_SLIDES);
    await openBand(page);
    const well = await page.evaluate(() => {
      const el = document.querySelector('#cta-band-frame .slide-well');
      if (!el) return null;
      const s = getComputedStyle(el);
      return { position: s.position, overflow: s.overflow, radius: s.borderRadius };
    });
    expect(well).not.toBeNull();
    expect(well!.position).toBe('relative');
    expect(well!.overflow).toBe('hidden');
  });
});
