import type {
  Card,
  Ending,
  Foe,
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
  | { type: 'item'; who: Who; id: string; n: 1 | -1 }
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
  | { type: 'card.uses'; who: Who; slot: number; n: number }
  | { type: 'card.max'; who: Who; slot: number; n: number }
  | { type: 'card.mark'; who: Who; slot: number; mark: string; n: number }
  | { type: 'card.set'; who: Who; slot: number; card: Card | null; why: string }
  | { type: 'debt'; who: Who; npc: string; n: number }
  | { type: 'title'; who: Who; id: string }
  | { type: 'flag'; key: string; v: number }
  | { type: 'unlock'; story: string }
  | { type: 'story.seen'; id: string }
  | { type: 'found'; id: string }
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
      field: 'hp' | 'resolve' | 'trust' | 'hostility' | 'guard' | 'def' | 'atk' | 'wil';
      n: number;
      by?: string;
    }
  | { type: 'foe.st'; key: string; n: number }
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
export type RestAction = 'rest' | 'full' | 'tune-int' | 'tune-wil' | 'discard';

export type Cmd =
  | {
      c: 'start';
      seed: number;
      job: string;
      depth: number;
      carry?: string;
      remembered?: Record<string, Partial<Mind>>;
      sheet?: import('../content/origins').Sheet;
    }
  | { c: 'move'; node: number }
  | { c: 'breather' }
  | { c: 'item'; index: number }
  | { c: 'act'; a: Basic }
  | { c: 'card'; slot: number }
  | { c: 'close' }
  | { c: 'claim'; take?: string; help?: number; card?: string; slot?: number }
  | { c: 'choose'; option: number }
  | { c: 'ack' }
  | { c: 'rest'; action: RestAction; slot?: number }
  | { c: 'alter'; slot: number; to: string }
  | { c: 'inscribe'; ep: string; slot?: number; perm?: string }
  | { c: 'buy'; id: string; slot?: number }
  | { c: 'sell'; perm: string }
  | { c: 'cure'; perm: string }
  | { c: 'sacrifice'; stat: Stat; slot: number }
  | { c: 'depart' };
