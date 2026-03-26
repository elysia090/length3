import type { BlogPost, ProcessedPost, TagIndex } from './types';

/**
 * Collection filter: excludes draft posts.
 * Pass directly to getCollection('blog', notDraft) to avoid repeating the
 * inline predicate on every page.
 */
export const notDraft = (entry: BlogPost) => !entry.data.draft;

/**
 * Converts a raw blog collection entry into a ProcessedPost ready for
 * rendering.  Centralised here so every page derives slug, readingTime and
 * description from the same logic.
 */
export function processPost(entry: BlogPost): ProcessedPost {
  return {
    entry,
    slug: toSlug(entry.id),
    readingTime: estimateReadingTime(entry.body ?? ''),
    description: entry.data.description,
  };
}

/** Removes file extension from a Content Layer entry ID to produce a URL slug. */
export function toSlug(id: string): string {
  return id.replace(/\.mdx?$/, '').toLowerCase();
}

/** Converts a tag string to a URL-safe slug.
 *
 * Uses Unicode property escapes (\p{L}\p{N}, requires the `u` flag) so that
 * CJK tags like "機械学習" are preserved rather than stripped to "".
 * Without the `u` flag, \w only covers [A-Za-z0-9_] — pure kanji tags would
 * produce an empty string and all map to the same /tags/ route.
 */
export function tagToSlug(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '');
}

/** Returns the canonical URL path for a tag. Single source of truth for tag link generation. */
export function getTagUrl(tag: string): string {
  return `/tags/${tagToSlug(tag)}`;
}

/** Estimates reading time in minutes, accounting for CJK character density. */
export function estimateReadingTime(text: string): number {
  // Single-pass character scan: count CJK chars and Latin word starts together.
  // Replaces the three-step replace→trim→split pipeline, which allocated an
  // intermediate string, a trimmed string, and an array of N word strings per
  // call.  A JIT-compiled charCodeAt loop is faster for long posts and O(1)
  // in space.
  //
  // CJK ranges match the previous /[\u3000-\u9FFF\uF900-\uFAFF]/ regex exactly:
  //   U+3000–U+9FFF  CJK symbols, unified ideographs, katakana, hiragana …
  //   U+F900–U+FAFF  CJK compatibility ideographs
  let cjkChars = 0;
  let latinWords = 0;
  let inLatinWord = false;

  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c >= 0x3000 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff)) {
      cjkChars++;
      inLatinWord = false; // CJK is a word boundary for adjacent Latin tokens
    } else if (c > 32) {
      // Non-whitespace, non-CJK: a Latin/ASCII character
      if (!inLatinWord) {
        latinWords++;
        inLatinWord = true;
      }
    } else {
      // Whitespace — code ≤ 32 covers space (32), tab (9), newline (10), CR (13)
      inLatinWord = false;
    }
  }

  // CJK reading ~400 chars/min, Latin ~200 words/min
  const minutes = cjkChars / 400 + latinWords / 200;
  return Math.max(1, Math.ceil(minutes));
}

/**
 * Groups posts by tag slug into a TagIndex.
 * Single source of truth for tag aggregation — shared by the home topics
 * directory and the per-tag listing page so the logic cannot diverge.
 */
export function buildTagIndex(posts: BlogPost[]): TagIndex {
  const bySlug = new Map<string, BlogPost[]>();
  const names = new Map<string, string>();
  for (const post of posts) {
    for (const tag of post.data.tags) {
      const slug = tagToSlug(tag);
      if (!names.has(slug)) names.set(slug, tag);
      let bucket = bySlug.get(slug);
      if (!bucket) {
        bucket = [];
        bySlug.set(slug, bucket);
      }
      bucket.push(post);
    }
  }
  return { bySlug, names };
}

export function formatDate(date: Date, locale: 'en' | 'ja'): string {
  const parts = new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value ?? '';
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const day = parts.find((part) => part.type === 'day')?.value ?? '';

  return locale === 'ja' ? `${year}/${month}/${day}` : `${year}-${month}-${day}`;
}
