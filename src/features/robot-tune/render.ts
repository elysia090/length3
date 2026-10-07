import { drawText, textWidth } from '../../shared/pixel/font';
import { clamp, hash, type Vec3 } from '../../shared/pixel/math';
import { AMBER, INK, PAPER, type Raster, threshold } from '../../shared/pixel/raster';
import {
  CORNERS,
  cubeSolid,
  drawEdges,
  drawFaces,
  drawShadow,
  EDGES,
  shovelSolids,
  View,
  vert,
} from '../../shared/pixel/solids';
import type { Scene } from './choreo';
import { STACK } from './choreo';

export interface Frame {
  scene: Scene;
  /** 音が無い。面の濃さを捨てて、隠れ線を消した線画にする。 */
  xray: boolean;
  /** 面の暗さに掛ける量。音量そのもの。 */
  fill: number;
  /** 波形。再生していない間は null。 */
  scope: Float32Array | null;
  /** 中央に出す一言（PLAY / LOADING / PAUSE）。 */
  status: string | null;
  /** 左上に画素の字で小さく入れる題（入口のときだけ）。 */
  title?: string | null;
  still: boolean;
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

// 数字は描かない。拍の升目と波形だけを下端に置く（文字は図の外の
// キャプションが持つ）。
function drawScore(r: Raster, f: Frame) {
  const m = r.w < 240 ? 4 : 6;
  if (f.title) drawText(r, f.title, m, m, INK);
  drawCells(r, f.scene, m, r.h - m - 7);
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
  const zoom = scene.camera.span / 2.15;
  const view = new View(
    scene.camera,
    Math.min(r.w / (zoom * 2.8), r.h / (zoom * 2.05)),
    r.w / 2 + shake[0],
    r.h / 2 + shake[1] + (r.h >= r.w ? r.h * 0.04 : 0),
  );
  const bias = 0.04 * (scene.camera.span / 2.15);
  const solids = [
    ...scene.cubes.map((c) => cubeSolid(c, scene.flash)),
    ...shovelSolids(scene.shovel),
  ];

  // 音が無いあいだは面の濃さを抜くだけで、面そのものは紙として残す。奥の
  // 辺はその面に隠れる（線画になる）。全部の辺を透かすと、27 個の箱の
  // 裏の辺が重なって砂嵐になる。
  for (const s of solids) drawFaces(r, view, s, f.xray ? 0 : f.fill);
  drawTarget(r, view, scene, false, bias);
  for (const s of solids) drawEdges(r, view, s, false, bias);
  if (!f.xray) for (const c of scene.cubes) drawShadow(r, view, c);
  drawFloor(r, view, scene);
  drawScore(r, f);
  if (f.status) drawStatus(r, f.status);
}
