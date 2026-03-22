import { marked } from 'marked';

export interface FrontmatterData {
  title: string;
  lang: string;
  body: string;
}

/** Strips surrounding single/double quotes from a YAML scalar value. */
function stripYamlQuotes(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

/**
 * Extracts title, lang, and body from a Markdown/MDX document with YAML
 * frontmatter.  Pure function — no DOM access.
 */
export function parseFrontmatter(text: string): FrontmatterData {
  let title = '';
  let lang = 'en';

  const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const fm = fmMatch[1] ?? '';
    const titleM = fm.match(/^title:\s*(.+)$/m);
    if (titleM) title = stripYamlQuotes(titleM[1] ?? '');
    const langM = fm.match(/^lang:\s*(.+)$/m);
    if (langM) lang = stripYamlQuotes(langM[1] ?? '') || 'en';
  }

  const body = text.replace(/^---[\s\S]*?---\n?/, '').trim();
  return { title, lang, body };
}

/**
 * Renders a parsed frontmatter body into the preview pane element.
 *
 * Note: marked is used for the live editor preview only.  Production
 * articles are rendered by Astro/MDX — custom MDX components such as
 * RubyText are not reflected here.  This intentional gap is acceptable
 * for a draft preview; the canonical render is always the build output.
 */
export function renderPreview(text: string, output: HTMLElement): void {
  const { title, lang, body } = parseFrontmatter(text);

  // Apply lang so Japanese typography CSS rules take effect in the preview.
  output.setAttribute('lang', lang);

  // marked.parse / parseInline return string synchronously when no async
  // extensions are registered; String() coercion is safe for both overloads.
  const headerHtml = title
    ? `<header class="article-header"><h1>${String(marked.parseInline(title))}</h1><hr class="amber-rule article-header-hr"></header>`
    : '';
  output.innerHTML = headerHtml + String(marked.parse(body));
}
