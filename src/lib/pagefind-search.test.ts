import { describe, expect, it } from 'vitest';
import {
  buildMergedPagefindIndexes,
  canonicalizePagefindResult,
  canonicalizePagefindResultUrl,
  getPageLanguage,
  normalizePagefindSearchTerm,
} from './pagefind-search';

describe('normalizePagefindSearchTerm', () => {
  it('segments Japanese queries into Pagefind-friendly words', () => {
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
  it('merges the other site language into the current search UI', () => {
    expect(
      buildMergedPagefindIndexes('https://example.test/pagefind/pagefind-ui.js', 'en'),
    ).toEqual([{ bundlePath: 'https://example.test/pagefind/', language: 'ja' }]);
    expect(
      buildMergedPagefindIndexes('https://example.test/pagefind/pagefind-ui.js', 'ja'),
    ).toEqual([{ bundlePath: 'https://example.test/pagefind/', language: 'en' }]);
  });

  it('skips merging when the page language is unknown', () => {
    expect(
      buildMergedPagefindIndexes('https://example.test/pagefind/pagefind-ui.js', null),
    ).toEqual([]);
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
  it('normalizes the primary url and metadata url together', () => {
    expect(
      canonicalizePagefindResult(
        {
          meta: {
            title: 'Astro',
            url: '/tags/astro.html',
          },
          sub_results: [
            {
              meta: { url: '/getting-started.html#section' },
              title: 'Section',
              url: '/getting-started.html#section',
            },
          ],
          url: '/getting-started.html',
        },
        origin,
      ),
    ).toEqual({
      meta: {
        title: 'Astro',
        url: '/tags/astro',
      },
      sub_results: [
        {
          meta: { url: '/getting-started#section' },
          title: 'Section',
          url: '/getting-started#section',
        },
      ],
      url: '/getting-started',
    });
  });
});
