import { expect, test } from '@playwright/test';
import { countH1 } from './helpers';

test.describe('About page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/about');
  });

  test('has a single h1 reading "About"', async ({ page }) => {
    expect(await countH1(page)).toBe(1);
    await expect(page.locator('h1')).toHaveText('About');
  });

  test('main content is visible', async ({ page }) => {
    await expect(page.locator('.about-main')).toBeVisible();
    await expect(page.locator('.about-body.prose')).toBeVisible();
  });

  test('primary navigation is present', async ({ page }) => {
    await expect(page.locator('nav[aria-label="primary"]')).toBeVisible();
  });

  test('footer is present', async ({ page }) => {
    await expect(page.locator('footer')).toBeVisible();
  });

  test('main landmark is exposed for the skip link target', async ({ page }) => {
    await expect(page.locator('main#main-content')).toBeAttached();
  });
});
