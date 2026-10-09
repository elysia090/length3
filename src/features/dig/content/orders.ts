import type { Gear } from './gear';

/**
 * 隠し順序。その場で、二つを続けて使うと（あいだに部屋を移らずに）、後のほうの
 * 効き目が変わる。どこにも書いていない。初めて起きたときに明らかになり、それ
 * からは道の読みの手順の箱に「順番」として出る。道の読みは、知っていても
 * いなくても、手順をこの順に並べる（上から使えば、ひとりでに効く）。
 *
 *   一服 → 心を戻す品        一服のあとの一杯は、よく効く（戻る量 ×2）
 *   札を満たす品 → 一服      手入れのあとの一服は、深い（戻る量 ×2）
 *   体を戻す品 → 探る        傷を縛ってから探れば、物音を立てない（気づかれず、見つかりやすい）
 *   探る → 備える            物陰で仕込む（備えの効き目 +50%）
 *   備える → 備える          備えを重ねる（後の備えの効き目 +30%）
 *
 * `null` は一服（品ではない）。
 */
export interface OrderDef {
  id: string;
  name: string;
  first: (g: Gear | null) => boolean;
  next: (g: Gear | null) => boolean;
  /** 何が変わるか（短く）。 */
  effect: string;
  /** 戻る量の倍率・備えの効き目に足す割合・探るときに見つかりやすさに足す分。 */
  boost: { heal?: number; mult?: number; find?: number; quiet?: boolean };
}

const breath = (g: Gear | null) => g === null;
const mindRest = (g: Gear | null) => g?.kind === 'rest' && (g.heal?.mind ?? 0) > 0;
const bodyRest = (g: Gear | null) => g?.kind === 'rest' && (g.heal?.hp ?? 0) > 0;
const fill = (g: Gear | null) => g?.kind === 'rest' && !!g.refill;
const seek = (g: Gear | null) => g?.kind === 'seek';
const prep = (g: Gear | null) => g?.kind === 'prep';

export const ORDERS: readonly OrderDef[] = [
  {
    id: 'cup',
    name: '一服のあとの一杯',
    first: breath,
    next: mindRest,
    effect: '戻る量 ×2',
    boost: { heal: 2 },
  },
  {
    id: 'oil',
    name: '手入れのあとの一服',
    first: fill,
    next: breath,
    effect: '戻る量 ×2',
    boost: { heal: 2 },
  },
  {
    id: 'bind',
    name: '傷を縛ってから',
    first: bodyRest,
    next: seek,
    effect: '気づかれず、見つかりやすい',
    boost: { find: 0.25, quiet: true },
  },
  {
    id: 'lurk',
    name: '物陰で仕込む',
    first: seek,
    next: prep,
    effect: '備えの効き目 +50%',
    boost: { mult: 0.5 },
  },
  {
    id: 'stack',
    name: '備えを重ねる',
    first: prep,
    next: prep,
    effect: '後の備えの効き目 +30%',
    boost: { mult: 0.3 },
  },
];

/** 直前に使ったもの（一服なら null）に続けて、これを使うと起きる順序。 */
export const orderOf = (prev: Gear | null | undefined, next: Gear | null): OrderDef | undefined =>
  prev === undefined ? undefined : ORDERS.find((o) => o.first(prev) && o.next(next));
