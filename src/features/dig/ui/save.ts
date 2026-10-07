import type { Mind } from '../core/model';
import type { Save } from '../sim/game';

/**
 * 端末に残すもの。挑戦の途中はコマンドの列（版と一緒に）。指し直せば同じ夜に
 * なる。挑戦をまたいで残るもの（解いた深さ・持ち越す記憶・街が覚えている人物像・
 * 見つけた隠し効果）も。読み書きできない環境では、何も残さずに遊べる。
 */

export interface Profile {
  depth: number;
  runs: number;
  wins: number;
  best: number;
  carry: string | null;
  /** 街が覚えている、人物ごとのあなた像。 */
  remembered: Record<string, Partial<Mind>>;
  /** 見つけた隠し効果と、読み終えた主役の物語。 */
  found: string[];
  legends: string[];
  muted: boolean;
}

const RUN = 'dig:run:v2';
const PROFILE = 'dig:profile:v2';

const blank = (): Profile => ({
  depth: 0,
  runs: 0,
  wins: 0,
  best: 0,
  carry: null,
  remembered: {},
  found: [],
  legends: [],
  muted: false,
});

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, v: unknown): void {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // 残せなくても遊べる。
  }
}

export const loadProfile = (): Profile => ({
  ...blank(),
  ...(read<Partial<Profile>>(PROFILE) ?? {}),
});
export const saveProfile = (p: Profile): void => write(PROFILE, p);
export const loadRun = (): Save | null => read<Save>(RUN);
export const saveRun = (s: Save | null): void => write(RUN, s);
