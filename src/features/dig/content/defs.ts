import type { Intent, Outcome, Stat, StatBlock, World } from '../core/model';
import type { Patch, Trigger } from '../core/rules';
import type { ArchCount, Archetype, Tag, TagCount } from '../core/tags';
import type { Tx } from '../core/tx';
import type { Cond, Fx } from './fx';

/**
 * 中身の形。カード（100 の作品）、記憶、人物、ビルド、共鳴、職、出来事、品。
 * カードは二つの顔を持つ: 使ったときの効き目（Fx）と、枠に入っているだけで
 * かかる規則のパッチ（passive）。
 */

export type PassiveSpec = Omit<Patch, 'id' | 'source'>;
export type TriggerSpec = Omit<Trigger, 'id' | 'source'>;

export type Recover =
  | 'win'
  | 'newPlace'
  | 'lieKept'
  | 'quiet'
  | 'uncover'
  | 'trusted'
  | 'broken'
  | 'left';

export interface Work {
  title: string;
  by: string;
  year: number;
  kind: 'painting' | 'book' | 'film' | 'thought';
}

export interface CardDef {
  id: string;
  /** 共通語彙《ベーシック》・伝承原型《アーキタイプ》・退いた札。 */
  layer: 'basic' | 'archetype' | 'legacy';
  no: number;
  name: string;
  work?: Work;
  tags: readonly Tag[];
  /** 伝承原型《アーキタイプ》（作品のモチーフ）。 */
  arch?: readonly Archetype[];
  stats: readonly Stat[];
  uses: number;
  rarity: 'common' | 'uncommon' | 'rare' | 'legacy';
  ready: readonly Fx[];
  spentName: string;
  spent: readonly Fx[];
  recover: { on: readonly Recover[]; restOnly?: boolean };
  alter?: {
    care?: { to: string; need: number };
    overuse?: { to: string; need: number };
    secret?: { to: string; perms: readonly string[] };
  };
  shift?: { on: 'spent' | 'rested'; every: number; cap: number; perm?: string };
  hidden?: { id: string; when: Cond; fx: readonly Fx[]; text: string };
  /** 見せ場（その札だけの規則）の一文。 */
  sig?: string;
  /** 主役の札なら、その物語の題。 */
  legend?: string;
  passive?: readonly PassiveSpec[];
  triggers?: readonly TriggerSpec[];
  /** 入った版・退いた版。 */
  since: string;
  retired?: string;
  replacedBy?: string;
  flavor: string;
}

export type PermKind = 'memory' | 'trait' | 'wound' | 'bond' | 'state';

export interface PermDef {
  id: string;
  name: string;
  kind: PermKind;
  text: string;
  tags: readonly Tag[];
  mods?: Partial<StatBlock>;
  dyn?: (w: World, s: Stat) => number;
  value: number;
  bad?: boolean;
  exploit?: {
    text: string;
    press?: number;
    talk?: number;
    force?: number;
    lie?: number;
    show?: (tx: Tx) => void;
  };
  /** 物語の糸（彼女・事故・火事…）。最後の相手が読む。 */
  thread?: string;
  echo?: { label: string; kind: 'strike' | 'threat'; power: number };
  passive?: readonly PassiveSpec[];
  triggers?: readonly TriggerSpec[];
  flavor: string;
}

export interface Persona {
  aggression: number;
  deceit: number;
  pride: number;
  fear: number;
  warmth: number;
  cunning: number;
}

export interface MoveDef {
  id: string;
  intent: (w: World) => Intent;
  act: (tx: Tx) => void;
  cond?: (w: World) => boolean;
  prior?: (w: World) => number;
  repeat?: number;
}

export interface Reward {
  coins?: number;
  perm?: string;
  item?: string;
  help?: boolean;
}

export type LineKind =
  | 'greet'
  | 'again'
  | 'heard'
  | 'hurt'
  | 'low'
  | 'trusted'
  | 'broken'
  | 'beaten'
  | 'uncovered'
  | 'fled'
  | 'caught'
  /** 相手の手が当たったとき。 */
  | 'taunt'
  /** あなたの連鎖（同じ系統の札の続け打ち）が、二つ目、三つ目と決まったとき。 */
  | 'stagger'
  /** 向き合ったまま、あなたが黙っているとき（画面だけ。記録には残らない）。 */
  | 'mutter';

export interface FoeDef {
  id: string;
  name: string;
  stratum: number;
  tier: 'normal' | 'danger' | 'boss';
  hp: number;
  resolve: number;
  need: number;
  atk: number;
  def: number;
  wil: number;
  int: number;
  agi: number;
  hostility: number;
  /** この人物のタグ。weak と同じタグのカードはよく効き、guarded とは噛み合わない。 */
  tags: readonly Tag[];
  weak: readonly Tag[];
  guarded: readonly Tag[];
  arch?: readonly Archetype[];
  clues: readonly string[];
  take: readonly string[];
  moves: readonly MoveDef[];
  persona: Persona;
  rewards: Partial<Record<Outcome, Reward>>;
  model: string;
  desc: string;
  lines: Partial<Record<LineKind, readonly string[]>>;
  hush?: boolean;
  mute?: boolean;
  /** 遭遇の初めの姿を、あなたの世界に合わせて整える（イベントに書かれる前）。 */
  shape?: (w: World, foe: import('../core/model').Foe) => void;
  init?: (tx: Tx) => void;
}

export interface BuildDef {
  id: string;
  name: string;
  /** 名前の元になった作品（カードの番号）。 */
  no: number;
  need: TagCount;
  /** 伝承原型の条件。 */
  arch?: ArchCount;
  /** このうちどれかが枠にあること。 */
  any?: readonly string[];
  text: string;
  passive?: readonly PassiveSpec[];
  triggers?: readonly TriggerSpec[];
}

export interface LinkDef {
  id: string;
  name: string;
  cards: readonly string[];
  text: string;
  passive?: readonly PassiveSpec[];
  triggers?: readonly TriggerSpec[];
}

export interface JobDef {
  id: string;
  name: string;
  text: string;
  innate: StatBlock;
  cards: readonly string[];
  /** 持てる札の数（枠の五枚と後ろを合わせて）。地力が上がるたびに一枚増え、17 まで。 */
  deck: number;
  perms: readonly string[];
  passive?: readonly PassiveSpec[];
  triggers?: readonly TriggerSpec[];
}

export interface StoryOption {
  label: string;
  stat?: Stat;
  diff?: number;
  needPerm?: string;
  needTags?: TagCount;
  needItem?: string;
  needCoins?: number;
  ok: string;
  fail?: string;
  effect: (tx: Tx) => string | undefined;
  failEffect?: (tx: Tx) => string | undefined;
}

export interface StoryDef {
  id: string;
  title: string;
  strata: readonly number[];
  locked?: boolean;
  needTags?: TagCount;
  text: string;
  options: readonly StoryOption[];
}

export interface ItemDef {
  id: string;
  name: string;
  text: string;
  refill?: { tags: readonly Tag[]; n: number };
  heal?: { hp?: number; mind?: number };
  /** その場の効き目（向き合っているあいだ、手番を使わずに）。 */
  fx?: readonly Fx[];
  /** 使える回数（無ければ一度きり）。 */
  uses?: number;
  price: number;
  flavor: string;
}

/** 永続カードの組み合わせ。揃うと出来事が開くか、新しい記憶になる。 */
export interface ComboDef {
  id: string;
  name: string;
  needs: readonly string[];
  text: string;
  grant?: string;
  story?: string;
}

export interface EpithetCtx {
  card: import('../core/model').Card;
  char: import('../core/model').Char;
  tags: readonly Tag[];
  /** ほかの枠のカードのタグ（孤独・群れ）。 */
  others: readonly (readonly Tag[])[];
}
