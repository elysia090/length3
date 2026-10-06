import { describe, expect, it } from 'vitest';
import { toConcordance } from './concordance';

describe('toConcordance', () => {
  it('puts the first match between its left and right context', () => {
    expect(toConcordance('the identity <mark>monoid</mark> is free')).toBe(
      '<span class="kwic-l"><bdi>the identity</bdi></span>' +
        '<span class="kwic-k"><mark>monoid</mark></span>' +
        '<span class="kwic-r">is free</span>',
    );
  });

  it('treats adjacent marks as one keyword', () => {
    const out = toConcordance('a <mark>prefix</mark> <mark>sum</mark> over lanes') ?? '';
    expect(out).toContain('<span class="kwic-k"><mark>prefix</mark> <mark>sum</mark></span>');
    expect(out).toContain('<span class="kwic-r">over lanes</span>');
  });

  it('keeps later matches marked inside the right context', () => {
    const out = toConcordance('<mark>x</mark> and again <mark>x</mark>') ?? '';
    expect(out).toContain('<span class="kwic-l"><bdi></bdi></span>');
    expect(out).toContain('<span class="kwic-r">and again <mark>x</mark></span>');
  });

  it('works on unsegmented Japanese', () => {
    expect(toConcordance('ウェブにおける<mark>日本語</mark>タイポグラフィ')).toBe(
      '<span class="kwic-l"><bdi>ウェブにおける</bdi></span>' +
        '<span class="kwic-k"><mark>日本語</mark></span>' +
        '<span class="kwic-r">タイポグラフィ</span>',
    );
  });

  it('leaves an excerpt without a match alone', () => {
    expect(toConcordance('nothing here')).toBe('nothing here');
    expect(toConcordance(undefined)).toBeUndefined();
  });
});
