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

  // Slice from the end of the matched block rather than running a second
  // regex over the full text; .trim() handles the trailing newline after ---.
  const body = fmMatch ? text.slice(fmMatch[0].length).trim() : text.trim();
  return { title, lang, body };
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
