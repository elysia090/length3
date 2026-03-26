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
