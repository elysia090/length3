import { describe, expect, it } from 'vitest';
import { handheld, ROLL, SWAY, ZOOM } from './handheld';
import { splitPlates } from './stage';

describe('handheld', () => {
  it('sways within its bounds and only slightly tilts', () => {
    for (let t = 0; t < 120; t += 0.37) {
      const s = handheld(t, false);
      expect(Math.abs(s.x)).toBeLessThanOrEqual(SWAY);
      expect(Math.abs(s.y)).toBeLessThanOrEqual(SWAY);
      expect(Math.abs(s.roll)).toBeLessThanOrEqual(ROLL);
      expect(Math.abs(s.roll)).toBeLessThan((0.6 * Math.PI) / 180);
    }
  });

  it('stays close enough that the frame edge never shows', () => {
    for (let t = 0; t < 120; t += 0.37) {
      const s = handheld(t, false);
      // 傾きと横ずれで覗く分（幅に対する割合）を寄りが覆う。
      const reveal = Math.abs(s.x) + Math.abs(s.y) + Math.abs(Math.sin(s.roll)) * 0.5;
      expect(s.zoom - 1).toBeGreaterThan(reveal);
    }
  });

  it('moves', () => {
    expect(handheld(1, false)).not.toEqual(handheld(2, false));
  });

  it('holds still when motion is reduced', () => {
    expect(handheld(3, true)).toEqual({ x: 0, y: 0, roll: 0, zoom: ZOOM });
  });
});

describe('splitPlates', () => {
  it('reads ink, swap and shadow from the R, G and B channels', () => {
    const rgba = new Uint8Array([255, 0, 51, 255, 0, 255, 0, 255]);
    const p = splitPlates(rgba, 2, 1);
    expect(Array.from(p.ink)).toEqual([1, 0]);
    expect(Array.from(p.swap)).toEqual([0, 1]);
    expect(p.shadow[0]).toBeCloseTo(0.2);
  });
});
