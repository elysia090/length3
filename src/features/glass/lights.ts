/**
 * 絵の中の光源。座標は原画（1536 × 1024）の画素。
 *
 * 主光は手前の窓の中の電気スタンド。暖色で、いちばん強い。補助光は月で、
 * 寒色。街灯は暖色だが弱く、通りの上にいるタイルにだけ効く。
 *
 * タイルはそれぞれ、自分の中心から各光源への向きと距離で照らされる。
 * 背景は動かずタイルだけがスクロールするので、照り方は位置の関数になる。
 */

export const PAINTING_W = 1536;
export const PAINTING_H = 1024;
/** 画面が縦長のとき、絵のどこを中心に切り抜くか（0 = 左端）。窓と通りを残す。 */
export const FOCUS_X = 0.3;

export interface Light {
  x: number;
  y: number;
  /** 強さ。距離で落ちる前の値。 */
  power: number;
  warm: boolean;
}

export const LIGHTS: readonly Light[] = [
  { x: 18, y: 505, power: 1.0, warm: true },
  { x: 1327, y: 320, power: 0.75, warm: false },
  { x: 1050, y: 683, power: 0.35, warm: true },
  { x: 748, y: 606, power: 0.3, warm: true },
];

export interface Viewport {
  width: number;
  height: number;
}

/** 原画の点が、画面のどこに来るか。object-fit: cover と同じ写し方。 */
export function toViewport(x: number, y: number, vp: Viewport): [number, number] {
  const s = Math.max(vp.width / PAINTING_W, vp.height / PAINTING_H);
  const ox = (vp.width - PAINTING_W * s) * FOCUS_X;
  const oy = (vp.height - PAINTING_H * s) * 0.5;
  return [ox + x * s, oy + y * s];
}

export interface Lighting {
  /** 暖色の光の来る向き（単位ベクトル、画面座標）と強さ 0..1。 */
  warm: [number, number, number];
  /** 寒色の光。 */
  cool: [number, number, number];
}

/**
 * 画面上の点 (cx, cy) が受ける光。距離の 1.2 乗で落とし、同じ色の光は
 * 向きを強さで重み付けして一本にまとめる。
 */
export function lightAt(cx: number, cy: number, vp: Viewport): Lighting {
  const diag = Math.hypot(vp.width, vp.height);
  const acc: Record<'warm' | 'cool', [number, number, number]> = {
    warm: [0, 0, 0],
    cool: [0, 0, 0],
  };
  for (const light of LIGHTS) {
    const [lx, ly] = toViewport(light.x, light.y, vp);
    const dx = lx - cx;
    const dy = ly - cy;
    const d = Math.hypot(dx, dy) || 1;
    const fall = light.power / (1 + (d / (diag * 0.35)) ** 1.2);
    const bucket = light.warm ? acc.warm : acc.cool;
    bucket[0] += (dx / d) * fall;
    bucket[1] += (dy / d) * fall;
    bucket[2] += fall;
  }
  const finish = ([x, y, power]: [number, number, number]): [number, number, number] => {
    const l = Math.hypot(x, y) || 1;
    return [x / l, y / l, Math.min(1, power)];
  };
  return { warm: finish(acc.warm), cool: finish(acc.cool) };
}
