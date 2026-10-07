import { describe, expect, it } from 'vitest';
import { INK, NONE } from '../../shared/pixel/raster';
import { HOLD, RECOVER, Sand } from './sand';

function picture(w: number, h: number) {
  // 左半分だけが刷られている絵。
  const c = new Uint8Array(w * h).fill(NONE);
  for (let y = 0; y < h; y++) for (let x = 0; x < w / 2; x++) c[y * w + x] = INK;
  return c;
}

describe('Sand', () => {
  it('turns printed dots near the touch into grains, and only printed dots', () => {
    const s = new Sand();
    s.resize(100, 60);
    s.tap(75, 30, picture(100, 60), 0, () => 0);
    expect(s.grains).toBe(0); // 右半分は白い
    s.tap(25, 30, picture(100, 60), 0, () => 0);
    expect(s.grains).toBeGreaterThan(50);
    expect(s.damage[30 * 100 + 25]).toBeCloseTo(1, 5);
  });

  it('lets the grains spill straight down and out of the frame instead of piling up', () => {
    const s = new Sand();
    s.resize(100, 60);
    s.tap(25, 30, picture(100, 60), 0, () => 0.2);
    for (let t = 0; t < 2.5; t += 0.04) s.step(0.04, t);
    expect(s.grains).toBe(0);
  });

  it('holds the dent briefly, then recovers completely', () => {
    const s = new Sand();
    s.resize(100, 60);
    s.tap(25, 30, picture(100, 60), 0, () => 0.9);
    const k = 30 * 100 + 25;
    s.step(0.1, HOLD * 0.5);
    expect(s.damage[k]).toBeCloseTo(1, 5);
    let t = HOLD;
    while (t < HOLD + RECOVER + 0.5) {
      s.step(0.05, t);
      t += 0.05;
    }
    expect(s.damage[k]).toBe(0);
    expect(s.busy).toBe(false);
  });
});
