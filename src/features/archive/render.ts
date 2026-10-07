import type { Vec3 } from '../../shared/pixel/math';
import { INK, type Raster, threshold } from '../../shared/pixel/raster';
import {
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

/**
 * filled を渡すと、体積を持つ標本をその集合で決める（検索で一致した記事）。
 * 渡さなければ照らされた 1 個だけ。
 */
export function renderArchive(
  r: Raster,
  archive: Archive,
  scene: ArchiveScene,
  filled: ReadonlySet<number> | null = null,
): Hit[] {
  r.clear();
  const span = scene.span;
  const ppu = Math.min(r.w / (span * 1.12), r.h / (span * 0.62));
  const view = new View(scene.camera, ppu, r.w / 2, r.h * 0.56);
  const bias = 0.04;
  const hits: Hit[] = [];
  const solids = scene.cubes.map((c) => cubeSolid(c, 0));
  scene.cubes.forEach((c, k) => {
    const lit = k === scene.lit || c.hot > 0;
    const solid = filled ? filled.has(k) || c.hot > 0 : lit;
    drawFaces(r, view, solids[k] ?? cubeSolid(c, 0), solid ? 0.95 : 0);
  });
  const shovel = shovelSolids(scene.shovel);
  for (const s of shovel) drawFaces(r, view, s, 0.9);
  for (const s of solids) drawEdges(r, view, s, false, bias);
  for (const s of shovel) drawEdges(r, view, s, false, bias);
  for (const c of scene.cubes) drawShadow(r, view, c);
  drawPlan(r, view, archive);

  solids.forEach((s, k) => {
    const pts = s.verts.map((p: Vec3) => view.project(p));
    hits.push({
      index: k,
      x0: Math.min(...pts.map((p) => p[0])),
      y0: Math.min(...pts.map((p) => p[1])),
      x1: Math.max(...pts.map((p) => p[0])),
      y1: Math.max(...pts.map((p) => p[1])),
    });
  });
  return hits;
}
