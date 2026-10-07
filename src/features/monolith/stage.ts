import { drawText, textWidth } from '../../shared/pixel/font';
import { IDENTITY } from '../../shared/pixel/math';
import { AMBER, INK, NONE, Raster, threshold } from '../../shared/pixel/raster';
import { type CubeState, cubeSolid, drawEdges, drawFaces, View } from '../../shared/pixel/solids';
import { cluster } from './chord';
import { ALIGN, monolithAt, SLAB } from './choreo';

/**
 * About の石。横 100 列前後の縦長の絵で、端末の画素の整数倍に拡大する。
 * 画面の外ではもちろん止まり、動きを減らす設定では止めた一枚になる。
 */

const TARGET_COLUMNS = 100;

function rgba(css: string, fallback: number): number {
  const m = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return fallback;
  const v = Number.parseInt(m[1] ?? '0', 16);
  return (0xff << 24) | ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff);
}

export function mountMonolith(root: HTMLElement): void {
  const canvasEl = root.querySelector<HTMLCanvasElement>('canvas');
  const buttonEl = root.querySelector<HTMLButtonElement>('button');
  const context = canvasEl?.getContext('2d');
  if (!canvasEl || !buttonEl || !context) return;
  const canvas: HTMLCanvasElement = canvasEl;
  const ctx2d: CanvasRenderingContext2D = context;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const raster = new Raster();
  const style = getComputedStyle(root);
  const palette = new Uint32Array([
    0,
    rgba(style.getPropertyValue('--bg'), 0xfffaf9f9),
    rgba(style.getPropertyValue('--ink'), 0xff1e1915),
    rgba(style.getPropertyValue('--amber'), 0xff0c58ea),
  ]);
  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;
  let touchedAt = -100;
  let image: ImageData | null = null;
  let out: Uint32Array | null = null;
  let raf = 0;
  let visible = true;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w0 = root.clientWidth * dpr;
    const h0 = root.clientHeight * dpr;
    if (w0 <= 0 || h0 <= 0) return;
    const px = Math.max(1, Math.round(w0 / TARGET_COLUMNS));
    const w = Math.floor(w0 / px);
    const h = Math.floor(h0 / px);
    if (w !== raster.w || h !== raster.h) {
      raster.resize(w, h);
      canvas.width = w;
      canvas.height = h;
      image = ctx2d.createImageData(w, h);
      out = new Uint32Array(image.data.buffer);
    }
    draw();
  }

  function draw() {
    if (!image || !out) return;
    const t = now();
    const f = monolithAt(t, touchedAt, reduced.matches);
    raster.clear();
    const ppu = Math.min(raster.w / 6.2, raster.h / 11.5);
    const view = new View(
      { azimuth: f.azimuth, elevation: f.elevation, target: [0, 4.4, 0], span: 1 },
      ppu,
      raster.w / 2,
      raster.h * 0.52,
    );

    // 太陽は板の後ろ。上の縁の向こうから昇る。
    if (f.sun > 0) {
      const c = view.project([0, SLAB[1] - 1.4 + f.sun * 2.6, -2]);
      const r = ppu * 1.5;
      for (let y = Math.floor(c[1] - r); y <= c[1] + r; y++) {
        for (let x = Math.floor(c[0] - r); x <= c[0] + r; x++) {
          const d = Math.hypot(x - c[0], y - c[1]) / r;
          if (d <= 1 && 1 - d * 0.6 > threshold(x, y)) raster.set(x, y, AMBER);
        }
      }
    }

    const slab: CubeState = {
      base: [0, 0, 0],
      size: 1,
      rot: IDENTITY,
      squash: [SLAB[0], SLAB[1], SLAB[2]],
      hot: 0,
      composite: false,
      airborne: 0,
      landed: true,
    };
    const solid = cubeSolid(slab, 0);
    // 石は黒い。面ごとの差はわずかに残して、稜線で形を読ませる。
    for (const face of solid.faces) face.tone *= face.n[1] > 0.5 ? 0.5 : 0.12;
    drawFaces(raster, view, solid, 1);
    drawEdges(raster, view, solid, false, 0.03);

    // 裾は紙に溶ける。下ほど点が抜けていく。
    const base = view.project([0, 0, 0])[1];
    const band = ppu * 2.6;
    for (let y = Math.max(0, Math.floor(base - band)); y < raster.h; y++) {
      const a = (y - (base - band)) / band;
      for (let x = 0; x < raster.w; x++) {
        const i = y * raster.w + x;
        if (raster.color[i] !== NONE && a > threshold(x + 2, y + 1)) raster.color[i] = NONE;
      }
    }
    // 床の点。
    for (let x = -6; x <= 6; x++) {
      for (let z = -6; z <= 6; z++) {
        const p = view.project([x, 0, z]);
        const px = Math.floor(p[0]);
        const py = Math.floor(p[1]);
        const d = Math.hypot(x, z) / 7;
        if (
          d < 1 &&
          raster.color[py * raster.w + px] === NONE &&
          0.6 * (1 - d) > threshold(px, py)
        ) {
          raster.set(px, py, INK);
        }
      }
    }

    const m = 3;
    drawText(raster, '1:4:9', m, m, INK);
    drawText(raster, '1^2:2^2:3^2', m, m + 10, INK);
    drawText(raster, 'V 36', m, m + 20, INK);
    if (f.aligned) {
      const label = 'ALIGNMENT';
      drawText(
        raster,
        label,
        Math.round((raster.w - textWidth(label)) / 2),
        raster.h - m - 7,
        AMBER,
      );
    }
    raster.present(out, palette);
    ctx2d.putImageData(image, 0, 0);
  }

  function loop() {
    raf = 0;
    draw();
    const aligning = now() - touchedAt < ALIGN;
    if (visible && !document.hidden && (!reduced.matches || aligning))
      raf = requestAnimationFrame(loop);
  }
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(loop);
  };

  buttonEl.addEventListener('click', () => {
    if (now() - touchedAt < ALIGN) return;
    touchedAt = now();
    cluster();
    kick();
  });
  new ResizeObserver(resize).observe(root);
  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible) kick();
  }).observe(root);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) kick();
  });
  resize();
  kick();
}
