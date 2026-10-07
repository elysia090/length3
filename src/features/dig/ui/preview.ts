import { allBuilds } from '../content/registry';
import { archSetsOf, buildsOf, linksOf } from '../content/sources';
import { tierOf } from '../content/surges';
import type { Card, Char } from '../core/model';
import { ARCH_NAME } from '../core/tags';
import { misses } from '../sim/near';
import { newCard } from '../sim/run';

/**
 * 先読み。決める前に、その一手で構成がどう変わるかを見せる（仮の人物を作って
 * ビルド・連携・原型の重なり・段を比べる）。拾う・買う・刻む・入れ替えるの
 * どれにも同じ言い方で答える。
 */

export interface Delta {
  gained: string[];
  lost: string[];
}

function snapshot(c: Char): Set<string> {
  const out = new Set<string>();
  for (const b of buildsOf(c)) {
    out.add(`《${b.name}》`);
    const t = tierOf(c, b.id);
    if (t) out.add(`《${b.name}》${t === 2 ? '極み' : '暴走'}`);
  }
  for (const l of linksOf(c)) out.add(`〈${l.name}〉`);
  for (const s of archSetsOf(c)) out.add(`〈${ARCH_NAME[s.arch]}×${s.at}〉`);
  return out;
}

export function delta(before: Char, after: Char): Delta {
  const a = snapshot(before);
  const b = snapshot(after);
  return { gained: [...b].filter((x) => !a.has(x)), lost: [...a].filter((x) => !b.has(x)) };
}

/** その札をその枠に入れたら。 */
export function withCard(c: Char, slot: number, id: string): Char {
  const cards = [...c.cards];
  cards[slot] = newCard(0, id);
  return { ...c, cards };
}

/** そのエピテットをその札に刻んだら。 */
export function withEpithet(c: Char, slot: number, ep: string): Char {
  const cards = [...c.cards];
  const card = cards[slot] as Card | null | undefined;
  if (card) cards[slot] = { ...card, eps: [...card.eps, ep] };
  return { ...c, cards };
}

/** 入れるならここ、という枠（空き枠か、いちばん得な入れ替え）。 */
export function bestSlot(c: Char, id: string): number {
  const empty = c.cards.findIndex((x) => !x);
  if (empty >= 0) return empty;
  let best = 0;
  let v = Number.NEGATIVE_INFINITY;
  c.cards.forEach((_, slot) => {
    const d = delta(c, withCard(c, slot, id));
    const s = d.gained.length - d.lost.length;
    if (s > v) {
      v = s;
      best = slot;
    }
  });
  return best;
}

/** 一行で言う。何も変わらなければ、あと一つの手がかりを。 */
export function say(d: Delta, after?: Char): string {
  const parts: string[] = [];
  if (d.gained.length) parts.push(`→ ${d.gained.join('・')}`);
  if (d.lost.length) parts.push(`失う ${d.lost.join('・')}`);
  if (!parts.length && after) {
    const m = misses({ you: after, flags: {} } as never)[0];
    if (m) parts.push(`あと一つで ${m.name}`);
  }
  return parts.join('　');
}

export const buildName = (id: string) => allBuilds().find((b) => b.id === id)?.name ?? id;
