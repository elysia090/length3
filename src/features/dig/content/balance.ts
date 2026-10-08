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
export const DATA_VERSION = '1.4.1';

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
export const PACE = {
  rows: 8,
  dawn: 10,
  tough: 1.7,
  build: 1.7,
  stratum: 0.3,
  rest: 0.4,
  restAgain: 0.5,
  stage: 0.5,
  stageMult: 1.35,
  stageTough: 1.25,
  stall: 8,
  slip: 0.45,
  keystone: 0.7,
  noon: 4,
  /** 決着のあと、体と心がこの割合を下回っていたら、ここまで息を整える（一度の遭遇で次が詰まないように）。 */
  breath: 0.35,
  /** もう一人の灯り持ちと鉢合わせるのは、このフロアから（入口で潰されないように）。 */
  rivalFrom: 2,
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
export function tuned(def: CardDef): CardDef {
  let out = def;
  for (const r of RELEASES) {
    const t = r.tune?.[def.id];
    if (t) out = { ...out, ...t };
  }
  return out;
}

/** いまの版までの、規則への調整。 */
export function releaseRules(): { v: string; spec: PassiveSpec }[] {
  return RELEASES.flatMap((r) => (r.rules ?? []).map((spec) => ({ v: r.v, spec })));
}
