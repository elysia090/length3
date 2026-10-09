import { afterDef } from '../content/after';
import { PACE } from '../content/balance';
import { quirkDef } from '../content/quirks';
import { allBuilds, allLinks, cardDef, epithetDef, foeDef, permDef } from '../content/registry';
import { buildsOf } from '../content/sources';
import { branch } from '../core/branch';
import type { Cmd } from '../core/events';
import type { AfterKind, MapNode, World } from '../core/model';
import { ARCH_NAME, type Archetype, TAG_NAME, type Tag } from '../core/tags';
import { decide } from './decide';
import { bestCardInk, bestNodeInk, inkSources, type Style } from './inking';
import { type Miss, misses } from './near';
import { maxHp, stats } from './ops';
import { pilot } from './pilot';
import { nodeOf, reachable } from './run';

/**
 * ルート読み。いちばん勝てる道を一つ示すのではなく、いまの構成を読んで、
 * 性格の違う二つの道を出す。三つ目の「自分の脚で」は推奨を切る手動で、ここは何も出さない。
 *
 *   安定        低連鎖・高安定  ほぼ抜けられる。ただし得るものは少ない
 *   高連鎖      高連鎖・高リスク  相互作用が幾つも噛み合う。崩れると大きい
 *
 * やり方
 *   試行   残りの地図の場所ごとに、世界を複製して自動操縦で通してみる（頭は軽い
 *          ほう）。体力・回数の増減、得たもの、そして「実際に値を動かした規則と
 *          トリガの出どころ」を数える。これが相互作用の数になる
 *   積算   道ごとに試行を積み上げる（体力は持ち越し、回数は枠ごとに足し引き）
 *   不足   ビルド・記憶の組み合わせ・連携・原型の重なりのうち、あと 1 つで
 *          成立するものを探し、それが拾えそうな場所を地図から探す（確約はしない）
 *
 * 世界は書き換えない（読むだけの射影）。同じ世界からは、いつも同じ助言。
 */

export interface Probe {
  node: number;
  dead: number;
  hp: number;
  mind: number;
  /** 枠ごとの回数の増減（平均）。 */
  uses: number[];
  gain: number;
  fired: Map<string, number>;
  outcomes: Record<string, number>;
  gets: string[];
}

export type RouteKind = 'chain' | 'safe';

export interface Route {
  kind: RouteKind;
  label: string;
  aim: 'win' | 'play';
  path: number[];
  steps: string[];
  survive: number;
  /** 最後の相手の手前に着いたときの体力（割合）。 */
  hpEnd: number;
  links: string[];
  gain: number;
  text: string;
  warn: string[];
  hint?: string;
  /** 成功すれば繋がるもの（高連鎖）。 */
  gets?: string[];
  /** この道で回数が尽きる・残り 1 回を切る札（uid）。 */
  wear: number[];
  /** この道で頼る札（uid、多くて 3）。道ごとに違う札が前に出る。 */
  lean: number[];
  /** この道のための付け替え（手元か、頼らない札から剥がして、この札へ）。 */
  ink?: Ink;
  /** 道の先へ刻む（この道で出会う相手か、寄る部屋へ）。 */
  mark?: Mark;
}

export interface Mark {
  ep: string;
  /** 刻む部屋（地図の場所）。 */
  node: number;
  from?: number;
  why: string;
}

export interface Ink {
  ep: string;
  /** 刻む札（uid）。 */
  to: number;
  /** 剥がしてくる札（uid）。無ければ手元から。 */
  from?: number;
  why: string;
}

export type { Miss };

export interface Advice {
  win: Route[];
  play: Route[];
  misses: Miss[];
}

const LABEL: Record<RouteKind, string> = {
  chain: '高連鎖・高リスク',
  safe: '低連鎖・高安定',
};

const NODE_NAME: Record<MapNode['kind'], string> = {
  person: '人',
  danger: '危険',
  event: '出来事',
  rest: '食堂',
  shop: '古物商',
  boss: '最後の相手',
};

export function nodeLabel(n: MapNode): string {
  const who = n.npc ? foeDef(n.npc).name : NODE_NAME[n.kind];
  const eps = n.eps.map((e) => epithetDef(e)?.name).filter(Boolean);
  const stage = n.stage?.length ? `［${n.stage.map((t) => TAG_NAME[t]).join('・')}］` : '';
  return `${eps.length ? `${who}（${eps.join('・')}）` : who}${stage}`;
}

/** 規則の出どころを、画面の言葉に。構成から来たものだけ（基本の規則・深さ・版は数えない）。 */
export function sourceLabel(src: string): string | null {
  const [kind, a, b] = src.split(':');
  switch (kind) {
    case 'card':
      return b ? `『${cardDef(b).name}』` : null;
    case 'perm':
      return a ? `《${permDef(a)?.name ?? a}》` : null;
    case 'build': {
      const d = allBuilds().find((x) => x.id === a);
      return d ? `《${d.name}》` : null;
    }
    case 'surge': {
      const d = allBuilds().find((x) => x.id === a);
      return d ? `《${d.name}》暴走` : null;
    }
    case 'link': {
      const d = allLinks().find((x) => x.id === a);
      return d ? `〈${d.name}〉` : null;
    }
    case 'arch': {
      const m = /^([a-z]+)(\d)$/.exec(a ?? '');
      return m?.[1] ? `〈${ARCH_NAME[m[1] as Archetype]}×${m[2]}〉` : null;
    }
    case 'ep':
      return b ? `《${epithetDef(b)?.name ?? b}》` : null;
    case 'stage':
      return a ? `見せ場［${TAG_NAME[a as Tag]}］` : null;
    case 'quirk':
      return a ? (quirkDef(a)?.name ?? null) : null;
    case 'after':
      return a ? (afterDef(a as AfterKind)?.name ?? null) : null;
    case 'foe':
    case 'place':
    case 'story':
      return a ? `《${epithetDef(a)?.name ?? a}》` : null;
    default:
      return null;
  }
}

// ─── 試行 ─────────────────────────────────────────────────────

const OUTCOME_GAIN: Record<string, number> = {
  uncovered: 8,
  trusted: 7,
  broken: 5,
  beaten: 4,
  left: 0,
};

function snapshot(w: World) {
  const y = w.you;
  return {
    hp: y.hp,
    mind: y.mind,
    uses: y.cards.map((c) => c?.uses ?? 0),
    perms: new Set(y.perms),
    eps: y.epithets.length,
    coins: y.coins,
    builds: new Set(buildsOf(w.you).map((b) => b.id)),
  };
}

/** 一つの場所を、複製した世界で通してみる。 */
export function probe(w: World, nodeId: number, samples = 2): Probe | null {
  const target = nodeOf(w, nodeId);
  if (!target) return null;
  const out: Probe = {
    node: nodeId,
    dead: 0,
    hp: 0,
    mind: 0,
    uses: w.you.cards.map(() => 0),
    gain: 0,
    fired: new Map(),
    outcomes: {},
    gets: [],
  };
  const gets = new Set<string>();
  for (let i = 0; i < samples; i++) {
    const s = branch(w);
    const salt = Math.imul(nodeId + 1, 0x9e3779b1) ^ Math.imul(i + 3, 0x85ebca6b);
    for (const k of ['enc', 'ai', 'story', 'loot', 'rival', 'gossip'] as const)
      s.rng[k] = (s.rng[k] ^ salt ^ (k.length * 0x2545f491)) >>> 0;
    s.pending = null;
    s.enc = null;
    const parent = s.map.find((m) => m.next.includes(nodeId));
    s.pos = parent ? parent.id : null;
    const before = snapshot(s);
    const trace = new Map<string, number>();
    let last: string | undefined;
    const run = (cmd: Parameters<typeof decide>[1]) => {
      const evs = decide(s, cmd, { sim: true, trace });
      for (const ev of evs) if (ev.type === 'enc.end') last = ev.outcome;
      return evs.length > 0;
    };
    if (!run({ c: 'move', node: nodeId })) return null;
    for (let step = 0; step < 160 && !s.ending && (s.enc || s.pending); step++) {
      const cmd = pilot(s, { quick: true });
      if (!cmd || !run(cmd)) break;
    }
    const after = snapshot(s);
    const dead = s.ending?.kind === 'dead' ? 1 : 0;
    out.dead += dead / samples;
    out.hp += (after.hp - before.hp) / samples;
    out.mind += (after.mind - before.mind) / samples;
    after.uses.forEach((u, slot) => {
      out.uses[slot] = (out.uses[slot] ?? 0) + (u - (before.uses[slot] ?? 0)) / samples;
    });
    let g = (after.coins - before.coins) / 5 + 6 * (after.eps - before.eps);
    for (const p of after.perms) {
      if (before.perms.has(p)) continue;
      const bad = !!permDef(p)?.bad;
      g += bad ? -10 : 12;
      gets.add(`《${permDef(p)?.name ?? p}》`);
    }
    for (const b of after.builds) {
      if (before.builds.has(b)) continue;
      g += 25;
      gets.add(`《${allBuilds().find((x) => x.id === b)?.name ?? b}》`);
    }
    if (last) {
      out.outcomes[last] = (out.outcomes[last] ?? 0) + 1 / samples;
      g += OUTCOME_GAIN[last] ?? 0;
    }
    out.gain += (g - 40 * dead) / samples;
    for (const [src, n] of trace)
      if (sourceLabel(src)) out.fired.set(src, (out.fired.get(src) ?? 0) + n / samples);
  }
  out.gets = [...gets];
  return out;
}

// ─── 道 ───────────────────────────────────────────────────────

/** いまの位置から最後の相手までの、すべての道。 */
export function paths(w: World): number[][] {
  const out: number[][] = [];
  const walk = (n: MapNode, acc: number[]) => {
    const next = [...acc, n.id];
    if (!n.next.length || out.length > 8000) {
      out.push(next);
      return;
    }
    for (const id of n.next) {
      const m = nodeOf(w, id);
      if (m) walk(m, next);
    }
  };
  for (const n of reachable(w)) walk(n, []);
  return out;
}

interface Walk {
  path: number[];
  alive: number;
  gain: number;
  hpEnd: number;
  fired: Map<string, number>;
  short: Set<number>;
  thin: Set<number>;
  /** 枠ごとに、この道で使う回数。 */
  spent: number[];
}

function walkPath(w: World, path: number[], probes: Map<number, Probe>): Walk {
  const max = maxHp(stats(w, 'you'));
  let hp = w.you.hp;
  let alive = 1;
  let gain = 0;
  const fired = new Map<string, number>();
  const uses = w.you.cards.map((c) => c?.uses ?? 0);
  const short = new Set<number>();
  const thin = new Set<number>();
  const spent = w.you.cards.map(() => 0);
  const caps = w.you.cards.map((c) => c?.max ?? 0);
  for (const id of path) {
    const p = probes.get(id);
    const node = nodeOf(w, id);
    if (!p || !node) continue;
    // 最後の相手は別勘定（いまの体のまま試しても、着くころには別人になっている）。
    if (node.kind === 'boss') continue;
    if (node.kind === 'rest') {
      // 食堂は、着いたときの傷み具合で効く（試行はいまの体で測るので、ここで足す）。
      hp = Math.min(max, hp + PACE.rest * max);
      uses.forEach((u, slot) => {
        uses[slot] = Math.min(caps[slot] ?? 0, u + 1);
      });
      gain += p.gain;
      continue;
    }
    alive *= 1 - p.dead;
    hp = Math.min(max, hp + p.hp);
    if (hp <= 0) {
      // 持ち越した傷で倒れる見込み。
      alive *= 0.35;
      hp = 1;
    }
    gain += p.gain;
    p.uses.forEach((d, slot) => {
      spent[slot] = (spent[slot] ?? 0) + Math.max(0, -d);
      const u = (uses[slot] ?? 0) + d;
      if (u < 0) short.add(slot);
      else if (u < 1) thin.add(slot);
      uses[slot] = Math.max(0, u);
    });
    for (const [src, n] of p.fired) fired.set(src, (fired.get(src) ?? 0) + n);
  }
  return { path, alive, gain, hpEnd: hp / max, fired, short, thin, spent };
}

const linkCount = (x: Walk) => [...x.fired.values()].filter((n) => n >= 0.5).length;

function score(kind: RouteKind, x: Walk): number {
  const links = linkCount(x);
  switch (kind) {
    case 'chain':
      return links * 14 + x.gain * 0.6 + x.alive * 25;
    case 'safe':
      return x.alive * 220 + x.hpEnd * 50 + x.gain * 0.15 - links * 3;
  }
}

/** 道どうしの重なりの引き算（一歩目が同じ・通る場所の割合）。点の大きさは score に合わせる。 */
const OVERLAP = { first: 90, shared: 60 } as const;

// ─── 道ごとの方針 ─────────────────────────────────────────────

/**
 * 方針：二つの道は、行き先だけでなく、どの札に頼り、どのエピテットをどこへ
 * 付け替えるかまで違う。道を選び替えると、前に出る札と、勧める付け替えが
 * がらりと替わる（規則を一枚差し替えたように）。
 *
 *   安定    いちばん使うのに尽きない札に頼る。いちばん減る札へ、回数を増やす語を
 *   高連鎖  噛み合いの芯（規則をいちばん動かす札）に頼る。その札へ、強める語を
 */
function fireBySlot(x: Walk): number[] {
  const out: number[] = [];
  for (const [src, n] of x.fired) {
    const m = /^(?:card|ep):(\d+):/.exec(src);
    if (!m) continue;
    const slot = Number(m[1]);
    out[slot] = (out[slot] ?? 0) + n;
  }
  return out;
}

/** 道の性格を、値踏みの性格に。 */
const STYLE: Record<RouteKind, Style> = { safe: 'safe', chain: 'chain' };

function plan(w: World, kind: RouteKind, x: Walk): { lean: number[]; ink?: Ink; mark?: Mark } {
  const slots = w.you.cards.flatMap((c, slot) => (c ? [{ c, slot }] : []));
  const fire = fireBySlot(x);
  const by = (f: (slot: number) => number) =>
    [...slots].sort((a, b) => f(b.slot) - f(a.slot)).filter((s) => f(s.slot) > 0.05);
  const order =
    kind === 'chain'
      ? by((s) => (fire[s] ?? 0) + 0.1 * (x.spent[s] ?? 0))
      : by((s) => (x.short.has(s) ? 0 : (x.spent[s] ?? 0) + 0.2));
  const lean = order.slice(0, 3).map((s) => s.c.uid);
  const keep = new Set(lean);
  const slotOf = (uid: number) => slots.find((s) => s.c.uid === uid)?.slot;
  // 値踏みは inking に任せる。この道で使う回数と、規則を動かす重みを渡す。
  const sources = inkSources(w, keep);
  const style = STYLE[kind];
  const card = bestCardInk(w, style, sources, {
    wear: (c) => {
      const i = slotOf(c.uid);
      return i === undefined ? 0 : (x.spent[i] ?? 0) + (x.short.has(i) ? 3 : 0);
    },
    fire: (c) => {
      const i = slotOf(c.uid);
      return i === undefined ? 0 : Math.min(3, (fire[i] ?? 0) / 2);
    },
    targets: style === 'chain' ? lean : undefined,
  });
  const node = bestNodeInk(w, style, sources, x.path);
  return {
    lean,
    ink: card ? { ep: card.ep, to: card.to, from: card.from, why: card.why } : undefined,
    mark: node ? { ep: node.ep, node: node.node, from: node.from, why: node.why } : undefined,
  };
}

/**
 * 道を一本だけ、通し直す（その道の場所だけを試す。全部を読み直すより軽い）。
 * その場で何かを使ったら道の見込みがどう変わるかを、使う前に見せるのに使う。
 */
export function rewalk(w: World, path: readonly number[]): { alive: number; hpEnd: number } {
  const probes = new Map<number, Probe>();
  for (const id of path) {
    const p = probe(w, id, 1);
    if (p) probes.set(id, p);
  }
  const x = walkPath(w, [...path], probes);
  return { alive: x.alive, hpEnd: x.hpEnd };
}

/** いま cmd を使ったら、この道の見込みはどう変わるか（使う前・使った後）。 */
export function preview(
  w: World,
  cmd: Cmd,
  path: readonly number[],
): { before: { alive: number; hpEnd: number }; after: { alive: number; hpEnd: number } } | null {
  const s = branch(w);
  if (!decide(s, cmd, { sim: true }).length) return null;
  return { before: rewalk(w, path), after: rewalk(s, path) };
}

// ─── 三つの道 ─────────────────────────────────────────────────

export function advise(w: World, opts: { samples?: number } = {}): Advice | null {
  if (w.enc || w.pending || w.ending) return null;
  const all = paths(w);
  if (!all.length) return null;
  const ahead = [...new Set(all.flat())]
    .map((id) => nodeOf(w, id))
    .filter((n): n is MapNode => !!n);
  const probes = new Map<number, Probe>();
  const first = Math.min(...ahead.map((n) => n.row));
  for (const n of ahead) {
    const p = probe(w, n.id, n.row - first <= 2 ? (opts.samples ?? 2) : 1);
    if (p) probes.set(n.id, p);
  }
  const walks = all.map((p) => walkPath(w, p, probes));
  /**
   * 三つの道は、性格だけでなく歩く場所も違うほうがいい（同じ一歩目を三通りに
   * 言い換えても、選ぶ意味がない）。すでに選んだ道と一歩目が同じなら大きく、
   * 通る場所が重なるほど少しずつ引く。差し引いても他に道がなければ、同じ道でいい。
   */
  const best = (kind: RouteKind, list: Walk[], avoid: number[][] = []) => {
    const same = (a: number[], b: number[]) =>
      a.length === b.length && a.every((x, i) => x === b[i]);
    const overlap = (x: number[]) =>
      avoid.reduce((pen, a) => {
        const shared = x.filter((id) => a.includes(id)).length / Math.max(1, x.length);
        return pen + (x[0] === a[0] ? OVERLAP.first : 0) + OVERLAP.shared * shared;
      }, 0);
    let pick: Walk | undefined;
    let v = Number.NEGATIVE_INFINITY;
    for (const x of list) {
      if (avoid.some((a) => same(a, x.path))) continue;
      const s = score(kind, x) - overlap(x.path);
      if (s > v) {
        v = s;
        pick = x;
      }
    }
    return pick;
  };
  const steps = (x: Walk) =>
    x.path
      .map((id) => nodeOf(w, id))
      .filter((n): n is MapNode => !!n)
      .map(nodeLabel);
  const links = (x: Walk) =>
    [...x.fired.entries()]
      .filter(([, n]) => n >= 0.5)
      .sort((a, b) => b[1] - a[1])
      .map(([src]) => sourceLabel(src))
      .filter((s): s is string => !!s);
  const cardName = (slot: number) => {
    const c = w.you.cards[slot];
    return c ? `『${cardDef(c.id).name}』` : '';
  };
  const route = (
    kind: RouteKind,
    x: Walk,
    text: string,
    warn: string[],
    hint?: string,
    more: Pick<Route, 'gets'> = {},
  ): Route => ({
    kind,
    label: LABEL[kind],
    aim: kind === 'safe' ? 'win' : 'play',
    path: x.path,
    steps: steps(x),
    survive: x.alive,
    hpEnd: x.hpEnd,
    links: links(x),
    gain: Math.round(x.gain),
    text,
    warn,
    hint,
    wear: [...x.short, ...x.thin]
      .map((slot) => w.you.cards[slot]?.uid)
      .filter((u): u is number => u !== undefined),
    ...plan(w, kind, x),
    ...more,
  });

  const safe = best('safe', walks);
  const chain = best('chain', walks, safe ? [safe.path] : []) ?? safe;
  const out: Advice = { win: [], play: [], misses: misses(w) };

  if (safe) {
    const n = linkCount(safe);
    out.win.push(
      route(
        'safe',
        safe,
        `この道なら、ほぼ抜けられる（最後の相手の手前まで、見込み ${Math.round(safe.alive * 100)}%）。ただし得るものは少ない。噛み合う相互作用は ${n} 個。`,
        [],
      ),
    );
  }
  if (chain) {
    const l = links(chain);
    const fragile = [...chain.short].map(cardName).filter(Boolean);
    const thin = [...chain.thin]
      .filter((s) => !chain.short.has(s))
      .map(cardName)
      .filter(Boolean);
    const warn: string[] = [];
    if (fragile.length)
      warn.push(`${fragile.join('・')}の回数が途中で尽きる。読み違えると全部崩れる`);
    if (thin.length) warn.push(`${thin.join('・')}は残り 1 回を切る`);
    if (chain.alive < 0.7) warn.push(`倒れる見込み ${Math.round((1 - chain.alive) * 100)}%`);
    const gets = [...new Set(chain.path.flatMap((id) => probes.get(id)?.gets ?? []))].slice(0, 3);
    out.play.push(
      route(
        'chain',
        chain,
        `今の構成なら、この道で ${l.length} 個の相互作用が成立する：${l.slice(0, 5).join('×')}${l.length > 5 ? '…' : ''}。${gets.length ? `成功すれば ${gets.join('・')} まで繋がる。` : ''}ただし失敗したときの損失も大きい。`,
        warn,
        undefined,
        { gets },
      ),
    );
  }
  // 自分の脚では、道の読みが勧めない（推奨を切って、自分で選ぶ）。ここでは何も足さない。
  return out;
}
