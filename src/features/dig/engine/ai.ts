import type { MoveDef, NpcDef } from './defs';
import { type Basic, basic, canAccept, emit, useCard } from './enc';
import { activeDef, npcDef, permDef } from './registry';
import { next, rng, weighted } from './rng';
import type { Encounter, Outcome } from './types';

/**
 * 頭。サーバーを使わず、手元で読み筋を試す。
 *
 * 相手の頭
 *   下駄     人物ごとに書いた「いまこの手が良さそうか」（prior）
 *   試行     手の候補ごとに盤面を複製し、「予告を見た自分がどう返すか」を
 *            何通りも演じさせて（返し方には揺らぎを入れる）、相手の手番まで
 *            進めて盤面を測る。強い相手は、もう 1 巡り読む
 *   測り方   性格（攻める・嘘・誇り・怖がり・情・狡さ）で、どの決着を嫌い、
 *            何を守るかが変わる
 *
 * 自分（とライバル）の頭
 *   1 手読み 打てる手を全部試し、盤面の値がいちばん高い手を指す。体力と
 *            精神の残り、決着への近さ、使用回数の重み、得た記憶の良し悪しを測る
 *
 * 試行の中の相手は試行をしない（下駄だけで指す）ので、読みは有限で速い。
 */

// ─── 複製 ──────────────────────────────────────────────────────

export function cloneEncounter(e: Encounter, seed: number): Encounter {
  return {
    ...e,
    rng: rng(seed),
    npc: {
      ...e.npc,
      st: { ...e.npc.st },
      mem: { ...e.npc.mem },
      clues: e.npc.clues.map((c) => ({ ...c })),
      history: [...e.npc.history],
      intent: e.npc.intent ? { ...e.npc.intent } : null,
    },
    you: { ...e.you, st: { ...e.you.st }, items: [...e.you.items] },
    stats: { ...e.stats },
    permanents: e.permanents,
    cards: e.cards.map((c) => (c ? { ...c, marks: { ...c.marks } } : null)),
    gained: [...e.gained],
    xp: { ...e.xp },
    log: { ...e.log },
    events: [],
    sim: true,
  };
}

// ─── 自分の頭 ──────────────────────────────────────────────────

export type Action = { kind: 'basic'; a: Basic } | { kind: 'card'; slot: number };

export function actions(e: Encounter): Action[] {
  const out: Action[] = [
    { kind: 'basic', a: 'press' },
    { kind: 'basic', a: 'brace' },
    { kind: 'basic', a: 'talk' },
    { kind: 'basic', a: 'leave' },
  ];
  if (canAccept(e)) out.push({ kind: 'basic', a: 'accept' });
  e.cards.forEach((c, slot) => {
    if (c) out.push({ kind: 'card', slot });
  });
  return out;
}

export function act(e: Encounter, a: Action): boolean {
  return a.kind === 'basic' ? basic(e, a.a) : useCard(e, a.slot);
}

const OUTCOME_VALUE: Record<Outcome, number> = {
  beaten: 70,
  broken: 75,
  trusted: 85,
  uncovered: 95,
  left: 18,
  fled: 5,
  fallen: -1000,
  shattered: -900,
};

/** 自分の側から見た盤面の値。 */
export function judgeYou(base: Encounter, s: Encounter): number {
  const n = s.npc;
  let v = 0;
  if (s.outcome) v += OUTCOME_VALUE[s.outcome];
  const progress = [
    1 - Math.max(0, n.hp) / n.maxHp,
    1 - Math.max(0, n.resolve) / n.maxResolve,
    n.trust / n.trustNeed,
    n.clues.length ? n.clues.filter((c) => c.shown).length / n.clues.length : 0,
  ];
  v += 45 * Math.max(...progress) + 12 * progress.reduce((a, b) => a + b, 0);
  v += 34 * (Math.max(0, s.you.hp) / s.you.maxHp) + 26 * (Math.max(0, s.you.mind) / s.you.maxMind);
  // 体力が少ないほど、減ることが重い。
  const hpLoss = base.you.hp - s.you.hp;
  if (hpLoss > 0) v -= hpLoss * (base.you.hp < base.you.maxHp * 0.4 ? 2.4 : 0.8);
  const mindLoss = base.you.mind - s.you.mind;
  if (mindLoss > 0) v -= mindLoss * (base.you.mind < base.you.maxMind * 0.4 ? 2.4 : 0.8);
  // 回数は長い区間の資源。使うほど、0 回で使うほど重い。
  s.cards.forEach((c, i) => {
    const b = base.cards[i];
    if (!c || !b) return;
    v -= (b.uses - c.uses) * 4;
    v -= ((c.marks.spent ?? 0) - (b.marks.spent ?? 0)) * 9;
  });
  for (const id of s.gained.slice(base.gained.length)) {
    v += permDef(id)?.tags?.includes('bad') ? -14 : 6;
  }
  v += Math.min(s.you.guard, 12) * 0.4;
  return v;
}

/** 1 手読みで、いちばん良い手。jitter で揺らぎ（試行の中の「想像の自分」）。 */
export function bestAction(e: Encounter, jitter = 0): Action {
  const list = actions(e);
  const scored = list.map((a, i) => {
    const s = cloneEncounter(e, (e.rng.s ^ Math.imul(i + 7, 0x2545f491)) >>> 0);
    s.thinking = 0;
    act(s, a);
    let v = judgeYou(e, s);
    if (jitter) v += (next(e.rng) - 0.5) * jitter;
    return { a, v };
  });
  scored.sort((x, y) => y.v - x.v);
  return scored[0]?.a ?? { kind: 'basic', a: 'brace' };
}

export function autoAct(e: Encounter, jitter = 0): void {
  if (e.phase !== 'player') return;
  act(e, bestAction(e, jitter));
}

/** 決着まで自動で進める（ライバルと、テスト用）。 */
export function autoPlay(e: Encounter, limit = 40): void {
  for (let i = 0; i < limit && !e.outcome; i++) autoAct(e);
  if (!e.outcome) basic(e, 'leave');
}

// ─── 相手の頭 ──────────────────────────────────────────────────

function legal(e: Encounter, def: NpcDef): readonly MoveDef[] {
  const ok = def.moves.filter((m) => {
    if (m.cond && !m.cond(e)) return false;
    const rep = m.repeat ?? 2;
    let run = 0;
    for (let i = e.npc.history.length - 1; i >= 0 && e.npc.history[i] === m.id; i--) run++;
    return run < rep;
  });
  return ok.length ? ok : def.moves.filter((m) => !m.cond || m.cond(e));
}

const priorOf = (e: Encounter, m: MoveDef) => Math.max(0.05, m.prior?.(e) ?? 1);

/** 相手の側から見た盤面の値。 */
function judgeNpc(base: Encounter, s: Encounter, def: NpcDef): number {
  const p = def.persona;
  const n0 = base.npc;
  const n1 = s.npc;
  let v = 0;
  switch (s.outcome) {
    case 'beaten':
      v -= 100 + 60 * p.fear;
      break;
    case 'broken':
      v -= 70 + 70 * p.pride;
      break;
    case 'trusted':
      v += 40 * p.warmth - 30 * p.deceit - 20 * p.pride;
      break;
    case 'uncovered':
      v -= 50 + (60 * (p.deceit + p.cunning)) / 2;
      break;
    case 'left':
      v += 15 * p.fear - 10 * p.aggression;
      break;
    case 'fled':
      v += 25 * p.fear - 30 * p.pride;
      break;
    case 'fallen':
    case 'shattered':
      v += 90 + 60 * p.aggression;
      break;
    default:
      break;
  }
  v -= ((n0.hp - Math.max(0, n1.hp)) / n0.maxHp) * 50 * (0.4 + p.fear);
  v -= ((n0.resolve - Math.max(0, n1.resolve)) / n0.maxResolve) * 45 * (0.4 + p.pride);
  v -=
    (n1.clues.filter((c) => c.shown).length - n0.clues.filter((c) => c.shown).length) *
    12 *
    (0.3 + p.deceit + p.cunning);
  v += (n1.trust - n0.trust) * 5 * (p.warmth - p.deceit * 0.6 - p.pride * 0.4);
  v += (base.you.hp - Math.max(0, s.you.hp)) * 1.6 * (0.3 + p.aggression);
  v += (base.you.mind - Math.max(0, s.you.mind)) * 1.6 * (0.3 + p.cunning);
  v += ((n1.st.backup ?? 0) - (n0.st.backup ?? 0)) * 6 * p.cunning;
  v += Math.min(n1.guard, 15) * 0.3 * p.fear;
  return v;
}

function rollouts(e: Encounter): number {
  const base = e.tier === 'boss' || e.tier === 'rival' ? 12 : e.tier === 'danger' ? 8 : 6;
  return base + e.depth;
}

function score(e: Encounter, def: NpcDef, m: MoveDef): number {
  const k = rollouts(e);
  const deep = e.tier !== 'normal';
  let total = 0;
  for (let i = 0; i < k; i++) {
    const s = cloneEncounter(e, (e.rng.s ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0);
    s.npc.move = m.id;
    s.npc.intent = m.intent(s);
    autoAct(s, 30);
    if (deep && !s.outcome) autoAct(s, 30);
    total += judgeNpc(e, s, def);
    e.thinking++;
  }
  const noise = (next(e.rng) - 0.5) * 10 * (1 - def.persona.cunning);
  return total / k + priorOf(e, m) * 4 + noise;
}

/** 相手の次の手を決め、予告する。 */
export function planNpc(e: Encounter): void {
  const n = e.npc;
  const def = npcDef(n.id);
  const moves = legal(e, def);
  let pick: MoveDef | undefined;
  if (moves.length <= 1) pick = moves[0];
  else if (e.sim) pick = moves.reduce((a, b) => (priorOf(e, b) > priorOf(e, a) ? b : a));
  else {
    let best = Number.NEGATIVE_INFINITY;
    for (const m of moves) {
      const v = score(e, def, m);
      if (v > best) {
        best = v;
        pick = m;
      }
    }
  }
  if (!pick) return;
  n.move = pick.id;
  n.intent = pick.intent(e);
  emit(e, { k: 'intent' });
}

/** 相手の手を、下駄だけでランダムに（ライバルの道中など、軽い場面）。 */
export function quickPlan(e: Encounter): void {
  const def = npcDef(e.npc.id);
  const m = weighted(
    e.rng,
    legal(e, def).map((x) => [x, priorOf(e, x) ** 2] as const),
  );
  if (!m) return;
  e.npc.move = m.id;
  e.npc.intent = m.intent(e);
}

export const cardName = (id: string) => activeDef(id).name;
