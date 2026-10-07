import { clamp, IDENTITY, spring } from '../../shared/pixel/math';
import { INK, Raster } from '../../shared/pixel/raster';
import {
  CORNERS,
  type CubeState,
  cubeSolid,
  drawEdges,
  drawFaces,
  EDGES,
  View,
  vert,
} from '../../shared/pixel/solids';

/**
 * 読んだぶんだけ積まれる立方体。3³ の点線の枠に、本文の 1/27 を読むごとに
 * 1 個ずつ落ちてきて、潰れて、冷める。27 個目で枠が埋まり、全体が琥珀に
 * 光って冷める。数字は描かない（進み具合は上端の進捗バーが持つ）。
 * 進み具合の測り方も進捗バーと同じ、頁全体のスクロール量。
 *
 * スクロールしたときだけ描く。動きを減らす設定では落ちる動きを省く。
 */

const N = 3;
const COUNT = N * N * N;

export function reelCount(progress: number): number {
  return Math.min(COUNT, Math.floor(clamp(progress) * COUNT + 1e-9));
}

function rgba(css: string, fallback: number): number {
  const m = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return fallback;
  const v = Number.parseInt(m[1] ?? '0', 16);
  return (0xff << 24) | ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff);
}

export function mountReel(root: HTMLElement): void {
  const canvasEl = root.querySelector<HTMLCanvasElement>('canvas');
  const context = canvasEl?.getContext('2d');
  if (!canvasEl || !context) return;
  const canvas: HTMLCanvasElement = canvasEl;
  const ctx2d: CanvasRenderingContext2D = context;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const raster = new Raster();
  const style = getComputedStyle(root);
  const palette = new Uint32Array([
    0,
    rgba(style.getPropertyValue('--bg'), 0xfffaf9f9),
    rgba(style.getPropertyValue('--ink'), 0xff1e1915),
    rgba(style.getPropertyValue('--amber'), 0xff0c58ea),
  ]);
  const added: number[] = [];
  let progress = 0;
  let raf = 0;
  let image: ImageData | null = null;
  let out: Uint32Array | null = null;
  const now = () => performance.now() / 1000;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w0 = root.clientWidth * dpr;
    if (w0 <= 0) return;
    const px = Math.max(1, Math.round(dpr * 2));
    const w = Math.floor(w0 / px);
    const h = Math.round(w * 0.78);
    if (w !== raster.w || h !== raster.h) {
      raster.resize(w, h);
      canvas.width = w;
      canvas.height = h;
      canvas.style.height = `${(h * px) / dpr}px`;
      image = ctx2d.createImageData(w, h);
      out = new Uint32Array(image.data.buffer);
    }
    measure();
  }

  function measure() {
    const doc = document.documentElement;
    progress = clamp(window.scrollY / Math.max(1, doc.scrollHeight - window.innerHeight));
    const want = reelCount(progress);
    const t = now();
    while (added.length < want) added.push(t + (reduced ? -9 : added.length === want - 1 ? 0 : -9));
    added.length = want;
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function frame() {
    raf = 0;
    if (!image || !out) return;
    const t = now();
    raster.clear();
    const ppu = Math.min(raster.w / 6, raster.h / 6.6);
    const view = new View(
      { azimuth: Math.PI / 4 - 0.22, elevation: 0.56, target: [1.5, 1.3, 1.5], span: 1 },
      ppu,
      raster.w / 2,
      raster.h * 0.52,
    );
    const full = added.length === COUNT;
    const fin = full ? clamp(1 - (t - (added[COUNT - 1] ?? 0)) / 0.8) : 0;
    let busy = false;
    added.forEach((at, i) => {
      const x = i % N;
      const z = Math.floor(i / N) % N;
      const y = Math.floor(i / (N * N));
      const age = t - at;
      const fall = reduced ? 1 : clamp(age / 0.22);
      const sq = age > 0.22 && !reduced ? 1 - 0.3 * Math.max(-0.4, spring(age - 0.22, 4, 10)) : 1;
      if (age < 1) busy = true;
      const cube: CubeState = {
        base: [x + 0.5, y + (1 - fall * fall) * 3, z + 0.5],
        size: 0.96,
        rot: IDENTITY,
        squash: [1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq)],
        hot: Math.max(clamp(1 - (age - 0.22) / 0.5), fin),
        composite: false,
        airborne: 0,
        landed: true,
      };
      const s = cubeSolid(cube, 0);
      drawFaces(raster, view, s, 0.95);
      drawEdges(raster, view, s, false, 0.03);
    });
    // まだ埋まっていない枠。体積はなく、長さだけ。
    const frame3 = CORNERS.map((p): [number, number, number] => [
      (p[0] + 0.5) * N,
      p[1] * N,
      (p[2] + 0.5) * N,
    ]);
    const pv = frame3.map((p) => view.project(p));
    for (const [i, j] of EDGES) {
      const a = vert(pv, i);
      const b = vert(pv, j);
      raster.line(a[0], a[1], a[2], b[0], b[1], b[2], INK, true, 0.03, [1, 2]);
    }
    raster.present(out, palette);
    ctx2d.putImageData(image, 0, 0);
    if (busy || fin > 0) raf = requestAnimationFrame(frame);
  }

  window.addEventListener('scroll', measure, { passive: true });
  new ResizeObserver(resize).observe(root);
  resize();
}
