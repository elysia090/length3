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
 *   5. buildTagIndex        – called once per tag page at build time; cost
 *      scales with posts × tags-per-post.
 *
 * Latin fixture sizes (chars / words):
 *   short  ≈   495 chars /   76 words   (LOREM × 4)
 *   medium ≈ 4 463 chars /  684 words   (LOREM × 36)
 *   long   ≈ 17 855 chars / 2 736 words  (LOREM × 144)
 *
 * Mixed fixtures interleave CJK_CHUNK (25 chars) + LOREM (124 chars) per unit:
 *   short  ≈   446 chars   (× 3)
 *   medium ≈ 3 277 chars   (× 22)
 *   long   ≈ 13 409 chars  (× 90)
 */
import { bench, describe } from 'vitest';
import { parseFrontmatter, renderPreview } from './editor/preview';
import type { BlogPost } from './types';
import { buildTagIndex, estimateReadingTime, tagToSlug } from './utils';

// ── Text fixtures ─────────────────────────────────────────────────────────────

const LOREM =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ' +
  'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ';

const CJK_CHUNK = '日本語のテキストサンプル。技術的なブログ記事の例。';

const latinShort = LOREM.repeat(4).trim(); // 495 chars, 76 words
const latinMedium = LOREM.repeat(36).trim(); // 4 463 chars, 684 words
const latinLong = LOREM.repeat(144).trim(); // 17 855 chars, 2 736 words

const mixedShort = (CJK_CHUNK + LOREM).repeat(3).trim(); // 446 chars
const mixedMedium = (CJK_CHUNK + LOREM).repeat(22).trim(); // 3 277 chars
const mixedLong = (CJK_CHUNK + LOREM).repeat(90).trim(); // 13 409 chars

const cjkMedium = CJK_CHUNK.repeat(40).trim(); // 1 000 CJK chars

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

// ── buildTagIndex fixtures ────────────────────────────────────────────────────
// Only data.tags is accessed by buildTagIndex, so the mock can be minimal.

const makePost = (tags: string[]) => ({ data: { tags } }) as unknown as BlogPost;

const SMALL_POSTS = Array.from({ length: 20 }, (_, i) =>
  makePost(['astro', 'typescript', i % 2 === 0 ? 'performance' : 'design']),
);

const LARGE_POSTS = Array.from({ length: 200 }, (_, i) =>
  makePost(['astro', `topic-${i % 20}`, 'typescript', 'performance', 'web']),
);

// ── renderPreview mock ────────────────────────────────────────────────────────
// Minimal HTMLElement surface used by renderPreview (setAttribute + innerHTML).
// _htmlSink accumulates string lengths so V8 cannot prove the innerHTML write
// is dead and eliminate the marked.parse call upstream (DCE prevention).
// Accumulation (+=) also satisfies noUnusedVariables since the variable is both
// read and written.

let _htmlSink = 0;
const previewOutput = {
  setAttribute(_attr: string, _value: string) {},
  set innerHTML(v: string) {
    _htmlSink += v.length;
  },
} as unknown as HTMLElement;

// ── estimateReadingTime ───────────────────────────────────────────────────────

describe('estimateReadingTime', () => {
  bench('Latin short (~76 words)', () => {
    estimateReadingTime(latinShort);
  });

  bench('Latin medium (~684 words)', () => {
    estimateReadingTime(latinMedium);
  });

  bench('Latin long (~2 736 words)', () => {
    estimateReadingTime(latinLong);
  });

  bench('CJK medium (~1 000 chars)', () => {
    estimateReadingTime(cjkMedium);
  });

  bench('Mixed short (~446 chars)', () => {
    estimateReadingTime(mixedShort);
  });

  bench('Mixed medium (~3 277 chars)', () => {
    estimateReadingTime(mixedMedium);
  });

  bench('Mixed long (~13 409 chars)', () => {
    estimateReadingTime(mixedLong);
  });
});

// ── parseFrontmatter ──────────────────────────────────────────────────────────

describe('parseFrontmatter', () => {
  bench('4-field FM + short body', () => {
    parseFrontmatter(FRONTMATTER_SHORT);
  });

  bench('5-field FM + long body', () => {
    parseFrontmatter(FRONTMATTER_LONG);
  });

  bench('no frontmatter — early return', () => {
    parseFrontmatter(latinMedium);
  });
});

// ── tagToSlug ─────────────────────────────────────────────────────────────────

describe('tagToSlug', () => {
  bench('Latin tag', () => {
    tagToSlug('TypeScript');
  });

  bench('CJK tag', () => {
    tagToSlug('機械学習');
  });

  bench('mixed Latin+CJK', () => {
    tagToSlug('AI 機械学習');
  });
});

// ── buildTagIndex ─────────────────────────────────────────────────────────────

describe('buildTagIndex', () => {
  bench('20 posts × 3 tags', () => {
    buildTagIndex(SMALL_POSTS);
  });

  bench('200 posts × 5 tags', () => {
    buildTagIndex(LARGE_POSTS);
  });
});

// ── renderPreview ─────────────────────────────────────────────────────────────
// renderPreview is the debounced half of the editor's per-keystroke path.
// It calls marked.parse(body) — an external library — so we can only
// characterise the cost, not eliminate it.  Benchmarked here so regressions
// in our wrapper code are visible.

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
