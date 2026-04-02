import { expect, test } from '@playwright/test';
import { trackBrowserErrors } from './helpers';

test('about route smoke', async ({ page }) => {
  const errors = trackBrowserErrors(page);

  await page.goto('/about');

  await expect(page.locator('main#main-content')).toBeVisible();
  await expect(page.locator('main h1')).toHaveText('About');
  await expect(page.locator('.site-header')).toBeVisible();
  await expect(page.locator('footer')).toBeVisible();
  expect(errors).toEqual([]);
});
