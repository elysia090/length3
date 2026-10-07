/**
 * 種から決まる乱数。状態は数 1 つで、そのまま保存できる（途中から再開しても、
 * 敵の読み筋の試行でも、同じ種なら同じ結果になる）。mulberry32。
 */
export interface Rng {
  s: number;
}

export function rng(seed: number): Rng {
  return { s: seed >>> 0 || 0x9e3779b9 };
}

/** 0 以上 1 未満。 */
export function next(r: Rng): number {
  r.s = (r.s + 0x6d2b79f5) >>> 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** lo 以上 hi 以下の整数。 */
export function int(r: Rng, lo: number, hi: number): number {
  return lo + Math.floor(next(r) * (hi - lo + 1));
}

export function pick<T>(r: Rng, list: readonly T[]): T | undefined {
  return list.length ? list[Math.floor(next(r) * list.length)] : undefined;
}

/** 重みつきで 1 つ選ぶ。 */
export function weighted<T>(r: Rng, list: readonly (readonly [T, number])[]): T | undefined {
  const total = list.reduce((a, [, w]) => a + Math.max(0, w), 0);
  if (total <= 0) return list[0]?.[0];
  let x = next(r) * total;
  for (const [v, w] of list) {
    x -= Math.max(0, w);
    if (x < 0) return v;
  }
  return list[list.length - 1]?.[0];
}

export function shuffle<T>(r: Rng, list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(next(r) * (i + 1));
    const a = list[i] as T;
    list[i] = list[j] as T;
    list[j] = a;
  }
  return list;
}

/** 文字列から種を作る（日替わりの種など）。 */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
