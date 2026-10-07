import type { Ev } from '../core/events';
import { breakFoe, coins, refill, revealClue } from '../sim/ops';
import type { BuildDef, LinkDef } from './defs';
import { permDef } from './registry';

/**
 * ビルド。ACTIVE の 5 枚と PERMANENT のタグの合計が条件を満たすと発火し、
 * 外れると消える。名前は、その戦い方に似た作品から。
 */
const isClue = (ev: Ev): ev is Extract<Ev, { type: 'clue' }> => ev.type === 'clue' && ev.shown && !ev.false;
const mine = (w: { enc?: { who: string } | null }) => w.enc?.who === 'you';

export const BUILD_LIST: readonly BuildDef[] = [
  {
    id: 'saturn',
    name: '土星の環',
    no: 29,
    need: { memory: 3, place: 2 },
    text: '［記憶］のカードを使うと、話がそれて手がかりがもう 1 つ。新しい場所に着くたび、［記憶］のカードの回数 +1。',
    triggers: [
      {
        on: 'card.use',
        when: (ev, w) => ev.type === 'card.use' && ev.tags.includes('memory') && mine(w),
        run: (tx) => {
          revealClue(tx);
        },
        text: '［記憶］のカードで、手がかりをもう 1 つ',
      },
      { on: 'moved', run: (tx) => refill(tx, 1, 'memory', 'you'), text: '着くたび、［記憶］の回数 +1' },
    ],
  },
  {
    id: 'ironman',
    name: 'アイアンマン',
    no: 56,
    need: { body: 2, tech: 2 },
    text: '守りが手番をまたいで全部残る。カードの体力の代償を受けない。体力を削る量 +2。',
    passive: [
      { rule: 'guardKeep', fn: () => 1, text: '守りが全部残る' },
      { rule: 'selfCost', when: (c) => c.kind === 'hp', fn: () => 0, text: '体力の代償なし' },
      { rule: 'hit', fn: (_c, v) => v + 2, text: '体力を削る量 +2' },
    ],
  },
  {
    id: 'nighthawks',
    name: 'ナイトホークス',
    no: 22,
    need: { night: 2, gaze: 2, place: 1 },
    text: '深夜、嘘の予告がすべて見える。相手は初めから信頼 +1。毎手番 心の構え +2。',
    passive: [
      { rule: 'intentVisible', when: (c) => c.w.hour >= 2, fn: () => 1, text: '深夜、嘘が見える' },
      { rule: 'startTrust', fn: (_c, v) => v + 1, text: '初めから信頼 +1' },
      { rule: 'turnCalm', fn: (_c, v) => v + 2, text: '毎手番 心の構え +2' },
    ],
  },
  {
    id: 'miserables',
    name: 'レ・ミゼラブル',
    no: 49,
    need: { trust: 1 },
    arch: { saint: 1, gatekeeper: 1 },
    text: '［聖人］と［門番］（バルジャンとジャベール）。体力が 3 割を切った相手への信頼 +3（赦し）。頼っても借りができない。［人物］の相手は初めから信頼 +1。',
    passive: [
      { rule: 'trust', when: (c) => !!c.enc && c.enc.foe.hp * 10 < c.enc.foe.maxHp * 3, fn: (_c, v) => v + 3, text: '弱った相手に信頼 +3' },
      { rule: 'startTrust', when: (c) => !!c.enc?.foe.tags.includes('person'), fn: (_c, v) => v + 1, text: '［人物］は初めから信頼 +1' },
    ],
  },
  {
    id: 'chrome',
    name: 'クローム襲撃',
    no: 51,
    need: { private: 2, tech: 2, institution: 1 },
    text: '遭遇で最初に使うカードは回数を減らさない。［私的情報］の手がかりを見るたび金 8。遭遇の初めに相手の防御 −2。',
    passive: [{ rule: 'useSpend', when: (c) => (c.enc?.cards ?? 1) === 0, fn: () => 0, text: '最初のカードは回数を減らさない' }],
    triggers: [
      {
        on: 'clue',
        when: (ev, w) => isClue(ev) && mine(w) && !!permDef(ev.id)?.tags.includes('private'),
        run: (tx) => coins(tx, 8, 'you'),
        text: '［私的情報］の手がかりで金 8',
      },
      {
        on: 'enc.start',
        when: (ev) => ev.type === 'enc.start' && ev.who === 'you',
        run: (tx) => tx.emit({ type: 'foe', field: 'def', n: -Math.min(2, tx.w.enc?.foe.def ?? 0) }),
        text: '相手の防御 −2',
      },
    ],
  },
  {
    id: 'orwell',
    name: '1984年',
    no: 48,
    need: { institution: 3, gaze: 2 },
    text: '予告はいつも本当の姿で見える。［制度］の相手の意志を 1.5 倍削る。ただし信頼の伸び −1。',
    passive: [
      { rule: 'intentVisible', fn: () => 1, text: '予告が見える' },
      { rule: 'break', when: (c) => !!c.enc?.foe.tags.includes('institution'), fn: (_c, v) => Math.round(v * 1.5), text: '［制度］の意志 ×1.5' },
      { rule: 'trust', fn: (_c, v) => (v > 0 ? Math.max(0, v - 1) : v), text: '信頼の伸び −1' },
    ],
  },
  {
    id: 'cities',
    name: '見えない都市',
    no: 44,
    need: { place: 3, memory: 1 },
    text: '出来事の判定 +15%。金の入り ×1.1。',
    passive: [
      { rule: 'storyChance', fn: (_c, v) => v + 15, text: '出来事 +15%' },
      { rule: 'coins', fn: (_c, v) => Math.round(v * 1.1), text: '金 ×1.1' },
    ],
  },
  {
    id: 'stalker',
    name: 'ストーカー',
    no: 75,
    need: { place: 1, time: 1 },
    arch: { drifter: 1, gatekeeper: 1 },
    text: '［漂流者］と［門番］（案内人）。かならず立ち去れる。手がかりを見るたび金 4（ゾーンの品）。',
    passive: [{ rule: 'leaveChance', fn: () => 100, text: 'かならず去れる' }],
    triggers: [{ on: 'clue', when: (ev, w) => isClue(ev) && mine(w), run: (tx) => coins(tx, 4, 'you'), text: '手がかりで金 4' }],
  },
  {
    id: 'leaves',
    name: '紙葉の家',
    no: 55,
    need: { place: 2, private: 2, memory: 1 },
    text: '誤った手がかりが混じらない。本当の手がかりを見るたび、相手の意志を 2 削る。',
    passive: [{ rule: 'falseChance', fn: () => 0, text: '誤りが混じらない' }],
    triggers: [{ on: 'clue', when: (ev, w) => isClue(ev) && mine(w), run: (tx) => void breakFoe(tx, 2), text: '手がかりで意志 −2' }],
  },
  {
    id: 'matrix',
    name: 'マトリックス',
    no: 66,
    need: { tech: 2, gaze: 2, public: 1 },
    text: '予告はいつも本当の姿で見える。見抜かれた嘘を打った相手は、意志を 5 失う。',
    passive: [{ rule: 'intentVisible', fn: () => 1, text: '予告が見える' }],
    triggers: [
      {
        on: 'act',
        when: (_ev, w) => mine(w) && !!w.enc?.foe.intent?.lie,
        run: (tx) => void breakFoe(tx, 5),
        text: '嘘を打った相手の意志 −5',
      },
    ],
  },
  {
    id: 'heat',
    name: 'ヒート',
    no: 69,
    need: { body: 2, time: 2 },
    text: '4 手番目から体力を削る量 ×1.5。5 手番目からはかならず去れる。',
    passive: [
      { rule: 'hit', when: (c) => (c.enc?.turn ?? 0) >= 4, fn: (_c, v) => Math.round(v * 1.5), text: '4 手番目から ×1.5' },
      { rule: 'leaveChance', when: (c) => (c.enc?.turn ?? 0) >= 5, fn: () => 100, text: '5 手番目から去れる' },
    ],
  },
  {
    id: 'highlow',
    name: '天国と地獄',
    no: 76,
    need: { public: 2, private: 2, institution: 1 },
    text: '金の入り ×1.5。値段 ×0.8。',
    passive: [
      { rule: 'coins', fn: (_c, v) => Math.round(v * 1.5), text: '金 ×1.5' },
      { rule: 'price', fn: (_c, v) => Math.round(v * 0.8), text: '値段 ×0.8' },
    ],
  },
  {
    id: 'solaris',
    name: 'ソラリス',
    no: 52,
    need: { memory: 2, person: 2, gaze: 1 },
    text: '精神への傷 −2。精神の回復 +2。',
    passive: [
      { rule: 'threatTaken', fn: (_c, v) => Math.max(0, v - 2), text: '精神への傷 −2' },
      { rule: 'heal', when: (c) => c.kind === 'mind', fn: (_c, v) => (v > 0 ? v + 2 : v), text: '精神の回復 +2' },
    ],
  },
];

/** 共鳴。対になる作品が同時に枠にあると効く。 */
export const LINK_LIST: readonly LinkDef[] = [
  { id: 'zone', name: 'ゾーン', cards: ['picnic', 'stalker'], text: '手がかりを見るたび金 5。', triggers: [{ on: 'clue', when: (ev, w) => isClue(ev) && mine(w), run: (tx) => coins(tx, 5, 'you'), text: '手がかりで金 5' }] },
  { id: 'voight', name: '共感の検査', cards: ['android', 'bladerunner'], text: '嘘 +20%。予告が見える。', passive: [{ rule: 'lieChance', fn: (_c, v) => v + 20, text: '嘘 +20%' }, { rule: 'intentVisible', fn: () => 1, text: '予告が見える' }] },
  { id: 'panopticon', name: '一望監視', cards: ['orwell', 'discipline'], text: '予告が見える。意志を削る量 +1。', passive: [{ rule: 'intentVisible', fn: () => 1, text: '予告が見える' }, { rule: 'break', fn: (_c, v) => v + 1, text: '意志 +1' }] },
  { id: 'paperwork', name: '書類仕事', cards: ['bureau', 'brazil'], text: '相手を動けなくするたび、敵意 −2。', triggers: [{ on: 'foe.st', when: (ev) => ev.type === 'foe.st' && ev.key === 'stun' && ev.n > 0, run: (tx) => tx.emit({ type: 'foe', field: 'hostility', n: -Math.min(2, tx.w.enc?.foe.hostility ?? 0) }), text: '動けなくすると敵意 −2' }] },
  { id: 'friedrich', name: 'フリードリヒ', cards: ['monk', 'icesea'], text: '毎手番 心の構え +2。', passive: [{ rule: 'turnCalm', fn: (_c, v) => v + 2, text: '毎手番 心の構え +2' }] },
  { id: 'abe', name: '安部公房', cards: ['map', 'dunes'], text: '休むのに時間がかからない。', passive: [{ rule: 'timeCost', when: (c) => c.kind === 'rest', fn: () => 0, text: '休んでも時間が進まない' }] },
  { id: 'illusion', name: '幻影', cards: ['morel', 'mulholland'], text: '誤った手がかり −30%。', passive: [{ rule: 'falseChance', fn: (_c, v) => v - 30, text: '誤り −30%' }] },
  { id: 'dick', name: 'ディック', cards: ['ubik', 'android'], text: '代償が半分になる。', passive: [{ rule: 'selfCost', fn: (_c, v) => Math.floor(v / 2), text: '代償 ×0.5' }] },
  { id: 'lem', name: 'レム', cards: ['solaris', 'voice'], text: 'INT 判定 +10%。', passive: [{ rule: 'checkChance', when: (c) => !!c.stat?.includes('INT'), fn: (_c, v) => v + 10, text: 'INT +10%' }] },
  { id: 'night-shop', name: '夜の店', cards: ['nighthawks', 'cafe'], text: '休むと +10 回復。', passive: [{ rule: 'restHeal', fn: (_c, v) => v + 10, text: '休むと +10' }] },
  { id: 'ghost-machine', name: '機械の中の幽霊', cards: ['bladerunner', 'ghost'], text: '打ち解けるか暴くと、［記憶］のカードの回数 +1。', triggers: [{ on: 'enc.end', when: (ev, w) => mine(w) && ev.type === 'enc.end' && (ev.outcome === 'trusted' || ev.outcome === 'uncovered'), run: (tx) => refill(tx, 1, 'memory', 'you'), text: '［記憶］の回数 +1' }] },
  { id: 'cyberspace', name: 'サイバースペース', cards: ['matrix', 'chrome'], text: '［技術］のカード ×1.2。', passive: [{ rule: 'mult', when: (c) => !!c.tags?.includes('tech'), fn: (_c, v) => v * 1.2, text: '［技術］×1.2' }] },
  { id: 'detectives', name: '刑事たち', cards: ['darkknight', 'seven'], text: '遭遇の初めに手がかりを 1 つ。', triggers: [{ on: 'enc.start', when: (ev) => ev.type === 'enc.start' && ev.who === 'you', run: (tx) => void revealClue(tx), text: '初めに手がかり 1' }] },
  { id: 'armor', name: '装甲', cards: ['t2', 'ironman'], text: '毎手番 守り +3。', passive: [{ rule: 'turnGuard', fn: (_c, v) => v + 3, text: '毎手番 守り +3' }] },
  { id: 'legibility', name: '地図と領土', cards: ['seeing', 'image'], text: '出来事 +10%、誤った手がかり −10%。', passive: [{ rule: 'storyChance', fn: (_c, v) => v + 10, text: '出来事 +10%' }, { rule: 'falseChance', fn: (_c, v) => v - 10, text: '誤り −10%' }] },
  { id: 'streets', name: '街路', cards: ['jacobs', 'pattern'], text: '信頼の伸び +1。', passive: [{ rule: 'trust', fn: (_c, v) => (v > 0 ? v + 1 : v), text: '信頼 +1' }] },
  { id: 'weber', name: 'ヴェーバー', cards: ['objectivity', 'ethic'], text: '金の入り ×1.2。', passive: [{ rule: 'coins', fn: (_c, v) => Math.round(v * 1.2), text: '金 ×1.2' }] },
  { id: 'witness', name: '目撃者', cards: ['may3', 'pope'], text: '意志を削る量 +2。', passive: [{ rule: 'break', fn: (_c, v) => v + 2, text: '意志 +2' }] },
];
