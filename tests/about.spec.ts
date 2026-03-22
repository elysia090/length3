import { expect, test } from '@playwright/test';
import { countH1, getComputedStyleProp, getCSSVarAsRgb } from './helpers';

test.describe('About page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/about');
  });

  // ── Layout ───────────────────────────────────────────────────────
  test.describe('Layout', () => {
    test('has exactly one h1 reading "About"', async ({ page }) => {
      expect(await countH1(page)).toBe(1);
      await expect(page.locator('h1')).toHaveText('About');
    });

    test('main content is visible', async ({ page }) => {
      await expect(page.locator('.about-main')).toBeVisible();
    });

    test('prose body is visible', async ({ page }) => {
      await expect(page.locator('.about-body.prose')).toBeVisible();
    });

    test('amber rule is present below the heading', async ({ page }) => {
      await expect(page.locator('.amber-rule.about-rule')).toBeAttached();
    });
  });

  // ── Navigation ───────────────────────────────────────────────────
  test.describe('Navigation', () => {
    test('site header is present', async ({ page }) => {
      await expect(page.locator('.site-header')).toBeVisible();
    });

    test('footer is present', async ({ page }) => {
      await expect(page.locator('footer')).toBeVisible();
    });

    test('primary nav has aria-label="primary"', async ({ page }) => {
      await expect(page.locator('nav[aria-label="primary"]')).toBeVisible();
    });
  });

  // ── Accessibility ────────────────────────────────────────────────
  test.describe('Accessibility', () => {
    test('page title contains "About"', async ({ page }) => {
      await expect(page).toHaveTitle(/About/);
    });

    test('main landmark has id="main-content" for skip-link target', async ({ page }) => {
      await expect(page.locator('main#main-content')).toBeAttached();
    });
  });

  // ── Design tokens ────────────────────────────────────────────────
  test.describe('Design tokens', () => {
    test('amber rule uses --amber background color', async ({ page }) => {
      const amberRgb = await getCSSVarAsRgb(page, '--amber');
      const bg = await getComputedStyleProp(page, '.amber-rule', 'background-color');
      expect(bg).toBe(amberRgb);
    });
  });
});
