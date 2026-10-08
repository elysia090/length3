/** 塔を描くための見え方（ゲームの世界から作る。描く側は世界を知らない）。 */

export type RoomKind = 'person' | 'danger' | 'event' | 'rest' | 'shop' | 'boss';

export interface RoomView {
  id: number;
  /** 区画の中のフロア（0 = いちばん上）。 */
  floor: number;
  col: number;
  cols: number;
  /** 0 は本棟、-1 / 1 は左右の隣の塔。 */
  tower: number;
  kind: RoomKind;
  /** 人物がいるか（遭遇の部屋）。 */
  person: boolean;
  hard: number | null;
  /** 正面からは歯が立たない。 */
  over: boolean;
  visited: boolean;
  reachable: boolean;
  /** 刻まれたエピテットの数と、見せ場の有無。 */
  eps: number;
  stage: boolean;
  /** もう一人が先に寄った。 */
  rivalWas: boolean;
}

export interface TowerView {
  /** 区画のいちばん上のフロアの番号（B いくつ）。 */
  top: number;
  floors: number;
  rooms: RoomView[];
  edges: readonly (readonly [number, number])[];
  /** あなたのいる部屋（入口なら null）。 */
  you: number | null;
  /** もう一人の灯り持ちの居場所。 */
  rival: number | null;
  /** 推奨の道（濃さの違う三本）。 */
  routes: readonly { kind: 'safe' | 'chain' | 'almost'; path: readonly number[]; mark?: number }[];
  focus: number | null;
  /** 遭遇中。 */
  enc: {
    room: number;
    foeHitAt: number;
    youHitAt: number;
    end: 'fall' | 'glow' | null;
    endAt: number;
    scene?: Scene | null;
  } | null;
}

/** 向き合っている場面（寄ったときにだけ描く、計器と気配）。 */
export interface Scene {
  you: { hp: number; maxHp: number; mind: number; maxMind: number; guard: number; calm: number };
  /** 次の手で失いそうな分（守りを引く前）。 */
  loss: { hp: number; mind: number };
  foe: {
    hp: number;
    maxHp: number;
    will: number;
    maxWill: number;
    trust: number;
    need: number;
    guard: number;
    hostility: number;
    clues: number;
    shown: number;
    boss: boolean;
  };
  intent: { kind: string; power: number | null } | null;
  /** 見せ場（合うタグのカードが響いている）。 */
  stage: boolean;
  resonance: number;
  /** 長引いて、相手が苛立っている。 */
  stall: boolean;
  /** 跳ねる数（当たった・戻った・受け止めた）。 */
  pops: readonly {
    who: 'you' | 'foe';
    text: string;
    tone: 'ink' | 'amber' | 'blue' | 'green';
    at: number;
  }[];
}
