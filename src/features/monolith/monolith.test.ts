import { describe, expect, it } from 'vitest';
import { ALIGN, CUT, monolithAt } from './choreo';

describe('monolithAt', () => {
  it('has no sun and is not aligned while untouched', () => {
    for (let t = 0; t < CUT * 5; t += 0.7) {
      const f = monolithAt(t, -100, false);
      expect(f.sun).toBe(0);
      expect(f.aligned).toBe(false);
    }
  });

  it('cuts to a new angle every CUT seconds', () => {
    const a = monolithAt(CUT - 0.01, -100, true);
    const b = monolithAt(CUT + 0.01, -100, true);
    expect(Math.abs(a.azimuth - b.azimuth) + Math.abs(a.elevation - b.elevation)).toBeGreaterThan(
      0.1,
    );
  });

  it('faces the slab head-on from the ground and raises the sun when touched', () => {
    const f = monolithAt(12 + 2.5, 12, false);
    expect(f.aligned).toBe(true);
    expect(Math.cos(f.azimuth)).toBeCloseTo(1, 3);
    expect(f.elevation).toBeCloseTo(-0.06, 3);
    expect(f.sun).toBeGreaterThan(0.8);
  });

  it('returns to the tour after ALIGN seconds', () => {
    const f = monolithAt(12 + ALIGN + 0.01, 12, false);
    expect(f.aligned).toBe(false);
    expect(f.sun).toBe(0);
  });

  it('holds a still frame when motion is reduced', () => {
    expect(monolithAt(1, -100, true)).toEqual(monolithAt(5, -100, true));
  });
});
