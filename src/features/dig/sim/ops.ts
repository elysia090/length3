import { memoryMods, tagCount } from '../content/cardinfo';
import { cardDef, foeDef, permDef } from '../content/registry';
import type { Char, Claim, Enc, Foe, Outcome, Stat, StatBlock, Who, World } from '../core/model';
import { STATS, zeroStats } from '../core/model';
import type { Tag, TagCount } from '../core/tags';
import type { Tx } from '../core/tx';

/**
 * 小さな操作。カードの効き目も、相手の手も、ここを通ってイベントになる。
 * 数はどれも規則（tx.rule）を通すので、パッチがかかる。
 */

export const charOf = (w: World, who: Who): Char => (who === 'you' ? w.you : w.rival.char);
export const actor = (tx: Tx): Who => tx.w.enc?.who ?? 'you';

// ─── 能力値とタグ ─────────────────────────────────────────────

export function stats(w: World, who: Who): StatBlock {
  const c = charOf(w, who);
  const out = zeroStats();
  for (const s of STATS) out[s] = c.innate[s] + c.growth[s];
  for (const id of c.perms) {
    const d = permDef(id);
    const k = memoryMods(c, id);
    for (const s of STATS) out[s] += Math.round((d?.mods?.[s] ?? 0) * k);
    if (d?.dyn && w.enc?.who === who) for (const s of STATS) out[s] += d.dyn(w, s);
  }
  for (const s of STATS) out[s] = Math.max(0, out[s]);
  return out;
}

export const statOf = (w: World, who: Who, s: Stat) => stats(w, who)[s];
export const maxHp = (s: StatBlock) => 16 + 4 * s.VIT;
export const maxMind = (s: StatBlock) => 8 + 3 * s.WIL;

/** 持っているタグ（ACTIVE の 5 枚とエピテット、PERMANENT）。 */
export const tagsOf = (c: Char): TagCount => tagCount(c);

export const xpNeed = (level: number) => 3 + 2 * level;

// ─── 判定 ─────────────────────────────────────────────────────

export function chance(tx: Tx, s: Stat | readonly Stat[], base: number, card?: string): number {
  const who = actor(tx);
  const list = typeof s === 'string' ? [s] : s;
  const st = stats(tx.w, who);
  const v = list.reduce((a, x) => a + st[x], 0) / list.length;
  const c = tx.rule('checkChance', { who, stat: list.join('+'), card }, base + 8 * v);
  return Math.max(5, Math.min(95, Math.round(c)));
}

export function roll(tx: Tx, s: Stat | readonly Stat[], pct: number): boolean {
  const r = Math.floor(tx.rand('enc') * 100);
  const ok = r < pct;
  const list = typeof s === 'string' ? [s] : s;
  for (const x of list) xp(tx, x, ok ? 2 : 1);
  tx.emit({ type: 'check', stat: list.join('+'), chance: pct, roll: r, ok });
  return ok;
}

export function xp(tx: Tx, s: Stat, n: number, who: Who = actor(tx)): void {
  tx.emit({ type: 'xp', who, stat: s, n });
  const c = charOf(tx.w, who);
  while (c.xp[s] >= xpNeed(c.growth[s])) {
    tx.emit({ type: 'xp', who, stat: s, n: -xpNeed(c.growth[s]) });
    tx.emit({ type: 'grew', who, stat: s });
  }
}

// ─── 相手への働きかけ ─────────────────────────────────────────

const enc = (tx: Tx): Enc | null => (tx.w.enc && tx.w.enc.phase === 'act' ? tx.w.enc : null);

export function hitFoe(tx: Tx, base: number, pierce = false): number {
  const e = enc(tx);
  if (!e) return 0;
  let amount = Math.max(0, Math.round(tx.rule('hit', { who: e.who }, base)));
  if (!pierce && e.foe.guard > 0) {
    const g = Math.min(e.foe.guard, amount);
    tx.emit({ type: 'foe', field: 'guard', n: -g, by: e.who });
    amount -= g;
  }
  if (amount > 0) tx.emit({ type: 'foe', field: 'hp', n: -amount, by: e.who });
  settle(tx);
  return amount;
}

export function breakFoe(tx: Tx, base: number): number {
  const e = enc(tx);
  if (!e) return 0;
  const amount = Math.max(0, Math.round(tx.rule('break', { who: e.who }, base)));
  if (amount > 0) tx.emit({ type: 'foe', field: 'resolve', n: -amount, by: e.who });
  settle(tx);
  return amount;
}

export function trust(tx: Tx, n: number): void {
  const e = enc(tx);
  if (!e || n === 0) return;
  const d =
    n > 0
      ? Math.max(0, Math.round(tx.rule('trust', { who: e.who }, n)))
      : Math.max(-e.foe.trust, n);
  if (d) tx.emit({ type: 'foe', field: 'trust', n: d, by: e.who });
  settle(tx);
}

export function hostile(tx: Tx, n: number): void {
  const e = enc(tx);
  if (!e || n === 0) return;
  const d = Math.round(tx.rule('hostility', { who: e.who }, n));
  const next = Math.max(0, Math.min(10, e.foe.hostility + d));
  if (next !== e.foe.hostility)
    tx.emit({ type: 'foe', field: 'hostility', n: next - e.foe.hostility, by: e.who });
}

/** 手がかりを 1 つ見る。fake なら誤りが混じることがある。見られたら true。 */
export function revealClue(tx: Tx, fake = false): boolean {
  const e = enc(tx);
  if (!e) return false;
  if (fake) {
    const pct = tx.rule('falseChance', { who: e.who }, 30);
    if (tx.rand('enc') * 100 < pct) {
      tx.emit({ type: 'clue', id: 'false-lead', shown: true, false: true });
      settle(tx);
      return true;
    }
  }
  const hidden = e.foe.clues.filter((c) => !c.shown && !c.false);
  const c = tx.pick('enc', hidden);
  if (!c) return false;
  tx.emit({ type: 'clue', id: c.id, shown: true });
  permDef(c.id)?.exploit?.show?.(tx);
  settle(tx);
  return true;
}

export function see(tx: Tx): void {
  const e = enc(tx);
  if (e && !e.foe.seen) tx.emit({ type: 'seen' });
}

export function stun(tx: Tx): void {
  if (enc(tx)) tx.emit({ type: 'foe.st', key: 'stun', n: 1 });
}

/** 相手の次の攻撃・威嚇を弱める（書き換える）。 */
export function cut(tx: Tx, n: number): void {
  if (enc(tx) && n > 0) tx.emit({ type: 'foe.st', key: 'cut', n });
}

export function expose(tx: Tx, n: number): void {
  const e = enc(tx);
  if (e && n > 0) tx.emit({ type: 'foe', field: 'def', n: -Math.min(n, e.foe.def), by: e.who });
}

export function claim(tx: Tx, about: Claim['about'], truth: boolean): void {
  if (enc(tx)) tx.emit({ type: 'claim', about, truth });
}

// ─── 自分への働きかけ ─────────────────────────────────────────

export function guard(tx: Tx, n: number): void {
  if (enc(tx) && n > 0) tx.emit({ type: 'enc.you', field: 'guard', n: Math.round(n) });
}

export function calm(tx: Tx, n: number): void {
  if (enc(tx) && n > 0) tx.emit({ type: 'enc.you', field: 'calm', n: Math.round(n) });
}

export function hurt(tx: Tx, base: number): number {
  const e = tx.w.enc;
  if (!e) return 0;
  let amount = Math.max(0, Math.round(tx.rule('strikeTaken', { who: e.who }, base)));
  const g = Math.min(e.guard, amount);
  if (g) tx.emit({ type: 'enc.you', field: 'guard', n: -g });
  amount -= g;
  if (amount > 0) {
    tx.emit({ type: 'vital', who: e.who, hp: -amount });
    xp(tx, 'VIT', 1, e.who);
  }
  settle(tx);
  return amount;
}

export function hurtMind(tx: Tx, base: number): number {
  const e = tx.w.enc;
  if (!e) return 0;
  let amount = Math.max(0, Math.round(tx.rule('threatTaken', { who: e.who }, base)));
  const g = Math.min(e.calm, amount);
  if (g) tx.emit({ type: 'enc.you', field: 'calm', n: -g });
  amount -= g;
  if (amount > 0) {
    tx.emit({ type: 'vital', who: e.who, mind: -amount });
    xp(tx, 'WIL', 1, e.who);
  }
  settle(tx);
  return amount;
}

export function heal(tx: Tx, hp: number, mind = 0, who: Who = actor(tx)): void {
  const c = charOf(tx.w, who);
  const s = stats(tx.w, who);
  const h = Math.min(Math.round(tx.rule('heal', { who, kind: 'hp' }, hp)), maxHp(s) - c.hp);
  const m = Math.min(Math.round(tx.rule('heal', { who, kind: 'mind' }, mind)), maxMind(s) - c.mind);
  if (h > 0 || m > 0) tx.emit({ type: 'vital', who, hp: Math.max(0, h), mind: Math.max(0, m) });
}

/** 代償。守りも構えも通さない。 */
export function cost(tx: Tx, hp: number, mind = 0, who: Who = actor(tx)): void {
  const h = Math.max(0, Math.round(tx.rule('selfCost', { who, kind: 'hp' }, hp)));
  const m = Math.max(0, Math.round(tx.rule('selfCost', { who, kind: 'mind' }, mind)));
  if (h || m) tx.emit({ type: 'vital', who, hp: -h, mind: -m });
  settle(tx);
}

export function coins(tx: Tx, n: number, who: Who = actor(tx)): void {
  const c = charOf(tx.w, who);
  const d = n > 0 ? Math.round(tx.rule('coins', { who }, n)) : Math.max(-c.coins, n);
  if (d) tx.emit({ type: 'coins', who, n: d });
}

export function gainPerm(tx: Tx, id: string, why: string, who: Who = actor(tx)): void {
  if (!permDef(id) || charOf(tx.w, who).perms.includes(id)) return;
  tx.emit({ type: 'perm', who, id, gain: true, why });
}

export function losePerm(tx: Tx, id: string, why: string, who: Who = actor(tx)): void {
  if (!charOf(tx.w, who).perms.includes(id)) return;
  tx.emit({ type: 'perm', who, id, gain: false, why });
}

export function loseItem(tx: Tx, who: Who = actor(tx)): void {
  const c = charOf(tx.w, who);
  const item = tx.pick('enc', c.items);
  if (item) tx.emit({ type: 'item', who, id: item, n: -1 });
  else coins(tx, -Math.ceil(c.coins / 2), who);
}

export function say(tx: Tx, who: 'foe' | 'you' | 'voice', text: string): void {
  if (!tx.sim) tx.emit({ type: 'say', who, text });
}

export function line(tx: Tx, kind: string): void {
  const e = tx.w.enc;
  if (!e || tx.sim) return;
  const lines = foeDef(e.foe.id).lines[kind as keyof ReturnType<typeof foeDef>['lines']] ?? [];
  const text = lines.length ? lines[Math.floor(tx.rand('story') * lines.length)] : undefined;
  if (text) say(tx, 'foe', text);
}

// ─── カードの回数 ─────────────────────────────────────────────

/** タグを持つカードの回数を戻す（tag が無ければ全部）。 */
export function refill(tx: Tx, n: number, tag?: Tag, who: Who = actor(tx), rested = false): void {
  charOf(tx.w, who).cards.forEach((card, slot) => {
    if (!card || card.uses >= card.max) return;
    const def = cardDef(card.id);
    if (tag && !def.tags.includes(tag)) return;
    if (rested && def.recover.restOnly) return;
    tx.emit({ type: 'card.uses', who, slot, n });
    if (rested) tx.emit({ type: 'card.mark', who, slot, mark: 'rested', n: 1 });
  });
}

// ─── 決着 ─────────────────────────────────────────────────────

export function end(tx: Tx, outcome: Outcome): void {
  const e = tx.w.enc;
  if (!e || e.phase !== 'act') return;
  if (['beaten', 'broken', 'trusted', 'uncovered', 'fled'].includes(outcome)) line(tx, outcome);
  tx.emit({ type: 'enc.end', outcome });
}

export function settle(tx: Tx): void {
  const e = tx.w.enc;
  if (!e || e.phase !== 'act') return;
  const c = charOf(tx.w, e.who);
  const f: Foe = e.foe;
  const all = f.clues.length > 0 && f.clues.every((x) => x.shown) && f.clues.some((x) => !x.false);
  const out: Outcome | null =
    c.hp <= 0
      ? 'fallen'
      : c.mind <= 0
        ? 'shattered'
        : f.hp <= 0
          ? 'beaten'
          : f.resolve <= 0
            ? 'broken'
            : f.trust >= f.need
              ? 'trusted'
              : all
                ? 'uncovered'
                : null;
  if (out) end(tx, out);
}

// ─── 相手の手の値 ─────────────────────────────────────────────

/** 相手の攻撃が、あなたの体力をどれだけ削るか（予告に出す値）。 */
export function strikeValue(w: World, power: number): number {
  const e = w.enc;
  if (!e) return power;
  const f = e.foe;
  const backup = (f.st.backup ?? 0) * 2;
  const punish = f.st.punish ? 2 : 0;
  const cutBy = f.st.cut ?? 0;
  return Math.max(0, power + backup + punish - cutBy - Math.floor(statOf(w, e.who, 'DEF') / 2));
}

export function threatValue(w: World, power: number): number {
  const e = w.enc;
  if (!e) return power;
  const cutBy = e.foe.st.cut ?? 0;
  return Math.max(0, power - cutBy - Math.floor(statOf(w, e.who, 'WIL') / 3));
}
