import type { Claim, Stat } from '../core/model';
import { TAG_NAME, type Tag } from '../core/tags';
import type { Tx } from '../core/tx';
import {
  actor,
  breakFoe,
  calm,
  chance,
  charOf,
  claim,
  coins,
  cost,
  cut,
  end,
  expose,
  gainPerm,
  guard,
  heal,
  hitFoe,
  hostile,
  loseItem,
  losePerm,
  refill,
  revealClue,
  roll,
  say,
  see,
  statOf,
  stun,
  tagsOf,
  trust,
} from '../sim/ops';
import { cardDef, permDef } from './registry';

/**
 * 効き目の小さな言語。カードの効き目はこの並びで書き、本文もここから
 * 作る（数を変えても本文がずれない）。
 *
 *   数   定数か、{ n, s, m, per, pm }（n + m × 能力値 + pm × 持っているタグの数）
 */

export type Num = number | { n: number; s?: Stat; m?: number; per?: Tag; pm?: number };

export type Cond =
  | ['night']
  | ['foeTag', Tag]
  | ['hostile', number]
  | ['trustHalf']
  | ['lowHp']
  | ['lowMind']
  | ['shown', number]
  | ['tag', Tag, number]
  | ['lying']
  | ['hour', number]
  | ['first'];

export type Fx =
  | ['hit', Num, boolean?]
  | ['break', Num]
  | ['trust', Num]
  | ['host', number]
  | ['clue', number, boolean?]
  | ['see']
  | ['guard', Num]
  | ['calm', Num]
  | ['heal', Num, Num?]
  | ['cost', number, number?]
  | ['coins', number]
  | ['stun']
  | ['leave', boolean?]
  | ['perm', string, boolean?]
  | ['refill', Tag, number]
  | ['cut', Num]
  | ['expose', number]
  | ['lie', number, number?, Claim['about']?]
  | ['mimic', number]
  | ['note']
  | ['vow']
  | ['burnBad']
  | ['check', Stat | readonly Stat[], number, readonly Fx[], (readonly Fx[])?]
  | ['if', Cond, readonly Fx[], (readonly Fx[])?];

export interface FxCtx {
  mult: number;
  /** 逆さの: 信頼と意志を入れ替え、敵意の向きを反転する。 */
  invert?: boolean;
  /** 誉無き: 守りを貫く。人工的な: 能力値を無視する。寒い: 信頼が伸びない。 */
  pierce?: boolean;
  fixed?: boolean;
  cold?: boolean;
  /** 0 回で使ったときの代償を払わない（鈍い・誉無き）。 */
  rusty?: boolean;
  card: string;
  slot: number;
  /** この遭遇で、このカードを初めて使ったか。 */
  first: boolean;
}

const STAT_JA: Record<Stat, string> = { VIT: 'VIT', ATK: 'ATK', DEF: 'DEF', WIL: 'WIL', INT: 'INT', AGI: 'AGI' };

export function num(tx: Tx, v: Num): number {
  if (typeof v === 'number') return v;
  const who = actor(tx);
  let x = v.n;
  if (v.s) x += (v.m ?? 1) * statOf(tx.w, who, v.s);
  if (v.per) x += (v.pm ?? 1) * (tagsOf(charOf(tx.w, who))[v.per] ?? 0);
  return x;
}

export function holds(tx: Tx, c: Cond, ctx: FxCtx): boolean {
  const e = tx.w.enc;
  const who = actor(tx);
  const ch = charOf(tx.w, who);
  switch (c[0]) {
    case 'night':
      return tx.w.hour >= 2;
    case 'hour':
      return tx.w.hour >= c[1];
    case 'foeTag':
      return !!e?.foe.tags.includes(c[1]);
    case 'hostile':
      return (e?.foe.hostility ?? 0) >= c[1];
    case 'trustHalf':
      return !!e && e.foe.trust * 2 >= e.foe.need;
    case 'lowHp':
      return ch.hp * 3 < 16 + 4 * statOf(tx.w, who, 'VIT');
    case 'lowMind':
      return ch.mind * 3 < 8 + 3 * statOf(tx.w, who, 'WIL');
    case 'shown':
      return (e?.foe.clues.filter((x) => x.shown).length ?? 0) >= c[1];
    case 'tag':
      return (tagsOf(ch)[c[1]] ?? 0) >= c[2];
    case 'lying':
      return !!e?.foe.intent?.lie;
    case 'first':
      return ctx.first;
  }
}

export function run(tx: Tx, list: readonly Fx[], ctx: FxCtx): void {
  for (const f of list) {
    const e = tx.w.enc;
    if (e && e.phase !== 'act' && f[0] !== 'perm' && f[0] !== 'coins' && f[0] !== 'refill') return;
    const m = (v: Num) => Math.round((ctx.fixed && typeof v !== 'number' ? v.n : num(tx, v)) * ctx.mult);
    switch (f[0]) {
      case 'hit':
        hitFoe(tx, m(f[1]), f[2] ?? ctx.pierce ?? false);
        break;
      case 'break':
        if (ctx.invert) trust(tx, Math.max(1, Math.round(m(f[1]) / 2)));
        else breakFoe(tx, m(f[1]));
        break;
      case 'trust':
        if (ctx.invert) breakFoe(tx, Math.max(1, m(f[1])));
        else if (!ctx.cold) trust(tx, Math.max(1, m(f[1])));
        break;
      case 'host':
        hostile(tx, ctx.invert ? -f[1] : f[1]);
        break;
      case 'clue':
        for (let i = 0; i < f[1]; i++) if (!revealClue(tx, f[2] ?? false)) break;
        break;
      case 'see':
        see(tx);
        break;
      case 'guard':
        guard(tx, m(f[1]));
        break;
      case 'calm':
        calm(tx, m(f[1]));
        break;
      case 'heal':
        heal(tx, m(f[1]), f[2] === undefined ? 0 : m(f[2]));
        break;
      case 'cost':
        if (!ctx.rusty) cost(tx, f[1], f[2] ?? 0);
        break;
      case 'coins':
        coins(tx, f[1]);
        break;
      case 'stun':
        stun(tx);
        break;
      case 'leave':
        if (f[1]) loseItem(tx);
        end(tx, 'left');
        break;
      case 'perm':
        if (!f[2] || ctx.first) gainPerm(tx, f[1], ctx.card);
        break;
      case 'refill':
        refill(tx, f[2], f[1]);
        break;
      case 'cut':
        cut(tx, m(f[1]));
        break;
      case 'expose':
        expose(tx, f[1]);
        break;
      case 'lie': {
        if (!e) break;
        const wary = 10 * (e.foe.st.wary ?? 0);
        const pct = tx.rule('lieChance', { who: actor(tx), card: ctx.card }, chance(tx, 'INT', 50 - 8 * e.foe.int + (f[2] ?? 0) - wary, ctx.card));
        const ok = roll(tx, 'INT', Math.max(5, Math.min(95, Math.round(pct))));
        claim(tx, f[3] ?? 'harmless', false);
        if (ok) trust(tx, Math.max(1, Math.round(f[1] * ctx.mult)));
        else {
          tx.emit({ type: 'caught', about: f[3] ?? 'harmless' });
          say(tx, 'foe', '……嘘だな。');
          hostile(tx, 3);
          trust(tx, -2);
        }
        break;
      }
      case 'mimic': {
        const id = e?.lastCard;
        if (id && id !== ctx.card) run(tx, cardDef(id).ready, { ...ctx, mult: ctx.mult * f[1], card: id });
        else say(tx, 'voice', '真似るものがない。');
        break;
      }
      case 'note':
        tx.emit({ type: 'enc.st', key: 'noted', n: 1 });
        break;
      case 'vow':
        claim(tx, 'harmless', true);
        break;
      case 'burnBad': {
        const ch = charOf(tx.w, actor(tx));
        const bad = ch.perms.filter((p) => permDef(p)?.bad);
        const id = tx.pick('enc', bad);
        if (id) losePerm(tx, id, ctx.card);
        break;
      }
      case 'check': {
        const ok = roll(tx, f[1], chance(tx, f[1], f[2], ctx.card));
        run(tx, ok ? f[3] : (f[4] ?? []), ctx);
        break;
      }
      case 'if':
        run(tx, holds(tx, f[1], ctx) ? f[2] : (f[3] ?? []), ctx);
        break;
    }
  }
}

// ─── 本文 ─────────────────────────────────────────────────────

function numText(v: Num): string {
  if (typeof v === 'number') return String(v);
  const parts: string[] = [];
  if (v.n) parts.push(String(v.n));
  if (v.s) parts.push(`${v.m && v.m !== 1 ? `${v.m}×` : ''}${STAT_JA[v.s]}`);
  if (v.per) parts.push(`${v.pm && v.pm !== 1 ? `${v.pm}×` : ''}［${TAG_NAME[v.per]}］の数`);
  return parts.join('+') || '0';
}

function condText(c: Cond): string {
  switch (c[0]) {
    case 'night':
      return '深夜（0 時過ぎ）なら';
    case 'hour':
      return `${(22 + c[1]) % 24} 時を過ぎていれば`;
    case 'foeTag':
      return `相手が［${TAG_NAME[c[1]]}］なら`;
    case 'hostile':
      return `敵意が ${c[1]} 以上なら`;
    case 'trustHalf':
      return '信頼が半ばを越えていれば';
    case 'lowHp':
      return '体力が 1/3 を切っていれば';
    case 'lowMind':
      return '精神が 1/3 を切っていれば';
    case 'shown':
      return `手がかりが ${c[1]} つ以上見えていれば`;
    case 'tag':
      return `［${TAG_NAME[c[1]]}］を ${c[2]} 以上持っていれば`;
    case 'lying':
      return '相手が嘘をついていれば';
    case 'first':
      return 'この遭遇で初めてなら';
  }
}

export function fxText(list: readonly Fx[]): string {
  const out: string[] = [];
  for (const f of list) {
    switch (f[0]) {
      case 'hit':
        out.push(`体力を ${numText(f[1])} 削る${f[2] ? '（守りを無視）' : ''}`);
        break;
      case 'break':
        out.push(`意志を ${numText(f[1])} 削る`);
        break;
      case 'trust':
        out.push(`信頼 +${numText(f[1])}`);
        break;
      case 'host':
        out.push(`敵意 ${f[1] > 0 ? '+' : ''}${f[1]}`);
        break;
      case 'clue':
        out.push(`手がかりを ${f[1]} つ見る${f[2] ? '（誤りが混じりうる）' : ''}`);
        break;
      case 'see':
        out.push('本当の予告を見る');
        break;
      case 'guard':
        out.push(`守り ${numText(f[1])}`);
        break;
      case 'calm':
        out.push(`心の構え ${numText(f[1])}`);
        break;
      case 'heal': {
        const hp = numText(f[1]);
        const mind = f[2] === undefined ? '' : numText(f[2]);
        out.push([hp !== '0' ? `体力 +${hp}` : '', mind && mind !== '0' ? `精神 +${mind}` : ''].filter(Boolean).join('、'));
        break;
      }
      case 'cost':
        out.push(`代償：${[f[1] ? `体力 −${f[1]}` : '', f[2] ? `精神 −${f[2]}` : ''].filter(Boolean).join('、')}`);
        break;
      case 'coins':
        out.push(f[1] >= 0 ? `金 +${f[1]}` : `金 ${f[1]}`);
        break;
      case 'stun':
        out.push('相手は次の手番に動けない');
        break;
      case 'leave':
        out.push(f[1] ? 'かならず立ち去る（所持品を 1 つ失う）' : 'かならず立ち去る');
        break;
      case 'perm':
        out.push(`${f[2] ? '初めて使うと' : ''}《${f[1]}》を得る`);
        break;
      case 'refill':
        out.push(`［${TAG_NAME[f[1]]}］のカードの回数 +${f[2]}`);
        break;
      case 'cut':
        out.push(`相手の次の手を ${numText(f[1])} 弱める`);
        break;
      case 'expose':
        out.push(`相手の防御 −${f[1]}`);
        break;
      case 'lie':
        out.push(`嘘をつく（INT を相手と比べる${f[2] ? `、+${f[2]}%` : ''}）。通れば信頼 +${f[1]}、ばれると敵意 +3`);
        break;
      case 'mimic':
        out.push(`直前のカードの効き目を ${Math.round(f[1] * 100)}% で起こす`);
        break;
      case 'note':
        out.push('次に使うカード ×1.5');
        break;
      case 'vow':
        out.push('「手は出さない」と誓う（本当の主張。あとで殴れば露見する）');
        break;
      case 'burnBad':
        out.push('悪い記憶をひとつ焼く');
        break;
      case 'check':
        out.push(
          `${Array.isArray(f[1]) ? f[1].join('・') : f[1]} 判定：成功なら${inner(f[3])}${f[4]?.length ? `／失敗なら${inner(f[4])}` : ''}`,
        );
        break;
      case 'if':
        out.push(`${condText(f[1])}${inner(f[2])}${f[3]?.length ? `、でなければ${inner(f[3])}` : ''}`);
        break;
    }
  }
  return out.filter(Boolean).join('。') + (out.length ? '。' : '');
}

const inner = (list: readonly Fx[]) => fxText(list).replace(/。$/, '').replace(/。/g, '、');
