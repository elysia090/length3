import type { Run } from '../engine/run';
import type { Outcome } from '../engine/types';

/**
 * 端末に残すもの。挑戦の途中（地図の上にいるときの状態）と、挑戦をまたいで
 * 残るもの（解放した深さ・持ち越す記憶・街が覚えている決着）。読み書きが
 * できない環境では、何も残さずに遊べる。
 */

export interface Profile {
  depth: number;
  runs: number;
  wins: number;
  best: number;
  /** 次の挑戦へ持ち越す記憶（残響）。 */
  carry: string | null;
  /** 前の挑戦で経験したこと（持ち越す候補）。 */
  last: string[];
  /** 街が覚えている、人物ごとの決着。 */
  remembered: Record<string, Outcome>;
  muted: boolean;
}

const RUN = 'dig:run';
const PROFILE = 'dig:profile';

const blank = (): Profile => ({
  depth: 0,
  runs: 0,
  wins: 0,
  best: 0,
  carry: null,
  last: [],
  remembered: {},
  muted: false,
});

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(PROFILE);
    return raw ? { ...blank(), ...(JSON.parse(raw) as Partial<Profile>) } : blank();
  } catch {
    return blank();
  }
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(PROFILE, JSON.stringify(p));
  } catch {
    // 残せなくても遊べる。
  }
}

export function loadRun(): Run | null {
  try {
    const raw = localStorage.getItem(RUN);
    const r = raw ? (JSON.parse(raw) as Run) : null;
    return r?.version === 1 && !r.ending ? r : null;
  } catch {
    return null;
  }
}

export function saveRun(r: Run | null): void {
  try {
    if (!r || r.ending) localStorage.removeItem(RUN);
    else localStorage.setItem(RUN, JSON.stringify(r));
  } catch {
    // 残せなくても遊べる。
  }
}
