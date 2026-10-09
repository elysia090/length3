import type { PassiveSpec } from './defs';

/**
 * 階の癖。三つに一つほどのフロアに、その階だけの癖がある（着いたときに一度、
 * 名場面の帯で告げる）。どれも得と癖が一つずつで、同じ区画の十階が、同じ
 * 調子で続かないようにする。癖はその階の部屋にいるあいだだけ効く。
 */
export interface Quirk {
  id: string;
  name: string;
  /** 着いたときの一文（得と癖を一つずつ）。 */
  text: string;
  passive: readonly PassiveSpec[];
}

export const QUIRKS: readonly Quirk[] = [
  {
    id: 'blackout',
    name: '停電',
    text: '停電している。相手は苛立っているが、暗がりで最初の札は点 +3。',
    passive: [
      { rule: 'startHostility', fn: (_c, v) => v + 1, text: '停電：相手の敵意 +1' },
      {
        rule: 'bonus',
        when: (c) => !!c.enc && c.enc.cards === 0,
        fn: (_c, v) => v + 3,
        text: '停電：最初の札 +3',
      },
    ],
  },
  {
    id: 'festival',
    name: '祭りの夜',
    text: '下の階で祭りをやっている。入る金は倍、そのかわり相手の一撃も +1。',
    passive: [
      { rule: 'coins', fn: (_c, v) => (v > 0 ? v * 2 : v), text: '祭りの夜：入る金 ×2' },
      { rule: 'strikeTaken', fn: (_c, v) => (v > 0 ? v + 1 : v), text: '祭りの夜：受ける一撃 +1' },
    ],
  },
  {
    id: 'leak',
    name: '雨漏り',
    text: '天井から雨が落ちている。休んでも戻りが三割少ないが、出来事の判定 +15%。',
    passive: [
      { rule: 'restHeal', fn: (_c, v) => Math.round(v * 0.7), text: '雨漏り：回復 ×0.7' },
      { rule: 'storyChance', fn: (_c, v) => v + 15, text: '雨漏り：出来事 +15%' },
    ],
  },
  {
    id: 'camera',
    name: '監視カメラ',
    text: '天井の隅で、赤い灯が点いている。手がかりに誤りは混じらないが、嘘は通りにくい（−20%）。',
    passive: [
      { rule: 'falseChance', fn: () => 0, text: '監視カメラ：手がかりに誤りなし' },
      { rule: 'lieChance', fn: (_c, v) => v - 20, text: '監視カメラ：嘘 −20%' },
    ],
  },
  {
    id: 'crowd',
    name: '満員',
    text: '人で溢れている。どの札も点 +2、そのかわり受ける一撃 +1。',
    passive: [
      { rule: 'bonus', fn: (_c, v) => v + 2, text: '満員：どの札も +2' },
      { rule: 'strikeTaken', fn: (_c, v) => (v > 0 ? v + 1 : v), text: '満員：受ける一撃 +1' },
    ],
  },
  {
    id: 'hush',
    name: '静まり返った階',
    text: '音がしない。話はよく届く（信頼 +1）が、殴る音も響かない（相手の体力を削る量 −2）。',
    passive: [
      { rule: 'trust', fn: (_c, v) => (v > 0 ? v + 1 : v), text: '静まり返った階：信頼 +1' },
      {
        rule: 'hit',
        fn: (_c, v) => (v > 0 ? Math.max(1, v - 2) : v),
        text: '静まり返った階：削る量 −2',
      },
    ],
  },
  {
    id: 'moon',
    name: '満月',
    text: '窓が大きい。連鎖が深く効く（+2）が、相手の脅しも重い（+1）。',
    passive: [
      { rule: 'chain', fn: (_c, v) => (v > 0 ? v + 2 : v), text: '満月：連鎖 +2' },
      { rule: 'threatTaken', fn: (_c, v) => (v > 0 ? v + 1 : v), text: '満月：受ける脅し +1' },
    ],
  },
  {
    id: 'draft',
    name: 'すきま風',
    text: '扉が閉まりきらない。立ち去りやすい（+25%）が、相手も構えない（守りの残りが半分）。',
    passive: [
      { rule: 'leaveChance', fn: (_c, v) => v + 25, text: 'すきま風：立ち去る +25%' },
      { rule: 'guardKeep', fn: (_c, v) => v * 0.5, text: 'すきま風：守りが残りにくい' },
    ],
  },
  {
    id: 'echo',
    name: '反響',
    text: '声が壁に返ってくる。意志は削りやすい（+2）が、信頼は伸びにくい（−1）。',
    passive: [
      { rule: 'break', fn: (_c, v) => (v > 0 ? v + 2 : v), text: '反響：意志を削る量 +2' },
      { rule: 'trust', fn: (_c, v) => (v > 1 ? v - 1 : v), text: '反響：信頼 −1' },
    ],
  },
  {
    id: 'market',
    name: '闇市',
    text: '廊下に露店が並んでいる。値段は三割引き、そのかわり相手は値踏みしてくる（敵意 +1）。',
    passive: [
      { rule: 'price', fn: (_c, v) => Math.round(v * 0.7), text: '闇市：値段 ×0.7' },
      { rule: 'startHostility', fn: (_c, v) => v + 1, text: '闇市：相手の敵意 +1' },
    ],
  },
];

export const quirkDef = (id: string | undefined): Quirk | undefined =>
  id ? QUIRKS.find((q) => q.id === id) : undefined;
