import { expect, test } from '@playwright/test';
import { trackBrowserErrors } from './helpers';

test('article route smoke', async ({ page }) => {
  const errors = trackBrowserErrors(page);

  await page.goto('/getting-started');

  await expect(page.locator('[data-pagefind-body]')).toBeVisible();
  await expect(page.locator('main h1')).toContainText('Length³');
  await expect(page.locator('.toc')).toHaveAttribute('aria-label', 'Table of Contents');
  await expect(page.locator('#copy-link-btn')).toBeVisible();
  await expect(page.locator('#share-btn')).toBeVisible();
  expect(errors).toEqual([]);
});

test('reading progress stays pinned to the viewport and toc remains visible while scrolling', async ({
  page,
}) => {
  const errors = trackBrowserErrors(page);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/getting-started');

  const progress = page.locator('#reading-progress');
  const toc = page.locator('.toc');

  await expect(toc).toBeVisible();

  const initial = await progress.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return {
      left: rect.left,
      position: style.position,
      top: rect.top,
    };
  });

  expect(initial.position).toBe('fixed');
  expect(Math.abs(initial.top)).toBeLessThan(1);
  expect(Math.abs(initial.left)).toBeLessThan(1);

  await page.evaluate(() => {
    window.scrollTo(0, Math.round(document.body.scrollHeight * 0.5));
  });
  await page.waitForFunction(
    () =>
      Number(document.getElementById('reading-progress')?.getAttribute('aria-valuenow') ?? 0) > 0,
  );

  const midScroll = await progress.evaluate((element) => ({
    ariaValueNow: Number(element.getAttribute('aria-valuenow') ?? 0),
    top: element.getBoundingClientRect().top,
  }));

  expect(midScroll.ariaValueNow).toBeGreaterThan(0);
  expect(Math.abs(midScroll.top)).toBeLessThan(1);

  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });

  await expect(toc).toBeVisible();

  const endTop = await progress.evaluate((element) => element.getBoundingClientRect().top);
  expect(Math.abs(endTop)).toBeLessThan(1);
  expect(errors).toEqual([]);
});

test('every code block carries a copy control that reports back', async ({ page, context }) => {
  const errors = trackBrowserErrors(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  await page.goto('/pagefind-japanese');

  const blocks = page.locator('.prose .code-block');
  await expect(blocks.first()).toBeVisible();
  await expect(page.locator('.prose .code-copy')).toHaveCount(await blocks.count());

  // pre は横スクロールするので、ボタンは pre の中ではなく包みの中にいる。
  await expect(page.locator('.prose pre .code-copy')).toHaveCount(0);

  const first = blocks.first();
  await first.scrollIntoViewIfNeeded();
  const button = first.locator('.code-copy');
  await expect(button).toHaveAttribute('aria-label', 'コードをクリップボードにコピー');

  await button.click();
  await expect(button).toHaveAttribute('aria-label', 'コピーしました');

  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const source = (await first.locator('pre').innerText()).trim();
  expect(copied.trim()).toBe(source);

  expect(errors).toEqual([]);
});
