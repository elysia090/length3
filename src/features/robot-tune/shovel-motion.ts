import { clamp } from '../../shared/pixel/math';

/**
 * シャベルの身のこなし。握る手を支点に、体の重心の移りで考える。
 *
 * 姿勢は四つの量で持つ（どれも休んでいる姿勢からの差、長さはシャベルの単位）:
 *   fwd    手（体の重心）が山の方へ出た量
 *   up     手が上がった量
 *   pitch  柄が起きた量（ラジアン、正で柄が立ち、負で後ろへ寝る）
 *   yaw    手を通る縦の軸まわりの振り向き（ラジアン）
 *
 * 振付は、掘る手順ごとの「狙う姿勢」を 8 分音符の時刻に並べた鍵（Key）で
 * 書く。差し込む → こじる → 持ち上げて引く → 振り抜く → 戻る。実際の
 * 姿勢は、その狙いをばね（質量・ばね・減衰）で追いかけた結果で、狙いが
 * 急に変わっても姿勢は飛ばず、振り抜いたあとは少し行き過ぎて戻る。
 *
 * 再生位置だけで決まる純関数にしておくために、ばねは前もって一定の刻みで
 * 解いて表にしておく。
 */

export interface Pose {
  fwd: number;
  up: number;
  pitch: number;
  yaw: number;
}

export interface Key {
  /** 8 分音符の時刻。 */
  at: number;
  pose: Pose;
}

export const REST: Pose = { fwd: 0, up: 0, pitch: 0, yaw: 0 };
const PLUNGE: Pose = { fwd: 0.16, up: -0.22, pitch: 0.2, yaw: 0 };
const PRY: Pose = { fwd: 0.02, up: -0.06, pitch: -0.3, yaw: 0 };
const WIND: Pose = { fwd: -0.14, up: 0.24, pitch: -0.26, yaw: -0.36 };
const RELEASE: Pose = { fwd: 0.22, up: 0.3, pitch: 0.46, yaw: 0.3 };
const STAB_DOWN: Pose = { fwd: 0.12, up: -0.18, pitch: 0.2, yaw: 0 };

/** 掬って放る一連の鍵。scoop で刃が土に入り、launch で土が離れる。 */
export function throwKeys(scoop: number, launch: number): Key[] {
  const hold = Math.max(0.5, launch - scoop);
  return [
    { at: scoop - 0.5, pose: PLUNGE },
    { at: scoop, pose: PRY },
    { at: scoop + hold * 0.6, pose: WIND },
    { at: launch, pose: RELEASE },
    { at: launch + 1.2, pose: REST },
  ];
}

/** 地面を突くだけの鍵。 */
export function stabKeys(at: number, depth: number): Key[] {
  const down: Pose = {
    fwd: STAB_DOWN.fwd * depth,
    up: STAB_DOWN.up * depth,
    pitch: STAB_DOWN.pitch * depth,
    yaw: 0,
  };
  return [
    { at: at - 0.35, pose: down },
    { at: at + 0.6, pose: REST },
  ];
}

/**
 * 鍵の列を一本にまとめる。後の動作が始まったら、前の動作の残りの鍵は
 * 捨てる（姿勢のつながりはばねが受け持つ）。
 */
export function merge(groups: Key[][]): Key[] {
  const sorted = [...groups].sort((a, b) => (a[0]?.at ?? 0) - (b[0]?.at ?? 0));
  const out: Key[] = [];
  sorted.forEach((g, i) => {
    const nextStart = sorted[i + 1]?.[0]?.at ?? Infinity;
    for (const k of g) if (k.at < nextStart) out.push(k);
  });
  return out;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** 鍵の列の、時刻 t での狙い。鍵と鍵のあいだは滑らかにつなぐ。 */
export function targetAt(keys: readonly Key[], t: number): Pose {
  if (keys.length === 0) return REST;
  let i = 0;
  while (i < keys.length && (keys[i]?.at ?? 0) <= t) i++;
  const b = keys[i];
  const a = keys[i - 1];
  if (!a) return REST;
  if (!b) return a.pose;
  // 最初の鍵の手前は休みから入る。
  const u = smooth(clamp((t - a.at) / Math.max(1e-6, b.at - a.at)));
  return {
    fwd: a.pose.fwd + (b.pose.fwd - a.pose.fwd) * u,
    up: a.pose.up + (b.pose.up - a.pose.up) * u,
    pitch: a.pose.pitch + (b.pose.pitch - a.pose.pitch) * u,
    yaw: a.pose.yaw + (b.pose.yaw - a.pose.yaw) * u,
  };
}

/** 表の刻み（8 分音符あたり）。 */
export const STEPS = 24;
/** ばねの固有振動数（Hz）と減衰比。少し行き過ぎて戻る。 */
const FREQ = 3.6;
const DAMPING = 0.55;
/** ばねの遅れを見込んで、狙いを先に読む量（8 分音符）。 */
const LEAD = 0.22;

export interface Track {
  from: number;
  to: number;
  fwd: Float32Array;
  up: Float32Array;
  pitch: Float32Array;
  yaw: Float32Array;
}

/**
 * 鍵の列を [from, to) の範囲でばねに追わせて表にする。secPerEighth は
 * 8 分音符の秒。繰り返す動き（ループ）は、鍵を前後に並べて 1 周ぶん手前
 * から解き始め、継ぎ目でも速度がつながるようにする（呼ぶ側で行う）。
 */
export function solve(keys: readonly Key[], from: number, to: number, secPerEighth: number): Track {
  const n = Math.ceil((to - from) * STEPS) + 1;
  const track: Track = {
    from,
    to,
    fwd: new Float32Array(n),
    up: new Float32Array(n),
    pitch: new Float32Array(n),
    yaw: new Float32Array(n),
  };
  const w = 2 * Math.PI * FREQ;
  const sub = 4;
  const dt = secPerEighth / STEPS / sub;
  const x = [0, 0, 0, 0];
  const v = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const g = targetAt(keys, from + i / STEPS + LEAD);
    const goal = [g.fwd, g.up, g.pitch, g.yaw];
    for (let s = 0; s < sub; s++) {
      for (let c = 0; c < 4; c++) {
        const acc = w * w * ((goal[c] ?? 0) - (x[c] ?? 0)) - 2 * DAMPING * w * (v[c] ?? 0);
        v[c] = (v[c] ?? 0) + acc * dt;
        x[c] = (x[c] ?? 0) + (v[c] ?? 0) * dt;
      }
    }
    track.fwd[i] = x[0] ?? 0;
    track.up[i] = x[1] ?? 0;
    track.pitch[i] = x[2] ?? 0;
    track.yaw[i] = x[3] ?? 0;
  }
  return track;
}

/** 鍵を period ずつずらして前後に並べる（繰り返す動きの継ぎ目のため）。 */
export function tile(keys: readonly Key[], period: number): Key[] {
  return [-period, 0, period].flatMap((d) => keys.map((k) => ({ at: k.at + d, pose: k.pose })));
}

/** 表を時刻 t で読む（線形補間）。範囲の外は端の値。 */
export function poseAt(track: Track, t: number): Pose {
  const x = (clamp(t, track.from, track.to) - track.from) * STEPS;
  const i = Math.min(track.fwd.length - 2, Math.floor(x));
  const f = x - i;
  const read = (a: Float32Array) => (a[i] ?? 0) * (1 - f) + (a[i + 1] ?? 0) * f;
  return {
    fwd: read(track.fwd),
    up: read(track.up),
    pitch: read(track.pitch),
    yaw: read(track.yaw),
  };
}
