import { expect, type Page, test } from '@playwright/test';

async function focusEditor(page: Page): Promise<void> {
  await page.locator('.cm-content').click();
}

async function appendToEditor(page: Page, text: string): Promise<void> {
  await focusEditor(page);
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text);
}

test.describe('Editor page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/editor');
  });

  test.describe('Structure', () => {
    test('editor, preview, and status regions are visible', async ({ page }) => {
      await expect(page.locator('.editor-root')).toBeVisible();
      await expect(page.locator('.editor-pane')).toBeVisible();
      await expect(page.locator('.preview-pane')).toBeVisible();
      await expect(page.locator('.editor-statusbar')).toBeVisible();
    });

    test('CodeMirror mounts inside the editor pane', async ({ page }) => {
      await expect(page.locator('.editor-pane .cm-editor')).toBeAttached();
    });

    test('mobile tab panels are labelled by their controlling tabs', async ({ page }) => {
      await expect(page.locator('#editor-pane')).toHaveAttribute('aria-labelledby', 'tab-edit');
      await expect(page.locator('#preview-pane')).toHaveAttribute('aria-labelledby', 'tab-preview');
    });
  });

  test.describe('Preview rendering', () => {
    test('initial preview renders the frontmatter title', async ({ page }) => {
      await expect(page.locator('#preview-output h1')).toHaveText('Untitled');
    });

    test('initial preview renders markdown headings', async ({ page }) => {
      await expect(page.locator('#preview-output h2').first()).toContainText('Introduction');
    });
  });

  test.describe('Editor interactions', () => {
    test('typing updates the preview and character count', async ({ page }) => {
      const initialCount = (await page.locator('#status-count').textContent()) ?? '';

      await appendToEditor(page, '\n## Added heading\n');

      await expect(page.locator('#preview-output h2', { hasText: 'Added heading' })).toBeVisible();
      await expect(page.locator('#status-count')).not.toHaveText(initialCount);
    });

    test('moving the cursor updates line and column status', async ({ page }) => {
      await focusEditor(page);
      const initialPos = (await page.locator('#status-pos').textContent()) ?? '';

      await page.keyboard.press('Control+End');

      await expect(page.locator('#status-pos')).not.toHaveText(initialPos);
      await expect(page.locator('#status-pos')).toHaveText(/Ln \d+ · Col \d+/);
    });

    test('discard prompts for confirmation when the document is dirty', async ({ page }) => {
      await appendToEditor(page, '\ndiscard-check\n');

      let dialogMessage = '';
      page.once('dialog', async (dialog) => {
        dialogMessage = dialog.message();
        await dialog.dismiss();
      });

      await page.locator('#discard-btn').click();

      await expect.poll(() => dialogMessage).toBe('Discard all changes?');
      await expect(page.locator('.cm-content')).toContainText('discard-check');
    });

    test('publish confirmation can be cancelled without announcing success', async ({ page }) => {
      let dialogMessage = '';
      page.once('dialog', async (dialog) => {
        dialogMessage = dialog.message();
        await dialog.dismiss();
      });

      await page.locator('#publish-btn').click();

      await expect.poll(() => dialogMessage).toBe('Publish this article?');
      await expect(page.locator('#publish-btn')).toHaveText('Publish →');
      await expect(page.locator('#editor-status-announcement')).toHaveText('');
    });

    test('publish success updates the live status announcement', async ({ page }) => {
      let dialogMessage = '';
      page.once('dialog', async (dialog) => {
        dialogMessage = dialog.message();
        await dialog.accept();
      });

      await page.locator('#publish-btn').click();

      await expect.poll(() => dialogMessage).toBe('Publish this article?');
      await expect(page.locator('#publish-btn')).toHaveText('Published!');
      await expect(page.locator('#editor-status-announcement')).toHaveText('Article published.');
    });
  });

  test.describe('Mobile tabs', () => {
    test('preview query param opens the preview panel on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/editor?panel=preview');

      await expect(page.locator('#tab-preview')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('#preview-pane')).toHaveClass(/tab-active/);
      await expect(page).toHaveURL(/\/editor\?panel=preview$/);
    });

    test('clicking tabs updates the active panel and URL', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/editor');

      await page.locator('#tab-preview').click();
      await expect(page.locator('#tab-preview')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('#preview-pane')).toHaveClass(/tab-active/);
      await expect(page).toHaveURL(/\/editor\?panel=preview$/);

      await page.locator('#tab-edit').click();
      await expect(page.locator('#tab-edit')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('#editor-pane')).toHaveClass(/tab-active/);
      await expect(page).toHaveURL(/\/editor$/);
    });

    test('arrow keys switch tabs and keep the URL in sync', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/editor');

      await page.locator('#tab-edit').focus();
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('#tab-preview')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('#preview-pane')).toHaveClass(/tab-active/);
      await expect(page).toHaveURL(/\/editor\?panel=preview$/);

      await page.keyboard.press('ArrowLeft');
      await expect(page.locator('#tab-edit')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('#editor-pane')).toHaveClass(/tab-active/);
      await expect(page).toHaveURL(/\/editor$/);
    });

    test('browser history restores the prior panel', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/editor');

      await page.locator('#tab-preview').click();
      await page.locator('#tab-edit').click();
      await page.goBack();

      await expect(page.locator('#tab-preview')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('#preview-pane')).toHaveClass(/tab-active/);
      await expect(page).toHaveURL(/\/editor\?panel=preview$/);
    });

    test('invalid panel query params normalize back to the canonical edit URL', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/editor?panel=unknown');

      await expect(page.locator('#tab-edit')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('#editor-pane')).toHaveClass(/tab-active/);
      await expect(page).toHaveURL(/\/editor$/);
    });
  });
});
