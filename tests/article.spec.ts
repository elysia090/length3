import { test, expect } from '@playwright/test';

test('article page renders prose content', async ({ page }) => {
  await page.goto('/');
  const firstLink = page.locator('.article-card h2 a').first();
  const href = await firstLink.getAttribute('href');
  await page.goto(href!);
  await expect(page.locator('[data-pagefind-body]')).toBeVisible();
});

test('article page has table of contents', async ({ page }) => {
  await page.goto('/');
  const firstLink = page.locator('.article-card h2 a').first();
  const href = await firstLink.getAttribute('href');
  await page.goto(href!);
  await expect(page.locator('.toc')).toBeVisible();
});

test('article page has reading progress bar', async ({ page }) => {
  await page.goto('/');
  const firstLink = page.locator('.article-card h2 a').first();
  const href = await firstLink.getAttribute('href');
  await page.goto(href!);
  await expect(page.locator('#reading-progress')).toBeVisible();
});

test('editor page loads', async ({ page }) => {
  await page.goto('/editor');
  await expect(page.locator('.editor-layout')).toBeVisible();
});
