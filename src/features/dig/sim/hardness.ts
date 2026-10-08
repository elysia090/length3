import { PACE } from '../content/balance';
import { buildsOf } from '../content/sources';
import { tierOf } from '../content/surges';
import type { Foe, MapNode, Who, World } from '../core/model';
import { ask } from '../core/rules';
import { scaleFoe } from './encounter';
import { charOf, maxHp, maxMind, stats } from './ops';

/**
 * 硬度。相手とあなたの「総合の地力」を、モース硬度の 1〜10 で見せる。
 *   1 滑石 … 4 蛍石 … 7 石英 … 10 金剛石
 * 相手のほうが 2 以上硬ければ、正面からはまず歯が立たない（硬い相手ほど
 * 頭も深く読む）。そのかわり、どの相手からも退いて、あとで再戦できる。
 */

export const MINERALS = [
  '',
  '滑石',
  '石膏',
  '方解石',
  '蛍石',
  '燐灰石',
  '正長石',
  '石英',
  '黄玉',
  '鋼玉',
  '金剛石',
];

/** 硬度 2〜10 に上がる境目（地力の素点）。 */
const STEPS = [30, 38, 48, 58, 70, 84, 100, 120, 145];

export function hardnessOf(raw: number): number {
  let h = 1;
  for (const t of STEPS) if (raw >= t) h++;
  return h;
}

export function foeRaw(f: Foe): number {
  const need = f.need >= 50 ? 8 : f.need * 1.5;
  return (
    f.maxHp / 4 +
    Math.min(f.maxResolve, f.maxHp * 1.5) / 3 +
    need +
    f.atk * 2.5 +
    f.def * 2 +
    (f.wil + f.int + f.agi) * 1.2
  );
}

export const foeHardness = (f: Foe) => hardnessOf(foeRaw(f));

/** あなた（かライバル）の地力。能力値と、構成の噛み合い（札・ビルド・段・記憶）。 */
export function youRaw(w: World, who: Who = 'you'): number {
  const c = charOf(w, who);
  const s = stats(w, who);
  const cards = c.cards.filter(Boolean).length;
  const builds = buildsOf(c);
  const tiers = builds.reduce((a, b) => a + tierOf(c, b.id), 0);
  return (
    maxHp(s) / 4 +
    maxMind(s) / 3 +
    8 +
    s.ATK * 2.5 +
    s.DEF * 2 +
    (s.WIL + s.INT + s.AGI) * 1.2 +
    cards * 3 +
    builds.length * 6 +
    tiers * 10 +
    c.perms.length
  );
}

export const youHardness = (w: World, who: Who = 'you') => hardnessOf(youRaw(w, who));

/** 地図の上での見積もり（まだ会っていない相手）。 */
export function nodeHardness(w: World, n: MapNode): number | null {
  if (!n.npc) return null;
  const late = Math.max(0, Math.round(ask(w, 'lateness', {}, 0)));
  return foeHardness(scaleFoe(w, n.npc, { eps: n.eps, stage: n.stage }, late));
}

/** 正面からは、まず歯が立たない。 */
export const outmatched = (foe: number, you: number) => foe - you >= 2;

export const hardnessLabel = (h: number) => `硬度 ${h}（${MINERALS[h] ?? '?'}）`;
