import { describe, expect, it } from 'vitest';
import { diffLetters, type Letter, queryVolume, voxelize } from './query-strip';
import { isGunman } from './search-play';

describe('query strip', () => {
  it('turns a glyph into voxels and a space into nothing', () => {
    expect(voxelize('I').length).toBeGreaterThan(5);
    expect(voxelize(' ')).toEqual([]);
  });

  it('keeps the common head, drops the tail and adds the new letters', () => {
    let letters: Letter[] = diffLetters([], 'monad', 0);
    expect(letters.map((l) => l.ch).join('')).toBe('monad');
    letters = diffLetters(letters, 'monoid', 1);
    const alive = letters.filter((l) => l.died === null).map((l) => l.ch);
    const dying = letters.filter((l) => l.died !== null).map((l) => l.ch);
    expect(alive.join('')).toBe('monoid');
    expect(dying.join('')).toBe('ad');
    // 頭の 3 字は打ち直されていない（落ち直さない）。
    expect(letters.filter((l) => l.died === null && l.born < 1)).toHaveLength(3);
  });

  it('measures the volume of the query in voxels', () => {
    const letters = diffLetters([], 'L', 0);
    expect(queryVolume(letters)).toBe(voxelize('L').length);
  });

  it('opens the range only for gunman', () => {
    expect(isGunman(' Gunman ')).toBe(true);
    expect(isGunman('gunmen')).toBe(false);
  });
});
