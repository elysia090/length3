import { expect, test } from '@playwright/test';
import { trackBrowserErrors } from './helpers';

test('index route smoke', async ({ page }) => {
  const errors = trackBrowserErrors(page);

  await page.goto('/');

  await expect(page.locator('.article-list')).toBeVisible();
  await expect(page.locator('.article-card').first()).toBeVisible();
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.header-nav')).toHaveAttribute('aria-label', 'primary');
  await page.locator('#search-trigger').click();
  await expect(
    page.locator('#pagefind-ui .pagefind-ui__search-input, #pagefind-ui .search-unavailable'),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('search modal handles an empty query state without browser errors', async ({ page }) => {
  const errors = trackBrowserErrors(page);

  await page.goto('/');
  await page.locator('#search-trigger').click();
  await expect(
    page.locator('#pagefind-ui .pagefind-ui__search-input, #pagefind-ui .search-unavailable'),
  ).toBeVisible();

  const unavailable = page.locator('#pagefind-ui .search-unavailable');
  if (await unavailable.count()) {
    await expect(unavailable).toBeVisible();
    expect(errors).toEqual([]);
    return;
  }

  const input = page.locator('#pagefind-ui .pagefind-ui__search-input');
  await input.fill('zzzz-length3-no-match');
  await expect(page.locator('#search-empty-state')).toBeVisible();
  await expect(page.locator('#search-status')).toContainText('No matching articles');
  expect(errors).toEqual([]);
});
