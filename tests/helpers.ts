import type { Page } from '@playwright/test';

/**
 * Count <h1> elements in the document, intentionally using page.evaluate to
 * avoid piercing the Astro dev toolbar's Shadow DOM (which contains its own h1s).
 */
export async function countH1(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('h1').length);
}

/**
 * Navigate to the first article from the index page.
 * Returns the href of the article.
 */
export async function goToFirstArticle(page: Page): Promise<string> {
  await page.goto('/');
  const href = await page.locator('.article-card h2 a').first().getAttribute('href');
  if (!href) throw new Error('No article found on index page');
  await page.goto(href);
  return href;
}

/**
 * Navigate to the first tag detail page from the tags index.
 * Returns the href of the tag detail page.
 */
export async function goToFirstTagDetail(page: Page): Promise<string> {
  await page.goto('/tags');
  const href = await page.locator('.tag-card').first().getAttribute('href');
  if (!href) throw new Error('No tag found on tags index');
  await page.goto(href);
  return href;
}

/**
 * Open the search dialog from the index page.
 */
export async function openSearchModal(page: Page): Promise<void> {
  await page.locator('#search-trigger').click();
}
