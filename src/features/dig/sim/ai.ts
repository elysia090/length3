import type { MoveDef } from '../content/defs';
import { heatOf } from '../content/floors';
import { cardDef, foeDef } from '../content/registry';
import { forkEncounter } from '../core/branch';
import type { Basic } from '../core/events';
import { believes, portrait } from '../core/mind';
import type { Intent, World } from '../core/model';
import { bookOf } from '../core/rules';
import { Tx } from '../core/tx';
import { basic, canAccept, useCard } from './encounter';
import { foeHardness } from './hardness';
import { charOf, maxHp, maxMind, stats } from './ops';

/**
 * 頭。サーバーを使わず、手元で読む。
 *
 * 相手の頭（認識世界の上で読む）
 *   想像     相手は、自分が見てきた「あなた像」でしか、あなたを知らない。
 *            乱暴だと思っていれば殴ってくると想像し、優しいと思っていれば
 *            話してくると想像する。見たことのあるカードは使ってくると想像し、
 *            「手は出さない」と信じていれば、殴られるとは想像しない
 *   試行     手の候補ごとに世界を複製し、想像のあなたに何通りも返させて
 *            （揺らぎは ai の流れから引く）、相手の手番まで進めて盤面を測る
 *   測り方   性格（攻める・嘘・誇り・怖がり・情・狡さ）で重みが変わる
 *
 * あなた（とライバル）の頭
 *   1 手読み 打てる手を全部試し、盤面の値がいちばん高い手を指す
 *
 * 試行の中では試行をしない（下駄だけで指す）ので、読みは有限で速い。
 */

export type Action = { kind: 'basic'; a: Basic } | { kind: 'card'; slot: number };

/** 世界の複製（試行用）。乱数の流れも分けて、本物の流れを汚さない。 */
export function fork(w: World, salt: number): World {
  const c = forkEncounter(w);
  c.rng = {
    ...c.rng,
    enc: (c.rng.enc ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0,
    ai: (c.rng.ai ^ Math.imul(salt + 7, 0x85ebca6b)) >>> 0,
  };
  return c;
}

export function act(tx: Tx, a: Action): boolean {
  return a.kind === 'basic' ? basic(tx, a.a) : useCard(tx, a.slot);
}

export function actions(w: World): Action[] {
  const e = w.enc;
  if (!e) return [];
  // 素手の手は無い。札を切るか、立ち去るか（取引に応じるか）。
  const out: Action[] = [{ kind: 'basic', a: 'leave' }];
  if (canAccept(w)) out.push({ kind: 'basic', a: 'accept' });
  charOf(w, e.who).cards.forEach((c, slot) => {
    if (c) out.push({ kind: 'card', slot });
  });
  return out;
}

// ─── あなたの頭 ────────────────────────────────────────────────

const VALUE: Record<string, number> = {
  beaten: 70,
  broken: 75,
  trusted: 85,
  uncovered: 95,
  left: 18,
  fled: 5,
  fallen: -1000,
  shattered: -900,
};

export function judgeYou(base: World, s: World): number {
  const b = base.enc;
  const e = s.enc;
  if (!b || !e) return 0;
  const who = b.who;
  const c0 = charOf(base, who);
  const c1 = charOf(s, who);
  const f = e.foe;
  let v = e.outcome ? (VALUE[e.outcome] ?? 0) : 0;
  // 立ち去るのは、危ないときだけ（体か心が三割を切っている）。最後の相手からは
  // 退いても再戦できるが、勝てるうちは粘る。長引いたら、少しずつ引くのも手。
  if (e.outcome === 'left') {
    const st = stats(s, who);
    const danger = c1.hp * 10 < maxHp(st) * 3 || c1.mind * 10 < maxMind(st) * 3;
    v = b.tier === 'boss' ? (danger ? 10 : -60) : danger ? 25 : -25 + 5 * Math.max(0, e.turn - 6);
  }
  const progress = [
    1 - Math.max(0, f.hp) / f.maxHp,
    1 - Math.max(0, f.resolve) / f.maxResolve,
    f.trust / f.need,
    f.clues.length ? f.clues.filter((x) => x.shown).length / f.clues.length : 0,
  ];
  v += 45 * Math.max(...progress) + 12 * progress.reduce((a, x) => a + x, 0);
  v -= Math.max(0, c0.hp - c1.hp) * (c0.hp < 12 ? 2.4 : 0.9);
  v -= Math.max(0, c0.mind - c1.mind) * (c0.mind < 8 ? 2.4 : 0.9);
  c1.cards.forEach((card, i) => {
    const old = c0.cards[i];
    if (!card || !old) return;
    v -= (old.uses - card.uses) * 3.5;
    v -= ((card.marks.spent ?? 0) - (old.marks.spent ?? 0)) * 8;
  });
  v += Math.min(e.guard, 12) * 0.4 + Math.min(e.calm, 10) * 0.25;
  return v;
}

/**
 * いちばん良い手。depth 2 なら、相手の返しのあとのこちらの次の一手まで読む
 * （試しの遊び手が使う。人の読みに近づける）。
 */
export function bestAction(w: World, depth = 1): Action {
  const list = actions(w);
  let best: Action = { kind: 'basic', a: 'leave' };
  let bestV = Number.NEGATIVE_INFINITY;
  const book = bookOf(w);
  list.forEach((a, i) => {
    const s = fork(w, i + 17);
    act(new Tx(s, true, book), a);
    let v = judgeYou(w, s);
    if (depth > 1 && s.enc?.phase === 'act' && !(a.kind === 'basic' && a.a === 'leave')) {
      let next = Number.NEGATIVE_INFINITY;
      actions(s).forEach((b, j) => {
        const s2 = fork(s, j + 31);
        act(new Tx(s2, true), b);
        next = Math.max(next, judgeYou(w, s2));
      });
      if (next > Number.NEGATIVE_INFINITY) v = 0.4 * v + 0.6 * next;
    }
    if (v > bestV) {
      bestV = v;
      best = a;
    }
  });
  return best;
}

/** 決着まで自動で（ライバルと、テスト用）。 */
export function autoPlay(tx: Tx, limit = 30): void {
  for (let i = 0; i < limit; i++) {
    const e = tx.w.enc;
    if (!e || e.phase !== 'act') return;
    act(tx, bestAction(tx.w));
  }
  if (tx.w.enc?.phase === 'act') basic(tx, 'leave');
}

// ─── 相手の頭 ──────────────────────────────────────────────────

function legal(w: World): readonly MoveDef[] {
  const e = w.enc;
  if (!e) return [];
  const def = foeDef(e.foe.id);
  const ok = def.moves.filter((m) => {
    if (m.cond && !m.cond(w)) return false;
    if (e.foe.st.honest && m.id.endsWith('-lie')) return false;
    const rep = m.repeat ?? 2;
    let run = 0;
    for (let i = e.foe.history.length - 1; i >= 0 && e.foe.history[i] === m.id; i--) run++;
    return run < rep;
  });
  return ok.length ? ok : def.moves.filter((m) => !m.cond || m.cond(w));
}

const prior = (w: World, m: MoveDef) => Math.max(0.05, m.prior?.(w) ?? 1);

/**
 * 相手が想像する「あなたの次の一手」。認識世界から作る。本物のあなたの
 * 手札（カードの中身）は知らない。見たことのあるカードだけを想像に入れる。
 */
function imagine(tx: Tx): Action {
  const w = tx.w;
  const e = w.enc;
  if (!e) return { kind: 'basic', a: 'leave' };
  const mind = w.minds[e.foe.id];
  const p = portrait(mind);
  const harmless = believes(mind, 'harmless');
  // 相手が想像するあなたの手は、札と立ち去ることだけ（素手の手は無い）。見た札は
  // 重く、見ていない札は、あなたが乱暴そうか穏やかそうかで、身体の札か話の札を想像する。
  // 使い切った札（この遭遇で回数が尽きるのを見た札）は、もう来ないと読む。体か心が
  // 細っているあなたは、立ち去るかもしれないと読む（追い詰めるか、逃がすかを量る）。
  const you = charOf(w, e.who);
  const st = stats(w, e.who);
  const thin = you.hp * 10 < maxHp(st) * 3 || you.mind * 10 < maxMind(st) * 3;
  const weights: [Action, number][] = [[{ kind: 'basic', a: 'leave' }, thin ? 1.2 : 0.3]];
  const seen = new Set(mind?.cards ?? []);
  you.cards.forEach((c, slot) => {
    if (!c) return;
    const body = cardDef(c.id).tags.includes('body');
    const guess = body ? 0.5 + 2 * p.violent : 0.5 + 2 * p.kind;
    const x = seen.has(c.id) ? 2.2 : guess;
    const spent = c.uses <= 0 && seen.has(c.id) ? 0.25 : 1;
    weights.push([{ kind: 'card', slot }, (harmless && body ? 0.1 : x) * spent]);
  });
  const total = weights.reduce((a, [, x]) => a + x, 0);
  let r = tx.rand('ai') * total;
  for (const [a, x] of weights) {
    r -= x;
    if (r < 0) return a;
  }
  return weights[0]?.[0] ?? { kind: 'basic', a: 'leave' };
}

function judgeFoe(base: World, s: World): number {
  const b = base.enc;
  const e = s.enc;
  if (!b || !e) return 0;
  const p = foeDef(b.foe.id).persona;
  const c0 = charOf(base, b.who);
  const c1 = charOf(s, b.who);
  let v = 0;
  switch (e.outcome) {
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
      v -= 50 + 30 * (p.deceit + p.cunning);
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
  const f0 = b.foe;
  const f1 = e.foe;
  v -= ((f0.hp - Math.max(0, f1.hp)) / f0.maxHp) * 50 * (0.4 + p.fear);
  v -= ((f0.resolve - Math.max(0, f1.resolve)) / f0.maxResolve) * 45 * (0.4 + p.pride);
  v -=
    (f1.clues.filter((c) => c.shown).length - f0.clues.filter((c) => c.shown).length) *
    12 *
    (0.3 + p.deceit + p.cunning);
  v += (f1.trust - f0.trust) * 5 * (p.warmth - p.deceit * 0.6 - p.pride * 0.4);
  v += (c0.hp - Math.max(0, c1.hp)) * 1.6 * (0.3 + p.aggression);
  v += (c0.mind - Math.max(0, c1.mind)) * 1.6 * (0.3 + p.cunning);
  v += ((f1.st.backup ?? 0) - (f0.st.backup ?? 0)) * 6 * p.cunning;
  // 狡い相手は、あなたの札を空撃ちさせる（回数を減らさせる）のも勝ちのうちと数える。
  c1.cards.forEach((card, i) => {
    const old = c0.cards[i];
    if (card && old && old.uses > card.uses) v += (old.uses - card.uses) * 2 * p.cunning;
  });
  return v;
}

/** 硬い相手ほど、多く読む（狡い相手は、さらに読む）。 */
function rollouts(w: World): number {
  const f = w.enc?.foe;
  const sly = f ? Math.round(2 * foeDef(f.id).persona.cunning) : 0;
  return 4 + (f ? foeHardness(f) : 4) + Math.floor(heatOf(w)) + sly;
}

/** 相手の次の手を決め、予告する。 */
export function planFoe(tx: Tx): void {
  const w = tx.w;
  const e = w.enc;
  if (!e || e.phase !== 'act') return;
  const moves = legal(w);
  let pick: MoveDef | undefined;
  if (moves.length <= 1) pick = moves[0];
  else if (tx.sim) pick = moves.reduce((a, b) => (prior(w, b) > prior(w, a) ? b : a));
  else {
    const def = foeDef(e.foe.id);
    let best = Number.NEGATIVE_INFINITY;
    const book = bookOf(w);
    moves.forEach((m, mi) => {
      const k = rollouts(w);
      let total = 0;
      for (let i = 0; i < k; i++) {
        const s = fork(w, mi * 97 + i);
        const stx = new Tx(s, true, book);
        const se = s.enc;
        if (!se) continue;
        stx.emit({ type: 'intent', move: m.id, intent: m.intent(s) });
        act(stx, imagine(stx));
        // 硬度 5 以上（最後の相手はいつも）は、あなたの二手先まで想像する。
        if ((foeHardness(e.foe) >= 5 || e.tier === 'boss') && s.enc?.phase === 'act')
          act(stx, imagine(stx));
        total += judgeFoe(w, s);
      }
      const noise = (tx.rand('ai') - 0.5) * 10 * (1 - def.persona.cunning);
      const v = total / k + prior(w, m) * 4 + noise;
      if (v > best) {
        best = v;
        pick = m;
      }
    });
  }
  if (!pick) return;
  let intent: Intent = pick.intent(w);
  // いつも嘘をつく人物は、本当の手を見かけで隠す。
  if (e.foe.st.liar && !intent.lie)
    intent = { ...intent, lie: true, seem: 'wait', seemLabel: '……' };
  tx.emit({ type: 'intent', move: pick.id, intent });
}
