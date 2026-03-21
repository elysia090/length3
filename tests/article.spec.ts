import { expect, test } from '@playwright/test';
import { getComputedStyleProp, goToFirstArticle } from './helpers';

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
      const h1s = page.locator('h1');
      await expect(h1s).toHaveCount(1);
    });

    test('right column has no interactive content — spec §1', async ({ page }) => {
      // The spec says right column is "deliberately empty". Verify no actions-aside
      // alongside the prose (it should be at end of prose, not in a separate column)
      const actionsAside = page.locator('.actions-aside');
      await expect(actionsAside).toHaveCount(0);

      // Article actions exist, but are inside prose-area (not a sidebar)
      const actionsInProse = page.locator('.prose-area .article-actions');
      await expect(actionsInProse).toBeAttached();
    });
  });

  // ── TOC — spec §4 ───────────────────────────────────────────────
  test.describe('Table of Contents', () => {
    test('TOC nav has aria-label="Table of Contents" — spec §6', async ({ page }) => {
      const nav = page.locator('.toc');
      await expect(nav).toHaveAttribute('aria-label', 'Table of Contents');
    });

    test('TOC links point to headings with # anchors', async ({ page }) => {
      const links = page.locator('.toc-link');
      const count = await links.count();
      if (count > 0) {
        const href = await links.first().getAttribute('href');
        expect(href).toMatch(/^#/);
      }
    });

    test('TOC has border-left: 2px solid transparent on inactive links — spec §4', async ({
      page,
    }) => {
      const borderWidth = await getComputedStyleProp(page, '.toc-link', 'border-left-width');
      expect(borderWidth).toBe('2px');
    });

    test('TOC active link gets amber border and color — spec §4', async ({ page }) => {
      // Scroll to first heading to trigger active state
      const firstLink = page.locator('.toc-link').first();
      const href = await firstLink.getAttribute('href');
      if (href) {
        const heading = page.locator(href);
        if ((await heading.count()) > 0) {
          await heading.scrollIntoViewIfNeeded();
          // Wait for IntersectionObserver to fire
          await page.waitForTimeout(300);

          const hasActive = await firstLink.evaluate((el) => el.classList.contains('active'));
          if (hasActive) {
            const color = await getComputedStyleProp(page, '.toc-link.active', 'color');
            // amber #d4820a = rgb(212, 130, 10)
            expect(color).toBe('rgb(212, 130, 10)');
            const borderColor = await getComputedStyleProp(
              page,
              '.toc-link.active',
              'border-left-color',
            );
            expect(borderColor).toBe('rgb(212, 130, 10)');
          }
        }
      }
    });

    test('H3 TOC items have margin-left: 12px — spec §4', async ({ page }) => {
      const h3Items = page.locator('.toc-depth-3');
      const count = await h3Items.count();
      if (count > 0) {
        const ml = await getComputedStyleProp(page, '.toc-depth-3', 'margin-left');
        expect(ml).toBe('12px');
      }
    });

    test('clicking TOC link navigates to heading (smooth scroll)', async ({ page }) => {
      const firstLink = page.locator('.toc-link').first();
      const href = await firstLink.getAttribute('href');
      if (href) {
        await firstLink.click();
        await page.waitForTimeout(500); // allow smooth scroll
        // Hash should be updated — decode percent-encoded CJK chars before compare
        const hash = await page.evaluate(() => decodeURIComponent(window.location.hash));
        expect(hash).toBe(href);
      }
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
        const bar = document.getElementById('reading-progress') as HTMLElement | null;
        return bar ? getComputedStyle(bar).width : '';
      });
      // 0% of viewport = 0px
      expect(width).toBe('0px');
    });

    test('progress bar width increases on scroll', async ({ page }) => {
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(200);

      const width = await page.evaluate(() => {
        const bar = document.getElementById('reading-progress') as HTMLElement | null;
        if (!bar) return 0;
        const style = bar.style.getPropertyValue('--progress');
        return Number.parseFloat(style) || 0;
      });
      expect(width).toBeGreaterThan(0);
    });

    test('progress bar is amber colored', async ({ page }) => {
      const color = await getComputedStyleProp(page, '#reading-progress', 'background-color');
      // amber #d4820a = rgb(212, 130, 10)
      expect(color).toBe('rgb(212, 130, 10)');
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

    test('body prose line-height is 1.95 (≈31.2px at 16px base) — spec §2', async ({ page }) => {
      const lh = await getComputedStyleProp(page, '.prose', 'line-height');
      const lhNum = Number.parseFloat(lh);
      // 1.95 × 16 = 31.2px
      expect(lhNum).toBeCloseTo(31.2, 0);
    });

    test('code blocks use light background — spec §4', async ({ page }) => {
      const bgColor = await getComputedStyleProp(page, '.prose pre', 'background-color');
      // bg-2 #f0ede8 = rgb(240, 237, 232)
      expect(bgColor).toBe('rgb(240, 237, 232)');
    });

    test('code blocks have amber-lt left border — spec §4', async ({ page }) => {
      const borderColor = await getComputedStyleProp(page, '.prose pre', 'border-left-color');
      // amber-lt #e8a030 = rgb(232, 160, 48)
      expect(borderColor).toBe('rgb(232, 160, 48)');
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
      const homeLink = page.locator('.breadcrumb a').first();
      await expect(homeLink).toBeVisible();
    });

    test('breadcrumb current item has aria-current="page"', async ({ page }) => {
      const current = page.locator('.breadcrumb [aria-current="page"]');
      await expect(current).toBeVisible();
    });
  });

  // ── Japanese lang attribute ───────────────────────────────────────
  test.describe('Japanese article', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/japanese-test');
    });

    test('prose has lang="ja" on Japanese articles', async ({ page }) => {
      const lang = await page.locator('.prose').getAttribute('lang');
      expect(lang).toBe('ja');
    });

    test('Japanese article renders ruby elements', async ({ page }) => {
      await expect(page.locator('ruby').first()).toBeAttached();
    });

    test('ruby text (rt) is amber colored', async ({ page }) => {
      const color = await getComputedStyleProp(page, 'rt', 'color');
      // amber #d4820a = rgb(212, 130, 10)
      expect(color).toBe('rgb(212, 130, 10)');
    });
  });

  // ── Accessibility — spec §6 ──────────────────────────────────────
  test.describe('Accessibility', () => {
    test('primary nav has aria-label="primary" — spec §6', async ({ page }) => {
      await expect(page.locator('nav[aria-label="primary"]')).toBeVisible();
    });

    test('TOC nav has aria-label — spec §6', async ({ page }) => {
      const tocNav = page.locator('.toc');
      const label = await tocNav.getAttribute('aria-label');
      expect(label).toBeTruthy();
    });

    test('search input has aria-label — spec §6', async ({ page }) => {
      // The search input is in the modal — navigate to index first
      await page.goto('/');
      await page.locator('#search-trigger').click();
      const input = page.locator('#pagefind-input');
      const label = await input.getAttribute('aria-label');
      expect(label).toBeTruthy();
    });

    test('heading levels are not skipped — spec §6', async ({ page }) => {
      const headingLevels = await page.evaluate(() => {
        const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
        return headings.map((h) => Number.parseInt(h.tagName.charAt(1)));
      });
      // Check no level is skipped (e.g., h1 → h3 without h2)
      for (let i = 1; i < headingLevels.length; i++) {
        const prev = headingLevels[i - 1];
        const curr = headingLevels[i];
        if (prev !== undefined && curr !== undefined) {
          expect(curr - prev).toBeLessThanOrEqual(1);
        }
      }
    });

    test('prefers-reduced-motion removes transitions — spec §5', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await goToFirstArticle(page);

      const transition = await getComputedStyleProp(page, '.toc-link', 'transition');
      // With reduced-motion, transition should be "none" or 0s duration
      const hasNoTransition =
        transition === 'none' || transition.includes('0s') || transition === '';
      expect(hasNoTransition).toBe(true);
    });
  });
});
