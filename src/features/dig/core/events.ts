import type {
  Card,
  Ending,
  Foe,
  Goal,
  GoalCarry,
  GoalSize,
  Intent,
  MapNode,
  Mind,
  Outcome,
  Pending,
  Stat,
  Stream,
  Who,
} from './model';
import type { Tag } from './tags';

/**
 * イベント（起きたこと）とコマンド（したいこと）。
 *
 * イベントは過去形の事実で、世界はイベントを順に畳み込んだもの。乱数も
 * イベントに書く（rng）。だから、イベント列だけあれば世界をいつでも
 * 作り直せる。コマンドは decide がイベントに変える。種とコマンド列が
 * 同じなら、イベント列も同じになる（決定論）。
 */

export type Ev =
  | {
      type: 'run.started';
      seed: number;
      v: string;
      depth: number;
      you: import('./model').Char;
      rival: import('./model').Char;
    }
  | { type: 'rng'; s: Partial<Record<Stream, number>> }
  | { type: 'map.built'; stratum: number; nodes: MapNode[] }
  | { type: 'time'; hours: number }
  | { type: 'moved'; node: number | null }
  | { type: 'node'; id: number; visited?: boolean; rival?: string }
  | { type: 'pending'; p: Pending | null }
  | { type: 'vital'; who: Who; hp?: number; mind?: number }
  | { type: 'coins'; who: Who; n: number }
  /** 持ち物を得る（uses の回数ぶん）・手放す。 */
  | { type: 'item'; who: Who; id: string; n: 1 | -1; uses?: number }
  /** 持ち物を一回使う（尽きたら手放す）。 */
  | { type: 'item.use'; who: Who; index: number }
  /** 備えを一つ足す（次の遭遇の初めに起きる）。 */
  | { type: 'prep'; who: Who; name: string; fx: import('../content/fx').Fx[]; mult?: number }
  | { type: 'prep.clear'; who: Who }
  | { type: 'xp'; who: Who; stat: Stat; n: number }
  | { type: 'grew'; who: Who; stat: Stat; n?: number; innate?: boolean }
  | { type: 'perm'; who: Who; id: string; gain: boolean; why: string }
  | {
      type: 'card.use';
      who: Who;
      slot: number;
      card: string;
      spent: boolean;
      free: boolean;
      quiet: boolean;
      tags: Tag[];
    }
  | { type: 'card.ep'; who: Who; slot: number; ep: string; on: boolean }
  | { type: 'perm.ep'; who: Who; perm: string; ep: string; on: boolean }
  | { type: 'ep.held'; who: Who; ep: string; n: 1 | -1 }
  | { type: 'ep.drained'; who: Who; ep: string; n: 1 | -1 }
  | { type: 'card.uses'; who: Who; slot: number; n: number }
  | { type: 'card.max'; who: Who; slot: number; n: number }
  | { type: 'card.mark'; who: Who; slot: number; mark: string; n: number }
  | { type: 'card.set'; who: Who; slot: number; card: Card | null; why: string }
  /** 後ろの札（手持ち）に加える・枠と入れ替える・回数を戻す・手放す。 */
  | { type: 'deck.add'; who: Who; card: Card }
  /** 尽きた枠の札と、後ろの札を入れ替える（out・inn は知らせるための札の id）。 */
  | { type: 'deck.swap'; who: Who; slot: number; index: number; out?: string; inn?: string }
  /** 遭遇の初めに、手持ちから五枚を配り直す（uids の順に枠へ、残りは後ろへ）。 */
  | { type: 'deck.deal'; who: Who; uids: number[] }
  | { type: 'deck.uses'; who: Who; index: number; n: number }
  | { type: 'deck.ep'; who: Who; index: number; ep: string; on: boolean }
  | { type: 'deck.max'; who: Who; index: number; n: number }
  | { type: 'deck.drop'; who: Who; index: number }
  /** 決着の余韻が付く・遭遇ごとに一つ減る・使い切る。 */
  | { type: 'after'; after: import('./model').After }
  | { type: 'after.tick' }
  | { type: 'after.end'; kind: import('./model').AfterKind }
  /** 疲れが溜まる・抜ける。 */
  /** 地力が新しい高さに届いた（持てる札 +1）。 */
  | { type: 'level'; who: Who; n: number }
  | { type: 'debt'; who: Who; npc: string; n: number }
  | { type: 'title'; who: Who; id: string }
  | { type: 'flag'; key: string; v: number }
  | { type: 'goal.set'; goal: Goal }
  | { type: 'goal.done'; size: GoalSize }
  | { type: 'unlock'; story: string }
  | { type: 'story.seen'; id: string }
  | { type: 'found'; id: string }
  /** その場で、品か一服を使った（隠し順序の直前を覚える）。 */
  | { type: 'use.mark'; id: string; at: number | null }
  | {
      type: 'enc.start';
      who: Who;
      foe: Foe;
      tier: 'normal' | 'danger' | 'boss' | 'rival';
      stage?: Tag[];
    }
  | { type: 'intent'; move: string; intent: Intent }
  | {
      type: 'foe';
      field:
        | 'hp'
        | 'resolve'
        | 'trust'
        | 'hostility'
        | 'guard'
        | 'def'
        | 'atk'
        | 'wil'
        | 'int'
        | 'agi'
        | 'maxHp'
        | 'maxResolve'
        | 'need';
      n: number;
      by?: string;
    }
  | { type: 'foe.st'; key: string; n: number }
  /** 向き合っている相手に、エピテットが刻まれた。 */
  | { type: 'foe.ep'; ep: string }
  /** 地図の部屋に、エピテットが刻まれた。 */
  | { type: 'node.ep'; id: number; ep: string }
  | { type: 'enc.you'; field: 'guard' | 'calm'; n: number }
  | { type: 'enc.st'; key: string; n: number }
  | { type: 'clue'; id: string; shown: boolean; false?: boolean }
  | { type: 'seen' }
  | { type: 'check'; stat: string; chance: number; roll: number; ok: boolean }
  | { type: 'say'; who: 'foe' | 'you' | 'voice'; text: string }
  | { type: 'claim'; about: import('./model').Claim['about']; truth: boolean }
  | { type: 'caught'; about: string }
  | { type: 'act'; move: string }
  | { type: 'turn' }
  | { type: 'enc.end'; outcome: Outcome }
  | { type: 'enc.close' }
  | {
      type: 'mind';
      npc: string;
      d: Partial<
        Record<
          | 'met'
          | 'violent'
          | 'kind'
          | 'nosy'
          | 'honest'
          | 'suspicion'
          | 'trust'
          | 'grudge'
          | 'heard',
          number
        >
      >;
      cards?: string[];
      known?: string[];
      outcome?: Outcome;
    }
  | { type: 'gossip'; from: string; to: string; d: Partial<Mind> }
  | {
      type: 'rival';
      stratum?: number;
      row?: number;
      node?: number | null;
      down?: boolean;
      first?: boolean;
      log?: string;
    }
  | { type: 'rival.char'; char: import('./model').Char }
  | { type: 'rule'; source: string; text: string }
  | { type: 'ending'; ending: Ending }
  /**
   * 一文。level は画面に出す重み：0 は出さない（読み上げだけ）、1 は塔の上に
   * 小さく出してすぐ消す、2 は記録に残す、3 は名場面として大きく一度だけ出す。
   */
  | { type: 'note'; text: string; level?: 0 | 1 | 2 | 3 };

export type EvType = Ev['type'];
export type EvOf<T extends EvType> = Extract<Ev, { type: T }>;

export type Basic = 'press' | 'brace' | 'talk' | 'leave' | 'accept';
export type RestAction = 'rest' | 'full' | 'eat' | 'tune-int' | 'tune-wil' | 'discard' | 'bet';

export type Cmd =
  | {
      c: 'start';
      seed: number;
      job: string;
      depth: number;
      carry?: string;
      remembered?: Record<string, Partial<Mind>>;
      sheet?: import('../content/origins').Sheet;
      /** 前の挑戦で届かなかった目標（進んだ分ごと引き継ぐ）。 */
      goals?: GoalCarry[];
    }
  | { c: 'move'; node: number }
  /** q は「その場で」の目押しの出来（0.6 外れ・1 良し・1.5 会心）。 */
  | { c: 'breather'; q?: number }
  | { c: 'item'; index: number; q?: number }
  | { c: 'act'; a: Basic }
  | { c: 'card'; slot: number }
  | { c: 'close' }
  | {
      c: 'claim';
      take?: string;
      help?: number;
      card?: string;
      /** 手持ちがいっぱいのとき、代わりに手放す札（uid）。 */
      drop?: number;
      tool?: string;
    }
  | { c: 'choose'; option: number }
  | { c: 'ack' }
  | { c: 'rest'; action: RestAction; slot?: number }
  | { c: 'buy'; id: string; drop?: number }
  | { c: 'alter'; slot: number; to: string }
  | {
      c: 'inscribe';
      ep: string;
      slot?: number;
      /** 手持ちの札（枠でも後ろでも）。 */
      uid?: number;
      perm?: string;
      /** 地図の部屋（先の部屋）。 */
      node?: number;
      /** 向き合っている相手。 */
      foe?: boolean;
      /** いま開いている出来事。 */
      story?: boolean;
    }
  /** 札からエピテットを剥がして手に戻す（向き合っていないとき）。 */
  | { c: 'peel'; uid: number; ep: string }
  | { c: 'sell'; perm: string }
  | { c: 'cure'; perm: string }
  | { c: 'sacrifice'; stat: Stat; slot: number }
  | { c: 'depart' }
  /** 抜けたあと、さらに下りる（go）か、ここで灯りを置くか。 */
  | { c: 'onward'; go: boolean };
