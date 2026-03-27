import { describe, expect, it } from 'vitest';
import {
  formatArticleReadingTime,
  formatCompactReadingTime,
  formatRemainingReadingTime,
  getSiteCopy,
} from './ui-copy';

describe('getSiteCopy', () => {
  it('returns Japanese shared UI labels for Japanese pages', () => {
    const copy = getSiteCopy('ja');

    expect(copy.skipToMainContent).toBe('本文へ移動');
    expect(copy.tableOfContents).toBe('目次');
    expect(copy.copyLink).toBe('リンクをコピー');
  });
});

describe('reading time formatters', () => {
  it('formats Japanese reading time copy', () => {
    expect(formatCompactReadingTime(8, 'ja')).toBe('8分');
    expect(formatArticleReadingTime(8, 'ja')).toBe('8分で読める');
    expect(formatRemainingReadingTime(6, 'ja')).toBe('約6分');
    expect(formatRemainingReadingTime(0, 'ja')).toBe('1分未満');
  });
});
