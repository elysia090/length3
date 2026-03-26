import { expect, test } from '@playwright/test';
import { countH1, goToFirstTagDetail } from './helpers';

test.describe('Tags index page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tags');
  });

  test('has a single h1 reading "Tags"', async ({ page }) => {
    expect(await countH1(page)).toBe(1);
    await expect(page.locator('main h1')).toContainText('Tags');
  });

  test('renders tag cards', async ({ page }) => {
    await expect(page.locator('.tag-card').first()).toBeVisible();
  });

  test('tag counts are shown inside each card', async ({ page }) => {
    await expect(page.locator('.tag-count').first()).toBeVisible();
  });

  test('clicking a tag card opens a tag detail page', async ({ page }) => {
    const firstTag = page.locator('.tag-card').first();
    const href = await firstTag.getAttribute('href');
    expect(href).toBeTruthy();

    await firstTag.click();
    await expect(page).toHaveURL(/\/tags\/[^/]+$/);
    await expect(page.locator('main h1')).toBeVisible();
  });

  test('header is present', async ({ page }) => {
    await expect(page.locator('.site-header')).toBeVisible();
  });

  test('footer is present', async ({ page }) => {
    await expect(page.locator('footer')).toBeVisible();
  });
});

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

  test('breadcrumb is present with Tags link', async ({ page }) => {
    const breadcrumb = page.locator('.breadcrumb');
    await expect(breadcrumb).toBeVisible();
    await expect(breadcrumb).toContainText('Tags');
  });

  test('breadcrumb Tags link points to /tags', async ({ page }) => {
    const href = await page
      .locator('.breadcrumb a')
      .filter({ hasText: 'Tags' })
      .getAttribute('href');
    expect(href).toBe('/tags');
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
