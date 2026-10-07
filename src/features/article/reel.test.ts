import { describe, expect, it } from 'vitest';
import { reelCount } from './reel';

describe('reelCount', () => {
  it('drops one cube per 1/27 of the article', () => {
    expect(reelCount(0)).toBe(0);
    expect(reelCount(1 / 27)).toBe(1);
    expect(reelCount(0.5)).toBe(13);
    expect(reelCount(1)).toBe(27);
  });

  it('clamps out-of-range progress', () => {
    expect(reelCount(-1)).toBe(0);
    expect(reelCount(2)).toBe(27);
  });
});
