import { drawText, textWidth } from '../../../../shared/pixel/font';
import { clamp } from '../../../../shared/pixel/math';
import { AMBER, INK, PAPER, type Raster, threshold } from '../../../../shared/pixel/raster';
import { BLUE, H, PEER, PEER_BOSS } from './geo';
import { bar, dot, K, leader, veil } from './paint';
import type { Scene } from './types';

/** 向き合った場面：灯り・見せ場の光・計器と気配（寄ったときだけ描く）。 */

/** 計器の段の間隔。 */
const ROW = 5;

/**
 * 灯り。あなたの灯りが届く輪の外は、墨の網点で沈む。輪の大きさは心の残り
 * で決まり、揺らぐ。長引くと、外の闇が脈打つ。
 */
export function lamp(
  r: Raster,
  W: number,
  zoom: number,
  cx: number,
  cy: number,
  s: Scene,
  t: number,
  presence: number,
): void {
  const zm = zoom;
  const mind = s.you.maxMind ? s.you.mind / s.you.maxMind : 1;
  const flicker = 1 + 0.025 * Math.sin(t * 11) + 0.015 * Math.sin(t * 23.7 + 1.3);
  const R = (30 + 26 * mind) * zm * flicker;
  const pulse = s.stall ? 0.12 * (0.5 + 0.5 * Math.sin(t * 4)) : 0;
  const ly = cy - 6 * zm;
  const x0 = Math.max(0, Math.floor(cx - R * 2.4));
  const x1 = Math.min(W, Math.ceil(cx + R * 2.4));
  for (let y = 0; y < H; y++) {
    const dy = (y - ly) * 1.45;
    for (let x = 0; x < W; x++) {
      const dx = x - cx;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < R) continue;
      // 見せ場の光の筋の中は、闇が落ちない。
      if (s.stage && y < cy && Math.abs(dx) < beamHalf(zoom, y, cy)) continue;
      const far = x < x0 || x >= x1 ? 1 : clamp((d - R) / (R * 1.1));
      const tone = (0.32 * far + pulse) * presence;
      if (threshold(x, y) < tone) r.set(x, y, INK);
    }
  }
}

/** 見せ場の光の筋の、その高さでの半幅。 */
export function beamHalf(zoom: number, y: number, cy: number): number {
  const half = 24 * zoom;
  return 4 + (half - 4) * clamp(y / Math.max(1, cy));
}

/** 見せ場。上から細い光が降りる（筋の縁と、光の中を降る埃）。 */
export function spotlight(
  r: Raster,
  zoom: number,
  cx: number,
  cy: number,
  t: number,
  presence: number,
): void {
  for (let y = 0; y < cy; y++) {
    const w = beamHalf(zoom, y, cy);
    for (const x of [Math.round(cx - w), Math.round(cx + w)])
      if (threshold(x, y) < 0.5 * presence) r.set(x, y, INK);
  }
  if (presence < 0.5) return;
  for (let n = 0; n < 14; n++) {
    const u = ((n * 0.618 + t * 0.05 * (1 + (n % 3))) % 1) * cy;
    const sx = cx + Math.sin(n * 12.9 + t * 0.7) * beamHalf(zoom, u, cy) * 0.8;
    r.set(Math.round(sx), Math.round(u), INK);
  }
}

/** 計器と気配（二人の頭の上、信頼の糸、守り、予告、跳ねる数）。 */
export function hud(
  r: Raster,
  zoom: number,
  cx: number,
  cy: number,
  boss: boolean,
  s: Scene,
  t: number,
): void {
  const zm = zoom;
  const youX = cx - 7 * zm;
  const foeX = cx + 7 * zm;
  const fk = (boss ? PEER_BOSS : PEER) * zm;
  const youTop = cy - 7 * zm - 4 * zm - 2;
  const foeTop = cy - 7 * fk - 4 * fk - 2;
  const blink = Math.floor(t * 2.2) % 2 === 0;
  // 守り（体の前に、相手へ向けた半円）と落ち着き（頭のまわり）。あなたの側は
  // 琥珀、相手の側は青で、どちらもまばらに。
  if (s.you.guard > 0)
    veil(
      r,
      youX,
      cy - 4 * zm,
      10 * zm,
      2.5,
      0.1 + Math.min(0.3, s.you.guard / 30),
      AMBER,
      Math.PI * 1.5,
      Math.PI * 0.5,
    );
  if (s.you.calm > 0)
    veil(r, youX, cy - 9.5 * zm, 3.6 * zm, 1.6, 0.14 + Math.min(0.3, s.you.calm / 25), AMBER);
  if (s.foe.guard > 0)
    veil(
      r,
      foeX,
      cy - 4 * fk,
      9 * fk,
      2.5,
      0.1 + Math.min(0.3, s.foe.guard / 30),
      BLUE,
      Math.PI * 0.5,
      Math.PI * 1.5,
    );
  // 信頼の糸（頭から頭へ、相手の色で）。届きそうになるほど、点が詰まる。
  if (s.foe.need < 50 && s.foe.trust > 0) {
    const k = clamp(s.foe.trust / Math.max(1, s.foe.need));
    const gap = Math.max(1, Math.round(6 - 5 * k));
    const ax = youX + 2;
    const ay = cy - 10 * zm;
    const bx = foeX - 2;
    const by = cy - 10 * fk;
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay));
    for (let i = 0; i <= steps; i += gap) {
      const u = i / steps;
      const sag = Math.sin(u * Math.PI) * (4 - 3 * k);
      r.set(Math.round(ax + (bx - ax) * u), Math.round(ay + (by - ay) * u + sag), BLUE);
    }
  }
  // 計器。あなたは左へ（体＝琥珀のべた、心＝琥珀のまばら）、相手は右へ
  // （体＝青のべた、意志＝青のまばら）。二人の間は空けておく。
  const bw = 18;
  // 計器は体から少し離して置き、細い点線で頭とつなぐ（体に貼りつけない）。
  const off = 12 * zm;
  const yx = Math.round(youX - off - bw * K);
  const yy = Math.round(youTop - 14);
  leader(r, youX - 2, youTop + 2, yx + bw * K, yy + 3);
  const lossHp = Math.max(0, s.loss.hp - s.you.guard);
  const lossMind = Math.max(0, s.loss.mind - s.you.calm);
  bar(r, yx, yy, bw, s.you.hp / Math.max(1, s.you.maxHp), AMBER, 1, {
    shield: (s.you.guard / Math.max(1, s.you.maxHp)) * bw,
    loss: (lossHp / Math.max(1, s.you.maxHp)) * bw,
    blink,
  });
  bar(r, yx, yy + ROW, bw, s.you.mind / Math.max(1, s.you.maxMind), AMBER, 2, {
    shield: (s.you.calm / Math.max(1, s.you.maxMind)) * bw,
    loss: (lossMind / Math.max(1, s.you.maxMind)) * bw,
    blink,
  });
  const fx = Math.round(foeX + off);
  const fy = Math.round(foeTop - 14);
  leader(r, foeX + 2, foeTop + 2, fx - 2, fy + 3);
  bar(r, fx, fy, bw, s.foe.hp / Math.max(1, s.foe.maxHp), BLUE, 1, {
    shield: (s.foe.guard / Math.max(1, s.foe.maxHp)) * bw,
  });
  bar(r, fx, fy + ROW, bw, s.foe.will / Math.max(1, s.foe.maxWill), BLUE, 2);
  // 手がかりは小さな菱形（見つけたものは琥珀で塗る）。
  for (let i = 0; i < s.foe.clues; i++) {
    const bx = fx + i * 4 * K;
    const by = fy + 11;
    const got = i < s.foe.shown;
    const c = got ? AMBER : INK;
    dot(r, bx + K, by - K, c);
    dot(r, bx, by, c);
    dot(r, bx + 2 * K, by, c);
    dot(r, bx + K, by + K, c);
    if (got) dot(r, bx + K, by, c);
  }
  // 敵意が高いと、頭のまわりに棘が立つ。
  if (s.foe.hostility >= 7) {
    const n = s.foe.hostility >= 9 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.7 + Math.sin(t * 9 + i) * 0.05;
      const hx = foeX + Math.cos(a) * 5 * fk;
      const hy = cy - 10 * fk + Math.sin(a) * 5 * fk;
      r.line(hx, hy, 99, hx + Math.cos(a) * 3, hy + Math.sin(a) * 3, 99, INK, false);
    }
  }
  // 跳ねる数。
  for (const p of s.pops) {
    const age = t - p.at;
    if (age < 0 || age > 1.4) continue;
    const px = Math.round(
      (p.who === 'you' ? youX - 12 : foeX + 6) + age * (p.who === 'you' ? -4 : 4),
    );
    const py = Math.round((p.who === 'you' ? youTop : foeTop) - 2 - age * 16);
    const c = p.tone === 'amber' ? AMBER : p.tone === 'blue' ? BLUE : INK;
    if (age > 1 && Math.floor(t * 20) % 2) continue;
    const w = textWidth(p.text, K);
    r.rect(px - 1 - (p.who === 'you' ? w : 0), py - 1, w + 2, 7 * K + 2, PAPER);
    drawText(r, p.text, px - (p.who === 'you' ? w : 0), py, c, K);
  }
}
