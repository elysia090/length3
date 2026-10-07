import {
  add,
  clamp,
  easeOutBack,
  hash,
  IDENTITY,
  mul,
  rotX,
  rotY,
  rotZ,
  spring,
  type Vec3,
} from '../../shared/pixel/math';
import type { CameraState, CubeState, ShovelState } from '../../shared/pixel/solids';
import { type Archive, CELL } from './layout';

/**
 * 一覧の舞台の振付。時刻 t（秒）と操作の状態から、その瞬間の舞台を返す。
 *
 * カメラはゆっくりドリーしながら、CUT 秒ごとに 90° ずつ切り返す（Robot Tune
 * と同じ、行き過ぎて戻る止まり方）。4 回に 1 回は低い仰角に落とす。
 *
 * 切り返すたびに、照らす標本が次へ移る。照らされた 1 個だけが跳ねて潰れ、
 * 琥珀に光ってから墨の網点に冷め、体積を持つ。ほかは面を紙で塗った線画で、
 * 長さだけがある。行や立方体に触れれば、その 1 個がすぐに照らされる。
 *
 * 押された標本は、シャベルの刃に吸い寄せられてから放り投げられる。
 */

export const CUT = 6;
const SNAP = 0.45;
const ANGLES: readonly [number, number][] = [
  [Math.PI / 4 - 0.22, 0.56],
  [Math.PI * 0.75 - 0.22, 0.5],
  [Math.PI * 1.25 - 0.22, 0.6],
  [Math.PI * 1.75 - 0.22, 0.34],
];

export interface Interaction {
  /** 触れている標本。無ければ -1。 */
  hover: number;
  /** 照らし始めた時刻。跳ねと光の起点。 */
  litSince: number;
  /** 押された標本と、押した時刻。 */
  thrown: number;
  thrownAt: number;
}

export interface ArchiveScene {
  camera: CameraState;
  cubes: CubeState[];
  shovel: ShovelState;
  /** 照らされている標本。 */
  lit: number;
  /** その照らしがどれだけ新しいか（0..1、1 = 今）。HUD の点滅に使う。 */
  fresh: number;
  /** 世界の何単位を画面に収めるか。 */
  span: number;
}

/** 照らす標本。触れているものが優先、無ければ切り返しの回数で巡回。 */
export function litAt(t: number, count: number, i: Interaction): number {
  if (i.hover >= 0) return i.hover;
  return count > 0 ? Math.floor(t / CUT) % count : -1;
}

export function litStart(t: number, i: Interaction): number {
  return i.hover >= 0 ? i.litSince : Math.floor(t / CUT) * CUT;
}

function camera(t: number, archive: Archive, still: boolean): CameraState {
  const cut = Math.floor(t / CUT);
  const local = t - cut * CUT;
  const [az0, el0] = ANGLES[(cut + ANGLES.length - 1) % ANGLES.length] ?? [0, 0.5];
  const [az1, el1] = ANGLES[cut % ANGLES.length] ?? [0, 0.5];
  const k = still ? 1 : easeOutBack(clamp(local / SNAP), 1.6);
  // 方位は短い向きに回す（1.75π → 0.25π を -1.5π 回さない）。
  let d = az1 - az0;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const dolly = still ? 0 : (local / CUT - 0.5) * 0.12;
  const drift = still ? 0 : Math.sin(t * 0.21) * 0.25;
  return {
    azimuth: az0 + d * k + dolly,
    elevation: el0 + (el1 - el0) * k,
    target: [drift, archive.depth * 0.05, 0],
    span: Math.hypot(archive.width, archive.depth),
  };
}

function shovel(t: number, archive: Archive, i: Interaction, still: boolean): ShovelState {
  const pivot: Vec3 = [archive.width / 2 + 0.6, 0, archive.depth / 2 - 0.4];
  const since = t - i.thrownAt;
  const throwing = i.thrown >= 0 && since >= 0 && since < 0.6;
  // ふだんは 8 秒で一回りする独楽。切り返しの瞬間だけ半回転をがくっと決める。
  const cut = Math.floor(t / CUT);
  const local = t - cut * CUT;
  const snap = still ? 0 : easeOutBack(clamp(local / 0.38), 1.9);
  const spin = still ? 0.6 : t * ((Math.PI * 2) / 8) + Math.PI * (cut + snap);
  const fling = throwing ? easeOutBack(clamp(since / 0.22)) * Math.PI : 0;
  const recoil = throwing ? Math.max(0, spring(since, 2.6, 8)) : 0;
  const tilt = 0.6 + (still ? 0 : 0.06 * Math.sin(t * 1.3)) + 0.18 * recoil;
  return {
    pivot,
    scale: 0.95,
    rot: mul(rotY(spin + fling), mul(rotZ(0.05 * Math.sin(t * 0.9)), rotX(-tilt))),
  };
}

export function archiveSceneAt(
  t: number,
  archive: Archive,
  i: Interaction,
  still: boolean,
): ArchiveScene {
  const lit = litAt(t, archive.specimens.length, i);
  const age = t - litStart(t, i);
  const sh = shovel(t, archive, i, still);
  const cubes = archive.specimens.map((s, k): CubeState => {
    let base: Vec3 = [s.x, 0, s.z];
    let squash: Vec3 = [1, 1, 1];
    let rot = IDENTITY;
    let hot = 0;
    let airborne = 0;
    if (k === lit && !still) {
      // 跳ねて、潰れて、戻る。光は 0.6 秒で冷める。
      const hop = Math.max(0, Math.sin(Math.PI * clamp(age / 0.28))) * 0.45;
      const land = age > 0.28 ? spring(age - 0.28, 4.2, 9) : 0;
      const sq = 1 - 0.3 * Math.max(-0.4, land);
      base = add(base, [0, hop, 0]);
      squash = [1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq)];
      hot = clamp(1 - age / 0.6);
      airborne = hop;
    }
    if (k !== lit && !still && lit >= 0) {
      // 照らしが移ると、そこから距離の順に小さく跳ねる波が広がる。
      const from = archive.specimens[lit];
      const dist = from ? Math.hypot(s.x - from.x, s.z - from.z) / CELL : 0;
      const a = age - 0.12 - dist * 0.07;
      const hop = 0.16 * Math.max(0, Math.sin(Math.PI * clamp(a / 0.22)));
      base = add(base, [0, hop, 0]);
      airborne = hop;
    }
    if (k === i.thrown) {
      const since = t - i.thrownAt;
      if (since >= 0) {
        // 刃へ吸い寄せられ（0.18 秒）、回りながら手前上方へ放られる。
        const toBlade = clamp(since / 0.18);
        const fly = clamp((since - 0.18) / 0.4);
        const blade: Vec3 = add(sh.pivot, [0, 1.2, 0]);
        const from: Vec3 = [s.x, 0, s.z];
        const p1: Vec3 = [
          from[0] + (blade[0] - from[0]) * toBlade,
          4 * 1.4 * toBlade * (1 - toBlade),
          from[2] + (blade[2] - from[2]) * toBlade,
        ];
        base = add(p1, [-fly * CELL * 1.5, fly * 7 - fly * fly * 2, fly * CELL * 4]);
        rot = mul(rotX(fly * Math.PI * 2.5), rotZ(fly * Math.PI * 1.5 * (hash(k) - 0.5)));
        hot = 1;
        airborne = base[1] + 0.01;
      }
    }
    return {
      base,
      size: s.edge,
      rot,
      squash,
      hot,
      composite: false,
      airborne,
      landed: k !== lit,
    };
  });
  const cam = camera(t, archive, still);
  return {
    camera: cam,
    cubes,
    shovel: sh,
    lit,
    fresh: clamp(1 - age / 0.6),
    span: cam.span,
  };
}
