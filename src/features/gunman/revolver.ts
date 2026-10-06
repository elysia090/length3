import {
  add,
  apply,
  cross,
  dot,
  IDENTITY,
  type Mat3,
  mul,
  normalize,
  rotX,
  rotY,
  rotZ,
  scale,
  sub,
  type Vec3,
} from '../../shared/pixel/math';
import { AMBER, INK } from '../../shared/pixel/raster';
import { type Solid, shade } from '../../shared/pixel/solids';

/**
 * リボルバー。銃の座標は、シリンダーの軸を原点に、銃身が -z、射手が +z、
 * 上が +y。単位は m より少し大きい（画面の手前 1 m に置いて丁度よい寸法）。
 *
 * 部品は箱と角柱だけで組む。シリンダーは 10 角柱で、後ろの面に 6 つの
 * 薬室を描く。薬室は 0 番が真上（撃鉄の下、銃身の後ろ）で、シリンダーが
 * θ 回ると k 番は π/2 + k·60° + θ の位置に来る。振り出しはシリンダーの
 * 左下にあるクレーンの軸（銃身と平行）まわりの回転。
 */

export type Chamber = 'live' | 'spent' | 'empty';

export interface Xf {
  m: Mat3;
  t: Vec3;
}

export const xf = (m: Mat3 = IDENTITY, t: Vec3 = [0, 0, 0]): Xf => ({ m, t });
export const compose = (a: Xf, b: Xf): Xf => ({ m: mul(a.m, b.m), t: add(apply(a.m, b.t), a.t) });
export const xp = (x: Xf, p: Vec3): Vec3 => add(apply(x.m, p), x.t);
/** 点 pivot を中心に m で回す。 */
export const about = (pivot: Vec3, m: Mat3): Xf =>
  compose(xf(IDENTITY, pivot), compose(xf(m), xf(IDENTITY, scale(pivot, -1))));

type Material = 'steel' | 'blued' | 'brass' | 'grip';

function face(verts: Vec3[], idx: number[], center: Vec3, mat: Material) {
  const a = verts[idx[0] ?? 0] ?? [0, 0, 0];
  const b = verts[idx[1] ?? 0] ?? [0, 0, 0];
  const c = verts[idx[2] ?? 0] ?? [0, 0, 0];
  let n = normalize(cross(sub(b, a), sub(c, a)));
  let fc: Vec3 = [0, 0, 0];
  for (const i of idx) fc = add(fc, verts[i] ?? [0, 0, 0]);
  fc = scale(fc, 1 / idx.length);
  if (dot(n, sub(fc, center)) < 0) n = scale(n, -1);
  const s = shade(n);
  const tone =
    mat === 'brass'
      ? 0.4 + 0.6 * s
      : mat === 'grip'
        ? 0.1 + 0.45 * s
        : mat === 'blued'
          ? 0.12 + 0.62 * s
          : 0.3 + 0.7 * s;
  return { v: idx, n, tone, dark: mat === 'brass' ? AMBER : INK, alt: INK, mix: 0 };
}

function centroid(vs: Vec3[]): Vec3 {
  let c: Vec3 = [0, 0, 0];
  for (const v of vs) c = add(c, v);
  return scale(c, 1 / vs.length);
}

export function box(x: Xf, min: Vec3, max: Vec3, mat: Material): Solid {
  const local: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    local.push([i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]);
  }
  const verts = local.map((p) => xp(x, p));
  const c = centroid(verts);
  const quads = [
    [0, 2, 6, 4],
    [1, 5, 7, 3],
    [0, 4, 5, 1],
    [2, 3, 7, 6],
    [0, 1, 3, 2],
    [4, 6, 7, 5],
  ];
  return {
    verts,
    faces: quads.map((q) => face(verts, q, c, mat)),
    edges: [
      [0, 1],
      [2, 3],
      [4, 5],
      [6, 7],
      [0, 2],
      [1, 3],
      [4, 6],
      [5, 7],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ],
    edgeColor: INK,
  };
}

/** z 方向の角柱。中心 (cx, cy)、半径 r、z0..z1。 */
export function prism(
  x: Xf,
  n: number,
  r: number,
  cx: number,
  cy: number,
  z0: number,
  z1: number,
  mat: Material,
  phase = 0,
): Solid {
  const local: Vec3[] = [];
  for (const z of [z0, z1]) {
    for (let k = 0; k < n; k++) {
      const a = phase + (k / n) * Math.PI * 2;
      local.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, z]);
    }
  }
  const verts = local.map((p) => xp(x, p));
  const c = centroid(verts);
  const faces = [];
  const edges: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    faces.push(face(verts, [k, k1, n + k1, n + k], c, mat));
    edges.push([k, k1], [n + k, n + k1]);
    if (k % 2 === 0) edges.push([k, n + k]);
  }
  faces.push(face(verts, [...Array(n).keys()], c, mat));
  faces.push(
    face(
      verts,
      [...Array(n).keys()].map((k) => n + k),
      c,
      mat,
    ),
  );
  return { verts, faces, edges, edgeColor: INK };
}

export interface RevolverPose {
  /** 銃全体の置き場所と向き（カメラ座標）。 */
  body: Xf;
  /** シリンダーの回転（rad）。 */
  cylinder: number;
  /** 振り出し（0 = 閉、1 = 全開）。 */
  swing: number;
  /** 撃鉄の起き（0 = 落ちている、1 = 起きている）。 */
  hammer: number;
  /** 引き金の引き（0..1）。 */
  trigger: number;
  chambers: readonly Chamber[];
  /** 込めている途中の弾。chamber 番の薬室に p（0..1）まで入っている。 */
  inserting: { chamber: number; p: number } | null;
}

export const CHAMBER_RADIUS = 0.088;
export const CYLINDER_REAR = 0.165;
const CRANE: Vec3 = [-0.12, -0.13, 0];
const SWING_ANGLE = 1.45;

/** 振り出しも回転も込みで、シリンダーの座標から銃の座標へ。 */
export function cylinderXf(pose: RevolverPose): Xf {
  const swing = about(CRANE, rotZ(pose.swing * SWING_ANGLE));
  return compose(pose.body, compose(swing, xf(rotZ(pose.cylinder))));
}

export function chamberAngle(k: number): number {
  return Math.PI / 2 + (k * Math.PI) / 3;
}

/** k 番の薬室の後ろの口（カメラ座標）。薬莢を飛ばす起点。 */
export function chamberMouth(pose: RevolverPose, k: number): Vec3 {
  const a = chamberAngle(k);
  return xp(cylinderXf(pose), [
    Math.cos(a) * CHAMBER_RADIUS,
    Math.sin(a) * CHAMBER_RADIUS,
    CYLINDER_REAR,
  ]);
}

export function muzzle(pose: RevolverPose): Vec3 {
  return xp(pose.body, [0, 0.088, -1.0]);
}

export function revolverSolids(pose: RevolverPose): Solid[] {
  const b = pose.body;
  const cyl = cylinderXf(pose);
  const out: Solid[] = [
    // 銃身と、その下のラグ（エジェクターロッドの覆い）。
    prism(b, 8, 0.056, 0, 0.088, -1.0, -0.17, 'blued', Math.PI / 8),
    box(b, [-0.034, -0.02, -0.98], [0.034, 0.05, -0.18], 'blued'),
    box(b, [-0.012, 0.14, -0.98], [0.012, 0.19, -0.92], 'blued'),
    // 上の帯、後ろの盾、下の枠。
    box(b, [-0.06, 0.15, -0.2], [0.06, 0.205, 0.22], 'blued'),
    box(b, [-0.022, 0.205, 0.16], [-0.008, 0.225, 0.22], 'blued'),
    box(b, [0.008, 0.205, 0.16], [0.022, 0.225, 0.22], 'blued'),
    box(b, [-0.11, -0.15, 0.175], [0.11, 0.17, 0.27], 'steel'),
    box(b, [-0.075, -0.235, -0.2], [0.075, -0.15, 0.3], 'blued'),
    // 引き金の囲いと引き金。
    box(b, [-0.018, -0.37, -0.1], [0.018, -0.34, 0.2], 'blued'),
    box(b, [-0.018, -0.34, -0.1], [0.018, -0.235, -0.065], 'blued'),
    box(
      compose(b, about([0, -0.235, 0.06], rotX(-pose.trigger * 0.45))),
      [-0.014, -0.33, 0.03],
      [0.014, -0.235, 0.07],
      'steel',
    ),
    // 握り。後ろへ傾けた木の塊。
    box(
      compose(b, about([0, -0.21, 0.25], rotX(0.38))),
      [-0.076, -0.64, 0.16],
      [0.076, -0.2, 0.36],
      'grip',
    ),
    // 撃鉄。起きると後ろへ倒れる。
    box(
      compose(b, about([0, 0.13, 0.25], rotX(-pose.hammer * 0.7))),
      [-0.03, 0.13, 0.22],
      [0.03, 0.31, 0.28],
      'steel',
    ),
    // シリンダー。
    prism(cyl, 10, 0.152, 0, 0, -0.16, CYLINDER_REAR, 'steel', Math.PI / 10),
  ];
  // 振り出したときだけ見えるクレーンの腕。
  if (pose.swing > 0.05) {
    const crane = compose(b, about(CRANE, rotZ(pose.swing * SWING_ANGLE)));
    out.push(box(crane, [-0.14, -0.15, -0.16], [-0.03, -0.11, -0.12], 'blued'));
    out.push(prism(cyl, 6, 0.016, 0, 0, -0.42, -0.16, 'steel'));
  }
  if (pose.inserting) {
    const a = chamberAngle(pose.inserting.chamber);
    const z = CYLINDER_REAR + 0.16 * (1 - pose.inserting.p);
    out.push(
      prism(
        cyl,
        6,
        0.03,
        Math.cos(a) * CHAMBER_RADIUS,
        Math.sin(a) * CHAMBER_RADIUS,
        z - 0.13,
        z + 0.012,
        'brass',
      ),
    );
  }
  return out;
}

/** 銃を構えた位置。aimX/aimY は照準の画面上のずれ（-1..1）。 */
export function heldPose(aimX: number, aimY: number, recoil: number, reload: number): Xf {
  const k = 0.55;
  const size: Mat3 = [k, 0, 0, 0, k, 0, 0, 0, k];
  // 構え: 右下に置き、銃口を少し内へ向けて、右の側面とシリンダーを見せる。
  const yaw = 0.12 - aimX * 0.2;
  const pitch = aimY * 0.16 + recoil * 0.5;
  const held = compose(
    xf(IDENTITY, [0.3, -0.3 + recoil * 0.03, -0.95 + recoil * 0.06]),
    xf(mul(rotY(yaw), mul(rotX(pitch), size))),
  );
  // 込め替えの構え: 手前の中央へ引き寄せ、少し右へ傾けて銃口をわずかに
  // 下げる。左へ振り出したシリンダーの後ろの面が、まっすぐこちらを向く。
  const loading = compose(
    xf(IDENTITY, [0.17, -0.12, -0.72]),
    xf(mul(rotY(0.12), mul(rotX(-0.12), mul(rotZ(0.55), size)))),
  );
  if (reload <= 0) return held;
  if (reload >= 1) return loading;
  // 二つの構えのあいだは、位置を直線で、向きは成分ごとに混ぜてから正規化する
  // 代わりに、回転角そのものを補間する。
  const r = reload;
  return compose(
    xf(IDENTITY, [0.3 + (0.17 - 0.3) * r, -0.3 + (-0.12 + 0.3) * r, -0.95 + (-0.72 + 0.95) * r]),
    xf(
      mul(
        rotY(yaw + (0.12 - yaw) * r),
        mul(rotX(pitch + (-0.12 - pitch) * r), mul(rotZ(0.55 * r), size)),
      ),
    ),
  );
}
