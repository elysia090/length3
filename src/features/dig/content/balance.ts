import type { CardDef, PassiveSpec } from './defs';

/**
 * データの版。カードの数の調整・退いた札・規則の調整を、版ごとに積む。
 *
 *   tune     カードの定義への上書き（回数・レア度・退いた版）
 *   rules    規則へのパッチ（版そのものが、規則を書き換える）
 *
 * 古い保存データに退いた札が残っていても動くように、退いた札は消さずに
 * 置いておく（店にも褒美にも出ない）。
 */
export const DATA_VERSION = '1.22.1';

/**
 * 一夜の長さ。1 挑戦 40 分を目安に組む（3 層 × 8 段 + 最後の相手、
 * 遭遇 1 回 5〜7 手、地図・出来事・食堂の判断を足しておよそ 250 手）。
 *   rows     1 層の段数
 *   dawn     夜明けまでの時間（22 時から）。過ぎると相手が荒れる
 *   tough    人物の体力・意志の倍率（遭遇を 5〜7 手にする）
 *   build    ビルドの条件の倍率（初めの 5 枚では、まず揃わない）
 *   stratum  層ごとの人物の強さの伸び（下の層ほど、構成の力が要る）
 *   stage    人物の場所に見せ場が付く割合（最後の相手には必ず）。合うタグのカード
 *            ×stageMult。相手は ×stageTough
 *   slip     手がかりが漏れる率の下限（相手が揺らぐほど 100% へ近づく）
 *   keystone ビルドと同じ名の札を持っていると、条件がこの倍率まで軽くなる
 *   noon     夜明けからこの時間が過ぎると、その層の夜は終わる（挑戦の終わり）
 *   stall    この手番を過ぎると、相手の攻撃が毎手番上がる（膠着しない）
 *   rest     食堂の回復（最大値の割合）。同じ層の 2 度目からは restAgain 倍
 */
/**
 * その場の条件の点（足し算）。効き目（体力・意志・信頼を動かす一つ一つ）に足す。
 * 倍率にしないのは、札の数字に足すだけで暗算できるように。
 */
export const POINTS = {
  /** 連鎖（続けた数ごと。三つ目からは同じ）。 */
  chain: [0, 2, 4, 6] as readonly number[],
  stage: 3,
  weak: 3,
  guarded: -3,
  answer: 3,
  noted: 4,
} as const;

/**
 * 札のレベル（同じ札を重ねて上がる）。効き目の倍率と、名前に添える印。
 * 回数と最大回数は、上がるたびに一つずつ増える。
 */
export const LV_MULT: readonly number[] = [1, 1, 1.3, 1.6];
export const LV_MARK: readonly string[] = ['', 'Ⅰ', 'Ⅱ', 'Ⅲ'];

export const PACE = {
  /** 受け取りの候補の一枚が、持っている札（重ねてレベルが上がる）になる割合。 */
  again: 0.2,
  rows: 9,
  dawn: 10,
  tough: 1.5,
  /** 相手の攻撃の倍率（勝負は短く、そのぶん一撃が重い）。 */
  bite: 2.08,
  /** 区画ごとの相手の攻撃の伸び。 */
  atkStep: 0.6,
  /** 難度の効き 1 段あたりの、相手の体と意志の伸び。 */
  heat: 0.3,
  build: 1.7,
  stratum: 0.22,
  /** 底の手前より下の区画ごとの掛け算（体・意志）。 */
  deep: 1.3,
  rest: 0.4,
  restAgain: 0.5,
  stage: 0.5,
  stageTough: 1.25,
  stall: 8,
  slip: 0.45,
  keystone: 0.7,
  noon: 4,
  /** 決着のあと、体と心がこの割合を下回っていたら、ここまで息を整える（一度の遭遇で次が詰まないように）。 */
  breath: 0.25,
  /** もう一人の灯り持ちと鉢合わせるのは、このフロアから（入口で潰されないように）。 */
  rivalFrom: 4,
  /** 気まぐれ（選択肢が減る・増える・妙なものが混じる）の割合。 */
  whim: 0.06,
  /** 一つの札・記憶・部屋に重ねて刻めるエピテットの数（同じものを重ねてもいい）。 */
  stack: 3,
  /** 向き合った相手に刻める数（一度の遭遇で inkTurn まで、相手には stackFoe まで）。 */
  inkEnc: 2,
  stackFoe: 4,
  /** 決着の見返りの札に、エピテットが刻まれたまま出てくる割合（二枚目はこの半分）。 */
  inked: 0.45,
  /** 決着のあと、手元の札の一枚に、エピテットがひとりでに宿る割合。 */
  mark: 0.08,
  /** 相手の名を奪ったとき（折った）、エピテットが手に落ちる割合。 */
  epBroken: 0.15,
  /** 打ち解けたり暴いたりしたとき、エピテットが手に落ちる割合。 */
  epSoft: 0.06,
  /** 大きく共鳴したとき（4 つ以上）、輝いた札にエピテットが宿る割合。 */
  epGlow: 0.35,
  /** 決着のあと、その場で使える品が一つ手に入る割合。 */
  loot: 0.15,
  /** 受け取りの道具が、身につける品になる割合。 */
  keep: 0.2,
  /** 倒したとき、戦利品に品がまざる割合（金はいつも）。 */
  lootBeaten: 0.5,
  /** 最後の相手の扉の前で、体と心がここまで戻る。 */
  gate: 0.5,
  /** 最後の相手の手前に立つ番人の、体と意志の倍率。 */
  keeper: 1.15,
  /** 三手目から、一手ごとに邪魔が入る割合（遭遇に一度まで）。 */
  interrupt: 0.12,
  /** 食堂で食べる値段。 */
  meal: 10,
  /** 階の癖がつく割合（入口と最後の相手の階を除く）。 */
  quirk: 0.35,
  /** 下りた先で、選択のない小さな出来事が起きる割合。 */
  auto: 0.22,
} as const;

export interface Release {
  v: string;
  date: string;
  notes: readonly string[];
  tune?: Readonly<
    Record<string, Partial<Pick<CardDef, 'uses' | 'rarity' | 'retired' | 'replacedBy'>>>
  >;
  rules?: readonly PassiveSpec[];
}

export const RELEASES: readonly Release[] = [
  {
    v: '1.0.0',
    date: '2026-10-07',
    notes: ['試作。観察・威圧・嘘・殴る・沈黙・思い出す・逃走・掘る の 8 枚。'],
  },
  {
    v: '1.1.0',
    date: '2026-10-07',
    notes: ['100 の作品が伝承原型《アーキタイプ》になる。', 'タグ・ビルド・共鳴・七つの職。'],
  },
  {
    v: '1.2.0',
    date: '2026-10-07',
    notes: [
      '共通語彙《ベーシック》20 枚と、冠装飾子《エピテット》を追加。',
      '試作の 8 枚は退く（ベーシックに置き換え）。',
    ],
    tune: {
      observe: { retired: '1.2.0', replacedBy: 'look' },
      intimidate: { retired: '1.2.0', replacedBy: 'shout' },
      lie: { retired: '1.2.0', replacedBy: 'fib' },
      strike: { retired: '1.2.0', replacedBy: 'push' },
      silence: { retired: '1.2.0', replacedBy: 'hush' },
      remember: { retired: '1.2.0', replacedBy: 'recall' },
      flee: { retired: '1.2.0', replacedBy: 'run' },
      dig: { retired: '1.2.0', replacedBy: 'measure' },
    },
  },
  {
    v: '1.2.1',
    date: '2026-10-07',
    notes: ['AKIRA の回数 2 → 2（据え置き）、三体の回数 2 → 1。', '去る の基本の率 −5%。'],
    tune: { threebody: { uses: 1 } },
    rules: [
      { rule: 'leaveChance', fn: (_c, v) => (v >= 100 ? v : v - 5), text: '去る −5%（1.2.1）' },
    ],
  },
];

const legacy = (
  id: string,
  no: number,
  name: string,
  ready: CardDef['ready'],
  tags: CardDef['tags'],
): CardDef => ({
  id,
  layer: 'legacy',
  no,
  name,
  tags,
  stats: ['INT'],
  uses: 3,
  rarity: 'legacy',
  ready,
  spentName: name,
  spent: ready,
  recover: { on: [] },
  since: '1.0.0',
  flavor: '試作の札。',
});

/** 退いた札（1.0 の試作）。 */
export const LEGACY: readonly CardDef[] = [
  legacy('observe', 901, '観察', [['see'], ['clue', 1]], ['gaze']),
  legacy(
    'intimidate',
    902,
    '威圧',
    [
      ['break', 5],
      ['host', 2],
    ],
    ['body'],
  ),
  legacy('lie', 903, '嘘', [['lie', 3]], ['private']),
  legacy(
    'strike',
    904,
    '殴る',
    [
      ['hit', 6],
      ['host', 2],
    ],
    ['body'],
  ),
  legacy(
    'silence',
    905,
    '沈黙',
    [
      ['calm', 4],
      ['host', -2],
    ],
    ['private'],
  ),
  legacy('remember', 906, '思い出す', [['heal', 0, 4]], ['memory']),
  legacy('flee', 907, '逃走', [['leave']], ['place']),
  legacy(
    'dig',
    908,
    '掘る',
    [
      ['clue', 1],
      ['coins', 5],
    ],
    ['place'],
  ),
];

/** いまの版までの tune を、定義に重ねる。 */
/**
 * 札の回数の掛け率。手持ちは七枚なので、回数が多いと尽きずに回ってしまう。
 * 三人と向き合えば二枚ほどが尽きるように、どの札も一律に絞る（二回は残す）。
 */
export const USES_SCALE = 0.55;

export function tuned(def: CardDef): CardDef {
  let out = def;
  for (const r of RELEASES) {
    const t = r.tune?.[def.id];
    if (t) out = { ...out, ...t };
  }
  return { ...out, uses: Math.max(2, Math.round(out.uses * USES_SCALE)) };
}

/** いまの版までの、規則への調整。 */
export function releaseRules(): { v: string; spec: PassiveSpec }[] {
  return RELEASES.flatMap((r) => (r.rules ?? []).map((spec) => ({ v: r.v, spec })));
}
