import type { Encounter, Intent, Outcome, Stat, StatBlock } from './types';

/**
 * 定義の形。中身（カード・記憶・人物・品・出来事）はそれぞれの表に書く。
 */

// ─── ACTIVE ───────────────────────────────────────────────────

export type CardCat = 'look' | 'force' | 'mind' | 'talk' | 'flee' | 'body';

/** カードが自分で回復する条件。 */
export type Trigger =
  | 'win'
  | 'newPlace'
  | 'lieKept'
  | 'quiet'
  | 'uncover'
  | 'trusted'
  | 'broken'
  | 'left';

export interface ActiveDef {
  id: string;
  name: string;
  cat: CardCat;
  /** 参照する能力値（成功率と効き目）。 */
  stats: readonly Stat[];
  uses: number;
  text: string;
  /** 成功率のある効き目なら、その率（画面に出す）。 */
  chance?: (e: Encounter) => number;
  ready: (e: Encounter, slot: number) => void;
  spentName: string;
  spentText: string;
  spentChance?: (e: Encounter) => number;
  spent: (e: Encounter, slot: number) => void;
  recover: { on: readonly Trigger[]; text: string; restOnly?: boolean };
  /** 休ませ続けた先（健全）・酷使した先（歪み）・記憶が開く先（隠し）。 */
  alter?: {
    care?: { to: string; need: number };
    overuse?: { to: string; need: number };
    secret?: { to: string; perms: readonly string[] };
  };
  /** 最大回数が、使い方で動く。 */
  shift?: { on: 'spent' | 'rested'; every: number; cap: number; perm?: string };
  /** 変質した先のカードは 1、さらにその先は 2。 */
  tier: number;
  flavor: string;
}

// ─── PERMANENT ────────────────────────────────────────────────

export type PermKind = 'memory' | 'trait' | 'wound' | 'bond' | 'state';

export interface CheckCtx {
  stat: string;
  card?: string;
}

/** 永続カード。自分が持てば効き、相手が持っていれば見えたときに攻め筋になる。 */
export interface PermDef {
  id: string;
  name: string;
  kind: PermKind;
  text: string;
  mods?: Partial<StatBlock>;
  /** 遭遇の初めに / 判定のたびに（率へ足す）。 */
  start?: (e: Encounter) => void;
  check?: (e: Encounter, ctx: CheckCtx) => number;
  /** その場の状態で動く能力値（体力が半分を切ると、など）。 */
  dyn?: (e: Encounter, s: Stat) => number;
  /** 古物商が買う値段。0 は売れない。 */
  value: number;
  tags?: readonly string[];
  /** 相手の手がかりとして見えたとき。 */
  exploit?: {
    text: string;
    press?: number;
    talk?: number;
    force?: number;
    lie?: number;
    show?: (e: Encounter) => void;
  };
  /** 最後の相手（自分の履歴）が、この記憶で何をしてくるか。 */
  echo?: { label: string; kind: 'strike' | 'threat'; power: number };
  flavor: string;
}

/** 永続カードの組み合わせ。揃うと出来事が開くか、新しい記憶になる。 */
export interface ComboDef {
  id: string;
  name: string;
  needs: readonly string[];
  text: string;
  /** 揃ったときに得る記憶、開く出来事。 */
  grant?: string;
  event?: string;
}

// ─── 人物 ─────────────────────────────────────────────────────

export interface Persona {
  /** 攻める・嘘をつく・誇り高い・怖がり・情がある・狡い。0..1。 */
  aggression: number;
  deceit: number;
  pride: number;
  fear: number;
  warmth: number;
  cunning: number;
}

export interface MoveDef {
  id: string;
  intent: (e: Encounter) => Intent;
  act: (e: Encounter) => void;
  cond?: (e: Encounter) => boolean;
  prior?: (e: Encounter) => number;
  repeat?: number;
}

export interface Reward {
  coins?: number;
  perm?: string;
  item?: string;
  /** 打ち解けた相手に、カードの回復を頼める（借りができる）。 */
  help?: boolean;
}

export interface NpcDef {
  id: string;
  name: string;
  stratum: number;
  tier: 'normal' | 'danger' | 'boss';
  hp: number;
  resolve: number;
  trustNeed: number;
  atk: number;
  def: number;
  wil: number;
  int: number;
  agi: number;
  hostility: number;
  /** 持っている記憶（手がかり）。take は暴いたときに持ち帰れるもの。 */
  clues: readonly string[];
  take: readonly string[];
  moves: readonly MoveDef[];
  persona: Persona;
  rewards: Partial<Record<Outcome, Reward>>;
  model: string;
  desc: string;
  lines: Partial<
    Record<
      'greet' | 'hurt' | 'low' | 'trusted' | 'broken' | 'beaten' | 'uncovered' | 'fled' | 'again',
      readonly string[]
    >
  >;
  /** 話すと敵意が上がる相手（静粛を求める）。 */
  hush?: boolean;
  /** 体で押すことしか通じない相手（獣・機械）。 */
  mute?: boolean;
  init?: (e: Encounter) => void;
}

// ─── 品と出来事 ───────────────────────────────────────────────

export interface ItemDef {
  id: string;
  name: string;
  text: string;
  /** 回復させるカードの種類。 */
  refill?: { cats: readonly CardCat[]; n: number };
  heal?: { hp?: number; mind?: number };
  price: number;
  flavor: string;
}

export interface EventOption {
  label: string;
  /** 判定（能力値と難しさ）。無ければ確定。 */
  stat?: Stat;
  diff?: number;
  needPerm?: string;
  needItem?: string;
  needCoins?: number;
  ok: string;
  fail?: string;
  effect: RunEffect;
  failEffect?: RunEffect;
}

/** 挑戦の状態を変える効き目。返すのは結果の一文（無ければ ok / fail の文）。 */
export type RunEffect = (r: RunLike) => string | undefined;

/** 出来事が触れてよい挑戦の部分（run.ts の Run と同じ形）。 */
export interface RunLike {
  you: import('./types').Character;
  hour: number;
  stratum: number;
  rngNext: () => number;
  has: (perm: string) => boolean;
  grant: (perm: string) => void;
  remove: (perm: string) => void;
  heal: (hp: number, mind?: number) => void;
  coins: (n: number) => void;
  item: (id: string) => void;
  refill: (n: number, cats?: readonly CardCat[]) => void;
  xp: (s: Stat, n: number) => void;
  time: (hours: number) => void;
  flag: (key: string, v?: number) => void;
}

export interface EventDef {
  id: string;
  title: string;
  strata: readonly number[];
  /** 組み合わせで開く出来事だけに出る。 */
  locked?: boolean;
  needPerm?: string;
  text: string;
  options: readonly EventOption[];
}
