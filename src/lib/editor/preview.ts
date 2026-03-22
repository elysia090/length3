import { marked } from 'marked';

/**
 * Renders MDX source into the live preview pane.
 *
 * Extracts `title` and `lang` from the YAML frontmatter, then renders
 * the body with marked.
 *
 * Note: marked is used for the live editor preview only.  Production
 * articles are rendered by Astro/MDX — custom MDX components such as
 * RubyText are not reflected here.  This intentional gap is acceptable
 * for a draft preview; the canonical render is always the build output.
 */
export function renderPreview(
  text: string,
  output: HTMLElement,
  countEl: HTMLElement | null,
): void {
  let title = '';
  let lang = 'en';

  const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const fm = fmMatch[1]!;
    const titleM = fm.match(/^title:\s*(.+)$/m);
    if (titleM) title = titleM[1]!.trim().replace(/^['"]|['"]$/g, '');
    const langM = fm.match(/^lang:\s*(.+)$/m);
    if (langM) lang = langM[1]!.trim().replace(/^['"]|['"]$/g, '');
  }

  // Apply lang so Japanese typography CSS rules take effect in the preview.
  output.setAttribute('lang', lang);

  const body = text.replace(/^---[\s\S]*?---\n?/, '').trim();

  const headerHtml = title
    ? `<header class="article-header"><h1>${marked.parseInline(title) as string}</h1><hr class="article-header-hr"></header>`
    : '';
  output.innerHTML = headerHtml + marked.parse(body);

  if (countEl) {
    const chars = body.replace(/\s/g, '').length;
    countEl.textContent = `${chars} chars`;
  }
}
