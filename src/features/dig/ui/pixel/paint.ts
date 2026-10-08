import { clamp } from '../../../../shared/pixel/math';
import { AMBER, INK, PAPER, type Raster, threshold } from '../../../../shared/pixel/raster';
import type { RoomKind } from './types';

/** 人の記号・部屋の印・計器など、小さな絵の部品（塔の上の位置は呼ぶ側が決める）。 */

/** 計器の点の大きさ（拡大して見られるので、二倍の点で描く）。 */
export const K = 2;

export function ring(r: Raster, cx: number, cy: number, rad: number, c: number): void {
  const n = Math.max(12, Math.round(rad * 5));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    r.set(Math.round(cx + Math.cos(a) * rad), Math.round(cy + Math.sin(a) * rad * 0.5), c);
  }
}

/**
 * style: solid はべた塗り（あなた）、outline は輪郭だけ（もう一人・会い終えた人）、
 * sparse は輪郭と、まばらな網点の中身（いま向き合える相手。深い青で）。
 */
export function figure(
  r: Raster,
  x: number,
  y: number,
  k: number,
  fill: number,
  style: 'solid' | 'outline' | 'sparse' | boolean = 'solid',
  lean = 0,
): void {
  const mode = style === true ? 'outline' : style === false ? 'solid' : style;
  const outline = mode !== 'solid';
  const hr = 2 * k;
  const bw = 3.2 * k;
  const bh = 7 * k;
  const top = y - bh;
  const hx = x + lean * k;
  const hy = top - hr - 1;
  if (mode !== 'outline') {
    // 足もとの影（点の短い線）。床に立っているように見せる。
    for (let i = -Math.round(bw * 0.8); i <= Math.round(bw * 0.8); i += 2)
      r.set(Math.round(x + i), Math.round(y + 1), INK);
    // 紙の縁取り（一画素）。網点の床の上でも、人の形がはっきり抜ける。
    r.tri(x - bw - 1.3, top - 1, 97, x + bw + 1.3, top - 1, 97, x, y + 1.6, 97, 1, PAPER, PAPER);
    const hh = hr + 1.3;
    for (let j = -Math.ceil(hh); j <= Math.ceil(hh); j++)
      for (let i = -Math.ceil(hh); i <= Math.ceil(hh); i++)
        if (Math.hypot(i, j) <= hh) r.set(Math.round(hx + i), Math.round(hy + j), PAPER);
  }
  // 体（逆三角形）。
  if (outline) {
    r.line(x - bw, top, 99, x + bw, top, 99, fill, false);
    r.line(x - bw, top, 99, x, y, 99, fill, false);
    r.line(x + bw, top, 99, x, y, 99, fill, false);
    if (mode === 'sparse')
      r.tri(x - bw + 1, top + 1, 98, x + bw - 1, top + 1, 98, x, y - 1, 98, 0.62, fill, PAPER);
  } else r.tri(x - bw, top, 99, x + bw, top, 99, x, y, 99, 0, fill, fill);
  // 頭（丸）。
  for (let j = -Math.ceil(hr); j <= Math.ceil(hr); j++)
    for (let i = -Math.ceil(hr); i <= Math.ceil(hr); i++) {
      const d = Math.hypot(i, j);
      const px = Math.round(hx + i);
      const py = Math.round(hy + j);
      if (outline ? Math.abs(d - hr) < 0.6 : d <= hr + 0.2) r.set(px, py, fill);
      else if (mode === 'sparse' && d < hr - 0.6)
        r.set(px, py, threshold(px, py) < 0.38 ? fill : PAPER);
    }
}

/** 人のいない部屋の印。 */
export function mark(r: Raster, kind: RoomKind, x: number, y: number, dim: boolean): void {
  const c = dim ? PAPER : INK;
  const ICON: Record<string, readonly string[]> = {
    event: ['0110', '1001', '0010', '0100', '0000', '0100'],
    rest: ['00100', '01110', '11111', '01110', '00100'],
    shop: ['01110', '10101', '11111', '10101', '01110'],
  };
  const rows = ICON[kind];
  if (!rows) return;
  const ox = Math.round(x - (rows[0]?.length ?? 0) / 2);
  const oy = Math.round(y - rows.length + 1);
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++)
      if (row[i] === '1') r.set(ox + i, oy + j, kind === 'rest' ? AMBER : c);
  });
}

export function dot(r: Raster, x: number, y: number, c: number): void {
  const k = K;
  r.rect(x, y, k, k, c);
}

/**
 * 横棒の計器（点で描く）。w は点の数、step は点の間（1 = べた、2 = まばら）。
 * 守りは棒の先に点線で伸び、次の手で失う分は点滅する。
 */
export function bar(
  r: Raster,
  x: number,
  y: number,
  w: number,
  ratio: number,
  fill: number,
  step: number,
  extra: { shield?: number; loss?: number; blink?: boolean } = {},
): void {
  const k = K;
  const n = Math.round(w * clamp(ratio));
  const loss = Math.min(n, Math.max(0, Math.round(extra.loss ?? 0)));
  r.rect(x - 1, y - 1, w * k + 2, k + 2, PAPER);
  for (let i = 0; i < w; i++) {
    const px = x + i * k;
    if (i < n - loss) {
      if (i % step === 0) dot(r, px, y, fill);
    } else if (i < n) {
      if (!extra.blink) dot(r, px, y, fill);
    } else if (i % 2 === 0) r.set(px, y + k - 1, INK);
  }
  const sh = Math.min(w, Math.round(extra.shield ?? 0));
  for (let i = 0; i < sh; i++) if (i % 2 === 0) r.set(x + (n + i) * k, y, fill);
}

/** 予告の印（7×7）。 */
export function glyph(r: Raster, kind: string, x: number, y: number, c: number): void {
  const ICONS: Record<string, readonly string[]> = {
    strike: ['0000011', '0000111', '0001110', '1011100', '0111000', '0110000', '1001000'],
    threat: ['0000000', '1000001', '1100011', '0110110', '0011100', '0001000', '0000000'],
    guard: ['1111111', '1000001', '1000001', '1000001', '0100010', '0010100', '0001000'],
    call: ['0111110', '1000001', '1010101', '1000001', '0111110', '0010000', '0100000'],
    bargain: ['0011100', '0100010', '0010000', '0001000', '0000100', '0100010', '0011100'],
    confide: ['0111110', '1000001', '1000001', '1000001', '0111110', '0000100', '0000010'],
    flee: ['0001000', '0000100', '1111110', '0000100', '0001000', '0000000', '0000000'],
    wait: ['1111111', '0100010', '0010100', '0001000', '0010100', '0100010', '1111111'],
    mend: ['0001000', '0001000', '0111110', '0001000', '0001000', '0000000', '0000000'],
    probe: ['0000000', '0011100', '0100010', '1001001', '0100010', '0011100', '0000000'],
  };
  const rows = ICONS[kind] ?? ICONS.wait ?? [];
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) if (row[i] === '1') dot(r, x + i * K, y + j * K, c);
  });
}

/** 頭から計器への細い点線。 */
export function leader(r: Raster, x0: number, y0: number, x1: number, y1: number): void {
  r.line(x0, y0, 99, x1, y1, 99, INK, false, 0, [1, 2]);
}

/** 円環にまばらな点（守り・落ち着き）。from〜to は角度（ラジアン）。 */
export function veil(
  r: Raster,
  cx: number,
  cy: number,
  rad: number,
  thick: number,
  density: number,
  c: number,
  from = 0,
  to = Math.PI * 2,
): void {
  for (let y = Math.floor(cy - rad - 1); y <= cy + rad + 1; y++)
    for (let x = Math.floor(cx - rad - 1); x <= cx + rad + 1; x++) {
      const dx = x - cx;
      const dy = (y - cy) * 1.3;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > rad || d < rad - thick) continue;
      let a = Math.atan2(dy, dx);
      if (a < 0) a += Math.PI * 2;
      const inArc = from <= to ? a >= from && a <= to : a >= from || a <= to;
      if (!inArc) continue;
      // 縁は濃く、内側ほど薄く。
      const edge = d > rad - 1.2 ? 2.2 : 1;
      if (threshold(x, y) < density * edge) r.set(x, y, c);
    }
}
