import type { Fx } from './fx';
import { fxText } from './fx';
import { allCards, cardDef, itemDef } from './registry';

/**
 * 持ち物（その場で使うもの）。二つの出どころを同じ形で見る。
 *
 *   品    包帯・煙玉のような品（ITEM_LIST）。多くは一度きり
 *   道具  共通語彙の動詞（見る・聞く・脅す…）。作品の札ではないので手札には
 *         入らず、回数のぶんだけ、その場で使える（id は 'tool:' + 動詞の id）
 *
 * 向き合っているあいだは、手番を使わずに一手に一つ。地図の上では、体と心や
 * 札の回数に効くものだけ使える。
 */
export interface Gear {
  id: string;
  name: string;
  text: string;
  uses: number;
  fx?: readonly Fx[];
  heal?: { hp?: number; mind?: number };
  refill?: { tags: readonly string[]; n: number };
  price: number;
  flavor: string;
  tool: boolean;
  /** 向き合っていないときにも使えるか。 */
  field: boolean;
}

export const TOOL = 'tool:';
export const isTool = (id: string): boolean => id.startsWith(TOOL);

/** 地図の上でも意味のある動詞（体と心・札の回数・金・記憶）。 */
const FIELD_OPS = new Set<Fx[0]>(['heal', 'refill', 'coins', 'perm', 'burnBad']);

export function gearOf(id: string): Gear | undefined {
  if (isTool(id)) {
    const d = cardDef(id.slice(TOOL.length));
    if (!d || d.layer !== 'basic') return undefined;
    return {
      id,
      name: d.name,
      text: fxText(d.ready),
      uses: Math.max(2, Math.min(4, d.uses)),
      fx: d.ready,
      price: 14 + 4 * Math.min(4, d.uses),
      flavor: d.flavor,
      tool: true,
      field: d.ready.every((f) => FIELD_OPS.has(f[0])),
    };
  }
  const d = itemDef(id);
  if (!d) return undefined;
  return {
    id,
    name: d.name,
    text: d.text || (d.fx ? fxText(d.fx) : ''),
    uses: d.uses ?? 1,
    fx: d.fx,
    heal: d.heal,
    refill: d.refill,
    price: d.price,
    flavor: d.flavor,
    tool: false,
    field: !d.fx || d.fx.every((f) => FIELD_OPS.has(f[0])),
  };
}

/** 道具になる動詞の一覧（共通語彙）。 */
export const allTools = (): string[] =>
  allCards()
    .filter((d) => d.layer === 'basic' && !d.retired)
    .map((d) => `${TOOL}${d.id}`);
