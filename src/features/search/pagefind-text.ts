/**
 * Pagefind の結果を表示できる形に整える純粋関数。
 *
 * 索引は segmented-pagefind が日本語を分かち書きして作るので、問い合わせも
 * 同じ切り方に揃え、返ってきた抜粋や題からは分かち書きの空白を取り除く。
 * URL は .html を落としたサイトの道筋に直す。
 */
const JAPANESE_QUERY_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const WORDLIKE_QUERY_PATTERN = /[\p{Letter}\p{Number}]/u;

export interface PagefindResultMeta {
  [key: string]: string | undefined;
  url?: string;
}

export interface PagefindSearchSubResult {
  excerpt?: string;
  meta?: PagefindResultMeta;
  title?: string;
  url?: string;
}

export interface PagefindSearchResult {
  excerpt?: string;
  filters?: Record<string, string[]>;
  meta?: PagefindResultMeta;
  sub_results?: PagefindSearchSubResult[];
  url: string;
}

export function normalizePagefindSearchTerm(term: string) {
  const trimmed = term.trim();
  if (!trimmed || !JAPANESE_QUERY_PATTERN.test(trimmed)) {
    return trimmed;
  }

  const quoted = trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1;
  const rawTerm = quoted ? trimmed.slice(1, -1).trim() : trimmed;
  if (!rawTerm) {
    return trimmed;
  }

  const Segmenter = globalThis.Intl?.Segmenter;
  if (typeof Segmenter !== 'function') {
    return trimmed;
  }

  const segments = Array.from(new Segmenter('ja', { granularity: 'word' }).segment(rawTerm))
    .filter((segment) => segment.isWordLike || WORDLIKE_QUERY_PATTERN.test(segment.segment))
    .map((segment) => segment.segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return trimmed;
  }

  const normalized = segments.join(' ');
  return quoted ? `"${normalized}"` : normalized;
}

export function restoreSegmentedJapaneseText(value: string | undefined) {
  if (!value?.includes(' ') || !JAPANESE_QUERY_PATTERN.test(value)) {
    return value;
  }

  return value
    .replace(
      /(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu,
      '',
    )
    .replace(/(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])\s+(?=<mark\b)/gu, '')
    .replace(/(?<=<\/mark>)\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu, '')
    .replace(/(?<=<\/mark>)\s+(?=<mark\b)/gu, '')
    .replace(
      /(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])\s+(?=[、。，．！？：；」』）〉》】])/gu,
      '',
    )
    .replace(
      /(?<=[「『（〈《【])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu,
      '',
    )
    .replace(/(?<=[「『（〈《【])\s+(?=<mark\b)/gu, '')
    .replace(/(?<=<\/mark>)\s+(?=[、。，．！？：；」』）〉》】])/gu, '');
}

export function canonicalizePagefindResultUrl(url: string, origin: string) {
  try {
    const resolved = new URL(url, origin);
    if (resolved.origin !== origin) {
      return url;
    }

    if (resolved.pathname === '/index.html') {
      return `/${resolved.search}${resolved.hash}`;
    }

    if (resolved.pathname.endsWith('/index.html')) {
      const pathname = resolved.pathname.slice(0, -'/index.html'.length) || '/';
      return `${pathname}${resolved.search}${resolved.hash}`;
    }

    if (resolved.pathname.endsWith('.html')) {
      const pathname = resolved.pathname.slice(0, -'.html'.length) || '/';
      return `${pathname}${resolved.search}${resolved.hash}`;
    }

    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return url;
  }
}

export function canonicalizePagefindResult(result: PagefindSearchResult, origin: string) {
  const normalizedUrl = canonicalizePagefindResultUrl(result.url, origin);
  const normalizedMeta = canonicalizePagefindMeta(result.meta, origin);
  const normalizedSubResults = result.sub_results?.map((subResult) =>
    canonicalizePagefindSubResult(subResult, origin),
  );

  return {
    ...result,
    excerpt: restoreSegmentedJapaneseText(result.excerpt),
    meta: normalizedMeta,
    sub_results: normalizedSubResults ?? result.sub_results,
    url: normalizedUrl,
  };
}

function canonicalizePagefindMeta(meta: PagefindResultMeta | undefined, origin: string) {
  if (!meta) {
    return meta;
  }

  const normalizedMeta: PagefindResultMeta = { ...meta };
  for (const [key, value] of Object.entries(normalizedMeta)) {
    if (key === 'url' || typeof value !== 'string') {
      continue;
    }

    normalizedMeta[key] = restoreSegmentedJapaneseText(value);
  }

  if (typeof meta.url === 'string') {
    normalizedMeta.url = canonicalizePagefindResultUrl(meta.url, origin);
  }

  return normalizedMeta;
}

function canonicalizePagefindSubResult(subResult: PagefindSearchSubResult, origin: string) {
  const normalizedUrl =
    typeof subResult.url === 'string'
      ? canonicalizePagefindResultUrl(subResult.url, origin)
      : subResult.url;

  return {
    ...subResult,
    excerpt: restoreSegmentedJapaneseText(subResult.excerpt),
    meta: canonicalizePagefindMeta(subResult.meta, origin),
    title: restoreSegmentedJapaneseText(subResult.title),
    ...(normalizedUrl ? { url: normalizedUrl } : {}),
  };
}
