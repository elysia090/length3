import { expect, test } from '@playwright/test';
import { trackBrowserErrors } from './helpers';

test('about route smoke', async ({ page }) => {
  const errors = trackBrowserErrors(page);

  await page.goto('/about');

  await expect(page.locator('main#main-content')).toBeVisible();
  await expect(page.locator('main h1')).toHaveText('About');
  await expect(page.locator('.site-header')).toBeVisible();
  await expect(page.locator('footer')).toBeVisible();

  // ページの中身は一段落と絵の二つしかない。絵は 1 ビットの網点で刷る。
  const plate = page.getByRole('img', { name: /Creation of Adam/ });
  await expect(plate).toBeVisible();
  await expect
    .poll(() => plate.locator('canvas').evaluate((el: HTMLCanvasElement) => el.width))
    .toBeGreaterThan(0);

  expect(errors).toEqual([]);
});
