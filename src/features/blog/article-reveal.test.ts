import { describe, expect, it } from 'vitest';
import {
  ARTICLE_REVEAL_STEP,
  formatRevealLabel,
  formatRevealStatus,
  INITIAL_VISIBLE_ARTICLES,
  nextVisibleCount,
  resolveRevealState,
} from './article-reveal';

describe('resolveRevealState', () => {
  it('reports the remainder and that more is left', () => {
    expect(resolveRevealState(9, 4)).toEqual({ visible: 4, remaining: 5, hasMore: true });
  });

  it('has nothing more to show once every card is visible', () => {
    expect(resolveRevealState(4, 4)).toEqual({ visible: 4, remaining: 0, hasMore: false });
  });

  it('clamps a visible count that overshoots the total', () => {
    expect(resolveRevealState(3, 4)).toEqual({ visible: 3, remaining: 0, hasMore: false });
  });

  it('clamps a negative visible count', () => {
    expect(resolveRevealState(3, -2)).toEqual({ visible: 0, remaining: 3, hasMore: true });
  });

  it('survives an empty list', () => {
    expect(resolveRevealState(0, INITIAL_VISIBLE_ARTICLES)).toEqual({
      visible: 0,
      remaining: 0,
      hasMore: false,
    });
  });
});

describe('nextVisibleCount', () => {
  it('opens one step at a time', () => {
    expect(nextVisibleCount(20, 5)).toBe(5 + ARTICLE_REVEAL_STEP);
  });

  it('opens only what is left when the tail is shorter than a step', () => {
    expect(nextVisibleCount(6, 5)).toBe(6);
  });

  it('never exceeds the total', () => {
    expect(nextVisibleCount(6, 6)).toBe(6);
  });

  it('treats a zero step as one so a click always makes progress', () => {
    expect(nextVisibleCount(10, 5, 0)).toBe(6);
  });
});

describe('formatRevealLabel', () => {
  it('names a full step', () => {
    expect(formatRevealLabel(9)).toBe('Show 4 more articles');
  });

  it('names the short tail rather than the step', () => {
    expect(formatRevealLabel(2)).toBe('Show 2 more articles');
  });

  it('uses the singular for a single remaining article', () => {
    expect(formatRevealLabel(1)).toBe('Show 1 more article');
  });
});

describe('formatRevealStatus', () => {
  it('reports what was added and what is left', () => {
    expect(formatRevealStatus(4, 5)).toBe('4 more articles shown. 5 remaining.');
  });

  it('says the list ended when nothing remains', () => {
    expect(formatRevealStatus(2, 0)).toBe('2 more articles shown. End of the list.');
  });

  it('uses the singular for a single addition', () => {
    expect(formatRevealStatus(1, 0)).toBe('1 more article shown. End of the list.');
  });
});
