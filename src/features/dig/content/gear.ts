import type { GearKind, Seek } from './defs';
import type { Fx } from './fx';
import { allCards, cardDef, itemDef } from './registry';

/**
 * 持ち物（その場で使うもの）。二つの出どころを同じ形で見る。
 *
 *   品    包帯・煙玉のような品（ITEM_LIST）。休む・備える・探るのどれか
 *   道具  共通語彙の動詞（見る・聞く・脅す…）。作品の札ではないので手札には
 *         入らず、回数のぶんだけ、その階を探るのに使う（id は 'tool:' + 動詞の id）
 *
 * どれも向き合っていないときに使う。向き合っているあいだに使う品は無い（札だけで戦う）。
 */
export interface Gear {
  id: string;
  kind: GearKind;
  name: string;
  text: string;
  uses: number;
  heal?: { hp?: number; mind?: number };
  refill?: { tags: readonly string[]; n: number };
  prep?: readonly Fx[];
  seek?: Seek;
  cost?: number;
  price: number;
  flavor: string;
  tool: boolean;
}

/** 持てる持ち物の数。 */
export const ITEM_CAP = 8;

export const TOOL = 'tool:';
export const isTool = (id: string): boolean => id.startsWith(TOOL);

/** 道具で探る：出来事が起きやすいが、気づかれることもある。 */
const TOOL_SEEK: Seek = { story: 0.45, find: 0.3 };

export function gearOf(id: string): Gear | undefined {
  if (isTool(id)) {
    const d = cardDef(id.slice(TOOL.length));
    if (!d || d.layer !== 'basic') return undefined;
    return {
      id,
      kind: 'seek',
      name: d.name,
      text: `${d.name}ことで、この階を探る。出来事が起きるか、何かが見つかるかもしれない（1 時間）。`,
      uses: Math.max(2, Math.min(4, d.uses)),
      seek: TOOL_SEEK,
      price: 14 + 4 * Math.min(4, d.uses),
      flavor: d.flavor,
      tool: true,
    };
  }
  const d = itemDef(id);
  if (!d) return undefined;
  return {
    id,
    kind: d.kind,
    name: d.name,
    text: d.text,
    uses: d.uses ?? 1,
    heal: d.heal,
    refill: d.refill,
    prep: d.prep,
    seek: d.seek,
    cost: d.cost,
    price: d.price,
    flavor: d.flavor,
    tool: false,
  };
}

/** 道具になる動詞の一覧（共通語彙）。 */
export const allTools = (): string[] =>
  allCards()
    .filter((d) => d.layer === 'basic' && !d.retired)
    .map((d) => `${TOOL}${d.id}`);
