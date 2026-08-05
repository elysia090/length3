import { expect, test } from '@playwright/test';
import { trackBrowserErrors } from './helpers';

test('index route smoke', async ({ page }) => {
  const errors = trackBrowserErrors(page);

  await page.goto('/');

  await expect(page.locator('.article-list')).toBeVisible();
  await expect(page.locator('.article-card').first()).toBeVisible();
  await expect(page.locator('.index-sidebar')).toBeVisible();
  await expect(page.locator('.header-nav')).toHaveAttribute('aria-label', 'primary');
  await page.locator('[data-search-trigger]').click();
  await expect(
    page.locator(
      '[data-pagefind-ui] .pagefind-ui__search-input, [data-pagefind-ui] .search-unavailable',
    ),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('topic list shows the top topics and hides the tail behind a disclosure', async ({ page }) => {
  const errors = trackBrowserErrors(page);

  await page.goto('/');

  const alwaysVisible = page.locator(
    '.topic-list-items:not(.topic-list-items--rest) .topic-list-item',
  );
  await expect(alwaysVisible).toHaveCount(6);

  const rest = page.locator('.topic-list-items--rest');
  await expect(rest).toBeHidden();

  const toggle = page.locator('.topic-list-toggle');
  await expect(toggle).toContainText('more');

  await toggle.click();
  await expect(rest).toBeVisible();
  await expect(toggle).toContainText('Show less');

  await toggle.click();
  await expect(rest).toBeHidden();
  expect(errors).toEqual([]);
});

test('the article list collapses and grows four at a time', async ({ page }) => {
  const errors = trackBrowserErrors(page);

  await page.goto('/');

  const visible = page.locator('.article-card:not([hidden])');
  const total = await page.locator('.article-card').count();
  const initial = Math.min(total, 5);

  await expect(visible).toHaveCount(initial);

  // 末尾の 1 件は「続きがある」ことを示すためだけに出ている。
  await expect(page.locator('.article-card[data-teaser]')).toHaveCount(total > initial ? 1 : 0);

  const more = page.locator('.list-more-btn');

  if (total > initial) {
    await expect(more).toBeVisible();
    await expect(more).toHaveAttribute('aria-label', /Show \d+ more articles?/);

    await more.click();
    await expect(visible).toHaveCount(Math.min(total, initial + 4));
    await expect(page.locator('[data-article-reveal-status]')).toContainText('more article');
  }

  // 全部出たら出口は消え、最後の 1 件は薄れも解ける。
  await expect(page.locator('[data-article-reveal]')).toBeHidden();
  await expect(page.locator('.article-card[data-teaser]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
