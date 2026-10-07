import {
  add,
  apply,
  clamp,
  easeInCubic,
  easeOutBack,
  easeOutCubic,
  hash,
  IDENTITY,
  type Mat3,
  mul,
  rotX,
  rotY,
  rotZ,
  scale,
  spring,
  type Vec3,
  vlerp,
} from '../../shared/pixel/math';
import type { CameraState, CubeState, ShovelState } from '../../shared/pixel/solids';
import {
  INTRO_ONSET_SEC,
  INTRO_SILENCES,
  LOOP_ACCENTS,
  LOOP_ONSET_SEC,
  LOOP_SILENCES,
} from './envelope';
import { readTrack, springTrack } from './shovel-motion';
import { BEAT_SEC, BEATS_PER_LOOP, EIGHTH_SEC, INTRO_BEATS, LOOP_EIGHTHS } from './timeline';

export type { CameraState, CubeState, ShovelState };

/**
 * 振付。通算拍 B を受け取って、その瞬間の舞台を返す純関数。拍の長さと数は
 * 音から測った値（timeline.ts）で、振付はそれに合わせて組む。
 *
 * イントロ（8 分音符 64 個 = 32 拍、同じ 8 拍のフレーズが 4 回）は 1 拍に
 * 1 個ずつ、1 → 2³ の殻 7 個 → 3³ の殻 19 個と足して 27 拍目で 3³ を
 * 積み上げる。残りの 5 拍は溜めで、シャベルは地面を突く間隔を詰めていき、
 * 積んだ 27 個は 8 分音符で波打つ。
 *
 * ループ（8 分音符 32 個 = 16 拍、フレーズ 2 回）は、頭で前の 3³ を 1 個の
 * 立方体として数え直し、カメラを 3 倍引く。そこから前半で 2³ の殻、後半で
 * 3³ の殻を、測った強い音の上に一掬いずつ落とす（LOOP_THROWS）。後半で
 * いちばん強い音でカメラが切り返す。
 *
 * 世界の長さの単位は「いま積んでいる立方体 1 個の一辺」。段が上がるたびに
 * 単位ごと 3 倍になるので、座標は毎周 [0, 3]³ に収まる。
 */

export const STACK = 3;
const INTRO_CUBES = 27;
const BUILD_START = INTRO_CUBES;

type Cell = readonly [number, number, number];

function serpentine(cells: Cell[]): Cell[] {
  return cells.sort((a, b) => {
    if (a[1] !== b[1]) return a[1] - b[1];
    if (a[2] !== b[2]) return a[2] - b[2];
    return a[2] % 2 === 0 ? a[0] - b[0] : b[0] - a[0];
  });
}

function cellsOfShell(n: number): Cell[] {
  const out: Cell[] = [];
  for (let y = 0; y < n; y++)
    for (let z = 0; z < n; z++)
      for (let x = 0; x < n; x++) if (Math.max(x, y, z) === n - 1) out.push([x, y, z]);
  return serpentine(out);
}

/** 1 個、2³ の殻 7 個、3³ の殻 19 個。下の段から積むので、宙に浮く箱はない。 */
export const INTRO_SLOTS: readonly Cell[] = [
  ...cellsOfShell(1),
  ...cellsOfShell(2),
  ...cellsOfShell(3),
];

/**
 * ループで投げる一掬い。scoop で刃に載り、launch で放たれ、land で落ちる
 * （いずれもループ頭からの 8 分音符）。
 *
 * 着地は音で決める。ループの前半（8 拍）で 2³ の殻 7 個、後半で 3³ の殻
 * 19 個を積む。それぞれの半分のうち、測った立ち上がり（LOOP_ACCENTS）が
 * HIT 以上の 8 分音符をすべて着地点にし、殻を時間順に均等に分けて載せる。
 * 強い音が詰まっている所では一掬いが小さく速くなり、空いている所では
 * 大きくゆっくりになる。飛ぶ時間は前の着地からの間（1〜2 個ぶん）。
 * ループでは無音でも絵を止めない（timeline.ts の freezeStart）。無音は面が消えることで示す。
 */
export interface Throw {
  cells: readonly Cell[];
  scoop: number;
  launch: number;
  land: number;
}

/** 着地点にする立ち上がりの強さ（0..1、ループ内の最大で割った値）。 */
export const HIT = 0.5;
/** 地面を突くだけの、中くらいの立ち上がり。 */
const STAB_HIT = 0.35;
const PHRASE = LOOP_EIGHTHS / 2;

function throwsFor(cells: readonly Cell[], from: number, to: number): Throw[] {
  const hits: number[] = [];
  for (let e = Math.max(1, from); e < to; e++) if ((LOOP_ACCENTS[e] ?? 0) >= HIT) hits.push(e);
  if (hits.length === 0) {
    let best = Math.max(1, from);
    for (let e = best; e < to; e++)
      if ((LOOP_ACCENTS[e] ?? 0) > (LOOP_ACCENTS[best] ?? 0)) best = e;
    hits.push(best);
  }
  const lands = hits.slice(0, cells.length);
  const base = Math.floor(cells.length / lands.length);
  const extra = cells.length % lands.length;
  const out: Throw[] = [];
  let next = 0;
  lands.forEach((land, i) => {
    const n = base + (i < extra ? 1 : 0);
    const prev = i > 0 ? (lands[i - 1] ?? from) : from;
    const flight = Math.min(2, Math.max(1, land - prev));
    out.push({
      cells: cells.slice(next, next + n),
      scoop: land - flight - 0.5,
      launch: land - flight,
      land,
    });
    next += n;
  });
  return out;
}

export const LOOP_THROWS: readonly Throw[] = [
  ...throwsFor(cellsOfShell(2), 0, PHRASE),
  ...throwsFor(cellsOfShell(3), PHRASE, LOOP_EIGHTHS),
];
const LAND_SET = new Set(LOOP_THROWS.map((t) => t.land));
/** 地面を突く 8 分音符。着地点にしなかった中くらいの立ち上がり。 */
const LOOP_STABS = LOOP_ACCENTS.flatMap((a, e) =>
  e > 0 && a >= STAB_HIT && a < HIT && !LAND_SET.has(e) ? [e] : [],
);
/** カメラが 90° 切り返す 8 分音符。ループ頭と、後半でいちばん強い音。 */
const LOOP_CUTS = [
  0,
  LOOP_ACCENTS.reduce(
    (best, a, e) => (e >= PHRASE && a > (LOOP_ACCENTS[best] ?? 0) ? e : best),
    PHRASE,
  ),
];
/** 一掬いの中の着地のずれ（8 分音符）。 */
const STAGGER = 0.05;

export interface CellRow {
  count: number;
  filled: number;
  current: number;
  /** 直後に無音が来て、動きが止まるマス。 */
  cut: readonly boolean[];
  /** イントロの溜め。箱ではなく拍だけを数えるマス。 */
  charge: number;
}

export interface Scene {
  phase: 'pre' | 'intro' | 'build' | 'loop';
  beat: number;
  /** 世界の単位立方体が 27 の何乗 mL か。 */
  level: number;
  /** 今の山に何個あるか（数え直した 1 個を含む）。 */
  count: number;
  /** 完成させた段の数。キャプションはここを見る。 */
  completed: number;
  cubes: CubeState[];
  shovel: ShovelState;
  camera: CameraState;
  /** 床の格子の間隔ごとの濃さ。数え直しの間だけ 2 段が重なる。 */
  grids: { spacing: number; alpha: number }[];
  cells: CellRow;
  /** 完成の瞬間の閃き。0..1 */
  flash: number;
  /** 着地の揺れ（画素）。 */
  shake: number;
}

const AZ0 = Math.PI / 4 - 0.22;
const ELEVATION = 0.56;

/** 無音が始まる 8 分音符（イントロは拍）のマス。 */
function cutCells(
  silences: readonly (readonly [number, number])[],
  onset: number,
  step: number,
  count: number,
): boolean[] {
  const cut = new Array<boolean>(count).fill(false);
  for (const [s] of silences) {
    if (s <= onset) continue;
    const i = Math.floor((s - onset) / step);
    if (i >= 0 && i < count) cut[i] = true;
  }
  return cut;
}
const INTRO_CUT = cutCells(INTRO_SILENCES, INTRO_ONSET_SEC, BEAT_SEC, INTRO_BEATS);
const LOOP_CUT = cutCells(LOOP_SILENCES, LOOP_ONSET_SEC, EIGHTH_SEC, LOOP_EIGHTHS);

/** 局面と、その局面の中の位置（イントロは拍、ループは 8 分音符）。 */
function split(beat: number) {
  if (beat < 0) return { phase: 'pre' as const, cycle: -1, k: beat, e: 2 * beat };
  if (beat < BUILD_START) return { phase: 'intro' as const, cycle: -1, k: beat, e: 2 * beat };
  if (beat < INTRO_BEATS) return { phase: 'build' as const, cycle: -1, k: beat, e: 2 * beat };
  const after = beat - INTRO_BEATS;
  const cycle = Math.floor(after / BEATS_PER_LOOP);
  const k = after - cycle * BEATS_PER_LOOP;
  return { phase: 'loop' as const, cycle, k, e: 2 * k };
}

const snap = (t: number) => easeOutBack(clamp(t / 0.42));
const glide = (t: number) => {
  const u = clamp(t);
  return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
};
/** ループのカメラの回り込み（8 分音符の区間）。頭は数え直しと一緒に、後半は強い音で向き終わる。 */
const LOOP_TURNS: readonly (readonly [number, number])[] = [
  [0, 1.5],
  [Math.max(PHRASE, (LOOP_CUTS[1] ?? PHRASE) - 2), LOOP_CUTS[1] ?? PHRASE],
];

/** カメラの方位。溜めで 2 回、ループで 2 回、90° ずつ切り返す。 */
function azimuthAt(beat: number): number {
  const s = split(beat);
  const drift = 0.006 * Math.max(0, Math.min(beat, INTRO_BEATS));
  if (s.phase === 'pre' || s.phase === 'intro') return AZ0 + drift;
  if (s.phase === 'build') {
    return AZ0 + drift + (Math.PI / 2) * (snap(beat - 29) + snap(beat - 31));
  }
  const base = AZ0 + 0.006 * INTRO_BEATS + Math.PI + s.cycle * Math.PI;
  // ループでは切り返さず、回り込む（曲がり始めて、強い音で向き終わる）。
  // 跳ねる切り返しは、宙を飛ぶ箱が多いループでは画面ごと揺れて見える。
  const turns = LOOP_TURNS.reduce((sum, [a, b]) => sum + glide((s.e - a) / (b - a)), 0);
  return base + (Math.PI / 2) * turns - 0.004 * s.k;
}

/** 世界の何単位を枠に収めるか。数え直しの直後だけ 1 → 3 へ引く。 */
function zoomAt(beat: number): number {
  const s = split(beat);
  if (s.phase !== 'loop') return STACK;
  return 1 + 2 * easeOutCubic(clamp(s.k / 0.42));
}

/**
 * シャベルの手つき。時刻（8 分音符）t に対して、
 *   突く   stab の前後で刃を地面へ差し込み、跳ね返る
 *   掬う   scoop で刃を寝かせて持ち上げ、launch へ向けて後ろへ引く
 *   放る   launch で山の方へ振り抜き、刃をはね上げ、ばねで戻る
 * の重ね合わせ。返すのは、寝かせ角・振り向き・高さ・差し込み。
 */
interface Gesture {
  tilt: number;
  yaw: number;
  lift: number;
  plunge: number;
}

function stab(t: number, at: number, depth: number): Gesture {
  const u = t - at;
  if (u < -0.5 || u > 2) return { tilt: 0, yaw: 0, lift: 0, plunge: 0 };
  const into = u < 0 ? easeInCubic(clamp((u + 0.5) / 0.5)) : Math.max(0, spring(u * 0.18, 3.2, 9));
  return { tilt: 0.38 * into * depth, yaw: 0, lift: 0, plunge: 0.22 * into * depth };
}

function fling(t: number, scoop: number, launch: number): Gesture {
  if (t < scoop - 0.5 || t > launch + 3) return { tilt: 0, yaw: 0, lift: 0, plunge: 0 };
  if (t < scoop) {
    // 掬う直前、刃を差し込む。
    const a = easeInCubic(clamp((t - scoop + 0.5) / 0.5));
    return { tilt: 0.34 * a, yaw: 0, lift: 0, plunge: 0.18 * a };
  }
  if (t < launch) {
    // 刃を寝かせて持ち上げ、後ろへ引いて溜める。
    const a = easeOutCubic(clamp((t - scoop) / Math.max(0.5, launch - scoop)));
    return { tilt: 0.34 - 0.5 * a, yaw: -0.55 * a, lift: 0.35 * a, plunge: 0.18 * (1 - a) };
  }
  // 振り抜いて、刃をはね上げ、ばねで戻る。
  const u = t - launch;
  const swing = easeOutBack(clamp(u / 0.45), 1.6);
  const back = clamp((u - 0.6) / 2.2);
  const settle = 1 - easeOutCubic(back);
  return {
    tilt: (-0.16 - 0.5 * swing) * settle,
    yaw: (-0.55 + 0.95 * swing) * settle,
    lift: (0.35 + 0.25 * swing) * settle,
    plunge: 0,
  };
}

function sum(gs: Gesture[]): Gesture {
  return gs.reduce(
    (a, g) => ({
      tilt: a.tilt + g.tilt,
      yaw: a.yaw + g.yaw,
      lift: a.lift + g.lift,
      plunge: a.plunge + g.plunge,
    }),
    { tilt: 0, yaw: 0, lift: 0, plunge: 0 },
  );
}

function gestureAt(beat: number): Gesture {
  const s = split(beat);
  if (s.phase === 'pre') return { tilt: 0, yaw: 0, lift: 0, plunge: 0 };
  if (s.phase === 'intro') {
    // 1 拍に 1 個。裏の 8 分音符で掬い、拍で放る。
    const i = Math.floor(s.e / 2);
    return sum([fling(s.e, 2 * i + 1, 2 * i + 2), fling(s.e, 2 * i - 1, 2 * i)]);
  }
  if (s.phase === 'build') {
    // 溜め。突く間隔が拍から 8 分音符へ詰まり、深くなっていく。
    const u = beat - BUILD_START;
    const dense = u > 4;
    const at = dense ? Math.round(s.e) : 2 * Math.round(s.e / 2);
    return stab(s.e, at, 0.6 + 0.5 * clamp(u / 8));
  }
  return loopGesture(s.e);
}

/** ループの狙いの手つき。直近の一掬いと、突く動き。 */
function loopGesture(e: number): Gesture {
  let current: Throw | undefined;
  for (const th of LOOP_THROWS) if (e >= th.scoop - 0.5) current = th;
  return sum([
    ...LOOP_STABS.map((at) => stab(e, at, 0.7)),
    ...(current ? [fling(e, current.scoop, current.launch)] : []),
  ]);
}

/**
 * ループの手つき。一掬いごとの動きは詰まった所で途中で打ち切られるので、
 * ばねで追わせた表から読む（shovel-motion.ts）。イントロはそのまま。
 */
const LOOP_GESTURE = springTrack(
  (e) => {
    const g = loopGesture(e);
    return [g.tilt, g.yaw, g.lift, g.plunge];
  },
  0,
  LOOP_EIGHTHS,
  EIGHTH_SEC,
  { freq: 4.2, damping: 0.6, lead: 0.18 },
  LOOP_EIGHTHS,
);

function shovelGesture(beat: number): Gesture {
  const s = split(beat);
  if (s.phase !== 'loop') return gestureAt(beat);
  const [tilt = 0, yaw = 0, lift = 0, plunge = 0] = readTrack(LOOP_GESTURE, s.e);
  return { tilt, yaw, lift, plunge };
}

/**
 * 回る軸の位置（シャベルの単位、刃先から柄の方へ）。柄の真ん中より少し
 * 上、重心のあたり。柄は刃の上端（1.1）から握り（3.66）まで。刃先を軸に
 * 回すと、土に刺さった刃が動かず柄だけが振り回されて見える。
 */
const FULCRUM: Vec3 = [0, 2.45, 0];
/** 休んでいる姿勢で柄が後ろへ寝ている角度。 */
const REST_LEAN = 0.62;

function shovelAt(beat: number, zoom: number, az: number): ShovelState {
  const unit = zoom / STACK;
  const right: Vec3 = [Math.cos(az), 0, -Math.sin(az)];
  const toward: Vec3 = [Math.sin(az), 0, Math.cos(az)];
  const center: Vec3 = [zoom / 2, 0, zoom / 2];
  const home = add(center, add(scale(right, 3.25 * unit), scale(toward, 0.9 * unit)));
  const g = shovelGesture(beat);
  // 刃は山の方を向く。手つきの振り向きはその向きからの差。
  const aim = Math.atan2(center[0] - home[0], center[2] - home[2]);
  const breathe = 0.03 * Math.sin(Math.PI * beat);
  const rest = mul(rotY(aim), rotX(-REST_LEAN));
  const rot = mul(
    rotY(aim + g.yaw),
    mul(rotZ(0.04 * g.yaw), rotX(-(REST_LEAN + g.tilt + breathe))),
  );
  // 休んでいる姿勢での軸の位置を、持ち上げ・差し込みの分だけ上下させ、
  // そこを中心に回す。刃先の位置はそこから逆算する。
  const fulcrum = add(add(home, scale(apply(rest, FULCRUM), unit)), [
    0,
    (g.lift - g.plunge) * unit,
    0,
  ]);
  const tip = add(fulcrum, scale(apply(rot, FULCRUM), -unit));
  // 刃先は土に少しだけ入る。それより深くは沈めない。
  const floor = -0.15 * unit;
  return {
    pivot: tip[1] < floor ? [tip[0], floor, tip[2]] : tip,
    scale: unit,
    rot,
  };
}

const bladeLocal: Vec3 = [0, 0.66, 0.04];
const bladeNormal: Vec3 = [0, 0, 1];

/** 刃に載っている箱の中心と向き。 */
function onBlade(shovel: ShovelState, size: number): { center: Vec3; rot: Mat3 } {
  const p = add(shovel.pivot, scale(apply(shovel.rot, bladeLocal), shovel.scale));
  const n = apply(shovel.rot, bladeNormal);
  return { center: add(p, scale(n, size * 0.5 + 0.03 * shovel.scale)), rot: shovel.rot };
}

function tumble(seed: number, p: number): Mat3 {
  const turns = 1 + Math.floor(hash(seed) * 3);
  const a = (Math.PI / 2) * turns * (1 - p);
  return hash(seed + 7) < 0.5 ? rotX(a) : rotZ(a);
}

/**
 * 1 個の箱の今。時刻は局面の中の 8 分音符（e）。appear で刃の上に現れ、
 * launch で放たれ、land で着地する。size は刃の上での大きさ（一掬いの土の
 * 塊は小さく、飛びながら一辺 1 に育つ）。offset は通算拍への換算。
 */
interface Flight {
  appear: number;
  launch: number;
  land: number;
  size: number;
  /** 刃の上での位置のずれ（一掬いの中の塊どうし）。 */
  jitter: Vec3;
}

function flying(
  seed: number,
  e: number,
  toBeat: (e: number) => number,
  f: Flight,
  slot: Cell,
  composite: boolean,
): CubeState | null {
  if (e < f.appear) return null;
  const target: Vec3 = [slot[0] + 0.5, slot[1], slot[2] + 0.5];
  if (e < f.launch) {
    const b = toBeat(e);
    const sh = shovelAt(b, zoomAt(b), azimuthAt(b));
    const pop = Number.isFinite(f.appear)
      ? easeOutBack(clamp((e - f.appear) / Math.min(0.4, f.launch - f.appear)), 2.4)
      : 1;
    const blade = onBlade(sh, f.size);
    const center = add(blade.center, apply(blade.rot, f.jitter));
    return {
      base: add(center, apply(blade.rot, [0, -0.5 * f.size, 0])),
      size: Math.max(0.001, pop * f.size),
      rot: blade.rot,
      squash: [1, 1, 1],
      hot: 1,
      composite,
      airborne: 0,
      landed: false,
    };
  }
  if (e < f.land) {
    const p = (e - f.launch) / (f.land - f.launch);
    const b = toBeat(f.launch);
    const blade = onBlade(shovelAt(b, zoomAt(b), azimuthAt(b)), f.size);
    const from = add(blade.center, apply(blade.rot, f.jitter));
    const to: Vec3 = [target[0], target[1] + 0.5, target[2]];
    const dist = Math.hypot(to[0] - from[0], to[2] - from[2]);
    // 塊ごとに弧の高さを変えて、空中でばらける。大きさは着地の直前に
    // 一辺 1 へ膨らむ（飛んでいるあいだは土くれ、落ちて体積になる）。
    const apex = 1.1 + 0.3 * dist + 0.25 * slot[1] + (f.size < 1 ? 0.9 * hash(seed + 11) : 0);
    const c = vlerp(from, to, p);
    c[1] += 4 * apex * p * (1 - p);
    const size = f.size + (1 - f.size) * easeInCubic(clamp((p - 0.5) / 0.5));
    const stretch = 1 + 0.18 * Math.sin(Math.PI * p);
    return {
      base: [c[0], c[1] - 0.5 * size, c[2]],
      size,
      rot: tumble(seed, p),
      squash: [1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch)],
      hot: 1,
      composite,
      airborne: Math.max(0, c[1] - 0.5 - slot[1]) + 0.001,
      landed: false,
    };
  }
  const age = (e - f.land) * EIGHTH_SEC;
  const sq = 1 - 0.34 * Math.max(-0.4, spring(age, 4.2, 11));
  return {
    base: target,
    size: 1,
    rot: IDENTITY,
    squash: [1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq)],
    hot: clamp(1 - age / (BEAT_SEC * 0.6)),
    composite,
    airborne: 0,
    landed: true,
  };
}

/** 積み終わった 27 個が、8 分音符で斜めに波打つ。溜めの間だけ。 */
function buildWave(beat: number, cell: Cell): number {
  const u = beat - BUILD_START;
  if (u < 0.5) return 0;
  const amp = 0.32 * clamp((u - 0.5) / 5);
  const d = cell[0] + cell[1] + cell[2];
  const w = Math.max(0, Math.sin(2 * Math.PI * (2 * beat) - d * 0.85));
  return amp * w * w;
}

const NO_JITTER: Vec3 = [0, 0, 0];

export function sceneAt(beat: number): Scene {
  const s = split(beat);
  const az = azimuthAt(beat);
  const zoom = zoomAt(beat);
  const shovel = shovelAt(beat, zoom, az);
  const cubes: CubeState[] = [];
  let count = 0;
  let lastLand = -Infinity;
  let level = 0;
  let completed = 0;
  let flash = 0;
  let cells: CellRow;

  if (s.phase === 'loop') {
    level = s.cycle + 1;
    completed = s.cycle + 1;
    cubes.push({
      base: [0.5, 0, 0.5],
      size: 1,
      rot: IDENTITY,
      squash: [1, 1, 1],
      hot: 0,
      composite: true,
      airborne: 0,
      landed: true,
    });
    count = 1;
    const loopStart = beat - s.k;
    const toBeat = (e: number) => loopStart + e / 2;
    for (const [n, th] of LOOP_THROWS.entries()) {
      th.cells.forEach((slot, j) => {
        // イントロと同じ一辺 1 の箱を、一掬いの中で 1 個ずつ刃に載せて放る。
        // 前の箱が刃を離れた瞬間に次の箱が刃に現れるので、重ならない。
        const step = Math.min(0.2, (th.land - th.launch) / (th.cells.length + 1));
        const launch = th.launch + step * j;
        const f: Flight = {
          appear: j === 0 ? th.scoop : th.launch + step * (j - 1),
          launch,
          land: th.land + STAGGER * j,
          size: 1,
          jitter: NO_JITTER,
        };
        const c = flying(j * 31 + n * 7 + s.cycle * 977, s.e, toBeat, f, slot, true);
        if (c) cubes.push(c);
        if (s.e >= f.land) {
          count++;
          lastLand = Math.max(lastLand, f.land);
        }
      });
    }
    flash = 1 - clamp(s.e / 1.1);
    cells = {
      count: LOOP_EIGHTHS,
      filled: Math.floor(s.e),
      current: Math.min(LOOP_EIGHTHS - 1, Math.floor(s.e)),
      cut: LOOP_CUT,
      charge: 0,
    };
  } else {
    for (const [i, slot] of INTRO_SLOTS.entries()) {
      const f: Flight = {
        appear: i === 0 ? -Infinity : 2 * i - 1,
        launch: 2 * i,
        land: 2 * i + 2,
        size: 1,
        jitter: NO_JITTER,
      };
      const c = flying(i * 17 + 3, s.e, (e) => e / 2, f, slot, false);
      if (c) {
        if (s.phase === 'build') c.base = add(c.base, [0, buildWave(beat, slot), 0]);
        cubes.push(c);
      }
      if (s.e >= f.land) {
        count++;
        lastLand = f.land;
      }
    }
    completed = count >= INTRO_CUBES ? 1 : 0;
    if (s.phase === 'build') flash = 0.6 * (1 - clamp((beat - BUILD_START) / 0.5));
    cells = {
      count: INTRO_BEATS,
      filled: count,
      current: s.phase === 'pre' ? -1 : Math.floor(beat),
      cut: INTRO_CUT,
      charge: INTRO_BEATS - INTRO_CUBES,
    };
  }

  // 山全体も、最後の着地に合わせて少し沈む。
  const sinceLand = s.e - lastLand;
  const thump = Number.isFinite(lastLand) ? spring(sinceLand * EIGHTH_SEC, 3.4, 10) : 0;
  for (const c of cubes) {
    if (!c.landed) continue;
    c.base = [c.base[0], c.base[1] * (1 - 0.035 * thump), c.base[2]];
    c.squash = [c.squash[0], c.squash[1] * (1 - 0.035 * thump), c.squash[2]];
  }

  const unit = zoom / STACK;
  const right: Vec3 = [Math.cos(az), 0, -Math.sin(az)];
  const center: Vec3 = [zoom / 2, 0, zoom / 2];
  const target = add(center, add([0, zoom * 0.42, 0], scale(right, 1.0 * unit)));
  const grids =
    s.phase === 'loop' && zoom < STACK
      ? [
          { spacing: 1 / 3, alpha: 1 - (zoom - 1) / 2 },
          { spacing: 1, alpha: (zoom - 1) / 2 },
        ]
      : [{ spacing: 1, alpha: 1 }];

  return {
    phase: s.phase,
    beat,
    level,
    count,
    completed,
    cubes,
    shovel,
    camera: { azimuth: az, elevation: ELEVATION, target, span: zoom * 2.15 },
    grids,
    cells,
    flash,
    shake: Math.max(0, thump) * (s.phase === 'loop' ? 2.2 : 1.5),
  };
}
