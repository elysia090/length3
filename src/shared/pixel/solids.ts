import {
  add,
  apply,
  clamp,
  dot,
  type Mat3,
  mul,
  normalize,
  rotX,
  rotY,
  scale,
  sub,
  type Vec3,
} from './math';
import { AMBER, INK, PAPER, type Raster } from './raster';

/**
 * 1 ビットの立体。Robot Tune の舞台と一覧の舞台が同じ部品で描く。
 *
 * 立方体とシャベルを面（網点の陰影）と辺（線）に分けて持ち、Raster に
 * 描く。光は上の斜めから一つ。面を捨てて辺だけを描くと、体積の無い
 * 長さだけの姿になる。
 */

export interface CubeState {
  /** 底面の中心。潰れはここを支点にかける。 */
  base: Vec3;
  size: number;
  rot: Mat3;
  /** 横・縦・奥の伸縮。 */
  squash: Vec3;
  /** 1 なら琥珀。宙にいるあいだだけ灯る。 */
  hot: number;
  /** 前の段を 27 個まとめた立方体。面に 3×3 の点線を引く。 */
  composite: boolean;
  /** 床からの高さ。影の濃さに使う。0 なら影を描かない。 */
  airborne: number;
  /** 山に収まった箱。着地の沈みはこれだけにかける。 */
  landed: boolean;
}

export interface ShovelState {
  /** 刃先。床に立っている点。 */
  pivot: Vec3;
  /** シャベル 1 単位あたりの世界の長さ。 */
  scale: number;
  rot: Mat3;
}

export interface CameraState {
  azimuth: number;
  elevation: number;
  target: Vec3;
  /** 画面の短辺に収める世界の長さ。 */
  span: number;
}

const LIGHT = normalize([0.42, 1, 0.26]);

/**
 * 平行投影のカメラ。方位と仰角で回し、注視点を画面の (cx, cy) に置く。
 * ppu は世界の 1 単位が何画素か。
 */
export class View {
  private readonly m: Mat3;
  private readonly t: Vec3;
  readonly ppu: number;
  private readonly cx: number;
  private readonly cy: number;

  constructor(camera: CameraState, ppu: number, cx: number, cy: number) {
    this.m = mul(rotX(camera.elevation), rotY(-camera.azimuth));
    this.t = apply(this.m, camera.target);
    this.ppu = ppu;
    this.cx = cx;
    this.cy = cy;
  }

  project(p: Vec3): Vec3 {
    const v = apply(this.m, p);
    return [this.cx + (v[0] - this.t[0]) * this.ppu, this.cy - (v[1] - this.t[1]) * this.ppu, v[2]];
  }

  /** 視点側を向いた法線か。平行投影なので z 成分の符号だけ見ればよい。 */
  facing(n: Vec3): boolean {
    return apply(this.m, n)[2] > 1e-4;
  }
}

const ORIGIN: Vec3 = [0, 0, 0];
export const vert = (list: readonly Vec3[], i: number | undefined): Vec3 => list[i ?? 0] ?? ORIGIN;

/** 立方体の 8 頂点（局所）と 6 面、12 辺。 */
export const CORNERS: Vec3[] = [];
for (let i = 0; i < 8; i++) CORNERS.push([(i & 1) - 0.5, (i >> 1) & 1, ((i >> 2) & 1) - 0.5]);
export const FACES: { v: [number, number, number, number]; n: Vec3 }[] = [
  { v: [0, 4, 6, 2], n: [-1, 0, 0] },
  { v: [1, 3, 7, 5], n: [1, 0, 0] },
  { v: [0, 1, 5, 4], n: [0, -1, 0] },
  { v: [2, 6, 7, 3], n: [0, 1, 0] },
  { v: [0, 2, 3, 1], n: [0, 0, -1] },
  { v: [4, 5, 7, 6], n: [0, 0, 1] },
];
export const EDGES: [number, number][] = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

export interface Solid {
  verts: Vec3[];
  faces: { v: number[]; n: Vec3; tone: number; dark: number; alt: number; mix: number }[];
  edges: [number, number][];
  edgeColor: number;
  /** 両面を描く薄い板（シャベルの刃）。 */
  twoSided?: boolean;
}

export function cubeVerts(c: CubeState): Vec3[] {
  const s = c.size;
  const mid: Vec3 = add(c.base, [0, 0.5 * s * c.squash[1], 0]);
  return CORNERS.map((p) =>
    add(
      mid,
      apply(c.rot, [
        p[0] * s * c.squash[0],
        (p[1] - 0.5) * s * c.squash[1],
        p[2] * s * c.squash[2],
      ]),
    ),
  );
}

export function shade(n: Vec3, twoSided = false): number {
  const d = dot(n, LIGHT);
  return 0.2 + 0.8 * Math.max(0, twoSided ? Math.abs(d) : d);
}

export function cubeSolid(c: CubeState, flash: number): Solid {
  const hot = Math.max(c.hot, c.landed ? flash : 0);
  return {
    verts: cubeVerts(c),
    faces: FACES.map((f) => {
      const n = apply(c.rot, f.n);
      return { v: f.v, n, tone: shade(n), dark: INK, alt: AMBER, mix: hot };
    }),
    edges: EDGES,
    edgeColor: hot > 0.5 ? AMBER : INK,
  };
}

/** 2 点を結ぶ角材。断面は w × d。 */
export function beam(a: Vec3, b: Vec3, w: number, d: number): Vec3[] {
  const axis = normalize(sub(b, a));
  const ref: Vec3 = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = normalize([
    axis[1] * ref[2] - axis[2] * ref[1],
    axis[2] * ref[0] - axis[0] * ref[2],
    axis[0] * ref[1] - axis[1] * ref[0],
  ]);
  const v: Vec3 = [
    axis[1] * u[2] - axis[2] * u[1],
    axis[2] * u[0] - axis[0] * u[2],
    axis[0] * u[1] - axis[1] * u[0],
  ];
  const out: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    const base = (i >> 1) & 1 ? b : a;
    out.push(add(base, add(scale(u, ((i & 1) - 0.5) * w), scale(v, (((i >> 2) & 1) - 0.5) * d))));
  }
  return out;
}

/** 角材の 6 面。頂点の並びは beam() と対。 */
const BEAM_FACES = [
  [0, 4, 6, 2],
  [1, 3, 7, 5],
  [0, 1, 5, 4],
  [2, 6, 7, 3],
  [0, 2, 3, 1],
  [4, 5, 7, 6],
];

/**
 * シャベル。刃先を原点に、柄は +y、刃の表は +z。単位は刃の幅が 1.1。
 * 刃は少し窪ませた五角形の板で、柄と D 字の握りは角材。
 */
const BLADE: Vec3[] = [
  [0, 0.6, -0.07],
  [0, 0, 0],
  [0.55, 0.36, 0.07],
  [0.55, 1.15, 0.1],
  [0, 1.15, 0.02],
  [-0.55, 1.15, 0.1],
  [-0.55, 0.36, 0.07],
];
const BEAMS: { a: Vec3; b: Vec3; w: number; d: number; mat: 'shaft' | 'grip' }[] = [
  { a: [0, 1.1, 0], b: [0, 1.55, 0], w: 0.22, d: 0.16, mat: 'shaft' },
  { a: [0, 1.55, 0], b: [0, 3.3, 0], w: 0.1, d: 0.1, mat: 'shaft' },
  { a: [0.03, 3.28, 0], b: [0.27, 3.66, 0], w: 0.08, d: 0.08, mat: 'grip' },
  { a: [-0.03, 3.28, 0], b: [-0.27, 3.66, 0], w: 0.08, d: 0.08, mat: 'grip' },
  { a: [-0.33, 3.66, 0], b: [0.33, 3.66, 0], w: 0.1, d: 0.1, mat: 'grip' },
];

export function shovelSolids(shovel: ShovelState): Solid[] {
  const { pivot, rot, scale: s } = shovel;
  const world = (p: Vec3) => add(pivot, scale(apply(rot, p), s));
  const bladeVerts = BLADE.map(world);
  const fan: number[][] = [];
  for (let i = 1; i < BLADE.length; i++) fan.push([0, i, i === BLADE.length - 1 ? 1 : i + 1]);
  const blade: Solid = {
    verts: bladeVerts,
    faces: fan.map((v) => {
      const a = vert(bladeVerts, v[0]);
      const b = vert(bladeVerts, v[1]);
      const c = vert(bladeVerts, v[2]);
      const n = normalize([
        (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
        (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
      ]);
      return { v, n, tone: 0.25 + 0.75 * shade(n, true), dark: INK, alt: INK, mix: 0 };
    }),
    edges: [
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 1],
      [0, 4],
    ],
    edgeColor: INK,
    twoSided: true,
  };
  const beams = BEAMS.map((b): Solid => {
    const verts = beam(world(b.a), world(b.b), b.w * s, b.d * s);
    return {
      verts,
      faces: BEAM_FACES.map((v) => {
        const p = verts;
        const e1 = sub(vert(p, v[1]), vert(p, v[0]));
        const e2 = sub(vert(p, v[3]), vert(p, v[0]));
        const n = normalize([
          e1[1] * e2[2] - e1[2] * e2[1],
          e1[2] * e2[0] - e1[0] * e2[2],
          e1[0] * e2[1] - e1[1] * e2[0],
        ]);
        const tone = b.mat === 'grip' ? shade(n) : shade(n) * 0.55;
        return { v, n, tone, dark: b.mat === 'grip' ? AMBER : INK, alt: INK, mix: 0 };
      }),
      edges: EDGES,
      edgeColor: INK,
      twoSided: true,
    };
  });
  return [blade, ...beams];
}

export function drawFaces(r: Raster, view: View, s: Solid, fill: number) {
  const pv = s.verts.map((p) => view.project(p));
  for (const f of s.faces) {
    if (!s.twoSided && !view.facing(f.n)) continue;
    const tone = 1 - (1 - f.tone) * fill;
    const a = vert(pv, f.v[0]);
    for (let i = 1; i + 1 < f.v.length; i++) {
      const b = vert(pv, f.v[i]);
      const c = vert(pv, f.v[i + 1]);
      r.tri(
        a[0],
        a[1],
        a[2],
        b[0],
        b[1],
        b[2],
        c[0],
        c[1],
        c[2],
        tone,
        f.dark,
        PAPER,
        false,
        f.alt,
        f.mix,
      );
    }
  }
}

export function drawEdges(r: Raster, view: View, s: Solid, xray: boolean, bias: number) {
  const pv = s.verts.map((p) => view.project(p));
  for (const [i, j] of s.edges) {
    const a = vert(pv, i);
    const b = vert(pv, j);
    r.line(a[0], a[1], a[2], b[0], b[1], b[2], s.edgeColor, !xray, bias);
  }
}

/** まとめた立方体の面に、27 個ぶんの継ぎ目を点線で残す。 */
export function drawSeams(r: Raster, view: View, c: CubeState, xray: boolean, bias: number) {
  const v = cubeVerts(c);
  const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  for (const f of FACES) {
    const n = apply(c.rot, f.n);
    if (!xray && !view.facing(n)) continue;
    const [p0, p1, p2, p3] = f.v.map((i) => vert(v, i)) as [Vec3, Vec3, Vec3, Vec3];
    for (const t of [1 / 3, 2 / 3]) {
      for (const [a, b] of [
        [lerp3(p0, p1, t), lerp3(p3, p2, t)],
        [lerp3(p0, p3, t), lerp3(p1, p2, t)],
      ] as [Vec3, Vec3][]) {
        const pa = view.project(a);
        const pb = view.project(b);
        r.line(pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], INK, !xray, bias, [1, 2]);
      }
    }
  }
}

export function drawShadow(r: Raster, view: View, c: CubeState) {
  if (c.airborne <= 0) return;
  const h = c.airborne;
  const s = c.size * 0.5 * (1 + 0.08 * h);
  const b = c.base;
  const q = [
    view.project([b[0] - s, 0, b[2] - s]),
    view.project([b[0] + s, 0, b[2] - s]),
    view.project([b[0] + s, 0, b[2] + s]),
    view.project([b[0] - s, 0, b[2] + s]),
  ] as Vec3[];
  const tone = 1 - 0.5 * clamp(1 - h / 3);
  const [a, bb, cc, d] = q as [Vec3, Vec3, Vec3, Vec3];
  r.tri(a[0], a[1], 0, bb[0], bb[1], 0, cc[0], cc[1], 0, tone, INK, PAPER, true);
  r.tri(a[0], a[1], 0, cc[0], cc[1], 0, d[0], d[1], 0, tone, INK, PAPER, true);
}
