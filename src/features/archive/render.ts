import { drawText, textWidth } from '../../shared/pixel/font';
import type { Vec3 } from '../../shared/pixel/math';
import { AMBER, INK, type Raster, threshold } from '../../shared/pixel/raster';
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

const sig = (v: number) => (v >= 100 ? Math.round(v).toString() : v.toFixed(2));

/** 映画のタイムコード。24 コマ。 */
function timecode(t: number): string {
  const f = Math.floor(t * 24);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(f / 86400) % 100)}:${pad(Math.floor(f / 1440) % 60)}:${pad(Math.floor(f / 24) % 60)}:${pad(f % 24)}`;
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

function drawHud(r: Raster, archive: Archive, scene: ArchiveScene, t: number) {
  const m = r.w < 240 ? 4 : 6;
  const count = archive.specimens.length;
  drawText(r, 'V', m, m, INK);
  drawText(r, `${archive.volume} min`, m + 9, m, INK);
  drawText(r, 'L', m, m + 10, INK);
  drawText(r, sig(Math.cbrt(Math.max(1, archive.volume))), m + 9, m + 10, INK);
  drawText(r, 'N', m, m + 20, INK);
  drawText(r, String(count), m + 9, m + 20, INK);

  const s = archive.specimens[scene.lit];
  if (s) {
    const color = scene.fresh > 0.5 ? AMBER : INK;
    const lines = [`No.${String(s.number).padStart(3, '0')}`, `${s.minutes} min`, s.date];
    lines.forEach((line, j) => {
      drawText(r, line, r.w - m - textWidth(line), m + j * 10, j === 0 ? color : INK);
    });
  }

  // 標本の数だけ升を並べ、照らしているものを琥珀に。
  const y = r.h - m - 4;
  for (let k = 0; k < count; k++) {
    const x = m + k * 5;
    if (k === scene.lit) r.rect(x, y, 4, 4, AMBER);
    else {
      r.set(x, y, INK);
      r.set(x + 3, y, INK);
      r.set(x, y + 3, INK);
      r.set(x + 3, y + 3, INK);
    }
  }
  const tc = timecode(t);
  drawText(r, tc, r.w - m - textWidth(tc), r.h - m - 7, INK);
}

export function renderArchive(r: Raster, archive: Archive, scene: ArchiveScene, t: number): Hit[] {
  r.clear();
  const span = scene.span;
  const ppu = Math.min(r.w / (span * 1.12), r.h / (span * 0.62));
  const view = new View(scene.camera, ppu, r.w / 2, r.h * 0.56);
  const bias = 0.04;
  const hits: Hit[] = [];
  const solids = scene.cubes.map((c) => cubeSolid(c, 0));
  scene.cubes.forEach((c, k) => {
    const lit = k === scene.lit || c.hot > 0;
    drawFaces(r, view, solids[k] ?? cubeSolid(c, 0), lit ? 0.95 : 0);
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
  drawHud(r, archive, scene, t);
  return hits;
}
