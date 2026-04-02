import type { Page } from '@playwright/test';
import { FRAUNCES_ITALIC_WOFF2, FRAUNCES_WOFF2 } from '../../../src/config/fonts';

/**
 * Navigate to a URL and ensure fonts render correctly in headless Chrome.
 *
 * font-display:optional has a ~100 ms block period with no swap period, so a
 * cold headless browser never loads the custom font — the fallback is chosen
 * permanently.  We bypass this by:
 *
 *   1. Navigating to the page at domcontentloaded so external font requests do
 *      not hold the screenshot flow hostage
 *   2. Constructing FontFace objects programmatically, bypassing font-display
 *   3. Forcing a style recalculation so text re-renders with the loaded fonts
 *
 * Font paths come from src/config/fonts.ts — single source of truth.
 * Japanese glyph coverage comes from the Nix shell's installed Noto CJK fonts,
 * so the helper only needs to force Fraunces to load before capture.
 */
export async function gotoWithFonts(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    async ({ woff2, italicWoff2 }: { woff2: string; italicWoff2: string }) => {
      const faces = [
        new FontFace('Fraunces', `url(${woff2})`, { weight: '100 900', style: 'normal' }),
        new FontFace('Fraunces', `url(${italicWoff2})`, { weight: '100 900', style: 'italic' }),
      ];
      await Promise.all(
        faces.map(async (ff) => {
          await ff.load();
          document.fonts.add(ff);
        }),
      );
      await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      // Force a style recalculation so text re-renders with the loaded fonts.
      document.body.style.visibility = 'hidden';
      void document.body.offsetHeight; // trigger reflow
      document.body.style.visibility = '';
    },
    { woff2: FRAUNCES_WOFF2, italicWoff2: FRAUNCES_ITALIC_WOFF2 },
  );
}
