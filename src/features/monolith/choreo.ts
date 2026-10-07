import { clamp, easeOutBack, easeOutCubic } from '../../shared/pixel/math';

/**
 * 石の振付。1 : 4 : 9（= 1² : 2² : 3²）の板を、カメラがゆっくり回りながら
 * 見上げ、9 秒ごとに切り返す。地面すれすれ、高い位置、真正面（ただの黒い
 * 長方形になる）。
 *
 * 触れると「整列」が起きる。カメラは真正面の低い位置へ降り、板の上の縁の
 * 向こうから琥珀の太陽が昇る。4 秒で元の巡回へ戻る。
 */

export const CUT = 9;
export const ALIGN = 4;
export const SLAB: readonly [number, number, number] = [4, 9, 1];

const ANGLES: readonly [number, number][] = [
  [0.55, 0.14],
  [Math.PI * 0.82, 0.03],
  [Math.PI * 1.3, 0.46],
  [Math.PI * 2, 0.1],
];

export interface MonolithFrame {
  azimuth: number;
  elevation: number;
  /** 太陽の昇り具合（0 = 縁の下、1 = 昇りきった）。 */
  sun: number;
  aligned: boolean;
}

export function monolithAt(t: number, touchedAt: number, still: boolean): MonolithFrame {
  const cut = Math.floor(t / CUT);
  const local = t - cut * CUT;
  const [az0, el0] = ANGLES[(cut + ANGLES.length - 1) % ANGLES.length] ?? [0, 0.1];
  const [az1, el1] = ANGLES[cut % ANGLES.length] ?? [0, 0.1];
  const k = still ? 1 : easeOutBack(clamp(local / 0.5), 1.4);
  let d = az1 - az0;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  let azimuth = az0 + d * k + (still ? 0 : local * 0.035);
  let elevation = el0 + (el1 - el0) * k;
  const since = t - touchedAt;
  if (since >= 0 && since < ALIGN) {
    // 整列: 0.6 秒で真正面の足元へ、太陽が 2.4 秒かけて昇り、最後に戻る。
    const into = still ? 1 : easeOutCubic(clamp(since / 0.6));
    const out = still ? 0 : easeOutCubic(clamp((since - (ALIGN - 0.6)) / 0.6));
    const w = into * (1 - out);
    let target = 0;
    while (target - azimuth > Math.PI) target -= Math.PI * 2;
    while (azimuth - target > Math.PI) target += Math.PI * 2;
    azimuth += (target - azimuth) * w;
    elevation += (-0.06 - elevation) * w;
    return {
      azimuth,
      elevation,
      sun: still ? 0.8 : clamp((since - 0.4) / 2.4) * (1 - out),
      aligned: w > 0.5,
    };
  }
  return { azimuth, elevation, sun: 0, aligned: false };
}
