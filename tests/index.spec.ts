import { test, expect } from '@playwright/test';

test('index page loads with article list', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.article-card').first()).toBeVisible();
});

test('index page has site header', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.site-header')).toBeVisible();
});

test('index page has sidebar', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.sidebar')).toBeVisible();
});

test('search trigger is present', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#search-trigger')).toBeVisible();
});

test('tags page is accessible from header', async ({ page }) => {
  await page.goto('/');
  await page.click('a[href="/tags"]');
  await expect(page).toHaveURL('/tags');
});
