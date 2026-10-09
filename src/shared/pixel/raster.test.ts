import { describe, expect, it } from 'vitest';
import { Raster, threshold } from './raster';

/** 素朴な塗り（外接矩形の点を全部、元の式で判定する）。速い塗りと同じ点を塗るかを比べる。 */
function naive(
  r: Raster,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number,
  tone: number,
): void {
  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(area) < 1e-6) return;
  const inv = 1 / area;
  for (
    let y = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    y <= Math.min(r.h - 1, Math.ceil(Math.max(y0, y1, y2)));
    y++
  )
    for (
      let x = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
      x <= Math.min(r.w - 1, Math.ceil(Math.max(x0, x1, x2)));
      x++
    ) {
      const px = x + 0.5;
      const py = y + 0.5;
      const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) * inv;
      const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) * inv;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const i = y * r.w + x;
      const z = w0 * z0 + w1 * z1 + w2 * z2;
      if (z < (r.depth[i] ?? 0)) continue;
      r.depth[i] = z;
      r.color[i] = tone < threshold(x, y) ? 2 : 1;
    }
}

describe('raster', () => {
  it('fills exactly the same pixels as the naive triangle test', () => {
    let s = 4242;
    const rnd = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    const a = new Raster();
    const b = new Raster();
    a.resize(160, 90);
    b.resize(160, 90);
    a.clear();
    b.clear();
    for (let k = 0; k < 3000; k++) {
      const v = [
        rnd() * 200 - 20,
        rnd() * 130 - 20,
        rnd(),
        rnd() * 200 - 20,
        rnd() * 130 - 20,
        rnd(),
        rnd() * 200 - 20,
        rnd() * 130 - 20,
        rnd(),
        rnd(),
      ] as const;
      a.tri(...v, 2, 1);
      naive(b, ...v);
    }
    expect(Array.from(a.color)).toEqual(Array.from(b.color));
  });
});
