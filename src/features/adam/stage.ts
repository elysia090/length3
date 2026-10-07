import { clamp } from '../../shared/pixel/math';
import { AMBER, INK, NONE, Raster, threshold } from '../../shared/pixel/raster';
import { handheld } from './handheld';

/**
 * About の絵。《アダムの創造》を、ほかの舞台と同じ網点で二色刷りにする。
 * 版は scripts/adam/bake.ts が焼いた三枚（墨・墨を琥珀に置き換える量・
 * 漆喰に落ちる琥珀の影）。ここでは刷るだけ。墨と琥珀は別々の網目で刷り、
 * 影の版だけ 1 画素ずらす（孔版の見当ずれ）。
 *
 * 網点の格子は画面に固定し、絵のほうを手持ちのカメラで揺らすので、揺れる
 * たびに点がわずかに組み変わって、粒子の荒いフィルムのように息をする。
 * 24 コマで描く。画面の外では止まり、動きを減らす設定では一枚で止まる。
 */

/**
 * 網点 1 個の大きさ。広い画面で 560 列前後。狭い画面でも全景を刷るので、
 * 点は 1.75 CSS px を下回らせない（細かすぎると網点の絵ではなく写真の
 * 縮小に見える。粗い点のまま全体の形が読める抽象度に留める）。
 */
const TARGET_COLUMNS = 560;
const MIN_DOT = 1.75;
/** 寄りの中心（元絵の幅・高さに対する割合）。二人の指のあいだ。 */
const FOCUS: readonly [number, number] = [0.379, 0.451];
/** 額の縁で絵を紙に溶かす幅（幅・高さそれぞれに対する割合）。 */
const FADE_X = 0.1;
const FADE_Y = 0.18;

function rgba(css: string, fallback: number): number {
  const m = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return fallback;
  const v = Number.parseInt(m[1] ?? '0', 16);
  return (0xff << 24) | ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff);
}

interface Plates {
  w: number;
  h: number;
  /** 0 〜 1。墨 / 置き換え / 影。 */
  ink: Float32Array;
  swap: Float32Array;
  shadow: Float32Array;
}

/** RGBA の画素列から三枚の版を取り出す。 */
export function splitPlates(data: Uint8ClampedArray | Uint8Array, w: number, h: number): Plates {
  const n = w * h;
  const ink = new Float32Array(n);
  const swap = new Float32Array(n);
  const shadow = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    ink[i] = (data[i * 4] ?? 0) / 255;
    swap[i] = (data[i * 4 + 1] ?? 0) / 255;
    shadow[i] = (data[i * 4 + 2] ?? 0) / 255;
  }
  return { w, h, ink, swap, shadow };
}

async function loadPlates(src: string): Promise<Plates> {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
  if (!g) throw new Error('no 2d context');
  g.drawImage(img, 0, 0);
  return splitPlates(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
}

export function mountAdam(root: HTMLElement): void {
  const canvasEl = root.querySelector<HTMLCanvasElement>('canvas');
  const context = canvasEl?.getContext('2d');
  const src = root.dataset.src;
  if (!canvasEl || !context || !src) return;
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
  let plate: Plates | null = null;
  let image: ImageData | null = null;
  let out: Uint32Array | null = null;
  let raf = 0;
  let frame = -1;
  let visible = true;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w0 = root.clientWidth * dpr;
    const h0 = root.clientHeight * dpr;
    if (w0 <= 0 || h0 <= 0) return;
    const px = Math.max(1, Math.round(w0 / TARGET_COLUMNS), Math.round(dpr * MIN_DOT));
    const w = Math.floor(w0 / px);
    const h = Math.floor(h0 / px);
    if (w !== raster.w || h !== raster.h) {
      raster.resize(w, h);
      canvas.width = w;
      canvas.height = h;
      image = ctx2d.createImageData(w, h);
      out = new Uint32Array(image.data.buffer);
    }
    frame = -1;
    draw((performance.now() - t0) / 1000);
  }

  function draw(t: number) {
    if (!image || !out || !plate) return;
    const { w, h } = raster;
    const shot = handheld(t, reduced.matches);
    // 元絵を額いっぱいに（cover）、寄りの中心を額の中心に合わせる。
    const fit = Math.max(w / plate.w, h / plate.h) * shot.zoom;
    // 額が元絵の外へはみ出さない範囲で、指のあいだへ寄せる。
    const halfW = w / 2 / fit;
    const halfH = h / 2 / fit;
    const cx = clamp(FOCUS[0] * plate.w, halfW, plate.w - halfW);
    const cy = clamp(FOCUS[1] * plate.h, halfH, plate.h - halfH);
    const cos = Math.cos(-shot.roll);
    const sin = Math.sin(-shot.roll);
    const fadeX = w * FADE_X;
    const fadeY = h * FADE_Y;
    const { ink, swap, shadow } = plate;
    const pw = plate.w;
    const ph = plate.h;
    const color = raster.color;
    const pick = (v: Float32Array, i: number, fx: number, fy: number) =>
      ((v[i] ?? 0) * (1 - fx) + (v[i + 1] ?? 0) * fx) * (1 - fy) +
      ((v[i + pw] ?? 0) * (1 - fx) + (v[i + pw + 1] ?? 0) * fx) * fy;
    for (let y = 0; y < h; y++) {
      const dy = y + 0.5 - h / 2 - shot.y * w;
      for (let x = 0; x < w; x++) {
        const dx = x + 0.5 - w / 2 - shot.x * w;
        const sx = cx + (dx * cos - dy * sin) / fit;
        const sy = cy + (dx * sin + dy * cos) / fit;
        const x0 = Math.max(0, Math.min(pw - 2, Math.floor(sx)));
        const y0 = Math.max(0, Math.min(ph - 2, Math.floor(sy)));
        const fx = clamp(sx - x0);
        const fy = clamp(sy - y0);
        const i = y0 * pw + x0;
        // 額の縁では紙へ溶ける。
        let e = Math.min(
          Math.min(x + 0.5, w - x - 0.5) / fadeX,
          Math.min(y + 0.5, h - y - 0.5) / fadeY,
        );
        e = e >= 1 ? 1 : e * e * (3 - 2 * e);
        const k = y * w + x;
        if (pick(ink, i, fx, fy) * e > threshold(x, y)) {
          color[k] = pick(swap, i, fx, fy) * e > threshold(x + 1, y + 2) ? AMBER : INK;
        } else {
          // 影の版は 1 画素右へずれて刷られる。
          const j = Math.max(0, i - 1);
          color[k] = pick(shadow, j, fx, fy) * e > threshold(x + 2, y + 1) ? AMBER : NONE;
        }
      }
    }
    raster.present(out, palette);
    ctx2d.putImageData(image, 0, 0);
  }

  function loop() {
    raf = 0;
    const t = (performance.now() - t0) / 1000;
    const f = Math.floor(t * 24);
    if (f !== frame) {
      frame = f;
      draw(t);
    }
    if (visible && !document.hidden && !reduced.matches) raf = requestAnimationFrame(loop);
  }
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(loop);
  };

  loadPlates(src)
    .then((p) => {
      plate = p;
      new ResizeObserver(resize).observe(root);
      new IntersectionObserver((entries) => {
        visible = entries.some((e) => e.isIntersecting);
        if (visible) kick();
      }).observe(root);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) kick();
      });
      reduced.addEventListener('change', kick);
      resize();
      kick();
    })
    .catch(() => {
      // 絵が読めなければ額は空のまま。代替テキストは figure が持つ。
    });
}
