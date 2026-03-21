import { expect, test } from '@playwright/test';

test.describe('Tags index page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tags');
  });

  test('has a single h1 reading "Tags"', async ({ page }) => {
    // Use page.evaluate to avoid piercing Astro dev toolbar Shadow DOM
    const h1Count = await page.evaluate(() => document.querySelectorAll('h1').length);
    expect(h1Count).toBe(1);
    await expect(page.locator('h1')).toContainText('Tags');
  });

  test('renders tag badges', async ({ page }) => {
    await expect(page.locator('.tag-badge').first()).toBeVisible();
  });

  test('tag counts are shown next to each badge', async ({ page }) => {
    await expect(page.locator('.count').first()).toContainText('(');
  });

  test('tag links navigate to tag detail page', async ({ page }) => {
    const href = await page.locator('.tag-badge').first().getAttribute('href');
    expect(href).toMatch(/^\/tags\//);
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
    // Navigate via the tags index to get a real tag slug
    await page.goto('/tags');
    const tagHref = (await page.locator('.tag-badge').first().getAttribute('href')) ?? '/tags/meta';
    await page.goto(tagHref);
  });

  test('has a single h1 with the tag name', async ({ page }) => {
    // Use page.evaluate to avoid piercing Astro dev toolbar Shadow DOM
    const h1Count = await page.evaluate(() => document.querySelectorAll('h1').length);
    expect(h1Count).toBe(1);
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
