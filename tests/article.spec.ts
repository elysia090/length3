import { expect, test } from '@playwright/test';
import { getCSSVarAsRgb, getComputedStyleProp, goToFirstArticle } from './helpers';

test.describe('Article page', () => {
  test.beforeEach(async ({ page }) => {
    await goToFirstArticle(page);
  });

  // ── Layout — spec §1 ────────────────────────────────────────────
  test.describe('Layout', () => {
    test('prose content is rendered', async ({ page }) => {
      await expect(page.locator('[data-pagefind-body]')).toBeVisible();
    });

    test('reading progress bar is mounted in DOM', async ({ page }) => {
      await expect(page.locator('#reading-progress')).toBeAttached();
    });

    test('TOC is visible', async ({ page }) => {
      await expect(page.locator('.toc')).toBeVisible();
    });

    test('article has exactly one h1 — spec §6', async ({ page }) => {
      // page.locator('h1') pierces open Shadow DOM (Astro dev toolbar has h1s
      // inside its shadow root). Use page.evaluate to count only document h1s.
      const h1Count = await page.evaluate(() => document.querySelectorAll('h1').length);
      expect(h1Count).toBe(1);
    });

    test('right column has no interactive content — spec §1', async ({ page }) => {
      // The spec says right column is "deliberately empty". Verify no actions-aside
      // alongside the prose (it should be at end of prose, not in a separate column)
      await expect(page.locator('.actions-aside')).not.toBeAttached();
      // Article actions exist, but are inside prose-area (not a sidebar)
      await expect(page.locator('.prose-area .article-actions')).toBeAttached();
    });
  });

  // ── TOC — spec §4 ───────────────────────────────────────────────
  test.describe('Table of Contents', () => {
    test('TOC nav has aria-label="Table of Contents" — spec §6', async ({ page }) => {
      await expect(page.locator('.toc')).toHaveAttribute('aria-label', 'Table of Contents');
    });

    test('TOC links point to headings with # anchors', async ({ page }) => {
      // Assert the first link exists before reading its attribute — prevents silent pass
      const firstLink = page.locator('.toc-link').first();
      await expect(firstLink).toBeAttached();
      const href = await firstLink.getAttribute('href');
      expect(href).toMatch(/^#/);
    });

    test('TOC has border-left: 2px solid transparent on inactive links — spec §4', async ({
      page,
    }) => {
      const borderWidth = await getComputedStyleProp(page, '.toc-link', 'border-left-width');
      expect(borderWidth).toBe('2px');
    });

    test('TOC active link gets amber border and color — spec §4', async ({ page }) => {
      const firstLink = page.locator('.toc-link').first();
      await expect(firstLink).toBeAttached();
      // Disable the 80ms CSS transition so the class change is instant and
      // getComputedStyle reads the final value (not a mid-transition frame).
      // IntersectionObserver timing is non-deterministic in headless browsers;
      // the JS activation behaviour is covered by the scroll-navigation test.
      await page.addStyleTag({ content: '.toc-link { transition: none !important; }' });
      await firstLink.evaluate((el) => el.classList.add('active'));
      const amberRgb = await getCSSVarAsRgb(page, '--amber');
      const color = await getComputedStyleProp(page, '.toc-link.active', 'color');
      expect(color).toBe(amberRgb);
      const borderColor = await getComputedStyleProp(page, '.toc-link.active', 'border-left-color');
      expect(borderColor).toBe(amberRgb);
    });

    test('H3 TOC items have margin-left: 12px — spec §4', async ({ page }) => {
      // getting-started has an H3 heading ("### Tooling"); navigate there explicitly
      await page.goto('/getting-started');
      const h3Item = page.locator('.toc-depth-3').first();
      await expect(h3Item).toBeAttached();
      const ml = await getComputedStyleProp(page, '.toc-depth-3', 'margin-left');
      expect(ml).toBe('12px');
    });

    test('clicking TOC link navigates to heading (smooth scroll)', async ({ page }) => {
      const firstLink = page.locator('.toc-link').first();
      await expect(firstLink).toBeAttached();
      const href = await firstLink.getAttribute('href');
      expect(href).toMatch(/^#/);

      await firstLink.click();
      // Poll until the URL hash matches — avoids a fixed timeout for smooth scroll
      await page.waitForFunction(
        (expected) => decodeURIComponent(window.location.hash) === expected,
        href,
      );
      const hash = await page.evaluate(() => decodeURIComponent(window.location.hash));
      expect(hash).toBe(href);
    });

    test('headings have scroll-margin-top: 32px — spec §5', async ({ page }) => {
      const smt = await getComputedStyleProp(page, 'h2[id]', 'scroll-margin-top');
      expect(smt).toBe('32px');
    });
  });

  // ── Reading progress — spec §5 ───────────────────────────────────
  test.describe('Reading progress bar', () => {
    test('progress bar starts at 0% width', async ({ page }) => {
      const width = await page.evaluate(() => {
        const bar = document.getElementById('reading-progress');
        return bar ? getComputedStyle(bar).width : '';
      });
      expect(width).toBe('0px');
    });

    test('progress bar width increases on scroll', async ({ page }) => {
      await page.evaluate(() => window.scrollBy(0, 500));
      // Poll until --progress is set, rather than sleeping for a fixed duration
      const progress = await page.waitForFunction(() => {
        const bar = document.getElementById('reading-progress');
        return bar ? Number.parseFloat(bar.style.getPropertyValue('--progress')) : 0;
      });
      expect(await progress.jsonValue()).toBeGreaterThan(0);
    });

    test('progress bar is amber colored', async ({ page }) => {
      const amberRgb = await getCSSVarAsRgb(page, '--amber');
      const color = await getComputedStyleProp(page, '#reading-progress', 'background-color');
      expect(color).toBe(amberRgb);
    });

    test('progress bar is 2px tall', async ({ page }) => {
      const height = await getComputedStyleProp(page, '#reading-progress', 'height');
      expect(height).toBe('2px');
    });
  });

  // ── Typography — spec §2 ─────────────────────────────────────────
  test.describe('Typography', () => {
    test('article h1 uses Fraunces — spec §2', async ({ page }) => {
      const ff = await getComputedStyleProp(page, '.prose h1', 'font-family');
      expect(ff.toLowerCase()).toContain('fraunces');
    });

    test('article h2 uses Fraunces — spec §2', async ({ page }) => {
      const ff = await getComputedStyleProp(page, '.prose h2', 'font-family');
      expect(ff.toLowerCase()).toContain('fraunces');
    });

    test('body prose font-size is 16px — spec §2', async ({ page }) => {
      const fs = await getComputedStyleProp(page, '.prose', 'font-size');
      expect(fs).toBe('16px');
    });

    test('body prose line-height is 1.95 (approx 31.2px at 16px base) — spec §2', async ({
      page,
    }) => {
      const lh = await getComputedStyleProp(page, '.prose', 'line-height');
      // 1.95 x 16 = 31.2px
      expect(Number.parseFloat(lh)).toBeCloseTo(31.2, 0);
    });

    test('code blocks use light background — spec §4', async ({ page }) => {
      const bg2Rgb = await getCSSVarAsRgb(page, '--bg-2');
      const bgColor = await getComputedStyleProp(page, '.prose pre', 'background-color');
      expect(bgColor).toBe(bg2Rgb);
    });

    test('code blocks have amber-lt left border — spec §4', async ({ page }) => {
      const amberLtRgb = await getCSSVarAsRgb(page, '--amber-lt');
      const borderColor = await getComputedStyleProp(page, '.prose pre', 'border-left-color');
      expect(borderColor).toBe(amberLtRgb);
    });

    test('code block left border is 2px — spec §4', async ({ page }) => {
      const bw = await getComputedStyleProp(page, '.prose pre', 'border-left-width');
      expect(bw).toBe('2px');
    });
  });

  // ── Breadcrumb ───────────────────────────────────────────────────
  test.describe('Breadcrumb', () => {
    test('breadcrumb nav is present', async ({ page }) => {
      await expect(page.locator('.breadcrumb')).toBeVisible();
    });

    test('breadcrumb contains a home link', async ({ page }) => {
      await expect(page.locator('.breadcrumb a').first()).toBeVisible();
    });

    test('breadcrumb current item has aria-current="page"', async ({ page }) => {
      await expect(page.locator('.breadcrumb [aria-current="page"]')).toBeVisible();
    });
  });

  // ── Accessibility — spec §6 ──────────────────────────────────────
  test.describe('Accessibility', () => {
    test('primary nav has aria-label="primary" — spec §6', async ({ page }) => {
      await expect(page.locator('nav[aria-label="primary"]')).toBeVisible();
    });

    test('TOC nav has aria-label — spec §6', async ({ page }) => {
      const label = await page.locator('.toc').getAttribute('aria-label');
      expect(label).toBeTruthy();
    });

    test('heading levels are not skipped — spec §6', async ({ page }) => {
      const levels = await page.evaluate(() =>
        Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((h) =>
          Number.parseInt(h.tagName.charAt(1)),
        ),
      );
      for (let i = 1; i < levels.length; i++) {
        // Each heading may be at most one level deeper than the previous
        expect((levels[i] ?? 0) - (levels[i - 1] ?? 0)).toBeLessThanOrEqual(1);
      }
    });

    test('prefers-reduced-motion removes transitions — spec §5', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await goToFirstArticle(page);
      await expect(page.locator('.toc-link').first()).toBeAttached();
      const transition = await getComputedStyleProp(page, '.toc-link', 'transition');
      // With reduced-motion, transition should be "none" or 0s duration
      expect(transition === 'none' || transition.includes('0s')).toBe(true);
    });
  });
});

// ── Japanese article ─────────────────────────────────────────────
// Top-level describe so the outer goToFirstArticle() beforeEach is not
// inherited. japanese-test IS the first article, so nesting it caused
// three navigations per test: / then /japanese-test then /japanese-test again.
test.describe('Japanese article', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/japanese-test');
  });

  test('prose has lang="ja" on Japanese articles', async ({ page }) => {
    expect(await page.locator('.prose').getAttribute('lang')).toBe('ja');
  });

  test('Japanese article renders ruby elements', async ({ page }) => {
    await expect(page.locator('ruby').first()).toBeAttached();
  });

  test('ruby text (rt) is amber colored', async ({ page }) => {
    const amberRgb = await getCSSVarAsRgb(page, '--amber');
    const color = await getComputedStyleProp(page, 'rt', 'color');
    expect(color).toBe(amberRgb);
  });
});
