import { expect, test } from '@playwright/test';
import { trackBrowserErrors } from './helpers';

test('about route smoke', async ({ page }) => {
  const errors = trackBrowserErrors(page);

  await page.goto('/about');

  await expect(page.locator('main#main-content')).toBeVisible();
  await expect(page.locator('main h1')).toHaveText('About');
  await expect(page.locator('.site-header')).toBeVisible();
  await expect(page.locator('footer')).toBeVisible();

  // ページの中身は一段落と石の二つしかない。石は 1 ビットの絵で、押すと整列する。
  const canvas = page.locator('.about-figure canvas');
  await expect(canvas).toBeVisible();
  expect(await canvas.evaluate((el: HTMLCanvasElement) => el.width)).toBeGreaterThan(0);
  const touch = page.getByRole('button', { name: /monolith/i });
  await expect(touch).toBeVisible();
  await touch.click();

  expect(errors).toEqual([]);
});
