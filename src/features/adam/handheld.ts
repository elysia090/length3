/**
 * 手持ちのカメラ。三脚に据えず、肩で構えた人がじっと狙っている揺れ。
 * ゆっくりした重心の泳ぎ（数秒周期）に、ごく小さな手の震えを重ね、
 * 水平もわずかに傾いては戻る。周期は互いに割り切れない値にして、同じ
 * 揺れが繰り返して見えないようにする。
 *
 * x, y は絵の幅に対する割合、roll はラジアン、zoom は 1 以上の倍率
 * （揺れても額の縁が覗かないだけ寄っておく）。
 */
export interface Shot {
  x: number;
  y: number;
  roll: number;
  zoom: number;
}

const wave = (t: number, f: number, phase: number) => Math.sin(Math.PI * 2 * f * t + phase);

/** 揺れの最大量。テストと額の寄りの計算に使う。 */
export const SWAY = 0.012;
export const ROLL = 0.009;
export const ZOOM = 1.06;

export function handheld(t: number, still: boolean): Shot {
  if (still) return { x: 0, y: 0, roll: 0, zoom: ZOOM };
  const x =
    SWAY * (0.62 * wave(t, 0.071, 1.3) + 0.28 * wave(t, 0.193, 4.1) + 0.1 * wave(t, 2.3, 0.7));
  const y =
    SWAY * (0.55 * wave(t, 0.089, 2.2) + 0.33 * wave(t, 0.241, 0.4) + 0.12 * wave(t, 3.1, 5.3));
  const roll = ROLL * (0.7 * wave(t, 0.043, 0.9) + 0.3 * wave(t, 0.157, 3.3));
  const zoom = ZOOM + 0.01 * wave(t, 0.031, 1.7);
  return { x, y, roll, zoom };
}
