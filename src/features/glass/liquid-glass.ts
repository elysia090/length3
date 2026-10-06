import { lightAt, type Viewport } from './lights';

/**
 * ガラスのタイルを照らす。
 *
 * タイルごとに、絵の中の光源（lights.ts）とポインタから受ける光を計算し、
 * CSS 変数に書く。描くのは CSS で、ここは数字を渡すだけ。
 *
 *   --wx --wy --wi   暖色の光の来る向きと強さ（電気スタンド、街灯）
 *   --cx --cy --ci   寒色の光（月）
 *   --px --py --pi   ポインタ。手に持った灯りとして近くのタイルの縁を照らす
 *   --sx --sy --si   影の落ちる向き（光の合計の反対）と濃さ
 *   --wa --ca --pa   上の三つを CSS の角度（度）にしたもの
 *   --mx --my        ポインタの位置（タイルの中、%）。鏡面の照り
 *   --tx --ty        ポインタに向かう傾き（度）
 *
 * 動くのは、スクロール・リサイズ・ポインタが動いたときだけ。そのたびに
 * requestAnimationFrame で 1 回だけ計算する。待機中は何もしない。
 */

const SELECTOR = '[data-glass], .site-header .header-inner';
const POINTER_REACH = 520;
const MAX_TILT = 3.2;

const cssAngle = (x: number, y: number) => (Math.atan2(x, -y) * 180) / Math.PI;
const round = (v: number, k = 1000) => Math.round(v * k) / k;

export function mountLiquidGlass(doc: Document): void {
  const tiles = [...doc.querySelectorAll<HTMLElement>(SELECTOR)];
  if (tiles.length === 0) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let pointer: { x: number; y: number } | null = null;
  let frame = 0;

  function update() {
    frame = 0;
    const vp: Viewport = { width: window.innerWidth, height: window.innerHeight };
    for (const el of tiles) {
      const r = el.getBoundingClientRect();
      if (r.bottom < -200 || r.top > vp.height + 200 || el.hidden) continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const { warm, cool } = lightAt(cx, cy, vp);
      let px = 0;
      let py = 0;
      let pi = 0;
      let hover = 0;
      let mx = 50;
      let my = 50;
      let tx = 0;
      let ty = 0;
      if (pointer) {
        // 縁までの距離で落とす。タイルの上にいれば最大。
        const ex = Math.max(r.left - pointer.x, 0, pointer.x - r.right);
        const ey = Math.max(r.top - pointer.y, 0, pointer.y - r.bottom);
        const edge = Math.hypot(ex, ey);
        const dx = pointer.x - cx;
        const dy = pointer.y - cy;
        const d = Math.hypot(dx, dy) || 1;
        px = dx / d;
        py = dy / d;
        pi = Math.max(0, 1 - edge / POINTER_REACH) ** 2;
        if (edge === 0) {
          hover = 1;
          mx = ((pointer.x - r.left) / r.width) * 100;
          my = ((pointer.y - r.top) / r.height) * 100;
          if (!reduced.matches) {
            tx = ((mx - 50) / 50) * MAX_TILT;
            ty = -((my - 50) / 50) * MAX_TILT;
          }
        }
      }
      // 影は光の合計の反対側へ。ポインタの灯りも少しだけ影を動かす。
      const sx = -(warm[0] * warm[2] + cool[0] * cool[2] * 0.6 + px * pi * 0.5);
      const sy = -(warm[1] * warm[2] + cool[1] * cool[2] * 0.6 + py * pi * 0.5);
      const sl = Math.hypot(sx, sy) || 1;
      const s = el.style;
      s.setProperty('--wx', String(round(warm[0])));
      s.setProperty('--wy', String(round(warm[1])));
      s.setProperty('--wi', String(round(warm[2])));
      s.setProperty('--wa', String(round(cssAngle(warm[0], warm[1]), 10)));
      s.setProperty('--cx', String(round(cool[0])));
      s.setProperty('--cy', String(round(cool[1])));
      s.setProperty('--ci', String(round(cool[2])));
      s.setProperty('--ca', String(round(cssAngle(cool[0], cool[1]), 10)));
      s.setProperty('--px', String(round(px)));
      s.setProperty('--py', String(round(py)));
      s.setProperty('--pi', String(round(pi)));
      s.setProperty('--pa', String(round(cssAngle(px, py), 10)));
      s.setProperty('--sx', String(round(sx / sl)));
      s.setProperty('--sy', String(round(sy / sl)));
      s.setProperty('--si', String(round(Math.min(1, sl))));
      s.setProperty('--hover', String(hover));
      s.setProperty('--mx', `${round(mx, 10)}%`);
      s.setProperty('--my', `${round(my, 10)}%`);
      s.setProperty('--tx', String(round(tx, 100)));
      s.setProperty('--ty', String(round(ty, 100)));
    }
  }

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  doc.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'touch') return;
      pointer = { x: e.clientX, y: e.clientY };
      schedule();
    },
    { passive: true },
  );
  doc.documentElement.addEventListener('pointerleave', () => {
    pointer = null;
    schedule();
  });
  // 「続きを開く」で増えたタイルや、寸法が変わったタイルにも追従する。
  new ResizeObserver(schedule).observe(doc.body);
  new MutationObserver(schedule).observe(doc.body, {
    attributes: true,
    subtree: true,
    attributeFilter: ['hidden'],
  });

  update();
}
