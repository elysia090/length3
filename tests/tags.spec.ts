import { expect, test } from '@playwright/test';
import { countH1, goToFirstTagDetail } from './helpers';

test.describe('Tag detail page', () => {
  test.beforeEach(async ({ page }) => {
    await goToFirstTagDetail(page);
  });

  test('has a single h1 with the tag name', async ({ page }) => {
    expect(await countH1(page)).toBe(1);
    await expect(page.locator('main h1')).toBeVisible();
  });

  test('shows article count below h1', async ({ page }) => {
    await expect(page.locator('.tag-count')).toContainText('article');
  });

  test('lists at least one article card', async ({ page }) => {
    await expect(page.locator('.article-card').first()).toBeVisible();
  });

  test('breadcrumb is present', async ({ page }) => {
    const breadcrumb = page.locator('.breadcrumb');
    await expect(breadcrumb).toBeVisible();
    await expect(breadcrumb).toContainText('Length³');
  });

  test('article card titles link to articles', async ({ page }) => {
    const href = await page.locator('.article-card h2 a').first().getAttribute('href');
    expect(href).toMatch(/^\//);
  });

  test('header is present', async ({ page }) => {
    await expect(page.locator('.site-header')).toBeVisible();
  });

  test('footer is present', async ({ page }) => {
    await expect(page.locator('footer')).toBeVisible();
  });
});
