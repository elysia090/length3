import type { World } from '../core/model';
import type { Tag } from '../core/tags';
import { isDeep } from '../core/time';
import type { EpithetCtx, PassiveSpec } from './defs';
import type { Fx } from './fx';

/**
 * 冠装飾子《エピテット》。カード・人物・場所・出来事・記憶のどれにでも
 * 刻める多義の語。同じ語でも、刻まれた先で意味が変わる。
 *
 *   カード  効き方（倍率・タグ・回数・見られ方・代償）
 *   人物    気質と状態（体力・意志・信頼・敵意・嘘・手がかり）
 *   場所    その地点の性質（時間・回復・値段・着いたときの代償・出来事）
 *   出来事  話の重さ（判定の難しさ・実りの大きさ）
 *   記憶    記憶の働き方（補正の倍率・タグ・値段・最後に返ってくる強さ）
 */

export interface CardFacet {
  text: string;
  add?: readonly Tag[];
  remove?: readonly Tag[] | 'all';
  mult?: (w: World, c: EpithetCtx) => number;
  free?: (w: World, card: string) => boolean;
  quiet?: boolean;
  twice?: boolean;
  invert?: boolean;
  frozen?: boolean;
  burn?: boolean;
  rusty?: boolean;
  pierce?: boolean;
  fixed?: boolean;
  cold?: boolean;
  care?: boolean;
  /** 遭遇で 1 度目は何も起きず、2 度目から ×2（眠った）。 */
  dormant?: boolean;
  host?: number;
  variance?: readonly [number, number];
  after?: readonly Fx[];
  aura?: readonly PassiveSpec[];
}

export interface FoeFacet {
  text: string;
  hp?: number;
  resolve?: number;
  need?: number;
  hostility?: number;
  trust?: number;
  atk?: number;
  def?: number;
  int?: number;
  agi?: number;
  /** 最初の手番に動けない。 */
  stun?: boolean;
  /** 嘘をいつもつく / けっしてつかない。 */
  lies?: 'always' | 'never';
  /** 初めから見えている手がかりの数。 */
  show?: number;
  /** この相手と向き合っているあいだの規則。 */
  passive?: readonly PassiveSpec[];
}

export interface PlaceFacet {
  text: string;
  /** 着くのにかかる時間の増減。 */
  time?: number;
  /** 着いたときの代償（負なら回復）。 */
  arrive?: { hp?: number; mind?: number };
  /** ここで出会う相手の敵意。 */
  hostility?: number;
  /** ここでの出来事の判定。 */
  story?: number;
  /** ここで休むときの回復の倍率。 */
  heal?: number;
  /** ここでの値段の倍率。 */
  price?: number;
  /** ここで出会う相手の、初めから見えている手がかり。 */
  clue?: number;
  /** 誰もいない（遭遇が起きない）。 */
  empty?: boolean;
}

export interface StoryFacet {
  text: string;
  chance?: number;
  /** 成功の実りが 2 倍（効き目が 2 回）。 */
  twice?: boolean;
}

export interface MemoryFacet {
  text: string;
  /** 能力値の補正に掛ける倍率（0 で働かない、−1 で反転）。 */
  mods?: number;
  /** タグを 2 倍に数える / 数えない。 */
  tags?: 'double' | 'none';
  value?: number;
  /** 最後の相手が、この記憶で返してくる強さ。 */
  echo?: number;
}

export interface Epithet {
  id: string;
  name: string;
  /** 全体の含意。 */
  gloss: string;
  card?: CardFacet;
  foe?: FoeFacet;
  place?: PlaceFacet;
  story?: StoryFacet;
  memory?: MemoryFacet;
  rarity: 'common' | 'uncommon' | 'rare';
}

const shares = (c: EpithetCtx) => c.others.filter((o) => o.some((t) => c.tags.includes(t))).length;
const hpLow = (c: EpithetCtx) => c.char.hp * 2 < 16 + 4 * (c.char.innate.VIT + c.char.growth.VIT);
const turn = (w: World) => w.enc?.turn ?? 1;

export const EPITHETS: readonly Epithet[] = [
  // ─── 物の性質 ─────────────────────────────────────────────
  {
    id: 'fragile',
    name: '脆い',
    gloss: '強いが、壊れやすい。',
    rarity: 'common',
    card: { text: '×1.5。使うたびに最大回数 −1。', mult: () => 1.5, burn: true },
    foe: { text: '体力 ×0.6、防御 0。', hp: 0.6, def: -9 },
    place: { text: '足場が崩れる。着くと体力 −2。', arrive: { hp: 2 } },
    memory: { text: '補正 ×1.5。値段 ×1.5。', mods: 1.5, value: 1.5 },
  },
  {
    id: 'heavy',
    name: '重い',
    gloss: '動かしにくく、動けば大きい。',
    rarity: 'common',
    card: { text: '×1.4。使うたびに相手の敵意 +1。', mult: () => 1.4, host: 1 },
    foe: { text: '体力 ×1.4、素早さ −2。', hp: 1.4, agi: -2 },
    place: { text: '着くのに 1 時間多くかかる。', time: 1 },
    story: { text: '実りが 2 倍。', twice: true },
    memory: { text: '補正 ×1.5、最後に返ってくる強さ ×1.5。', mods: 1.5, echo: 1.5 },
  },
  {
    id: 'dry',
    name: '乾いた',
    gloss: '水気がない。情も、記憶も。',
    rarity: 'common',
    card: {
      text: '［記憶］を外す。体力が半分を切っていれば ×1.5。',
      remove: ['memory'],
      mult: (_w, c) => (hpLow(c) ? 1.5 : 1),
    },
    foe: { text: '打ち解けるのに要る信頼 −1、意志 ×0.8。', need: -1, resolve: 0.8 },
    place: { text: 'ここで休んでも 3 割少ない。', heal: 0.7 },
    memory: { text: '補正 ×0.5、値段 ×2。', mods: 0.5, value: 2 },
  },
  {
    id: 'damp',
    name: '湿った',
    gloss: '滲み、染みこむ。',
    rarity: 'common',
    card: {
      text: '［記憶］を足す。使うたびに相手の次の手を 2 弱める。',
      add: ['memory'],
      after: [['cut', 2]],
    },
    foe: { text: '初めから信頼 +1、敵意 −1。', trust: 1, hostility: -1 },
    place: { text: '出来事の判定 +10%。', story: 10 },
    memory: { text: 'タグを 2 倍に数える。', tags: 'double' },
  },
  {
    id: 'dull',
    name: '鈍い',
    gloss: '切れない。そのかわり、傷つけない。',
    rarity: 'common',
    card: { text: '×0.7。0 回で使っても代償を払わない。', mult: () => 0.7, rusty: true },
    foe: { text: '知能 −2、素早さ −2（嘘が下手）。', int: -2, agi: -2 },
    place: { text: '値段 ×0.8。', price: 0.8 },
    memory: { text: '補正 ×0.75。', mods: 0.75 },
  },
  {
    id: 'sharp',
    name: '鋭い',
    gloss: '切れる。こちらも、向こうも。',
    rarity: 'uncommon',
    card: { text: '×1.3。体力を削る効き目が守りを貫く。', mult: () => 1.3, pierce: true },
    foe: { text: '知能 +2、攻撃 +2。', int: 2, atk: 2 },
    place: { text: '出会う相手の敵意 +1、手がかりが 1 つ見えている。', hostility: 1, clue: 1 },
    memory: { text: '補正 ×1.25、最後に返ってくる強さ ×1.5。', mods: 1.25, echo: 1.5 },
  },
  // ─── 意識の状態 ───────────────────────────────────────────
  {
    id: 'asleep',
    name: '眠った',
    gloss: 'まだ起きていない。',
    rarity: 'uncommon',
    card: { text: '遭遇で 1 度目は何も起きない。2 度目から ×2。', dormant: true },
    foe: { text: '最初の手番に動けない。敵意 −3。', stun: true, hostility: -3 },
    place: { text: '誰もいない。', empty: true },
    memory: { text: '働かない（タグだけは数える）。思い出すと目覚める。', mods: 0 },
  },
  {
    id: 'awake',
    name: '覚醒した',
    gloss: '眠らない目。',
    rarity: 'uncommon',
    card: { text: '×1.2。使うたびに本当の予告を見る。', mult: () => 1.2, after: [['see']] },
    foe: { text: 'けっして嘘をつかない。知能 +3。', lies: 'never', int: 3 },
    place: { text: '出来事の判定 +15%。', story: 15 },
    story: { text: '判定 +15%。', chance: 15 },
    memory: { text: '補正 ×2。', mods: 2 },
  },
  {
    id: 'hollow',
    name: '空虚な',
    gloss: '中身がない。だから、何にもぶつからない。',
    rarity: 'common',
    card: { text: 'タグをすべて外す。×1.4。', remove: 'all', mult: () => 1.4 },
    foe: { text: '意志 ×0.5。', resolve: 0.5 },
    place: { text: '誰もいない。', empty: true },
    memory: { text: 'タグを数えない。値段 ×2。', tags: 'none', value: 2 },
  },
  {
    id: 'crowded',
    name: '過密な',
    gloss: '詰まっている。',
    rarity: 'common',
    card: {
      text: 'タグを共有するほかの枠 1 つにつき ×1.15。',
      mult: (_w, c) => 1 + 0.15 * shares(c),
    },
    foe: { text: '初めから仲間を呼んでいる（攻撃 +2）。敵意 +1。', atk: 2, hostility: 1 },
    place: { text: '出会う相手の敵意 +2。値段 ×0.85。', hostility: 2, price: 0.85 },
    memory: { text: 'タグを 2 倍に数える。補正 ×0.75。', tags: 'double', mods: 0.75 },
  },
  {
    id: 'closed',
    name: '閉ざされた',
    gloss: '鍵がかかっている。',
    rarity: 'uncommon',
    card: { text: '×0.8。使っても相手に見られない。', mult: () => 0.8, quiet: true },
    foe: {
      text: '打ち解けるのに要る信頼 +2。手がかりは見えにくい。',
      need: 2,
      passive: [{ rule: 'falseChance', fn: (_c, v) => v + 15, text: '誤った手がかり +15%' }],
    },
    place: { text: '開けるのに 2 時間かかる（縦坑の鍵があればかからない）。', time: 2 },
    memory: { text: '遭遇では働かない。タグはビルドに数える。', mods: 0 },
  },
  {
    id: 'exposed',
    name: '露出した',
    gloss: '隠せない。',
    rarity: 'common',
    card: {
      text: '［私的情報］を［公開情報］に替える。相手が［公開情報］なら ×1.4。',
      add: ['public'],
      remove: ['private'],
      mult: (w) => (w.enc?.foe.tags.includes('public') ? 1.4 : 1),
    },
    foe: { text: '防御 −2。手がかりが 1 つ見えている。', def: -2, show: 1 },
    place: { text: '見通しがいい。手がかりが 1 つ見えている。もう一人に見つかりやすい。', clue: 1 },
    memory: {
      text: '最後に返ってくる強さ ×2（皆に知られている）。値段 ×0.5。',
      echo: 2,
      value: 0.5,
    },
  },
  {
    id: 'drifting',
    name: '漂う',
    gloss: '定まらない。',
    rarity: 'common',
    card: { text: '効き目が 0.4〜2.0 倍のあいだで振れる。', variance: [0.4, 2] },
    foe: { text: '逃げやすい（素早さ +2）。敵意 −1。', agi: 2, hostility: -1 },
    place: { text: '着くのに時間がかからない。', time: -1 },
    memory: { text: '補正が −0.5〜1.5 倍に振れる……ことはなく、×1。値段 ×1.5。', value: 1.5 },
  },
  {
    id: 'sunk',
    name: '沈んだ',
    gloss: '底に沈んでいる。',
    rarity: 'uncommon',
    card: {
      text: '最初の手番は ×0.5、2 手番目から ×1.6。',
      mult: (w) => (turn(w) <= 1 ? 0.5 : 1.6),
    },
    foe: {
      text: 'ふさぎ込んでいる。意志 ×0.6。話を聞けば信頼が伸びる。',
      resolve: 0.6,
      passive: [{ rule: 'trust', fn: (_c, v) => (v > 0 ? v + 1 : v), text: '信頼 +1' }],
    },
    place: {
      text: '水に浸かっている。1 時間多くかかるが、手がかりが 1 つ浮いている。',
      time: 1,
      clue: 1,
    },
    story: { text: '判定 −10%、実りが 2 倍。', chance: -10, twice: true },
    memory: { text: '抑圧されている（働かない）。思い出すと ×2 で戻る。', mods: 0 },
  },
  {
    id: 'torn',
    name: '裂けた',
    gloss: '二つに分かれている。',
    rarity: 'common',
    card: { text: '×0.6 で 2 回起きる。回数は 1 だけ減る。', mult: () => 0.6, twice: true },
    foe: { text: '体力 ×0.7、敵意 +2。', hp: 0.7, hostility: 2 },
    place: { text: '近道。着くのに時間がかからない。', time: -1 },
    memory: { text: '補正 ×0.5。', mods: 0.5 },
  },
  {
    id: 'abandoned',
    name: '捨てられた',
    gloss: '誰のものでもない。',
    rarity: 'common',
    card: {
      text: '空いている枠 1 つにつき ×1.3。',
      mult: (_w, c) => 1 + 0.3 * c.char.cards.filter((x) => !x).length,
    },
    foe: { text: '打ち解けるのに要る信頼 −2。', need: -2 },
    place: { text: '値段 ×0.6。休んでも 2 割少ない。', price: 0.6, heal: 0.8 },
    memory: { text: '値段 0。補正 +0.5 倍。', value: 0, mods: 1.5 },
  },
  {
    id: 'borrowed',
    name: '借り物の',
    gloss: 'いつか返す。',
    rarity: 'uncommon',
    card: {
      text: 'タグ［信頼］を足す。×1.3。使うたびに、相手に借りを 1 つ作る。',
      add: ['trust'],
      mult: () => 1.3,
    },
    foe: { text: '持ち物は人のもの（倒しても金が出ない）。打ち解けるのは早い。', need: -1 },
    place: { text: '休むと、ここの主に借りができる。回復 ×1.5。', heal: 1.5 },
    memory: { text: '補正 ×2。値段 0（売れない）。', mods: 2, value: 0 },
  },
  {
    id: 'false',
    name: '偽りの',
    gloss: '本当ではない。',
    rarity: 'uncommon',
    card: { text: '使うと「手は出さない」と嘘の主張を残す。×1.3。', mult: () => 1.3, after: [] },
    foe: { text: 'いつも嘘の予告をする。', lies: 'always' },
    place: { text: '出来事の判定 −10%。', story: -10 },
    story: { text: '判定 −15%、実りが 2 倍。', chance: -15, twice: true },
    memory: { text: '偽の記憶。補正 ×2。', mods: 2 },
  },
  {
    id: 'late',
    name: '遅れた',
    gloss: '間に合わない。そのぶん、重い。',
    rarity: 'common',
    card: {
      text: '最初の手番は使っても何も起きない。2 手番目から ×1.5。',
      mult: (w) => (turn(w) <= 1 ? 0 : 1.5),
    },
    foe: { text: '最初の手番に動けない。', stun: true },
    place: { text: '着くのに 1 時間多くかかる。', time: 1 },
    memory: { text: '補正 ×1.25。', mods: 1.25 },
  },
  {
    id: 'early',
    name: '早すぎる',
    gloss: '準備が整う前に。',
    rarity: 'common',
    card: { text: '最初の手番だけ ×1.8。', mult: (w) => (turn(w) <= 1 ? 1.8 : 0.8) },
    foe: { text: '敵意 +2。素早さ +2。', hostility: 2, agi: 2 },
    place: { text: '着くのに時間がかからない。出会う相手の敵意 +1。', time: -1, hostility: 1 },
    memory: { text: '補正 ×1.5。', mods: 1.5 },
  },
  {
    id: 'forgotten',
    name: '忘れられた',
    gloss: '誰も覚えていない。',
    rarity: 'uncommon',
    card: { text: '使っても相手に見られない。変質しない。', quiet: true, frozen: true },
    foe: { text: 'あなたを覚えていない（噂も前の決着も効かない）。', hostility: -1 },
    place: { text: '誰もいない。', empty: true },
    memory: { text: '働かない。思い出すと戻る。', mods: 0 },
  },
  {
    id: 'recorded',
    name: '記された',
    gloss: '書き残されている。',
    rarity: 'uncommon',
    card: {
      text: '使うたびに、使った能力に経験 +1。手がかりの誤り −10%。',
      aura: [{ rule: 'falseChance', fn: (_c, v) => v - 10, text: '誤り −10%' }],
    },
    foe: { text: '手がかりが 1 つ見えている。', show: 1 },
    place: { text: '出来事の判定 +10%。', story: 10 },
    story: { text: '判定 +10%。', chance: 10 },
    memory: { text: '値段 ×2。最後に返ってくる強さ ×0.5。', value: 2, echo: 0.5 },
  },
  {
    id: 'unfinished',
    name: '未完の',
    gloss: '終わっていない。',
    rarity: 'uncommon',
    card: { text: '変質の条件が半分で足りる。', care: true },
    foe: { text: '体力 ×1.3。意志 ×0.8。', hp: 1.3, resolve: 0.8 },
    place: { text: '出来事の判定 +5%。', story: 5 },
    story: { text: '実りが 2 倍、判定 −5%。', twice: true, chance: -5 },
    memory: { text: '補正 ×1.5。', mods: 1.5 },
  },
  {
    id: 'repeating',
    name: '反復する',
    gloss: '何度でも、同じことが起きる。',
    rarity: 'uncommon',
    card: {
      text: '直前と同じカードなら ×1.6。',
      mult: (w, c) => (w.enc?.lastCard === c.card.id ? 1.6 : 1),
    },
    foe: {
      text: '同じ手を繰り返す（読みやすい）。',
      passive: [{ rule: 'intentVisible', fn: () => 1, text: '予告が見える' }],
    },
    place: { text: '出会う相手の敵意 −1。', hostility: -1 },
    memory: { text: '補正 ×1.25。最後に返ってくる強さ ×1.5。', mods: 1.25, echo: 1.5 },
  },
  {
    id: 'corroded',
    name: '腐食した',
    gloss: '内側から崩れている。',
    rarity: 'common',
    card: { text: '×1.4。使うたびに精神 −1。', mult: () => 1.4, after: [['cost', 0, 1]] },
    foe: { text: '防御 −3、攻撃 +1。', def: -3, atk: 1 },
    place: { text: '着くと体力 −2、精神 −1。', arrive: { hp: 2, mind: 1 } },
    memory: { text: '補正 ×0.5。', mods: 0.5 },
  },
  {
    id: 'blessed',
    name: '祝福された',
    gloss: '何かに守られている。',
    rarity: 'rare',
    card: {
      text: 'タグ［信頼］を足す。使うたびに精神 +2。',
      add: ['trust'],
      after: [['heal', 0, 2]],
    },
    foe: { text: '体力 ×1.5。初めから信頼 +2。', hp: 1.5, trust: 2 },
    place: { text: 'ここで休むと回復 ×1.5。', heal: 1.5 },
    memory: { text: '補正 ×1.5。最後に返ってくる強さ ×0.5。', mods: 1.5, echo: 0.5 },
  },
  {
    id: 'tainted',
    name: '汚染された',
    gloss: '混ざってはいけないものが混ざった。',
    rarity: 'common',
    card: { text: '×1.4。使うたびに精神 −1。', mult: () => 1.4, after: [['cost', 0, 1]] },
    foe: {
      text: '精神への傷 +2。手がかりに誤りが混じりやすい。',
      passive: [
        { rule: 'threatTaken', fn: (_c, v) => (v > 0 ? v + 2 : v), text: '精神への傷 +2' },
        { rule: 'falseChance', fn: (_c, v) => v + 15, text: '誤り +15%' },
      ],
    },
    place: { text: '着くと精神 −2。', arrive: { mind: 2 } },
    memory: { text: '補正 ×1.5。最後に返ってくる強さ ×2。', mods: 1.5, echo: 2 },
  },
  {
    id: 'imitated',
    name: '模倣された',
    gloss: '誰かの写し。',
    rarity: 'uncommon',
    card: { text: '使ったあと、直前のカードの効き目を 50% で起こす。', after: [['mimic', 0.5]] },
    foe: { text: 'あなたの攻撃を真似る（攻撃 +2、知能 +1）。', atk: 2, int: 1 },
    place: { text: '前に通った場所に似ている。出来事の判定 +5%。', story: 5 },
    memory: { text: '補正 ×1（写し）。値段 ×0.5。', value: 0.5 },
  },
  {
    id: 'echoing',
    name: '残響する',
    gloss: '消えたあとも響いている。',
    rarity: 'rare',
    card: { text: '使ったあと、同じ効き目を 40% でもう一度。', after: [] },
    foe: { text: 'あなたのことを強く覚える（敵意 +1、信頼 +1）。', hostility: 1, trust: 1 },
    place: { text: '出来事の判定 +10%。', story: 10 },
    memory: { text: '最後に返ってくる強さ ×2。補正 ×1.25。', echo: 2, mods: 1.25 },
  },
  {
    id: 'inverted',
    name: '裏返った',
    gloss: '表と裏が入れ替わる。',
    rarity: 'rare',
    card: { text: '信頼と意志への効き目を入れ替え、敵意の増減を反転する。', invert: true },
    foe: {
      text: '敵意が高いほど打ち解けやすい（初めの敵意と信頼が入れ替わる）。',
      passive: [
        {
          rule: 'trust',
          when: (c) => (c.enc?.foe.hostility ?? 0) >= 6,
          fn: (_c, v) => (v > 0 ? v + 2 : v),
          text: '荒れているほど信頼 +2',
        },
      ],
    },
    place: { text: '休むと、回復のかわりに経験が入る。', heal: 0.3 },
    memory: { text: '補正が反転する（悪い記憶が力になる）。', mods: -1 },
  },
  // ─── 振る舞いの形容 ───────────────────────────────────────
  {
    id: 'nocturnal',
    name: '夜の',
    gloss: '夜にだけ本当の形になる。',
    rarity: 'common',
    card: {
      text: 'タグ［夜］を足す。深夜 ×1.3、それ以外 ×0.8。',
      add: ['night'],
      mult: (w) => (isDeep(w.hour) ? 1.3 : 0.8),
    },
    foe: {
      text: '深夜は攻撃 +2。',
      passive: [
        {
          rule: 'strikeTaken',
          when: (c) => isDeep(c.w.hour),
          fn: (_c, v) => (v > 0 ? v + 2 : v),
          text: '深夜、受ける傷 +2',
        },
      ],
    },
    place: { text: '深夜、出来事の判定 +10%。', story: 10 },
    memory: { text: 'タグ［夜］を足したことになる……タグを 2 倍に数える。', tags: 'double' },
  },
  {
    id: 'stolen',
    name: '盗まれた',
    gloss: '持ち主が気づくまで。',
    rarity: 'uncommon',
    card: {
      text: 'タグ［私的情報］を足す。相手がまだ見たことのないカードなら、回数を減らさない。',
      add: ['private'],
      free: (w, card) => !!w.enc && !(w.minds[w.enc.foe.id]?.cards ?? []).includes(card),
    },
    foe: {
      text: '何かを盗まれている（打ち解けるのに要る信頼 −1、敵意 +1）。',
      need: -1,
      hostility: 1,
    },
    memory: { text: '他人の記憶。補正 ×1.5、値段 ×1.5。', mods: 1.5, value: 1.5 },
  },
  {
    id: 'silent',
    name: '無言の',
    gloss: '何も言わない。',
    rarity: 'uncommon',
    card: {
      text: 'タグ［人物］を外す。使っても相手に見られず、使った数にも数えない。',
      remove: ['person'],
      quiet: true,
    },
    foe: { text: '話しても通じない（静粛を求める）。意志 ×1.3。', resolve: 1.3 },
    memory: { text: '補正 ×1。最後に返ってくる強さ ×0.5。', echo: 0.5 },
  },
  {
    id: 'double',
    name: '二重の',
    gloss: '二つ重なっている。',
    rarity: 'rare',
    card: { text: '効き目が 2 回起きる。回数も 2 減る。', twice: true },
    foe: { text: '体力 ×1.3、意志 ×1.3。', hp: 1.3, resolve: 1.3 },
    memory: { text: 'タグを 2 倍に数える。', tags: 'double' },
  },
  {
    id: 'amber',
    name: '琥珀の',
    gloss: '閉じ込められたまま、いつまでも同じ形。',
    rarity: 'uncommon',
    card: {
      text: 'タグ［時間］を足す。変質しない。区画を下りるたび、回数が満ちる。',
      add: ['time'],
      frozen: true,
    },
    foe: { text: '固まっている。素早さ −3、防御 +2。', agi: -3, def: 2 },
    place: { text: '時間が止まっている。着くのに時間がかからない。', time: -1 },
    memory: { text: '補正 ×1.25、値段 ×2。', mods: 1.25, value: 2 },
  },
  {
    id: 'burning',
    name: '燃える',
    gloss: '短く、明るく。',
    rarity: 'uncommon',
    card: { text: '×1.6。使うたびに最大回数が 1 減る。', mult: () => 1.6, burn: true },
    foe: { text: '攻撃 +3、体力 ×0.8。', atk: 3, hp: 0.8 },
    place: { text: '着くと体力 −3。', arrive: { hp: 3 } },
    memory: { text: '補正 ×2、最後に返ってくる強さ ×2。', mods: 2, echo: 2 },
  },
  {
    id: 'honorless',
    name: '誉無き',
    gloss: '背中からでも、勝ちは勝ち。',
    rarity: 'uncommon',
    card: {
      text: '守りを貫く。0 回の代償を払わない。使うたびに敵意 +2、信頼は伸びない。',
      pierce: true,
      rusty: true,
      host: 2,
      cold: true,
    },
    foe: { text: '卑怯（攻撃 +2、嘘をつきやすい）。', atk: 2, lies: 'always' },
    memory: { text: '補正 ×1.5。値段 ×0.5。', mods: 1.5, value: 0.5 },
  },
  {
    id: 'arrogant',
    name: '傲慢な',
    gloss: '見下ろしていれば、怖くない。',
    rarity: 'uncommon',
    card: {
      text: '×1.5。敵意 7 以上の相手には ×2。使うたびに敵意 +1。',
      mult: (w) => ((w.enc?.foe.hostility ?? 0) >= 7 ? 2 : 1.5),
      host: 1,
    },
    foe: { text: '意志 ×1.4。打ち解けるのに要る信頼 +2。', resolve: 1.4, need: 2 },
    memory: { text: '補正 ×1.5。最後に返ってくる強さ ×1.5。', mods: 1.5, echo: 1.5 },
  },
  {
    id: 'artificial',
    name: '人工的な',
    gloss: '誰がやっても、同じ結果になる。',
    rarity: 'uncommon',
    card: {
      text: 'タグ［技術］を足し、［人物］［記憶］を外す。能力値を無視し、×1.5。',
      add: ['tech'],
      remove: ['person', 'memory'],
      fixed: true,
      mult: () => 1.5,
    },
    foe: { text: '心がない（意志 ×2、打ち解けない）。', resolve: 2, need: 90 },
    memory: { text: 'タグを数えない。補正 ×1.5。', tags: 'none', mods: 1.5 },
  },
  {
    id: 'solitary',
    name: '孤独な',
    gloss: '誰とも噛み合わないことが、強さになる。',
    rarity: 'uncommon',
    card: {
      text: 'ほかの枠に、タグを共有するカードが 1 枚も無ければ ×1.6。',
      mult: (_w, c) => (shares(c) === 0 ? 1.6 : 1),
    },
    foe: { text: '仲間を呼ばない。打ち解けるのに要る信頼 −1。', need: -1 },
    place: { text: '出会う相手の敵意 −1。', hostility: -1 },
    memory: { text: '補正 ×1.5、タグを数えない。', mods: 1.5, tags: 'none' },
  },
  {
    id: 'scattered',
    name: '散漫な',
    gloss: '何を考えていたんだっけ。',
    rarity: 'common',
    card: { text: '効き目が 0.4〜2.0 倍のあいだで振れる。', variance: [0.4, 2] },
    foe: { text: '知能 −2。', int: -2 },
    story: { text: '判定 −5%。', chance: -5 },
    memory: { text: '補正 ×0.75。', mods: 0.75 },
  },
  {
    id: 'reticent',
    name: '憚る',
    gloss: '遠慮しているあいだは、何度でも。',
    rarity: 'common',
    card: {
      text: '×0.6。相手の敵意が 3 以下なら、回数を減らさない。',
      mult: () => 0.6,
      free: (w) => (w.enc?.foe.hostility ?? 9) <= 3,
    },
    foe: { text: '控えめ（敵意 −2、攻撃 −1）。', hostility: -2, atk: -1 },
    memory: { text: '補正 ×0.75、最後に返ってくる強さ ×0.5。', mods: 0.75, echo: 0.5 },
  },
  {
    id: 'relentless',
    name: '執拗な',
    gloss: '尽きても、まだ。',
    rarity: 'uncommon',
    card: {
      text: '0 回で使うと ×1.4（尽きてからが本番）。',
      mult: (w) => {
        const e = w.enc;
        const c = e?.who === 'rival' ? w.rival.char : w.you;
        const id = e?.lastCard;
        const card = c.cards.find((x) => x?.id === id);
        return card && card.uses === 0 ? 1.4 : 1;
      },
    },
    foe: { text: '諦めない（意志 ×1.3、立ち去りにくい）。', resolve: 1.3, agi: 1 },
    memory: { text: '補正 ×1.2。最後に返ってくる強さ ×1.3。', mods: 1.2, echo: 1.3 },
  },
  {
    id: 'taciturn',
    name: '寡黙な',
    gloss: '必要なことしか、しない。',
    rarity: 'common',
    card: {
      text: '使った数に数えない。使うたびに心の構え +2。',
      quiet: true,
      after: [['calm', 2]],
    },
    foe: {
      text: '口が堅い（手がかりは見えにくい、意志 ×1.2）。',
      resolve: 1.2,
      passive: [{ rule: 'falseChance', fn: (_c, v) => v + 10, text: '誤り +10%' }],
    },
    memory: { text: '補正 ×1。', mods: 1 },
  },
  {
    id: 'grave',
    name: '深刻な',
    gloss: '冗談の通じない顔で。',
    rarity: 'common',
    card: {
      text: 'タグ［記憶］を足す。×1.3。使うたびに相手の次の手を 2 弱め、精神 −1。',
      add: ['memory'],
      mult: () => 1.3,
      after: [
        ['cut', 2],
        ['cost', 0, 1],
      ],
    },
    foe: { text: '意志 ×1.3、敵意 +1。', resolve: 1.3, hostility: 1 },
    story: { text: '実りが 2 倍、判定 −10%。', twice: true, chance: -10 },
    memory: { text: '補正 ×1.5。', mods: 1.5 },
  },
  {
    id: 'transparent',
    name: '透明な',
    gloss: '何も隠さない者には、何も隠せない。',
    rarity: 'rare',
    card: {
      text: '枠にあるあいだ、相手の予告が嘘でも見える。',
      aura: [{ rule: 'intentVisible', fn: () => 1, text: '予告が見える' }],
    },
    foe: { text: 'けっして嘘をつかない。手がかりが 1 つ見えている。', lies: 'never', show: 1 },
    place: { text: '手がかりが 1 つ見えている。', clue: 1 },
    memory: { text: '値段 ×0.5、最後に返ってくる強さ ×0.5。', value: 0.5, echo: 0.5 },
  },
  {
    id: 'roundabout',
    name: '迂遠な',
    gloss: '遠回りした先に、落ちていたもの。',
    rarity: 'uncommon',
    card: {
      text: '×0.7。使ったあと、手がかりを 1 つ見る。',
      mult: () => 0.7,
      after: [['clue', 1]],
    },
    place: { text: '着くのに 1 時間多くかかるが、出来事の判定 +15%。', time: 1, story: 15 },
    memory: { text: '補正 ×1.25。', mods: 1.25 },
  },
  {
    id: 'bloodied',
    name: '血塗れの',
    gloss: '一度覚えた手応えは、消えない。',
    rarity: 'uncommon',
    card: {
      text: 'タグ［身体］を足す。この挑戦で誰かを倒していれば ×1.6。使うたびに敵意 +1。',
      add: ['body'],
      mult: (w) => (w.flags.beaten ? 1.6 : 1),
      host: 1,
    },
    foe: { text: '攻撃 +3、敵意 +2。', atk: 3, hostility: 2 },
    place: { text: '出会う相手の敵意 +2。', hostility: 2 },
    memory: { text: '補正 ×1.5、最後に返ってくる強さ ×2。', mods: 1.5, echo: 2 },
  },
];

/** 刻める先ごとに、意味を持つエピテット。 */
export const epithetsFor = (kind: 'card' | 'foe' | 'place' | 'story' | 'memory') =>
  EPITHETS.filter((e) => !!e[kind]);

/**
 * 流用のエピテット。刻んだカードを持っているあいだ、変換の規則が効く。
 * 同じ語が人物や記憶では別の意味になる（多義）ので、ここでは札の面だけ。
 */
export const SPILL_AURA: Readonly<Record<string, PassiveSpec>> = {
  blessed: {
    rule: 'overheal',
    fn: (_c, v) => v + 0.5,
    text: '《祝福された》流用：溢れた回復の半分が相手を削る',
  },
  heavy: {
    rule: 'absorb',
    fn: (_c, v) => v + 0.3,
    text: '《重い》流用：受け止めた傷の 3 割が相手を折る',
  },
  borrowed: {
    rule: 'coinBurn',
    fn: (_c, v) => v + 0.3,
    text: '《借り物の》流用：払った金の 3 割が相手を折る',
  },
  false: {
    rule: 'lieEcho',
    fn: (_c, v) => v + 0.5,
    text: '《偽りの》流用：嘘の信頼の半分が相手を崩す',
  },
  exposed: {
    rule: 'openSpill',
    fn: (_c, v) => v + 0.5,
    text: '《露出した》流用：開けすぎた鍵が守りを剥がす',
  },
  awake: {
    rule: 'seenTrust',
    fn: (_c, v) => v + 1,
    text: '《覚醒した》流用：予告を見るたび信頼 +1',
  },
  echoing: {
    rule: 'guardSpill',
    fn: (_c, v) => v + 0.2,
    text: '《残響する》流用：残った守りの 2 割が信頼になる',
  },
};
