import { test } from '@playwright/test';
import path from 'node:path';

const OUT = path.resolve('docs/screenshots');

test('index', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.screenshot({ path: `${OUT}/index.png`, fullPage: true });
});

test('article', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/getting-started');
  await page.screenshot({ path: `${OUT}/article.png`, fullPage: true });
});

test('tags', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/tags');
  await page.screenshot({ path: `${OUT}/tags.png`, fullPage: true });
});

test('editor', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/editor');
  await page.screenshot({ path: `${OUT}/editor.png`, fullPage: true });
});

test('editor-mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/editor');
  await page.screenshot({ path: `${OUT}/editor-mobile.png`, fullPage: true });
});
