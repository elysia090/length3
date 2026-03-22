import type { Page } from '@playwright/test';

/**
 * Navigate to a URL and ensure fonts render correctly in headless Chrome.
 *
 * font-display:optional has a ~100 ms block period with no swap period, so a
 * cold headless browser never loads the custom font — the fallback is chosen
 * permanently.  We bypass this by:
 *
 *   1. Navigating to the page (domcontentloaded — avoids hanging on Google Fonts)
 *   2. Constructing FontFace objects programmatically, bypassing font-display
 *   3. Forcing a style recalculation so text re-renders with the loaded fonts
 *
 * The Fraunces URLs below must stay in sync with the @font-face declarations
 * in src/styles/fonts.css and the <link rel="preload"> in BaseLayout.astro.
 * Noto Sans JP comes from Google Fonts (loaded async in BaseLayout); we wait
 * up to 3 s for it but never stall CI when the network is unavailable.
 */
export async function gotoWithFonts(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
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
