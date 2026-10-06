import {
  ENVELOPE_ALPHABET,
  ENVELOPE_HOP_SEC,
  INTRO_ENVELOPE,
  INTRO_ONSET_SEC,
  INTRO_SEC,
  INTRO_SILENCES,
  LOOP_ENVELOPE,
  LOOP_ONSET_SEC,
  LOOP_SEC,
  LOOP_SILENCES,
} from './envelope';

/**
 * 時間の数え方。
 *
 * ループはちょうど 13 拍ある（4.697875 s / 13 = 0.361375 s、166.03 BPM）。
 * 拍の長さはここから取る。テンポ表記の 166 から割ると 1 周で 1 ms ずれる。
 *
 * イントロの 0 拍目は最初に音が立つ所（0.45 s）。33 拍目がループの 0 拍目に
 * 重なる。ループ 1 周目の 0 拍目は、イントロ末尾から LOOP_ONSET_SEC だけ先。
 */
export const BEATS_PER_LOOP = 13;
export const INTRO_BEATS = 33;
export const BEAT_SEC = LOOP_SEC / BEATS_PER_LOOP;
export const BPM = 60 / BEAT_SEC;

/** 再生位置（イントロ頭からの通算秒）を、どちらのファイルの何秒目かへ。 */
export interface Located {
  loop: boolean;
  /** ループの何周目か。イントロ中は -1。 */
  iteration: number;
  /** そのファイルの頭からの秒。 */
  local: number;
}

export function locate(pos: number): Located {
  if (pos < INTRO_SEC) return { loop: false, iteration: -1, local: Math.max(0, pos) };
  const after = pos - INTRO_SEC;
  const iteration = Math.floor(after / LOOP_SEC);
  return { loop: true, iteration, local: after - iteration * LOOP_SEC };
}

/**
 * 通算秒 → 通算拍。ループ中は周ごとに拍を数え直す。秒から一気に割ると
 * イントロとループの頭出しの丸め誤差が周回ごとに積もる。
 */
export function beatAt(pos: number): number {
  const at = locate(pos);
  if (!at.loop) return (pos - INTRO_ONSET_SEC) / BEAT_SEC;
  return INTRO_BEATS + at.iteration * BEATS_PER_LOOP + (at.local - LOOP_ONSET_SEC) / BEAT_SEC;
}

const EPS = 0.002;

function silenceIn(list: readonly (readonly [number, number])[], local: number) {
  for (const s of list) if (local >= s[0] && local < s[1]) return s;
  return undefined;
}

/**
 * 無音の中にいるなら、その無音が始まった通算秒を返す。
 *
 * 絵はこの時刻で止める。無音の区間をまたいでも動きの時刻表は進めておき、
 * 音が戻った瞬間に今の姿勢へ飛ばす。止まって、飛ぶ。ロボットの踊り方になる。
 *
 * ループ頭の無音はファイル境界をまたぐ。1 周目はイントロ末尾の無音と
 * つながっているので、そちらの始まりまで遡る。
 */
export function silenceStart(pos: number): number | null {
  const at = locate(pos);
  if (!at.loop) {
    const s = silenceIn(INTRO_SILENCES, at.local);
    return s ? s[0] : null;
  }
  const s = silenceIn(LOOP_SILENCES, at.local);
  if (!s) return null;
  const fileStart = INTRO_SEC + at.iteration * LOOP_SEC;
  if (s[0] > EPS) return fileStart + s[0];
  const tail =
    at.iteration === 0
      ? INTRO_SILENCES.find((t) => t[1] >= INTRO_SEC - EPS)
      : LOOP_SILENCES.find((t) => t[1] >= LOOP_SEC - EPS);
  if (!tail) return fileStart;
  return fileStart - (at.iteration === 0 ? INTRO_SEC : LOOP_SEC) + tail[0];
}

export interface Envelope {
  /** 全帯域の RMS。0..1 */
  level: number;
  /** 140 Hz 以下。キック。 */
  low: number;
  /** 5 kHz 以上。ハイハットとクラップ。 */
  high: number;
}

const decoded = new Map<string, Float32Array>();
function decode(s: string): Float32Array {
  let out = decoded.get(s);
  if (!out) {
    out = new Float32Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = ENVELOPE_ALPHABET.indexOf(s.charAt(i)) / 63;
    decoded.set(s, out);
  }
  return out;
}

function sample(s: string, local: number): number {
  const a = decode(s);
  const x = local / ENVELOPE_HOP_SEC;
  const i = Math.floor(x);
  if (i < 0) return a[0] ?? 0;
  if (i >= a.length - 1) return a[a.length - 1] ?? 0;
  const f = x - i;
  return (a[i] ?? 0) * (1 - f) + (a[i + 1] ?? 0) * f;
}

export function envelopeAt(pos: number): Envelope {
  const at = locate(pos);
  const env = at.loop ? LOOP_ENVELOPE : INTRO_ENVELOPE;
  return {
    level: sample(env.level, at.local),
    low: sample(env.low, at.local),
    high: sample(env.high, at.local),
  };
}

/** 再生位置のうち、ループで回す区間（バッファ内の秒）。 */
export const LOOP_START_SEC = INTRO_SEC;
export const LOOP_END_SEC = INTRO_SEC + LOOP_SEC;
export { INTRO_ONSET_SEC, INTRO_SEC, LOOP_SEC };
