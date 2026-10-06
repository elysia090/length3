import type { CubeState, Scene } from './choreo';
import { STACK } from './choreo';
import { drawText, textWidth } from './font';
import {
  add,
  apply,
  clamp,
  dot,
  hash,
  type Mat3,
  mul,
  normalize,
  rotX,
  rotY,
  scale,
  sub,
  type Vec3,
} from './math';
import { AMBER, INK, PAPER, type Raster, threshold } from './raster';
import { formatLength, formatVolume, groupDigits, sci, unitCount } from './scale';
import { BPM } from './timeline';

export interface Frame {
  scene: Scene;
  /** 音が無い。面を捨てて辺だけを、奥の辺まで透かして描く。 */
  xray: boolean;
  /** 面の暗さに掛ける量。音量そのもの。 */
  fill: number;
  /** 波形。再生していない間は null。 */
  scope: Float32Array | null;
  /** 中央に出す一言（PLAY / LOADING / PAUSE）。 */
  status: string | null;
  still: boolean;
}

const LIGHT = normalize([0.42, 1, 0.26]);

class View {
  private readonly m: Mat3;
  private readonly t: Vec3;
  readonly ppu: number;
  private readonly cx: number;
  private readonly cy: number;

  constructor(scene: Scene, w: number, h: number, shake: [number, number]) {
    const { camera } = scene;
    this.m = mul(rotX(camera.elevation), rotY(-camera.azimuth));
    this.t = apply(this.m, camera.target);
    const zoom = camera.span / 2.15;
    this.ppu = Math.min(w / (zoom * 2.8), h / (zoom * 2.05));
    this.cx = w / 2 + shake[0];
    this.cy = h / 2 + shake[1] + (h >= w ? h * 0.04 : 0);
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
const vert = (list: readonly Vec3[], i: number | undefined): Vec3 => list[i ?? 0] ?? ORIGIN;

/** 立方体の 8 頂点（局所）と 6 面、12 辺。 */
const CORNERS: Vec3[] = [];
for (let i = 0; i < 8; i++) CORNERS.push([(i & 1) - 0.5, (i >> 1) & 1, ((i >> 2) & 1) - 0.5]);
const FACES: { v: [number, number, number, number]; n: Vec3 }[] = [
  { v: [0, 4, 6, 2], n: [-1, 0, 0] },
  { v: [1, 3, 7, 5], n: [1, 0, 0] },
  { v: [0, 1, 5, 4], n: [0, -1, 0] },
  { v: [2, 6, 7, 3], n: [0, 1, 0] },
  { v: [0, 2, 3, 1], n: [0, 0, -1] },
  { v: [4, 5, 7, 6], n: [0, 0, 1] },
];
const EDGES: [number, number][] = [
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

interface Solid {
  verts: Vec3[];
  faces: { v: number[]; n: Vec3; tone: number; dark: number; alt: number; mix: number }[];
  edges: [number, number][];
  edgeColor: number;
  /** 両面を描く薄い板（シャベルの刃）。 */
  twoSided?: boolean;
}

function cubeVerts(c: CubeState): Vec3[] {
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

function shade(n: Vec3, twoSided = false): number {
  const d = dot(n, LIGHT);
  return 0.2 + 0.8 * Math.max(0, twoSided ? Math.abs(d) : d);
}

function cubeSolid(c: CubeState, flash: number): Solid {
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
function beam(a: Vec3, b: Vec3, w: number, d: number): Vec3[] {
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

function shovelSolids(scene: Scene): Solid[] {
  const { pivot, rot, scale: s } = scene.shovel;
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

function drawFaces(r: Raster, view: View, s: Solid, fill: number) {
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

function drawEdges(r: Raster, view: View, s: Solid, xray: boolean, bias: number) {
  const pv = s.verts.map((p) => view.project(p));
  for (const [i, j] of s.edges) {
    const a = vert(pv, i);
    const b = vert(pv, j);
    r.line(a[0], a[1], a[2], b[0], b[1], b[2], s.edgeColor, !xray, bias);
  }
}

/** まとめた立方体の面に、27 個ぶんの継ぎ目を点線で残す。 */
function drawSeams(r: Raster, view: View, c: CubeState, xray: boolean, bias: number) {
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

function drawFloor(r: Raster, view: View, scene: Scene) {
  const zoom = scene.camera.span / 2.15;
  const c: Vec3 = [zoom / 2, 0, zoom / 2];
  const radius = zoom * 1.9;
  for (const g of scene.grids) {
    if (g.alpha <= 0.02) continue;
    const n = Math.ceil(radius / g.spacing);
    const ox = Math.round(c[0] / g.spacing);
    const oz = Math.round(c[2] / g.spacing);
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        const x = (ox + i) * g.spacing;
        const z = (oz + j) * g.spacing;
        const d = Math.hypot(x - c[0], z - c[2]) / radius;
        if (d > 1) continue;
        const a = g.alpha * (1 - d * d);
        const p = view.project([x, 0, z]);
        const px = Math.floor(p[0]);
        const py = Math.floor(p[1]);
        if (px < 0 || py < 0 || px >= r.w || py >= r.h) continue;
        const k = py * r.w + px;
        if (r.depth[k] !== -Infinity) continue;
        if (a > threshold(px, py)) r.color[k] = INK;
      }
    }
  }
}

function drawShadow(r: Raster, view: View, c: CubeState) {
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

/** これから埋める立方体の輪郭。体積はまだ無く、長さだけがある。 */
function drawTarget(r: Raster, view: View, scene: Scene, xray: boolean, bias: number) {
  let n = STACK;
  if (scene.phase === 'pre' || scene.phase === 'intro') {
    n = Math.min(STACK, Math.max(1, Math.ceil(Math.cbrt(scene.count + 1) - 1e-9)));
  }
  const v = CORNERS.map((p): Vec3 => [(p[0] + 0.5) * n, p[1] * n, (p[2] + 0.5) * n]);
  const pv = v.map((p) => view.project(p));
  for (const [i, j] of EDGES) {
    const a = vert(pv, i);
    const b = vert(pv, j);
    r.line(a[0], a[1], a[2], b[0], b[1], b[2], INK, !xray, bias, [1, 3]);
  }
}

function drawCells(r: Raster, scene: Scene, x: number, y: number) {
  const { cells } = scene;
  const pitch = 5;
  for (let i = 0; i < cells.count; i++) {
    const cx = x + i * pitch;
    const charge = i >= cells.count - cells.charge;
    if (i === cells.current) r.rect(cx, y, 4, 4, AMBER);
    else if (i < cells.filled || (charge && i < cells.current)) r.rect(cx, y, 4, 4, INK);
    else if (charge) {
      r.set(cx, y + 3, INK);
      r.set(cx + 1, y + 2, INK);
      r.set(cx + 2, y + 1, INK);
      r.set(cx + 3, y, INK);
    } else {
      r.set(cx, y, INK);
      r.set(cx + 3, y, INK);
      r.set(cx, y + 3, INK);
      r.set(cx + 3, y + 3, INK);
    }
    if (cells.cut[i]) r.rect(cx, y + 6, 4, 1, INK);
  }
}

function drawScope(
  r: Raster,
  scope: Float32Array | null,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const mid = y + (h >> 1);
  if (!scope) {
    for (let i = 0; i < w; i += 2) r.set(x + i, mid, INK);
    return;
  }
  const per = scope.length / w;
  let prev = mid;
  for (let i = 0; i < w; i++) {
    let lo = 1;
    let hi = -1;
    for (let k = Math.floor(i * per); k < Math.floor((i + 1) * per); k++) {
      const v = scope[k] ?? 0;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const a = Math.round(mid - clamp(hi * 1.6, -1, 1) * (h / 2));
    const b = Math.round(mid - clamp(lo * 1.6, -1, 1) * (h / 2));
    const top = Math.min(a, b, prev);
    const bot = Math.max(a, b, prev);
    for (let yy = top; yy <= bot; yy++) r.set(x + i, yy, INK);
    prev = Math.round((a + b) / 2);
  }
}

function countLabel(scene: Scene): string {
  const n = unitCount(scene.level, scene.count);
  const s = n.toString();
  return s.length <= 13 ? groupDigits(n) : sci(Number(n));
}

function drawHud(r: Raster, f: Frame) {
  const { scene } = f;
  const m = r.w < 240 ? 4 : 6;
  const volume = Number(unitCount(scene.level, scene.count));
  const hot = scene.cubes.some((c) => c.landed && c.hot > 0.5);
  drawText(r, 'V', m, m, INK);
  drawText(r, formatVolume(volume), m + 9, m, hot ? AMBER : INK);
  drawText(r, 'L', m, m + 10, INK);
  drawText(r, formatLength(Math.cbrt(Math.max(volume, 1))), m + 9, m + 10, INK);
  drawText(r, 'N', m, m + 20, INK);
  drawText(r, countLabel(scene), m + 9, m + 20, INK);

  const bpm = `${Math.round(BPM)} BPM`;
  drawText(r, bpm, r.w - m - textWidth(bpm), m, INK);
  const label =
    scene.phase === 'loop'
      ? `LOOP ${String(scene.level).padStart(2, '0')}`
      : scene.phase === 'build'
        ? 'BUILD'
        : 'INTRO';
  drawText(r, label, r.w - m - textWidth(label), m + 10, INK);

  const formula = scene.phase === 'loop' ? '13 × 2 + 1 = 3³' : '1 + 7 + 19 = 3³';
  const rowY = r.h - m - 7;
  drawText(r, formula, m, rowY - 11, INK);
  drawCells(r, scene, m, rowY);

  const sw = Math.min(72, Math.floor(r.w * 0.22));
  drawScope(r, f.scope, r.w - m - sw, r.h - m - 16, sw, 14);
}

function drawStatus(r: Raster, text: string) {
  const k = r.w >= 260 ? 2 : 1;
  const w = textWidth(text, k);
  const x = Math.round((r.w - w) / 2);
  const y = Math.round(r.h * 0.5 - 3.5 * k);
  r.rect(x - 4 * k, y - 3 * k, w + 8 * k, 13 * k, PAPER);
  r.rect(x - 4 * k, y - 3 * k, w + 8 * k, k, INK);
  r.rect(x - 4 * k, y + 10 * k - k, w + 8 * k, k, INK);
  drawText(r, text, x, y, INK, k);
}

export function render(r: Raster, f: Frame): void {
  const { scene } = f;
  r.clear();
  const amp = f.still || f.xray ? 0 : scene.shake;
  const seed = Math.floor(scene.beat * 8);
  const shake: [number, number] = [
    Math.round((hash(seed) - 0.5) * 2 * amp),
    Math.round((hash(seed + 1) - 0.5) * 2 * amp),
  ];
  const view = new View(scene, r.w, r.h, shake);
  const bias = 0.04 * (scene.camera.span / 2.15);
  const solids = [...scene.cubes.map((c) => cubeSolid(c, scene.flash)), ...shovelSolids(scene)];

  if (!f.xray) for (const s of solids) drawFaces(r, view, s, f.fill);
  drawTarget(r, view, scene, f.xray, bias);
  for (const s of solids) drawEdges(r, view, s, f.xray, bias);
  for (const c of scene.cubes) if (c.composite) drawSeams(r, view, c, f.xray, bias);
  if (!f.xray) for (const c of scene.cubes) drawShadow(r, view, c);
  drawFloor(r, view, scene);
  drawHud(r, f);
  if (f.status) drawStatus(r, f.status);
}
