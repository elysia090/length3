import type { Rng } from './rng';

/**
 * DIG の型。状態はすべて素の値（関数を含まない）で、複製も保存もそのまま
 * できる。振る舞いは id から定義の表を引く。
 *
 * 人物は四層でできている。
 *   能力値   何が得意か（先天値 + 成長値 + 永続補正）
 *   ACTIVE   いま何ができるか（5 枚、使用回数つき、使い方で変質する）
 *   PERMANENT 何を経験してきたか（使わない。手に入れた瞬間から効き続ける）
 */

export type Stat = 'VIT' | 'ATK' | 'DEF' | 'WIL' | 'INT' | 'AGI';
export const STATS: readonly Stat[] = ['VIT', 'ATK', 'DEF', 'WIL', 'INT', 'AGI'];
export type StatBlock = Record<Stat, number>;

export const zeroStats = (): StatBlock => ({ VIT: 0, ATK: 0, DEF: 0, WIL: 0, INT: 0, AGI: 0 });

/** ACTIVE の 1 枚。marks は「どんな場面で使ったか」の数（変質の条件）。 */
export interface ActiveCard {
  uid: number;
  id: string;
  uses: number;
  maxUses: number;
  /** 強化の段（効き目に足す）。 */
  plus: number;
  marks: Record<string, number>;
}

export interface Character {
  origin: string;
  innate: StatBlock;
  growth: StatBlock;
  /** 次の成長までの経験。 */
  xp: StatBlock;
  hp: number;
  mind: number;
  coins: number;
  /** 5 つの枠。空きは null。 */
  actives: (ActiveCard | null)[];
  /** 手に入れた順（そのまま、この挑戦の履歴になる）。 */
  permanents: string[];
  /** 物語の旗。 */
  flags: Record<string, number>;
}

export type IntentKind =
  | 'strike'
  | 'threat'
  | 'lie'
  | 'guard'
  | 'call'
  | 'flee'
  | 'bargain'
  | 'confide'
  | 'wait'
  | 'mend'
  | 'special';

/** 相手の予告。lie は本当の手を隠し、見かけ（seem）を見せる。 */
export interface Intent {
  kind: IntentKind;
  label: string;
  hp?: number;
  mind?: number;
  /** 取引で求める金。 */
  price?: number;
  /** 見抜けていない嘘のときに見える姿。 */
  seem?: IntentKind;
  seemLabel?: string;
}

export interface Clue {
  id: string;
  text: string;
  shown: boolean;
}

export interface NpcState {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  resolve: number;
  maxResolve: number;
  trust: number;
  trustNeed: number;
  /** 0..10。 */
  hostility: number;
  guard: number;
  atk: number;
  def: number;
  wil: number;
  int: number;
  agi: number;
  st: Record<string, number>;
  clues: Clue[];
  move: string | null;
  intent: Intent | null;
  /** 予告の本当の姿が見えているか。 */
  seen: boolean;
  mem: Record<string, number>;
  history: string[];
}

export type Outcome =
  | 'beaten'
  | 'broken'
  | 'trusted'
  | 'uncovered'
  | 'left'
  | 'fled'
  | 'fallen'
  | 'shattered';

export interface EncounterPlayer {
  hp: number;
  maxHp: number;
  mind: number;
  maxMind: number;
  guard: number;
  /** 心の構え（精神への傷を受け止める）。 */
  calm: number;
  coins: number;
  st: Record<string, number>;
}

/** 画面に流す出来事。 */
export type EncEvent =
  | { k: 'say'; who: 'npc' | 'you' | 'voice'; text: string; voice?: string }
  | { k: 'hp'; to: 'npc' | 'you'; delta: number }
  | { k: 'mind'; to: 'you'; delta: number }
  | { k: 'resolve'; delta: number }
  | { k: 'trust'; delta: number }
  | { k: 'hostility'; delta: number }
  | { k: 'guard'; to: 'npc' | 'you'; delta: number }
  | { k: 'clue'; id: string }
  | { k: 'check'; stat: Stat; need: number; roll: [number, number]; total: number; ok: boolean }
  | { k: 'crit' }
  | { k: 'use'; card: string; slot: number }
  | { k: 'intent' }
  | { k: 'seen' }
  | { k: 'grow'; stat: Stat }
  | { k: 'mark'; slot: number; mark: string }
  | { k: 'coins'; delta: number }
  | { k: 'end'; outcome: Outcome };

export interface Encounter {
  rng: Rng;
  turn: number;
  phase: 'player' | 'npc' | 'over';
  outcome: Outcome | null;
  npc: NpcState;
  you: EncounterPlayer;
  /** この遭遇で効く能力値（先天 + 成長 + 永続）。 */
  stats: StatBlock;
  permanents: string[];
  cards: (ActiveCard | null)[];
  /** この遭遇で使った経験（遭遇のあとで人物へ足す）。 */
  xp: StatBlock;
  /** 遭遇の格と深さ。 */
  tier: 'normal' | 'danger' | 'boss';
  depth: number;
  stratum: number;
  events: EncEvent[];
  /** 相手の読み筋の試行のとき。 */
  sim: boolean;
  /** 相手が試した読み筋の数（画面の「考えている」）。 */
  thinking: number;
  /** この手番に、もう一手あるか（素早さで先手を取ったとき）。 */
  extra: boolean;
}
