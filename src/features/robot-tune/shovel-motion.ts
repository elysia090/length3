import { clamp } from '../../shared/pixel/math';

/**
 * 狙いの値の列を、ばね（質量・ばね・減衰）で追わせて表にする。
 *
 * ループのシャベルの手つきは、一掬いごとの動きを並べたもので、詰まった所
 * では次の一掬いが前の振り戻しを途中で打ち切る。そのまま描くと姿勢が
 * コマの間で飛ぶ。狙いが飛んでも、ばねで追えば姿勢は飛ばず、振り抜いた
 * あとは少し行き過ぎて戻る。
 *
 * 再生位置だけで決まる純関数にしておくために、前もって一定の刻みで解いて
 * 表にする。繰り返す動きは 1 周手前から解き始め、継ぎ目でも速さが
 * つながるようにする（呼ぶ側が period を渡す）。
 */

/** 表の刻み（時間の単位あたり）。 */
export const STEPS = 24;

export interface Track {
  from: number;
  to: number;
  channels: Float32Array[];
}

export interface SpringOptions {
  /** 固有振動数（Hz）と減衰比。 */
  freq: number;
  damping: number;
  /** ばねの遅れを見込んで、狙いを先に読む量（時間の単位）。 */
  lead: number;
}

/**
 * target(t) を [from, to) で追わせる。secPerUnit は時間の単位 1 つの秒。
 * period を渡すと、t を period で折り返して読み、1 周手前から解く。
 */
export function springTrack(
  target: (t: number) => readonly number[],
  from: number,
  to: number,
  secPerUnit: number,
  options: SpringOptions,
  period?: number,
): Track {
  const width = target(from).length;
  const n = Math.ceil((to - from) * STEPS) + 1;
  const channels = Array.from({ length: width }, () => new Float32Array(n));
  const w = 2 * Math.PI * options.freq;
  const sub = 4;
  const dt = secPerUnit / STEPS / sub;
  const read = (t: number) =>
    target(period ? ((((t - from) % period) + period) % period) + from : t);
  const x = [...read(from - (period ?? 0) + options.lead)];
  const v = new Array<number>(width).fill(0);
  const start = period ? -Math.ceil(period * STEPS) : 0;
  for (let i = start; i < n; i++) {
    const goal = read(from + i / STEPS + options.lead);
    for (let s = 0; s < sub; s++) {
      for (let c = 0; c < width; c++) {
        const a = w * w * ((goal[c] ?? 0) - (x[c] ?? 0)) - 2 * options.damping * w * (v[c] ?? 0);
        v[c] = (v[c] ?? 0) + a * dt;
        x[c] = (x[c] ?? 0) + (v[c] ?? 0) * dt;
      }
    }
    if (i >= 0) for (let c = 0; c < width; c++) (channels[c] as Float32Array)[i] = x[c] ?? 0;
  }
  return { from, to, channels };
}

/** 表を時刻 t で読む（線形補間）。範囲の外は端の値。 */
export function readTrack(track: Track, t: number): number[] {
  const len = track.channels[0]?.length ?? 0;
  const x = (clamp(t, track.from, track.to) - track.from) * STEPS;
  const i = Math.max(0, Math.min(len - 2, Math.floor(x)));
  const f = x - i;
  return track.channels.map((a) => (a[i] ?? 0) * (1 - f) + (a[i + 1] ?? 0) * f);
}
