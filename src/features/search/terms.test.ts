import { describe, expect, it } from 'vitest';
import { groupTerms, initialOf, isGunman, nearestTerms } from './terms';

const terms = [
  { name: 'simd', count: 3 },
  { name: 'astro', count: 2 },
  { name: 'animation', count: 1 },
  { name: '短編', count: 1 },
  { name: '3d', count: 1 },
  { name: 'bitwise', count: 3 },
];

describe('groupTerms', () => {
  it('groups by initial like a back-of-book index, digits first and kana/kanji last', () => {
    const groups = groupTerms(terms);
    expect(groups.map((g) => g.letter)).toEqual(['0–9', 'A', 'B', 'S', '和']);
    expect(groups[1]?.terms.map((t) => t.name)).toEqual(['animation', 'astro']);
  });

  it('reads the initial through a leading #', () => {
    expect(initialOf('#css')).toBe('C');
    expect(initialOf('短編')).toBe('和');
  });
});

describe('nearestTerms', () => {
  it('offers partial matches first', () => {
    expect(nearestTerms('sim', terms).map((t) => t.name)[0]).toBe('simd');
  });

  it('forgives small misspellings', () => {
    expect(nearestTerms('bitwize', terms).map((t) => t.name)).toContain('bitwise');
  });

  it('falls back to the most used topics when nothing is close', () => {
    expect(nearestTerms('zzzzzzzz', terms, 2).map((t) => t.name)).toEqual(['simd', 'bitwise']);
  });
});

describe('isGunman', () => {
  it('opens the range only for gunman', () => {
    expect(isGunman(' Gunman ')).toBe(true);
    expect(isGunman('gunmen')).toBe(false);
  });
});
