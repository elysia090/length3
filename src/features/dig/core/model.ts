import type { Tag } from './tags';

/**
 * DIG の世界の形。ここにあるものはすべて素の値で、複製も保存もそのまま
 * できる。世界を書き換えてよいのは reduce.ts の apply だけで、apply は
 * イベントしか受け取らない。
 *
 *   コマンド  遊ぶ人（と、あなたを演じる頭）の意図。decide がイベントに変える
 *   イベント  起きたこと。世界はイベントの畳み込みで決まる
 *   認識世界  人物ごとに、見たイベントだけから作った「あなた像」
 *   規則      名前のついた計算。カード・記憶・ビルド・職が上書きする
 */

// ─── 人物 ─────────────────────────────────────────────────────

export type Stat = 'VIT' | 'ATK' | 'DEF' | 'WIL' | 'INT' | 'AGI';
export const STATS: readonly Stat[] = ['VIT', 'ATK', 'DEF', 'WIL', 'INT', 'AGI'];
export type StatBlock = Record<Stat, number>;
export const zeroStats = (): StatBlock => ({ VIT: 0, ATK: 0, DEF: 0, WIL: 0, INT: 0, AGI: 0 });

/** ACTIVE の 1 枚。marks は使い方の記録（spent: 0 回で使った、rested: 休ませて戻した）。 */
export interface Card {
  uid: number;
  id: string;
  uses: number;
  max: number;
  marks: Record<string, number>;
  /** 刻まれた冠装飾子《エピテット》（最大 2）。 */
  eps: string[];
}

export type Who = 'you' | 'rival';

export interface Char {
  name: string;
  job: string;
  innate: StatBlock;
  growth: StatBlock;
  xp: StatBlock;
  hp: number;
  mind: number;
  coins: number;
  items: string[];
  cards: (Card | null)[];
  /** 手に入れた順。そのまま、この挑戦の履歴になる。 */
  perms: string[];
  /** 記憶に刻まれたエピテット。 */
  permEps: Record<string, string[]>;
  /** まだどこにも刻んでいないエピテット。 */
  epithets: string[];
  debts: Record<string, number>;
  uid: number;
}

// ─── 地図 ─────────────────────────────────────────────────────

export type NodeKind = 'person' | 'danger' | 'event' | 'rest' | 'shop' | 'boss';

export interface MapNode {
  id: number;
  row: number;
  col: number;
  kind: NodeKind;
  npc?: string;
  next: number[];
  visited: boolean;
  /** 場所に刻まれたエピテット（ここで出会う人物にも移る）。 */
  eps: string[];
  /** もう一人の掘る人が先に寄って、どう決着したか。 */
  rival?: string;
}

// ─── 遭遇 ─────────────────────────────────────────────────────

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

export interface Intent {
  kind: IntentKind;
  label: string;
  power?: number;
  price?: number;
  /** 嘘の予告。見抜けていなければ seem が見える。 */
  lie?: boolean;
  seem?: IntentKind;
  seemLabel?: string;
}

export interface Clue {
  id: string;
  shown: boolean;
  false?: boolean;
}

export interface Foe {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  resolve: number;
  maxResolve: number;
  trust: number;
  need: number;
  hostility: number;
  guard: number;
  atk: number;
  def: number;
  wil: number;
  int: number;
  agi: number;
  tags: Tag[];
  /** 人物に刻まれたエピテット。 */
  eps: string[];
  clues: Clue[];
  move: string | null;
  intent: Intent | null;
  seen: boolean;
  st: Record<string, number>;
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

export interface Enc {
  /** 誰が遭遇しているか（ライバルの遭遇は、複製した世界で回す）。 */
  who: Who;
  foe: Foe;
  tier: 'normal' | 'danger' | 'boss' | 'rival';
  turn: number;
  phase: 'act' | 'over';
  outcome: Outcome | null;
  guard: number;
  calm: number;
  st: Record<string, number>;
  /** 直前に使ったカードのタグ（連鎖）と、そのカード（真似る）。 */
  last: Tag[];
  lastCard: string | null;
  cards: number;
  lies: number;
  caught: number;
}

// ─── 認識世界 ─────────────────────────────────────────────────

/** あなたが言ったこと。本当とは限らない。矛盾を見れば露見する。 */
export interface Claim {
  about: 'harmless' | 'ally' | 'authority' | 'poor' | 'knows';
  truth: boolean;
  at: number;
}

/**
 * 人物の認識世界。その人が見た・聞いたことだけからできた「あなた像」。
 * 数は観測の積み重ね（多いほど確信が強い）。
 */
export interface Mind {
  met: number;
  /** 見てきたあなたの振る舞い。 */
  violent: number;
  kind: number;
  nosy: number;
  honest: number;
  /** 見たことのあるあなたのカードと、知っているあなたの記憶。 */
  cards: string[];
  known: string[];
  claims: Claim[];
  suspicion: number;
  /** 持ち越す感情。 */
  trust: number;
  grudge: number;
  /** 人づてに聞いた量（噂）。 */
  heard: number;
  outcomes: Partial<Record<Outcome, number>>;
}

export const blankMind = (): Mind => ({
  met: 0,
  violent: 0,
  kind: 0,
  nosy: 0,
  honest: 0,
  cards: [],
  known: [],
  claims: [],
  suspicion: 0,
  trust: 0,
  grudge: 0,
  heard: 0,
  outcomes: {},
});

// ─── 挑戦 ─────────────────────────────────────────────────────

export type Pending =
  | { kind: 'encounter'; npc: string; tier: Enc['tier']; resume?: number }
  | {
      kind: 'reward';
      npc: string;
      outcome: Outcome;
      take: string[];
      help: boolean;
      boss: boolean;
      resume?: number;
    }
  | { kind: 'story'; id: string; eps: string[] }
  | { kind: 'told'; id: string; ok: boolean; text: string; chance?: number; roll?: number }
  | { kind: 'rest'; used: boolean; altered: boolean }
  | { kind: 'shop'; cards: string[]; items: string[]; sold: string[] }
  | { kind: 'ending' };

export interface Ending {
  kind: 'dead' | Outcome;
  title: string;
  text: string;
  score: number;
  won: boolean;
}

export interface Rival {
  char: Char;
  stratum: number;
  row: number;
  node: number | null;
  down: boolean;
  first: boolean;
  log: string[];
}

export type Stream = 'map' | 'enc' | 'ai' | 'story' | 'rival' | 'gossip' | 'loot';

export interface World {
  /** データの版（バランス変更の版）。 */
  v: string;
  seed: number;
  rng: Record<Stream, number>;
  depth: number;
  stratum: number;
  hour: number;
  map: MapNode[];
  pos: number | null;
  you: Char;
  rival: Rival;
  /** 人物ごとの認識世界（ライバルも 'rival' で持つ）。 */
  minds: Record<string, Mind>;
  enc: Enc | null;
  pending: Pending | null;
  flags: Record<string, number>;
  unlocked: string[];
  seen: string[];
  /** いま発火しているビルド。 */
  builds: string[];
  /** この挑戦で明らかになった隠し効果。 */
  found: string[];
  ending: Ending | null;
  /** 畳み込んだイベントの数。 */
  seq: number;
}
