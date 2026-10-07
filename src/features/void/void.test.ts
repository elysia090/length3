import { describe, expect, it } from 'vitest';
import { voxels404 } from './stage';

describe('voxels404', () => {
  it('builds three glyphs on a single plane, standing on the floor', () => {
    const v = voxels404();
    expect(v.length).toBeGreaterThan(30);
    expect(v.every((p) => p[2] === 0)).toBe(true);
    expect(Math.min(...v.map((p) => p[1]))).toBe(0);
    expect(new Set(v.map((p) => p.join(','))).size).toBe(v.length);
  });

  it('is symmetric: both 4s use the same cells', () => {
    const v = voxels404();
    const left = v.filter((p) => p[0] < -3).map((p) => `${p[0] + 12},${p[1]}`);
    const right = v.filter((p) => p[0] >= 4).map((p) => `${p[0]},${p[1]}`);
    expect(left.sort()).toEqual(right.sort());
  });
});
