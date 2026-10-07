import type { PermDef } from './defs';
import { type Character, STATS, type Stat, type StatBlock, zeroStats } from './types';

/**
 * 能力値 = 先天値 + 成長値 + 永続補正。成長は使った能力だけが伸びる。
 */

export const STAT_NAME: Record<Stat, string> = {
  VIT: '体力',
  ATK: '攻撃',
  DEF: '防御',
  WIL: '精神',
  INT: '知能',
  AGI: '素早さ',
};

export function effectiveStats(
  ch: Character,
  perm: (id: string) => PermDef | undefined,
): StatBlock {
  const out = zeroStats();
  for (const s of STATS) out[s] = ch.innate[s] + ch.growth[s];
  for (const id of ch.permanents) {
    const mods = perm(id)?.mods;
    if (!mods) continue;
    for (const s of STATS) out[s] += mods[s] ?? 0;
  }
  for (const s of STATS) out[s] = Math.max(0, out[s]);
  return out;
}

export const maxHp = (s: StatBlock) => 16 + 4 * s.VIT;
export const maxMind = (s: StatBlock) => 8 + 3 * s.WIL;

/** 次の成長に要る経験。伸びるほど重くなる。 */
export const xpNeed = (level: number) => 3 + 2 * level;

/** 経験を足し、成長した能力を返す。 */
export function addXp(ch: Character, xp: StatBlock): Stat[] {
  const grew: Stat[] = [];
  for (const s of STATS) {
    ch.xp[s] += xp[s];
    while (ch.xp[s] >= xpNeed(ch.growth[s])) {
      ch.xp[s] -= xpNeed(ch.growth[s]);
      ch.growth[s]++;
      grew.push(s);
    }
  }
  return grew;
}
