import path from 'node:path';
import { test } from '@playwright/test';

const OUT = path.resolve('docs/screenshots');

test('index', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.screenshot({ path: `${OUT}/index.png`, fullPage: true });
});

test('article', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/getting-started', { waitUntil: 'domcontentloaded' });
  await page.screenshot({ path: `${OUT}/article.png`, fullPage: true });
});

test('tags', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/tags', { waitUntil: 'domcontentloaded' });
  await page.screenshot({ path: `${OUT}/tags.png`, fullPage: true });
});

test('editor', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/editor', { waitUntil: 'domcontentloaded' });
  await page.screenshot({ path: `${OUT}/editor.png`, fullPage: true });
});

test('editor-mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/editor', { waitUntil: 'domcontentloaded' });
  await page.screenshot({ path: `${OUT}/editor-mobile.png`, fullPage: true });
});

test('japanese-article', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/japanese-test', { waitUntil: 'domcontentloaded' });
  await page.screenshot({ path: `${OUT}/japanese-article.png`, fullPage: true });
});
