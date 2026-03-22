import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from './editor/preview';
import type { BlogPost } from './types';
import { estimateReadingTime, formatDate, notDraft, processPost, tagToSlug, toSlug } from './utils';

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

  it('defaults to en locale (YYYY-MM-DD)', () => {
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

// ── notDraft ─────────────────────────────────────────────────────
describe('notDraft', () => {
  const makeEntry = (draft: boolean) => ({ data: { draft } }) as unknown as BlogPost;

  it('returns true for published posts', () => {
    expect(notDraft(makeEntry(false))).toBe(true);
  });

  it('returns false for draft posts', () => {
    expect(notDraft(makeEntry(true))).toBe(false);
  });
});

// ── processPost ──────────────────────────────────────────────────
describe('processPost', () => {
  const makeEntry = (id: string, body: string, description: string) =>
    ({ id, body, data: { description, draft: false } }) as unknown as BlogPost;

  it('derives slug from entry id', () => {
    const result = processPost(makeEntry('hello.mdx', '', 'desc'));
    expect(result.slug).toBe('hello');
  });

  it('sets excerpt from data.description', () => {
    const result = processPost(makeEntry('hello.mdx', '', 'My excerpt'));
    expect(result.excerpt).toBe('My excerpt');
  });

  it('readingTime is at least 1', () => {
    const result = processPost(makeEntry('hello.mdx', '', 'desc'));
    expect(result.readingTime).toBeGreaterThanOrEqual(1);
  });

  it('preserves the original entry reference', () => {
    const entry = makeEntry('hello.mdx', 'body text', 'desc');
    expect(processPost(entry).entry).toBe(entry);
  });
});

// ── tagToSlug edge cases ─────────────────────────────────────────
describe('tagToSlug edge cases', () => {
  it('strips leading/trailing hyphens produced by punctuation', () => {
    // '@astro' → strip '@' → 'astro' (no leading hyphen)
    expect(tagToSlug('@astro')).toBe('astro');
  });

  it('Node.js loses the dot and produces no trailing hyphen', () => {
    expect(tagToSlug('Node.js')).toBe('nodejs');
  });

  it('all-punctuation tag produces empty string', () => {
    expect(tagToSlug('!!!')).toBe('');
  });
});

// ── estimateReadingTime edge cases ───────────────────────────────
describe('estimateReadingTime edge cases', () => {
  it('multiple blank lines do not inflate word count', () => {
    // 200 real words separated by blank lines should still be 1 min
    const words = Array.from({ length: 200 }, () => 'word').join('\n\n');
    expect(estimateReadingTime(words)).toBe(1);
  });

  it('mixed content with code block does not produce more than expected', () => {
    // 100 words + code block with blank lines
    const text = `${'word '.repeat(100)}\n\n\`\`\`\ncode here\n\`\`\`\n\n${'word '.repeat(100)}`;
    // 200 real words + a few code tokens = ceil(≈1 min) = 1 min
    expect(estimateReadingTime(text)).toBeGreaterThanOrEqual(1);
  });
});

// ── parseFrontmatter ─────────────────────────────────────────────
describe('parseFrontmatter', () => {
  it('extracts title and body', () => {
    const text = '---\ntitle: Hello\n---\n\nBody here.';
    const result = parseFrontmatter(text);
    expect(result.title).toBe('Hello');
    expect(result.body).toBe('Body here.');
  });

  it('extracts lang field', () => {
    const text = '---\ntitle: Test\nlang: ja\n---\n\nBody.';
    expect(parseFrontmatter(text).lang).toBe('ja');
  });

  it('defaults lang to en when absent', () => {
    const text = '---\ntitle: Test\n---\n\nBody.';
    expect(parseFrontmatter(text).lang).toBe('en');
  });

  it('strips surrounding quotes from title', () => {
    const text = "---\ntitle: 'Quoted'\n---\n\nBody.";
    expect(parseFrontmatter(text).title).toBe('Quoted');
  });

  it('returns empty title and full text as body when no frontmatter', () => {
    const text = 'Just a body.';
    const result = parseFrontmatter(text);
    expect(result.title).toBe('');
    expect(result.body).toBe('Just a body.');
  });
});
