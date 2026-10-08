import type { RoomView } from './types';

/** 深い青（いま効いているもの：守り・落ち着き・信頼の糸・見せ場）。必ずまばらに置く。 */
export const BLUE = 4;

/** 縦の画素数は固定。横は、置かれた枠の縦横比に合わせて伸び縮みする（枠いっぱいに描く）。 */
export const H = 240;

/**
 * 床の形と投影。u は左右（ほとんど水平に、少しだけ右下がり）、v は奥行き
 * （手前が左下）。床は横に広く、奥行きは浅い板で、上下のフロアが重ならない
 * 間隔に積む。遠いフロアは細部を省いて、底の闇に溶ける。
 */
export const GEO = {
  /** 床板の半幅と半奥行き。 */
  U: 3,
  V: 0.85,
  /** u・v の 1 単位が画面で何画素動くか。 */
  ux: 30,
  uy: 3,
  vx: -18,
  vy: 10,
  /** フロアの間隔（どの深さでも同じ）。 */
  gap: 42,
} as const;

/**
 * 寄り。ふだんは近景（あなたと、次に行ける部屋が収まるところまで寄る）。
 * 見渡すときだけ引く。遭遇ではさらに寄る。
 */
export const NEAR_ZOOM = 1.9;
export const FAR_ZOOM = 1;
export const ENC_ZOOM = 2.4;

/**
 * 人の大きさ（あなたを 1 として）。相手は、気づかれないぎりぎりだけ大きい
 * （一割ほど。見比べなければ同じに見えるが、向き合うと少し圧がある）。
 * 歯が立たない相手は、もう少しだけ。最後の相手でも 1.2 まで。
 */
export const PEER = 1.1;
export const PEER_OVER = 1.15;
export const PEER_BOSS = 1.2;

/** 部屋ごとに決まった、奥行きの揺らぎ（-1〜1）。並びが一直線にならないように。 */
export const jitter = (id: number) => ((((id + 1) * 2654435761) >>> 0) % 1000) / 500 - 1;

/**
 * 隣の塔の中心。画面の上で真横になる向き（u を動かした分だけ v を戻して、
 * 高さが変わらない向き）へ、床一枚と少し離す。
 */
export function wing(side: number): { u: number; v: number } {
  const u = side * (GEO.U * 2 + 1.2);
  return { u, v: (-u * GEO.uy) / GEO.vy };
}

/** 部屋の床の上の位置（u は左右、v は奥行き）。 */
export function spot(r: RoomView): { u: number; v: number } {
  if (r.tower) {
    // 隣の床の、こちら寄りの側。
    const c = wing(r.tower);
    return { u: c.u - r.tower * (GEO.U - 0.9), v: c.v + jitter(r.id) * 0.35 };
  }
  if (r.kind === 'boss') return { u: 0, v: 0 };
  const reach = GEO.U - 0.7;
  const u = r.cols <= 1 ? 0 : -reach + (r.col * 2 * reach) / (r.cols - 1);
  return { u, v: jitter(r.id) * (GEO.V - 0.45) };
}
