import { NONE, type Raster } from '../../shared/pixel/raster';

/**
 * 絵に触れたときの砂。触れた所のまわりの網点が粒になって、そのまま
 * 真下へこぼれ落ち、額の下へ抜けて消える（下に溜まらない）。粒は横へも
 * 上へも飛ばない。ほんの少しずつ遅れて離れるので、ざっと崩れるのでは
 * なく、さらさらと流れ落ちる。粒が抜けた所は点が欠け、その
 * 一帯は少したわんで下がる。欠けとたわみは 3 秒ほどで元に戻る。
 *
 * 座標はラスタの画素。カメラの揺れはわずかなので、欠けは画面に貼っておく。
 */

/** 欠けが戻り始めるまでの間（秒）と、戻りきるまでの長さ（秒）。 */
export const HOLD = 0.3;
export const RECOVER = 2.8;
/** 一度に落とす粒の上限。 */
export const MAX_GRAINS = 2400;

export class Sand {
  w = 0;
  h = 0;
  /** 欠けの深さ 0..1。点の抜けと、たわみの両方に使う。 */
  damage = new Float32Array(0);
  /** 各画素の欠けが戻り始める時刻。 */
  private since = new Float32Array(0);
  private gx: number[] = [];
  private gy: number[] = [];
  private vy: number[] = [];
  /** 離れるまでの待ち（秒）。 */
  private wait: number[] = [];
  private gc: number[] = [];

  resize(w: number, h: number) {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.damage = new Float32Array(w * h);
    this.since = new Float32Array(w * h);
    this.gx = [];
    this.gy = [];
    this.vy = [];
    this.wait = [];
    this.gc = [];
  }

  get grains(): number {
    return this.gx.length;
  }

  get busy(): boolean {
    return this.gx.length > 0 || this.damage.some((d) => d > 0);
  }

  /** (x, y) に触れた。color は今刷られている絵、random は 0..1 の乱数源。 */
  tap(x: number, y: number, color: Uint8Array, now: number, random: () => number = Math.random) {
    const { w, h } = this;
    const r = Math.max(6, Math.min(w, h) * 0.22);
    const x0 = Math.max(0, Math.floor(x - r));
    const x1 = Math.min(w - 1, Math.ceil(x + r));
    const y0 = Math.max(0, Math.floor(y - r));
    const y1 = Math.min(h - 1, Math.ceil(y + r));
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const d = Math.hypot(px - x, py - y) / r;
        if (d >= 1) continue;
        const k = py * w + px;
        const depth = 1 - d * d;
        if (depth > (this.damage[k] ?? 0)) this.damage[k] = depth;
        this.since[k] = now + HOLD;
        const c = color[k] ?? NONE;
        if (c === NONE || this.gx.length >= MAX_GRAINS) continue;
        if (random() > 0.75 * depth) continue;
        this.gx.push(px);
        this.gy.push(py);
        this.vy.push(0);
        // 触れた所に近い粒から先に、下の粒ほど先に離れる。
        this.wait.push(0.35 * d + 0.25 * random() + 0.15 * (1 - (py - y0) / (y1 - y0 + 1)));
        this.gc.push(c);
      }
    }
  }

  /** dt 秒すすめる。粒は落ち、額の外へ出たら消える。欠けは戻る。 */
  step(dt: number, now: number) {
    const g = this.h * 2.4;
    let n = 0;
    for (let i = 0; i < this.gx.length; i++) {
      const wait = (this.wait[i] ?? 0) - dt;
      const vy = wait > 0 ? 0 : (this.vy[i] ?? 0) + g * dt;
      const y = (this.gy[i] ?? 0) + vy * dt;
      if (y > this.h + 1) continue;
      this.gx[n] = this.gx[i] ?? 0;
      this.gy[n] = y;
      this.vy[n] = vy;
      this.wait[n] = wait;
      this.gc[n] = this.gc[i] ?? NONE;
      n++;
    }
    this.gx.length = n;
    this.gy.length = n;
    this.vy.length = n;
    this.wait.length = n;
    this.gc.length = n;
    const fall = dt / RECOVER;
    const { damage, since } = this;
    for (let k = 0; k < damage.length; k++) {
      const d = damage[k] ?? 0;
      if (d > 0 && now >= (since[k] ?? 0)) damage[k] = Math.max(0, d - fall);
    }
  }

  draw(r: Raster) {
    for (let i = 0; i < this.gx.length; i++) {
      r.set(this.gx[i] ?? -1, this.gy[i] ?? -1, this.gc[i] ?? NONE);
    }
  }
}
