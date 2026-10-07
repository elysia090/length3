import { describe, expect, it } from 'vitest';
import { IDENTITY } from '../../shared/pixel/math';
import { View } from '../../shared/pixel/solids';
import {
  DIG_END,
  dig,
  FIND_DEPTH,
  newYard,
  PLUNGE,
  pitDepth,
  REFILL,
  visibleTreasures,
  yardShovel,
} from './yard';

describe('yard', () => {
  it('opens a pit where it digs, and the shovel ends up there', () => {
    const y = newYard([3, 2]);
    dig(y, 0.5, -1, 10, () => 0);
    expect(y.pits).toHaveLength(1);
    expect(y.home).toEqual([0.5, -1]);
    const base = { pivot: [3, 0, 2] as [number, number, number], scale: 1, rot: IDENTITY };
    const s = yardShovel(y, base, 10 + DIG_END + 0.1, false);
    expect(s.pivot[0]).toBeCloseTo(0.5);
    expect(s.pivot[2]).toBeCloseTo(-1);
  });

  it('unearths something on the third dig in the same spot', () => {
    const y = newYard([0, 0]);
    let opened = -1;
    for (let k = 0; k < FIND_DEPTH; k++) dig(y, 1, 1, 10 + k * 1.1, () => (opened = 4));
    expect(opened).toBe(4);
    const t = 10 + (FIND_DEPTH - 1) * 1.1 + PLUNGE + 0.5;
    expect(visibleTreasures(y, t)).toHaveLength(1);
    expect(visibleTreasures(y, t)[0]?.index).toBe(4);
  });

  it('lets pits fill back in', () => {
    const y = newYard([0, 0]);
    dig(y, 1, 1, 0, () => 0);
    const p = y.pits[0];
    expect(p).toBeDefined();
    if (!p) return;
    expect(pitDepth(p, PLUNGE)).toBeCloseTo(1);
    expect(pitDepth(p, PLUNGE + REFILL)).toBe(0);
  });

  it('moves the shovel continuously through a dig', () => {
    const y = newYard([0, 0]);
    dig(y, 2, 0, 0, () => 0);
    const base = { pivot: [0, 0, 0] as [number, number, number], scale: 1, rot: IDENTITY };
    let prev = yardShovel(y, base, 0, false).pivot;
    for (let t = 1 / 60; t < DIG_END + 0.2; t += 1 / 60) {
      const p = yardShovel(y, base, t, false).pivot;
      expect(Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2])).toBeLessThan(0.2);
      prev = p;
    }
  });
});

describe('View.unproject', () => {
  it('inverts project on the floor plane', () => {
    const v = new View(
      { azimuth: 0.7, elevation: 0.5, target: [1, 0.5, -1], span: 1 },
      12,
      160,
      90,
    );
    const q = v.project([2.5, 0, -0.75]);
    const p = v.unproject(q[0], q[1], 0);
    expect(p?.[0]).toBeCloseTo(2.5, 6);
    expect(p?.[2]).toBeCloseTo(-0.75, 6);
  });
});
