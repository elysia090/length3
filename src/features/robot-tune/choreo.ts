import {
  add,
  apply,
  clamp,
  easeOutBack,
  easeOutCubic,
  fract,
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
import { INTRO_ONSET_SEC, INTRO_SILENCES, LOOP_ONSET_SEC, LOOP_SILENCES } from './envelope';
import { BEAT_SEC, BEATS_PER_LOOP, INTRO_BEATS } from './timeline';

export type { CameraState, CubeState, ShovelState };

/**
 * 振付。通算拍 B を受け取って、その瞬間の舞台を返す純関数。
 *
 * イントロ（B = 0..27）は 1 拍に 1 個ずつ、1 → 2³ → 3³ と殻を足して 27 個積む。
 * 残りの 6 拍は溜め。33 拍目でループに入ると、積み上がった 3³ を 1 個の
 * 立方体として数え直し、カメラを 3 倍引く。
 *
 * ループは 13 拍。半拍に 1 個ずつ投げると 26 個で、さっきの 1 個と足して
 * 27 = 3³ になる。最後の 1 個が着地するのは次の周の頭、つまりループが
 * 巻き戻る瞬間で、そこでまた数え直す。13 拍という半端な長さは、
 * 3³ − 1 を 2 で割った数だった。
 *
 * 世界の長さの単位は「いま積んでいる立方体 1 個の一辺」。段が上がるたびに
 * 単位ごと 3 倍になるので、座標は毎周 [0, 3]³ に収まる。
 */

export const STACK = 3;
const INTRO_CUBES = 27;
const LOOP_CUBES = 26;
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
/** 角の 1 個（前の段の完成品）を除いた 26 マス。 */
export const LOOP_SLOTS: readonly Cell[] = cellsOfShell(3)
  .concat(cellsOfShell(2))
  .filter((c) => c[0] + c[1] + c[2] > 0)
  .sort((a, b) => a[1] - b[1] || a[2] - b[2] || (a[2] % 2 === 0 ? a[0] - b[0] : b[0] - a[0]));

export interface CellRow {
  count: number;
  filled: number;
  current: number;
  /** 投げた箱が宙で止まる（直後に無音が来る）マス。 */
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

/** 1 拍目を打つ前、シャベルが立って最初の 1 個を載せている。 */
const AZ0 = Math.PI / 4 - 0.22;
const ELEVATION = 0.56;

function cutCells(
  silences: readonly (readonly [number, number])[],
  onset: number,
  perBeat: number,
  count: number,
): boolean[] {
  const cut = new Array<boolean>(count).fill(false);
  for (const [s] of silences) {
    if (s <= onset) continue;
    const step = Math.ceil(((s - onset) / BEAT_SEC) * perBeat - 1e-3);
    const i = (step - 1 + count) % count;
    cut[i] = true;
  }
  return cut;
}
const INTRO_CUT = cutCells(INTRO_SILENCES, INTRO_ONSET_SEC, 1, INTRO_BEATS);
const LOOP_CUT = cutCells(
  LOOP_SILENCES.filter(([s]) => s > LOOP_ONSET_SEC),
  LOOP_ONSET_SEC,
  2,
  LOOP_CUBES,
);
// ループ頭の無音は前の周の尻尾。最後に投げる 1 個がそこで止まる。
LOOP_CUT[LOOP_CUBES - 1] = true;

const bladeLocal: Vec3 = [0, 0.66, 0.04];
const bladeNormal: Vec3 = [0, 0, 1];

interface Timing {
  appear: number;
  launch: number;
  land: number;
}
const introTiming = (i: number): Timing => ({
  appear: i === 0 ? -Infinity : i - 0.5,
  launch: i,
  land: i + 1,
});
const loopTiming = (i: number): Timing => ({
  appear: i === 0 ? 0 : 0.5 * i - 0.25,
  launch: 0.5 * i,
  land: 0.5 * i + 0.5,
});

/** 局面ごとの「拍の中での位置」。ループは周ごとに 0 から数え直す。 */
function split(beat: number) {
  if (beat < 0) return { phase: 'pre' as const, cycle: -1, k: beat };
  if (beat < BUILD_START) return { phase: 'intro' as const, cycle: -1, k: beat };
  if (beat < INTRO_BEATS) return { phase: 'build' as const, cycle: -1, k: beat };
  const after = beat - INTRO_BEATS;
  const cycle = Math.floor(after / BEATS_PER_LOOP);
  return { phase: 'loop' as const, cycle, k: after - cycle * BEATS_PER_LOOP };
}

/** カメラの方位。溜めで 2 回、ループで 0 拍目と 8 拍目に 90° ずつ切り返す。 */
function azimuthAt(beat: number): number {
  const s = split(beat);
  const snap = (t: number) => easeOutBack(clamp(t / 0.42));
  const drift = 0.006 * Math.max(0, Math.min(beat, INTRO_BEATS));
  if (s.phase === 'pre' || s.phase === 'intro') return AZ0 + drift;
  if (s.phase === 'build') return AZ0 + drift + (Math.PI / 2) * (snap(beat - 29) + snap(beat - 31));
  const base = AZ0 + 0.006 * INTRO_BEATS + Math.PI + s.cycle * Math.PI;
  return base + (Math.PI / 2) * (snap(s.k) + snap(s.k - 8)) - 0.004 * s.k;
}

/** 世界の何単位を枠に収めるか。数え直しの直後だけ 1 → 3 へ引く。 */
function zoomAt(beat: number): number {
  const s = split(beat);
  if (s.phase !== 'loop') return STACK;
  return 1 + 2 * easeOutCubic(clamp(s.k / 0.42));
}

function shovelAt(beat: number, zoom: number, az: number): ShovelState {
  const s = split(beat);
  const unit = zoom / STACK;
  const right: Vec3 = [Math.cos(az), 0, -Math.sin(az)];
  const toward: Vec3 = [Math.sin(az), 0, Math.cos(az)];
  const center: Vec3 = [zoom / 2, 0, zoom / 2];
  const pivot = add(center, add(scale(right, 3.25 * unit), scale(toward, 0.9 * unit)));

  // 回り方。イントロは拍ごとに半回転をがくっと決め、ループは半拍ごと。
  // 溜めでは止まらずに加速していく。
  let spin: number;
  let launchAge: number;
  let tilt = 0.62;
  if (s.phase === 'pre') {
    spin = 0;
    launchAge = 99;
  } else if (s.phase === 'intro') {
    spin = Math.PI * (Math.floor(beat) + easeOutBack(clamp(fract(beat) / 0.38)));
    launchAge = fract(beat);
  } else if (s.phase === 'build') {
    const u = beat - BUILD_START;
    spin = Math.PI * (BUILD_START + u + 0.3 * u * u);
    launchAge = 99;
    tilt += 0.22 * clamp(u / 5.5);
  } else {
    const h = 2 * s.k;
    spin = Math.PI * (Math.floor(h) + easeOutBack(clamp(fract(h) / 0.4)));
    launchAge = fract(h) / 2;
  }
  const recoil = launchAge < 2 ? spring(launchAge * BEAT_SEC, 2.6, 9) : 0;
  tilt += 0.07 * Math.sin(Math.PI * beat) + 0.14 * Math.max(0, recoil);
  const hop = 0.22 * Math.max(0, Math.sin(Math.PI * clamp(launchAge / 0.32)));
  const wobble = 0.05 * Math.sin(2 * Math.PI * beat * 0.5 + 1.3);
  return {
    pivot: add(pivot, [0, hop * unit, 0]),
    scale: unit,
    rot: mul(rotY(spin + az + Math.PI), mul(rotZ(wobble), rotX(-tilt))),
  };
}

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

function flying(
  seed: number,
  beat: number,
  offset: number,
  t: Timing,
  slot: Cell,
  composite: boolean,
): CubeState | null {
  if (beat < t.appear) return null;
  const target: Vec3 = [slot[0] + 0.5, slot[1], slot[2] + 0.5];
  if (beat < t.launch) {
    const g = beat + offset;
    const sh = shovelAt(g, zoomAt(g), azimuthAt(g));
    const pop = Number.isFinite(t.appear)
      ? easeOutBack(clamp((beat - t.appear) / Math.min(0.2, t.launch - t.appear)), 2.4)
      : 1;
    const b = onBlade(sh, 1);
    return {
      base: add(b.center, apply(b.rot, [0, -0.5, 0])),
      size: Math.max(0.001, pop),
      rot: b.rot,
      squash: [1, 1, 1],
      hot: 1,
      composite,
      airborne: 0,
      landed: false,
    };
  }
  if (beat < t.land) {
    const p = (beat - t.launch) / (t.land - t.launch);
    const g = t.launch + offset;
    const from = onBlade(shovelAt(g, zoomAt(g), azimuthAt(g)), 1).center;
    const to: Vec3 = [target[0], target[1] + 0.5, target[2]];
    const dist = Math.hypot(to[0] - from[0], to[2] - from[2]);
    const apex = 1.1 + 0.3 * dist;
    const c = vlerp(from, to, p);
    c[1] += 4 * apex * p * (1 - p);
    const stretch = 1 + 0.18 * Math.sin(Math.PI * p);
    return {
      base: [c[0], c[1] - 0.5, c[2]],
      size: 1,
      rot: tumble(seed, p),
      squash: [1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch)],
      hot: 1,
      composite,
      airborne: Math.max(0, c[1] - 0.5 - slot[1]) + 0.001,
      landed: false,
    };
  }
  const age = (beat - t.land) * BEAT_SEC;
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
    for (const [i, slot] of LOOP_SLOTS.entries()) {
      const t = loopTiming(i);
      const c = flying(i * 31 + s.cycle * 977, s.k, beat - s.k, t, slot, true);
      if (c) cubes.push(c);
      if (s.k >= t.land) {
        count++;
        lastLand = t.land;
      }
    }
    flash = 1 - clamp(s.k / 0.55);
    cells = {
      count: LOOP_CUBES,
      filled: count - 1,
      current: Math.min(LOOP_CUBES - 1, Math.floor(2 * s.k)),
      cut: LOOP_CUT,
      charge: 0,
    };
  } else {
    for (const [i, slot] of INTRO_SLOTS.entries()) {
      const t = introTiming(i);
      const c = flying(i * 17 + 3, beat, 0, t, slot, false);
      if (c) {
        if (s.phase === 'build') c.base = add(c.base, [0, buildWave(beat, slot), 0]);
        cubes.push(c);
      }
      if (beat >= t.land) {
        count++;
        lastLand = t.land;
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
  const sinceLand = (s.phase === 'loop' ? s.k : beat) - lastLand;
  const thump = Number.isFinite(lastLand) ? spring(sinceLand * BEAT_SEC, 3.4, 10) : 0;
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
    shake: Math.max(0, thump) * 1.5,
  };
}
