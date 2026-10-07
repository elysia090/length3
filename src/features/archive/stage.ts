import { clamp } from '../../shared/pixel/math';
import { Raster } from '../../shared/pixel/raster';
import { archiveSceneAt, type Interaction } from './choreo';
import { type ArchiveSource, buildArchive } from './layout';
import { type ArchiveFrame, type Hit, renderArchive } from './render';
import { clods, dig, newYard, pitDepth, treasureCubes, visibleTreasures, yardShovel } from './yard';

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
 *
 * シャベルは掴んで運べ、床を押すとそこへ跳んで掘る（yard.ts）。
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
  let frame: ArchiveFrame | null = null;
  const yard = newYard([archive.width / 2 + 0.6, archive.depth / 2 - 0.4]);
  // 掴んでいるあいだの位置と速さ（床の上、単位/秒）。傾きはこれをばねで追う。
  let grab: {
    x: number;
    z: number;
    vx: number;
    vz: number;
    sx: number;
    sy: number;
    moved: boolean;
  } | null = null;
  const leanV: [number, number] = [0, 0];
  let lastDraw = -1;
  // カメラの時計。シャベルに触れてから 8 秒は進めない（掘った場所が動かない）。
  let cameraT = 0;
  let playedAt = -99;
  const PLAY_HOLD = 8;
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

  /** 傾きのばね。掴んで運ぶ速さの分だけ、運ぶ向きと逆へ遅れて傾く。 */
  function stepLean(dt: number) {
    const goal: [number, number] = grab
      ? [clamp(-grab.vx * 0.09, -0.7, 0.7), clamp(grab.vz * 0.09, -0.7, 0.7)]
      : [0, 0];
    const w = 2 * Math.PI * 2.2;
    for (let c = 0; c < 2; c++) {
      const x = yard.lean[c] ?? 0;
      const v = leanV[c] ?? 0;
      const a = w * w * ((goal[c] ?? 0) - x) - 2 * 0.35 * w * v;
      leanV[c] = v + a * dt;
      yard.lean[c] = x + (leanV[c] ?? 0) * dt;
    }
    if (grab) {
      grab.vx *= Math.exp(-dt * 8);
      grab.vz *= Math.exp(-dt * 8);
    }
  }

  function draw() {
    if (!image || !out) return;
    const t = now();
    const still = reduced.matches;
    const dt = lastDraw >= 0 ? Math.min(0.05, t - lastDraw) : 0;
    if (!still) stepLean(dt);
    if (grab || t - playedAt > PLAY_HOLD) cameraT += grab ? 0 : dt;
    lastDraw = t;
    const scene = archiveSceneAt(t, archive, interaction, still, cameraT);
    scene.shovel = yardShovel(
      yard,
      grab ? { ...scene.shovel, pivot: [grab.x, 0, grab.z] } : scene.shovel,
      t,
      still,
    );
    if (grab) yard.home = [grab.x, grab.z];
    frame = renderArchive(raster, archive, scene, {
      pits: yard.pits.map((p) => ({ x: p.x, z: p.z, depth: pitDepth(p, t) })),
      debris: clods(yard, t, still),
      finds: treasureCubes(yard, t, still),
    });
    hits = frame.hits;
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

  function rasterPoint(e: PointerEvent | MouseEvent): [number, number] {
    const rect = canvas.getBoundingClientRect();
    return [
      ((e.clientX - rect.left) / rect.width) * raster.w,
      ((e.clientY - rect.top) / rect.height) * raster.h,
    ];
  }

  const inside = (h: Hit, x: number, y: number, pad = 0) =>
    x >= h.x0 - pad && x <= h.x1 + pad && y >= h.y0 - pad && y <= h.y1 + pad;

  /** 床の上の点（区画の少し外まで）。 */
  function floorAt(e: PointerEvent | MouseEvent): [number, number] | null {
    const [x, y] = rasterPoint(e);
    const p = frame?.view.unproject(x, y, 0);
    if (!p) return null;
    const hx = archive.width / 2 + 1.5;
    const hz = archive.depth / 2 + 1.5;
    return [clamp(p[0], -hx, hx), clamp(p[2], -hz, hz)];
  }

  function hitAt(e: PointerEvent | MouseEvent): number {
    const [x, y] = rasterPoint(e);
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

  /** 柄の線分から数画素以内。外接矩形だと斜めの柄が周りの標本まで覆う。 */
  function overShovel(e: PointerEvent | MouseEvent): boolean {
    if (!frame) return false;
    const [x, y] = rasterPoint(e);
    const { x0, y0, x1, y1 } = frame.shovel;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const k = clamp(((x - x0) * dx + (y - y0) * dy) / Math.max(1e-6, dx * dx + dy * dy));
    return Math.hypot(x - (x0 + dx * k), y - (y0 + dy * k)) < Math.max(4, raster.w / 60);
  }

  function findAt(e: PointerEvent | MouseEvent): number {
    const [x, y] = rasterPoint(e);
    return frame?.finds.findIndex((h) => inside(h, x, y, 2)) ?? -1;
  }

  let suppressClick = false;
  canvas.addEventListener('pointerdown', (e) => {
    // 掘り出した箱と標本が先。シャベルはその次。
    if (e.button !== 0 || findAt(e) >= 0 || hitAt(e) >= 0 || !overShovel(e)) return;
    const p = floorAt(e);
    if (!p) return;
    canvas.setPointerCapture(e.pointerId);
    grab = { x: p[0], z: p[1], vx: 0, vz: 0, sx: e.clientX, sy: e.clientY, moved: false };
    playedAt = now();
    yard.held = true;
    yard.liftSince = now();
    canvas.style.cursor = 'grabbing';
    kick();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (grab) {
      const p = floorAt(e);
      if (p) {
        const dt = 1 / 60;
        grab.vx = grab.vx * 0.6 + ((p[0] - grab.x) / dt) * 0.4;
        grab.vz = grab.vz * 0.6 + ((p[1] - grab.z) / dt) * 0.4;
        grab.x = p[0];
        grab.z = p[1];
      }
      if (Math.hypot(e.clientX - grab.sx, e.clientY - grab.sy) > 4) grab.moved = true;
      if (reduced.matches) draw();
      return;
    }
    const i = hitAt(e);
    canvas.style.cursor =
      i >= 0 || findAt(e) >= 0 ? 'pointer' : overShovel(e) ? 'grab' : 'crosshair';
    if (i >= 0) hover(i);
  });

  const release = (e: PointerEvent) => {
    if (!grab) return;
    const clickedShovel = !grab.moved;
    grab = null;
    yard.held = false;
    yard.dropAt = now();
    if (clickedShovel) yard.spinAt = now();
    suppressClick = true;
    canvas.style.cursor = overShovel(e) ? 'grab' : '';
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    kick();
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => {
    canvas.style.cursor = '';
    hover(-1);
  });
  canvas.addEventListener('click', (e) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    // 掘り出した箱は、どれか一本の記事への入口。
    const f = findAt(e);
    const found = f >= 0 ? visibleTreasures(yard, now())[f] : undefined;
    const target = found ? archive.specimens[found.index] : undefined;
    if (target) {
      go(indexOf.get(target.slug) ?? -1, `/${target.slug}`);
      return;
    }
    const s = archive.specimens[hitAt(e)];
    if (s) {
      go(indexOf.get(s.slug) ?? -1, `/${s.slug}`);
      return;
    }
    const p = floorAt(e);
    if (!p || archive.specimens.length === 0) return;
    playedAt = now();
    dig(yard, p[0], p[1], now(), () => Math.floor(Math.random() * archive.specimens.length));
    kick();
    if (reduced.matches) draw();
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
