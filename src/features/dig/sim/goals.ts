import { PACE } from '../content/balance';
import { allItems } from '../content/registry';
import type { Goal, GoalCarry, GoalKind, GoalSize, World } from '../core/model';
import type { Tx } from '../core/tx';
import { coins, giveItem, heal, maxHp, maxMind, refill, stats } from './ops';

/**
 * 目標（大・中・小）。いつも三つ、見えるところにある。どれも、ふつうに遊べば
 * ほとんど確実に届く（小 95%・中 90%・大 85% ほど）。届くたびに小さな見返りが
 * あって、同じ大きさの次の目標が現れる。触り続ける理由を、いつも手の届く
 * ところに置いておく。
 */

interface Template {
  kind: GoalKind;
  need: number;
}

/**
 * 大きさごとの目標の順（届くたびに次へ回る）。need は、試しの遊び手（pilot）で
 * 測った「置いた時点から、その挑戦のうちに届く割合」が 小 ≈ 93%・中 ≈ 88%・
 * 大 ≈ 82% になるように選んだ（人はもう少し上手い）。届かずに挑戦が終わっても、
 * 進んだ分ごと次の挑戦に持ち越すので、いつかは必ず届く。
 */
const TEMPLATES: Readonly<Record<GoalSize, readonly Template[]>> = {
  S: [
    { kind: 'use', need: 2 },
    { kind: 'floor', need: 1 },
  ],
  M: [
    { kind: 'settle', need: 1 },
    { kind: 'floor', need: 2 },
    { kind: 'use', need: 4 },
  ],
  L: [
    { kind: 'floor', need: 3 },
    { kind: 'settle', need: 2 },
    { kind: 'use', need: 6 },
  ],
};

const SETTLED = ['beaten', 'broken', 'trusted', 'uncovered'] as const;

/** 目標の物差し（いまの値。目標は、置いたときの値からの増え分で測る）。 */
export function metric(w: World, kind: GoalKind): number {
  switch (kind) {
    case 'settle':
      return SETTLED.reduce((a, k) => a + (w.you.deeds[k] ?? 0), 0);
    case 'use':
      return w.you.deeds.used ?? 0;
    case 'floor': {
      const row = w.map.find((n) => n.id === w.pos)?.row ?? -1;
      return (w.stratum - 1) * (PACE.rows + 1) + row + 1;
    }
    case 'section':
      return w.stratum;
  }
}

/** 目標の言葉。 */
export function goalText(g: Goal): string {
  switch (g.kind) {
    case 'settle':
      return g.need === 1 ? '誰かと決着をつける' : `${g.need} 人と決着をつける`;
    case 'use':
      return `札を ${g.need} 回使う`;
    case 'floor':
      return `${g.need} フロア下りる`;
    case 'section':
      return '次の区画へ下りる';
  }
}

/** 届いたときの見返り（言葉）。 */
export const REWARD_TEXT: Readonly<Record<GoalSize, string>> = {
  S: '金 +6',
  M: '札一枚の回数 +1・体力と精神 +15%',
  L: '品を一つ・金 +12',
};

function next(w: World, size: GoalSize): Goal {
  const turn = w.flags[`goal:${size}`] ?? 0;
  const list = TEMPLATES[size];
  const t = list[turn % list.length] ?? list[0];
  const kind = t?.kind ?? 'settle';
  return { size, kind, need: t?.need ?? 1, base: metric(w, kind) };
}

/** はじめの三つ（持ち越した目標があれば、進んだ分ごと置き直す）。 */
export function initGoals(tx: Tx, carried: readonly GoalCarry[] = []): void {
  for (const size of ['L', 'M', 'S'] as const) {
    const c = carried.find((g) => g.size === size);
    const goal: Goal = c
      ? { size, kind: c.kind, need: c.need, base: metric(tx.w, c.kind) - c.got }
      : next(tx.w, size);
    tx.emit({ type: 'goal.set', goal });
  }
}

/** 届かなかった目標を、持ち越す形に。 */
export const carryGoals = (w: World): GoalCarry[] =>
  w.goals.map((g) => ({
    size: g.size,
    kind: g.kind,
    need: g.need,
    got: Math.max(0, Math.min(g.need - 1, metric(w, g.kind) - g.base)),
  }));

/** 届いた目標を確かめて、見返りを渡し、次を置く。 */
export function checkGoals(tx: Tx): void {
  const w = tx.w;
  if (w.ending || w.enc) return;
  for (const g of [...w.goals]) {
    if (metric(w, g.kind) - g.base < g.need) continue;
    tx.emit({ type: 'goal.done', size: g.size });
    tx.emit({ type: 'flag', key: `goal:${g.size}`, v: (w.flags[`goal:${g.size}`] ?? 0) + 1 });
    if (g.size === 'S') coins(tx, 6, 'you');
    else if (g.size === 'M') {
      refill(tx, 1, undefined, 'you', true);
      const s = stats(w, 'you');
      heal(tx, Math.round(maxHp(s) * 0.15), Math.round(maxMind(s) * 0.15), 'you');
    } else {
      // 大きな目標は、品を一つ（持ちきれなければ金で）。エピテットは札について出回る。
      const it = tx.pick('flavor', allItems());
      if (it) giveItem(tx, it.id);
      coins(tx, 12, 'you');
    }
    tx.emit({
      type: 'note',
      text: `目標に届いた：${goalText(g)} ── ${REWARD_TEXT[g.size]}`,
      level: 2,
    });
    tx.emit({ type: 'goal.set', goal: next(w, g.size) });
  }
}
