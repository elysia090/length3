import { allBuilds } from '../content/registry';
import { archSetsOf, buildsOf, linksOf } from '../content/sources';
import { tierOf } from '../content/surges';
import { branch } from '../core/branch';
import type { Cmd } from '../core/events';
import type { Card, Char, World } from '../core/model';
import { ARCH_NAME } from '../core/tags';
import { decide } from '../sim/decide';
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

/** 札を一枚使ったときの、相手の四つの道への効き（相手が応じる前まで）。 */
export interface CardEffect {
  hp: number;
  resolve: number;
  trust: number;
  clues: number;
  /** あなたの側（守り・心の構え・体力と精神の増減）。 */
  guard: number;
  calm: number;
  youHp: number;
  youMind: number;
  /** 相手の手番が止まる・敵意・攻めと守りの増減（棒には出ない効き目）。 */
  stun: number;
  hostility: number;
  atk: number;
  def: number;
  /** この一手で決着がつくなら、その結末。 */
  ends?: string;
}

const effects = new Map<string, CardEffect>();

/** 新しい挑戦を始めたら（人物が替わったら）、覚えている予測を捨てる。 */
export function clearEffects(): void {
  effects.clear();
}

/**
 * その札を、いま使ったらどうなるか。世界の写しで実際に使ってみて、相手の
 * 手番（turn）より前に起きたことだけを数える。触れている間だけ呼ぶので、
 * 同じ局面と枠の結果は覚えておく。
 */
export function cardEffect(w: World, slot: number): CardEffect {
  return effectOf(w, { c: 'card', slot });
}

/** 札でも素手でも：その手を、いま打ったらどうなるか（相手の番の前まで）。 */
export function effectOf(w: World, cmd: Cmd): CardEffect {
  // 同じ種と手順でも、人物・難しさ・手札が違えば別の局面（日替わりのやり直しなど）。
  const hand = w.you.cards.map((c) => (c ? `${c.id}${c.uses}${c.eps.join('+')}` : '-')).join(',');
  const key = `${w.seed}:${w.seq}:${w.you.job}:${w.depth}:${hand}:${JSON.stringify(cmd)}`;
  const hit = effects.get(key);
  if (hit) return hit;
  const out: CardEffect = {
    hp: 0,
    resolve: 0,
    trust: 0,
    clues: 0,
    guard: 0,
    calm: 0,
    youHp: 0,
    youMind: 0,
    stun: 0,
    hostility: 0,
    atk: 0,
    def: 0,
  };
  const evs = decide(branch(w), cmd, { sim: true });
  for (const ev of evs) {
    // 相手の手番（act）から先は、この手の効き目ではない。
    if (ev.type === 'turn' || ev.type === 'act') break;
    if (ev.type === 'enc.end') out.ends = ev.outcome;
    if (ev.type === 'foe') {
      if (ev.field === 'hp') out.hp += ev.n;
      else if (ev.field === 'resolve') out.resolve += ev.n;
      else if (ev.field === 'trust') out.trust += ev.n;
      else if (ev.field === 'hostility') out.hostility += ev.n;
      else if (ev.field === 'atk') out.atk += ev.n;
      else if (ev.field === 'def') out.def += ev.n;
    } else if (ev.type === 'foe.st' && ev.key === 'stun' && ev.n > 0) out.stun += ev.n;
    else if (ev.type === 'clue' && ev.shown && !ev.false) out.clues += 1;
    else if (ev.type === 'enc.you' && ev.n > 0) {
      if (ev.field === 'guard') out.guard += ev.n;
      else if (ev.field === 'calm') out.calm += ev.n;
    } else if (ev.type === 'vital' && ev.who === 'you') {
      out.youHp += ev.hp ?? 0;
      out.youMind += ev.mind ?? 0;
    }
  }
  if (effects.size > 200) effects.clear();
  effects.set(key, out);
  return out;
}
