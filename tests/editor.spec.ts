import { test, expect } from '@playwright/test';
import { getComputedStyleProp } from './helpers';

test.describe('Editor page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/editor');
  });

  // ── Structure — spec §1 ──────────────────────────────────────────
  test.describe('Structure', () => {
    test('editor root is visible', async ({ page }) => {
      await expect(page.locator('.editor-root')).toBeVisible();
    });

    test('editor pane (dark) is present', async ({ page }) => {
      await expect(page.locator('.editor-pane')).toBeVisible();
    });

    test('preview pane (light) is present', async ({ page }) => {
      await expect(page.locator('.preview-pane')).toBeVisible();
    });

    test('top bar is 40px tall — spec §4', async ({ page }) => {
      const height = await page.evaluate(() => {
        const bar = document.querySelector('.editor-topbar') as HTMLElement | null;
        return bar ? bar.offsetHeight : 0;
      });
      expect(height).toBe(40);
    });

    test('status bar is 24px tall — spec §4', async ({ page }) => {
      const height = await page.evaluate(() => {
        const bar = document.querySelector('.editor-statusbar') as HTMLElement | null;
        return bar ? bar.offsetHeight : 0;
      });
      expect(height).toBe(24);
    });

    test('split is 50/50 on wide viewport — spec §4', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('/editor');

      const [editorWidth, previewWidth] = await page.evaluate(() => {
        const editorPane = document.querySelector('.editor-pane') as HTMLElement | null;
        const previewPane = document.querySelector('.preview-pane') as HTMLElement | null;
        return [editorPane?.offsetWidth ?? 0, previewPane?.offsetWidth ?? 0];
      });
      // Allow 1px tolerance for subpixel rendering
      expect(Math.abs(editorWidth - previewWidth)).toBeLessThanOrEqual(1);
    });
  });

  // ── Top bar — spec §4 ────────────────────────────────────────────
  test.describe('Top bar', () => {
    test('logo shows "L³" in amber — spec §4', async ({ page }) => {
      await expect(page.locator('.editor-logo')).toBeVisible();
      const color = await getComputedStyleProp(page, '.editor-logo', 'color');
      // amber #d4820a = rgb(212, 130, 10)
      expect(color).toBe('rgb(212, 130, 10)');
    });

    test('Discard button is present — spec §4', async ({ page }) => {
      await expect(page.locator('#discard-btn')).toBeVisible();
    });

    test('Preview button is present — spec §4', async ({ page }) => {
      await expect(page.locator('#preview-btn')).toBeVisible();
    });

    test('Publish button is present — spec §4', async ({ page }) => {
      await expect(page.locator('#publish-btn')).toBeVisible();
    });

    test('Publish button is NOT amber — spec §4', async ({ page }) => {
      const color = await getComputedStyleProp(page, '#publish-btn', 'color');
      // Must not be amber rgb(212, 130, 10)
      expect(color).not.toBe('rgb(212, 130, 10)');
    });
  });

  // ── Editor pane — spec §4 ────────────────────────────────────────
  test.describe('Editor pane', () => {
    test('editor pane has warm-dark background — spec §4', async ({ page }) => {
      const bg = await getComputedStyleProp(page, '.editor-pane', 'background-color');
      // editor-bg #181511 = rgb(24, 21, 17)
      expect(bg).toBe('rgb(24, 21, 17)');
    });

    test('CodeMirror editor mounts inside editor pane', async ({ page }) => {
      await page.waitForTimeout(500); // allow CM to initialise
      const cm = page.locator('.editor-pane .cm-editor');
      await expect(cm).toBeAttached();
    });
  });

  // ── Preview pane — spec §4 ───────────────────────────────────────
  test.describe('Preview pane', () => {
    test('preview pane has light background — spec §4', async ({ page }) => {
      const bg = await getComputedStyleProp(page, '.preview-pane', 'background-color');
      // bg #f9f8f5 = rgb(249, 248, 245)
      expect(bg).toBe('rgb(249, 248, 245)');
    });

    test('preview output element exists', async ({ page }) => {
      await expect(page.locator('#preview-output')).toBeAttached();
    });
  });

  // ── Status bar — spec §4 ─────────────────────────────────────────
  test.describe('Status bar', () => {
    test('status bar has darker-than-editor-bg background — spec §4', async ({ page }) => {
      const bg = await getComputedStyleProp(page, '.editor-statusbar', 'background-color');
      // #1a1714 = rgb(26, 23, 20)
      expect(bg).toBe('rgb(26, 23, 20)');
    });

    test('status bar is NOT amber — spec §4', async ({ page }) => {
      const bg = await getComputedStyleProp(page, '.editor-statusbar', 'background-color');
      // amber #d4820a = rgb(212, 130, 10)
      expect(bg).not.toBe('rgb(212, 130, 10)');
    });

    test('status bar shows UTF-8', async ({ page }) => {
      await expect(page.locator('.editor-statusbar')).toContainText('UTF-8');
    });

    test('status bar shows line/col position', async ({ page }) => {
      await expect(page.locator('#status-pos')).toContainText('Ln');
      await expect(page.locator('#status-pos')).toContainText('Col');
    });
  });

  // ── Char count in status bar ─────────────────────────────────────
  test.describe('Char count', () => {
    test('status bar shows char count element', async ({ page }) => {
      await expect(page.locator('#status-count')).toBeAttached();
    });

    test('char count shows "chars" text', async ({ page }) => {
      await page.waitForTimeout(500);
      const text = await page.locator('#status-count').textContent();
      expect(text).toMatch(/chars/);
    });
  });

  // ── Preview rendering ─────────────────────────────────────────────
  test.describe('Preview rendering', () => {
    test('preview output renders markdown headings', async ({ page }) => {
      await page.waitForTimeout(500);
      // Default template has "## Introduction"
      await expect(page.locator('#preview-output h2').first()).toBeAttached();
    });

    test('preview title matches frontmatter title', async ({ page }) => {
      await page.waitForTimeout(500);
      const titleEl = page.locator('#preview-output h1').first();
      await expect(titleEl).toContainText('Untitled');
    });
  });

  // ── Mobile tab mode — spec §8 ────────────────────────────────────
  test.describe('Mobile (< 640px)', () => {
    test('editor root switches to single column below 640px — spec §8', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/editor');

      const cols = await page.evaluate(() => {
        const main = document.querySelector('.editor-main') as HTMLElement | null;
        return main ? getComputedStyle(main).gridTemplateColumns : '';
      });
      // Single column: should not be "... ..." (two columns)
      const columnCount = cols.trim().split(/\s+/).filter(Boolean).length;
      expect(columnCount).toBeLessThanOrEqual(1);
    });
  });
});
