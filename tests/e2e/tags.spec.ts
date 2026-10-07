import { expect, test } from '@playwright/test';
import { trackBrowserErrors } from './helpers';

test('tag route smoke', async ({ page }) => {
  const errors = trackBrowserErrors(page);

  await page.goto('/tags/typescript-js');

  await expect(page.locator('main h1')).toHaveText('#TypeScript / JS');
  await expect(page.locator('.tag-count')).toContainText('article');
  await expect(page.locator('.article-card').first()).toBeVisible();
  await expect(page.locator('.breadcrumb')).toContainText('Length³');
  expect(errors).toEqual([]);
});

test('unknown routes dig in the void', async ({ page }) => {
  await page.goto('/no-such-reel');
  await expect(page.locator('main h1')).toHaveText('Nothing to dig here');
  await expect(page.locator('a[href="/#index"]').first()).toBeVisible();
});
