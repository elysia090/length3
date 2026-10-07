/**
 * data/creation-of-adam.jpg（ミケランジェロ《アダムの創造》、システィーナ
 * 礼拝堂天井画、1512 年頃。パブリックドメイン）から、About の絵の版を作る。
 *
 *   src/features/adam/adam.webp   横 640 px、可逆。3 つの版を色の 3 チャンネルに
 *                                  R = 墨の濃さ / G = 墨の点を琥珀に置き換える量 /
 *                                  B = 漆喰に落ちる琥珀の影
 *
 * 色の付け方はここで決める。琥珀は面を塗らない。決めた場所だけ、墨の点の
 * 何割かを置き換えるか、紙の上に少し落とすかで効かせる。
 *
 *   1. 深い闇。その暗い点の一部が熾火になる（潰さず、紙も覗く）。
 *      神の腕が出てくる外套の窪み、外套の上の丸天井、神の体の下に続く影の
 *      塊、アダムの胴の下と膝の下の土、左下の隅。縁は広くぼかして滑らかに
 *      消す。丸天井の下半分（外套の右の縁）には置かない。
 *   2. アダムの足元の大きな土。ごく薄く温める。頭のほうへは届かせない。
 *   3. 指先の下に落ちる影。漆喰の上だけ。
 *
 * ほかはすべて墨で、どこも潰さない（いちばん暗いところでも 1 割は紙が覗く）。
 * ブラウザ側（stage.ts）は網点に刷って、手持ちのカメラで揺らすだけ。
 *
 *   node ./scripts/adam/bake.ts
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const SRC = resolve(root, 'data/creation-of-adam.jpg');
const OUT = resolve(root, 'src/features/adam/adam.webp');
const W = 640;
/** 元絵（1280 × 581）の座標で描いた形を、版の座標へ。 */
const K = W / 1280;

const probe = execFileSync('ffprobe', [
  '-v',
  'error',
  '-select_streams',
  'v:0',
  '-show_entries',
  'stream=width,height',
  '-of',
  'csv=p=0',
  SRC,
])
  .toString()
  .trim()
  .split(',')
  .map(Number);
const H = Math.round(((probe[1] ?? 581) * W) / (probe[0] ?? 1280));

const rgb = execFileSync('ffmpeg', [
  '-loglevel',
  'error',
  '-i',
  SRC,
  '-vf',
  `scale=${W}:${H}:flags=lanczos,unsharp=5:5:0.9`,
  '-f',
  'rawvideo',
  '-pix_fmt',
  'rgb24',
  '-',
]);
const N = W * H;
const R = new Float32Array(N);
const G = new Float32Array(N);
const B = new Float32Array(N);
for (let i = 0; i < N; i++) {
  R[i] = rgb[i * 3] ?? 0;
  G[i] = rgb[i * 3 + 1] ?? 0;
  B[i] = rgb[i * 3 + 2] ?? 0;
}

const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function percentile(v: Float32Array, q: number): number {
  return Float32Array.from(v).sort()[Math.floor(q * (v.length - 1))] ?? 0;
}

/** 箱ぼかしを 3 回（ほぼガウス）。 */
function blur(src: Float32Array, r: number): Float32Array {
  if (r <= 0) return src;
  let a = Float32Array.from(src);
  const k = Math.max(1, Math.round(r));
  for (let pass = 0; pass < 3; pass++) {
    const b = new Float32Array(N);
    for (let y = 0; y < H; y++) {
      let acc = 0;
      for (let x = -k; x <= k; x++) acc += a[y * W + Math.min(W - 1, Math.max(0, x))] ?? 0;
      for (let x = 0; x < W; x++) {
        b[y * W + x] = acc / (2 * k + 1);
        acc += (a[y * W + Math.min(W - 1, x + k + 1)] ?? 0) - (a[y * W + Math.max(0, x - k)] ?? 0);
      }
    }
    const c = new Float32Array(N);
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let y = -k; y <= k; y++) acc += b[Math.min(H - 1, Math.max(0, y)) * W + x] ?? 0;
      for (let y = 0; y < H; y++) {
        c[y * W + x] = acc / (2 * k + 1);
        acc +=
          (b[Math.min(H - 1, y + k + 1) * W + x] ?? 0) - (b[Math.max(0, y - k) * W + x] ?? 0);
      }
    }
    a = c;
  }
  return a;
}

function polygon(points: readonly [number, number][], r: number): Float32Array {
  const m = new Float32Array(N);
  const p = points.map(([x, y]) => [x * K, y * K] as const);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let inside = false;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const [xi, yi] = p[i] ?? [0, 0];
        const [xj, yj] = p[j] ?? [0, 0];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      m[y * W + x] = inside ? 1 : 0;
    }
  }
  return blur(m, r);
}

/** 楕円のぼかし。tilt は時計回りのラジアン。 */
function glow(cx: number, cy: number, rx: number, ry: number, tilt = 0): Float32Array {
  const m = new Float32Array(N);
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x / K - cx;
      const dy = y / K - cy;
      const u = (dx * c + dy * s) / rx;
      const v = (-dx * s + dy * c) / ry;
      m[y * W + x] = smooth(1, 0, Math.hypot(u, v));
    }
  }
  return m;
}

// 墨の版。青寄りの明るさで取ると、肌は空より暗く、漆喰は白く抜ける。
const gray = new Float32Array(N);
for (let i = 0; i < N; i++) gray[i] = 0.3 * (G[i] ?? 0) + 0.7 * (B[i] ?? 0);
const lo = percentile(gray, 0.02);
const hi = percentile(gray, 0.8);
const base = new Float32Array(N);
const ink = new Float32Array(N);
for (let i = 0; i < N; i++) {
  base[i] = clamp(((gray[i] ?? 0) - lo) / (hi - lo));
  let v = 1 - (base[i] ?? 0) ** 1.2;
  v += 0.5 * (v * v * (3 - 2 * v) - v);
  // 漆喰の地は刷らない（ひびだけ残る）。どこも潰さない。
  ink[i] = v < 0.12 ? 0 : Math.min(v, 0.9);
}

// 1. 深い闇。楕円で置くもの（元絵の座標で、中心・半径・傾き）と、形で
//    囲うもの。窪みは赤い闇だけを拾い（同じ暗さでも天使の肌は除く）、
//    ほかは暗さだけで拾う。
const EMBERS: { at: [number, number, number, number, number]; red: boolean }[] = [
  { at: [690, 320, 85, 100, 0], red: true }, // 神の腕が出てくる外套の窪み
  { at: [1063, 146, 113, 135, 0], red: false }, // 外套の上の丸天井
  { at: [357, 426, 75, 75, 0], red: false }, // 立てた膝の下
];
// 形で囲った闇。広くぼかして、縁を滑らかに消す。
const REGIONS: [number, number][][] = [
  // 左下の隅、アダムの胴の下の土
  [
    [0, 401],
    [0, 581],
    [215, 581],
    [212, 504],
    [163, 472],
    [33, 407],
  ],
  // 膝の下の土
  [
    [350, 500],
    [363, 415],
    [420, 401],
    [520, 457],
    [585, 505],
    [585, 581],
    [350, 581],
  ],
  // 神の体の下に続く影の塊
  [
    [646, 315],
    [677, 263],
    [730, 252],
    [793, 284],
    [855, 341],
    [1002, 368],
    [1170, 415],
    [1180, 452],
    [1107, 488],
    [897, 483],
    [761, 452],
    [677, 399],
    [646, 368],
  ],
];
// 置かないところ。丸天井の熾火の下半分を消す。
const QUIET = polygon(
  [
    [1002, 268],
    [1149, 150],
    [1180, 150],
    [1180, 330],
    [1149, 330],
  ],
  10,
);
const pocket = new Float32Array(N);
const deepAt = (i: number) => smooth(0.55, 0.85, ink[i] ?? 0);
for (const { at, red } of EMBERS) {
  const m = glow(...at);
  for (let i = 0; i < N; i++) {
    const rg = (R[i] ?? 0) - (G[i] ?? 0);
    const hue = red
      ? smooth(8, 40, rg) * smooth(1.3, 0.5, ((G[i] ?? 0) - (B[i] ?? 0)) / Math.max(rg, 1))
      : 1;
    const v = (m[i] ?? 0) * hue * deepAt(i);
    if (v > (pocket[i] ?? 0)) pocket[i] = v;
  }
}
for (const shape of REGIONS) {
  const m = polygon(shape, 14);
  for (let i = 0; i < N; i++) {
    const v = (m[i] ?? 0) * deepAt(i);
    if (v > (pocket[i] ?? 0)) pocket[i] = v;
  }
}
for (let i = 0; i < N; i++) pocket[i] = (pocket[i] ?? 0) * (1 - (QUIET[i] ?? 0));

// 2. 足元の土。緑と青灰の土だけ（肌は除く）。
const FEET: [number, number][] = [
  [150, 581],
  [150, 480],
  [250, 430],
  [330, 335],
  [375, 322],
  [470, 380],
  [560, 440],
  [640, 510],
  [705, 581],
];
const feetShape = polygon(FEET, 5);
const feetAt = glow(540, 540, 230, 150);
const feet = new Float32Array(N);
for (let i = 0; i < N; i++) {
  const earth = clamp((25 - ((R[i] ?? 0) - (G[i] ?? 0))) / 20);
  feet[i] = (feetShape[i] ?? 0) * (feetAt[i] ?? 0) * earth;
}

// 3. 指先の影。二つの手の肌（空より赤い）を右下へずらし、漆喰の上にだけ落とす。
const zone = polygon(
  [
    [400, 215],
    [600, 215],
    [600, 312],
    [400, 312],
  ],
  3,
);
const skin = new Float32Array(N);
for (let i = 0; i < N; i++) skin[i] = clamp(((R[i] ?? 0) - (B[i] ?? 0) - 48) / 14) * (zone[i] ?? 0);
const DX = Math.round(5 * K * 2);
const DY = Math.round(8 * K * 2);
const moved = new Float32Array(N);
for (let y = DY; y < H; y++) {
  for (let x = DX; x < W; x++) moved[y * W + x] = skin[(y - DY) * W + (x - DX)] ?? 0;
}
const fall = blur(moved, 1.5);
const body = blur(skin, 1);
const cast = new Float32Array(N);
for (let i = 0; i < N; i++) {
  cast[i] = (base[i] ?? 0) > 0.55 ? clamp((fall[i] ?? 0) - 1.5 * (body[i] ?? 0)) : 0;
}

const out = Buffer.alloc(N * 3);
for (let i = 0; i < N; i++) {
  const p = pocket[i] ?? 0;
  // 熾火のところは墨を少し引いて、点のあいだに紙を覗かせる。
  out[i * 3] = Math.round(255 * (ink[i] ?? 0) * (1 - 0.35 * p));
  out[i * 3 + 1] = Math.round(255 * Math.max(0.82 * p, 0.2 * (feet[i] ?? 0)));
  out[i * 3 + 2] = Math.round(255 * 0.4 * (cast[i] ?? 0));
}

execFileSync(
  'ffmpeg',
  [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    '-s',
    `${W}x${H}`,
    '-i',
    '-',
    '-c:v',
    'libwebp',
    '-lossless',
    '1',
    '-compression_level',
    '6',
    OUT,
  ],
  { input: out },
);
console.log(`wrote ${OUT} (${W}×${H})`);
