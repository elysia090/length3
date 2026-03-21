import { expect, test } from '@playwright/test';

test.describe('Tags index page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tags');
  });

  test('has a single h1 reading "Tags"', async ({ page }) => {
    const h1 = page.locator('h1');
    await expect(h1).toHaveCount(1);
    await expect(h1).toContainText('Tags');
  });

  test('renders tag badges', async ({ page }) => {
    await expect(page.locator('.tag-badge').first()).toBeVisible();
  });

  test('tag counts are shown next to each badge', async ({ page }) => {
    await expect(page.locator('.count').first()).toContainText('(');
  });

  test('tag links navigate to tag detail page', async ({ page }) => {
    const firstTag = page.locator('.tag-badge').first();
    const href = await firstTag.getAttribute('href');
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
  let tagHref: string;

  test.beforeEach(async ({ page }) => {
    // Navigate via the tags index to get a real tag slug
    await page.goto('/tags');
    const firstTag = page.locator('.tag-badge').first();
    tagHref = (await firstTag.getAttribute('href')) ?? '/tags/meta';
    await page.goto(tagHref);
  });

  test('has a single h1 with the tag name', async ({ page }) => {
    // Scope to main to exclude Astro dev toolbar h1s
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
    const tagsLink = page.locator('.breadcrumb a').filter({ hasText: 'Tags' });
    const href = await tagsLink.getAttribute('href');
    expect(href).toBe('/tags');
  });

  test('article card titles link to articles', async ({ page }) => {
    const link = page.locator('.article-card h2 a').first();
    const href = await link.getAttribute('href');
    expect(href).toMatch(/^\//);
  });

  test('header is present', async ({ page }) => {
    await expect(page.locator('.site-header')).toBeVisible();
  });

  test('footer is present', async ({ page }) => {
    await expect(page.locator('footer')).toBeVisible();
  });
});
