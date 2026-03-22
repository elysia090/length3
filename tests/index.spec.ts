import { expect, test } from '@playwright/test';
import { getComputedStyleProp, getCSSVar, getCSSVarAsRgb } from './helpers';

test.describe('Index page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  // ── Layout ──────────────────────────────────────────────────────
  test.describe('Layout', () => {
    test('article list is visible', async ({ page }) => {
      await expect(page.locator('.article-list')).toBeVisible();
    });

    test('at least one article card is present', async ({ page }) => {
      await expect(page.locator('.article-card').first()).toBeVisible();
    });

    test('sidebar is visible on wide viewport', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('/');
      await expect(page.locator('.sidebar')).toBeVisible();
    });

    test('sidebar disappears below 840px — spec §1', async ({ page }) => {
      await page.setViewportSize({ width: 820, height: 900 });
      await page.goto('/');
      await expect(page.locator('.index-sidebar')).toBeHidden();
    });

    test('no vertical rotate label in DOM — spec §9 exclusion', async ({ page }) => {
      await expect(page.locator('.index-rotate-label')).not.toBeAttached();
    });

    test('sidebar contains search only — no stats, no tags — spec §1', async ({ page }) => {
      await expect(page.locator('.sidebar .stats-grid')).not.toBeAttached();
      await expect(page.locator('.sidebar .tag-list')).not.toBeAttached();
      await expect(page.locator('#search-trigger')).toBeVisible();
    });
  });

  // ── Header — spec §4 ────────────────────────────────────────────
  test.describe('Header', () => {
    test('header is visible', async ({ page }) => {
      await expect(page.locator('.site-header')).toBeVisible();
    });

    test('header position is static — not sticky — spec §4', async ({ page }) => {
      const position = await getComputedStyleProp(page, '.site-header', 'position');
      expect(position).toBe('static');
    });

    test('nav has aria-label="primary" — spec §6', async ({ page }) => {
      await expect(page.locator('.header-nav')).toHaveAttribute('aria-label', 'primary');
    });

    test('nav has three links: Articles, Tags, About — spec §4', async ({ page }) => {
      const links = page.locator('.header-nav a');
      await expect(links).toHaveCount(3);
      await expect(links.nth(0)).toContainText('Articles');
      await expect(links.nth(1)).toContainText('Tags');
      await expect(links.nth(2)).toContainText('About');
    });

    test('logo superscript is amber — spec §4', async ({ page }) => {
      const amberRgb = await getCSSVarAsRgb(page, '--amber');
      const color = await getComputedStyleProp(page, '.site-title-sup', 'color');
      expect(color).toBe(amberRgb);
      await expect(page.locator('.site-title-sup')).toBeVisible();
    });

    test('nav link hover has no text-decoration — spec §4', async ({ page }) => {
      const link = page.locator('.header-nav a').first();
      await link.hover();
      const decoration = await link.evaluate((el) => getComputedStyle(el).textDecorationLine);
      expect(decoration).toBe('none');
    });
  });

  // ── Article Card — spec §4 ───────────────────────────────────────
  test.describe('Article card', () => {
    test('date column is 80px — spec §4', async ({ page }) => {
      const width = await page
        .locator('.card-date')
        .first()
        .evaluate((el) => (el as HTMLElement).offsetWidth);
      expect(width).toBe(80);
    });

    test('card date has letter-spacing — spec §4', async ({ page }) => {
      const ls = await getComputedStyleProp(page, '.card-date', 'letter-spacing');
      // 0.04em at 12px = 0.48px
      expect(Number.parseFloat(ls)).toBeGreaterThan(0);
    });

    test('card tags use amber color — spec §4', async ({ page }) => {
      // Assert the element exists first — prevents silent pass when no tags are rendered
      await expect(page.locator('.card-tag').first()).toBeAttached();
      const amberRgb = await getCSSVarAsRgb(page, '--amber-text');
      const color = await getComputedStyleProp(page, '.card-tag', 'color');
      expect(color).toBe(amberRgb);
    });

    test('card title is Fraunces (display font) — spec §2', async ({ page }) => {
      const ff = await getComputedStyleProp(page, '.card-title', 'font-family');
      expect(ff.toLowerCase()).toContain('fraunces');
    });

    test('card title links to article', async ({ page }) => {
      const link = page.locator('.article-card h2 a').first();
      const href = await link.getAttribute('href');
      expect(href).toBeTruthy();
      expect(href).toMatch(/^\//);
    });

    test('reading time shows "N min" format — spec §4', async ({ page }) => {
      await expect(page.locator('.card-reading-time').first()).toContainText('min');
    });

    test('first card has no top padding — spec §4', async ({ page }) => {
      const pt = await page
        .locator('.article-card')
        .first()
        .evaluate((el) => getComputedStyle(el).paddingTop);
      expect(pt).toBe('0px');
    });

    test('last card has no bottom border — spec §4', async ({ page }) => {
      const border = await page
        .locator('.article-card')
        .last()
        .evaluate((el) => getComputedStyle(el).borderBottomWidth);
      expect(border).toBe('0px');
    });
  });

  // ── Search modal — spec §4 ───────────────────────────────────────
  test.describe('Search modal', () => {
    test('search trigger button is present', async ({ page }) => {
      await expect(page.locator('#search-trigger')).toBeVisible();
    });

    test('modal is hidden by default', async ({ page }) => {
      await expect(page.locator('#search-modal')).toBeHidden();
    });

    test('modal opens on trigger button click', async ({ page }) => {
      await page.locator('#search-trigger').click();
      await expect(page.locator('#search-modal')).toBeVisible();
    });

    test('modal opens on "/" keypress — spec §4', async ({ page }) => {
      await page.locator('body').click(); // ensure no input is focused
      await page.keyboard.press('/');
      await expect(page.locator('#search-modal')).toBeVisible();
    });

    test('modal closes on Escape key — spec §4', async ({ page }) => {
      await page.locator('#search-trigger').click();
      await expect(page.locator('#search-modal')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('#search-modal')).toBeHidden();
    });

    test('modal closes on overlay click', async ({ page }) => {
      await page.locator('#search-trigger').click();
      await expect(page.locator('#search-modal')).toBeVisible();
      await page.locator('#search-modal').click({ position: { x: 5, y: 5 } });
      await expect(page.locator('#search-modal')).toBeHidden();
    });

    test('focus returns to trigger after close — spec §6', async ({ page }) => {
      await page.locator('#search-trigger').click();
      await page.keyboard.press('Escape');
      const focused = await page.evaluate(() => document.activeElement?.id);
      expect(focused).toBe('search-trigger');
    });

    test('focus is trapped inside modal while open — spec §6', async ({ page }) => {
      await page.locator('#search-trigger').click();
      await expect(page.locator('#search-modal')).toBeVisible();

      const focusableCount = await page.evaluate(() => {
        const modal = document.getElementById('search-modal');
        return (
          modal?.querySelectorAll('button, input, [href], [tabindex]:not([tabindex="-1"])')
            .length ?? 0
        );
      });
      expect(focusableCount).toBeGreaterThan(0);

      for (let i = 0; i <= focusableCount + 1; i++) {
        await page.keyboard.press('Tab');
      }

      const focusedInsideModal = await page.evaluate(() => {
        const modal = document.getElementById('search-modal');
        return modal?.contains(document.activeElement) ?? false;
      });
      expect(focusedInsideModal).toBe(true);
    });

    test('modal has no backdrop-filter blur — spec §4', async ({ page }) => {
      await page.locator('#search-trigger').click();
      await expect(page.locator('#search-modal')).toBeVisible();
      const backdropFilter = await getComputedStyleProp(page, '#search-modal', 'backdrop-filter');
      // 'none' is the expected value; '' would indicate the element was not found (silent-pass guard)
      expect(backdropFilter).toBe('none');
    });

    test('search card is 560px wide — spec §4', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('/');
      await page.locator('#search-trigger').click();
      const width = await page
        .locator('.search-card')
        .evaluate((el) => (el as HTMLElement).offsetWidth);
      expect(width).toBe(560);
    });

    test('search card border-radius is 6px — spec §4', async ({ page }) => {
      await page.locator('#search-trigger').click();
      const br = await getComputedStyleProp(page, '.search-card', 'border-radius');
      expect(br).toBe('6px');
    });

    test('search input uses display font (Fraunces) — spec §4', async ({ page }) => {
      await page.locator('#search-trigger').click();
      const ff = await getComputedStyleProp(page, '.search-field', 'font-family');
      expect(ff.toLowerCase()).toContain('fraunces');
    });

    test('search input has aria-label — spec §6', async ({ page }) => {
      await page.locator('#search-trigger').click();
      const label = await page.locator('#pagefind-input').getAttribute('aria-label');
      expect(label).toBeTruthy();
    });
  });

  // ── Design tokens — spec §3 ──────────────────────────────────────
  test.describe('Design tokens', () => {
    test('--bg is #f9f8f5 — spec §3', async ({ page }) => {
      expect(await getCSSVar(page, '--bg')).toBe('#f9f8f5');
    });

    test('--amber is #d4820a — spec §3', async ({ page }) => {
      expect(await getCSSVar(page, '--amber')).toBe('#d4820a');
    });

    test('--rule is #dedad5 — spec §3', async ({ page }) => {
      expect(await getCSSVar(page, '--rule')).toBe('#dedad5');
    });

    test('--ink is #1c1a18 — spec §3', async ({ page }) => {
      expect(await getCSSVar(page, '--ink')).toBe('#1c1a18');
    });

    test('focus outline is 2px amber — spec §6', async ({ page }) => {
      const amberRgb = await getCSSVarAsRgb(page, '--amber-text');
      await page.keyboard.press('Tab');
      const outline = await page.evaluate(() =>
        document.activeElement ? getComputedStyle(document.activeElement).outlineColor : '',
      );
      expect(outline).toBe(amberRgb);
    });
  });
});
