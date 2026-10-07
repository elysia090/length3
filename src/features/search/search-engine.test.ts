import { describe, expect, it } from 'vitest';
import { slugOf, toHit } from './search-engine';

const origin = 'https://length3.test';

describe('slugOf', () => {
  it('reads the article slug from a site path', () => {
    expect(slugOf('/tail-byte-quotient')).toBe('tail-byte-quotient');
    expect(slugOf('/tail-byte-quotient#sec-2')).toBe('tail-byte-quotient');
    expect(slugOf('/tags/simd/')).toBe('tags/simd');
  });
});

describe('toHit', () => {
  it('canonicalises, builds the concordance line and keeps only section sub-results', () => {
    const hit = toHit(
      {
        url: '/simd-post.html',
        excerpt: 'before <mark>simd</mark> after',
        meta: { title: 'A SIMD post' },
        sub_results: [
          { title: 'A SIMD post', url: '/simd-post.html', excerpt: 'x' },
          {
            title: 'Lanes',
            url: '/simd-post.html#lanes',
            excerpt: 'eight <mark>simd</mark> lanes',
          },
        ],
      },
      origin,
    );
    expect(hit.url).toBe('/simd-post');
    expect(hit.slug).toBe('simd-post');
    expect(hit.title).toBe('A SIMD post');
    expect(hit.excerpt).toContain('<span class="kwic-k"><mark>simd</mark></span>');
    expect(hit.sections).toEqual([
      {
        title: 'Lanes',
        url: '/simd-post#lanes',
        excerpt: expect.stringContaining('kwic-k') as unknown as string,
      },
    ]);
  });
});
