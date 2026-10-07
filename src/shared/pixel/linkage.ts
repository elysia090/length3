import { add, apply, clamp, type Mat3, mul, rotX, rotY, rotZ, scale, type Vec3 } from './math';

/**
 * シャベルを、油圧ショベルの三節の腕（ブーム・アーム・バケット）の先として
 * 動かす。肩は見えない。手首は柄の重心（シャベルはそこを中心に回る）に
 * あり、腕の二節が手首を弧で運ぶ。旋回は肩を通る鉛直の軸で回る。
 *
 * 姿勢の鍵は「手首の位置と柄の寝かせ角」で書き、関節角に解いてから
 * 関節角どうしで補間する。手首は鍵のあいだを直線ではなく腕の弧で動き、
 * 柄の向きも節の回転の和として滑らかにつながる。
 */

/** 手首の前後（山の方が +）・上下と、柄の寝かせ角、旋回（シャベルの単位・ラジアン）。 */
export interface Pose {
  reach: number;
  rise: number;
  lean: number;
  swing: number;
}

/** 肩の位置（休みの手首から見た前後・上下）と二節の長さ。 */
export interface Arm {
  shoulder: readonly [number, number];
  boom: number;
  stick: number;
}

/** 姿勢を関節の絶対角（ブーム・アーム・バケット）と旋回に解く。肘は上に折る。 */
export function solveArm(arm: Arm, p: Pose): number[] {
  const dz = p.reach - arm.shoulder[0];
  const dy = p.rise - arm.shoulder[1];
  const d = clamp(
    Math.hypot(dz, dy),
    Math.abs(arm.boom - arm.stick) + 1e-3,
    arm.boom + arm.stick - 1e-3,
  );
  const inner = Math.acos(
    clamp((arm.boom ** 2 + d * d - arm.stick ** 2) / (2 * arm.boom * d), -1, 1),
  );
  const boom = Math.atan2(dy, dz) + inner;
  const stick = Math.atan2(dy - arm.boom * Math.sin(boom), dz - arm.boom * Math.cos(boom));
  return [boom, stick, p.lean - Math.PI / 2, p.swing];
}

/** 関節角から姿勢へ（solveArm の逆）。 */
export function armPose(arm: Arm, q: readonly number[]): Pose {
  const [boom = 0, stick = 0, bucket = 0, swing = 0] = q;
  return {
    reach: arm.shoulder[0] + arm.boom * Math.cos(boom) + arm.stick * Math.cos(stick),
    rise: arm.shoulder[1] + arm.boom * Math.sin(boom) + arm.stick * Math.sin(stick),
    lean: bucket + Math.PI / 2,
    swing,
  };
}

/** 時刻つきの値の列を Catmull-Rom で補間する（端の外は端の値、端では止まる）。 */
export function interpolateKeys(
  keys: readonly (readonly [number, readonly number[]])[],
  t: number,
): number[] {
  const n = keys.length;
  const first = keys[0];
  const last = keys[n - 1];
  if (!first || !last) return [];
  if (t <= first[0]) return [...first[1]];
  if (t >= last[0]) return [...last[1]];
  let i = 0;
  while (i < n - 2 && (keys[i + 1]?.[0] ?? 0) <= t) i++;
  const [t0, p0] = keys[Math.max(0, i - 1)] ?? first;
  const [t1, p1] = keys[i] ?? first;
  const [t2, p2] = keys[i + 1] ?? last;
  const [t3, p3] = keys[Math.min(n - 1, i + 2)] ?? last;
  const h = t2 - t1;
  const u = (t - t1) / h;
  const h00 = 2 * u ** 3 - 3 * u * u + 1;
  const h10 = u ** 3 - 2 * u * u + u;
  const h01 = -2 * u ** 3 + 3 * u * u;
  const h11 = u ** 3 - u * u;
  return p1.map((a, c) => {
    const b = p2[c] ?? a;
    // 端の鍵では止まる。中の鍵では両隣を結ぶ傾き。
    const m1 = i === 0 ? 0 : (b - (p0[c] ?? a)) / (t2 - t0);
    const m2 = i + 1 === n - 1 ? 0 : ((p3[c] ?? b) - a) / (t3 - t1);
    return h00 * a + h10 * h * m1 + h01 * b + h11 * h * m2;
  });
}

/** シャベルの腕。肩は手首の後ろ上。二節の長さはシャベルの柄より少し短い。 */
export const SHOVEL_ARM: Arm = { shoulder: [-1.3, 1.1], boom: 1.4, stick: 1.3 };

/**
 * 手首の位置（シャベルの単位、刃先から柄の方へ）。柄の真ん中より少し上、
 * 重心のあたり。柄は刃の上端（1.1）から握り（3.66）まで。シャベルは
 * ここを中心に回る。
 */
export const FULCRUM: Vec3 = [0, 2.45, 0];

/**
 * 掘る一巡りの姿勢。柄はいつも前（刃の向き）と反対側へ寝ていて、垂直に
 * 立ったり後ろへ振り戻したりしない。
 *
 *   REST    休み
 *   REACH   手首を前へ伸ばし、刃先を下へ向けて構える
 *   BITE    刃が土に入る
 *   CURL    手前へ引きながら刃を寝かせ、土を載せる
 *   LIFT    載せたまま持ち上げ、少し脇へ旋回する
 *   DUMP    腕を前へ伸ばし、刃を少し開いて土を放つ
 *   FOLLOW  伸びきる
 */
export const DIG = {
  REST: { reach: 0, rise: 0, lean: 0.62, swing: 0 },
  REACH: { reach: 0.6, rise: 0.12, lean: 0.45, swing: 0 },
  BITE: { reach: 0.45, rise: 0, lean: 0.5, swing: 0 },
  CURL: { reach: 0.1, rise: -0.05, lean: 0.85, swing: 0 },
  LIFT: { reach: -0.1, rise: 0.5, lean: 0.9, swing: -0.15 },
  DUMP: { reach: 0.45, rise: 0.7, lean: 0.75, swing: 0.1 },
  FOLLOW: { reach: 0.55, rise: 0.55, lean: 0.65, swing: 0.12 },
} as const satisfies Record<string, Pose>;

/**
 * 姿勢 p のシャベル。休みの姿勢（刃先 tip、回転 base、前の向き heading）
 * からの差として置く。手首は肩から腕の弧で動き、腕ごと肩を通る鉛直の
 * 軸で旋回する。柄の寝かせは手首を中心に、休みの寝かせ（DIG.REST）からの
 * 差だけ回す。返すのは刃先と回転。刃先が床に沈むかは呼ぶ側が決める。
 */
export function placeShovel(
  tip: Vec3,
  heading: number,
  base: Mat3,
  p: Pose,
  s: number,
): { tip: Vec3; rot: Mat3 } {
  const arm = SHOVEL_ARM;
  const face = rotY(heading);
  const turn = rotY(heading + p.swing);
  const rot = mul(
    mul(turn, mul(rotZ(0.15 * p.swing), rotX(-(p.lean - DIG.REST.lean)))),
    mul(rotY(-heading), base),
  );
  const rest = add(tip, scale(apply(base, FULCRUM), s));
  const shoulder = add(rest, scale(apply(face, [0, arm.shoulder[1], arm.shoulder[0]]), s));
  const wrist = add(
    shoulder,
    scale(apply(turn, [0, p.rise - arm.shoulder[1], p.reach - arm.shoulder[0]]), s),
  );
  return { tip: add(wrist, scale(apply(rot, FULCRUM), -s)), rot };
}
