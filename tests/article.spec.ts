import { expect, test } from '@playwright/test';
import { countH1, goToFirstArticle } from './helpers';

test.describe('Article page', () => {
  test.beforeEach(async ({ page }) => {
    await goToFirstArticle(page);
  });

  test.describe('Layout', () => {
    test('prose content is rendered', async ({ page }) => {
      await expect(page.locator('[data-pagefind-body]')).toBeVisible();
    });

    test('article has exactly one h1', async ({ page }) => {
      expect(await countH1(page)).toBe(1);
    });

    test('table of contents is visible', async ({ page }) => {
      await expect(page.locator('.toc')).toBeVisible();
    });

    test('article header keeps tags and dates in separate groups', async ({ page }) => {
      await expect(page.locator('.article-header-tags')).toBeVisible();
      await expect(page.locator('.article-header-dates')).toBeVisible();
    });
  });

  test.describe('Table of contents', () => {
    test('toc nav has an accessible label', async ({ page }) => {
      await expect(page.locator('.toc')).toHaveAttribute('aria-label', 'Table of Contents');
    });

    test('toc links target article headings', async ({ page }) => {
      const firstLink = page.locator('.toc-link').first();
      await expect(firstLink).toBeAttached();
      await expect(firstLink).toHaveAttribute('href', /^#/);
    });

    test('clicking a toc link updates the URL hash and moves focus to the heading', async ({
      page,
    }) => {
      const firstLink = page.locator('.toc-link').first();
      const href = await firstLink.getAttribute('href');
      expect(href).toMatch(/^#/);
      if (!href) throw new Error('Expected the first TOC link to target a heading');

      await firstLink.click();
      await page.waitForFunction(
        (expected) => decodeURIComponent(window.location.hash) === expected,
        href,
      );
      await expect.poll(() => decodeURIComponent(new URL(page.url()).hash)).toBe(href);
      await expect(page.locator(href)).toBeFocused();
    });

    test('toc is hidden on mobile viewports', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await expect(page.locator('.toc-aside')).toBeHidden();
    });
  });

  test.describe('Reading progress', () => {
    test('reading percent updates on scroll', async ({ page }) => {
      await expect(page.locator('#pct-read')).toHaveText('0%');
      await page.evaluate(() => window.scrollBy(0, 500));
      await expect(page.locator('#pct-read')).not.toHaveText('0%');
    });

    test('progressbar aria-valuenow updates on scroll', async ({ page }) => {
      await expect(page.locator('#reading-progress')).toHaveAttribute('aria-valuenow', '0');
      await page.evaluate(() => window.scrollBy(0, 500));
      await expect
        .poll(async () =>
          Number(await page.locator('#reading-progress').getAttribute('aria-valuenow')),
        )
        .toBeGreaterThan(0);
    });
  });

  test.describe('Article actions', () => {
    test('copy and share buttons are visible with accessible labels', async ({ page }) => {
      await expect(page.locator('#copy-link-btn')).toHaveAttribute(
        'aria-label',
        'Copy link to clipboard',
      );
      await expect(page.locator('#share-btn')).toHaveAttribute('aria-label', 'Share article');
    });

    test('copy success announces the clipboard update', async ({ page }) => {
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: () => Promise.resolve() },
        });
      });

      await page.locator('#copy-link-btn').click();
      await expect(page.locator('#article-action-status')).toHaveText('Link copied to clipboard.');
    });

    test('copy failure announces a recovery path', async ({ page }) => {
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: () => Promise.reject(new Error('copy failure')) },
        });
      });

      await page.locator('#copy-link-btn').click();
      await expect(page.locator('#article-action-status')).toHaveText(
        'Could not copy the link. Copy the URL from the address bar.',
      );
    });

    test('share fallback announces clipboard success', async ({ page }) => {
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'share', {
          configurable: true,
          value: undefined,
        });
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: () => Promise.resolve() },
        });
      });

      await page.locator('#share-btn').click();
      await expect(page.locator('#article-action-status')).toHaveText('Link copied to clipboard.');
    });

    test('share failure announces the recovery path', async ({ page }) => {
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'share', {
          configurable: true,
          value: () => Promise.reject(new Error('share failure')),
        });
      });

      await page.locator('#share-btn').click();
      await expect(page.locator('#article-action-status')).toHaveText(
        'Could not share the article. Try copying the URL instead.',
      );
    });
  });

  test.describe('Breadcrumb', () => {
    test('breadcrumb nav is present', async ({ page }) => {
      await expect(page.locator('.breadcrumb')).toBeVisible();
    });

    test('breadcrumb contains a home link', async ({ page }) => {
      await expect(page.locator('.breadcrumb a').first()).toBeVisible();
    });

    test('breadcrumb marks the current item as the current page', async ({ page }) => {
      await expect(page.locator('.breadcrumb [aria-current="page"]')).toBeVisible();
    });
  });

  test.describe('Accessibility', () => {
    test('primary navigation is exposed to assistive technology', async ({ page }) => {
      await expect(page.locator('nav[aria-label="primary"]')).toBeVisible();
    });

    test('heading levels are not skipped', async ({ page }) => {
      const levels = await page.evaluate(() =>
        Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((heading) =>
          Number.parseInt(heading.tagName.charAt(1), 10),
        ),
      );

      for (let i = 1; i < levels.length; i++) {
        expect((levels[i] ?? 0) - (levels[i - 1] ?? 0)).toBeLessThanOrEqual(1);
      }
    });
  });
});

test.describe('Japanese article', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/japanese-test');
  });

  test('prose has lang="ja" on Japanese articles', async ({ page }) => {
    await expect(page.locator('.prose')).toHaveAttribute('lang', 'ja');
  });

  test('Japanese article renders ruby elements', async ({ page }) => {
    await expect(page.locator('ruby').first()).toBeAttached();
  });
});
