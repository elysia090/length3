/**
 * Benchmarks for the critical-path functions.
 *
 * Run with:  pnpm exec vitest bench
 *
 * Measures performance of:
 *   1. estimateReadingTime  – called for every post at build time and on every
 *      processPost() invocation in index/tag pages.
 *   2. parseFrontmatter     – called on every editor keystroke (shared result
 *      drives updateStatusCount immediately and renderPreview after debounce).
 *   3. renderPreview        – called after the 50ms debounce window; dominates
 *      the editor's per-keystroke cost when typing settles.
 *   4. tagToSlug            – called once per tag per page render.
 *
 * Sizes reflect realistic blog-post content (short ≈ 500 chars,
 * medium ≈ 5 000 chars, long ≈ 20 000 chars).
 */
import { bench, describe } from 'vitest';
import { parseFrontmatter, renderPreview } from './editor/preview';
import { estimateReadingTime, tagToSlug } from './utils';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const LOREM =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ' +
  'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ';

const CJK_CHUNK = '日本語のテキストサンプル。技術的なブログ記事の例。';

/** Latin-only text at three scales. */
const latinShort = LOREM.repeat(4).trim(); // ~500 chars, ~80 words
const latinMedium = LOREM.repeat(36).trim(); // ~5 000 chars, ~800 words
const latinLong = LOREM.repeat(144).trim(); // ~20 000 chars, ~3 200 words

/** Mixed CJK + Latin text at three scales. */
const mixedShort = (CJK_CHUNK + LOREM).repeat(3).trim();
const mixedMedium = (CJK_CHUNK + LOREM).repeat(22).trim();
const mixedLong = (CJK_CHUNK + LOREM).repeat(90).trim();

/** Pure CJK text. */
const cjkMedium = CJK_CHUNK.repeat(40).trim(); // ~1 000 CJK chars

const FRONTMATTER_SHORT = `---
title: Short Post
lang: en
tags: [astro, typescript]
date: 2026-01-01
---

${latinShort}`;

const FRONTMATTER_LONG = `---
title: A Very Long Technical Post About Performance Optimisation
lang: ja
tags: [performance, javascript, typescript, astro, cloudflare]
date: 2026-03-22
description: A deep-dive into measuring and optimising the critical render path.
---

${latinLong}`;

// ── estimateReadingTime ───────────────────────────────────────────────────────

describe('estimateReadingTime', () => {
  bench('Latin short (~80 words)', () => {
    estimateReadingTime(latinShort);
  });

  bench('Latin medium (~800 words)', () => {
    estimateReadingTime(latinMedium);
  });

  bench('Latin long (~3 200 words)', () => {
    estimateReadingTime(latinLong);
  });

  bench('CJK medium (~1 000 chars)', () => {
    estimateReadingTime(cjkMedium);
  });

  bench('Mixed short', () => {
    estimateReadingTime(mixedShort);
  });

  bench('Mixed medium', () => {
    estimateReadingTime(mixedMedium);
  });

  bench('Mixed long', () => {
    estimateReadingTime(mixedLong);
  });
});

// ── parseFrontmatter ──────────────────────────────────────────────────────────

describe('parseFrontmatter', () => {
  bench('short post', () => {
    parseFrontmatter(FRONTMATTER_SHORT);
  });

  bench('long post', () => {
    parseFrontmatter(FRONTMATTER_LONG);
  });

  bench('no frontmatter (plain body)', () => {
    parseFrontmatter(latinMedium);
  });
});

// ── tagToSlug ─────────────────────────────────────────────────────────────────

describe('tagToSlug', () => {
  bench('ASCII tag', () => {
    tagToSlug('TypeScript');
  });

  bench('CJK tag', () => {
    tagToSlug('機械学習');
  });

  bench('mixed ASCII+CJK', () => {
    tagToSlug('AI 機械学習');
  });
});

// ── renderPreview ─────────────────────────────────────────────────────────────
// renderPreview is the debounced half of the editor's per-keystroke path.
// It calls marked.parse(body) — an external library — so we can only
// characterise the cost, not eliminate it.  Benchmark here so regressions
// in our wrapper code are visible.

const previewOutput = (() => {
  // jsdom / happy-dom not available in bench context; mock the minimal
  // HTMLElement surface area renderPreview uses (setAttribute, innerHTML).
  let _lang = '';
  let _html = '';
  return {
    setAttribute(_: string, v: string) {
      _lang = v;
    },
    set innerHTML(v: string) {
      _html = v;
    },
    get lang() {
      return _lang;
    },
    get html() {
      return _html;
    },
  } as unknown as HTMLElement;
})();

describe('renderPreview', () => {
  const shortParsed = parseFrontmatter(FRONTMATTER_SHORT);
  const longParsed = parseFrontmatter(FRONTMATTER_LONG);

  bench('short post', () => {
    renderPreview(shortParsed, previewOutput);
  });

  bench('long post', () => {
    renderPreview(longParsed, previewOutput);
  });
});
