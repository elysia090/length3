import { describe, expect, it } from 'vitest';
import {
  formatArticleReadingTime,
  formatCompactReadingTime,
  formatHiddenTopicsLabel,
  formatRemainingReadingTime,
  getSiteCopy,
} from './site-copy';

describe('getSiteCopy', () => {
  it('returns English UI labels for Japanese pages', () => {
    const copy = getSiteCopy('ja');

    expect(copy.skipToMainContent).toBe('本文へ移動');
    expect(copy.tableOfContents).toBe('目次');
    expect(copy.copyLink).toBe('Copy link');
    expect(copy.articles).toBe('Articles');
    expect(copy.about).toBe('About');
    expect(copy.updatedPrefix).toBe('upd.');
    expect(copy.read).toBe('read');
    expect(copy.left).toBe('left');
    expect(copy.total).toBe('total');
    expect(copy.share).toBe('Share');
    expect(copy.topicsShowLess).toBe('閉じる');
  });
});

describe('formatHiddenTopicsLabel', () => {
  it('labels the collapsed remainder of the topic list per language', () => {
    expect(formatHiddenTopicsLabel(18, 'en')).toBe('+18 more');
    expect(formatHiddenTopicsLabel(18, 'ja')).toBe('他 18 件');
  });

  it('falls back to English when no language is given', () => {
    expect(formatHiddenTopicsLabel(1, null)).toBe('+1 more');
    expect(formatHiddenTopicsLabel(1, undefined)).toBe('+1 more');
  });
});

describe('reading time formatters', () => {
  it('formats reading time in English regardless of language', () => {
    expect(formatCompactReadingTime(8, 'ja')).toBe('8 min');
    expect(formatArticleReadingTime(8, 'ja')).toBe('8 min read');
    expect(formatRemainingReadingTime(6, 'ja')).toBe('~6 min');
    expect(formatRemainingReadingTime(0, 'ja')).toBe('< 1 min');
    expect(formatCompactReadingTime(8, 'en')).toBe('8 min');
    expect(formatArticleReadingTime(8, 'en')).toBe('8 min read');
  });
});
