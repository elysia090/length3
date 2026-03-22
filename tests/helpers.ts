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
 * Read a CSS custom property value from the document root.
 */
export async function getCSSVar(page: Page, varName: string): Promise<string> {
  return page.evaluate((name) => {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }, varName);
}

/**
 * Read a CSS custom property hex value and return it as the rgb() string that
 * browsers emit from getComputedStyle.  Use this instead of hardcoding
 * 'rgb(R, G, B)' literals so that tests stay valid when design tokens change.
 *
 * Assumes the token value is a 6-digit hex color (#rrggbb).
 */
export async function getCSSVarAsRgb(page: Page, varName: string): Promise<string> {
  return page.evaluate((name) => {
    const hex = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    return `rgb(${r}, ${g}, ${b})`;
  }, varName);
}

/**
 * Get the computed style property of a selector.
 */
export async function getComputedStyleProp(
  page: Page,
  selector: string,
  property: string,
): Promise<string> {
  return page.evaluate(
    ({ sel, prop }: { sel: string; prop: string }) => {
      const el = document.querySelector(sel);
      if (!el) return '';
      return getComputedStyle(el).getPropertyValue(prop).trim();
    },
    { sel: selector, prop: property },
  );
}
