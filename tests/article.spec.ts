import { expect, test } from '@playwright/test';
import { trackBrowserErrors } from './helpers';

test('article route smoke', async ({ page }) => {
  const errors = trackBrowserErrors(page);

  await page.goto('/getting-started');

  await expect(page.locator('[data-pagefind-body]')).toBeVisible();
  await expect(page.locator('main h1')).toContainText('length3');
  await expect(page.locator('.toc')).toHaveAttribute('aria-label', 'Table of Contents');
  await expect(page.locator('#copy-link-btn')).toBeVisible();
  await expect(page.locator('#share-btn')).toBeVisible();
  await expect(page.locator('#min-left')).not.toHaveText('—');
  expect(errors).toEqual([]);
});
