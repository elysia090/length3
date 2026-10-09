import { defaultSheet } from '../content/origins';
import type { RestAction } from '../core/events';
import type { Advice, RouteKind } from '../sim/advise';
import type { Scene } from './tower';

/** 画面の持ち物（遊びそのものは Game が持つ。ここは見え方と、選びかけのものだけ）。 */

export type Screen = 'create' | 'play';

/** 次に手元の枠を押したとき、何をするか。 */
export type Aim =
  | { kind: 'inscribe'; ep: string }
  | { kind: 'rest'; action: RestAction }
  | { kind: 'buy'; id: string }
  | { kind: 'pick'; id: string }
  | { kind: 'alter'; slot: number; to: string };

/** 跳ねる数（遭遇の場面に、少しのあいだ浮かぶ）。 */
export type Pop = Scene['pops'][number];

/** 一つの手番の一行（あなたの手・相手の手・決着）。何をして、何が動いたか。 */
export interface TurnLine {
  who: 'you' | 'foe' | 'end';
  what: string;
  effects: string[];
}

/** 当たった・決着した時刻（塔の絵が、そこからの経過で動く）。 */
export interface Anim {
  foeHitAt: number;
  youHitAt: number;
  end: 'fall' | 'glow' | null;
  endAt: number;
}

/** 決着の受け取りで、選びかけているもの。 */
export interface RewardPick {
  take?: string;
  help?: number;
}

/** 人物を決める画面の下書き。 */
export interface CreateDraft {
  job: string;
  origin: string;
  ep: string;
  item: string;
  name: string;
  depth: number;
  daily: boolean;
}

export interface UiState {
  screen: Screen;
  focus: number | null;
  /** 押して見ている部屋（脇に詳しく出す）。 */
  pinned: number | null;
  /** 見取り図に描く道（選んだ一本と、触れている一本だけ）。 */
  routeSel: RouteKind | 'walk' | null;
  routePeek: RouteKind | null;
  /** 案内を一覧でめくっているときの位置。 */
  browse: number | null;
  hintShown: string | null;
  /** 遭遇の外で押して開いたカード（触れられない端末でも中身を読める）。 */
  opened: number | null;
  advice: Advice | null;
  adviceAt: number;
  log: string[];
  aim: Aim | null;
  reward: RewardPick;
  anim: Anim;
  pops: Pop[];
  create: CreateDraft;
}

export function initialState(): UiState {
  return {
    screen: 'create',
    focus: null,
    pinned: null,
    routeSel: null,
    routePeek: null,
    browse: null,
    hintShown: null,
    opened: null,
    advice: null,
    adviceAt: -1,
    log: [],
    aim: null,
    reward: {},
    anim: { foeHitAt: -9, youHitAt: -9, end: null, endAt: -9 },
    pops: [],
    create: { job: 'watch', ...defaultSheet('watch'), name: '', depth: 0, daily: false },
  };
}
