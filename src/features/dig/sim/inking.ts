import { PACE } from '../content/balance';
import { type Epithet, epTier } from '../content/epithets';
import { cardDef, epithetDef, foeDef } from '../content/registry';
import { archSetsOf, buildsOf, linksOf } from '../content/sources';
import type { Card, Char, MapNode, World } from '../core/model';
import { nodeHardness } from './hardness';
import { nodeOf } from './run';

/**
 * エピテットの値踏み。札・相手・部屋のどこへ付けるかを、一つの物差しで測る。
 * 道の読み（三つの道の付け替えと、道の先へ刻む案）も、試しの遊び手も、ここを使う。
 *
 * 性格（道）ごとの重み（自分の脚では推奨を切る手動なので、ここに性格は無い）
 *   安定    回数を増やす語を、いちばん減る札へ。手強い相手を、殴り合いで弱める
 *   高連鎖  強める語を、規則をいちばん動かす札へ。構成が増える語。相手を話しやすく
 *
 * 剥がしてくる語は、元の札が失うぶんを差し引く。金の語は剥がさない。
 * 重い計算（構成の数え直し）は、タグを足す語のときだけ。
 */

export type Style = 'safe' | 'chain';

export interface InkSource {
  ep: string;
  /** 剥がしてくる札（uid）。無ければ手元から。 */
  from?: number;
}

export interface CardInk extends InkSource {
  to: number;
  why: string;
  v: number;
}

export interface NodeInk extends InkSource {
  node: number;
  why: string;
  v: number;
}

const TIER = { gold: 3, silver: 2, bronze: 1, plain: 0 } as const;
const tierOf = (d: Epithet) => TIER[epTier(d)];

/** 札に付けて害になる語（壊れる・錆びる・凍る・回数が減る）。 */
const harmful = (d: Epithet): boolean => {
  const c = d.card;
  return !c || !!c.burn || !!c.rusty || !!c.frozen || (c.uses ?? 0) < 0;
};

/** 札の効き目の倍率（文から。×1.3 のような強める語）。 */
const boostOf = (d: Epithet): number => {
  const m = /×(\d+(?:\.\d+)?)/.exec(d.card?.text ?? '');
  const x = m ? Number(m[1]) : 1;
  return x > 1 && !/−|代償/.test(d.card?.text ?? '') ? x - 1 : 0;
};

/** 構成の値打ち（ビルド・連携・原型の重なり）。 */
export function deckScore(c: Char): number {
  return buildsOf(c).length * 30 + linksOf(c).length * 10 + archSetsOf(c).length * 5;
}

/** 付け替えに使える語：手元のものと、頼らない札に付いているもの（金の語は剥がさない）。 */
export function inkSources(w: World, keep: ReadonlySet<number> = new Set()): InkSource[] {
  const out: InkSource[] = w.you.epithets.map((ep) => ({ ep }));
  for (const c of [...w.you.cards, ...w.you.back])
    if (c && !keep.has(c.uid))
      for (const ep of c.eps) {
        const d = epithetDef(ep);
        if (d && tierOf(d) < 3) out.push({ ep, from: c.uid });
      }
  return out;
}

/** 剥がしてくるときの差し引き（元の札が失うぶん）。 */
const peelCost = (s: InkSource, d: Epithet): number =>
  s.from === undefined ? 0 : 1 + Math.max(0, d.card?.uses ?? 0) * 0.6 + tierOf(d) * 0.8;

export interface CardCtx {
  /** 札ごとの減り具合（この道で使う回数・尽きるなら上乗せ）。無ければ、いまの減り。 */
  wear?: (c: Card) => number;
  /** 札ごとの、規則を動かす重み（噛み合いの芯ほど大きい）。 */
  fire?: (c: Card) => number;
  /** 付け先の候補を絞る（頼る札など）。 */
  targets?: readonly number[];
}

/** 札への付け替えで、いちばん効くもの。 */
export function bestCardInk(
  w: World,
  style: Style,
  sources: readonly InkSource[],
  ctx: CardCtx = {},
): CardInk | null {
  const cards = [...w.you.cards, ...w.you.back].filter(
    (c): c is Card => !!c && c.eps.length < PACE.stack,
  );
  const targets = ctx.targets ? cards.filter((c) => ctx.targets?.includes(c.uid)) : cards;
  const wear =
    ctx.wear ?? ((c: Card) => (c.max - c.uses) / Math.max(1, c.max) + (c.uses <= 0 ? 1 : 0));
  const fire = ctx.fire ?? ((c: Card) => c.max / 6);
  const base = deckScore(w.you);
  let best: CardInk | null = null;
  for (const s of sources) {
    const d = epithetDef(s.ep);
    if (!d || harmful(d)) continue;
    const uses = Math.max(0, d.card?.uses ?? 0);
    const boost = boostOf(d);
    const adds = d.card?.add ?? [];
    for (const c of targets) {
      if (s.from === c.uid || c.eps.includes(s.ep)) continue;
      let v = 0;
      let why = '';
      if (uses) {
        v += uses * wear(c) * (style === 'safe' ? 1.6 : 0.9);
        why = `『${cardDef(c.id).name}』が尽きない（最大回数 +${uses}）`;
      }
      if (boost) {
        const b = boost * 10 * fire(c) * (style === 'chain' ? 1.6 : 0.8);
        if (b > v)
          why = style === 'chain' ? '噛み合いの芯を強める' : `『${cardDef(c.id).name}』を強める`;
        v += b;
      }
      // タグを足す語だけ、構成を数え直す（重いので、ここだけ）。
      if (adds.length) {
        const all = w.you.cards.map((x) =>
          x?.uid === c.uid ? { ...x, eps: [...x.eps, s.ep] } : x,
        );
        const g = (deckScore({ ...w.you, cards: all }) - base) / 10;
        if (g > 0) {
          v += g * (style === 'chain' ? 1.5 : 1);
          if (!why) why = '構成が増える';
        }
      }
      v -= peelCost(s, d);
      if (v > 0.6 && why && (!best || v > best.v)) best = { ...s, to: c.uid, why, v };
    }
  }
  return best;
}

/** 相手への語の値打ち（弱めるほど高い）。性格で、殴り合いと話し合いの重みが替わる。 */
export function foeValue(d: Epithet, style: Style, hardness: number): number {
  const f = d.foe;
  if (!f) return 0;
  const fight =
    3 * (1 - (f.hp ?? 1)) + 0.4 * -(f.def ?? 0) + 0.5 * -(f.atk ?? 0) + (f.stun ? 1.5 : 0);
  const talk =
    2.5 * (1 - (f.resolve ?? 1)) +
    0.6 * Math.max(-3, Math.min(3, -(f.need ?? 0))) +
    0.4 * (f.trust ?? 0) +
    0.8 * (f.show ?? 0) +
    0.3 * -(f.hostility ?? 0);
  const v = style === 'safe' ? 1.4 * fight + 0.5 * talk : 1.3 * talk + 0.7 * fight;
  return v * (0.5 + hardness / 8);
}

/** 部屋への語の値打ち（休む・買う・出来事・道のり）。 */
export function placeValue(d: Epithet, style: Style, n: MapNode): number {
  const f = d.place;
  if (!f) return 0;
  const rest = n.kind === 'rest' ? ((f.heal ?? 1) - 1) * 6 : 0;
  const shop = n.kind === 'shop' ? (1 - (f.price ?? 1)) * 6 : 0;
  const story = n.kind === 'event' ? ((f.story ?? 0) / 10) * 0.6 : 0;
  const road = 0.3 * -(f.time ?? 0) - 0.25 * (f.arrive?.hp ?? 0) - 0.2 * (f.hostility ?? 0);
  const v = style === 'safe' ? 1.3 * rest + 0.5 * (shop + story) : rest + shop + 1.5 * story;
  return v + road;
}

/** 道の先（まだ行っていない部屋）へ刻む語で、いちばん効くもの。 */
export function bestNodeInk(
  w: World,
  style: Style,
  sources: readonly InkSource[],
  path: readonly number[],
): NodeInk | null {
  const here = nodeOf(w, w.pos)?.row ?? -1;
  const nodes = path
    .map((id) => nodeOf(w, id))
    .filter((n): n is MapNode => !!n && !n.visited && n.row > here && n.eps.length < PACE.stack);
  if (!nodes.length) return null;
  const hard = new Map(nodes.map((n) => [n.id, nodeHardness(w, n) ?? 4]));
  let best: NodeInk | null = null;
  for (const s of sources) {
    const d = epithetDef(s.ep);
    if (!d || (!d.foe && !d.place)) continue;
    const cost = peelCost(s, d);
    for (const n of nodes) {
      if (n.eps.includes(s.ep)) continue;
      const v = (n.npc ? foeValue(d, style, hard.get(n.id) ?? 4) : placeValue(d, style, n)) - cost;
      const text = n.npc ? d.foe?.text : d.place?.text;
      if (!text || v <= 1.2 || (best && v <= best.v)) continue;
      const who = n.npc ? foeDef(n.npc).name : NODE_NAME[n.kind];
      best = { ...s, node: n.id, v, why: `${who}：${text.replace(/。$/, '')}` };
    }
  }
  return best;
}

const NODE_NAME: Record<MapNode['kind'], string> = {
  person: '人',
  danger: '危険',
  event: '出来事',
  rest: '食堂',
  shop: '古物商',
  boss: '最後の相手',
};
