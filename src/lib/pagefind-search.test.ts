import { describe, expect, it } from 'vitest';
import {
  buildMergedPagefindIndexes,
  canonicalizePagefindResult,
  canonicalizePagefindResultUrl,
  getPageLanguage,
  getSearchCopy,
  normalizePagefindSearchTerm,
  restoreSegmentedJapaneseText,
} from './pagefind-search';

describe('normalizePagefindSearchTerm', () => {
  it('segments Japanese queries into Pagefind-friendly words', () => {
    expect(normalizePagefindSearchTerm('ウェブ')).toBe('ウェブ');
    expect(normalizePagefindSearchTerm('日本語タイポグラフィ')).toBe('日本語 タイポグラフィ');
    expect(normalizePagefindSearchTerm('ウェブにおける日本語タイポグラフィ')).toBe(
      'ウェブ における 日本語 タイポグラフィ',
    );
  });

  it('preserves quoted phrase searches while segmenting Japanese content', () => {
    expect(normalizePagefindSearchTerm('"日本語タイポグラフィ"')).toBe('"日本語 タイポグラフィ"');
  });

  it('leaves non-Japanese queries unchanged', () => {
    expect(normalizePagefindSearchTerm('astro pagefind')).toBe('astro pagefind');
    expect(normalizePagefindSearchTerm('Astro日本語123')).toBe('Astro 日本語 123');
  });
});

describe('restoreSegmentedJapaneseText', () => {
  it('removes segmentation spaces from Japanese display strings', () => {
    expect(restoreSegmentedJapaneseText('ウェブ における 日本語 タイポグラフィ')).toBe(
      'ウェブにおける日本語タイポグラフィ',
    );
    expect(restoreSegmentedJapaneseText('日本語 <mark>タイポグラフィ</mark>')).toBe(
      '日本語<mark>タイポグラフィ</mark>',
    );
    expect(restoreSegmentedJapaneseText('「 日本語 」')).toBe('「日本語」');
  });

  it('keeps non-Japanese spacing intact', () => {
    expect(restoreSegmentedJapaneseText('astro pagefind')).toBe('astro pagefind');
  });
});

describe('getPageLanguage', () => {
  it('extracts supported site languages from html lang values', () => {
    expect(getPageLanguage('en')).toBe('en');
    expect(getPageLanguage('en-GB')).toBe('en');
    expect(getPageLanguage('ja')).toBe('ja');
    expect(getPageLanguage('ja-JP')).toBe('ja');
    expect(getPageLanguage('fr')).toBeNull();
  });
});

describe('buildMergedPagefindIndexes', () => {
  it('uses a single shared index for every page language', () => {
    expect(
      buildMergedPagefindIndexes('https://example.test/pagefind/pagefind-ui.js', 'en'),
    ).toEqual([]);
    expect(
      buildMergedPagefindIndexes('https://example.test/pagefind/pagefind-ui.js', 'ja'),
    ).toEqual([]);
    expect(
      buildMergedPagefindIndexes('https://example.test/pagefind/pagefind-ui.js', null),
    ).toEqual([]);
  });
});

describe('getSearchCopy', () => {
  it('returns Japanese search copy for Japanese pages', () => {
    const copy = getSearchCopy('ja');

    expect(copy.searchLabel).toBe('記事を検索');
    expect(copy.searchPlaceholder).toBe('記事を検索…');
    expect(copy.resultCount(1)).toBe('1件の検索結果があります。');
  });
});

describe('canonicalizePagefindResultUrl', () => {
  const origin = 'https://example.test';

  it('strips .html from same-origin result paths', () => {
    expect(canonicalizePagefindResultUrl('/getting-started.html', origin)).toBe('/getting-started');
  });

  it('converts index.html routes to canonical paths', () => {
    expect(canonicalizePagefindResultUrl('/index.html', origin)).toBe('/');
    expect(canonicalizePagefindResultUrl('/index.html?q=pagefind#top', origin)).toBe(
      '/?q=pagefind#top',
    );
    expect(canonicalizePagefindResultUrl('/tags/index.html?view=all#top', origin)).toBe(
      '/tags?view=all#top',
    );
  });

  it('preserves external URLs unchanged', () => {
    expect(canonicalizePagefindResultUrl('https://external.test/docs.html', origin)).toBe(
      'https://external.test/docs.html',
    );
  });

  it('preserves search and hash fragments on same-origin URLs', () => {
    expect(canonicalizePagefindResultUrl('/tags/astro.html?tab=latest#results', origin)).toBe(
      '/tags/astro?tab=latest#results',
    );
  });

  it('normalizes urls and restores Japanese display strings together', () => {
    expect(
      canonicalizePagefindResult(
        {
          excerpt: 'ウェブ における <mark>日本語</mark> タイポグラフィ',
          meta: {
            title: 'ウェブ における 日本語 タイポグラフィ',
            url: '/japanese-test.html',
          },
          sub_results: [
            {
              excerpt: '日本語 <mark>タイポグラフィ</mark>',
              meta: { url: '/getting-started.html#section' },
              title: '日本語 タイポグラフィ',
              url: '/getting-started.html#section',
            },
          ],
          url: '/getting-started.html',
        },
        origin,
      ),
    ).toEqual({
      excerpt: 'ウェブにおける<mark>日本語</mark>タイポグラフィ',
      meta: {
        title: 'ウェブにおける日本語タイポグラフィ',
        url: '/japanese-test',
      },
      sub_results: [
        {
          excerpt: '日本語<mark>タイポグラフィ</mark>',
          meta: { url: '/getting-started#section' },
          title: '日本語タイポグラフィ',
          url: '/getting-started#section',
        },
      ],
      url: '/getting-started',
    });
  });

  it('normalizes Japanese article results to the runtime route', () => {
    expect(
      canonicalizePagefindResult(
        {
          meta: {
            title: 'ウェブにおける日本語タイポグラフィ',
            url: '/japanese-test.html',
          },
          url: '/japanese-test.html',
        },
        origin,
      ),
    ).toEqual({
      meta: {
        title: 'ウェブにおける日本語タイポグラフィ',
        url: '/japanese-test',
      },
      sub_results: undefined,
      url: '/japanese-test',
    });
  });
});
