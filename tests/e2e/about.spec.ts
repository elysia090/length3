import { expect, test } from '@playwright/test';
import { trackBrowserErrors } from './helpers';

test('about route smoke', async ({ page }) => {
  const errors = trackBrowserErrors(page);

  await page.goto('/about');

  await expect(page.locator('main#main-content')).toBeVisible();
  await expect(page.locator('main h1')).toHaveText('About');
  await expect(page.locator('.site-header')).toBeVisible();
  await expect(page.locator('footer')).toBeVisible();

  // ページの中身は一段落と石の二つしかない。石が落ちたら About は空になる。
  const monolith = page.locator('.about-figure img');
  await expect(monolith).toBeVisible();
  await expect(monolith).toHaveJSProperty('complete', true);
  expect(await monolith.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});
