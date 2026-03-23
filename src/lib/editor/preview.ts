import { marked } from 'marked';

export interface FrontmatterData {
  title: string;
  lang: string;
  tags: string[];
  date: string;
  description: string;
  body: string;
}

export interface PreviewHeading {
  text: string;
  depth: 2 | 3;
  id: string;
}

/** Strips surrounding single/double quotes from a YAML scalar value. */
function stripYamlQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, '');
}

/** Parses a YAML inline array like `[tag1, tag2]` into a string array. */
function parseTags(value: string): string[] {
  const bracketMatch = value.match(/^\[(.*)\]$/);
  if (bracketMatch) {
    return (bracketMatch[1] ?? '')
      .split(',')
      .map((t) => stripYamlQuotes(t.trim()))
      .filter(Boolean);
  }
  return [];
}

/** Generates a URL-friendly heading id. Supports ASCII and CJK. */
function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/\s+/g, '-')
      // keep word chars, hyphens, and common CJK/Hiragana/Katakana ranges
      .replace(/[^\w\u3040-\u9fff\u30a0-\u30ff-]/g, '')
      .replace(/^-+|-+$/g, '') || 'heading'
  );
}

/**
 * Extracts title, lang, tags, date, description, and body from a
 * Markdown/MDX document with YAML frontmatter.  Pure function — no DOM access.
 */
export function parseFrontmatter(text: string): FrontmatterData {
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    return { title: '', lang: 'en', tags: [], date: '', description: '', body: text.trim() };
  }

  let title = '';
  let lang = 'en';
  let tags: string[] = [];
  let date = '';
  let description = '';

  for (const line of (fmMatch[1] ?? '').split('\n')) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const raw = line.slice(colon + 1).trim();
    const val = stripYamlQuotes(raw);
    if (key === 'title') title = val;
    else if (key === 'lang') lang = val || 'en';
    else if (key === 'tags') tags = parseTags(raw);
    else if (key === 'date') date = val;
    else if (key === 'description') description = val;
  }

  return {
    title,
    lang,
    tags,
    date,
    description,
    body: text.slice((fmMatch[0] ?? '').length).trim(),
  };
}

/**
 * Renders a pre-parsed frontmatter result into the preview pane element,
 * mirroring the actual ArticleLayout structure (header + prose body).
 *
 * Returns the list of h2/h3 headings found in the body (with assigned ids)
 * so the caller can build a live TOC without re-scanning the DOM.
 *
 * Note: marked is used for the live editor preview only.  Production
 * articles are rendered by Astro/MDX — custom MDX components such as
 * RubyText are not reflected here.  This intentional gap is acceptable
 * for a draft preview; the canonical render is always the build output.
 */
export function renderPreview(parsed: FrontmatterData, output: HTMLElement): PreviewHeading[] {
  const { title, lang, tags, date, description, body } = parsed;

  output.setAttribute('lang', lang);

  // ── Article header (mirrors ArticleLayout) ───────────────────
  const tagsHtml =
    tags.length > 0
      ? `<div class="article-header-tags">${tags.map((t) => `<a class="article-header-tag">#${t}</a>`).join('')}</div><span aria-hidden="true">·</span>`
      : '';
  const dateHtml = date ? `<time class="article-header-date">${date}</time>` : '';
  const metaHtml =
    tagsHtml || dateHtml
      ? `<div class="article-header-meta">${tagsHtml}${dateHtml}</div>`
      : '';
  const leadHtml = description
    ? `<p class="article-header-lead">${String(marked.parseInline(description))}</p>`
    : '';
  // Estimate reading time (≈ 200 wpm)
  const wordCount = body.trim().split(/\s+/).length;
  const readingTime = Math.max(1, Math.round(wordCount / 200));
  const rtHtml = `<p class="article-reading-time">${readingTime} min read</p>`;

  const headerHtml = title
    ? `<header class="article-header">${metaHtml}<h1>${String(marked.parseInline(title))}</h1><hr class="amber-rule article-header-hr">${leadHtml}${rtHtml}</header>`
    : '';

  // marked.parse / parseInline return string synchronously when no async
  // extensions are registered; String() coercion is safe for both overloads.
  output.innerHTML = headerHtml + String(marked.parse(body));

  // ── Add ids to headings & collect for TOC ────────────────────
  const headings: PreviewHeading[] = [];
  const usedIds = new Map<string, number>();

  for (const el of output.querySelectorAll('h2, h3')) {
    const text = el.textContent ?? '';
    const baseId = slugify(text);
    const count = usedIds.get(baseId) ?? 0;
    const id = count === 0 ? baseId : `${baseId}-${count}`;
    usedIds.set(baseId, count + 1);
    el.id = id;
    const depth = el.tagName === 'H2' ? 2 : 3;
    headings.push({ text, depth: depth as 2 | 3, id });
  }

  return headings;
}
