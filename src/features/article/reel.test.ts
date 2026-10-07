import { describe, expect, it } from 'vitest';
import { filmTime, reelCount } from './reel';

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

describe('filmTime', () => {
  it('formats minutes as HH:MM:SS:FF at 24 frames', () => {
    expect(filmTime(0)).toBe('00:00:00:00');
    expect(filmTime(1)).toBe('00:01:00:00');
    expect(filmTime(0.5 / 60)).toBe('00:00:00:12');
    expect(filmTime(75.5)).toBe('01:15:30:00');
  });
});
