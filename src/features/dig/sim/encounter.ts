import { PACE, POINTS } from '../content/balance';
import { cardArch, cardTags } from '../content/cardinfo';
import type { EpithetCtx } from '../content/defs';
import type { CardFacet } from '../content/epithets';
import { poolEpithets } from '../content/epithets';
import { heatOf, LAST } from '../content/floors';
import { holds, run } from '../content/fx';
import { gearOf } from '../content/gear';
import { cardDef, epithetDef, foeDef, permDef } from '../content/registry';
import { buildsOf } from '../content/sources';
import type { Basic } from '../core/events';
import { portrait } from '../core/mind';
import type { Card, Char, Foe, Outcome, Who, World } from '../core/model';
import { ask, bookOf } from '../core/rules';
import type { Tag } from '../core/tags';
import type { Tx } from '../core/tx';
import { planFoe } from './ai';
import {
  chance,
  charOf,
  coins,
  deal,
  end,
  epUses,
  gainPerm,
  giveItem,
  heal,
  hitFoe,
  hostile,
  line,
  markEp,
  maxHp,
  maxMind,
  quip,
  revealClue,
  roll,
  say,
  settle,
  statOf,
  stats,
  strikeValue,
  threatValue,
  trust,
  xp,
} from './ops';

/**
 * 相手の姿を作る（純粋な計算。地図の上の見積もりにも使う）。
 * late は夜明けを過ぎた分（規則 lateness を通したあと）。
 */

/** 話がひとつ多く届く、相手の手（打ち明ける・待つ・繕う・持ちかける）。 */
const TALK_OPEN: ReadonlySet<string> = new Set(['confide', 'wait', 'mend', 'bargain']);
export function scaleFoe(w: World, npc: string, m: Meet = {}, late = 0): Foe {
  const def = foeDef(npc);
  const heat = heatOf(w);
  const depth = heat + late;
  // 夜明けを過ぎた 1 時間ごとに、深さ 2.5 段ぶん荒れる（退屈な道の代償）。
  // 底の手前より下は、区画ごとに掛け算で手強くなる（構成がどこまで持つかを試す）。
  const deep = Math.max(0, w.stratum - LAST);
  const grow =
    PACE.tough *
    (1 + PACE.heat * heat + 0.25 * late + PACE.stratum * (w.stratum - 1)) *
    PACE.deep ** deep *
    (m.keeper ? PACE.keeper : 1);
  const f: Foe = {
    id: def.id,
    name: def.name,
    hp: Math.round(def.hp * grow),
    maxHp: Math.round(def.hp * grow),
    resolve: Math.round(def.resolve * grow),
    maxResolve: Math.round(def.resolve * grow),
    trust: 0,
    need: Math.round(def.need * PACE.tough) + w.stratum - 1 + Math.round(heat) + 2 * deep,
    hostility: def.hostility,
    guard: 0,
    atk: Math.round(
      def.atk * PACE.bite * (1 + 0.2 * depth) + PACE.atkStep * (w.stratum - 1) + 2 * deep,
    ),
    def: def.def,
    wil: def.wil,
    int: def.int,
    agi: def.agi,
    tags: [...def.tags],
    eps: [],
    clues: def.clues.map((id) => ({ id, shown: false })),
    move: null,
    intent: null,
    seen: false,
    st: {},
    history: [],
  };
  if (m.rival) {
    const r = m.rival;
    const s = rivalStats(w, r);
    f.name = r.name;
    f.maxHp = f.hp = Math.max(8, Math.round(r.hp * 1.2));
    f.maxResolve = f.resolve = 10 + 3 * s.WIL;
    f.atk = 2 + s.ATK;
    f.def = s.DEF;
    f.wil = s.WIL;
    f.int = s.INT;
    f.agi = s.AGI;
    f.clues = r.perms.slice(0, 5).map((id) => ({ id, shown: false }));
  }
  // 場所のエピテットのうち、人物にも意味を持つものが移る。
  for (const e of m.eps ?? []) {
    const ff = epithetDef(e)?.foe;
    if (!ff) continue;
    f.eps.push(e);
    if (ff.hp) f.maxHp = f.hp = Math.max(1, Math.round(f.hp * ff.hp));
    if (ff.resolve) f.maxResolve = f.resolve = Math.max(1, Math.round(f.resolve * ff.resolve));
    f.need = Math.max(1, f.need + (ff.need ?? 0));
    f.hostility = Math.max(0, Math.min(10, f.hostility + (ff.hostility ?? 0)));
    f.trust = Math.max(0, f.trust + (ff.trust ?? 0));
    f.atk = Math.max(0, f.atk + (ff.atk ?? 0));
    f.def = Math.max(0, f.def + (ff.def ?? 0));
    f.int = Math.max(0, f.int + (ff.int ?? 0));
    f.agi = Math.max(0, f.agi + (ff.agi ?? 0));
    if (ff.stun) f.st.stun = 1;
    if (ff.lies === 'always') f.st.liar = 1;
    if (ff.lies === 'never') f.st.honest = 1;
  }
  def.shape?.(w, f);
  // 退いた相手は、傷を半分だけ持ち越す（再戦）。
  const wound = w.flags[`wound:${npc}`] ?? 0;
  if (wound > 0) {
    f.hp = Math.max(1, Math.round(f.maxHp * (1 - wound / 200)));
    f.resolve = Math.max(1, Math.round(f.maxResolve * (1 - wound / 200)));
  }
  // 見せ場の相手は手強い（構成が噛み合えば、そのぶん稼げる）。
  if (m.stage?.length) {
    f.maxHp = f.hp = Math.round(f.hp * PACE.stageTough);
    f.maxResolve = f.resolve = Math.round(f.resolve * PACE.stageTough);
    f.need += 1;
  }
  return f;
}

/**
 * 遭遇の流れ。始める → あなたの手番（基本の行動か、カード）→ 相手が予告
 * どおりに動く → 相手が次の手を決める（ai.ts）→ あなたの手番。
 * 決着したら close で人物へ写す。
 */

// ─── 始める ───────────────────────────────────────────────────

export interface Meet {
  /** ライバルと会うとき、その人物。 */
  rival?: Char;
  /** その場所に刻まれたエピテット。 */
  eps?: readonly string[];
  /** もう一人が先に寄ったときの決着。 */
  after?: string;
  /** 見せ場のタグ。 */
  stage?: readonly Tag[];
  /** 最後の相手の手前に立つ番人として（ふだんより手強い）。 */
  keeper?: boolean;
}

export function startEnc(
  tx: Tx,
  who: Who,
  npc: string,
  tier: Foe['tier' & never] | 'normal' | 'danger' | 'boss' | 'rival',
  m: Meet = {},
): void {
  const w = tx.w;
  const late = Math.max(0, Math.round(tx.rule('lateness', { who }, 0)));
  const def = foeDef(npc);
  // 手持ちから五枚を配り直す（毎回ちがう五枚で向き合う）。
  deal(tx, who);
  const f = scaleFoe(w, npc, m, late);
  const stage = [...(m.stage ?? [])];
  tx.emit({ type: 'enc.start', who, foe: f, tier: tier as 'normal', stage });
  const e = w.enc;
  if (!e) return;
  // 初めの敵意と信頼（規則）。
  const host = Math.round(tx.rule('startHostility', { who }, 0));
  if (host) hostile(tx, host);
  const tr = Math.round(tx.rule('startTrust', { who }, 0));
  if (tr > 0)
    tx.emit({ type: 'foe', field: 'trust', n: Math.min(tr, e.foe.need - 1 - e.foe.trust) });
  // 認識世界。前の決着と、人づてに聞いた噂が、初めの構えを決める。
  if (who === 'you') {
    const mind = w.minds[npc];
    const p = portrait(mind);
    if (mind?.outcomes.beaten || mind?.outcomes.broken) hostile(tx, 3);
    if (mind?.outcomes.trusted)
      tx.emit({
        type: 'foe',
        field: 'trust',
        n: Math.max(0, Math.min(2, e.foe.need - 1 - e.foe.trust)),
      });
    if (p.violent > 0.4) {
      if (def.persona.fear >= 0.5)
        tx.emit({
          type: 'foe',
          field: 'resolve',
          n: -Math.min(e.foe.resolve - 1, Math.round(6 * p.violent)),
        });
      else hostile(tx, Math.round(3 * p.violent));
    }
    if (p.kind > 0.4 && def.persona.warmth > 0.3)
      tx.emit({
        type: 'foe',
        field: 'trust',
        n: Math.max(0, Math.min(1, e.foe.need - 1 - e.foe.trust)),
      });
    if (p.nosy > 0.4 || p.suspicion > 0.3) tx.emit({ type: 'foe.st', key: 'wary', n: 1 });
    if (mind?.met) line(tx, 'again');
    else if (mind?.heard) line(tx, 'heard');
    else line(tx, 'greet');
  }
  switch (m.after) {
    case 'beaten':
      tx.emit({ type: 'foe', field: 'hp', n: -Math.round(e.foe.hp * 0.3) });
      hostile(tx, 2);
      say(tx, 'voice', 'もう一人に、やられたあとだ。');
      break;
    case 'trusted':
      tx.emit({
        type: 'foe',
        field: 'trust',
        n: Math.max(0, Math.min(2, e.foe.need - 1 - e.foe.trust)),
      });
      say(tx, 'voice', 'もう一人と、もう打ち解けている。贈り物は向こうへ渡ったあとだ。');
      break;
    case 'uncovered':
      revealClue(tx);
      say(tx, 'voice', 'もう一人が、先に掘り返していた。');
      break;
    default:
      break;
  }
  for (const ep of m.eps ?? []) {
    const shown = (epithetDef(ep)?.foe?.show ?? 0) + (epithetDef(ep)?.place?.clue ?? 0);
    for (let i = 0; i < shown; i++) revealClue(tx);
  }
  if (who === 'you' && w.after.length) aftermath(tx);
  def.init?.(tx);
  if (statOf(w, who, 'AGI') >= e.foe.agi + 3) tx.emit({ type: 'foe.st', key: 'late', n: 1 });
  planFoe(tx);
  // 備え：その場で手にした品が、向き合った初めに効く（使ったら消える）。
  const prep = charOf(w, who).prep ?? [];
  if (who === 'you' && prep.length) {
    tx.emit({ type: 'prep.clear', who });
    for (const p of prep) {
      run(tx, p.fx, { mult: p.mult ?? 1, card: `prep:${p.name}`, slot: -1, first: false });
      tx.emit({ type: 'note', text: `備えの${p.name}が効いた。`, level: 1 });
    }
    settle(tx);
  }
}

/**
 * 決着の余韻が、遭遇の初めに効く（悪名と見透かしの規則は sources が持つ）。
 * 残りの数は、遭遇が終わるときに一つ減る（ops の end。「次の二戦」なら二戦目の終わりまで効く）。
 */
function aftermath(tx: Tx): void {
  const w = tx.w;
  const e = w.enc;
  if (!e) return;
  for (const a of w.after) {
    switch (a.kind) {
      case 'feared':
        tx.emit({
          type: 'foe',
          field: 'resolve',
          n: -Math.min(e.foe.resolve - 1, Math.round(e.foe.resolve * 0.3)),
        });
        say(tx, 'voice', '噂が先に着いていた。相手は、もう怯えている。');
        break;
      case 'ally':
        tx.emit({ type: 'enc.you', field: 'guard', n: 4 });
        tx.emit({ type: 'enc.you', field: 'calm', n: 4 });
        if (e.foe.need < 50)
          tx.emit({
            type: 'foe',
            field: 'trust',
            n: Math.max(0, Math.min(1, e.foe.need - 1 - e.foe.trust)),
          });
        say(tx, 'voice', `${foeDef(a.npc).name}が、そばにいる。`);
        break;
      case 'insight':
        revealClue(tx);
        break;
      case 'notorious':
        say(tx, 'voice', '悪名が先回りしていた。');
        break;
      case 'crash':
        say(tx, 'voice', '体が、まだ重い。');
        break;
    }
  }
}

function rivalStats(w: World, r: Char) {
  const saved = w.rival.char;
  w.rival.char = r;
  const s = stats(w, 'rival');
  w.rival.char = saved;
  return s;
}

// ─── あなたの手番 ─────────────────────────────────────────────

export const pressDamage = (w: World, who: Who) =>
  Math.max(1, 2 + statOf(w, who, 'ATK') - Math.floor((w.enc?.foe.def ?? 0) / 2));

/** 去る率の、上限で切る前の値（長引くほど相手も飽きて道が開く。開けすぎる鍵の流用にも使う）。 */
function rawLeave(w: World): number {
  const e = w.enc;
  if (!e) return 0;
  const f = e.foe;
  // 最後の相手からも退ける（再戦できる）。ただし退きにくい。
  return (
    (e.tier === 'boss' ? 30 : 50) +
    10 * (statOf(w, e.who, 'AGI') - f.agi) -
    4 * (f.hostility - 3) +
    6 * Math.max(0, e.turn - 4)
  );
}

export function leaveChance(w: World): number {
  const e = w.enc;
  if (!e) return 0;
  const f = e.foe;
  // 片道切符は、穏やかな相手や動けない相手からでも、立ち去れる見込みはいつも 5%。
  const oneWay = charOf(w, e.who).items.some((x) => x.id === 'one-way');
  if (f.hostility <= 2 || f.st.stun) return oneWay ? 5 : 100;
  const base = rawLeave(w);
  return Math.max(5, Math.min(100, Math.round(ask(w, 'leaveChance', {}, base))));
}

/** 取引に応じたときに払う金（実際に引かれる額。補正込み）。 */
export function acceptPrice(w: World): number {
  return Math.round(ask(w, 'price', {}, w.enc?.foe.intent?.price ?? 0));
}

export function canAccept(w: World): boolean {
  const i = w.enc?.foe.intent;
  const who = w.enc?.who ?? 'you';
  return (
    !!i &&
    i.kind === 'bargain' &&
    !i.lie &&
    charOf(w, who).coins >= Math.round(ask(w, 'price', {}, i.price ?? 0))
  );
}

export function basic(tx: Tx, a: Basic): boolean {
  const e = tx.w.enc;
  if (!e || e.phase !== 'act') return false;
  const who = e.who;
  const f = e.foe;
  const def = foeDef(f.id);
  switch (a) {
    case 'press': {
      let dmg = pressDamage(tx.w, who);
      if (tx.rand('enc') * 100 < 5 + 2 * statOf(tx.w, who, 'AGI')) {
        dmg *= 2;
        say(tx, 'voice', '会心。');
      }
      xp(tx, 'ATK', 1);
      hitFoe(tx, dmg);
      hostile(tx, 1);
      if (f.trust > 0) trust(tx, -1);
      break;
    }
    case 'brace':
      tx.emit({ type: 'enc.you', field: 'guard', n: 2 + statOf(tx.w, who, 'DEF') });
      tx.emit({ type: 'enc.you', field: 'calm', n: 1 + Math.floor(statOf(tx.w, who, 'WIL') / 3) });
      xp(tx, 'DEF', 1);
      break;
    case 'talk':
      xp(tx, 'WIL', 1);
      if (def.mute) say(tx, 'voice', '言葉は届かない。');
      else if ((def.hush || f.eps.includes('silent')) && !f.st.unhushed) {
        say(tx, 'foe', '……静かに。');
        hostile(tx, 2);
      } else if (f.hostility >= 7) hostile(tx, -1);
      else {
        // 話は、聞く耳のあるときに届く（相手の次の手を読む）。殴りかかろう、脅そうと
        // している相手には届かず、心を開きかけている相手にはひとつ多く届く。嘘の
        // 予告に乗せられていれば、本当の手のほうで決まる。
        const k = f.intent?.kind;
        const base = 1 + (statOf(tx.w, who, 'WIL') >= 6 ? 1 : 0);
        if (k === 'strike' || k === 'threat') say(tx, 'voice', '聞いていない。');
        else trust(tx, base + (TALK_OPEN.has(k ?? 'wait') ? 1 : 0));
        hostile(tx, -1);
      }
      break;
    case 'leave': {
      xp(tx, 'AGI', 1);
      const c = leaveChance(tx.w);
      if (c >= 100 || (c > 0 && roll(tx, 'AGI', c))) {
        end(tx, 'left');
        return true;
      }
      say(tx, 'voice', '道を塞がれた。');
      tx.emit({ type: 'foe.st', key: 'punish', n: 1 });
      break;
    }
    case 'accept': {
      if (!canAccept(tx.w)) return false;
      coins(tx, -Math.round(tx.rule('price', {}, f.intent?.price ?? 0)));
      tx.emit({ type: 'foe.st', key: 'dealt', n: 1 });
      say(tx, 'foe', '……取引成立だ。');
      if (!revealClue(tx)) trust(tx, 2);
      break;
    }
  }
  afterYou(tx);
  return true;
}

/** カードのエピテット（カードの面）と、その場の文脈。 */
function facets(c: Char, card: Card): { list: { id: string; f: CardFacet }[]; ctx: EpithetCtx } {
  const list = (card.eps ?? []).flatMap((id) => {
    const f = epithetDef(id)?.card;
    return f ? [{ id, f }] : [];
  });
  const others = c.cards
    .filter((x): x is Card => !!x && x.uid !== card.uid)
    .map((x) => cardTags(x));
  return { list, ctx: { card, char: c, tags: cardTags(card), others } };
}

/** 続けた数ごとの、連鎖の点（規則で上乗せされる前）。 */
export const chainPoints = (streak: number): number =>
  POINTS.chain[Math.min(streak, POINTS.chain.length - 1)] ?? 0;

/**
 * いま札を使ったら、効き目一つ一つに足される点と、その内訳（画面に出す）。
 * 連鎖・書き留め・見せ場・弱いタグ・守るタグ・原型の答え。
 */
export function bonusOf(
  w: World,
  card: Card,
): { total: number; parts: { text: string; n: number }[] } {
  const e = w.enc;
  const parts: { text: string; n: number }[] = [];
  if (!e) return { total: 0, parts };
  const who = e.who;
  const tags = cardTags(card);
  const streak = chainNext(w, tags);
  if (streak > 0) {
    const n = ask(w, 'chain', { who, tags }, chainPoints(streak));
    parts.push({ text: `連鎖 +${n}`, n });
  }
  if (e.st.noted) parts.push({ text: `書き留め +${POINTS.noted}`, n: POINTS.noted });
  const ctx = {
    w,
    who,
    enc: e,
    tags,
    arch: cardArch(card),
    card: card.id,
    spent: card.uses <= 0,
  };
  let v = 0;
  for (const p of bookOf(w).patches.bonus ?? []) {
    if (p.when && !p.when(ctx)) continue;
    const next = p.fn(ctx, v);
    if (next !== v) parts.push({ text: p.text, n: next - v });
    v = next;
  }
  return { total: parts.reduce((a, x) => a + x.n, 0), parts };
}

/** いま札を使えば、何連鎖目になるか（0 なら連鎖しない）。 */
export function chainNext(w: World, tags: readonly Tag[]): number {
  const e = w.enc;
  if (!e || !e.last.some((t) => tags.includes(t))) return 0;
  return (e.st.chain ?? 0) + 1;
}

/**
 * その枠の札を、いま使えるか。回数の尽きた札は、眠りぎわの顔で遭遇ごとに一度だけ使える
 * （最後のひと押し）。二度目は無い。札を使い切ると、終わりが近づく。
 */
export function canUseCard(w: World, slot: number): boolean {
  const e = w.enc;
  const card = e ? charOf(w, e.who).cards[slot] : null;
  if (!e || !card) return false;
  return card.uses > 0 || !e.st[`gasp${card.uid}`];
}

export function useCard(tx: Tx, slot: number): boolean {
  const w = tx.w;
  const e = w.enc;
  if (!e || e.phase !== 'act') return false;
  const who = e.who;
  const c = charOf(w, who);
  const card = c.cards[slot];
  if (!card || !canUseCard(w, slot)) return false;
  const def = cardDef(card.id);
  const { list, ctx } = facets(c, card);
  const tags = ctx.tags;
  const arch = cardArch(card);
  const spent = card.uses <= 0;
  const has = (k: keyof CardFacet) => list.some((x) => !!x.f[k]);
  // 倍率。規則（ビルド・職・原型・弱点）→ 連鎖 → 書き留め → エピテット。
  let mult = tx.rule('mult', { who, tags, arch, card: def.id, spent }, 1);
  // 連鎖：直前の札とタグが重なると強くなり、続けるほど重なる（三つ目で頭打ち）。
  const chained = e.last.some((t) => tags.includes(t)) || list.some((x) => x.id === 'fervent');
  const streak = chained ? (e.st.chain ?? 0) + 1 : 0;
  if (streak !== (e.st.chain ?? 0))
    tx.emit({ type: 'enc.st', key: 'chain', n: streak - (e.st.chain ?? 0) });
  // 点：連鎖・書き留め・見せ場・弱いタグ…（倍率とは別に、効き目ごとに足す）。
  let bonus = chained ? tx.rule('chain', { who, tags }, chainPoints(streak)) : 0;
  bonus += tx.rule('bonus', { who, tags, arch, card: def.id, spent }, 0);
  if (e.st.noted) {
    bonus += POINTS.noted;
    tx.emit({ type: 'enc.st', key: 'noted', n: -(e.st.noted ?? 0) });
  }
  for (const x of list) if (x.f.mult) mult *= x.f.mult(w, ctx);
  for (const x of list) {
    if (x.f.variance) {
      const [lo, hi] = x.f.variance;
      mult *= lo + (hi - lo) * tx.rand('enc');
    }
  }
  const dormKey = `dorm${slot}`;
  if (has('dormant')) {
    if (!e.st[dormKey]) {
      tx.emit({ type: 'enc.st', key: dormKey, n: 1 });
      mult = 0;
    } else mult *= 2;
  }
  const free =
    tx.rule('useSpend', { who, card: def.id, spent }, 1) === 0 ||
    list.some((x) => x.f.free?.(w, card.id) ?? false);
  const quiet = has('quiet');
  tx.emit({ type: 'card.use', who, slot, card: card.id, spent, free, quiet, tags: [...tags] });
  for (const s of def.stats) xp(tx, s, has('fixed') ? 0 : 1);
  if (list.some((x) => x.id === 'recorded')) for (const s of def.stats) xp(tx, s, 1);
  const twice = has('twice');
  if (spent) {
    tx.emit({ type: 'card.mark', who, slot, mark: 'spent', n: 1 });
    tx.emit({ type: 'enc.st', key: `gasp${card.uid}`, n: 1 });
  } else {
    if (!free)
      tx.emit({
        type: 'card.uses',
        who,
        slot,
        n: twice && !list.some((x) => x.id === 'torn') ? -2 : -1,
      });
    tx.emit({ type: 'card.mark', who, slot, mark: 'used', n: 1 });
  }
  const fx = spent ? def.spent : def.ready;
  const first = (card.marks.used ?? 0) + (card.marks.spent ?? 0) <= 1;
  const fctx = {
    mult,
    bonus,
    card: card.id,
    slot,
    first,
    invert: has('invert'),
    pierce: has('pierce'),
    fixed: has('fixed'),
    cold: has('cold'),
    rusty: spent && has('rusty'),
  };
  if (mult > 0) {
    for (let i = 0; i < (twice ? 2 : 1); i++) run(tx, fx, fctx);
    for (const x of list) if (x.f.after) run(tx, x.f.after, { ...fctx, mult: 1, bonus: 0 });
    if (list.some((x) => x.id === 'echoing')) run(tx, fx, { ...fctx, mult: mult * 0.4 });
    if (list.some((x) => x.id === 'false'))
      tx.emit({ type: 'claim', about: 'harmless', truth: false });
    // 連鎖の二つ目からは、相手がよろめく（台詞は画面だけ）。
    if (streak >= 2) quip(tx, 'stagger');
  } else say(tx, 'voice', 'まだ、目覚めていない。');
  for (const x of list) if (x.f.host) hostile(tx, x.f.host);
  if (list.some((x) => x.id === 'borrowed') && w.enc)
    tx.emit({ type: 'debt', who, npc: w.enc.foe.id, n: 1 });
  if (has('burn') && card.max > 1) tx.emit({ type: 'card.max', who, slot, n: -1 });
  // 隠し効果。条件がそろうと現れ、初めて現れたときに明らかになる。
  const h = def.hidden;
  if (h && w.enc?.phase === 'act' && holds(tx, h.when, fctx)) {
    run(tx, h.fx, { ...fctx, mult: 1, bonus: 0 });
    if (who === 'you' && !w.found.includes(h.id)) {
      tx.emit({ type: 'found', id: h.id });
      say(tx, 'voice', `隠し効果：${h.text}`);
    }
  }
  afterYou(tx);
  return true;
}

function afterYou(tx: Tx): void {
  settle(tx);
  const e = tx.w.enc;
  if (!e || e.phase !== 'act') return;
  wince(tx);
  foeTurn(tx);
}

/** 相手が初めて深く傷ついたとき・崩れかけたときの一言（それぞれ一度だけ）。 */
function wince(tx: Tx): void {
  const f = tx.w.enc?.foe;
  if (!f || tx.sim) return;
  const low = f.hp < f.maxHp * 0.25 || f.resolve < f.maxResolve * 0.25;
  const hurt = f.hp < f.maxHp * 0.6;
  const kind = low && !f.st.saidLow ? 'low' : hurt && !f.st.saidHurt ? 'hurt' : null;
  if (!kind || !quip(tx, kind)) return;
  tx.emit({ type: 'foe.st', key: kind === 'low' ? 'saidLow' : 'saidHurt', n: 1 });
  if (kind === 'low' && !f.st.saidHurt) tx.emit({ type: 'foe.st', key: 'saidHurt', n: 1 });
}

// ─── 相手の手番 ───────────────────────────────────────────────

function foeTurn(tx: Tx): void {
  const w = tx.w;
  const e = w.enc;
  if (!e) return;
  const f = e.foe;
  if (f.guard) tx.emit({ type: 'foe', field: 'guard', n: -f.guard });
  const def = foeDef(f.id);
  const move = def.moves.find((m) => m.id === f.move);
  if (f.st.late) {
    tx.emit({ type: 'foe.st', key: 'late', n: -1 });
    say(tx, 'voice', `${f.name}は出遅れた。`);
  } else if (f.st.stun) {
    tx.emit({ type: 'foe.st', key: 'stun', n: -(f.st.stun ?? 1) });
    say(tx, 'voice', `${f.name}は動けない。`);
  } else if (move) {
    if (f.intent?.kind === 'bargain' && !f.st.dealt && !f.intent.lie) hostile(tx, 1);
    const you = charOf(w, e.who);
    const [hp, mind] = [you.hp, you.mind];
    tx.emit({ type: 'act', move: move.id });
    move.act(tx);
    // 手が当たったら、ときどき一言。
    if (you.hp < hp || you.mind < mind) quip(tx, 'taunt', 0.45);
  }
  for (const k of ['dealt', 'punish', 'cut'] as const)
    if (w.enc?.foe.st[k]) tx.emit({ type: 'foe.st', key: k, n: -(w.enc.foe.st[k] ?? 0) });
  settle(tx);
  if (!w.enc || w.enc.phase !== 'act') return;
  tx.emit({ type: 'turn' });
  tempo(tx);
  if (!w.enc || w.enc.phase !== 'act') return;
  // 流用：残った守りが信頼に、開けすぎる鍵が相手の守りを剥がす。
  const spill = Math.floor(w.enc.guard * tx.rule('guardSpill', {}, 0));
  if (spill > 0) trust(tx, spill);
  const open = Math.round(tx.rule('leaveChance', {}, rawLeave(w)) - 100);
  const peel = open > 0 ? Math.floor((open / 10) * tx.rule('openSpill', {}, 0)) : 0;
  if (peel > 0 && w.enc?.phase === 'act')
    tx.emit({ type: 'foe', field: 'guard', n: Math.max(-w.enc.foe.guard, -peel) });
  if (!w.enc || w.enc.phase !== 'act') return;
  // 長引いた遭遇は、相手が苛立って強くなる（膠着しない。最後の相手も同じ）。
  if (w.enc.turn > PACE.stall) {
    if (w.enc.turn === PACE.stall + 1) say(tx, 'voice', '相手の苛立ちが、目に見えて増していく。');
    // 体への手も、心への手も（構えと落ち着きを固めても、いずれ崩れる）。
    const n = 1 + Math.floor((w.enc.turn - PACE.stall) / 4);
    tx.emit({ type: 'foe', field: 'atk', n });
    tx.emit({ type: 'foe', field: 'wil', n });
  }
  const keepG = tx.rule('guardKeep', {}, 0);
  const g = Math.floor(w.enc.guard * keepG) + Math.round(tx.rule('turnGuard', {}, 0));
  if (g !== w.enc.guard) tx.emit({ type: 'enc.you', field: 'guard', n: g - w.enc.guard });
  const keepC = tx.rule('calmKeep', {}, 0.5);
  const cm = Math.floor(w.enc.calm * keepC) + Math.round(tx.rule('turnCalm', {}, 0));
  if (cm !== w.enc.calm) tx.emit({ type: 'enc.you', field: 'calm', n: cm - w.enc.calm });
  planFoe(tx);
}

/**
 * 拍子の崩れ。戦闘と交渉で進み方を変え、遭遇の途中で調子が一度は変わる。
 *   体力が半分を切る    相手が本気になる（敵意 +2、それからの一撃 +3）
 *   意志が半分を切る    相手が揺らぐ（敵意 −2、信頼 +1）
 *   信頼が半分を超える  打ち明け話（相手は次の手番に動かず、手がかりを一つ見せる。
 *                       それからは信頼が一つずつ多く伸びる。交渉は後半で加速する）
 *   三手目から          ときどき邪魔が入る（遭遇に一度まで）
 */
function tempo(tx: Tx): void {
  const e = tx.w.enc;
  if (!e || e.phase !== 'act') return;
  const f = e.foe;
  if (!f.st.rage && f.hp * 2 < f.maxHp) {
    tx.emit({ type: 'foe.st', key: 'rage', n: 1 });
    hostile(tx, 2);
    say(tx, 'voice', `${f.name}が、本気になった。`);
  }
  if (!f.st.waver && f.resolve * 2 < f.maxResolve) {
    tx.emit({ type: 'foe.st', key: 'waver', n: 1 });
    hostile(tx, -2);
    trust(tx, 1);
    say(tx, 'voice', `${f.name}の目が泳いだ。`);
  }
  if (!tx.w.enc || tx.w.enc.phase !== 'act') return;
  if (!f.st.opened && f.need < 50 && f.trust * 2 >= f.need) {
    tx.emit({ type: 'foe.st', key: 'opened', n: 1 });
    tx.emit({ type: 'foe.st', key: 'stun', n: 1 });
    revealClue(tx);
    say(tx, 'voice', `${f.name}が、ぽつりと打ち明けはじめた。`);
  }
  if (!tx.w.enc || tx.w.enc.phase !== 'act') return;
  if (e.turn >= 3 && !e.st.interrupted && tx.rand('enc') < PACE.interrupt) {
    tx.emit({ type: 'enc.st', key: 'interrupted', n: 1 });
    switch (Math.floor(tx.rand('enc') * 4)) {
      case 0:
        tx.emit({ type: 'foe.st', key: 'stun', n: 1 });
        say(tx, 'voice', 'どこかで電話が鳴った。相手が気を取られている。');
        break;
      case 1:
        if (e.guard) tx.emit({ type: 'enc.you', field: 'guard', n: -e.guard });
        if (f.guard) tx.emit({ type: 'foe', field: 'guard', n: -f.guard });
        hostile(tx, 1);
        say(tx, 'voice', '誰かが割って入った。どちらの構えも崩れた。');
        break;
      case 2:
        tx.emit({ type: 'enc.st', key: 'noted', n: 1 });
        say(tx, 'voice', '灯りが大きく揺れた。次の一手が冴える。');
        break;
      default:
        tx.emit({ type: 'vital', who: e.who, mind: 3 });
        say(tx, 'voice', '店の奥から、黙って水が出てきた。');
        break;
    }
  }
}

/** 予告を、見せるとおりに（嘘は、見抜けていなければ見かけで）。 */
export function shownIntent(w: World) {
  const e = w.enc;
  const i = e?.foe.intent;
  if (!e || !i) return null;
  if (!i.lie) return i;
  const visible =
    e.foe.seen || ask(w, 'intentVisible', {}, 0) >= 1 || statOf(w, e.who, 'INT') >= e.foe.int + 3;
  return visible ? i : { kind: i.seem ?? 'wait', label: i.seemLabel ?? '……', price: i.price };
}

/** 見えている次の手で、あなたが失いそうな分（守りと落ち着きを引く前）。 */
export function incoming(w: World): { hp: number; mind: number } {
  const i = shownIntent(w);
  if (!i?.power) return { hp: 0, mind: 0 };
  if (i.kind === 'strike') return { hp: strikeValue(w, i.power), mind: 0 };
  if (i.kind === 'threat') return { hp: 0, mind: threatValue(w, i.power) };
  return { hp: 0, mind: 0 };
}

// ─── 決着を写す ───────────────────────────────────────────────

/** カードの回復条件・最大回数・酷使の変質。あなたにもライバルにも同じ規則で。 */
export function cardsAfter(
  tx: Tx,
  who: Who,
  outcome: Outcome,
  log: { cards: number; lies: number; caught: number; hostility: number },
): void {
  const on: string[] = [];
  if (outcome === 'beaten') on.push('win');
  if (outcome === 'broken') on.push('broken', 'win');
  if (outcome === 'trusted') on.push('trusted');
  if (outcome === 'uncovered') on.push('uncover');
  if (outcome === 'left' && log.hostility < 7) on.push('left');
  if (log.lies > 0 && log.caught === 0) on.push('lieKept');
  if (log.cards === 0 && outcome !== 'fallen' && outcome !== 'shattered') on.push('quiet');
  // 決着の形に合う札のうち、尽きた一枚だけが息を吹き返す（一回ぶん）。
  const c = charOf(tx.w, who);
  const at = c.cards.findIndex(
    (card) => !!card && card.uses <= 0 && cardDef(card.id).recover.on.some((t) => on.includes(t)),
  );
  if (at >= 0) tx.emit({ type: 'card.uses', who, slot: at, n: 1 });
  shiftAll(tx, who);
  overuse(tx, who);
}

/** 使い方で最大回数が動く（嘘を酷使すると増え、虚言癖がつく）。 */
export function shiftAll(tx: Tx, who: Who): void {
  const c = charOf(tx.w, who);
  c.cards.forEach((card, slot) => {
    if (!card) return;
    const sh = cardDef(card.id).shift;
    if (!sh) return;
    const count = Math.floor((card.marks[sh.on] ?? 0) / sh.every);
    const done = card.marks.shifted ?? 0;
    if (count <= done || card.max >= sh.cap) return;
    const add = Math.min(count - done, sh.cap - card.max);
    tx.emit({ type: 'card.max', who, slot, n: add });
    tx.emit({ type: 'card.mark', who, slot, mark: 'shifted', n: count - done });
    if (sh.perm) gainPerm(tx, sh.perm, card.id, who);
  });
}

export function transform(tx: Tx, who: Who, slot: number, to: string, why: string): void {
  const c = charOf(tx.w, who);
  const old = c.cards[slot];
  if (!old) return;
  const def = cardDef(to);
  const more = epUses(old.eps ?? []);
  tx.emit({
    type: 'card.set',
    who,
    slot,
    card: {
      uid: c.uid,
      id: to,
      uses: def.uses + more,
      max: def.uses + more,
      marks: {},
      eps: [...(old.eps ?? [])],
    },
    why,
  });
}

function overuse(tx: Tx, who: Who): void {
  const c = charOf(tx.w, who);
  c.cards.forEach((card, slot) => {
    if (!card || (card.eps ?? []).includes('amber') || (card.eps ?? []).includes('forgotten'))
      return;
    const o = cardDef(card.id).alter?.overuse;
    if (o && (card.marks.spent ?? 0) >= o.need) transform(tx, who, slot, o.to, 'overuse');
  });
}

/** 遭遇の褒美（金・品・記憶）。ライバルが先に打ち解けていれば、贈り物は無い。 */
export function rewards(tx: Tx, who: Who, npc: string, outcome: Outcome, after?: string): string[] {
  const notes: string[] = [];
  const r = foeDef(npc).rewards[outcome];
  if (!r) return notes;
  const borrowed = tx.w.enc?.foe.eps.includes('borrowed');
  if (r.coins && !(borrowed && outcome === 'beaten')) {
    coins(tx, r.coins, who);
    notes.push(`金 ${r.coins}`);
  }
  if (r.item && giveItem(tx, r.item, who)) notes.push(gearOf(r.item)?.name ?? r.item);
  if (r.perm && !(after === 'trusted' && outcome === 'trusted')) gainPerm(tx, r.perm, npc, who);
  return notes;
}

export const hasBuild = (w: World, id: string) => buildsOf(w.you).some((b) => b.id === id);
export const permName = (id: string) => permDef(id)?.name ?? id;
export const chanceFor = chance;

/**
 * 共鳴。遭遇のあいだに実際に値を動かした構成の出どころ（カード・記憶・
 * ビルド・連携・原型・エピテット）の数だけ、見返りがある。噛み合わせるほど
 * 強くなる（相互作用の多い道を通る理由）。
 *   2 以上  金 2×数。関わったカードの能力値に経験 +1
 *   3 以上  関わったカードの最大回数 +1（元の回数 +2 まで）
 *   4 以上  エピテットを 1 つ拾う
 *   6 以上  体力と精神が 3 割戻る
 */
export function resonance(w: World): string[] {
  return Object.keys(w.enc?.st ?? {})
    .filter((k) => k.startsWith('r:'))
    .map((k) => k.slice(2));
}

export function resonate(tx: Tx, who: Who): string[] {
  const list = resonance(tx.w);
  const n = list.length;
  const notes: string[] = [];
  if (n < 2) return notes;
  coins(tx, 2 * n, who);
  for (const src of list) {
    const [kind, , id] = src.split(':');
    if (kind === 'card' && id) for (const s of cardDef(id).stats) xp(tx, s, 1, who);
  }
  notes.push(`共鳴 ${n}`);
  if (n >= 3) {
    // 輝いたカードは育つ（最大回数 +1。元の回数 +2 まで）。
    const ch = charOf(tx.w, who);
    for (const src of list) {
      const [kind, slot, id] = src.split(':');
      const i = Number(slot);
      const card = ch.cards[i];
      if (kind !== 'card' || !id || !card || card.id !== id || card.max >= cardDef(id).uses + 2)
        continue;
      tx.emit({ type: 'card.max', who, slot: i, n: 1 });
      notes.push(`『${cardDef(id).name}』の回数 +1`);
    }
  }
  if (n >= 4 && tx.rand('loot') < PACE.epGlow) {
    // 大きく共鳴すると、ときどき、輝いた札の一枚にエピテットが宿る（拾える語から）。
    const ch = charOf(tx.w, who);
    const lit = list.flatMap((src) => {
      const [kind, slot] = src.split(':');
      const i = Number(slot);
      const card = ch.cards[i];
      return kind === 'card' && card && card.eps.length < PACE.stack ? [i] : [];
    });
    const i = tx.pick('loot', lit);
    const ep = tx.pick('loot', poolEpithets());
    const card = i !== undefined ? ch.cards[i] : undefined;
    if (i !== undefined && ep && card) {
      markEp(tx, who, { slot: i }, ep.id, true);
      notes.push(`『${cardDef(card.id).name}』に《${ep.name}》`);
    }
  }
  if (n >= 6) {
    const s = stats(tx.w, who);
    heal(tx, Math.round(maxHp(s) * 0.3), Math.round(maxMind(s) * 0.3), who);
  }
  return notes;
}
