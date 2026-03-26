/**
 * Screenshot tests — documentation screenshots saved to docs/screenshots/.
 *
 * This spec runs only in the `screenshots` Playwright project:
 *   pnpm screenshots
 *
 * It is excluded from the default `chromium` project so that regular
 * `pnpm test` runs do not regenerate screenshots on every invocation.
 *
 * Each test asserts that key content is visible before capturing, so a broken
 * page cannot produce a silently-passing screenshot.
 *
 * These captures are documentation assets, not visual regression baselines.
 * Long-form article pages intentionally use viewport screenshots instead of
 * full-page output so the resulting images stay legible in docs.
 */
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { gotoWithFonts } from './helpers/fonts';

const OUT = path.resolve('docs/screenshots');

test('index', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoWithFonts(page, '/');
  await expect(page.locator('.article-list')).toBeVisible();
  await page.screenshot({ path: `${OUT}/index.png`, fullPage: true });
});

test('getting-started', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoWithFonts(page, '/getting-started');
  await expect(page.locator('.prose')).toBeVisible();
  await page.screenshot({ path: `${OUT}/getting-started.png` });
});

test('japanese-test', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoWithFonts(page, '/japanese-test');
  await expect(page.locator('.prose')).toBeVisible();
  await page.screenshot({ path: `${OUT}/japanese-test.png` });
});
