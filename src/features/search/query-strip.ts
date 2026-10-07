import { glyphRows } from '../../shared/pixel/font';
import { clamp, hash, IDENTITY, mul, rotX, rotZ, spring } from '../../shared/pixel/math';
import { Raster } from '../../shared/pixel/raster';
import { type CubeState, cubeSolid, drawEdges, drawFaces, View } from '../../shared/pixel/solids';

/**
 * 検索欄の上の帯。打った字を 5×7 の点の字から組んだ立体（ボクセル）に
 * して落とす。Robot Tune と一覧の舞台と同じ 1 ビットの網点で描く。
 *
 * - 1 字打つごとに、その字が上から落ちて潰れ、琥珀に光って冷める。
 * - 消した字は回りながら飛んでいく。
 * - 結果が 1 件も無いとき、字は面を失って辺だけになる（体積ゼロ）。
 *   見つかった瞬間に体積が満ち、字の列を波が走る。
 * - HUD は検索語の体積（ボクセルの数）V と L = ∛V、結果の件数 N。
 *
 * 帯が動くのは、検索が開いていて、何かが動いているあいだだけ。
 */

export interface Letter {
  ch: string;
  voxels: readonly (readonly [number, number])[];
  born: number;
  died: number | null;
}

const GLYPH_W = 6;
const GLYPH_H = 7;
const DROP = 0.26;
const LIFE_AFTER_DEATH = 0.45;

/** 字を点の座標（列、下からの段）に分ける。空白は点を持たない。 */
export function voxelize(ch: string): [number, number][] {
  if (ch === ' ') return [];
  const out: [number, number][] = [];
  glyphRows(ch).forEach((row, j) => {
    for (let i = 0; i < row.length; i++) if (row[i] === '1') out.push([i, GLYPH_H - 1 - j]);
  });
  return out;
}

/**
 * 前の字の並びと新しい検索語を比べ、共通の頭は残し、外れた尻尾は
 * 「飛んでいく」に、新しい尻尾は「落ちてくる」にする。
 */
export function diffLetters(letters: readonly Letter[], query: string, now: number): Letter[] {
  const alive = letters.filter((l) => l.died === null);
  const chars = [...query];
  let keep = 0;
  while (keep < alive.length && keep < chars.length && alive[keep]?.ch === chars[keep]) keep++;
  const next: Letter[] = letters.filter((l) => l.died !== null && now - l.died < LIFE_AFTER_DEATH);
  alive.forEach((l, i) => {
    next.push(i < keep ? l : { ...l, died: now });
  });
  chars.slice(keep).forEach((ch, i) => {
    next.push({ ch, voxels: voxelize(ch), born: now + i * 0.035, died: null });
  });
  return next;
}

function rgba(css: string, fallback: number): number {
  const m = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return fallback;
  const v = Number.parseInt(m[1] ?? '0', 16);
  return (0xff << 24) | ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff);
}

export interface QueryStrip {
  setQuery(query: string): void;
  setCount(count: number, searched: boolean): void;
  start(): void;
  stop(): void;
}

export function mountQueryStrip(canvas: HTMLCanvasElement): QueryStrip | null {
  const context = canvas.getContext('2d');
  if (!context) return null;
  const ctx2d: CanvasRenderingContext2D = context;
  const raster = new Raster();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const style = getComputedStyle(canvas);
  const palette = new Uint32Array([
    0,
    rgba(style.getPropertyValue('--bg'), 0xfffaf9f9),
    rgba(style.getPropertyValue('--ink'), 0xff1e1915),
    rgba(style.getPropertyValue('--amber'), 0xff0c58ea),
  ]);
  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;
  let letters: Letter[] = [];
  let count = 0;
  let shown = 0;
  let searched = false;
  let rippleAt = -10;
  let running = false;
  let raf = 0;
  let image: ImageData | null = null;
  let out: Uint32Array | null = null;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (cssW <= 0 || cssH <= 0) return;
    const px = Math.max(1, Math.round(dpr * 2));
    const w = Math.floor((cssW * dpr) / px);
    const h = Math.floor((cssH * dpr) / px);
    if (w !== raster.w || h !== raster.h) {
      raster.resize(w, h);
      canvas.width = w;
      canvas.height = h;
      image = ctx2d.createImageData(w, h);
      out = new Uint32Array(image.data.buffer);
    }
  }

  function busy(t: number): boolean {
    if (letters.some((l) => (l.died ?? l.born) > t - 1.2)) return true;
    if (t - rippleAt < 1.2 || Math.round(shown) !== count) return true;
    return letters.every((l) => l.died !== null);
  }

  function draw() {
    if (!image || !out) return;
    const t = now();
    const still = reduced.matches;
    shown = still ? count : shown + (count - shown) * 0.25;
    const alive = letters.filter((l) => l.died === null);
    const hollow = searched && alive.length > 0 && count === 0;
    raster.clear();

    const n = Math.max(alive.length, 1);
    const widthUnits = Math.max(n * GLYPH_W, 18);
    const ppu = Math.min(raster.h / 15, (raster.w * 0.6) / widthUnits);
    const camera = {
      azimuth: 0.38,
      elevation: 0.42,
      target: [0, 3.6, 0] as [number, number, number],
      span: 1,
    };
    // 字は帯の真ん中に。隅に数字は置かない。
    const view = new View(camera, ppu, raster.w * 0.5, raster.h * 0.56);
    const cubes: { c: CubeState; hot: number }[] = [];
    const startX = -(alive.length * GLYPH_W) / 2;
    let slot = 0;
    for (const l of letters) {
      const isAlive = l.died === null;
      const index = isAlive ? slot++ : alive.length;
      const age = t - l.born;
      if (age < 0 && !still) continue;
      let dx = startX + index * GLYPH_W;
      let dy = 0;
      let sq = 1;
      let hot = 0;
      let rot = IDENTITY;
      if (!still && isAlive) {
        // 落ちて、潰れて、戻る。
        const fall = clamp(age / DROP);
        dy = 9 * (1 - fall * fall);
        sq = age > DROP ? 1 - 0.32 * Math.max(-0.4, spring(age - DROP, 4, 10)) : 1;
        hot = clamp(1 - (age - DROP) / 0.55);
        // 件数が増えたときの波。
        const wave = t - rippleAt - index * 0.045;
        dy += 1.6 * Math.max(0, Math.sin(Math.PI * clamp(wave / 0.26)));
      }
      if (!isAlive && l.died !== null) {
        const a = t - l.died;
        if (a > LIFE_AFTER_DEATH) continue;
        dx += a * 22;
        dy += a * 16 - a * a * 30;
        rot = mul(rotZ(-a * 9 * (0.5 + hash(l.born))), rotX(a * 6));
        hot = 1;
      }
      for (const [vx, vy] of l.voxels) {
        cubes.push({
          c: {
            base: [dx + vx, (dy + vy) * sq, 0],
            size: 1,
            rot,
            squash: [1, sq, 1],
            hot,
            composite: false,
            airborne: 0,
            landed: true,
          },
          hot,
        });
      }
    }
    // 何も打っていないときは、点の柱がゆっくり満ちたり抜けたりする（カーソル）。
    if (alive.length === 0) {
      const solidCursor = still || Math.floor(t / 0.7) % 2 === 0;
      for (let y = 0; y < GLYPH_H; y++) {
        cubes.push({
          c: {
            base: [startX + 0.5, y, 0],
            size: 1,
            rot: IDENTITY,
            squash: [1, 1, 1],
            hot: 0,
            composite: false,
            airborne: 0,
            landed: solidCursor,
          },
          hot: 0,
        });
      }
    }
    // 字として読めるように、正面はほぼ墨で塗り、上と横だけを網点にする。
    const solids = cubes.map(({ c }) => {
      const s = cubeSolid(c, 0);
      for (const f of s.faces) {
        const [nx, ny, nz] = f.n;
        f.tone = nz > 0.7 ? 0.04 : ny > 0.7 ? 0.62 : Math.abs(nx) > 0.7 ? 0.3 : f.tone;
      }
      return s;
    });
    if (!hollow) {
      solids.forEach((s, k) => {
        const cube = cubes[k];
        if (cube && (cube.c.landed || cube.hot > 0)) drawFaces(raster, view, s, 1);
      });
    }
    solids.forEach((s, k) => {
      const cube = cubes[k];
      if (hollow || (cube && !cube.c.landed)) drawEdges(raster, view, s, hollow, 0.05);
    });

    raster.present(out, palette);
    ctx2d.putImageData(image, 0, 0);
    if (running && !still && busy(t)) raf = requestAnimationFrame(loop);
    else raf = 0;
  }

  function loop() {
    raf = 0;
    draw();
  }
  const kick = () => {
    if (running && !raf) raf = requestAnimationFrame(loop);
  };

  new ResizeObserver(() => {
    resize();
    kick();
  }).observe(canvas);

  return {
    setQuery(query) {
      letters = diffLetters(letters, query, now());
      searched = false;
      kick();
    },
    setCount(next, done) {
      if (next > count) rippleAt = now();
      count = next;
      searched = done;
      kick();
    },
    start() {
      running = true;
      resize();
      kick();
    },
    stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
