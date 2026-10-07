import { Raster } from '../../shared/pixel/raster';
import { archiveSceneAt, type Interaction } from './choreo';
import { type ArchiveSource, buildArchive } from './layout';
import { type Hit, renderArchive } from './render';

/**
 * 一覧の舞台を動かす。描画は 320 列前後の小さな画像で、端末の画素の
 * 整数倍に拡大する（Robot Tune と同じ）。
 *
 * 画面の外にあるとき、タブが隠れているときは止まる。動きを減らす設定の
 * ときは止めた一枚を描き、触れたときだけ描き直す。
 *
 * 一覧の行に触れるとその標本が照らされ、標本に触れるとその行が灯る。
 * 押すと（行でも標本でも）シャベルが標本を放ってから記事へ移る。舞台が
 * 見えていないとき、修飾キー付きのクリック、動きを減らす設定のときは、
 * 待たずにそのまま移る。
 */

const TARGET_COLUMNS = 320;
const THROW_MS = 560;

function rgba(css: string, fallback: number): number {
  const m = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return fallback;
  const v = Number.parseInt(m[1] ?? '0', 16);
  return (0xff << 24) | ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff);
}

export function mountArchive(root: HTMLElement): void {
  const canvasEl = root.querySelector<HTMLCanvasElement>('canvas');
  const context = canvasEl?.getContext('2d');
  if (!canvasEl || !context) return;
  // 下の関数宣言は巻き上げられるので、絞り込んだ型を名前ごと固定しておく。
  const canvas: HTMLCanvasElement = canvasEl;
  const ctx2d: CanvasRenderingContext2D = context;
  let sources: ArchiveSource[];
  try {
    sources = JSON.parse(root.dataset.sources ?? '[]') as ArchiveSource[];
  } catch {
    return;
  }
  const archive = buildArchive(sources);
  const raster = new Raster();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const style = getComputedStyle(root);
  const palette = new Uint32Array([
    0,
    rgba(style.getPropertyValue('--bg'), 0xfffaf9f9),
    rgba(style.getPropertyValue('--ink'), 0xff1e1915),
    rgba(style.getPropertyValue('--amber'), 0xff0c58ea),
  ]);
  const cards = new Map<string, HTMLElement>();
  for (const card of document.querySelectorAll<HTMLElement>('.article-card[data-slug]')) {
    cards.set(card.dataset.slug ?? '', card);
  }
  const indexOf = new Map(archive.specimens.map((s, i) => [s.slug, i]));
  const interaction: Interaction = { hover: -1, litSince: 0, thrown: -1, thrownAt: 0 };
  const t0 = performance.now();
  let image: ImageData | null = null;
  let out: Uint32Array | null = null;
  let hits: Hit[] = [];
  let px = 1;
  let visible = true;
  let raf = 0;
  let litCard: HTMLElement | undefined;

  const now = () => (performance.now() - t0) / 1000;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const cssW = root.clientWidth;
    if (cssW <= 0) return;
    const aspect = cssW >= 640 ? 2.39 : 4 / 3;
    const devW = cssW * dpr;
    px = Math.max(1, Math.round(devW / TARGET_COLUMNS));
    const w = Math.floor(devW / px);
    const h = Math.round(w / aspect);
    if (w !== raster.w || h !== raster.h) {
      raster.resize(w, h);
      canvas.width = w;
      canvas.height = h;
      image = ctx2d.createImageData(w, h);
      out = new Uint32Array(image.data.buffer);
    }
    canvas.style.width = `${(w * px) / dpr}px`;
    canvas.style.height = `${(h * px) / dpr}px`;
    draw();
  }

  function draw() {
    if (!image || !out) return;
    const t = now();
    const scene = archiveSceneAt(t, archive, interaction, reduced.matches);
    hits = renderArchive(raster, archive, scene);
    raster.present(out, palette);
    ctx2d.putImageData(image, 0, 0);
    const slug = archive.specimens[scene.lit]?.slug;
    const card = slug ? cards.get(slug) : undefined;
    if (card !== litCard) {
      if (litCard) delete litCard.dataset.lit;
      if (card && interaction.hover >= 0) card.dataset.lit = '';
      litCard = interaction.hover >= 0 ? card : undefined;
    }
  }

  function loop() {
    raf = 0;
    draw();
    if (visible && !document.hidden && !reduced.matches) raf = requestAnimationFrame(loop);
  }
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(loop);
  };

  function hover(i: number) {
    if (i === interaction.hover) return;
    interaction.hover = i;
    interaction.litSince = now();
    if (reduced.matches) draw();
  }

  function hitAt(e: PointerEvent | MouseEvent): number {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * raster.w;
    const y = ((e.clientY - rect.top) / rect.height) * raster.h;
    let best = -1;
    let area = Infinity;
    for (const h of hits) {
      if (x < h.x0 || x > h.x1 || y < h.y0 || y > h.y1) continue;
      const a = (h.x1 - h.x0) * (h.y1 - h.y0);
      if (a < area) {
        area = a;
        best = h.index;
      }
    }
    return best;
  }

  function stageInView(): boolean {
    const r = root.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight;
  }

  function go(i: number, href: string) {
    if (reduced.matches || !stageInView() || interaction.thrown >= 0) {
      window.location.href = href;
      return;
    }
    interaction.hover = i;
    interaction.litSince = now();
    interaction.thrown = i;
    interaction.thrownAt = now();
    kick();
    window.setTimeout(() => {
      window.location.href = href;
    }, THROW_MS);
  }

  canvas.addEventListener('pointermove', (e) => {
    const i = hitAt(e);
    canvas.style.cursor = i >= 0 ? 'pointer' : '';
    if (i >= 0) hover(i);
  });
  canvas.addEventListener('pointerleave', () => {
    canvas.style.cursor = '';
    hover(-1);
  });
  canvas.addEventListener('click', (e) => {
    const s = archive.specimens[hitAt(e)];
    if (s) go(indexOf.get(s.slug) ?? -1, `/${s.slug}`);
  });

  for (const [slug, card] of cards) {
    const i = indexOf.get(slug);
    if (i === undefined) continue;
    card.addEventListener('pointerenter', () => hover(i));
    card.addEventListener('pointerleave', () => hover(-1));
    card.addEventListener('focusin', () => hover(i));
    card.addEventListener('focusout', () => hover(-1));
    const link = card.querySelector<HTMLAnchorElement>('.card-title a');
    link?.addEventListener('click', (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      go(i, link.href);
    });
  }

  new ResizeObserver(resize).observe(root);
  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible) kick();
  }).observe(root);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) kick();
  });
  // ページが bfcache から戻ってきたら、投げた途中の状態を消す。
  window.addEventListener('pageshow', () => {
    interaction.thrown = -1;
    interaction.hover = -1;
    kick();
  });
  resize();
  kick();
}
