import { describe, expect, it } from 'vitest';
import { estimateReadingTime, formatDate, tagToSlug, toSlug } from './utils';

// ── toSlug ───────────────────────────────────────────────────────
describe('toSlug', () => {
  it('strips .mdx extension', () => {
    expect(toSlug('getting-started.mdx')).toBe('getting-started');
  });

  it('strips .md extension', () => {
    expect(toSlug('hello.md')).toBe('hello');
  });

  it('lowercases the result', () => {
    expect(toSlug('Hello-World.mdx')).toBe('hello-world');
  });

  it('leaves slugs without a known extension unchanged', () => {
    expect(toSlug('no-extension')).toBe('no-extension');
  });

  it('handles nested path IDs (Content Layer format)', () => {
    expect(toSlug('2026/getting-started.mdx')).toBe('2026/getting-started');
  });
});

// ── tagToSlug ────────────────────────────────────────────────────
describe('tagToSlug', () => {
  it('lowercases ASCII tags', () => {
    expect(tagToSlug('Astro')).toBe('astro');
  });

  it('replaces spaces with hyphens', () => {
    expect(tagToSlug('machine learning')).toBe('machine-learning');
  });

  it('strips non-alphanumeric ASCII symbols', () => {
    expect(tagToSlug('C++')).toBe('c');
  });

  it('preserves CJK characters (prevents empty-slug bug)', () => {
    expect(tagToSlug('機械学習')).toBe('機械学習');
  });

  it('handles mixed CJK and Latin', () => {
    expect(tagToSlug('AI 機械学習')).toBe('ai-機械学習');
  });

  it('strips leading/trailing hyphens from punctuation-only boundaries', () => {
    // punctuation that maps to "-" should not produce stray hyphens
    expect(tagToSlug('typescript')).toBe('typescript');
  });
});

// ── estimateReadingTime ──────────────────────────────────────────
describe('estimateReadingTime', () => {
  it('returns at least 1 for any input', () => {
    expect(estimateReadingTime('')).toBe(1);
    expect(estimateReadingTime('hi')).toBe(1);
  });

  it('200 Latin words → 1 min', () => {
    expect(estimateReadingTime('word '.repeat(200).trim())).toBe(1);
  });

  it('201 Latin words → 2 min (ceil)', () => {
    expect(estimateReadingTime('word '.repeat(201).trim())).toBe(2);
  });

  it('400 CJK chars → 1 min', () => {
    expect(estimateReadingTime('漢'.repeat(400))).toBe(1);
  });

  it('401 CJK chars → 2 min (ceil)', () => {
    expect(estimateReadingTime('漢'.repeat(401))).toBe(2);
  });

  it('mixed CJK + Latin accumulates both rates', () => {
    // 200 CJK (0.5 min) + 100 Latin words (0.5 min) = ceil(1.0) = 1
    const text = `${'漢'.repeat(200)} ${'word '.repeat(100).trim()}`;
    expect(estimateReadingTime(text)).toBe(1);
  });
});

// ── formatDate ───────────────────────────────────────────────────
describe('formatDate', () => {
  // Use a fixed UTC midnight so local-timezone offsets do not shift the date
  const date = new Date('2026-03-20T12:00:00Z');

  it('defaults to en-CA locale (YYYY-MM-DD)', () => {
    expect(formatDate(date, 'en')).toMatch(/^2026-\d{2}-\d{2}$/);
  });

  it('en locale includes the year 2026', () => {
    expect(formatDate(date, 'en')).toContain('2026');
  });

  it('ja locale uses YYYY/MM/DD format', () => {
    expect(formatDate(date, 'ja')).toMatch(/2026\/\d{2}\/\d{2}/);
  });

  it('ja locale includes the year 2026', () => {
    expect(formatDate(date, 'ja')).toContain('2026');
  });
});
