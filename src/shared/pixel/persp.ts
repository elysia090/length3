import { cross, dot, normalize, sub, type Vec3 } from './math';
import type { Projector } from './solids';

/**
 * 透視投影のカメラ。射撃場の一人称と About の石の煽りは、一覧や
 * Robot Tune の平行投影とは違うレンズが要る。奥行きは 1/z を返す: 画面上で線形に補間でき、
 * 近いほど大きいので Raster の Z バッファの約束（大きいほど手前）に合う。
 */
export class PerspView implements Projector {
  readonly eye: Vec3;
  readonly f: Vec3;
  readonly r: Vec3;
  readonly u: Vec3;

  constructor(
    eye: Vec3,
    yaw: number,
    pitch: number,
    readonly focal: number,
    readonly cx: number,
    readonly cy: number,
  ) {
    this.eye = eye;
    this.f = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
    this.r = normalize(cross(this.f, [0, 1, 0]));
    this.u = cross(this.r, this.f);
  }

  view(p: Vec3): Vec3 {
    const d = sub(p, this.eye);
    return [dot(d, this.r), dot(d, this.u), dot(d, this.f)];
  }

  project(p: Vec3): Vec3 {
    const v = this.view(p);
    const z = Math.max(v[2], 0.02);
    return [this.cx + (this.focal * v[0]) / z, this.cy - (this.focal * v[1]) / z, 1 / z];
  }

  /** 画面上の点を通る視線の向き（世界座標、単位ベクトル）。 */
  ray(sx: number, sy: number): Vec3 {
    const x = (sx - this.cx) / this.focal;
    const y = -(sy - this.cy) / this.focal;
    return normalize([
      this.f[0] + this.r[0] * x + this.u[0] * y,
      this.f[1] + this.r[1] * x + this.u[1] * y,
      this.f[2] + this.r[2] * x + this.u[2] * y,
    ]);
  }

  facing(n: Vec3, at: Vec3 = this.eye): boolean {
    return dot(n, sub(this.eye, at)) > 0;
  }

  /** カメラの前（手前の面より奥）にあるか。 */
  ahead(p: Vec3): boolean {
    return this.view(p)[2] > 0.05;
  }
}
