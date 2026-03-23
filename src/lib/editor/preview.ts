import { marked } from 'marked';

export interface FrontmatterData {
  title: string;
  lang: string;
  body: string;
}

/** Strips surrounding single/double quotes from a YAML scalar value. */
function stripYamlQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, '');
}

/**
 * Extracts title, lang, and body from a Markdown/MDX document with YAML
 * frontmatter.  Pure function — no DOM access.
 *
 * Fields are parsed in a single line pass so adding a new editor-visible
 * field costs one `if` branch, not a new regex + conditional block.
 */
export function parseFrontmatter(text: string): FrontmatterData {
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    return { title: '', lang: 'en', body: text.trim() };
  }

  let title = '';
  let lang = 'en';
  for (const line of (fmMatch[1] ?? '').split('\n')) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const val = stripYamlQuotes(line.slice(colon + 1).trim());
    if (key === 'title') title = val;
    else if (key === 'lang') lang = val || 'en';
  }

  return {
    title,
    lang,
    // Slice avoids a second full-document regex replace pass.
    body: text.slice(fmMatch[0].length).trim(),
  };
}

/**
 * Renders a pre-parsed frontmatter result into the preview pane element.
 * Accepts FrontmatterData so the caller can share the single parseFrontmatter
 * call used for the status bar, avoiding a second parse per update cycle.
 *
 * Note: marked is used for the live editor preview only.  Production
 * articles are rendered by Astro/MDX — custom MDX components such as
 * RubyText are not reflected here.  This intentional gap is acceptable
 * for a draft preview; the canonical render is always the build output.
 */
export function renderPreview(parsed: FrontmatterData, output: HTMLElement): void {
  const { title, lang, body } = parsed;

  // Apply lang so Japanese typography CSS rules take effect in the preview.
  output.setAttribute('lang', lang);

  // marked.parse / parseInline return string synchronously when no async
  // extensions are registered; String() coercion is safe for both overloads.
  const headerHtml = title
    ? `<header class="article-header"><h1>${String(marked.parseInline(title))}</h1><hr class="amber-rule article-header-hr"></header>`
    : '';
  output.innerHTML = headerHtml + String(marked.parse(body));
}
