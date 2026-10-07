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
export const DATA_VERSION = '1.2.1';

export interface Release {
  v: string;
  date: string;
  notes: readonly string[];
  tune?: Readonly<Record<string, Partial<Pick<CardDef, 'uses' | 'rarity' | 'retired' | 'replacedBy'>>>>;
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
    rules: [{ rule: 'leaveChance', fn: (_c, v) => (v >= 100 ? v : v - 5), text: '去る −5%（1.2.1）' }],
  },
];

const legacy = (id: string, no: number, name: string, ready: CardDef['ready'], tags: CardDef['tags']): CardDef => ({
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
  legacy('intimidate', 902, '威圧', [['break', 5], ['host', 2]], ['body']),
  legacy('lie', 903, '嘘', [['lie', 3]], ['private']),
  legacy('strike', 904, '殴る', [['hit', 6], ['host', 2]], ['body']),
  legacy('silence', 905, '沈黙', [['calm', 4], ['host', -2]], ['private']),
  legacy('remember', 906, '思い出す', [['heal', 0, 4]], ['memory']),
  legacy('flee', 907, '逃走', [['leave']], ['place']),
  legacy('dig', 908, '掘る', [['clue', 1], ['coins', 5]], ['place']),
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
