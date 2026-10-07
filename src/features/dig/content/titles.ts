import type { Mind } from '../core/model';
import type { PassiveSpec } from './defs';

/**
 * 人物の冠。エピテットは札・人物・場所・出来事・記憶だけでなく、あなた自身
 * にも付く。振る舞い（行い）が積もると、層の終わりに一つずつ冠が付く
 * （層ごとに一つ、三つまで）。冠は噂になって全員の認識世界に入り、
 * 相手の読みを変える。小さな規則も一つ書き換える。
 */

export type Deed =
  | 'quiet'
  | 'spent'
  | 'tech'
  | 'lies'
  | 'vows'
  | 'caught'
  | 'debts'
  | 'beaten'
  | 'broken'
  | 'trusted'
  | 'uncovered'
  | 'left'
  | 'fled';

export type Deeds = Partial<Record<Deed, number>>;

export interface Title {
  /** エピテットの id（名前はエピテットから引く）。 */
  id: string;
  /** 付く条件。強さ（大きいほど優先）を返す。0 なら付かない。 */
  earn: (d: Deeds) => number;
  /** 噂として、全員の認識世界に入るもの。 */
  mind: Partial<Pick<Mind, 'violent' | 'kind' | 'nosy' | 'honest' | 'suspicion'>>;
  text: string;
  passive: readonly PassiveSpec[];
}

const n = (d: Deeds, k: Deed) => d[k] ?? 0;
const over = (v: number, at: number) => (v >= at ? v / at : 0);

export const TITLES: readonly Title[] = [
  {
    id: 'taciturn',
    earn: (d) => over(n(d, 'quiet'), 4),
    mind: { honest: 1 },
    text: '口数の少ない人、と噂される。初めの敵意 −1',
    passive: [{ rule: 'startHostility', fn: (_c, v) => v - 1, text: '《寡黙な》' }],
  },
  {
    id: 'solitary',
    earn: (d) =>
      n(d, 'trusted') === 0 &&
      n(d, 'debts') === 0 &&
      n(d, 'beaten') + n(d, 'broken') + n(d, 'uncovered') >= 3
        ? 1.2
        : 0,
    mind: { kind: -1 },
    text: '誰にも寄りかからない。毎手番 守り +1、初めの信頼 −1',
    passive: [
      { rule: 'turnGuard', fn: (_c, v) => v + 1, text: '《孤独な》' },
      { rule: 'startTrust', fn: (_c, v) => v - 1, text: '《孤独な》' },
    ],
  },
  {
    id: 'relentless',
    earn: (d) => over(n(d, 'spent'), 5),
    mind: { violent: 1 },
    text: '尽きても止めない。0 回で使うカード ×1.2',
    passive: [{ rule: 'mult', when: (c) => !!c.spent, fn: (_c, v) => v * 1.2, text: '《執拗な》' }],
  },
  {
    id: 'arrogant',
    earn: (d) => over(n(d, 'broken'), 3),
    mind: { violent: 1, suspicion: 1 },
    text: '見下ろす人。意志を削る量 ×1.15、初めの敵意 +1',
    passive: [
      { rule: 'break', fn: (_c, v) => v * 1.15, text: '《傲慢な》' },
      { rule: 'startHostility', fn: (_c, v) => v + 1, text: '《傲慢な》' },
    ],
  },
  {
    id: 'honorless',
    earn: (d) => over(n(d, 'caught'), 2),
    mind: { suspicion: 3 },
    text: '嘘つきだと知れ渡る。体力を削る量 +2、あなたの嘘 −15%',
    passive: [
      { rule: 'hit', fn: (_c, v) => (v > 0 ? v + 2 : v), text: '《誉無き》' },
      { rule: 'lieChance', fn: (_c, v) => v - 15, text: '《誉無き》' },
    ],
  },
  {
    id: 'artificial',
    earn: (d) => over(n(d, 'tech'), 8),
    mind: { nosy: 1 },
    text: '機械の手つき。［技術］×1.15、信頼の伸び ×0.85',
    passive: [
      {
        rule: 'mult',
        when: (c) => !!c.tags?.includes('tech'),
        fn: (_c, v) => v * 1.15,
        text: '《人工的な》',
      },
      { rule: 'trust', fn: (_c, v) => (v > 0 ? v * 0.85 : v), text: '《人工的な》' },
    ],
  },
  {
    id: 'bloodied',
    earn: (d) => over(n(d, 'beaten'), 4),
    mind: { violent: 3 },
    text: '血の匂いがする。体力を削る量 +2、初めの敵意 +2',
    passive: [
      { rule: 'hit', fn: (_c, v) => (v > 0 ? v + 2 : v), text: '《血塗られた》' },
      { rule: 'startHostility', fn: (_c, v) => v + 2, text: '《血塗られた》' },
    ],
  },
  {
    id: 'transparent',
    earn: (d) => (n(d, 'lies') === 0 ? over(n(d, 'vows'), 2) : 0),
    mind: { honest: 3 },
    text: '嘘をつかない人。信頼の伸び ×1.25、あなたの嘘 −30%',
    passive: [
      { rule: 'trust', fn: (_c, v) => (v > 0 ? v * 1.25 : v), text: '《透明な》' },
      { rule: 'lieChance', fn: (_c, v) => v - 30, text: '《透明な》' },
    ],
  },
  {
    id: 'reticent',
    earn: (d) => over(n(d, 'left') + n(d, 'fled'), 3),
    mind: { kind: 1 },
    text: '深入りしない。立ち去る +15%',
    passive: [
      { rule: 'leaveChance', fn: (_c, v) => (v > 0 && v < 100 ? v + 15 : v), text: '《憚る》' },
    ],
  },
  {
    id: 'roundabout',
    earn: (d) => over(n(d, 'uncovered'), 3),
    mind: { nosy: 2 },
    text: '遠回りして核心に着く。誤った手がかり −10%、秘密が漏れやすい（+10%）',
    passive: [
      { rule: 'falseChance', fn: (_c, v) => v - 10, text: '《迂遠な》' },
      { rule: 'slip', fn: (_c, v) => v + 10, text: '《迂遠な》' },
    ],
  },
  {
    id: 'blessed',
    earn: (d) => over(n(d, 'trusted'), 4),
    mind: { kind: 3 },
    text: '慕われる。初めから信頼 +1',
    passive: [{ rule: 'startTrust', fn: (_c, v) => v + 1, text: '《祝福された》' }],
  },
];

export const titleDef = (id: string) => TITLES.find((t) => t.id === id);

/** いちばん強く当てはまる冠（まだ持っていないもの）。 */
export function earnTitle(d: Deeds, have: readonly string[]): string | null {
  let best: string | null = null;
  let v = 0;
  for (const t of TITLES) {
    if (have.includes(t.id)) continue;
    const e = t.earn(d);
    if (e > v) {
      v = e;
      best = t.id;
    }
  }
  return best;
}
