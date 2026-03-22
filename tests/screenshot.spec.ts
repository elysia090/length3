import path from 'node:path';
import { test } from '@playwright/test';

const OUT = path.resolve('docs/screenshots');

/**
 * Navigate to a URL with fonts guaranteed to render.
 *
 * font-display:optional has a ~100 ms block period followed by zero swap
 * period, so in a cold headless browser the font never renders — the fallback
 * is chosen permanently.  We bypass this by:
 *
 * 1. Navigating to the page (domcontentloaded so we don't hang on Google Fonts)
 * 2. Programmatically constructing FontFace objects and adding them to
 *    document.fonts — this bypasses font-display restrictions entirely
 * 3. Forcing a style recalculation so the browser re-renders text with the
 *    newly available faces
 *
 * Noto Sans JP is loaded from Google Fonts; we wait up to 3 s but never stall
 * CI when the network is unavailable.
 */
async function gotoWithFonts(page: import('@playwright/test').Page, url: string) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    // Load self-hosted Fraunces programmatically, bypassing font-display:optional.
    const faces = [
      new FontFace('Fraunces', 'url(/fonts/Fraunces-Variable.woff2)', {
        weight: '100 900',
        style: 'normal',
      }),
      new FontFace('Fraunces', 'url(/fonts/Fraunces-Italic-Variable.woff2)', {
        weight: '100 900',
        style: 'italic',
      }),
    ];
    await Promise.all(
      faces.map(async (ff) => {
        await ff.load();
        document.fonts.add(ff);
      }),
    );
    // Wait for Google Fonts (Noto Sans JP) with a cap so CI never stalls.
    await Promise.race([
      document.fonts.ready,
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ]);
    // Force a style recalculation so text re-renders with the loaded fonts.
    document.body.style.visibility = 'hidden';
    document.body.offsetHeight; // trigger reflow
    document.body.style.visibility = '';
  });
}

test('index', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoWithFonts(page, '/');
  await page.screenshot({ path: `${OUT}/index.png`, fullPage: true });
});

test('article', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoWithFonts(page, '/getting-started');
  await page.screenshot({ path: `${OUT}/article.png`, fullPage: true });
});

test('tags', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoWithFonts(page, '/tags');
  await page.screenshot({ path: `${OUT}/tags.png`, fullPage: true });
});

test('editor', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoWithFonts(page, '/editor');
  await page.screenshot({ path: `${OUT}/editor.png`, fullPage: true });
});

test('editor-mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoWithFonts(page, '/editor');
  await page.screenshot({ path: `${OUT}/editor-mobile.png`, fullPage: true });
});

test('japanese-article', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoWithFonts(page, '/japanese-test');
  await page.screenshot({ path: `${OUT}/japanese-article.png`, fullPage: true });
});
