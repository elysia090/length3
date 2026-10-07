import { glyphRows } from '../../shared/pixel/font';
import {
  add,
  clamp,
  easeOutBack,
  hash,
  IDENTITY,
  mul,
  rotX,
  rotY,
  rotZ,
  type Vec3,
} from '../../shared/pixel/math';
import { INK, Raster, threshold } from '../../shared/pixel/raster';
import {
  type CubeState,
  cubeSolid,
  drawEdges,
  drawFaces,
  shovelSolids,
  View,
} from '../../shared/pixel/solids';

/**
 * 404。点の字で組んだ「404」が、面のない線画（体積ゼロ）で床に立っている。
 * 隣のシャベルが 1.4 秒ごとに 1 個ずつすくって放る。掘り尽くすと、字は
 * 上から降ってきて組み直る。押すとすぐに 1 個掘る。字は描き込まない。
 */

const DIG = 1.4;
const FLIGHT = 0.7;

export function voxels404(): Vec3[] {
  const out: Vec3[] = [];
  [...'404'].forEach((ch, k) => {
    glyphRows(ch).forEach((row, j) => {
      for (let i = 0; i < row.length; i++) if (row[i] === '1') out.push([k * 6 + i - 8, 6 - j, 0]);
    });
  });
  return out;
}

function rgba(css: string, fallback: number): number {
  const m = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return fallback;
  const v = Number.parseInt(m[1] ?? '0', 16);
  return (0xff << 24) | ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff);
}

export function mountVoid(root: HTMLElement): void {
  const canvasEl = root.querySelector<HTMLCanvasElement>('canvas');
  const buttonEl = root.querySelector<HTMLButtonElement>('button');
  const context = canvasEl?.getContext('2d');
  if (!canvasEl || !buttonEl || !context) return;
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
  const cells = voxels404();
  // 掘る順は字の上から。
  const order = cells
    .map((_, i) => i)
    .sort((a, b) => (cells[b]?.[1] ?? 0) - (cells[a]?.[1] ?? 0) || hash(a) - hash(b));
  const dugAt = new Map<number, number>();
  let refillAt = -1;
  let next = 0;
  let lastDig = 0;
  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;
  let image: ImageData | null = null;
  let out: Uint32Array | null = null;
  let raf = 0;
  let visible = true;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w0 = root.clientWidth * dpr;
    if (w0 <= 0) return;
    const px = Math.max(1, Math.round(w0 / 220));
    const w = Math.floor(w0 / px);
    const h = Math.round(w * 0.42);
    if (w !== raster.w || h !== raster.h) {
      raster.resize(w, h);
      canvas.width = w;
      canvas.height = h;
      image = ctx2d.createImageData(w, h);
      out = new Uint32Array(image.data.buffer);
    }
    draw();
  }

  function dig(t: number) {
    if (refillAt > 0) return;
    const i = order[next];
    if (i === undefined) return;
    dugAt.set(i, t);
    next++;
    lastDig = t;
    if (next >= order.length) refillAt = t + FLIGHT + 0.6;
  }

  function draw() {
    if (!image || !out) return;
    const t = now();
    if (!reduced && t - lastDig > DIG) dig(t);
    if (refillAt > 0 && t > refillAt + 1.2) {
      dugAt.clear();
      next = 0;
      refillAt = -1;
    }
    raster.clear();
    const ppu = Math.min(raster.w / 30, raster.h / 11);
    const view = new View(
      {
        azimuth: 0.32 + (reduced ? 0 : Math.sin(t * 0.2) * 0.12),
        elevation: 0.38,
        target: [2, 3, 0],
        span: 1,
      },
      ppu,
      raster.w / 2,
      raster.h * 0.55,
    );
    const pivot: Vec3 = [11, 0, 1.5];
    const since = t - lastDig;
    const spin = reduced ? 0.4 : t * 0.9 + Math.PI * easeOutBack(clamp(since / 0.3));
    const shovel = {
      pivot,
      scale: 1.7,
      rot: mul(rotY(spin), mul(rotZ(0.05 * Math.sin(t)), rotX(-0.62))),
    };
    for (const s of shovelSolids(shovel)) {
      drawFaces(raster, view, s, 0.9);
      drawEdges(raster, view, s, false, 0.05);
    }
    cells.forEach((c, i) => {
      const at = dugAt.get(i);
      let base: Vec3 = c;
      let rot = IDENTITY;
      let hot = 0;
      if (refillAt > 0 && t > refillAt) {
        // 組み直し: 上から降ってくる。
        const a = clamp((t - refillAt - hash(i) * 0.6) / 0.4);
        base = add(c, [0, (1 - a * a) * 8, 0]);
        if (a <= 0) return;
      } else if (at !== undefined) {
        const a = (t - at) / FLIGHT;
        if (a > 1) return;
        base = add(c, [a * 16, a * 9 - a * a * 6, a * 6]);
        rot = mul(rotX(a * 7), rotZ(a * 5));
        hot = 1;
      }
      const cube: CubeState = {
        base,
        size: 0.94,
        rot,
        squash: [1, 1, 1],
        hot,
        composite: false,
        airborne: 0,
        landed: true,
      };
      const s = cubeSolid(cube, 0);
      if (hot) drawFaces(raster, view, s, 0.95);
      drawEdges(raster, view, s, !hot, 0.03);
    });
    for (let x = -14; x <= 16; x += 1) {
      for (let z = -5; z <= 6; z += 1) {
        const p = view.project([x, 0, z]);
        const px = Math.floor(p[0]);
        const py = Math.floor(p[1]);
        const d = Math.hypot(x - 1, z * 2) / 17;
        if (
          d < 1 &&
          raster.depth[py * raster.w + px] === -Infinity &&
          0.6 * (1 - d) > threshold(px, py)
        ) {
          raster.set(px, py, INK);
        }
      }
    }
    raster.present(out, palette);
    ctx2d.putImageData(image, 0, 0);
  }

  function loop() {
    raf = 0;
    draw();
    if (visible && !document.hidden && !reduced) raf = requestAnimationFrame(loop);
  }
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(loop);
  };
  buttonEl.addEventListener('click', () => {
    dig(now());
    kick();
  });
  new ResizeObserver(resize).observe(root);
  new IntersectionObserver((e) => {
    visible = e.some((x) => x.isIntersecting);
    if (visible) kick();
  }).observe(root);
  resize();
  kick();
}
