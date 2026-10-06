/**
 * data/ の 2 本の WAV から、Robot Tune ステージが使う 2 つを作る。
 *
 *   src/features/robot-tune/envelope.ts   10 ms ごとの音量包絡と、無音区間
 *   public/audio/robot-tune.mp3           イントロ + ループ + ループ の 1 本
 *
 * ループを 2 回つなげて焼くのは、MP3 の頭と尻に付くエンコーダの詰め物を
 * ループ点に掛けないため。ブラウザ側は 1 本目のループの頭から尻までを
 * AudioBufferSourceNode の loopStart / loopEnd で回すので、ループ点は
 * どちらもバッファの内側にあり、継ぎ目の両側に本物の音がある。
 *
 *   node ./scripts/robot-tune/bake.ts
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const INTRO = resolve(root, 'data/robot_tune_intro.wav');
const LOOP = resolve(root, 'data/robot_tune_loop.wav');
const OUT_TS = resolve(root, 'src/features/robot-tune/envelope.ts');
const OUT_MP3 = resolve(root, 'public/audio/robot-tune.mp3');

/** 包絡の刻み。60 fps の 1 フレームより細かく、文字数は 1 曲で数 KB に収まる。 */
const HOP_SEC = 0.01;
/** 5 ms の RMS がこれを下回り、それが 40 ms 以上続く所を無音とみなす。 */
const SILENCE_RMS = 0.003;
const SILENCE_MIN_SEC = 0.04;
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

interface Wav {
  sampleRate: number;
  frames: number;
  mono: Float32Array;
}

function readWav(path: string): Wav {
  const buf = readFileSync(path);
  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  while (offset < buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === 'data') {
      const bytes = bits / 8;
      const frames = Math.floor(size / (bytes * channels));
      const mono = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
          const p = body + (i * channels + c) * bytes;
          if (bits === 24) sum += buf.readIntLE(p, 3) / 0x800000;
          else if (bits === 16) sum += buf.readInt16LE(p) / 0x8000;
          else throw new Error(`unsupported bit depth ${bits}`);
        }
        mono[i] = sum / channels;
      }
      return { sampleRate, frames, mono };
    }
    offset = body + size + (size & 1);
  }
  throw new Error(`no data chunk in ${path}`);
}

/** RBJ の 2 次フィルタ。低域はキック、高域はハイハットとクラップを拾う。 */
function biquad(x: Float32Array, sr: number, kind: 'low' | 'high', freq: number): Float32Array {
  const w = (2 * Math.PI * freq) / sr;
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w);
  const b1 = kind === 'low' ? 1 - cos : -(1 + cos);
  const b0 = kind === 'low' ? b1 / 2 : -b1 / 2;
  const a0 = 1 + alpha;
  const c = [b0 / a0, b1 / a0, b0 / a0, (-2 * cos) / a0, (1 - alpha) / a0];
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = c[0]! * x[i]! + c[1]! * x1 + c[2]! * x2 - c[3]! * y1 - c[4]! * y2;
    x2 = x1;
    x1 = x[i]!;
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

function rmsFrames(x: Float32Array, sr: number, hopSec: number): number[] {
  const hop = Math.round(sr * hopSec);
  const out: number[] = [];
  for (let s = 0; s < x.length; s += hop) {
    let sum = 0;
    const e = Math.min(x.length, s + hop);
    for (let i = s; i < e; i++) sum += x[i]! * x[i]!;
    out.push(Math.sqrt(sum / Math.max(1, e - s)));
  }
  return out;
}

function silences(w: Wav): [number, number][] {
  const step = 0.005;
  const r = rmsFrames(w.mono, w.sampleRate, step);
  const out: [number, number][] = [];
  let i = 0;
  while (i < r.length) {
    if (r[i]! < SILENCE_RMS) {
      let j = i;
      while (j < r.length && r[j]! < SILENCE_RMS) j++;
      if ((j - i) * step >= SILENCE_MIN_SEC) {
        out.push([round3(i * step), round3(Math.min(j * step, w.frames / w.sampleRate))]);
      }
      i = j;
    } else i++;
  }
  return out;
}

function firstOnset(w: Wav): number {
  for (let i = 0; i < w.frames; i++) if (Math.abs(w.mono[i]!) > 0.01) return i / w.sampleRate;
  return 0;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

const intro = readWav(INTRO);
const loop = readWav(LOOP);
if (intro.sampleRate !== loop.sampleRate) throw new Error('sample rates differ');
const sr = intro.sampleRate;

interface Bands {
  level: number[];
  low: number[];
  high: number[];
}
function bands(w: Wav): Bands {
  return {
    level: rmsFrames(w.mono, sr, HOP_SEC),
    low: rmsFrames(biquad(w.mono, sr, 'low', 140), sr, HOP_SEC),
    high: rmsFrames(biquad(w.mono, sr, 'high', 5000), sr, HOP_SEC),
  };
}
const bi = bands(intro);
const bl = bands(loop);

/** 両ファイルを通した最大値で割り、平方根で持ち上げてから 64 段に落とす。 */
function encode(a: number[], b: number[]): [string, string] {
  const max = Math.max(...a, ...b) || 1;
  const q = (xs: number[]) =>
    xs.map((v) => ALPHABET[Math.min(63, Math.round(Math.sqrt(v / max) * 63))]).join('');
  return [q(a), q(b)];
}
const [levelI, levelL] = encode(bi.level, bl.level);
const [lowI, lowL] = encode(bi.low, bl.low);
const [highI, highL] = encode(bi.high, bl.high);

const introSec = intro.frames / sr;
const loopSec = loop.frames / sr;

const ts = `// Generated by scripts/robot-tune/bake.ts from data/robot_tune_*.wav. Do not edit.

export const ENVELOPE_HOP_SEC = ${HOP_SEC};
export const ENVELOPE_ALPHABET = '${ALPHABET}';

/** ファイル長（秒）。サンプル数 / サンプルレートそのまま。 */
export const INTRO_SEC = ${introSec};
export const LOOP_SEC = ${loopSec};

/** 最初に音が立つ位置（秒）。イントロの 0 拍目と、ループの 0 拍目。 */
export const INTRO_ONSET_SEC = ${round3(firstOnset(intro))};
export const LOOP_ONSET_SEC = ${round3(firstOnset(loop))};

/** 音が完全に消えている区間（秒、ファイル内の位置）。 */
export const INTRO_SILENCES: readonly (readonly [number, number])[] = ${JSON.stringify(silences(intro))};
export const LOOP_SILENCES: readonly (readonly [number, number])[] = ${JSON.stringify(silences(loop))};

export const INTRO_ENVELOPE = {
  level: '${levelI}',
  low: '${lowI}',
  high: '${highI}',
} as const;

export const LOOP_ENVELOPE = {
  level: '${levelL}',
  low: '${lowL}',
  high: '${highL}',
} as const;
`;
writeFileSync(OUT_TS, ts);
console.log(`wrote ${OUT_TS}`);

execFileSync(
  'ffmpeg',
  [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    INTRO,
    '-i',
    LOOP,
    '-i',
    LOOP,
    '-filter_complex',
    '[0:a][1:a][2:a]concat=n=3:v=0:a=1',
    '-c:a',
    'libmp3lame',
    '-q:a',
    '2',
    OUT_MP3,
  ],
  { stdio: 'inherit' },
);
console.log(`wrote ${OUT_MP3}`);
