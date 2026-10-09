import { isDeep } from '../core/time';
import type { JobDef } from './defs';

/**
 * 七つの職。先天値と、最初の 5 枚と、固有の補正（規則のパッチ）。最初の
 * 5 枚は、どれもビルドまで「あと一枚」になるように組んである。
 */
const tagged = (t: string) => (c: { tags?: readonly string[] }) => !!c.tags?.includes(t as never);

export const JOB_LIST: readonly JobDef[] = [
  {
    id: 'surveyor',
    name: '測量士',
    text: '見て、測って、掘る。［場所］［視線］のカードがよく効く。',
    innate: { VIT: 2, ATK: 2, DEF: 2, WIL: 3, INT: 4, AGI: 3 },
    deck: 12,
    cards: ['seeing', 'image', 'saturn', 'molloy', 'rain'],
    perms: ['promise', 'habit-measure'],
    passive: [
      {
        rule: 'mult',
        when: (c) => tagged('place')(c) || tagged('gaze')(c),
        fn: (_c, v) => v * 1.2,
        text: '［場所］［視線］のカード ×1.2',
      },
    ],
  },
  {
    id: 'watch',
    name: '夜警',
    text: '殴られ慣れた体。遭遇の初めに守り 3。深夜は［夜］のカードが強く、残った守りの 1/4 が信頼にこぼれる（夜勤）。',
    innate: { VIT: 4, ATK: 3, DEF: 4, WIL: 2, INT: 1, AGI: 2 },
    deck: 13,
    cards: ['darkknight', 'robocop', 'vernacular', 'nighthawks', 'hunters'],
    perms: ['promise', 'old-wound'],
    passive: [
      {
        rule: 'mult',
        when: (c) => tagged('night')(c) && isDeep(c.w.hour),
        fn: (_c, v) => v * 1.3,
        text: '深夜、［夜］のカード ×1.3',
      },
      {
        rule: 'guardSpill',
        when: (c) => isDeep(c.w.hour),
        fn: (_c, v) => v + 0.25,
        text: '夜勤：深夜、残った守りの 1/4 が信頼になる',
      },
    ],
    triggers: [
      {
        on: 'enc.start',
        when: (ev) => ev.type === 'enc.start' && ev.who === 'you',
        run: (tx) => tx.emit({ type: 'enc.you', field: 'guard', n: 3 }),
        text: '遭遇の初めに守り 3',
      },
    ],
  },
  {
    id: 'projectionist',
    name: '映写技師',
    text: '暗闇で見る目と、消えない記憶。連鎖がひときわ深く効く（+2）。',
    innate: { VIT: 2, ATK: 1, DEF: 2, WIL: 4, INT: 3, AGI: 3 },
    deck: 12,
    cards: ['bladerunner', 'morel', 'solaris', 'chirico', 'fightclub'],
    perms: ['promise', 'accident'],
    passive: [{ rule: 'chain', fn: (_c, v) => (v > 0 ? v + 2 : v), text: '連鎖 +2' }],
  },
  {
    id: 'reporter',
    name: '記者',
    text: '手がかりを見るたびに金 3（記事になる）。［公開情報］のカードがよく効く。',
    innate: { VIT: 2, ATK: 2, DEF: 1, WIL: 3, INT: 4, AGI: 3 },
    deck: 13,
    cards: ['merulana', 'lot49', 'presentation', 'jacobs', 'rain'],
    perms: ['promise', 'suspicion'],
    passive: [
      {
        rule: 'mult',
        when: tagged('public'),
        fn: (_c, v) => v * 1.2,
        text: '［公開情報］のカード ×1.2',
      },
    ],
    triggers: [
      {
        on: 'clue',
        when: (ev, w) => ev.type === 'clue' && ev.shown && !ev.false && w.enc?.who === 'you',
        run: (tx) => tx.emit({ type: 'coins', who: 'you', n: 3 }),
        text: '手がかりを見るたびに金 3',
      },
    ],
  },
  {
    id: 'locksmith',
    name: '錠前師',
    text: '指先と逃げ足。去る +20%。［私的情報］のカードがよく効く。',
    innate: { VIT: 2, ATK: 2, DEF: 2, WIL: 2, INT: 3, AGI: 4 },
    deck: 14,
    cards: ['conversation', 'ghost', 'pulp', 'seven', 'android'],
    perms: ['promise', 'runaway'],
    passive: [
      { rule: 'leaveChance', fn: (_c, v) => v + 20, text: '去る +20%' },
      {
        rule: 'mult',
        when: tagged('private'),
        fn: (_c, v) => v * 1.2,
        text: '［私的情報］のカード ×1.2',
      },
    ],
  },
  {
    id: 'nurse',
    name: '看護師',
    text: '回復が 1.5 倍。弱った相手は、あなたに心を開きやすい。',
    innate: { VIT: 3, ATK: 1, DEF: 2, WIL: 4, INT: 3, AGI: 2 },
    deck: 12,
    cards: ['joseph', 'children', 'agnus', 'w', 'molloy'],
    perms: ['promise', 'daughter-photo'],
    passive: [
      { rule: 'heal', fn: (_c, v) => (v > 0 ? Math.round(v * 1.5) : v), text: '回復 ×1.5' },
      {
        rule: 'trust',
        when: (c) => !!c.enc && c.enc.foe.hp * 2 < c.enc.foe.maxHp,
        fn: (_c, v) => v + 1,
        text: '体力が半分を切った相手に、信頼 +1',
      },
    ],
  },
  {
    id: 'welder',
    name: '溶接工',
    text: '鉄と火。［技術］［身体］のカードがよく効き、毎手番 守り +1・構え +1。',
    innate: { VIT: 4, ATK: 4, DEF: 3, WIL: 2, INT: 1, AGI: 1 },
    deck: 14,
    cards: ['rim', 'vernacular', 'hunters', 'leviathan', 'labyrinth'],
    perms: ['promise', 'scarred'],
    passive: [
      {
        rule: 'mult',
        when: (c) => tagged('tech')(c) || tagged('body')(c),
        fn: (_c, v) => v * 1.2,
        text: '［技術］［身体］のカード ×1.2',
      },
      { rule: 'turnGuard', fn: (_c, v) => v + 1, text: '毎手番 守り +1' },
      { rule: 'turnCalm', fn: (_c, v) => v + 1, text: '毎手番 構え +1（火花を見つめる）' },
    ],
  },
];
