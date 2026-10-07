import type { Rng } from './rng';

/**
 * DIG の型。状態はすべて素の値（関数を含まない）で、複製も保存もそのまま
 * できる。振る舞いは id から定義の表を引く。
 *
 * 人物は四層でできている。
 *   能力値    何が得意か（先天値 + 成長値 + 永続補正）
 *   ACTIVE    いま何ができるか（5 枚。使用回数つき）
 *   変質      使い方と休ませ方で、カードそのものが変わる
 *   PERMANENT 何を経験してきたか（使わない。手に入れた瞬間から効き続ける）
 *
 * カードは READY（回数がある）→ SPENT（0 回。枯渇時の危うい効果に変わる）
 * → RECOVER（回復）か ALTER（変質）をたどる。
 */

export type Stat = 'VIT' | 'ATK' | 'DEF' | 'WIL' | 'INT' | 'AGI';
export const STATS: readonly Stat[] = ['VIT', 'ATK', 'DEF', 'WIL', 'INT', 'AGI'];
export type StatBlock = Record<Stat, number>;

export const zeroStats = (): StatBlock => ({ VIT: 0, ATK: 0, DEF: 0, WIL: 0, INT: 0, AGI: 0 });

/**
 * ACTIVE の 1 枚。marks は使い方の記録（変質と最大回数の条件）。
 *   spent    0 回のまま使った回数（酷使）
 *   rested   休ませて回復させた回数（手入れ）
 *   used     ふつうに使った回数
 */
export interface ActiveCard {
  uid: number;
  id: string;
  uses: number;
  maxUses: number;
  marks: Record<string, number>;
}

/** 噂。決着の仕方が広まり、この先の相手の構えを変える。 */
export interface Rumor {
  /** 殴り倒した・折った（恐れられる）。 */
  fear: number;
  /** 打ち解けた（信用される）。 */
  kind: number;
  /** 暴いた・嘘がばれた（詮索屋・嘘つき）。 */
  nosy: number;
}

export interface Character {
  name: string;
  origin: string;
  innate: StatBlock;
  growth: StatBlock;
  /** 次の成長までの経験。 */
  xp: StatBlock;
  hp: number;
  mind: number;
  coins: number;
  items: string[];
  /** 5 つの枠。空きは null（破棄した枠）。 */
  actives: (ActiveCard | null)[];
  /** 手に入れた順（そのまま、この挑戦の履歴になる）。 */
  permanents: string[];
  rumor: Rumor;
  /** 借り（人物 id → 回数）。 */
  debts: Record<string, number>;
  flags: Record<string, number>;
  uid: number;
}

export type IntentKind =
  | 'strike'
  | 'threat'
  | 'guard'
  | 'call'
  | 'flee'
  | 'bargain'
  | 'confide'
  | 'wait'
  | 'mend'
  | 'probe';

/** 相手の予告。lie のときは本当の手（kind）を隠して、見かけ（seem）を見せる。 */
export interface Intent {
  kind: IntentKind;
  label: string;
  hp?: number;
  mind?: number;
  price?: number;
  lie?: boolean;
  seem?: IntentKind;
  seemLabel?: string;
}

/** 手がかり＝相手の永続カード。見えると攻め筋になり、暴けば 1 枚持ち帰れる。 */
export interface Clue {
  id: string;
  shown: boolean;
  /** 執着が見せる誤った手がかり。 */
  false?: boolean;
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

export interface EncounterYou {
  hp: number;
  maxHp: number;
  mind: number;
  maxMind: number;
  guard: number;
  /** 心の構え（精神への傷を受け止める）。 */
  calm: number;
  coins: number;
  items: string[];
  st: Record<string, number>;
}

/** 画面に流す出来事。 */
export type EncEvent =
  | { k: 'say'; who: 'npc' | 'you' | 'voice'; text: string }
  | { k: 'hp'; to: 'npc' | 'you'; delta: number }
  | { k: 'mind'; delta: number }
  | { k: 'resolve'; delta: number }
  | { k: 'trust'; delta: number }
  | { k: 'hostility'; delta: number }
  | { k: 'guard'; to: 'npc' | 'you'; delta: number }
  | { k: 'clue'; id: string; false?: boolean }
  | { k: 'check'; stat: string; chance: number; roll: number; ok: boolean }
  | { k: 'crit' }
  | { k: 'use'; slot: number; spent: boolean }
  | { k: 'intent' }
  | { k: 'seen' }
  | { k: 'perm'; id: string }
  | { k: 'coins'; delta: number }
  | { k: 'item'; id: string; delta: number }
  | { k: 'end'; outcome: Outcome };

export interface Encounter {
  rng: Rng;
  turn: number;
  phase: 'player' | 'npc' | 'over';
  outcome: Outcome | null;
  npc: NpcState;
  you: EncounterYou;
  /** この遭遇で効く能力値（先天 + 成長 + 永続）。 */
  stats: StatBlock;
  permanents: string[];
  cards: (ActiveCard | null)[];
  /** 遭遇の中で増えた永続カード（終わってから人物へ足す）。 */
  gained: string[];
  /** この遭遇で使った経験（遭遇のあとで人物へ足す）。 */
  xp: StatBlock;
  /** この遭遇の記録（カードの回復条件に使う）。 */
  log: { cards: number; lies: number; liesCaught: number; spent: number };
  tier: 'normal' | 'danger' | 'boss' | 'rival';
  depth: number;
  stratum: number;
  /** 夜の深さ（時刻。相手が荒れる）。 */
  hour: number;
  events: EncEvent[];
  /** 相手の読み筋の試行のとき（出来事を残さない）。 */
  sim: boolean;
  /** 相手が試した読み筋の数（画面の「考えている」）。 */
  thinking: number;
}
