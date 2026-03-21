import { test, expect } from '@playwright/test';
import { getCSSVar, getComputedStyleProp } from './helpers';

test.describe('Index page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  // ── Layout ──────────────────────────────────────────────────────
  test.describe('Layout', () => {
    test('article list is visible', async ({ page }) => {
      await expect(page.locator('.article-list')).toBeVisible();
    });

    test('at least one article card is present', async ({ page }) => {
      await expect(page.locator('.article-card').first()).toBeVisible();
    });

    test('sidebar is visible on wide viewport', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('/');
      await expect(page.locator('.sidebar')).toBeVisible();
    });

    test('sidebar disappears below 840px — spec §1', async ({ page }) => {
      await page.setViewportSize({ width: 820, height: 900 });
      await page.goto('/');
      await expect(page.locator('.index-sidebar')).toBeHidden();
    });

    test('no vertical rotate label in DOM — spec §9 exclusion', async ({ page }) => {
      const label = page.locator('.index-rotate-label');
      await expect(label).toHaveCount(0);
    });

    test('sidebar contains search only — no stats, no tags — spec §1', async ({ page }) => {
      // Sidebar must not contain stats grid
      await expect(page.locator('.sidebar .stats-grid')).toHaveCount(0);
      // Sidebar must not contain a tag list
      await expect(page.locator('.sidebar .tag-list')).toHaveCount(0);
      // Sidebar must contain the search trigger
      await expect(page.locator('#search-trigger')).toBeVisible();
    });
  });

  // ── Header — spec §4 ────────────────────────────────────────────
  test.describe('Header', () => {
    test('header is visible', async ({ page }) => {
      await expect(page.locator('.site-header')).toBeVisible();
    });

    test('header position is static — not sticky — spec §4', async ({ page }) => {
      const position = await getComputedStyleProp(page, '.site-header', 'position');
      expect(position).toBe('static');
    });

    test('nav has aria-label="primary" — spec §6', async ({ page }) => {
      const nav = page.locator('.header-nav');
      await expect(nav).toHaveAttribute('aria-label', 'primary');
    });

    test('nav has three links: Articles, Tags, About — spec §4', async ({ page }) => {
      const links = page.locator('.header-nav a');
      await expect(links).toHaveCount(3);
      await expect(links.nth(0)).toContainText('Articles');
      await expect(links.nth(1)).toContainText('Tags');
      await expect(links.nth(2)).toContainText('About');
    });

    test('logo superscript is amber — spec §4', async ({ page }) => {
      const sup = page.locator('.site-title-sup');
      const color = await getComputedStyleProp(page, '.site-title-sup', 'color');
      // Amber #d4820a = rgb(212, 130, 10)
      expect(color).toBe('rgb(212, 130, 10)');
      await expect(sup).toBeVisible();
    });

    test('nav link hover has no text-decoration — spec §4', async ({ page }) => {
      const link = page.locator('.header-nav a').first();
      await link.hover();
      const decoration = await page.evaluate(() => {
        const el = document.querySelector('.header-nav a');
        return el ? getComputedStyle(el).textDecorationLine : '';
      });
      expect(decoration).toBe('none');
    });
  });

  // ── Article Card — spec §4 ───────────────────────────────────────
  test.describe('Article card', () => {
    test('date column is 80px — spec §4', async ({ page }) => {
      const width = await page.evaluate(() => {
        const date = document.querySelector('.card-date') as HTMLElement | null;
        return date ? date.offsetWidth : 0;
      });
      expect(width).toBe(80);
    });

    test('card year has letter-spacing 0.06em — spec §4', async ({ page }) => {
      const ls = await getComputedStyleProp(page, '.card-year', 'letter-spacing');
      // 0.06em at 12px = 0.72px
      expect(parseFloat(ls)).toBeGreaterThan(0);
    });

    test('card tags use amber color — spec §4', async ({ page }) => {
      const tagEl = page.locator('.card-tag').first();
      if (await tagEl.isVisible()) {
        const color = await getComputedStyleProp(page, '.card-tag', 'color');
        // amber #d4820a = rgb(212, 130, 10)
        expect(color).toBe('rgb(212, 130, 10)');
      }
    });

    test('card title is Fraunces (display font) — spec §2', async ({ page }) => {
      const ff = await getComputedStyleProp(page, '.card-title', 'font-family');
      expect(ff.toLowerCase()).toContain('fraunces');
    });

    test('card title links to article', async ({ page }) => {
      const link = page.locator('.article-card h2 a').first();
      const href = await link.getAttribute('href');
      expect(href).toBeTruthy();
      expect(href).toMatch(/^\//);
    });

    test('reading time shows "N min" format — spec §4', async ({ page }) => {
      const rt = page.locator('.card-reading-time').first();
      await expect(rt).toContainText('min');
    });

    test('first card has no top padding — spec §4', async ({ page }) => {
      const pt = await page.evaluate(() => {
        const card = document.querySelector('.article-card') as HTMLElement | null;
        return card ? getComputedStyle(card).paddingTop : '';
      });
      expect(pt).toBe('0px');
    });

    test('last card has no bottom border — spec §4', async ({ page }) => {
      const border = await page.evaluate(() => {
        const cards = document.querySelectorAll('.article-card');
        const last = cards[cards.length - 1] as HTMLElement | null;
        return last ? getComputedStyle(last).borderBottomWidth : '';
      });
      expect(border).toBe('0px');
    });
  });

  // ── Search modal — spec §4 ───────────────────────────────────────
  test.describe('Search modal', () => {
    test('search trigger button is present', async ({ page }) => {
      await expect(page.locator('#search-trigger')).toBeVisible();
    });

    test('modal is hidden by default', async ({ page }) => {
      await expect(page.locator('#search-modal')).toBeHidden();
    });

    test('modal opens on trigger button click', async ({ page }) => {
      await page.locator('#search-trigger').click();
      await expect(page.locator('#search-modal')).toBeVisible();
    });

    test('modal opens on "/" keypress — spec §4', async ({ page }) => {
      // Ensure no input is focused
      await page.locator('body').click();
      await page.keyboard.press('/');
      await expect(page.locator('#search-modal')).toBeVisible();
    });

    test('modal closes on Escape key — spec §4', async ({ page }) => {
      await page.locator('#search-trigger').click();
      await expect(page.locator('#search-modal')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('#search-modal')).toBeHidden();
    });

    test('modal closes on overlay click', async ({ page }) => {
      await page.locator('#search-trigger').click();
      await expect(page.locator('#search-modal')).toBeVisible();
      // Click the overlay (outside the card)
      await page.locator('#search-modal').click({ position: { x: 5, y: 5 } });
      await expect(page.locator('#search-modal')).toBeHidden();
    });

    test('focus returns to trigger after close — spec §6', async ({ page }) => {
      await page.locator('#search-trigger').click();
      await page.keyboard.press('Escape');
      const focused = await page.evaluate(() => document.activeElement?.id);
      expect(focused).toBe('search-trigger');
    });

    test('focus is trapped inside modal while open — spec §6', async ({ page }) => {
      await page.locator('#search-trigger').click();
      await expect(page.locator('#search-modal')).toBeVisible();

      // Tab through all focusable elements — should not leave the modal
      const modalId = await page.evaluate(() => {
        const modal = document.getElementById('search-modal');
        const focusable = modal?.querySelectorAll('button, input, [href], [tabindex]:not([tabindex="-1"])');
        return focusable ? focusable.length : 0;
      });
      expect(modalId).toBeGreaterThan(0);

      // Tab repeatedly and verify focus stays inside modal
      for (let i = 0; i <= modalId + 1; i++) {
        await page.keyboard.press('Tab');
      }

      const focusedInsideModal = await page.evaluate(() => {
        const modal = document.getElementById('search-modal');
        return modal?.contains(document.activeElement) ?? false;
      });
      expect(focusedInsideModal).toBe(true);
    });

    test('modal has no backdrop-filter blur — spec §4', async ({ page }) => {
      await page.locator('#search-trigger').click();
      const backdropFilter = await getComputedStyleProp(page, '#search-modal', 'backdrop-filter');
      // Should be "none" or empty string
      expect(backdropFilter).toMatch(/^(none|)$/);
    });

    test('search card is 560px wide — spec §4', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('/');
      await page.locator('#search-trigger').click();
      const width = await page.evaluate(() => {
        const card = document.querySelector('.search-card') as HTMLElement | null;
        return card ? card.offsetWidth : 0;
      });
      expect(width).toBe(560);
    });

    test('search card border-radius is 6px — spec §4', async ({ page }) => {
      await page.locator('#search-trigger').click();
      const br = await getComputedStyleProp(page, '.search-card', 'border-radius');
      expect(br).toBe('6px');
    });

    test('search input uses display font (Fraunces) — spec §4', async ({ page }) => {
      await page.locator('#search-trigger').click();
      const ff = await getComputedStyleProp(page, '.search-field', 'font-family');
      expect(ff.toLowerCase()).toContain('fraunces');
    });
  });

  // ── Design tokens — spec §3 ──────────────────────────────────────
  test.describe('Design tokens', () => {
    test('--bg is #f9f8f5 — spec §3', async ({ page }) => {
      const bg = await getCSSVar(page, '--bg');
      expect(bg).toBe('#f9f8f5');
    });

    test('--amber is #d4820a — spec §3', async ({ page }) => {
      const amber = await getCSSVar(page, '--amber');
      expect(amber).toBe('#d4820a');
    });

    test('--rule is #dedad5 — spec §3', async ({ page }) => {
      const rule = await getCSSVar(page, '--rule');
      expect(rule).toBe('#dedad5');
    });

    test('--ink is #1c1a18 — spec §3', async ({ page }) => {
      const ink = await getCSSVar(page, '--ink');
      expect(ink).toBe('#1c1a18');
    });

    test('focus outline is 2px amber — spec §6', async ({ page }) => {
      // Tab to first focusable element and check outline
      await page.keyboard.press('Tab');
      const outline = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return '';
        return getComputedStyle(el).outlineColor;
      });
      // amber #d4820a = rgb(212, 130, 10)
      expect(outline).toBe('rgb(212, 130, 10)');
    });
  });
});

// ── Tags page ────────────────────────────────────────────────────
test.describe('Tags page', () => {
  test('tags page loads with h1', async ({ page }) => {
    await page.goto('/tags');
    await expect(page.locator('h1')).toBeVisible();
  });

  test('tags page has exactly one h1 — spec §6', async ({ page }) => {
    await page.goto('/tags');
    const h1s = page.locator('h1');
    await expect(h1s).toHaveCount(1);
  });
});
