import type { Ev, EvType } from './events';
import type { Enc, Who, World } from './model';
import type { Archetype, Tag } from './tags';
import type { Tx } from './tx';

/**
 * 規則。ゲームの計算はすべて名前のついた規則を通る。規則の素の値は
 * 呼ぶ側が渡し、パッチ（カード・記憶・ビルド・職・共鳴・深さ・版）が
 * 順に上書きする。順番は prio、同じなら id。だから、どのカードを
 * どの枠に入れても、結果はいつも同じ順で決まる。
 *
 * トリガは、起きたイベントに応じて新しいイベントを起こす（反応）。
 */

export type RuleName =
  /** カードの効き目の倍率。 */
  | 'mult'
  /** 連鎖の倍率（直前のカードとタグが重なったとき）。 */
  | 'chain'
  /** 相手の体力・意志・信頼・敵意の動き（あなたから）。 */
  | 'hit'
  | 'break'
  | 'trust'
  | 'hostility'
  /** 手がかりが誤りである率（%）。 */
  | 'falseChance'
  /** 嘘・去る・判定の成功率（%）。 */
  | 'lieChance'
  | 'leaveChance'
  | 'checkChance'
  /** 本当の予告が見えるか（1 / 0）。 */
  | 'intentVisible'
  /** 手番をまたいで残る守り・心の構えの割合。 */
  | 'guardKeep'
  | 'calmKeep'
  /** 受ける傷（体力・精神）。 */
  | 'strikeTaken'
  | 'threatTaken'
  /** 代償（カードの自傷）。 */
  | 'selfCost'
  | 'heal'
  | 'coins'
  | 'price'
  | 'restHeal'
  /** 使用回数を消費するか（1 / 0）。 */
  | 'useSpend'
  /** 出来事の判定の成功率（%）。 */
  | 'storyChance'
  /** 遭遇の初めの敵意と信頼。 */
  | 'startHostility'
  | 'startTrust'
  /** 噂が伝わる率（%）。 */
  | 'gossip'
  /** 進むのにかかる時間。 */
  | 'timeCost'
  /** 手番ごとの守り・構え（鎧・灯り）。 */
  | 'turnGuard'
  | 'turnCalm';

export interface RuleCtx {
  w: World;
  who: Who;
  enc?: Enc | null;
  card?: string;
  tags?: readonly Tag[];
  arch?: readonly Archetype[];
  spent?: boolean;
  stat?: string;
  kind?: string;
  npc?: string;
}

export interface Patch {
  id: string;
  /** 同じ key のパッチは一つだけ効く（重ねがけしない）。 */
  key?: string;
  /** どこから来たか（'card:22'・'build:nighthawks'・'perm:suspicion'・'job:watch'・'v1.1' …）。 */
  source: string;
  rule: RuleName;
  prio?: number;
  when?: (c: RuleCtx) => boolean;
  fn: (c: RuleCtx, v: number) => number;
  /** 画面に出す一文。 */
  text: string;
}

export interface Trigger {
  id: string;
  key?: string;
  source: string;
  on: EvType;
  when?: (ev: Ev, w: World) => boolean;
  run: (tx: Tx, ev: Ev) => void;
  text: string;
}

export interface Rulebook {
  key: string;
  patches: Partial<Record<RuleName, Patch[]>>;
  triggers: Partial<Record<EvType, Trigger[]>>;
  all: { patches: Patch[]; triggers: Trigger[] };
}

export function compile(key: string, patches: Patch[], triggers: Trigger[]): Rulebook {
  const seen = new Set<string>();
  const once = <T extends { key?: string }>(x: T) => {
    if (!x.key) return true;
    if (seen.has(x.key)) return false;
    seen.add(x.key);
    return true;
  };
  patches = patches.filter(once);
  triggers = triggers.filter(once);
  const book: Rulebook = { key, patches: {}, triggers: {}, all: { patches, triggers } };
  const order = (a: { id: string; prio?: number }, b: { id: string; prio?: number }) =>
    (a.prio ?? 0) - (b.prio ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const p of [...patches].sort(order)) (book.patches[p.rule] ??= []).push(p);
  for (const t of [...triggers].sort(order)) (book.triggers[t.on] ??= []).push(t);
  return book;
}

export function evaluate(book: Rulebook, name: RuleName, ctx: RuleCtx, base: number): number {
  let v = base;
  for (const p of book.patches[name] ?? []) if (!p.when || p.when(ctx)) v = p.fn(ctx, v);
  return v;
}

/**
 * 世界からパッチとトリガを集める関数。中身（content）が差し込む。
 * core は中身を知らない。
 */
export type Sources = (w: World) => { key: string; patches: Patch[]; triggers: Trigger[] };

let sources: Sources = () => ({ key: '', patches: [], triggers: [] });
export function setSources(fn: Sources): void {
  sources = fn;
}

const cache = new Map<string, Rulebook>();
export function bookOf(w: World): Rulebook {
  const s = sources(w);
  const hit = cache.get(s.key);
  if (hit) return hit;
  const book = compile(s.key, s.patches, s.triggers);
  if (cache.size > 64) cache.clear();
  cache.set(s.key, book);
  return book;
}

/** 取引の外で規則を引く（画面に見せる値など）。 */
export function ask(w: World, name: RuleName, ctx: Partial<RuleCtx>, base: number): number {
  return evaluate(bookOf(w), name, { w, who: w.enc?.who ?? 'you', enc: w.enc, ...ctx }, base);
}
