/**
 * Screenshot tests — documentation screenshots saved to docs/screenshots/.
 *
 * This spec runs only in the `screenshots` Playwright project:
 *   pnpm screenshots
 *
 * It is excluded from the default `chromium` project so that regular
 * `pnpm test` runs do not regenerate screenshots on every invocation.
 *
 * Each test asserts that key content is visible before capturing,
 * so a broken page cannot produce a silently-passing screenshot.
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
  await page.screenshot({ path: `${OUT}/getting-started.png`, fullPage: true });
});

test('tags', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoWithFonts(page, '/tags');
  await expect(page.locator('.tag-grid')).toBeVisible();
  await page.screenshot({ path: `${OUT}/tags.png`, fullPage: true });
});

test('editor', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoWithFonts(page, '/editor');
  await expect(page.locator('.editor-root')).toBeVisible();
  await page.screenshot({ path: `${OUT}/editor.png`, fullPage: true });
});

test('editor-mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoWithFonts(page, '/editor');
  await expect(page.locator('.editor-root')).toBeVisible();
  await page.screenshot({ path: `${OUT}/editor-mobile.png`, fullPage: true });
});

test('japanese-test', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoWithFonts(page, '/japanese-test');
  await expect(page.locator('.prose')).toBeVisible();
  await page.screenshot({ path: `${OUT}/japanese-test.png`, fullPage: true });
});
