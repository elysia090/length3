import { planNpc } from './ai';
import { activeDef, npcDef, permDef } from './registry';
import { next, rng } from './rng';
import { maxHp, maxMind } from './stats';
import {
  type ActiveCard,
  type Character,
  type EncEvent,
  type Encounter,
  type Intent,
  type NpcState,
  type Outcome,
  type Stat,
  type StatBlock,
  zeroStats,
} from './types';

/**
 * 遭遇。戦いも会話も調べ事も、同じ盤面で解く。
 *
 *   相手   体力・意志・信頼・敵意・手がかり（相手の永続カード）を持ち、次の
 *          手を予告する（嘘の予告もある）
 *   自分   体力・精神。毎手番、基本の行動（押す・構える・話す・去る）か、
 *          ACTIVE のカードを 1 つ使う
 *   決着   体力 0 で倒す / 意志 0 で折る / 信頼が満ちて打ち解ける /
 *          手がかりを全部見て暴く / 去る。相手が逃げることもある
 */

export interface EncounterSetup {
  seed: number;
  you: Character;
  stats: StatBlock;
  npc: string;
  tier: Encounter['tier'];
  depth: number;
  stratum: number;
  hour: number;
  /** 前に会ったことがあれば、そのときの決着。 */
  met?: Outcome;
  /** もう一人の掘る人と会うとき、その人物の数と記憶。 */
  rival?: { name: string; stats: StatBlock; perms: readonly string[]; hp: number };
  /** もう一人の掘る人が先に寄って、どう決着したか。 */
  after?: Outcome;
  /** 試行（ライバルの道中）。出来事を残さず、相手は下駄だけで指す。 */
  sim?: boolean;
}

// ─── 小さな操作 ───────────────────────────────────────────────

export function emit(e: Encounter, ev: EncEvent): void {
  if (!e.sim) e.events.push(ev);
}

export function say(e: Encounter, who: 'npc' | 'you' | 'voice', text: string): void {
  emit(e, { k: 'say', who, text });
}

export function line(e: Encounter, kind: Parameters<typeof npcLines>[1]): void {
  if (e.sim) return;
  const lines = npcLines(e, kind);
  const text = lines[Math.floor(next(e.rng) * lines.length)];
  if (text) say(e, 'npc', text);
}

function npcLines(
  e: Encounter,
  kind: 'greet' | 'hurt' | 'low' | 'trusted' | 'broken' | 'beaten' | 'uncovered' | 'fled' | 'again',
) {
  return npcDef(e.npc.id).lines[kind] ?? [];
}

export const has = (e: Encounter, perm: string) =>
  e.permanents.includes(perm) || e.gained.includes(perm);
export function stat(e: Encounter, s: Stat): number {
  let v = e.stats[s];
  for (const id of e.permanents) v += permDef(id)?.dyn?.(e, s) ?? 0;
  return Math.max(0, v);
}

/** 判定の成功率（%）。能力値 1 につき 8%、5..95 に収める。 */
export function chanceOf(e: Encounter, s: Stat | Stat[], base: number, card?: string): number {
  const list = Array.isArray(s) ? s : [s];
  const v = list.reduce((a, x) => a + stat(e, x), 0) / list.length;
  let c = base + 8 * v;
  for (const id of [...e.permanents, ...e.gained])
    c += permDef(id)?.check?.(e, { stat: list.join('+'), card }) ?? 0;
  return Math.max(5, Math.min(95, Math.round(c)));
}

/** 判定する。使った能力に経験が入る（失敗しても、成功ならさらに）。 */
export function roll(e: Encounter, s: Stat | Stat[], chance: number): boolean {
  const r = Math.floor(next(e.rng) * 100);
  const ok = r < chance;
  const list = Array.isArray(s) ? s : [s];
  for (const x of list) e.xp[x] += ok ? 2 : 1;
  emit(e, { k: 'check', stat: list.join('+'), chance, roll: r, ok });
  return ok;
}

export function xp(e: Encounter, s: Stat, n = 1): void {
  e.xp[s] += n;
}

/** 手がかりから効く、攻め筋の倍率。 */
function exploit(e: Encounter, key: 'press' | 'talk' | 'force' | 'lie'): number {
  let m = 1;
  for (const c of e.npc.clues) {
    if (!c.shown || c.false) continue;
    const x = permDef(c.id)?.exploit?.[key];
    if (x) m *= x;
  }
  return m;
}

// ─── 相手への働きかけ ─────────────────────────────────────────

/** 相手の体力を削る（守りが先に受ける）。 */
export function hitNpc(e: Encounter, base: number, pierce = false): number {
  const n = e.npc;
  let amount = Math.max(0, Math.round(base * exploit(e, 'press')));
  if (!pierce) {
    const g = Math.min(n.guard, amount);
    n.guard -= g;
    amount -= g;
    if (g) emit(e, { k: 'guard', to: 'npc', delta: -g });
  }
  if (amount <= 0) return 0;
  n.hp -= amount;
  emit(e, { k: 'hp', to: 'npc', delta: -amount });
  if (n.hp > 0 && n.hp <= n.maxHp * 0.35 && !n.mem.low) {
    n.mem.low = 1;
    line(e, 'low');
  } else if (n.hp > 0) line(e, 'hurt');
  settle(e);
  return amount;
}

/** 相手の意志を削る。 */
export function breakNpc(e: Encounter, base: number): number {
  const n = e.npc;
  const amount = Math.max(0, Math.round(base * exploit(e, 'force')));
  if (amount <= 0) return 0;
  n.resolve -= amount;
  emit(e, { k: 'resolve', delta: -amount });
  settle(e);
  return amount;
}

export function trust(e: Encounter, delta: number): void {
  const n = e.npc;
  let d = delta;
  if (d > 0) d = Math.round(d * exploit(e, 'talk'));
  // 疑う目・血の匂い・閉ざした心は、信頼の伸びを 1 削る（重ねても 1）。
  if (d > 0 && ['suspicion', 'blood', 'closed-heart'].some((id) => has(e, id)))
    d = Math.max(0, d - 1);
  if (d === 0) return;
  const before = n.trust;
  n.trust = Math.max(0, n.trust + d);
  if (n.trust !== before) emit(e, { k: 'trust', delta: n.trust - before });
  settle(e);
}

export function hostile(e: Encounter, delta: number): void {
  const n = e.npc;
  const before = n.hostility;
  n.hostility = Math.max(0, Math.min(10, n.hostility + delta));
  if (n.hostility !== before) emit(e, { k: 'hostility', delta: n.hostility - before });
}

/** 手がかりを 1 つ見る。fake なら、誤った手がかりが混じることがある。 */
export function revealClue(e: Encounter, fake = false): boolean {
  const hidden = e.npc.clues.filter((c) => !c.shown && !c.false);
  if (fake && next(e.rng) < 0.3) {
    const wrong = { id: 'false-lead', shown: true, false: true };
    e.npc.clues.push(wrong);
    emit(e, { k: 'clue', id: wrong.id, false: true });
    return true;
  }
  const c = hidden[Math.floor(next(e.rng) * hidden.length)];
  if (!c) return false;
  c.shown = true;
  emit(e, { k: 'clue', id: c.id });
  permDef(c.id)?.exploit?.show?.(e);
  settle(e);
  return true;
}

export function seeIntent(e: Encounter): void {
  if (e.npc.seen) return;
  e.npc.seen = true;
  emit(e, { k: 'seen' });
}

// ─── 自分への働きかけ ─────────────────────────────────────────

export function hurtYou(e: Encounter, base: number): number {
  const y = e.you;
  let amount = Math.max(0, base);
  const g = Math.min(y.guard, amount);
  y.guard -= g;
  amount -= g;
  if (g) emit(e, { k: 'guard', to: 'you', delta: -g });
  if (amount <= 0) return 0;
  y.hp -= amount;
  e.xp.VIT += 1;
  emit(e, { k: 'hp', to: 'you', delta: -amount });
  settle(e);
  return amount;
}

export function hurtMind(e: Encounter, base: number): number {
  const y = e.you;
  let amount = Math.max(0, base + (has(e, 'fear') ? 1 : 0));
  const g = Math.min(y.calm, amount);
  y.calm -= g;
  amount -= g;
  if (amount <= 0) return 0;
  y.mind -= amount;
  e.xp.WIL += 1;
  emit(e, { k: 'mind', delta: -amount });
  settle(e);
  return amount;
}

export function healYou(e: Encounter, hp: number, mind = 0): void {
  const y = e.you;
  const h = Math.min(hp, y.maxHp - y.hp);
  const m = Math.min(mind, y.maxMind - y.mind);
  if (h > 0) {
    y.hp += h;
    emit(e, { k: 'hp', to: 'you', delta: h });
  }
  if (m > 0) {
    y.mind += m;
    emit(e, { k: 'mind', delta: m });
  }
}

/** 代償。守りも構えも通さずに、体力と精神を失う。 */
export function cost(e: Encounter, hp: number, mind = 0): void {
  if (hp > 0) {
    e.you.hp -= hp;
    emit(e, { k: 'hp', to: 'you', delta: -hp });
  }
  if (mind > 0) {
    e.you.mind -= mind;
    emit(e, { k: 'mind', delta: -mind });
  }
  settle(e);
}

export function gainPerm(e: Encounter, id: string): void {
  if (has(e, id)) return;
  e.gained.push(id);
  emit(e, { k: 'perm', id });
}

export function coins(e: Encounter, delta: number): void {
  const d = Math.max(-e.you.coins, delta);
  if (!d) return;
  e.you.coins += d;
  emit(e, { k: 'coins', delta: d });
}

/** 所持品をランダムに 1 つ失う（無ければ金を半分）。 */
export function loseItem(e: Encounter): void {
  const i = Math.floor(next(e.rng) * e.you.items.length);
  const item = e.you.items[i];
  if (item) {
    e.you.items.splice(i, 1);
    emit(e, { k: 'item', id: item, delta: -1 });
  } else coins(e, -Math.ceil(e.you.coins / 2));
}

// ─── 決着 ─────────────────────────────────────────────────────

export function end(e: Encounter, outcome: Outcome): void {
  if (e.outcome) return;
  e.outcome = outcome;
  e.phase = 'over';
  const kind =
    outcome === 'beaten' ||
    outcome === 'broken' ||
    outcome === 'trusted' ||
    outcome === 'uncovered' ||
    outcome === 'fled'
      ? outcome
      : null;
  if (kind) line(e, kind);
  emit(e, { k: 'end', outcome });
}

/** 決着がついたかを見る。 */
export function settle(e: Encounter): void {
  if (e.outcome) return;
  const n = e.npc;
  const all = n.clues.length > 0 && n.clues.every((c) => c.shown) && n.clues.some((c) => !c.false);
  const outcome: Outcome | null =
    e.you.hp <= 0
      ? 'fallen'
      : e.you.mind <= 0
        ? 'shattered'
        : n.hp <= 0
          ? 'beaten'
          : n.resolve <= 0
            ? 'broken'
            : n.trust >= n.trustNeed
              ? 'trusted'
              : all
                ? 'uncovered'
                : null;
  if (outcome) end(e, outcome);
}

// ─── 始める ───────────────────────────────────────────────────

export function createEncounter(s: EncounterSetup): Encounter {
  const def = npcDef(s.npc);
  const grow = 1 + 0.12 * s.depth + 0.18 * (s.stratum - 1);
  const late = Math.max(0, s.hour - 3) / 2;
  const n: NpcState = {
    id: def.id,
    name: def.name,
    hp: Math.round(def.hp * grow),
    maxHp: Math.round(def.hp * grow),
    resolve: Math.round(def.resolve * grow),
    maxResolve: Math.round(def.resolve * grow),
    trust: 0,
    trustNeed: def.trustNeed,
    hostility: Math.min(10, Math.round(def.hostility + late)),
    guard: 0,
    atk: Math.round(def.atk * (1 + 0.1 * s.depth) + (s.stratum - 1)),
    def: def.def,
    wil: def.wil,
    int: def.int,
    agi: def.agi,
    st: {},
    clues: def.clues.map((id) => ({ id, shown: false })),
    move: null,
    intent: null,
    seen: false,
    mem: {},
    history: [],
  };
  if (s.rival) {
    const r = s.rival;
    n.name = r.name;
    n.maxHp = n.hp = Math.max(8, Math.round(r.hp * 1.2));
    n.maxResolve = n.resolve = 10 + 3 * r.stats.WIL;
    n.atk = 2 + r.stats.ATK;
    n.def = r.stats.DEF;
    n.wil = r.stats.WIL;
    n.int = r.stats.INT;
    n.agi = r.stats.AGI;
    n.clues = r.perms.slice(0, 5).map((id) => ({ id, shown: false }));
  }
  const y = s.you;
  const e: Encounter = {
    rng: rng(s.seed),
    turn: 1,
    phase: 'player',
    outcome: null,
    npc: n,
    you: {
      hp: y.hp,
      maxHp: maxHp(s.stats),
      mind: y.mind,
      maxMind: maxMind(s.stats),
      guard: 0,
      calm: 0,
      coins: y.coins,
      items: [...y.items],
      st: {},
    },
    stats: { ...s.stats },
    permanents: [...y.permanents],
    cards: y.actives.map((c) => (c ? { ...c, marks: { ...c.marks } } : null)),
    gained: [],
    xp: zeroStats(),
    log: { cards: 0, lies: 0, liesCaught: 0, spent: 0 },
    tier: s.tier,
    depth: s.depth,
    stratum: s.stratum,
    hour: s.hour,
    events: [],
    sim: s.sim ?? false,
    thinking: 0,
  };
  // 噂。殴り倒してきた者には怯えるか身構え、打ち解けてきた者には最初から少し
  // 心を開き、暴いてきた者には口を閉ざす。
  const r = y.rumor;
  if (r.fear > 0) {
    if (def.persona.fear >= 0.5) n.resolve = Math.max(1, n.resolve - 2 * r.fear);
    else hostile(e, Math.ceil(r.fear / 2));
  }
  if (r.kind > 0 && def.persona.warmth > 0.3)
    n.trust = Math.min(n.trustNeed - 1, Math.floor(r.kind / 2));
  if (r.nosy > 0) n.st.closed = r.nosy;
  if (s.met === 'beaten') hostile(e, 3);
  if (s.met === 'trusted') n.trust = Math.min(n.trustNeed - 1, n.trust + 2);
  // もう一人の掘る人が、先に寄っていた。
  switch (s.after) {
    case 'beaten':
      n.hp = Math.max(1, Math.round(n.hp * 0.7));
      hostile(e, 2);
      say(e, 'voice', 'もう一人に、やられたあとだ。');
      break;
    case 'broken':
      n.resolve = Math.max(1, Math.round(n.resolve * 0.6));
      say(e, 'voice', 'もう一人に、心を折られたあとだ。');
      break;
    case 'trusted':
      n.trust = Math.min(n.trustNeed - 1, n.trust + 2);
      say(e, 'voice', 'もう一人と、もう打ち解けている。贈り物は、向こうへ渡ったあとだ。');
      break;
    case 'uncovered': {
      const c = n.clues[0];
      if (c) c.shown = true;
      say(e, 'voice', 'もう一人が、先に掘り返していた。');
      break;
    }
    default:
      break;
  }
  def.init?.(e);
  for (const id of e.permanents) permDef(id)?.start?.(e);
  if (s.met) line(e, 'again');
  else line(e, 'greet');
  // 素早さで大きく上回れば、相手は最初の手番に出遅れる。
  if (stat(e, 'AGI') >= n.agi + 3) n.st.late = 1;
  planNpc(e);
  return e;
}

// ─── 自分の手番 ───────────────────────────────────────────────

export type Basic = 'press' | 'brace' | 'talk' | 'leave' | 'accept';

export function pressDamage(e: Encounter): number {
  return Math.max(1, 2 + stat(e, 'ATK') - Math.floor(e.npc.def / 2));
}

export function leaveChance(e: Encounter): number {
  const n = e.npc;
  if (n.hostility <= 2 || n.st.stun) return 100;
  return Math.max(5, Math.min(95, 50 + 10 * (stat(e, 'AGI') - n.agi) - 4 * (n.hostility - 3)));
}

export function canAccept(e: Encounter): boolean {
  const i = e.npc.intent;
  return !!i && i.kind === 'bargain' && !i.lie && e.you.coins >= (i.price ?? 0);
}

export function basic(e: Encounter, a: Basic): boolean {
  if (e.phase !== 'player') return false;
  const n = e.npc;
  const def = npcDef(n.id);
  switch (a) {
    case 'press': {
      let dmg = pressDamage(e);
      const crit = next(e.rng) * 100 < 5 + 2 * stat(e, 'AGI');
      if (crit) {
        dmg *= 2;
        emit(e, { k: 'crit' });
      }
      xp(e, 'ATK');
      hitNpc(e, dmg);
      hostile(e, 1);
      if (n.trust > 0) trust(e, -1);
      break;
    }
    case 'brace': {
      const g = 2 + stat(e, 'DEF');
      e.you.guard += g;
      e.you.calm += 1 + Math.floor(stat(e, 'WIL') / 3);
      emit(e, { k: 'guard', to: 'you', delta: g });
      xp(e, 'DEF');
      break;
    }
    case 'talk': {
      xp(e, 'WIL');
      if (def.mute) {
        say(e, 'voice', '言葉は届かない。');
      } else if (def.hush && !n.st.unhushed) {
        say(e, 'npc', '……静かに。');
        hostile(e, 2);
      } else if (n.hostility >= 7) {
        hostile(e, -1);
      } else {
        trust(e, 1 + (stat(e, 'WIL') >= 6 ? 1 : 0));
        hostile(e, -1);
      }
      break;
    }
    case 'leave': {
      xp(e, 'AGI');
      const c = leaveChance(e);
      if (c >= 100 || roll(e, 'AGI', c)) {
        end(e, 'left');
        return true;
      }
      say(e, 'voice', '道を塞がれた。');
      n.st.punish = 1;
      break;
    }
    case 'accept': {
      if (!canAccept(e)) return false;
      const price = n.intent?.price ?? 0;
      coins(e, -price);
      n.st.dealt = 1;
      say(e, 'npc', '……取引成立だ。');
      if (!revealClue(e)) trust(e, 2);
      break;
    }
  }
  afterYou(e);
  return true;
}

/** カードを使う。READY なら本来の効き目、SPENT なら枯渇時の効き目。 */
export function useCard(e: Encounter, slot: number): boolean {
  if (e.phase !== 'player') return false;
  const card = e.cards[slot];
  if (!card) return false;
  const def = activeDef(card.id);
  const spent = card.uses <= 0;
  e.log.cards++;
  emit(e, { k: 'use', slot, spent });
  for (const s of def.stats) xp(e, s);
  if (spent) {
    card.marks.spent = (card.marks.spent ?? 0) + 1;
    e.log.spent++;
    def.spent(e, slot);
  } else {
    card.uses--;
    card.marks.used = (card.marks.used ?? 0) + 1;
    def.ready(e, slot);
  }
  afterYou(e);
  return true;
}

export const cardOf = (e: Encounter, slot: number): ActiveCard | null => e.cards[slot] ?? null;

function afterYou(e: Encounter): void {
  settle(e);
  if (e.outcome) return;
  npcTurn(e);
}

// ─── 相手の手番 ───────────────────────────────────────────────

/** 相手の攻撃の値（防御で減る）。 */
export function strikeValue(e: Encounter, power: number): number {
  const backup = (e.npc.st.backup ?? 0) * 2;
  const punish = e.npc.st.punish ? 2 : 0;
  return Math.max(0, power + backup + punish - Math.floor(stat(e, 'DEF') / 2));
}

export function threatValue(e: Encounter, power: number): number {
  return Math.max(0, power - Math.floor(stat(e, 'WIL') / 3));
}

function npcTurn(e: Encounter): void {
  e.phase = 'npc';
  const n = e.npc;
  n.guard = 0;
  const def = npcDef(n.id);
  const move = def.moves.find((m) => m.id === n.move);
  if (n.st.late) {
    delete n.st.late;
    say(e, 'voice', `${n.name}は出遅れた。`);
  } else if (n.st.stun) {
    delete n.st.stun;
    say(e, 'voice', `${n.name}は動けない。`);
  } else if (move) {
    if (n.intent?.kind === 'bargain' && !n.st.dealt && !n.intent.lie) hostile(e, 1);
    move.act(e);
  }
  delete n.st.dealt;
  delete n.st.punish;
  if (n.move) n.history.push(n.move);
  settle(e);
  if (e.outcome) return;
  e.turn++;
  e.phase = 'player';
  e.you.guard = 0;
  e.you.calm = Math.floor(e.you.calm / 2);
  n.seen = false;
  planNpc(e);
}

/** 予告を、見せるとおりに（嘘は見抜けていなければ見かけで）。 */
export function shownIntent(e: Encounter): Intent | null {
  const i = e.npc.intent;
  if (!i) return null;
  if (i.lie && !e.npc.seen && !has(e, 'suspicion') && stat(e, 'INT') < e.npc.int + 3) {
    return { kind: i.seem ?? 'wait', label: i.seemLabel ?? '……', price: i.price };
  }
  return i;
}

export const zero = zeroStats;
