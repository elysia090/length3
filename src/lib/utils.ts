/** Removes file extension from a Content Layer entry ID to produce a URL slug. */
export function toSlug(id: string): string {
  return id.replace(/\.(mdx?|md)$/, '').toLowerCase();
}

/** Converts a tag string to a URL-safe slug.
 *
 * Uses Unicode property escapes (\p{L}\p{N}, requires the `u` flag) so that
 * CJK tags like "機械学習" are preserved rather than stripped to "".
 * Without the `u` flag, \w only covers [A-Za-z0-9_] — pure kanji tags would
 * produce an empty string and all map to the same /tags/ route.
 */
export function tagToSlug(tag: string): string {
  return tag.toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}-]/gu, '');
}

/** Estimates reading time in minutes, accounting for CJK character density. */
export function estimateReadingTime(text: string): number {
  const cjkChars = (text.match(/[\u3000-\u9FFF\uF900-\uFAFF]/g) ?? []).length;
  const latinText = text.replace(/[\u3000-\u9FFF\uF900-\uFAFF]/g, '').trim();
  const latinWords = latinText ? latinText.split(/\s+/).length : 0;

  // CJK reading ~400 chars/min, Latin ~200 words/min
  const minutes = cjkChars / 400 + latinWords / 200;
  return Math.max(1, Math.ceil(minutes));
}

export function formatDate(date: Date, locale: 'en' | 'ja' = 'en'): string {
  return date.toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}
