import {
  armPose,
  DIG,
  interpolateKeys,
  type Pose,
  placeShovel,
  SHOVEL_ARM,
  solveArm,
} from '../../shared/pixel/linkage';
import {
  apply,
  clamp,
  easeOutBack,
  easeOutCubic,
  hash,
  mul,
  rotX,
  rotY,
  rotZ,
  type Vec3,
} from '../../shared/pixel/math';
import type { CubeState, ShovelState } from '../../shared/pixel/solids';

/**
 * 一覧の舞台のシャベルで遊ぶ。
 *
 *   掴んで運ぶ   シャベルは持ち上がり、運ぶ向きに遅れて傾く（ばね）。離すと
 *                落ちて刺さる
 *   床を押す     シャベルがそこへ跳んでいって、油圧ショベルの腕のように掘る。
 *                穴が開き、土くれが飛ぶ。
 *                穴は少しずつ埋まる
 *   同じ所を三度 何かが出てくる（琥珀の小さな箱）。押すと、どれか一本の
 *                記事が開く
 *   シャベルを押す くるりと回る
 *
 * 時間に沿って進む状態（掴んでいるあいだの傾き）だけ stage.ts が持ち、
 * ここでは時刻からその瞬間の姿を返す。
 */

export interface DigEvent {
  at: number;
  from: readonly [number, number];
  x: number;
  z: number;
}

export interface Pit {
  x: number;
  z: number;
  /** 掘った回数（0..3）と、最後に掘った時刻。 */
  depth: number;
  at: number;
}

export interface Treasure {
  x: number;
  z: number;
  at: number;
  /** どの記事を開くか（標本の番号）。 */
  index: number;
}

export interface Yard {
  /** シャベルが立っている床の位置。 */
  home: [number, number];
  /** 掴んでいるあいだの位置と、持ち上がり具合（0..1）。 */
  held: boolean;
  liftSince: number;
  dropAt: number;
  /** 運ぶ向きへの傾き（x, z、ラジアン）。stage.ts のばねが更新する。 */
  lean: [number, number];
  digs: DigEvent[];
  pits: Pit[];
  treasures: Treasure[];
  spinAt: number;
}

export function newYard(home: [number, number]): Yard {
  return {
    home,
    held: false,
    liftSince: -9,
    dropAt: -9,
    lean: [0, 0],
    digs: [],
    pits: [],
    treasures: [],
    spinAt: -9,
  };
}

/** 跳ぶ・刃が土に入る・掘り終わるまでの秒。 */
export const HOP = 0.28;
export const PLUNGE = 0.42;
export const DIG_END = 1.0;

/**
 * 掘る一巡り（秒）。油圧ショベルの三節の腕の掘り方（shared/pixel/linkage.ts）。
 * 跳んでいるあいだに構え、PLUNGE で刃が入り、巻き込んで持ち上げ、前へ
 * 伸ばして放ってから休みへ戻る。関節角に解いておく。
 */
const DIG_KEYS = (
  [
    [0, DIG.REST],
    [HOP * 0.7, DIG.REACH],
    [PLUNGE, DIG.BITE],
    [0.52, DIG.CURL],
    [0.64, DIG.LIFT],
    [0.76, DIG.DUMP],
    [0.86, DIG.FOLLOW],
    [DIG_END, DIG.REST],
  ] as const
).map(([t, p]) => [t, solveArm(SHOVEL_ARM, p)] as const);

/** 穴が一段埋まるまでの秒。 */
export const REFILL = 7;
/** 出てきた箱が床に沈むまでの秒。 */
export const TREASURE_LIFE = 9;
/** 同じ穴とみなす距離。 */
const SAME_PIT = 1.1;
/** 宝が出る深さ。 */
export const FIND_DEPTH = 3;

/** いまの穴の深さ（埋まった分を引く）。 */
export function pitDepth(p: Pit, t: number): number {
  return Math.max(0, p.depth - Math.max(0, t - p.at) / REFILL);
}

/**
 * 床の (x, z) を掘る。シャベルはいまの位置からそこへ跳び、差し込んだ瞬間に
 * 穴が一段深くなる。三段目で宝が出る。pick は宝が開く記事を選ぶ。
 */
export function dig(yard: Yard, x: number, z: number, t: number, pick: () => number): void {
  const last = yard.digs[yard.digs.length - 1];
  const from: [number, number] =
    last && t - last.at < DIG_END ? [last.x, last.z] : [yard.home[0], yard.home[1]];
  yard.digs.push({ at: t, from, x, z });
  if (yard.digs.length > 12) yard.digs.shift();
  yard.home = [x, z];
  const when = t + PLUNGE;
  const near = yard.pits.find(
    (p) => Math.hypot(p.x - x, p.z - z) < SAME_PIT && pitDepth(p, t) > 0.2,
  );
  if (near) {
    // 埋まりかけた穴を掘り直すと、一段深くなる（埋まった分は数えない）。
    near.depth = Math.min(FIND_DEPTH, Math.ceil(pitDepth(near, t) - 1e-6) + 1);
    near.at = when;
    if (near.depth >= FIND_DEPTH && !yard.treasures.some((q) => t - q.at < TREASURE_LIFE)) {
      yard.treasures.push({ x: near.x, z: near.z, at: when, index: pick() });
      near.depth = 1;
    }
  } else {
    yard.pits.push({ x, z, depth: 1, at: when });
  }
  yard.pits = yard.pits.filter((p) => pitDepth(p, t) > 0);
  yard.treasures = yard.treasures.filter((q) => t - q.at < TREASURE_LIFE + 1);
}

/** いま掘っている最中の出来事（無ければ null）。 */
export function digging(yard: Yard, t: number): DigEvent | null {
  const d = yard.digs[yard.digs.length - 1];
  return d && t - d.at < DIG_END ? d : null;
}

/**
 * シャベルの姿。base は舞台の振付が決めた回転（独楽の回り）と刃先の位置。
 * 掴んでいれば持ち上げて傾け、掘っていれば跳んで差し込んで振り上げる。
 */
export function yardShovel(yard: Yard, base: ShovelState, t: number, still: boolean): ShovelState {
  let [x, z] = yard.home;
  let y = 0;
  let rot = base.rot;
  const d = digging(yard, t);
  if (yard.held) {
    const k = still ? 1 : easeOutCubic(clamp((t - yard.liftSince) / 0.18));
    y = 0.7 * k;
  } else if (!still && t - yard.dropAt < 0.5) {
    // 落ちて刺さり、少し沈んで戻る。
    const u = (t - yard.dropAt) / 0.5;
    y = -0.14 * Math.sin(Math.PI * clamp(u * 1.6)) * (1 - u);
  }
  let arm: Pose | null = null;
  if (d && !still) {
    const u = t - d.at;
    if (u < HOP) {
      const q = u / HOP;
      const p = q * q * (3 - 2 * q);
      x = d.from[0] + (d.x - d.from[0]) * p;
      z = d.from[1] + (d.z - d.from[1]) * p;
      y = 0.9 * Math.sin(Math.PI * q);
    }
    arm = armPose(SHOVEL_ARM, interpolateKeys(DIG_KEYS, u));
  }
  if (!still && t - yard.spinAt < 0.7) {
    const p = (t - yard.spinAt) / 0.7;
    rot = mul(rotY(Math.PI * 2 * easeOutBack(p, 1.2)), rot);
    y += 0.5 * Math.sin(Math.PI * p);
  }
  let pivot: Vec3 = [x, y, z];
  if (arm) {
    // 刃の向いている方へ掘る。腕は重心を中心にシャベルを回し、弧で運ぶ。
    const face = apply(rot, [0, 0, 1]);
    const placed = placeShovel(pivot, Math.atan2(face[0], face[2]), rot, arm, base.scale);
    rot = placed.rot;
    // 刃先は穴の底あたりまで。
    pivot = [placed.tip[0], Math.max(-0.2 * base.scale, placed.tip[1]), placed.tip[2]];
  }
  // 運ぶ向きへの傾き。世界の軸で後から掛ける。
  rot = mul(rotZ(-yard.lean[0]), mul(rotX(yard.lean[1]), rot));
  return { pivot, scale: base.scale, rot };
}

/** 掘ったときに飛ぶ土くれ（琥珀の小さな箱）。 */
export function clods(yard: Yard, t: number, still: boolean): CubeState[] {
  if (still) return [];
  const out: CubeState[] = [];
  for (const d of yard.digs) {
    const u = t - d.at - PLUNGE;
    if (u < 0 || u > 0.9) continue;
    for (let k = 0; k < 7; k++) {
      const a = hash(d.at * 13 + k) * Math.PI * 2;
      const sp = 1.2 + 1.6 * hash(d.at * 7 + k + 3);
      const vy = 3.4 + 2 * hash(d.at * 5 + k + 9);
      const h = vy * u - 9 * u * u;
      if (h < -0.05) continue;
      out.push({
        base: [d.x + Math.cos(a) * sp * u, Math.max(0, h), d.z + Math.sin(a) * sp * u],
        size: 0.22,
        rot: mul(rotX(u * 9 + k), rotZ(u * 7)),
        squash: [1, 1, 1],
        hot: 1,
        composite: false,
        airborne: Math.max(0, h),
        landed: false,
      });
    }
  }
  return out;
}

/** いま床の上に出ている箱（出てくる途中から、沈みきるまで）。 */
export function visibleTreasures(yard: Yard, t: number): Treasure[] {
  return yard.treasures.filter((q) => t >= q.at && t - q.at <= TREASURE_LIFE + 1);
}

/** 出てきた箱。跳ね上がって回り、床に落ちて光り、やがて沈む。visibleTreasures と同じ順。 */
export function treasureCubes(yard: Yard, t: number, still: boolean): CubeState[] {
  const out: CubeState[] = [];
  for (const q of visibleTreasures(yard, t)) {
    const u = t - q.at;
    const rise = still ? 0 : u < 0.7 ? 2.2 * Math.sin(Math.PI * (u / 0.7)) : 0;
    // 穴から跳び出して、シャベルの脇に落ちる。
    const out1 = still ? 1 : easeOutCubic(clamp(u / 0.7));
    const sink = clamp((u - TREASURE_LIFE) / 1) * 0.6;
    const bob = still || u < 0.7 ? 0 : 0.06 * Math.sin(u * 5);
    out.push({
      base: [q.x - 1.0 * out1, rise + bob - sink, q.z + 0.7 * out1],
      size: 0.6,
      rot: still ? IDENTITY_ROT : mul(rotY(u * 2.4), rotX(u < 0.7 ? u * 8 : 0)),
      squash: [1, 1, 1],
      hot: 0.6 + 0.4 * Math.max(0, Math.sin(u * 6)),
      composite: false,
      airborne: rise,
      landed: false,
    });
  }
  return out;
}

const IDENTITY_ROT = rotY(0);

export type { Vec3 };
