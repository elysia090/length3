import { PACE } from '../content/balance';
import { cardTags } from '../content/cardinfo';
import { type Epithet, epTier } from '../content/epithets';
import type { Fx, Num } from '../content/fx';
import { cardDef, epithetDef, foeDef } from '../content/registry';
import { archSetsOf, buildsOf, linksOf } from '../content/sources';
import type { Card, Char, MapNode, World } from '../core/model';
import { TAG_NAME } from '../core/tags';
import { nodeHardness } from './hardness';
import { nodeOf } from './run';

/**
 * エピテットの値踏み。札・相手・部屋のどこへ付けるかを、一つの物差しで測る。
 * 道の読み（二つの道の付け替えと、道の先へ刻む案）も、試しの遊び手も、ここを使う。
 *
 * 物差しは「押し」（相手の棒を動かす量。体力 1 を削るのが 1）。
 *   札    回数を増やす語   この道で足りない回数 × その札の一回の押し（余るぶんは、次の休みまで
 *                          持つので 0.25 倍）。使い切って剥がした語は、いまの回数を運ばない
 *         強める語         倍率 −1 × 一回の押し × この道で使う回数（条件つきの倍率は、その札の
 *                          形で実際に測る）
 *         タグを足す語     構成が一つ増えるごとに押し 6 ぶん（ビルドは 3 倍）
 *   相手  縮める手番 × 相手の一手の重さ。手番は、あなたの押しで相手の棒を割って数える
 *   部屋  食堂の回復・古物商の値段・出来事の実り・道のりを、押しに換えて
 *
 * 剥がしてくる語は、元の札がその語で得ていた押しを同じ物差しで差し引く。金の語は剥がさない。
 *
 * 性格（道）ごとの重み（自分の脚では推奨を切る手動なので、ここに性格は無い）
 *   安定    回数と、殴り合い・休みを重く。手強い相手を、殴り合いで弱める
 *   高連鎖  強めると構成を重く。話し合い・出来事を重く
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

/** 推す値打ちの下限（押し）。これに届かない付け替えは勧めない。 */
const MIN_CARD = 5;
const MIN_NODE = 5;
/** 剥がす手間（押し）。 */
const FRICTION = 1;
/** 余った回数の値打ち（次の休みまで持つ）。 */
const SURPLUS = 0.25;

/** 札に付けて害になる語（壊れる・錆びる・凍る・回数が減る）。 */
const harmful = (d: Epithet): boolean => {
  const c = d.card;
  return !c || !!c.burn || !!c.rusty || !!c.frozen || (c.uses ?? 0) < 0;
};

// ─── 札の一回の押し ───────────────────────────────────────────

const num = (v: Num): number =>
  typeof v === 'number' ? v : v.n + (v.s ? 3 * (v.m ?? 1) : 0) + (v.per ? 2 * (v.pm ?? 1) : 0);

function pushOf(list: readonly Fx[]): number {
  let p = 0;
  for (const f of list) {
    switch (f[0]) {
      case 'hit':
      case 'break':
      case 'cut':
        p += num(f[1]);
        break;
      case 'trust':
        // 信頼は、体力より小さな数で決着する（必要は十前後、体力は三十前後）。
        p += Math.max(0, num(f[1])) * 2.5;
        break;
      case 'clue':
        p += 4 * f[1];
        break;
      case 'guard':
      case 'calm':
      case 'heal':
        p += 0.5 * num(f[1]);
        break;
      case 'stun':
        p += 6;
        break;
      case 'expose':
        p += f[1];
        break;
      case 'check':
        p += 0.6 * pushOf(f[3]) + 0.4 * pushOf(f[4] ?? []);
        break;
      case 'if':
        p += 0.5 * pushOf(f[2]) + 0.5 * pushOf(f[3] ?? []);
        break;
    }
  }
  return p;
}

const outputs = new Map<string, number>();

/** 札の一回ぶんの押しの目安（効き目の文から。札ごとに一度だけ数える）。 */
export function cardOutput(id: string): number {
  const hit = outputs.get(id);
  if (hit !== undefined) return hit;
  const v = Math.max(2, pushOf(cardDef(id).ready));
  outputs.set(id, v);
  return v;
}

/** 手持ちの、一手あたりの押し（よく効く三枚の平均）。相手の手番を数える物差し。 */
function handPush(c: Char): number {
  const list = c.cards
    .filter((x): x is Card => !!x && x.uses > 0)
    .map((x) => cardOutput(x.id))
    .sort((a, b) => b - a)
    .slice(0, 3);
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : 6;
}

// ─── 札への付け替え ───────────────────────────────────────────

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

export interface CardCtx {
  /** 札ごとに、この道で使う回数（尽きるなら上乗せ）。無ければ、いまの減りから見積もる。 */
  wear?: (c: Card) => number;
  /** 札ごとの、規則を動かす重み（噛み合いの芯ほど大きい。0〜3）。 */
  fire?: (c: Card) => number;
  /** 付け先の候補を絞る（頼る札など）。 */
  targets?: readonly number[];
}

/** その札で、その語が生む押し（付いていれば、失う押し）。 */
function onCard(
  w: World,
  style: Style,
  c: Card,
  d: Epithet,
  want: number,
  fire: number,
  charge: boolean,
): { v: number; why: string } {
  const f = d.card;
  if (!f) return { v: 0, why: '' };
  const out = cardOutput(c.id);
  const name = `『${cardDef(c.id).name}』`;
  let v = 0;
  let why = '';
  const u = Math.max(0, f.uses ?? 0);
  if (u) {
    const short = Math.max(0, Math.ceil(want - c.uses));
    const now = charge ? Math.min(u, short) : 0;
    const later = u - now;
    const p = (now + SURPLUS * later) * out * (style === 'safe' ? 1.3 : 0.9);
    v += p;
    why = short
      ? `${name}が尽きない（この道で、あと ${short} 回足りない → 回数 +${u}${charge ? '' : '。いまの回数は増えない'}）`
      : `${name}の回数 +${u}（次の休みまで持つ）`;
  }
  if (f.mult) {
    const ctx = {
      card: c,
      char: w.you,
      tags: cardTags(c),
      others: w.you.cards.filter((x): x is Card => !!x && x.uid !== c.uid).map(cardTags),
    };
    let m = 1;
    try {
      m = f.mult(w, ctx);
    } catch {
      m = 1;
    }
    if (m > 1) {
      const times = Math.max(1, Math.min(want, c.uses + (charge ? u : 0)));
      const p =
        (m - 1) * out * times * (style === 'chain' ? 1.4 * (1 + 0.3 * fire) : 0.9 + 0.1 * fire);
      if (p > v) why = `${name}を ×${m.toFixed(1)}（この道で約 ${Math.round(times)} 回使う）`;
      v += p;
    }
  }
  if (f.add?.length) {
    const base = deckScore(w.you);
    const all = w.you.cards.map((x) => (x?.uid === c.uid ? { ...x, eps: [...x.eps, d.id] } : x));
    const builds = buildsOf({ ...w.you, cards: all }).length - buildsOf(w.you).length;
    const g = (deckScore({ ...w.you, cards: all }) - base) / 10;
    if (g > 0) {
      const p = g * 6 * (style === 'chain' ? 1.5 : 1);
      if (p > v)
        why =
          builds > 0
            ? `［${f.add.map((t) => TAG_NAME[t]).join('・')}］が付いて、ビルドが成立する`
            : `［${f.add.map((t) => TAG_NAME[t]).join('・')}］が付いて、構成が増える`;
      v += p;
    }
  }
  // 同じ語を重ねると、効きは少しずつ鈍る。
  if (c.eps.filter((e) => e === d.id).length > (charge ? 0 : 1)) v *= 0.75;
  return { v, why };
}

/** 札への付け替えで、いちばん効くもの。 */
export function bestCardInk(
  w: World,
  style: Style,
  sources: readonly InkSource[],
  ctx: CardCtx = {},
): CardInk | null {
  const cards = [...w.you.cards, ...w.you.back].filter((c): c is Card => !!c);
  const open = cards.filter((c) => c.eps.length < PACE.stack);
  const targets = ctx.targets ? open.filter((c) => ctx.targets?.includes(c.uid)) : open;
  const want = ctx.wear ?? ((c: Card) => Math.max(1, c.max - c.uses) + (c.uses <= 0 ? 1 : 0));
  const fire = ctx.fire ?? (() => 0);
  const drained = [...(w.you.drained ?? [])];
  let best: CardInk | null = null;
  for (const s of sources) {
    const d = epithetDef(s.ep);
    if (!d || harmful(d)) continue;
    const src = s.from !== undefined ? cards.find((c) => c.uid === s.from) : undefined;
    const u = Math.max(0, d.card?.uses ?? 0);
    // 運んでくる回数：手元の語は、使い切って剥がしたものでなければ運ぶ。札から剥がすなら、
    // 元の札に回数が残っていれば運ぶ（残っていなければ、使い切った語として来る）。
    const charge = src ? src.uses >= u : !drained.includes(s.ep);
    // 剥がしてくる語は、元の札が失う押しを差し引く（元の札の形で、同じ物差しで）。
    const loss = src
      ? onCard(
          w,
          style,
          { ...src, eps: src.eps.filter((e) => e !== s.ep) },
          d,
          want(src),
          fire(src),
          true,
        ).v + FRICTION
      : 0;
    for (const c of targets) {
      if (s.from === c.uid) continue;
      const { v: gain, why } = onCard(w, style, c, d, want(c), fire(c), charge);
      const v = gain - loss;
      if (v > MIN_CARD && why && (!best || v > best.v)) best = { ...s, to: c.uid, why, v };
    }
  }
  return best;
}

// ─── 相手への語 ───────────────────────────────────────────────

/** 相手の大きさ（刻む時点の値。地図の先なら、その人の素の値を硬度で伸ばして）。 */
export interface FoeSize {
  hp: number;
  resolve: number;
  need: number;
  atk: number;
  def: number;
  clues: number;
}

/** 地図の先の相手の、着いたときの大きさの見積もり。 */
export function foeSizeAt(w: World, n: MapNode): FoeSize | null {
  if (!n.npc) return null;
  const f = foeDef(n.npc);
  const hard = nodeHardness(w, n) ?? 4;
  const k = 1 + 0.12 * Math.max(0, hard - 3);
  return {
    hp: f.hp * k,
    resolve: f.resolve * k,
    need: f.need,
    atk: f.atk * k,
    def: f.def,
    clues: f.clues.length,
  };
}

/**
 * 相手への語の値打ち（押し）。縮める手番 × 相手の一手の重さ。手番は、あなたの一手の押しで
 * 相手の棒を割って数える。性格で、殴り合い（体力・意志）と話し合い（信頼・手がかり）の重みが替わる。
 */
export function foeValue(w: World, d: Epithet, style: Style, foe: FoeSize): number {
  const f = d.foe;
  if (!f) return 0;
  const P = handPush(w.you);
  const Pt = P / 2.5;
  const turns = {
    kill: foe.hp / P,
    brk: foe.resolve / P,
    talk: foe.need / Math.max(1, Pt),
  };
  const fightTurns = Math.min(turns.kill, turns.brk);
  // 縮む手番（殴り合いと話し合い、それぞれ）。
  let fight = 0;
  let talk = 0;
  if (f.hp) fight += turns.kill <= turns.brk ? (1 - f.hp) * turns.kill : 0;
  if (f.resolve) fight += turns.brk < turns.kill ? (1 - f.resolve) * turns.brk : 0;
  if (f.def) fight += (fightTurns * -f.def) / Math.max(4, P);
  if (f.stun) {
    fight += 1;
    talk += 1;
  }
  if (f.need) talk += -f.need / Math.max(1, Pt);
  if (f.trust) talk += f.trust / Math.max(1, Pt);
  if (f.show) talk += Math.min(foe.clues, f.show) * 0.8;
  if (f.hostility) talk += -f.hostility * 0.15;
  // 相手の一手の重さ（攻めが下がれば、残る手番ぶん軽くなる）。
  const blow = Math.max(3, foe.atk) + 3;
  const atkSave = f.atk ? (-f.atk * Math.min(fightTurns, turns.talk)) / blow : 0;
  const w8 = style === 'safe' ? { fight: 1.3, talk: 0.5 } : { fight: 0.6, talk: 1.3 };
  return (w8.fight * (fight + atkSave) + w8.talk * talk) * blow;
}

// ─── 部屋への語 ───────────────────────────────────────────────

/** 部屋への語の値打ち（押し）。食堂の回復・古物商の値段・出来事の実り・道のり。 */
function placeValue(w: World, d: Epithet, style: Style, n: MapNode): number {
  const f = d.place;
  if (!f) return 0;
  const rest = n.kind === 'rest' ? ((f.heal ?? 1) - 1) * PACE.rest * w.you.hp : 0;
  // 金 1 は押し 0.25 くらい（札一枚が 60 前後、押しにして 15 前後）。
  const shop = n.kind === 'shop' ? (1 - (f.price ?? 1)) * 60 * 0.25 : 0;
  const story = n.kind === 'event' ? ((f.story ?? 0) / 10) * 4 : 0;
  const road = 2 * -(f.time ?? 0) - (f.arrive?.hp ?? 0) - 0.5 * (f.arrive?.mind ?? 0);
  const v = style === 'safe' ? 1.3 * rest + 0.6 * shop + 0.5 * story : rest + shop + 1.5 * story;
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
  const sizes = new Map(nodes.map((n) => [n.id, foeSizeAt(w, n)]));
  const cards = [...w.you.cards, ...w.you.back].filter((c): c is Card => !!c);
  let best: NodeInk | null = null;
  for (const s of sources) {
    const d = epithetDef(s.ep);
    if (!d || (!d.foe && !d.place)) continue;
    const src = s.from !== undefined ? cards.find((c) => c.uid === s.from) : undefined;
    const loss = src
      ? onCard(w, style, src, d, Math.max(1, src.max - src.uses), 0, true).v + FRICTION
      : 0;
    for (const n of nodes) {
      if (n.eps.includes(s.ep)) continue;
      const size = sizes.get(n.id);
      const gain = n.npc ? (size ? foeValue(w, d, style, size) : 0) : placeValue(w, d, style, n);
      const v = gain - loss;
      const text = n.npc ? d.foe?.text : d.place?.text;
      if (!text || v <= MIN_NODE || (best && v <= best.v)) continue;
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
