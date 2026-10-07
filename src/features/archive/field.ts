import { Raster } from '../../shared/pixel/raster';
import { archiveSceneAt, type Interaction } from './choreo';
import { type ArchiveSource, buildArchive } from './layout';
import { renderArchive } from './render';

/**
 * 一覧の舞台を、外から操る形で貸し出す。検索が使う。
 *
 * show(matches, lit) で、体積を持つ標本（一致した記事）と、照らす 1 個
 * （選んでいる結果）を決める。matches が null なら全部が体積を持ち、
 * 照らしは巡回する。空集合なら全部が長さだけになる（何も見つからない）。
 * 照らしが移るたびに、その標本が跳ねて琥珀に光り、波が広がる。
 *
 * 大きさは canvas の箱が決める。start / stop で描画を回す・止める。
 */

const TARGET_COLUMNS = 320;
/** 横長の帯では高さが足りなくなる。縦にもこれだけの画素を確保する。 */
const TARGET_ROWS = 110;

export interface ArchiveField {
  show(matches: ReadonlySet<string> | null, lit: string | null): void;
  start(): void;
  stop(): void;
}

function rgba(css: string, fallback: number): number {
  const m = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return fallback;
  const v = Number.parseInt(m[1] ?? '0', 16);
  return (0xff << 24) | ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff);
}

export function mountArchiveField(
  canvasEl: HTMLCanvasElement,
  sources: readonly ArchiveSource[],
): ArchiveField | null {
  const context = canvasEl.getContext('2d');
  if (!context) return null;
  const canvas: HTMLCanvasElement = canvasEl;
  const ctx2d: CanvasRenderingContext2D = context;
  const archive = buildArchive(sources);
  const indexOf = new Map(archive.specimens.map((s, i) => [s.slug, i]));
  const raster = new Raster();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const style = getComputedStyle(canvas);
  const palette = new Uint32Array([
    0,
    rgba(style.getPropertyValue('--bg'), 0xfffaf9f9),
    rgba(style.getPropertyValue('--ink'), 0xff1e1915),
    rgba(style.getPropertyValue('--amber'), 0xff0c58ea),
  ]);
  const interaction: Interaction = { hover: -1, litSince: 0, thrown: -1, thrownAt: 0 };
  let filled: Set<number> | null = null;
  let image: ImageData | null = null;
  let out: Uint32Array | null = null;
  let running = false;
  let raf = 0;
  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (cssW <= 0 || cssH <= 0) return;
    const px = Math.max(
      1,
      Math.min(Math.round((cssW * dpr) / TARGET_COLUMNS), Math.round((cssH * dpr) / TARGET_ROWS)),
    );
    const w = Math.floor((cssW * dpr) / px);
    const h = Math.floor((cssH * dpr) / px);
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
    const scene = archiveSceneAt(now(), archive, interaction, reduced.matches);
    renderArchive(raster, archive, scene, { filled });
    raster.present(out, palette);
    ctx2d.putImageData(image, 0, 0);
  }

  function loop() {
    raf = 0;
    draw();
    if (running && !document.hidden && !reduced.matches) raf = requestAnimationFrame(loop);
  }

  new ResizeObserver(resize).observe(canvas);

  return {
    show(matches, lit) {
      filled = matches ? new Set([...matches].flatMap((slug) => indexOf.get(slug) ?? [])) : null;
      const i = lit ? (indexOf.get(lit) ?? -1) : -1;
      if (i !== interaction.hover) {
        interaction.hover = i;
        interaction.litSince = now();
      }
      if (!raf) draw();
    },
    start() {
      running = true;
      resize();
      if (!raf) raf = requestAnimationFrame(loop);
    },
    stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
