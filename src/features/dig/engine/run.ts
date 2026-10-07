import { autoPlay } from './ai';
import type { ActiveDef, CardCat, RunLike, Trigger } from './defs';
import { createEncounter, type EncounterSetup } from './enc';
import { ORIGINS, originOf } from './origins';
import {
  activeDef,
  allActives,
  allCombos,
  allEvents,
  allItems,
  eventDef,
  itemDef,
  npcDef,
  permDef,
} from './registry';
import { int, next, pick, type Rng, rng, shuffle } from './rng';
import { addXp, effectiveStats, maxHp, maxMind } from './stats';
import {
  type ActiveCard,
  type Character,
  type Encounter,
  type Outcome,
  STATS,
  type Stat,
  zeroStats,
} from './types';

/**
 * 挑戦（ラン）。三つの層を一夜ずつ下りる。
 *
 *   地図   層ごとに 6 段 + 主。1 段進むたびに 1 時間。22 時に始まり、6 時に
 *          夜が明ける。遅いほど相手は荒れる
 *   一服   いつでも。全カード +1（逃走の系統は戻らない）。1 時間かかる
 *   食堂   休む / 完全休養 / 整える（判定）/ 破棄 のどれか一つと、変質
 *   古物商 カードと品を買う。記憶を売る。能力値を差し出す
 *   ライバル もう一人の掘る人が、同じ規則で同じ地図を下りていく。先に寄った
 *          場所は荒らされ、同じ段に並ぶと鉢合わせる
 *
 * カードの循環: 使う → 枯れる（SPENT）→ 回復（休ませる・品・判定・破棄・
 * 頼る・記憶・自分の条件）か、酷使か、変質。使い方で最大回数も動き、記憶が
 * 増える。そうして主人公が変わっていく。
 */

export type NodeKind = 'person' | 'danger' | 'event' | 'rest' | 'shop' | 'boss';

export interface MapNode {
  id: number;
  row: number;
  col: number;
  kind: NodeKind;
  npc?: string;
  next: number[];
  visited: boolean;
  /** もう一人の掘る人が先に寄って、どう決着したか。 */
  rival?: Outcome | 'passed';
}

export interface RivalState {
  you: Character;
  stratum: number;
  row: number;
  node: number | null;
  /** 最後に会ったときの決着。 */
  met: Outcome | null;
  metStratum: number;
  log: string[];
  /** 最下層に先に着いた。 */
  first: boolean;
  down: boolean;
}

export type Pending =
  | { kind: 'encounter'; npc: string; tier: Encounter['tier']; rival?: boolean; resume?: number }
  | { kind: 'event'; id: string }
  | { kind: 'rest'; used: boolean; altered: boolean }
  | { kind: 'shop'; cards: string[]; items: string[]; sold: string[] }
  | {
      kind: 'reward';
      npc: string;
      outcome: Outcome;
      take: string[];
      help: boolean;
      notes: string[];
      boss: boolean;
      resume?: number;
    }
  | { kind: 'ending' };

export interface Ending {
  kind: 'dead' | Outcome;
  title: string;
  text: string;
  score: number;
  won: boolean;
}

export interface Run {
  version: 1;
  seed: number;
  rng: Rng;
  depth: number;
  stratum: number;
  hour: number;
  map: MapNode[];
  pos: number | null;
  you: Character;
  rival: RivalState;
  pending: Pending | null;
  journal: string[];
  unlocked: string[];
  seen: string[];
  /** 人物ごとの、前の決着（同じ人物に二度会ったとき）。 */
  npcMet: Record<string, Outcome>;
  stats: {
    encounters: number;
    outcomes: Partial<Record<Outcome, number>>;
    alters: number;
    grown: number;
    rests: number;
  };
  skipEvent: boolean;
  ending: Ending | null;
  /** 画面に知らせたいこと（成長・変質・記憶・組み合わせ）。読んだら空にする。 */
  news: string[];
}

export const STRATUM_NAME = ['', '夜の街', '記録層', '琥珀層'];
export const ROWS = 6;
export const DAWN = 8;

const STRATUM_NPCS: Record<number, { person: string[]; danger: string[]; boss: string }> = {
  1: {
    person: ['watchman', 'counterman', 'regular'],
    danger: ['stray-dog'],
    boss: 'last-customer',
  },
  2: {
    person: ['archivist', 'ghost', 'usher'],
    danger: ['silverfish', 'censor'],
    boss: 'projector',
  },
  3: { person: ['mother', 'geologist'], danger: ['drone', 'insect', 'hound'], boss: 'volume' },
};

/** 何時か（22 時起点の時間から）。 */
export function clock(hour: number): string {
  const h = Math.floor(22 + hour) % 24;
  const m = Math.round((hour % 1) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ─── 人物を作る ───────────────────────────────────────────────

export function makeCard(ch: Character, id: string): ActiveCard {
  const def = activeDef(id);
  return { uid: ch.uid++, id, uses: def.uses, maxUses: def.uses, marks: {} };
}

export function makeCharacter(origin: string, name: string, carry?: string): Character {
  const o = originOf(origin);
  const ch: Character = {
    name,
    origin: o.id,
    innate: { ...o.innate },
    growth: zeroStats(),
    xp: zeroStats(),
    hp: 0,
    mind: 0,
    coins: 30,
    items: ['bandage'],
    actives: [],
    permanents: [...o.perms],
    rumor: { fear: 0, kind: 0, nosy: 0 },
    debts: {},
    flags: {},
    uid: 1,
  };
  ch.actives = o.cards.map((id) => makeCard(ch, id));
  if (carry && permDef(carry) && !ch.permanents.includes(carry)) ch.permanents.push(carry);
  const s = statsOf(ch);
  ch.hp = maxHp(s);
  ch.mind = maxMind(s);
  return ch;
}

export const statsOf = (ch: Character) => effectiveStats(ch, permDef);

// ─── 地図 ─────────────────────────────────────────────────────

function buildMap(r: Run): MapNode[] {
  const pool = STRATUM_NPCS[r.stratum] ?? STRATUM_NPCS[1];
  if (!pool) return [];
  const nodes: MapNode[] = [];
  const rows: MapNode[][] = [];
  let id = 0;
  for (let row = 0; row < ROWS; row++) {
    const width = row === 0 ? 2 : int(r.rng, 2, 3);
    const list: MapNode[] = [];
    for (let col = 0; col < width; col++) {
      let kind: NodeKind;
      if (row === 0) kind = 'person';
      else if (row === 3 && col === 0) kind = 'rest';
      else if (row === ROWS - 1) kind = col === 0 ? 'rest' : col === 1 ? 'shop' : 'person';
      else {
        const roll = next(r.rng);
        kind =
          roll < 0.38
            ? 'person'
            : roll < 0.58
              ? 'event'
              : roll < 0.76 && row >= 2
                ? 'danger'
                : roll < 0.86
                  ? 'shop'
                  : 'event';
      }
      const node: MapNode = { id: id++, row, col, kind, next: [], visited: false };
      if (kind === 'person') node.npc = pick(r.rng, pool.person);
      if (kind === 'danger') node.npc = pick(r.rng, pool.danger);
      list.push(node);
      nodes.push(node);
    }
    rows.push(list);
  }
  const boss: MapNode = {
    id: id++,
    row: ROWS,
    col: 0,
    kind: 'boss',
    npc: pool.boss,
    next: [],
    visited: false,
  };
  nodes.push(boss);
  // 隣の列へだけ繋ぐ。どの点にも、入る道と出る道がある。
  for (let row = 0; row < ROWS; row++) {
    const here = rows[row] ?? [];
    const there = rows[row + 1];
    for (const n of here) {
      if (!there) {
        n.next = [boss.id];
        continue;
      }
      const span = (c: number) =>
        (c / Math.max(1, here.length - 1)) * Math.max(1, there.length - 1);
      const target = Math.round(span(n.col));
      n.next = there
        .filter(
          (m) =>
            Math.abs(m.col - target) <= 1 && (Math.abs(m.col - target) === 0 || next(r.rng) < 0.6),
        )
        .map((m) => m.id);
      if (n.next.length === 0) n.next = [there[Math.min(there.length - 1, target)]?.id ?? 0];
    }
    if (there) {
      for (const m of there) {
        if (!here.some((n) => n.next.includes(m.id))) {
          const from =
            here[
              Math.min(
                here.length - 1,
                Math.round((m.col / Math.max(1, there.length - 1)) * (here.length - 1)),
              )
            ];
          from?.next.push(m.id);
        }
      }
    }
  }
  return nodes;
}

export const nodeOf = (r: Run, id: number | null) =>
  id === null ? undefined : r.map.find((n) => n.id === id);

export function reachable(r: Run): MapNode[] {
  if (r.pending) return [];
  const here = nodeOf(r, r.pos);
  if (!here) return r.map.filter((n) => n.row === 0);
  return here.next.map((id) => nodeOf(r, id)).filter((n): n is MapNode => !!n);
}

// ─── 始める ───────────────────────────────────────────────────

export interface RunSetup {
  seed: number;
  origin: string;
  depth: number;
  carry?: string;
  /** 前の挑戦の噂（街が覚えている）。 */
  remembered?: Record<string, Outcome>;
}

export function newRun(s: RunSetup): Run {
  const r = rng(s.seed);
  const you = makeCharacter(s.origin, 'あなた', s.carry);
  if (s.depth >= 5) you.permanents.push('fear');
  const others = ORIGINS.filter((o) => o.id !== s.origin);
  const ro = others[Math.floor(next(r) * others.length)] ?? ORIGINS[0];
  const rivalYou = makeCharacter(ro?.id ?? 'watch', `${ro?.name ?? ''}の掘る人`);
  const run: Run = {
    version: 1,
    seed: s.seed,
    rng: r,
    depth: s.depth,
    stratum: 1,
    hour: 0,
    map: [],
    pos: null,
    you,
    rival: {
      you: rivalYou,
      stratum: 1,
      row: -1,
      node: null,
      met: null,
      metStratum: 0,
      log: [],
      first: false,
      down: false,
    },
    pending: null,
    journal: [],
    unlocked: [],
    seen: [],
    npcMet: { ...(s.remembered ?? {}) },
    stats: { encounters: 0, outcomes: {}, alters: 0, grown: 0, rests: 0 },
    skipEvent: false,
    ending: null,
    news: [],
  };
  run.map = buildMap(run);
  note(
    run,
    `22:00。${STRATUM_NAME[1]}。もう一人の掘る人（${rivalYou.name}）も、同じ縦坑を下りはじめた。`,
  );
  return run;
}

function note(r: Run, text: string): void {
  r.journal.push(text);
  if (r.journal.length > 60) r.journal.shift();
}

function news(r: Run, text: string): void {
  r.news.push(text);
  note(r, text);
}

// ─── カードの循環 ─────────────────────────────────────────────

function refill(card: ActiveCard, n: number): number {
  const before = card.uses;
  card.uses = Math.min(card.maxUses, card.uses + n);
  return card.uses - before;
}

/** 休ませて戻す（手入れとして数える）。逃走の系統は食堂でしか戻らない。 */
function restCard(card: ActiveCard, n: number, safe: boolean): void {
  const def = activeDef(card.id);
  if (def.recover.restOnly && !safe) return;
  if (refill(card, n) > 0) card.marks.rested = (card.marks.rested ?? 0) + 1;
}

/** 使い方で、最大回数が動く。 */
function shift(r: Run, ch: Character, card: ActiveCard, quiet = false): void {
  const def = activeDef(card.id);
  const sh = def.shift;
  if (!sh) return;
  const count = Math.floor((card.marks[sh.on] ?? 0) / sh.every);
  const done = card.marks.shifted ?? 0;
  if (count <= done || card.maxUses >= sh.cap) return;
  const add = Math.min(count - done, sh.cap - card.maxUses);
  card.maxUses += add;
  card.marks.shifted = count;
  if (!quiet) news(r, `《${def.name}》の最大回数が ${card.maxUses} になった。`);
  if (sh.perm) grantTo(r, ch, sh.perm, quiet);
}

function transform(r: Run, ch: Character, slot: number, to: string, quiet = false): void {
  const old = ch.actives[slot];
  if (!old) return;
  const from = activeDef(old.id).name;
  const def = activeDef(to);
  ch.actives[slot] = { uid: ch.uid++, id: to, uses: def.uses, maxUses: def.uses, marks: {} };
  if (!quiet) {
    r.stats.alters++;
    news(r, `《${from}》が《${def.name}》へ変質した。`);
  }
}

/** 酷使の果ての変質は、遭遇のあとすぐに起きる。 */
function overuse(r: Run, ch: Character, quiet = false): void {
  ch.actives.forEach((card, slot) => {
    if (!card) return;
    const o = activeDef(card.id).alter?.overuse;
    if (o && (card.marks.spent ?? 0) >= o.need) transform(r, ch, slot, o.to, quiet);
  });
}

export interface AlterOption {
  to: string;
  kind: 'care' | 'overuse' | 'secret';
  ready: boolean;
  need: string;
}

/** このカードが変質できる先（食堂で選ぶ）。 */
export function alterOptions(ch: Character, slot: number): AlterOption[] {
  const card = ch.actives[slot];
  if (!card) return [];
  const a = activeDef(card.id).alter;
  if (!a) return [];
  const out: AlterOption[] = [];
  if (a.care) {
    const n = card.marks.rested ?? 0;
    out.push({
      to: a.care.to,
      kind: 'care',
      ready: n >= a.care.need,
      need: `休ませて回復 ${n}/${a.care.need}`,
    });
  }
  if (a.overuse) {
    const n = card.marks.spent ?? 0;
    out.push({
      to: a.overuse.to,
      kind: 'overuse',
      ready: n >= a.overuse.need,
      need: `0 回のまま使う ${n}/${a.overuse.need}`,
    });
  }
  if (a.secret) {
    const have = a.secret.perms.filter((p) => ch.permanents.includes(p)).length;
    out.push({
      to: a.secret.to,
      kind: 'secret',
      ready: have === a.secret.perms.length,
      need: a.secret.perms.map((p) => `《${permDef(p)?.name ?? p}》`).join(' + '),
    });
  }
  return out;
}

function triggerCards(ch: Character, on: readonly Trigger[]): void {
  for (const card of ch.actives) {
    if (!card) continue;
    const rec = activeDef(card.id).recover;
    if (rec.on.some((t) => on.includes(t))) refill(card, 1);
  }
}

// ─── 記憶 ─────────────────────────────────────────────────────

function grantTo(r: Run, ch: Character, id: string, quiet = false): void {
  if (ch.permanents.includes(id) || !permDef(id)) return;
  ch.permanents.push(id);
  if (!quiet) news(r, `《${permDef(id)?.name}》を得た。`);
  combos(r, ch, quiet);
  clampVitals(ch);
}

function removeFrom(ch: Character, id: string): void {
  ch.permanents = ch.permanents.filter((p) => p !== id);
  clampVitals(ch);
}

function clampVitals(ch: Character): void {
  const s = statsOf(ch);
  ch.hp = Math.min(ch.hp, maxHp(s));
  ch.mind = Math.min(ch.mind, maxMind(s));
}

function combos(r: Run, ch: Character, quiet: boolean): void {
  for (const c of allCombos()) {
    const key = `combo:${c.id}`;
    if (ch.flags[key]) continue;
    if (!c.needs.every((p) => ch.permanents.includes(p))) continue;
    ch.flags[key] = 1;
    if (!quiet) news(r, `記憶が繋がった ── ${c.name}。${c.text}`);
    if (c.grant) grantTo(r, ch, c.grant, quiet);
    if (c.event && ch === r.you) r.unlocked.push(c.event);
  }
}

// ─── 進む ─────────────────────────────────────────────────────

function passTime(r: Run, hours: number): void {
  r.hour += hours;
  for (let i = 0; i < hours; i++) rivalStep(r);
}

export function moveTo(r: Run, id: number): boolean {
  if (r.pending || r.ending) return false;
  const node = reachable(r).find((n) => n.id === id);
  if (!node) return false;
  r.pos = node.id;
  node.visited = true;
  passTime(r, 1);
  triggerCards(r.you, ['newPlace']);
  // 同じ段に並べば、鉢合わせる（層ごとに一度）。
  const rv = r.rival;
  if (
    !rv.down &&
    rv.stratum === r.stratum &&
    rv.row === node.row &&
    rv.metStratum !== r.stratum &&
    node.kind !== 'boss'
  ) {
    rv.metStratum = r.stratum;
    r.pending = { kind: 'encounter', npc: 'rival', tier: 'rival', rival: true, resume: node.id };
    note(r, `${rv.you.name}と鉢合わせた。`);
    return true;
  }
  enter(r, node);
  return true;
}

function enter(r: Run, node: MapNode): void {
  switch (node.kind) {
    case 'person':
    case 'danger':
    case 'boss':
      r.pending = {
        kind: 'encounter',
        npc: node.npc ?? 'watchman',
        tier: node.kind === 'person' ? 'normal' : node.kind,
      };
      break;
    case 'event': {
      if (r.skipEvent) {
        r.skipEvent = false;
        note(r, '眠っているあいだに、そこには誰もいなくなっていた。');
        break;
      }
      const id = pickEvent(r);
      if (id) r.pending = { kind: 'event', id };
      break;
    }
    case 'rest':
      r.pending = { kind: 'rest', used: false, altered: false };
      break;
    case 'shop':
      r.pending = shopStock(r);
      break;
  }
}

function pickEvent(r: Run): string | null {
  if (Object.values(r.you.debts).some((n) => n > 0) && next(r.rng) < 0.35) return 'favor-due';
  const open = r.unlocked.find(
    (id) => !r.seen.includes(id) && eventDef(id)?.strata.includes(r.stratum),
  );
  if (open) return open;
  const pool = allEvents().filter(
    (e) => !e.locked && e.strata.includes(r.stratum) && !r.seen.includes(e.id),
  );
  return (
    pick(r.rng, pool)?.id ??
    pick(
      r.rng,
      allEvents().filter((e) => !e.locked),
    )?.id ??
    null
  );
}

/** 一服。全カード +1（逃走の系統は戻らない）。1 時間。 */
export function shortRest(r: Run): void {
  if (r.pending || r.ending) return;
  for (const card of r.you.actives)
    if (card) restCard(card, 1 + (r.you.permanents.includes('insomnia') ? 1 : 0), false);
  for (const card of r.you.actives) if (card) shift(r, r.you, card);
  r.stats.rests++;
  passTime(r, 1);
  note(r, `一服した。${clock(r.hour)}。`);
}

// ─── 遭遇 ─────────────────────────────────────────────────────

export function encounterSetup(r: Run): EncounterSetup | null {
  const p = r.pending;
  if (p?.kind !== 'encounter') return null;
  const node = nodeOf(r, r.pos);
  const late = r.hour >= DAWN ? r.hour - DAWN + 1 : 0;
  const setup: EncounterSetup = {
    seed: (r.seed ^ Math.imul(r.stats.encounters + 1, 0x9e3779b1)) >>> 0,
    you: r.you,
    stats: statsOf(r.you),
    npc: p.npc,
    tier: p.tier,
    depth: r.depth + late,
    stratum: r.stratum,
    hour: r.hour,
    met: p.rival ? (r.rival.met ?? undefined) : r.npcMet[p.npc],
  };
  if (p.rival) {
    const rv = r.rival.you;
    setup.rival = { name: rv.name, stats: statsOf(rv), perms: rv.permanents, hp: rv.hp };
  }
  if (node?.rival && node.rival !== 'passed' && !p.rival) setup.after = node.rival;
  return setup;
}

export function startEncounter(r: Run): Encounter | null {
  const s = encounterSetup(r);
  return s ? createEncounter(s) : null;
}

/** 遭遇の結果を人物へ写す（あなたにも、ライバルにも同じ規則で）。 */
function absorb(r: Run, ch: Character, e: Encounter, quiet: boolean): string[] {
  const notes: string[] = [];
  ch.hp = Math.max(0, e.you.hp);
  ch.mind = Math.max(0, e.you.mind);
  ch.coins = e.you.coins;
  ch.items = [...e.you.items];
  ch.actives = e.cards.map((c) => (c ? { ...c, marks: { ...c.marks } } : null));
  for (const id of e.gained) grantTo(r, ch, id, quiet);
  const grew = addXp(ch, e.xp);
  for (const s of grew) {
    if (!quiet) {
      r.stats.grown++;
      news(r, `${s} が成長した（成長値 ${ch.growth[s]}）。`);
    }
  }
  const o = e.outcome;
  const on: Trigger[] = [];
  if (o === 'beaten') on.push('win');
  if (o === 'broken') on.push('broken', 'win');
  if (o === 'trusted') on.push('trusted');
  if (o === 'uncovered') on.push('uncover');
  if (o === 'left' && e.npc.hostility < 7) on.push('left');
  if (e.log.lies > 0 && e.log.liesCaught === 0) on.push('lieKept');
  if (e.log.cards === 0 && o !== 'fallen' && o !== 'shattered') on.push('quiet');
  triggerCards(ch, on);
  for (const card of ch.actives) if (card) shift(r, ch, card, quiet);
  overuse(r, ch, quiet);
  if (o === 'beaten' || o === 'broken') ch.rumor.fear++;
  if (o === 'trusted') ch.rumor.kind++;
  if (o === 'uncovered' || e.log.liesCaught > 0) ch.rumor.nosy++;
  const def = npcDef(e.npc.id);
  const reward = o ? def.rewards[o] : undefined;
  if (reward?.coins) {
    ch.coins += reward.coins;
    notes.push(`金 ${reward.coins}`);
  }
  if (reward?.item) {
    ch.items.push(reward.item);
    notes.push(itemDef(reward.item)?.name ?? reward.item);
  }
  if (reward?.perm) grantTo(r, ch, reward.perm, quiet);
  clampVitals(ch);
  return notes;
}

export function finishEncounter(r: Run, e: Encounter): void {
  const p = r.pending;
  if (p?.kind !== 'encounter' || !e.outcome) return;
  r.stats.encounters++;
  r.stats.outcomes[e.outcome] = (r.stats.outcomes[e.outcome] ?? 0) + 1;
  const node = nodeOf(r, r.pos);
  // ライバルが先に打ち解けていたら、贈り物はもう渡ったあと。
  if (node?.rival === 'trusted' && e.outcome === 'trusted') {
    const reward = npcDef(e.npc.id).rewards.trusted;
    if (reward) e.gained = e.gained.filter((g) => g !== reward.perm);
  }
  const notes = absorb(r, r.you, e, false);
  if (p.rival) r.rival.met = e.outcome;
  else r.npcMet[e.npc.id] = e.outcome;
  if (e.outcome === 'fallen' || e.outcome === 'shattered') {
    end(r, 'dead', e.outcome === 'fallen' ? '倒れた' : '心が崩れた');
    return;
  }
  const def = npcDef(e.npc.id);
  const takeFrom = p.rival ? e.npc.clues.map((c) => c.id) : def.take;
  const take =
    e.outcome === 'uncovered'
      ? takeFrom.filter(
          (id) =>
            e.npc.clues.some((c) => c.id === id && c.shown && !c.false) &&
            !r.you.permanents.includes(id),
        )
      : [];
  const help = e.outcome === 'trusted' && !!(p.rival ? true : def.rewards.trusted?.help);
  r.pending = {
    kind: 'reward',
    npc: e.npc.id,
    outcome: e.outcome,
    take,
    help,
    notes,
    boss: p.tier === 'boss',
    resume: p.resume,
  };
}

/** 決着の褒美を受け取る。take は持ち帰る記憶、help は頼って回復させるカードの枠。 */
export function claimReward(r: Run, choice: { take?: string; help?: number } = {}): void {
  const p = r.pending;
  if (p?.kind !== 'reward') return;
  if (choice.take && p.take.includes(choice.take)) grantTo(r, r.you, choice.take);
  if (choice.help !== undefined && p.help) {
    const card = r.you.actives[choice.help];
    if (card) {
      card.uses = card.maxUses;
      r.you.debts[p.npc] = (r.you.debts[p.npc] ?? 0) + 1;
      news(
        r,
        `${npcDef(p.npc).name}に頼って《${activeDef(card.id).name}》を回復させた。借りができた。`,
      );
    }
  }
  r.pending = null;
  if (p.boss) {
    if (r.stratum >= 3) {
      finale(r, p.outcome);
      return;
    }
    descend(r);
    return;
  }
  if (p.resume !== undefined) {
    const node = nodeOf(r, p.resume);
    if (node) enter(r, node);
  }
}

function descend(r: Run): void {
  r.stratum++;
  r.hour = r.you.permanents.includes('shaft-key') ? -1 : 0;
  r.pos = null;
  r.map = buildMap(r);
  for (const card of r.you.actives) if (card) refill(card, 1);
  if (r.you.permanents.includes('habit-observe')) {
    for (const card of r.you.actives)
      if (card && activeDef(card.id).cat === 'look') refill(card, 1);
  }
  const rv = r.rival;
  if (rv.stratum < r.stratum) {
    rv.stratum = r.stratum;
    rv.row = -2;
    rv.node = null;
  }
  note(r, `${STRATUM_NAME[r.stratum]}へ下りた。また 22 時から、夜が始まる。`);
}

// ─── 食堂 ─────────────────────────────────────────────────────

export type RestAction = 'rest' | 'full' | 'tune-int' | 'tune-wil' | 'discard';

export function restChance(r: Run, kind: 'tune-int' | 'tune-wil'): number {
  const s = statsOf(r.you);
  const v = kind === 'tune-int' ? s.INT : s.WIL;
  return Math.max(5, Math.min(95, 25 + 8 * v));
}

export function restAction(r: Run, a: RestAction, slot?: number): string {
  const p = r.pending;
  if (p?.kind !== 'rest' || p.used) return '';
  const ch = r.you;
  const s = statsOf(ch);
  const heal = (frac: number) => {
    const bonus = ch.permanents.includes('regular-seat') ? 10 : 0;
    const k = r.depth >= 3 ? 0.8 : 1;
    ch.hp = Math.min(maxHp(s), ch.hp + Math.round(maxHp(s) * frac * k) + bonus);
    ch.mind = Math.min(maxMind(s), ch.mind + Math.round(maxMind(s) * frac * k) + bonus);
  };
  let text = '';
  switch (a) {
    case 'rest':
      heal(0.4);
      for (const card of ch.actives)
        if (card) restCard(card, 1 + (ch.permanents.includes('insomnia') ? 1 : 0), true);
      passTime(r, 1);
      text = '休んだ。体と心が少し戻り、すべてのカードが 1 回ずつ戻った。';
      break;
    case 'full': {
      const card = slot !== undefined ? ch.actives[slot] : null;
      if (!card) return '';
      heal(0.6);
      card.uses = card.maxUses;
      card.marks.rested = (card.marks.rested ?? 0) + 2;
      passTime(r, 2);
      r.skipEvent = true;
      text = `ぐっすり眠った。《${activeDef(card.id).name}》が最大まで戻った。次の出来事は、逃すことになる。`;
      break;
    }
    case 'tune-int':
    case 'tune-wil': {
      const cats: CardCat[] = a === 'tune-int' ? ['look', 'talk'] : ['mind', 'force'];
      const ok = next(r.rng) * 100 < restChance(r, a);
      if (ok) {
        for (const card of ch.actives)
          if (card && cats.includes(activeDef(card.id).cat)) restCard(card, 2, true);
        addXp(ch, { ...zeroStats(), [a === 'tune-int' ? 'INT' : 'WIL']: 2 });
        text =
          a === 'tune-int'
            ? '手帳を整理した。調べ・話すカードが 2 回ずつ戻った。'
            : '呼吸を整えた。心と力のカードが 2 回ずつ戻った。';
      } else {
        ch.mind = Math.max(1, ch.mind - 3);
        text = 'うまくいかなかった。精神 −3。';
      }
      passTime(r, 1);
      break;
    }
    case 'discard': {
      if (slot === undefined || !ch.actives[slot]) return '';
      const name = activeDef(ch.actives[slot]?.id ?? '').name;
      ch.actives[slot] = null;
      for (const card of ch.actives) if (card) card.uses = card.maxUses;
      text = `《${name}》を手放した。ほかのカードがすべて戻った。`;
      break;
    }
  }
  for (const card of ch.actives) if (card) shift(r, ch, card);
  p.used = true;
  r.stats.rests++;
  note(r, text);
  return text;
}

export function restAlter(r: Run, slot: number, to: string): boolean {
  const p = r.pending;
  if (p?.kind !== 'rest' || p.altered) return false;
  const opt = alterOptions(r.you, slot).find((o) => o.to === to && o.ready);
  if (!opt) return false;
  transform(r, r.you, slot, to);
  p.altered = true;
  return true;
}

// ─── 古物商 ───────────────────────────────────────────────────

function shopStock(r: Run): Pending {
  const have = new Set(r.you.actives.map((c) => c?.id));
  const base = allActives().filter((d) => d.tier === 0 && !have.has(d.id));
  const cards = shuffle(r.rng, [...base])
    .slice(0, 3)
    .map((d) => d.id);
  const items = shuffle(
    r.rng,
    allItems().map((i) => i.id),
  ).slice(0, 3);
  const node = nodeOf(r, r.pos);
  if (node?.rival) cards.pop();
  return { kind: 'shop', cards, items, sold: [] };
}

export function priceOf(r: Run, base: number): number {
  let p = base * (1 + 0.1 * r.depth);
  if (r.you.permanents.includes('membership')) p *= 0.75;
  return Math.round(p);
}

export const cardPrice = (r: Run, def: ActiveDef) => priceOf(r, 45 + def.uses * 3);

export function buyCard(r: Run, id: string, slot: number): boolean {
  const p = r.pending;
  if (p?.kind !== 'shop' || !p.cards.includes(id) || p.sold.includes(id)) return false;
  const price = cardPrice(r, activeDef(id));
  if (r.you.coins < price || slot < 0 || slot > 4) return false;
  r.you.coins -= price;
  r.you.actives[slot] = makeCard(r.you, id);
  p.sold.push(id);
  note(r, `《${activeDef(id).name}》を買った。`);
  return true;
}

export function buyItem(r: Run, id: string): boolean {
  const p = r.pending;
  if (p?.kind !== 'shop' || !p.items.includes(id) || p.sold.includes(id)) return false;
  const price = priceOf(r, itemDef(id)?.price ?? 99);
  if (r.you.coins < price) return false;
  r.you.coins -= price;
  r.you.items.push(id);
  p.sold.push(id);
  return true;
}

/** 記憶を売る。効き目も組み合わせも消える。 */
export function sellPerm(r: Run, id: string): boolean {
  const p = r.pending;
  const v = permDef(id)?.value ?? 0;
  if (p?.kind !== 'shop' || v <= 0 || !r.you.permanents.includes(id)) return false;
  removeFrom(r.you, id);
  r.you.coins += v;
  if (id === 'promise') r.you.flags.soldPromise = 1;
  news(r, `《${permDef(id)?.name}》を売った（金 ${v}）。もう、その記憶はない。`);
  return true;
}

/** 悪い記憶を消してもらう（高い）。 */
export const curePrice = (r: Run) => priceOf(r, 70);

export function cure(r: Run, id: string): boolean {
  const p = r.pending;
  if (p?.kind !== 'shop' || !permDef(id)?.tags?.includes('bad') || !r.you.permanents.includes(id))
    return false;
  const price = curePrice(r);
  if (r.you.coins < price) return false;
  r.you.coins -= price;
  removeFrom(r.you, id);
  news(r, `《${permDef(id)?.name}》を忘れた。`);
  return true;
}

/** 能力値を差し出して、カードの最大回数を買う。 */
export function sacrifice(r: Run, s: Stat, slot: number): boolean {
  const p = r.pending;
  const card = r.you.actives[slot];
  if (p?.kind !== 'shop' || !card) return false;
  const total = r.you.innate[s] + r.you.growth[s];
  if (total <= 1) return false;
  if (r.you.growth[s] > 0) r.you.growth[s]--;
  else r.you.innate[s]--;
  card.maxUses += 1;
  card.uses = card.maxUses;
  clampVitals(r.you);
  news(
    r,
    `${s} を 1 差し出し、《${activeDef(card.id).name}》の最大回数が ${card.maxUses} になった。`,
  );
  return true;
}

export function leave(r: Run): void {
  const p = r.pending;
  if (p?.kind === 'shop' || p?.kind === 'rest') r.pending = null;
}

// ─── 品 ───────────────────────────────────────────────────────

export function useItem(r: Run, index: number): boolean {
  const id = r.you.items[index];
  const def = id ? itemDef(id) : undefined;
  if (!def || r.ending) return false;
  r.you.items.splice(index, 1);
  const s = statsOf(r.you);
  if (def.heal?.hp) r.you.hp = Math.min(maxHp(s), r.you.hp + def.heal.hp);
  if (def.heal?.mind) r.you.mind = Math.min(maxMind(s), r.you.mind + def.heal.mind);
  if (def.refill) {
    for (const card of r.you.actives) {
      if (card && def.refill.cats.includes(activeDef(card.id).cat)) refill(card, def.refill.n);
    }
  }
  note(r, `${def.name}を使った。`);
  return true;
}

// ─── 出来事 ───────────────────────────────────────────────────

export function eventChance(r: Run, stat: Stat, diff: number): number {
  return Math.max(5, Math.min(95, 25 + 8 * statsOf(r.you)[stat] - diff));
}

function runLike(r: Run): RunLike {
  const ch = r.you;
  return {
    you: ch,
    hour: r.hour,
    stratum: r.stratum,
    rngNext: () => next(r.rng),
    has: (p) => ch.permanents.includes(p),
    grant: (p) => grantTo(r, ch, p),
    remove: (p) => removeFrom(ch, p),
    heal: (hp, mind = 0) => {
      const s = statsOf(ch);
      ch.hp = Math.max(1, Math.min(maxHp(s), ch.hp + hp));
      ch.mind = Math.max(1, Math.min(maxMind(s), ch.mind + mind));
    },
    coins: (n) => {
      ch.coins = Math.max(0, ch.coins + n);
    },
    item: (id) => {
      ch.items.push(id);
    },
    refill: (n, cats) => {
      for (const card of ch.actives)
        if (card && (!cats || cats.includes(activeDef(card.id).cat))) refill(card, n);
    },
    xp: (s, n) => {
      const grew = addXp(ch, { ...zeroStats(), [s]: n });
      for (const g of grew) news(r, `${g} が成長した（成長値 ${ch.growth[g]}）。`);
    },
    time: (h) => passTime(r, h),
    flag: (k, v = 1) => {
      if (k === 'clear-debt') {
        const owed = Object.keys(ch.debts).find((id) => (ch.debts[id] ?? 0) > 0);
        if (owed) ch.debts[owed] = (ch.debts[owed] ?? 1) - 1;
        return;
      }
      if (k === 'welsh') ch.rumor.nosy++;
      ch.flags[k] = v;
    },
  };
}

export interface EventResult {
  ok: boolean;
  text: string;
  check?: { chance: number; roll: number };
}

export function canChoose(r: Run, index: number): boolean {
  const p = r.pending;
  if (p?.kind !== 'event') return false;
  const o = eventDef(p.id)?.options[index];
  if (!o) return false;
  if (o.needPerm && !r.you.permanents.includes(o.needPerm)) return false;
  if (o.needItem && !r.you.items.includes(o.needItem)) return false;
  if (o.needCoins && r.you.coins < o.needCoins) return false;
  return true;
}

export function chooseOption(r: Run, index: number): EventResult | null {
  const p = r.pending;
  if (p?.kind !== 'event' || !canChoose(r, index)) return null;
  const def = eventDef(p.id);
  const o = def?.options[index];
  if (!def || !o) return null;
  let ok = true;
  let check: EventResult['check'];
  if (o.stat) {
    const chance = eventChance(r, o.stat, o.diff ?? 0);
    const roll = Math.floor(next(r.rng) * 100);
    ok = roll < chance;
    check = { chance, roll };
    addXp(r.you, { ...zeroStats(), [o.stat]: ok ? 2 : 1 });
  }
  const like = runLike(r);
  const extra = ok ? o.effect(like) : o.failEffect?.(like);
  r.seen.push(p.id);
  r.pending = null;
  const text = [ok ? o.ok : (o.fail ?? o.ok), extra].filter(Boolean).join(' ');
  note(r, `${def.title}：${text}`);
  return { ok, text, check };
}

// ─── もう一人の掘る人 ─────────────────────────────────────────

/** ライバルが 1 時間ぶん進む。あなたと同じ規則で、遭遇を自動で解く。 */
function rivalStep(r: Run): void {
  const rv = r.rival;
  if (rv.down) return;
  if (rv.row < -1) {
    rv.row++;
    return;
  }
  const ch = rv.you;
  if (rv.stratum > r.stratum) return;
  const map = rv.stratum === r.stratum ? r.map : null;
  if (!map) {
    // 前の層を急いで抜ける（地図は捨てたので、段だけ数える）。
    rv.row++;
    if (rv.row >= ROWS) {
      rv.stratum++;
      rv.row = -1;
    }
    return;
  }
  // 体力が少なければ休む（時間を使う）。
  const s = statsOf(ch);
  if (ch.hp < maxHp(s) * 0.4 || ch.mind < maxMind(s) * 0.35) {
    ch.hp = Math.min(maxHp(s), ch.hp + Math.round(maxHp(s) * 0.35));
    ch.mind = Math.min(maxMind(s), ch.mind + Math.round(maxMind(s) * 0.35));
    for (const card of ch.actives) if (card) restCard(card, 1, true);
    for (const card of ch.actives) if (card) shift(r, ch, card, true);
    return;
  }
  const here = rv.node === null ? undefined : map.find((n) => n.id === rv.node);
  const options = here
    ? here.next.map((id) => map.find((n) => n.id === id)).filter((n): n is MapNode => !!n)
    : map.filter((n) => n.row === 0);
  if (options.length === 0) return;
  // 人に会いに行きたがる。疲れていれば食堂へ。
  const tired = ch.hp < maxHp(s) * 0.7;
  const want = (n: MapNode) =>
    (n.kind === 'person'
      ? 3
      : n.kind === 'danger'
        ? 2
        : n.kind === 'rest'
          ? tired
            ? 4
            : 0.5
          : n.kind === 'boss'
            ? 5
            : 1) +
    (n.visited ? -2 : 0) +
    next(r.rng);
  const target = options.reduce((a, b) => (want(b) > want(a) ? b : a));
  rv.node = target.id;
  rv.row = target.row;
  if (target.kind === 'person' || target.kind === 'danger' || target.kind === 'boss') {
    if (target.visited && target.kind !== 'boss') {
      target.rival ??= 'passed';
    } else {
      const outcome = rivalFight(
        r,
        target.npc ?? 'watchman',
        target.kind === 'person' ? 'normal' : target.kind,
      );
      if (target.kind !== 'boss') target.rival = outcome;
      rv.log.push(`${npcDef(target.npc ?? 'watchman').name}：${OUTCOME_NAME[outcome]}`);
      if (outcome === 'fallen' || outcome === 'shattered') {
        // ライバルは倒れても、しばらくして起き上がる（3 時間遅れる）。
        ch.hp = Math.round(maxHp(s) * 0.5);
        ch.mind = Math.round(maxMind(s) * 0.5);
        rv.row -= 1;
        rv.node = null;
      }
    }
  } else if (target.kind === 'rest') {
    ch.hp = Math.min(maxHp(s), ch.hp + Math.round(maxHp(s) * 0.4));
    ch.mind = Math.min(maxMind(s), ch.mind + Math.round(maxMind(s) * 0.4));
    for (const card of ch.actives) if (card) restCard(card, 1, true);
    ch.actives.forEach((_c, slot) => {
      const opt = alterOptions(ch, slot).find((o) => o.ready && o.kind === 'care');
      if (opt) transform(r, ch, slot, opt.to, true);
    });
    target.rival = 'passed';
  } else {
    target.rival = 'passed';
  }
  if (target.kind === 'boss') {
    if (rv.stratum >= 3) {
      rv.down = true;
      if (!r.ending) {
        rv.first = true;
        note(r, `${ch.name}が、先に最下層へ着いた。`);
      }
    } else {
      rv.stratum++;
      rv.row = -2;
      rv.node = null;
    }
  }
}

function rivalFight(r: Run, npc: string, tier: Encounter['tier']): Outcome {
  const ch = r.rival.you;
  const e = createEncounter({
    seed: (r.seed ^ Math.imul(r.rival.log.length + 101, 0x85ebca6b)) >>> 0,
    you: ch,
    stats: statsOf(ch),
    npc,
    tier,
    depth: r.depth,
    stratum: r.rival.stratum,
    hour: r.hour,
    sim: true,
  });
  autoPlay(e, 30);
  const outcome = e.outcome ?? 'left';
  absorb(r, ch, e, true);
  if (outcome === 'uncovered') {
    const def = npcDef(npc);
    const take = def.take.find((id) => !ch.permanents.includes(id));
    if (take) grantTo(r, ch, take, true);
  }
  return outcome;
}

export const OUTCOME_NAME: Record<Outcome, string> = {
  beaten: '倒した',
  broken: '折った',
  trusted: '打ち解けた',
  uncovered: '暴いた',
  left: '立ち去った',
  fled: '逃げられた',
  fallen: '倒れた',
  shattered: '心が崩れた',
};

// ─── 終わり ───────────────────────────────────────────────────

function score(r: Run, won: boolean): number {
  const o = r.stats.outcomes;
  return (
    (r.stratum - 1) * 150 +
    r.you.permanents.length * 12 +
    ((o.uncovered ?? 0) * 25 +
      (o.trusted ?? 0) * 20 +
      (o.broken ?? 0) * 15 +
      (o.beaten ?? 0) * 12) +
    r.stats.alters * 15 +
    r.stats.grown * 5 +
    (won ? 400 + r.depth * 120 : 0) +
    (r.rival.first ? 0 : won ? 100 : 0)
  );
}

function end(r: Run, kind: Ending['kind'], title: string): void {
  r.ending = {
    kind,
    title,
    text: `${STRATUM_NAME[r.stratum]}の ${clock(r.hour)} で、夜が終わった。`,
    score: score(r, false),
    won: false,
  };
  r.pending = { kind: 'ending' };
}

function finale(r: Run, outcome: Outcome): void {
  const her = r.you.flags['her-trail'] || r.you.permanents.includes('truth');
  const sold = r.you.flags.soldPromise;
  const ch = r.you;
  let title = '';
  let text = '';
  switch (outcome) {
    case 'beaten':
      title = '砕いた';
      text =
        'あなたは自分の履歴を砕いた。土に戻った立方体の中に、何も残っていなかった。身軽になった。それが良いことかは、まだわからない。';
      break;
    case 'broken':
      title = '黙らせた';
      text = '立方体は黙った。あなたの記憶は、もう何も言わない。夜明けの縦坑を、ひとりで上る。';
      break;
    case 'trusted':
      title = '受け入れた';
      text = 'ぜんぶ持っていく、と決めた。重さはそのまま。それでも、歩ける。';
      break;
    case 'uncovered':
      title = her ? '彼女を見つけた' : '掘り当てた';
      text = her
        ? '最後の面に、彼女の名前があった。その下に、あなたの名前も。明かりをつける。約束どおりに。'
        : '面をひとつずつ剥がしていくと、底に小さな空洞があった。何が入っていたのかは、もう思い出せない。';
      break;
    default:
      title = '引き返した';
      text = 'あなたは最下層の手前で引き返した。立方体は、まだそこにある。次の夜も。';
  }
  if (sold) text += ' 約束は、古物商の棚に置いてきた。';
  if (r.rival.first)
    text += ` ${r.rival.you.name}は、あなたより先にここに来て、何かを持ち去っていた。`;
  const won = outcome !== 'left' && outcome !== 'fled';
  r.ending = { kind: outcome, title, text, score: score(r, won), won };
  r.pending = { kind: 'ending' };
  note(r, `${title}。${text}`);
  void ch;
}

/** この挑戦で経験したこと（永続カードの並び）を、種類ごとに。 */
export function history(ch: Character): { id: string; name: string; kind: string }[] {
  return ch.permanents.map((id) => ({
    id,
    name: permDef(id)?.name ?? id,
    kind: permDef(id)?.kind ?? 'state',
  }));
}

export function vitals(ch: Character) {
  const s = statsOf(ch);
  return { hp: ch.hp, maxHp: maxHp(s), mind: ch.mind, maxMind: maxMind(s), stats: s };
}

/** 自動で 1 歩（テストと見本の再生用）。 */
export function autoStep(r: Run): void {
  const p = r.pending;
  if (r.ending) return;
  if (!p) {
    const v = vitals(r.you);
    const tired = r.you.hp < v.maxHp * 0.45 || r.you.mind < v.maxMind * 0.4;
    if (tired && r.you.items.length) {
      useItem(r, 0);
      return;
    }
    const opts = reachable(r);
    const want = (n: MapNode) =>
      (n.kind === 'rest'
        ? tired
          ? 6
          : 0
        : n.kind === 'person'
          ? 3
          : n.kind === 'event'
            ? 2.5
            : n.kind === 'shop'
              ? 1.5
              : n.kind === 'danger'
                ? 1.8
                : 4) + next(r.rng);
    const target = opts.reduce<MapNode | undefined>(
      (a, b) => (!a || want(b) > want(a) ? b : a),
      undefined,
    );
    if (target) moveTo(r, target.id);
    return;
  }
  switch (p.kind) {
    case 'encounter': {
      const e = startEncounter(r);
      if (!e) return;
      autoPlay(e, 30);
      finishEncounter(r, e);
      return;
    }
    case 'reward': {
      const spent = r.you.actives.findIndex((c) => c && c.uses === 0);
      claimReward(r, { take: p.take[0], help: p.help && spent >= 0 ? spent : undefined });
      return;
    }
    case 'event': {
      const def = eventDef(p.id);
      const idx = def?.options.findIndex((_o, i) => canChoose(r, i)) ?? 0;
      chooseOption(r, Math.max(0, idx));
      return;
    }
    case 'rest': {
      r.you.actives.forEach((_c, slot) => {
        const opt = alterOptions(r.you, slot).find((o) => o.ready);
        if (opt) restAlter(r, slot, opt.to);
      });
      restAction(r, 'rest');
      leave(r);
      return;
    }
    case 'shop':
      leave(r);
      return;
    case 'ending':
      return;
  }
}

export { STATS };
