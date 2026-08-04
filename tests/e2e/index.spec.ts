import { expect, test } from '@playwright/test';
import { trackBrowserErrors } from './helpers';

test('index route smoke', async ({ page }) => {
  const errors = trackBrowserErrors(page);

  await page.goto('/');

  await expect(page.locator('.article-list')).toBeVisible();
  await expect(page.locator('.article-card').first()).toBeVisible();
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.header-nav')).toHaveAttribute('aria-label', 'primary');
  await page.locator('[data-search-trigger]').click();
  await expect(
    page.locator(
      '[data-pagefind-ui] .pagefind-ui__search-input, [data-pagefind-ui] .search-unavailable',
    ),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('sidebar shows the top topics and hides the tail behind a disclosure', async ({ page }) => {
  const errors = trackBrowserErrors(page);

  await page.goto('/');

  const alwaysVisible = page.locator(
    '.sidebar-topic-list:not(.sidebar-topic-list--rest) .sidebar-topic-card',
  );
  await expect(alwaysVisible).toHaveCount(6);

  const rest = page.locator('.sidebar-topic-list--rest');
  await expect(rest).toBeHidden();

  const toggle = page.locator('.sidebar-topics-toggle');
  await expect(toggle).toContainText('more');

  await toggle.click();
  await expect(rest).toBeVisible();
  await expect(toggle).toContainText('Show less');

  await toggle.click();
  await expect(rest).toBeHidden();
  expect(errors).toEqual([]);
});
