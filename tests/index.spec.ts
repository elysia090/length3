import { expect, test } from '@playwright/test';
import { openSearchModal } from './helpers';

test.describe('Index page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test.describe('Layout', () => {
    test('article list is visible', async ({ page }) => {
      await expect(page.locator('.article-list')).toBeVisible();
    });

    test('at least one article card is present', async ({ page }) => {
      await expect(page.locator('.article-card').first()).toBeVisible();
    });

    test('sidebar is visible on wide viewports', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('/');
      await expect(page.locator('.sidebar')).toBeVisible();
    });

    test('sidebar is hidden below 840px', async ({ page }) => {
      await page.setViewportSize({ width: 820, height: 900 });
      await page.goto('/');
      await expect(page.locator('.index-sidebar')).toBeHidden();
    });
  });

  test.describe('Navigation', () => {
    test('primary navigation is exposed to assistive technology', async ({ page }) => {
      await expect(page.locator('.header-nav')).toHaveAttribute('aria-label', 'primary');
    });

    test('primary navigation links to articles, tags, and about', async ({ page }) => {
      const links = page.locator('.header-nav a');
      await expect(links).toHaveCount(3);
      await expect(links.nth(0)).toContainText('Articles');
      await expect(links.nth(1)).toContainText('Tags');
      await expect(links.nth(2)).toContainText('About');
    });
  });

  test.describe('Search modal', () => {
    test('trigger button is present', async ({ page }) => {
      await expect(page.locator('#search-trigger')).toBeVisible();
    });

    test('modal is hidden by default', async ({ page }) => {
      await expect(page.locator('#search-modal')).toBeHidden();
    });

    test('trigger click opens the dialog and syncs aria-expanded', async ({ page }) => {
      await openSearchModal(page);
      await expect(page.locator('#search-modal')).toBeVisible();
      await expect(page.locator('#search-trigger')).toHaveAttribute('aria-expanded', 'true');
    });

    test('slash shortcut opens the dialog', async ({ page }) => {
      await page.locator('body').click();
      await page.keyboard.press('/');
      await expect(page.locator('#search-modal')).toBeVisible();
    });

    test('search input exposes an accessible name, name attribute, and placeholder', async ({
      page,
    }) => {
      await openSearchModal(page);
      const searchInput = page.getByRole('searchbox', { name: 'Search articles' });
      await expect(searchInput).toHaveAttribute('name', 'search');
      await expect(searchInput).toHaveAttribute('placeholder', 'Search articles…');
    });

    test('dev mode explains how to test search locally when Pagefind is unavailable', async ({
      page,
    }) => {
      await openSearchModal(page);
      await expect(page.locator('.search-unavailable')).toContainText(
        'Run pnpm build and pnpm preview to test it locally.',
      );
    });

    test('Escape closes the dialog and resets aria-expanded', async ({ page }) => {
      await openSearchModal(page);
      await page.keyboard.press('Escape');
      await expect(page.locator('#search-modal')).toBeHidden();
      await expect(page.locator('#search-trigger')).toHaveAttribute('aria-expanded', 'false');
    });

    test('overlay click closes the dialog and resets aria-expanded', async ({ page }) => {
      await openSearchModal(page);
      await page.locator('#search-modal').click({ position: { x: 5, y: 5 } });
      await expect(page.locator('#search-modal')).toBeHidden();
      await expect(page.locator('#search-trigger')).toHaveAttribute('aria-expanded', 'false');
    });

    test('focus returns to the trigger after close', async ({ page }) => {
      await openSearchModal(page);
      await page.keyboard.press('Escape');
      await expect(page.locator('#search-trigger')).toBeFocused();
    });

    test('focus stays trapped inside the dialog while it is open', async ({ page }) => {
      await openSearchModal(page);

      const focusableCount = await page.evaluate(() => {
        const modal = document.getElementById('search-modal');
        return (
          modal?.querySelectorAll('button, input, [href], [tabindex]:not([tabindex="-1"])')
            .length ?? 0
        );
      });
      expect(focusableCount).toBeGreaterThan(0);

      for (let i = 0; i <= focusableCount + 1; i++) {
        await page.keyboard.press('Tab');
      }

      const focusedInsideModal = await page.evaluate(() => {
        const modal = document.getElementById('search-modal');
        return modal?.contains(document.activeElement) ?? false;
      });
      expect(focusedInsideModal).toBe(true);
    });
  });
});
