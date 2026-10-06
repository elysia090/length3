/**
 * 320 列前後の小さな画面に、三角形と線を Z バッファつきで描く。
 *
 * 色は 4 つしかない: 透明（ページの紙がそのまま見える）、紙、墨、琥珀。
 * 陰影は色を混ぜずに、4×4 の Bayer 行列で 2 色の点の比率に落とす。
 * 面の明るさが 0.5 なら紙と墨が市松になる。中間色を持たないので、
 * 拡大しても縁が滲まない。
 */

export const NONE = 0;
export const PAPER = 1;
export const INK = 2;
export const AMBER = 3;

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

export function threshold(x: number, y: number): number {
  return BAYER4[(y & 3) * 4 + (x & 3)] ?? 0.5;
}

export class Raster {
  w = 0;
  h = 0;
  color = new Uint8Array(0);
  depth = new Float32Array(0);

  resize(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.color = new Uint8Array(w * h);
    this.depth = new Float32Array(w * h);
  }

  clear(): void {
    this.color.fill(NONE);
    this.depth.fill(-Infinity);
  }

  set(px: number, py: number, c: number): void {
    const x = px | 0;
    const y = py | 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.color[y * this.w + x] = c;
  }

  rect(x: number, y: number, w: number, h: number, c: number): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }

  /**
   * 明るさ tone（0 = 暗、1 = 明）の三角形。暗い点を dark、明るい点を light で塗る。
   * decal は床に落とす影と点のためのもの: 何も描かれていない所にだけ暗い点を置き、
   * 深度は書かない。alt と mix は暗い点の色の溶け替え: mix の割合だけ alt になる。
   */
  tri(
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
    dark: number,
    light: number,
    decal = false,
    alt = dark,
    mix = 0,
  ): void {
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-6) return;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(this.w - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(this.h - 1, Math.ceil(Math.max(y0, y1, y2)));
    const inv = 1 / area;
    const { w, color, depth } = this;
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) * inv;
        const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) * inv;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const i = y * w + x;
        const dark1 = tone < threshold(x, y);
        if (decal) {
          if (depth[i] === -Infinity && dark1) color[i] = dark;
          continue;
        }
        const z = w0 * z0 + w1 * z1 + w2 * z2;
        if (z < (depth[i] ?? 0)) continue;
        depth[i] = z;
        color[i] = dark1 ? (mix > threshold(x + 1, y + 2) ? alt : dark) : light;
      }
    }
  }

  /**
   * 線。depthTest のときは面の少し手前（bias）までを見える扱いにする。
   * dash は [描く, 抜く] の画素数。
   */
  line(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    c: number,
    depthTest: boolean,
    bias = 0,
    dash?: readonly [number, number],
  ): void {
    let ax = Math.round(x0 - 0.5);
    let ay = Math.round(y0 - 0.5);
    const bx = Math.round(x1 - 0.5);
    const by = Math.round(y1 - 0.5);
    const dx = Math.abs(bx - ax);
    const dy = -Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1;
    const sy = ay < by ? 1 : -1;
    const steps = Math.max(dx, -dy);
    if (steps > 4000) return;
    let err = dx + dy;
    const { w, h, color, depth } = this;
    for (let n = 0; ; n++) {
      if (ax >= 0 && ay >= 0 && ax < w && ay < h) {
        const draw = !dash || n % (dash[0] + dash[1]) < dash[0];
        if (draw) {
          const i = ay * w + ax;
          const z = steps === 0 ? z0 : z0 + ((z1 - z0) * n) / steps;
          if (!depthTest || z + bias >= (depth[i] ?? 0)) color[i] = c;
        }
      }
      if (ax === bx && ay === by) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        ax += sx;
      }
      if (e2 <= dx) {
        err += dx;
        ay += sy;
      }
    }
  }

  present(out: Uint32Array, palette: Uint32Array): void {
    const { color } = this;
    for (let i = 0; i < color.length; i++) out[i] = palette[color[i] ?? 0] ?? 0;
  }
}
