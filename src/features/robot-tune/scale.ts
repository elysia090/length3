/**
 * 単位立方体を 1 cm³ = 1 mL とする。完成した立方体を次の段の 1 個として
 * 数え直すので、段 n の立方体は一辺 3ⁿ cm、体積 27ⁿ mL。
 *
 * 一辺は cm → m → km → au → 光年、体積は mL → L → m³ → km³ と単位を上げる。
 * 値はどちらも有効数字 3 桁。HUD はピクセルフォントで描くので、使ってよい
 * 字は font.ts にあるものだけ（³ と × と ^ はある）。
 */

const AU_CM = 1.495978707e13;
const LY_CM = 9.4607304725808e17;

export function sig3(v: number): string {
  if (Number.isInteger(v) && v < 1000) return String(v);
  if (v >= 1000) return Math.round(v).toLocaleString('en-US');
  const digits = Math.max(0, 2 - Math.floor(Math.log10(Math.abs(v))));
  return v.toFixed(Math.min(digits, 3));
}

/** 10 の何乗かで書く。上付きは HUD 側で ^ の後ろを小さく描く。 */
export function sci(v: number): string {
  const e = Math.floor(Math.log10(v));
  const m = v / 10 ** e;
  return `${m.toFixed(2)}×10^${e}`;
}

export function formatLength(cm: number): string {
  if (cm < 100) return `${sig3(cm)} cm`;
  if (cm < 1e5) return `${sig3(cm / 100)} m`;
  if (cm < AU_CM / 10) return `${sig3(cm / 1e5)} km`;
  if (cm < LY_CM / 10) return `${sig3(cm / AU_CM)} au`;
  const ly = cm / LY_CM;
  return ly < 1e7 ? `${sig3(ly)} ly` : `${sci(ly)} ly`;
}

export function formatVolume(mL: number): string {
  if (mL < 1000) return `${sig3(mL)} mL`;
  if (mL < 1e6) return `${sig3(mL / 1000)} L`;
  if (mL < 1e15) return `${sig3(mL / 1e6)} m³`;
  const km3 = mL / 1e15;
  return km3 < 1e6 ? `${sig3(km3)} km³` : `${sci(km3)} km³`;
}

/** 1 cm³ の立方体が何個か。27ⁿ × c を桁落ちなしで。 */
export function unitCount(level: number, cubes: number): bigint {
  return 27n ** BigInt(level) * BigInt(cubes);
}

export function groupDigits(n: bigint): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 段 n（一辺 3ⁿ cm）の立方体を何かと並べる。無い段は比べずに数字だけ出す。
 * 値は丸めた概数で、比べる側の数字も本文に書いてある。
 */
const COMPARISONS: Record<number, string> = {
  0: '小さじ 1/5。角砂糖より少し小さい。',
  1: 'おちょこ一杯。',
  2: 'ワインボトル 1 本（750 mL）に一口足りない。',
  3: '灯油のポリタンク（18 L）より少し多い。',
  4: '家の湯船（約 200 L）で 2 杯半。',
  5: '一辺が部屋の天井（2.4 m）に届く。',
  6: '学校の 25 m プールがほぼ 1 杯。',
  7: '一辺が 7 階建てのビルの高さ。',
  8: '東京ドーム（124 万 m³）の 4 分の 1 弱。',
  9: '東京ドーム 6 杯ぶん。',
  10: '一辺がスカイツリー（634 m）に迫る。東京ドーム 166 杯。',
  11: '琵琶湖（27.5 km³）の 5 分の 1。',
  12: '琵琶湖が 5 杯。一辺はエベレストの 6 割。',
  13: '一辺が旅客機の巡航高度（約 11 km）を越える。',
  14: '一辺が成層圏の上端（約 50 km）に届く。',
  15: '一辺がカーマン・ライン（高度 100 km）を越える。ここから宇宙。',
  16: '一辺が国際宇宙ステーションの高度（約 400 km）を越える。',
  17: '一辺が本州の長さ（約 1,300 km）。',
  18: '月（直径 3,474 km）がすっぽり入る。',
  19: '一辺が地球の直径（12,742 km）に迫る。',
  20: '地球がすっぽり入る。一辺は静止軌道の高度に届きかける。',
  22: '一辺が月までの距離（38 万 km）の 8 割。',
  23: '月の公転軌道がまるごと入る。',
  24: '太陽（直径 139 万 km）がすっぽり入る。',
  28: '一辺が地球の公転軌道の半径（1 au）を越える。',
  29: '地球の公転軌道がまるごと入る。',
  30: '木星の公転軌道がまるごと入る。',
  32: '海王星の公転軌道（直径 60 au）がまるごと入る。',
  33: 'ボイジャー 1 号（約 170 au）を追い越した。',
  39: '一辺がいちばん近い恒星、プロキシマ・ケンタウリ（4.24 光年）に届く。',
  48: '一辺が天の川銀河の直径（約 10 万光年）に迫る。',
  49: '天の川銀河がすっぽり入る。',
  51: '一辺がアンドロメダ銀河まで（250 万光年）に迫る。',
  52: 'アンドロメダ銀河に届く。',
  54: '一辺がおとめ座銀河団まで（5,400 万光年）届く。',
  60: '一辺が観測可能な宇宙の半径（465 億光年）に迫る。',
  61: '観測可能な宇宙（直径 930 億光年）がすっぽり入る。',
};

export function comparison(level: number): string | undefined {
  if (level > 61) return 'ここから先は比べるものがない。体積だけが増えていく。';
  return COMPARISONS[level];
}

export function lengthOfLevel(level: number): number {
  return 3 ** level;
}

export function volumeOfLevel(level: number): number {
  return 27 ** level;
}
