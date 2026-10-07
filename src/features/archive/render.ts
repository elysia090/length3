import { add, apply, scale, type Vec3 } from '../../shared/pixel/math';
import { INK, PAPER, type Raster, threshold } from '../../shared/pixel/raster';
import {
  type CubeState,
  cubeSolid,
  drawEdges,
  drawFaces,
  drawShadow,
  shovelSolids,
  View,
} from '../../shared/pixel/solids';
import type { ArchiveScene } from './choreo';
import { type Archive, CELL } from './layout';

/** 標本の画面上の外接矩形（ラスタの画素）。ポインタの当たり判定に使う。 */
export interface Hit {
  index: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 区画の角に小さな十字。図面の通り芯の印。 */
function drawPlan(r: Raster, view: View, archive: Archive) {
  const hx = archive.width / 2;
  const hz = archive.depth / 2;
  for (let x = -hx; x <= hx + 1e-6; x += CELL) {
    for (let z = -hz; z <= hz + 1e-6; z += CELL) {
      const p = view.project([x, 0, z]);
      const px = Math.round(p[0]);
      const py = Math.round(p[1]);
      for (const [dx, dy] of [
        [0, 0],
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        const X = px + dx;
        const Y = py + dy;
        if (X < 0 || Y < 0 || X >= r.w || Y >= r.h) continue;
        if (r.depth[Y * r.w + X] === -Infinity) r.color[Y * r.w + X] = INK;
      }
    }
  }
  // 床の点。区画の外へ薄れていく。
  const radius = Math.hypot(hx, hz) + CELL * 1.5;
  for (let x = -radius; x <= radius; x += 1) {
    for (let z = -radius; z <= radius; z += 1) {
      const d = Math.hypot(x, z) / radius;
      if (d > 1) continue;
      const p = view.project([x, 0, z]);
      const px = Math.floor(p[0]);
      const py = Math.floor(p[1]);
      if (px < 0 || py < 0 || px >= r.w || py >= r.h) continue;
      const k = py * r.w + px;
      if (r.depth[k] === -Infinity && 0.7 * (1 - d * d) > threshold(px, py)) r.color[k] = INK;
    }
  }
}

/** 床に開いた穴。暗い網点の楕円で、深いほど濃い。 */
function drawPits(r: Raster, view: View, pits: readonly { x: number; z: number; depth: number }[]) {
  for (const p of pits) {
    if (p.depth <= 0) continue;
    const rad = 0.55 + 0.15 * Math.min(3, p.depth);
    const tone = 1 - Math.min(0.92, 0.45 + 0.18 * p.depth);
    const n = 14;
    const c = view.project([p.x, 0, p.z]);
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const q0 = view.project([p.x + Math.cos(a0) * rad, 0, p.z + Math.sin(a0) * rad]);
      const q1 = view.project([p.x + Math.cos(a1) * rad, 0, p.z + Math.sin(a1) * rad]);
      r.tri(c[0], c[1], 0, q0[0], q0[1], 0, q1[0], q1[1], 0, tone, INK, PAPER, true);
    }
  }
}

/** 画面に写した外接矩形。 */
function boundsOf(points: readonly Vec3[], view: View, index: number): Hit {
  const pts = points.map((p) => view.project(p));
  return {
    index,
    x0: Math.min(...pts.map((p) => p[0])),
    y0: Math.min(...pts.map((p) => p[1])),
    x1: Math.max(...pts.map((p) => p[0])),
    y1: Math.max(...pts.map((p) => p[1])),
  };
}

export interface ArchiveExtras {
  /** 体積を持つ標本（検索で一致した記事）。null なら照らされた 1 個だけ。 */
  filled?: ReadonlySet<number> | null;
  pits?: readonly { x: number; z: number; depth: number }[];
  /** 土くれ。描くだけ。 */
  debris?: readonly CubeState[];
  /** 掘り出した箱。当たり判定を返す。 */
  finds?: readonly CubeState[];
}

export interface ArchiveFrame {
  hits: Hit[];
  /** シャベルの柄（刃先から握りまで）を画面に写した線分。 */
  shovel: { x0: number; y0: number; x1: number; y1: number };
  finds: Hit[];
  view: View;
}

export function renderArchive(
  r: Raster,
  archive: Archive,
  scene: ArchiveScene,
  extras: ArchiveExtras = {},
): ArchiveFrame {
  const filled = extras.filled ?? null;
  r.clear();
  const span = scene.span;
  const ppu = Math.min(r.w / (span * 1.12), r.h / (span * 0.62));
  const view = new View(scene.camera, ppu, r.w / 2, r.h * 0.56);
  const bias = 0.04;
  const solids = scene.cubes.map((c) => cubeSolid(c, 0));
  scene.cubes.forEach((c, k) => {
    const lit = k === scene.lit || c.hot > 0;
    const solid = filled ? filled.has(k) || c.hot > 0 : lit;
    drawFaces(r, view, solids[k] ?? cubeSolid(c, 0), solid ? 0.95 : 0);
  });
  const extra = [...(extras.debris ?? []), ...(extras.finds ?? [])].map((c) => cubeSolid(c, 0));
  for (const s of extra) drawFaces(r, view, s, 0.95);
  const shovel = shovelSolids(scene.shovel);
  for (const s of shovel) drawFaces(r, view, s, 0.9);
  for (const s of solids) drawEdges(r, view, s, false, bias);
  for (const s of extra) drawEdges(r, view, s, false, bias);
  for (const s of shovel) drawEdges(r, view, s, false, bias);
  for (const c of scene.cubes) drawShadow(r, view, c);
  for (const c of extras.finds ?? []) drawShadow(r, view, c);
  drawPits(r, view, extras.pits ?? []);
  drawPlan(r, view, archive);

  const hits = solids.map((s, k) => boundsOf(s.verts, view, k));
  const finds = (extras.finds ?? []).map((c, k) => boundsOf(cubeSolid(c, 0).verts, view, k));
  const tip = view.project(scene.shovel.pivot);
  const grip = view.project(
    add(scene.shovel.pivot, scale(apply(scene.shovel.rot, [0, 3.6, 0]), scene.shovel.scale)),
  );
  const shovelHit = { x0: tip[0], y0: tip[1], x1: grip[0], y1: grip[1] };
  return { hits, shovel: shovelHit, finds, view };
}
