import { describe, expect, it } from 'vitest';
import { calculateReadingProgress } from './article-actions';

describe('calculateReadingProgress', () => {
  it('starts at zero percent with the full reading time remaining', () => {
    expect(
      calculateReadingProgress({
        readingTime: 8,
        scrollHeight: 2000,
        scrollY: 0,
        viewportHeight: 1000,
      }),
    ).toEqual({
      ariaValueNow: '0',
      minutesLeft: 8,
      minutesLeftLabel: '~8 min',
      percentRead: 0,
      progressValue: '0%',
    });
  });

  it('caps progress at one hundred percent', () => {
    expect(
      calculateReadingProgress({
        readingTime: 8,
        scrollHeight: 2000,
        scrollY: 2000,
        viewportHeight: 1000,
      }),
    ).toEqual({
      ariaValueNow: '100',
      minutesLeft: 0,
      minutesLeftLabel: '< 1 min',
      percentRead: 100,
      progressValue: '100%',
    });
  });

  it('handles non-scrollable pages without dividing by zero', () => {
    expect(
      calculateReadingProgress({
        readingTime: 5,
        scrollHeight: 800,
        scrollY: 100,
        viewportHeight: 800,
      }),
    ).toEqual({
      ariaValueNow: '0',
      minutesLeft: 5,
      minutesLeftLabel: '~5 min',
      percentRead: 0,
      progressValue: '0%',
    });
  });
});
