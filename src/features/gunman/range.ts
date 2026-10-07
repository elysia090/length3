import { drawText, textWidth } from '../../shared/pixel/font';
import { add, clamp, easeOutBack, hash, rotX, scale, type Vec3 } from '../../shared/pixel/math';
import { PerspView } from '../../shared/pixel/persp';
import { AMBER, INK, PAPER, Raster, threshold } from '../../shared/pixel/raster';
import { drawEdges, drawFaces, type Solid } from '../../shared/pixel/solids';
import {
  about,
  box,
  CHAMBER_RADIUS,
  type Chamber,
  CYLINDER_REAR,
  chamberAngle,
  chamberMouth,
  compose,
  cylinderXf,
  heldPose,
  muzzle,
  prism,
  type RevolverPose,
  revolverSolids,
  xf,
  xp,
} from './revolver';
import { RangeSound } from './sound';

/**
 * GUNMAN。検索欄に 'gunman' と打つと開く射撃場。
 *
 * 一人称のリボルバー 1 丁だけ。Robot Tune と一覧の舞台と同じ 1 ビットの
 * 網点（紙・墨・琥珀）で描く。撃つ: 引き金で撃鉄が起き、シリンダーが
 * 1 室送られ、70 ms 後に撃鉄が落ちる（ダブルアクション）。装填済みなら
 * 発砲、空なら乾いた音。込め替え: シリンダーを振り出し、エジェクターで
 * 6 発の薬莢を落とし、1 発ずつ込め、弾いて閉じる。閉じるときは惰性で
 * 回り、室を過ぎるたびに鳴って、ぱちんと止まる。
 *
 * 操作: ポインタで狙い、押して撃つ。R 込め替え（押し続けると 1 発ずつ
 * 拍を刻んで込める）、S 振り出したシリンダーを回す、M 音、矢印で照準、
 * Space で撃つ、Esc で検索へ戻る。
 */

const TARGET_COLUMNS = 360;
const EYE: Vec3 = [0, 1.6, 0];
const STEP = Math.PI / 3;

type Phase = 'ready' | 'opening' | 'open' | 'closing';

interface Particle {
  p: Vec3;
  v: Vec3;
  spin: number;
  born: number;
  /** 'case' は銃の座標（カメラ座標）、ほかは世界座標。 */
  kind: 'case' | 'round' | 'shard' | 'dust';
  bounced: boolean;
}

interface Popup {
  p: Vec3;
  text: string;
  born: number;
}

interface Plate {
  x: number;
  hitAt: number;
}

interface Bottle {
  x: number;
  hitAt: number;
}

const PAPER_C: Vec3 = [-2.3, 1.45, -7];
const BOTTLE_Z = -6;
const BOTTLE_Y = 0.85;
const PLATE_Z = -13;
const PLATE_Y = 1.05;
const PLATE_R = 0.3;
const PEND_HINGE: Vec3 = [0.2, 3.3, -19];
const PEND_ARM = 1.9;
const PEND_R = 0.36;

export function openRange(doc: Document, onClose: () => void): void {
  const dialog = doc.createElement('dialog');
  dialog.className = 'gunman';
  dialog.setAttribute('aria-label', 'GUNMAN — revolver range');
  dialog.innerHTML = `
    <canvas class="gunman-canvas" aria-hidden="true"></canvas>
    <p class="gunman-help">Point to aim, press to fire. R reloads one round at a time (hold to keep loading), S spins the open cylinder, M mutes, arrow keys aim, Space fires, Esc returns to search.</p>
    <p class="gunman-live" aria-live="polite"></p>
    <button type="button" class="gunman-btn gunman-exit">EXIT</button>
    <button type="button" class="gunman-btn gunman-reload">RELOAD</button>
  `;
  doc.body.append(dialog);
  const canvas = dialog.querySelector<HTMLCanvasElement>('canvas');
  const live = dialog.querySelector<HTMLElement>('.gunman-live');
  const exitBtn = dialog.querySelector<HTMLButtonElement>('.gunman-exit');
  const reloadBtn = dialog.querySelector<HTMLButtonElement>('.gunman-reload');
  const context = canvas?.getContext('2d');
  if (!canvas || !context || !live || !exitBtn || !reloadBtn) {
    dialog.remove();
    onClose();
    return;
  }
  const cv: HTMLCanvasElement = canvas;
  const ctx2d: CanvasRenderingContext2D = context;
  const announce: HTMLElement = live;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sound = new RangeSound();
  const raster = new Raster();
  const style = getComputedStyle(doc.documentElement);
  const color = (name: string, fallback: number) => {
    const m = /^#([0-9a-f]{6})$/i.exec(style.getPropertyValue(name).trim());
    if (!m) return fallback;
    const v = Number.parseInt(m[1] ?? '0', 16);
    return (0xff << 24) | ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff);
  };
  const palette = new Uint32Array([
    color('--bg', 0xfffaf9f9),
    color('--bg', 0xfffaf9f9),
    color('--ink', 0xff1e1915),
    color('--amber', 0xff0c58ea),
  ]);
  let image: ImageData | null = null;
  let out: Uint32Array | null = null;

  // ─── 状態 ────────────────────────────────────────────────────
  const t0 = performance.now();
  let last = t0;
  const now = () => (performance.now() - t0) / 1000;
  const aim = { x: 0, y: 0, keyX: 0, keyY: 0 };
  const chambers: Chamber[] = ['live', 'live', 'live', 'live', 'live', 'live'];
  let index = 0;
  let cyl = 0;
  let cylVel = 0;
  let cylTarget = 0;
  let lastTick = 0;
  let phase: Phase = 'ready';
  let phaseAt = 0;
  let swing = 0;
  let reload = 0;
  let pullAt = -10;
  let firedAt = -10;
  let insert: { chamber: number; at: number } | null = null;
  let spinning = false;
  const particles: Particle[] = [];
  const popups: Popup[] = [];
  const holes: [number, number][] = [];
  const plates: Plate[] = [-2, -1, 0, 1, 2].map((x) => ({ x, hitAt: -1 }));
  const bottles: Bottle[] = [1.55, 2.0, 2.45, 2.9].map((x) => ({ x, hitAt: -1 }));
  let pendHitAt = -10;
  let pendKick = 0;
  let resetAt = -1;
  let score = 0;
  let shownScore = 0;
  let shots = 0;
  let hits = 0;
  let combo = 1;
  let shake = 0;
  let raf = 0;
  let loadHeld = false;
  let loadTimer = 0;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w0 = cv.clientWidth * dpr;
    const h0 = cv.clientHeight * dpr;
    if (w0 <= 0 || h0 <= 0) return;
    const px = Math.max(1, Math.round(w0 / TARGET_COLUMNS));
    const w = Math.floor(w0 / px);
    const h = Math.floor(h0 / px);
    if (w !== raster.w || h !== raster.h) {
      raster.resize(w, h);
      cv.width = w;
      cv.height = h;
      image = ctx2d.createImageData(w, h);
      out = new Uint32Array(image.data.buffer);
      aim.x = w / 2;
      aim.y = h * 0.45;
    }
  }

  // ─── 撃つ ────────────────────────────────────────────────────
  function camera(t: number): PerspView {
    const ax = (aim.x / raster.w - 0.5) * 2;
    const ay = (aim.y / raster.h - 0.5) * 2;
    const kick = recoil(t) * 0.035;
    return new PerspView(
      EYE,
      ax * 0.1,
      -ay * 0.07 + kick,
      raster.h * 1.15,
      raster.w / 2,
      raster.h / 2,
    );
  }

  function recoil(t: number): number {
    const a = t - firedAt;
    if (a < 0 || a > 1.2) return 0;
    if (a < 0.035) return a / 0.035;
    return Math.max(-0.15, Math.exp(-(a - 0.035) * 9) * Math.cos((a - 0.035) * 13));
  }

  function pendulumPos(t: number): Vec3 {
    const amp = 0.55 + pendKick * Math.exp(-(t - pendHitAt) * 0.6);
    const a = Math.sin(t * 1.35) * amp;
    return [
      PEND_HINGE[0] + Math.sin(a) * PEND_ARM,
      PEND_HINGE[1] - Math.cos(a) * PEND_ARM,
      PEND_HINGE[2],
    ];
  }

  interface Hit {
    t: number;
    kind: 'paper' | 'bottle' | 'plate' | 'pendulum' | 'ground';
    index: number;
    point: Vec3;
  }

  function trace(view: PerspView, sx: number, sy: number, t: number): Hit | null {
    const d = view.ray(sx, sy);
    const o = EYE;
    let best: Hit | null = null;
    const consider = (h: Hit) => {
      if (h.t > 0 && (!best || h.t < best.t)) best = h;
    };
    const atZ = (z: number) => (z - o[2]) / d[2];
    const pointAt = (s: number): Vec3 => add(o, scale(d, s));
    // 紙の的。
    {
      const s = atZ(PAPER_C[2] + 0.01);
      const p = pointAt(s);
      if (
        Math.abs(p[0] - PAPER_C[0]) < 0.45 &&
        p[1] > PAPER_C[1] - 0.7 &&
        p[1] < PAPER_C[1] + 0.5
      ) {
        consider({ t: s, kind: 'paper', index: 0, point: p });
      }
    }
    bottles.forEach((b, i) => {
      if (b.hitAt >= 0) return;
      const c: Vec3 = [b.x, BOTTLE_Y + 0.16, BOTTLE_Z];
      const s = atZ(BOTTLE_Z);
      const p = pointAt(s);
      if (Math.abs(p[0] - c[0]) < 0.075 && Math.abs(p[1] - c[1]) < 0.2) {
        consider({ t: s, kind: 'bottle', index: i, point: p });
      }
    });
    plates.forEach((pl, i) => {
      if (pl.hitAt >= 0) return;
      const s = atZ(PLATE_Z);
      const p = pointAt(s);
      if (Math.hypot(p[0] - pl.x, p[1] - PLATE_Y) < PLATE_R)
        consider({ t: s, kind: 'plate', index: i, point: p });
    });
    {
      const c = pendulumPos(t);
      const s = atZ(c[2]);
      const p = pointAt(s);
      if (Math.hypot(p[0] - c[0], p[1] - c[1]) < PEND_R)
        consider({ t: s, kind: 'pendulum', index: 0, point: p });
    }
    if (!best && d[1] < 0) {
      const s = (0 - o[1]) / d[1];
      consider({ t: s, kind: 'ground', index: 0, point: pointAt(Math.min(s, 60)) });
    }
    return best;
  }

  function burst(p: Vec3, kind: 'shard' | 'dust', n: number, t: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = kind === 'shard' ? 1.5 + Math.random() * 2.5 : 0.4 + Math.random() * 0.8;
      particles.push({
        p,
        v: [
          Math.cos(a) * sp,
          1 + Math.random() * (kind === 'shard' ? 3 : 1.2),
          Math.sin(a) * sp * 0.5 + 0.6,
        ],
        spin: Math.random() * 20,
        born: t,
        kind,
        bounced: false,
      });
    }
  }

  function award(points: number, p: Vec3, t: number, label?: string) {
    hits++;
    const gained = points * combo;
    score += gained;
    popups.push({ p, text: label ?? `+${gained}`, born: t });
    combo = Math.min(combo + 1, 8);
    announce.textContent = `Hit, ${gained} points. Score ${score}.`;
  }

  function fireRound(t: number) {
    const view = camera(t);
    const live = chambers[index] === 'live';
    if (!live) {
      sound.dry();
      return;
    }
    chambers[index] = 'spent';
    firedAt = t;
    shots++;
    shake = reduced ? 0 : 3;
    sound.shot();
    const spread = 0.6;
    const hit = trace(
      view,
      aim.x + (Math.random() - 0.5) * spread,
      aim.y + (Math.random() - 0.5) * spread,
      t,
    );
    if (!hit || hit.kind === 'ground') {
      combo = 1;
      if (hit) burst(hit.point, 'dust', 6, t);
      return;
    }
    if (hit.kind === 'paper') {
      const dx = hit.point[0] - PAPER_C[0];
      const dy = hit.point[1] - PAPER_C[1];
      holes.push([dx, dy]);
      const r = Math.hypot(dx, dy);
      const ring = r < 0.06 ? 10 : r < 0.12 ? 9 : r < 0.18 ? 8 : r < 0.24 ? 7 : r < 0.3 ? 6 : 5;
      award(ring, hit.point, t, ring === 10 ? `X +${10 * combo}` : undefined);
      burst(hit.point, 'dust', 3, t);
    } else if (hit.kind === 'bottle') {
      const b = bottles[hit.index];
      if (b) b.hitAt = t;
      sound.shatter();
      burst(hit.point, 'shard', 18, t);
      award(15, hit.point, t);
    } else if (hit.kind === 'plate') {
      const pl = plates[hit.index];
      if (pl) pl.hitAt = t;
      sound.ding();
      award(5, hit.point, t);
    } else {
      pendHitAt = t;
      pendKick = 0.5;
      sound.ding();
      award(20, hit.point, t);
    }
  }

  function pull() {
    const t = now();
    sound.wake();
    if (phase === 'open') {
      closeCylinder(true);
      return;
    }
    if (phase !== 'ready' || t - pullAt < 0.17) return;
    pullAt = t;
    // ダブルアクション: 引くと室が送られ、撃鉄が起き、落ちる。
    index = (index + 1) % 6;
    cylTarget -= STEP;
    window.setTimeout(() => fireRound(now()), 70);
  }

  // ─── 込め替え ─────────────────────────────────────────────────
  function openCylinder() {
    if (phase !== 'ready') return;
    phase = 'opening';
    phaseAt = now();
    sound.open();
  }

  function eject(t: number) {
    const pose = poseAt(t);
    chambers.forEach((c, k) => {
      if (c === 'empty') return;
      const p = chamberMouth(pose, k);
      particles.push({
        p,
        v: [(Math.random() - 0.5) * 0.6, -0.2 + Math.random() * 0.5, 1.2 + Math.random() * 0.7],
        spin: 8 + Math.random() * 14,
        born: t + k * 0.012,
        kind: c === 'live' ? 'round' : 'case',
        bounced: false,
      });
      chambers[k] = 'empty';
    });
    sound.eject();
  }

  function loadOne() {
    const t = now();
    sound.wake();
    if (phase === 'ready') {
      if (chambers.every((c) => c === 'live')) return;
      openCylinder();
      return;
    }
    if (phase !== 'open' || insert) return;
    if (chambers.every((c) => c === 'live')) {
      closeCylinder(true);
      return;
    }
    // 真上の室が埋まっていれば、空いている室まで送る。
    let k = index;
    for (let i = 0; i < 6 && chambers[k] === 'live'; i++) k = (k + 1) % 6;
    if (k !== index) {
      const steps = (k - index + 6) % 6;
      index = k;
      cylTarget -= steps * STEP;
    }
    insert = { chamber: k, at: t };
  }

  function closeCylinder(flick: boolean) {
    if (phase !== 'open') return;
    phase = 'closing';
    phaseAt = now();
    if (flick && !reduced) {
      spinning = true;
      cylVel = -(16 + Math.random() * 10);
    }
  }

  function spin() {
    if (phase !== 'open' || reduced) return;
    sound.wake();
    spinning = true;
    cylVel = -(18 + Math.random() * 12);
  }

  // ─── 毎コマ ──────────────────────────────────────────────────
  function poseAt(t: number): RevolverPose {
    const ax = (aim.x / raster.w - 0.5) * 2;
    const ay = (aim.y / raster.h - 0.5) * 2;
    const pullA = t - pullAt;
    const hammer = pullA >= 0 && pullA < 0.07 ? pullA / 0.07 : 0;
    const trigger = pullA >= 0 && pullA < 0.14 ? Math.sin((Math.PI * pullA) / 0.14) : 0;
    const ins = insert ? { chamber: insert.chamber, p: clamp((t - insert.at) / 0.13) } : null;
    return {
      body: heldPose(ax, -ay, recoil(t), reload),
      cylinder: cyl,
      swing,
      hammer,
      trigger,
      chambers,
      inserting: ins,
    };
  }

  function step(t: number, dt: number) {
    // シリンダー。開いて回されているときは惰性、ほかはばねで室に合わせる。
    if (spinning) {
      cylVel *= Math.exp(-dt * 1.6);
      cyl += cylVel * dt;
      if (Math.abs(cylVel) < 2.2) {
        spinning = false;
        index = ((Math.round(-cyl / STEP) % 6) + 6) % 6;
        cylTarget = -Math.round(-cyl / STEP) * STEP;
      }
    } else {
      const k = reduced ? 4000 : 900;
      cylVel += (k * (cylTarget - cyl) - 40 * cylVel) * dt;
      cyl += cylVel * dt;
    }
    const tick = Math.floor(-cyl / STEP + 0.5);
    if (tick !== lastTick) {
      lastTick = tick;
      sound.index();
    }

    // 振り出しと構え。
    if (phase === 'opening') {
      swing = easeOutBack(clamp((t - phaseAt) / 0.26), 1.4);
      if (t - phaseAt > 0.3) {
        phase = 'open';
        eject(t);
      }
    } else if (phase === 'closing') {
      const a = clamp((t - phaseAt) / 0.16);
      swing = 1 - a * a;
      if (a >= 1 && !spinning) {
        phase = 'ready';
        swing = 0;
        sound.latch();
      } else if (a >= 1) {
        swing = 0;
      }
    } else if (phase === 'open') {
      swing = 1;
    }
    const want = phase === 'ready' ? 0 : 1;
    reload += (want - reload) * Math.min(1, dt * (reduced ? 40 : 11));

    if (insert && t - insert.at > 0.13) {
      chambers[insert.chamber] = 'live';
      sound.insert();
      insert = null;
      const next = chambers.findIndex((c) => c !== 'live');
      if (next >= 0) {
        const steps = (next - index + 6) % 6;
        index = next;
        cylTarget -= steps * STEP;
      }
    }

    // 粒。薬莢はカメラ座標の床（y = -1.6）で一度跳ねて鳴る。
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      if (!p) continue;
      if (t < p.born) continue;
      const g = p.kind === 'dust' ? 3 : 9.8;
      p.v = [p.v[0], p.v[1] - g * dt, p.v[2]];
      p.p = add(p.p, scale(p.v, dt));
      const floor = p.kind === 'case' || p.kind === 'round' ? -1.6 : 0;
      if (p.p[1] < floor) {
        if (!p.bounced && (p.kind === 'case' || p.kind === 'round')) sound.tinkle();
        if (!p.bounced && p.kind === 'shard') sound.tinkle();
        p.bounced = true;
        p.p = [p.p[0], floor, p.p[2]];
        p.v = [p.v[0] * 0.5, Math.abs(p.v[1]) * 0.32, p.v[2] * 0.5];
      }
      if (t - p.born > (p.kind === 'dust' ? 0.7 : 1.8)) particles.splice(i, 1);
    }
    for (let i = popups.length - 1; i >= 0; i--) {
      const pop = popups[i];
      if (pop && t - pop.born > 0.9) popups.splice(i, 1);
    }

    // 全部倒したら、少し間を置いて立て直す。
    const cleared = plates.every((p) => p.hitAt >= 0) && bottles.every((b) => b.hitAt >= 0);
    if (cleared && resetAt < 0) resetAt = t + 1.4;
    if (resetAt > 0 && t > resetAt) {
      for (const p of plates) p.hitAt = -1;
      for (const b of bottles) b.hitAt = -1;
      resetAt = -1;
      sound.thud();
      popups.push({ p: [0, 2.2, PLATE_Z], text: 'CLEAR', born: t });
    }

    // 照準のキー移動。
    aim.x = clamp(aim.x + aim.keyX * dt * 120, 0, raster.w - 1);
    aim.y = clamp(aim.y + aim.keyY * dt * 120, 0, raster.h - 1);
    shownScore += (score - shownScore) * Math.min(1, dt * 12);
    shake *= Math.exp(-dt * 18);
  }

  // ─── 描く ────────────────────────────────────────────────────
  function worldSolids(t: number): Solid[] {
    const s: Solid[] = [];
    const W = xf();
    // 紙の的の台。
    s.push(
      box(
        W,
        [PAPER_C[0] - 0.47, PAPER_C[1] - 0.72, PAPER_C[2] - 0.03],
        [PAPER_C[0] + 0.47, PAPER_C[1] + 0.52, PAPER_C[2]],
        'steel',
      ),
    );
    s.push(
      box(
        W,
        [PAPER_C[0] - 0.4, 0, PAPER_C[2] - 0.05],
        [PAPER_C[0] - 0.36, PAPER_C[1] - 0.72, PAPER_C[2] - 0.02],
        'blued',
      ),
    );
    s.push(
      box(
        W,
        [PAPER_C[0] + 0.36, 0, PAPER_C[2] - 0.05],
        [PAPER_C[0] + 0.4, PAPER_C[1] - 0.72, PAPER_C[2] - 0.02],
        'blued',
      ),
    );
    // 瓶の台と瓶。琥珀の硝子。
    s.push(
      box(W, [1.3, BOTTLE_Y - 0.08, BOTTLE_Z - 0.2], [3.15, BOTTLE_Y, BOTTLE_Z + 0.2], 'steel'),
    );
    s.push(box(W, [1.38, 0, BOTTLE_Z - 0.04], [1.44, BOTTLE_Y - 0.08, BOTTLE_Z + 0.04], 'blued'));
    s.push(box(W, [3.0, 0, BOTTLE_Z - 0.04], [3.06, BOTTLE_Y - 0.08, BOTTLE_Z + 0.04], 'blued'));
    for (const b of bottles) {
      if (b.hitAt >= 0) continue;
      const up = compose(W, xf(rotX(-Math.PI / 2), [b.x, BOTTLE_Y, BOTTLE_Z]));
      s.push(prism(up, 8, 0.06, 0, 0, -0.24, 0, 'brass'));
      s.push(prism(up, 6, 0.024, 0, 0, -0.36, -0.24, 'brass'));
    }
    // 鉄の板。当たると後ろへ倒れる。
    s.push(box(W, [-2.5, 0.55, PLATE_Z - 0.06], [2.5, 0.62, PLATE_Z + 0.06], 'blued'));
    s.push(box(W, [-2.45, 0, PLATE_Z - 0.04], [-2.4, 0.55, PLATE_Z + 0.04], 'blued'));
    s.push(box(W, [2.4, 0, PLATE_Z - 0.04], [2.45, 0.55, PLATE_Z + 0.04], 'blued'));
    for (const p of plates) {
      const a =
        p.hitAt >= 0
          ? Math.min(Math.PI / 2, easeOutBack(clamp((t - p.hitAt) / 0.35), 1.2) * (Math.PI / 2))
          : 0;
      const hinge: Vec3 = [p.x, 0.62, PLATE_Z];
      const plate = compose(W, about(hinge, rotX(-a)));
      s.push(
        box(
          plate,
          [p.x - 0.02, 0.62, PLATE_Z - 0.015],
          [p.x + 0.02, PLATE_Y - PLATE_R, PLATE_Z + 0.015],
          'blued',
        ),
      );
      s.push(
        prism(
          plate,
          12,
          PLATE_R,
          p.x,
          PLATE_Y,
          PLATE_Z - 0.015,
          PLATE_Z + 0.015,
          p.hitAt >= 0 && t - p.hitAt < 0.25 ? 'brass' : 'steel',
        ),
      );
    }
    // 振り子の板。
    const c = pendulumPos(t);
    s.push(
      box(
        W,
        [PEND_HINGE[0] - 1.2, PEND_HINGE[1], PEND_HINGE[2] - 0.05],
        [PEND_HINGE[0] + 1.2, PEND_HINGE[1] + 0.08, PEND_HINGE[2] + 0.05],
        'blued',
      ),
    );
    s.push(
      box(
        W,
        [PEND_HINGE[0] - 1.2, 0, PEND_HINGE[2] - 0.05],
        [PEND_HINGE[0] - 1.12, PEND_HINGE[1], PEND_HINGE[2] + 0.05],
        'blued',
      ),
    );
    s.push(
      box(
        W,
        [PEND_HINGE[0] + 1.12, 0, PEND_HINGE[2] - 0.05],
        [PEND_HINGE[0] + 1.2, PEND_HINGE[1], PEND_HINGE[2] + 0.05],
        'blued',
      ),
    );
    s.push(
      prism(
        W,
        12,
        PEND_R,
        c[0],
        c[1],
        c[2] - 0.02,
        c[2] + 0.02,
        t - pendHitAt < 0.25 ? 'brass' : 'steel',
      ),
    );
    return s;
  }

  function line3(view: PerspView, a: Vec3, b: Vec3, col: number, dash?: readonly [number, number]) {
    if (!view.ahead(a) || !view.ahead(b)) return;
    const pa = view.project(a);
    const pb = view.project(b);
    raster.line(pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], col, true, 0.002, dash);
  }

  function drawGround(view: PerspView) {
    // 床の点。遠いほど薄い。
    for (let z = -2; z >= -32; z -= 1) {
      for (let x = -8; x <= 8; x += 1) {
        const p = view.project([x, 0, z]);
        const px = Math.floor(p[0]);
        const py = Math.floor(p[1]);
        if (px < 0 || py < 0 || px >= raster.w || py >= raster.h) continue;
        if (0.9 - (-z / 34) * 0.6 > threshold(px, py)) raster.set(px, py, INK);
      }
    }
    // 射座の綱と距離の札。
    line3(view, [-3.6, 0, -2], [-3.6, 0, -32], INK, [2, 3]);
    line3(view, [3.6, 0, -2], [3.6, 0, -32], INK, [2, 3]);
    for (const z of [5, 10, 15, 20, 25]) {
      const p = view.project([-4.1, 0.02, -z]);
      if (view.ahead([-4.1, 0, -z]))
        drawText(raster, `${z}`, Math.round(p[0]) - 4, Math.round(p[1]) - 7, INK);
    }
    // 土手。点の濃い盛り土を奥に。
    const berm: Vec3[] = [];
    for (let x = -40; x <= 40; x += 4)
      berm.push([x, 3.2 + Math.sin(x * 0.37) * 0.6 + hash(x) * 0.5, -33]);
    for (let i = 0; i + 1 < berm.length; i++) {
      const a = berm[i];
      const b = berm[i + 1];
      if (!a || !b) continue;
      const pa = view.project(a);
      const pb = view.project(b);
      const qa = view.project([a[0], 0, a[2]]);
      const qb = view.project([b[0], 0, b[2]]);
      raster.tri(pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], qb[0], qb[1], qb[2], 0.72, INK, PAPER);
      raster.tri(pa[0], pa[1], pa[2], qb[0], qb[1], qb[2], qa[0], qa[1], qa[2], 0.72, INK, PAPER);
      raster.line(pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], INK, true, 0.01);
    }
  }

  function drawPaper(view: PerspView) {
    const z = PAPER_C[2] + 0.005;
    const ring = (r: number, col: number) => {
      for (let k = 0; k < 28; k++) {
        const a0 = (k / 28) * Math.PI * 2;
        const a1 = ((k + 1) / 28) * Math.PI * 2;
        line3(
          view,
          [PAPER_C[0] + Math.cos(a0) * r, PAPER_C[1] + Math.sin(a0) * r, z],
          [PAPER_C[0] + Math.cos(a1) * r, PAPER_C[1] + Math.sin(a1) * r, z],
          col,
        );
      }
    };
    for (const r of [0.06, 0.12, 0.18, 0.24, 0.3, 0.38]) ring(r, INK);
    // 撃ち抜いた穴は残る。
    for (const [dx, dy] of holes) {
      const p = view.project([PAPER_C[0] + dx, PAPER_C[1] + dy, z + 0.002]);
      raster.rect(Math.round(p[0]) - 1, Math.round(p[1]) - 1, 2, 2, INK);
    }
  }

  function drawParticles(world: PerspView, gun: PerspView, t: number) {
    for (const p of particles) {
      if (t < p.born) continue;
      const view = p.kind === 'case' || p.kind === 'round' ? gun : world;
      if (!view.ahead(p.p)) continue;
      const s = view.project(p.p);
      const size =
        p.kind === 'case' || p.kind === 'round'
          ? Math.max(2, Math.round(0.05 * s[2] * view.focal))
          : 1;
      const col = p.kind === 'dust' ? INK : AMBER;
      const flip = Math.floor((t - p.born) * p.spin) % 2 === 0;
      raster.rect(
        Math.round(s[0]),
        Math.round(s[1]),
        flip ? size : Math.max(1, size >> 1),
        flip ? Math.max(1, size >> 1) : size,
        col,
      );
      if (p.kind === 'round' && size > 2) raster.set(Math.round(s[0]), Math.round(s[1]), INK);
    }
  }

  function drawChambers(view: PerspView, pose: RevolverPose) {
    const x = cylinderXf(pose);
    chambers.forEach((c, k) => {
      const a = chamberAngle(k);
      const cx = Math.cos(a) * CHAMBER_RADIUS;
      const cy = Math.sin(a) * CHAMBER_RADIUS;
      const disc = (r: number, col: number, dz: number) => {
        const pts: Vec3[] = [];
        for (let i = 0; i < 6; i++) {
          const b = (i / 6) * Math.PI * 2;
          pts.push(
            view.project(xp(x, [cx + Math.cos(b) * r, cy + Math.sin(b) * r, CYLINDER_REAR + dz])),
          );
        }
        const p0 = pts[0];
        if (!p0) return;
        for (let i = 1; i + 1 < 6; i++) {
          const p1 = pts[i];
          const p2 = pts[i + 1];
          if (!p1 || !p2) continue;
          raster.tri(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], 0, col, col);
        }
      };
      if (c === 'empty') disc(0.034, INK, 0.002);
      else {
        disc(0.038, AMBER, 0.003);
        disc(c === 'live' ? 0.012 : 0.016, INK, 0.004);
      }
    });
  }

  function drawFlash(gun: PerspView, pose: RevolverPose, t: number) {
    const a = t - firedAt;
    if (a < 0 || a > 0.06) return;
    const m = gun.project(muzzle(pose));
    const r = (reduced ? 10 : 22) * (1 - a / 0.06);
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2 + hash(Math.floor(firedAt * 100)) * 3;
      const a1 = ((i + 0.5) / n) * Math.PI * 2 + hash(Math.floor(firedAt * 100)) * 3;
      const len = r * (0.5 + hash(i + firedAt) * 0.8);
      raster.tri(
        m[0],
        m[1],
        9,
        m[0] + Math.cos(a0) * len,
        m[1] + Math.sin(a0) * len,
        9,
        m[0] + Math.cos(a1) * r * 0.3,
        m[1] + Math.sin(a1) * r * 0.3,
        9,
        0,
        AMBER,
        AMBER,
      );
    }
    raster.rect(Math.round(m[0]) - 2, Math.round(m[1]) - 2, 4, 4, PAPER);
  }

  function drawHud(view: PerspView, pose: RevolverPose, t: number) {
    const m = 6;
    drawText(raster, 'GUNMAN', m, m, INK, 2);
    drawText(raster, `SCORE ${String(Math.round(shownScore)).padStart(5, '0')}`, m, m + 20, INK);
    drawText(raster, `HITS ${hits}/${shots}`, m, m + 30, INK);
    const f = Math.floor(t * 24);
    const pad = (n: number) => String(n).padStart(2, '0');
    const tc = `${pad(Math.floor(f / 1440) % 60)}:${pad(Math.floor(f / 24) % 60)}:${pad(f % 24)}`;
    drawText(raster, tc, raster.w - m - textWidth(tc), m + 16, INK);
    if (combo > 1) {
      const c = `COMBO x${combo}`;
      drawText(raster, c, raster.w - m - textWidth(c), m + 26, AMBER);
    }
    // シリンダーの図。実物と同じ角度で回る。
    const cx = raster.w - m - 18;
    const cy = raster.h - m - 18;
    for (let k = 0; k < 6; k++) {
      const a = chamberAngle(k) + pose.cylinder;
      const x = Math.round(cx + Math.cos(a) * 11);
      const y = Math.round(cy - Math.sin(a) * 11);
      const c = chambers[k];
      if (c === 'live') raster.rect(x - 2, y - 2, 5, 5, AMBER);
      else {
        raster.rect(x - 2, y - 2, 5, 1, c === 'spent' ? AMBER : INK);
        raster.rect(x - 2, y + 2, 5, 1, c === 'spent' ? AMBER : INK);
        raster.rect(x - 2, y - 2, 1, 5, c === 'spent' ? AMBER : INK);
        raster.rect(x + 2, y - 2, 1, 5, c === 'spent' ? AMBER : INK);
        if (c === 'spent') raster.set(x, y, INK);
      }
    }
    raster.rect(cx - 1, cy - 19, 3, 2, INK);
    drawText(raster, 'R RELOAD  S SPIN  M SOUND  ESC', m, raster.h - m - 7, INK);
    // 撃ち切ったら、照準のそばに一言。
    const empty = phase === 'ready' && chambers.every((c) => c !== 'live');
    if (empty && Math.floor(t * 1.5) % 2 === 0) {
      drawText(raster, 'R', Math.round(aim.x) + 8, Math.round(aim.y) + 6, AMBER);
    }
    // 得点が浮かぶ。
    for (const p of popups) {
      if (!view.ahead(p.p)) continue;
      const s = view.project(p.p);
      const a = t - p.born;
      drawText(
        raster,
        p.text,
        Math.round(s[0] - textWidth(p.text) / 2),
        Math.round(s[1] - 10 - a * 30),
        AMBER,
      );
    }
    // 照準。的の上なら琥珀。
    const on = trace(view, aim.x, aim.y, t);
    const col = on && on.kind !== 'ground' ? AMBER : INK;
    const x = Math.round(aim.x);
    const y = Math.round(aim.y);
    raster.rect(x - 7, y, 4, 1, col);
    raster.rect(x + 4, y, 4, 1, col);
    raster.rect(x, y - 7, 1, 4, col);
    raster.rect(x, y + 4, 1, 4, col);
    raster.set(x, y, col);
  }

  function frame() {
    raf = 0;
    if (!image || !out) return;
    const nowMs = performance.now();
    const dt = Math.min(0.05, (nowMs - last) / 1000);
    last = nowMs;
    const t = now();
    step(t, dt);
    raster.clear();
    const view = camera(t);
    drawGround(view);
    const world = worldSolids(t);
    for (const s of world) drawFaces(raster, view, s, 0.85);
    for (const s of world) drawEdges(raster, view, s, false, 0.002);
    drawPaper(view);
    // 銃は別の層。カメラの前に固定し、世界の奥行きとは比べない。
    raster.depth.fill(-Infinity);
    const gun = new PerspView([0, 0, 0], 0, 0, view.focal, view.cx, view.cy);
    const pose = poseAt(t);
    const parts = revolverSolids(pose);
    for (const s of parts) drawFaces(raster, gun, s, 0.9);
    for (const s of parts) drawEdges(raster, gun, s, false, 0.02);
    drawChambers(gun, pose);
    drawParticles(view, gun, t);
    drawFlash(gun, pose, t);
    drawHud(view, pose, t);
    raster.present(out, palette);
    ctx2d.putImageData(image, 0, 0);
    const sx = Math.round((Math.random() - 0.5) * shake);
    const sy = Math.round((Math.random() - 0.5) * shake);
    cv.style.transform = shake > 0.3 ? `translate(${sx}px, ${sy}px)` : '';
    if (dialog.open) raf = requestAnimationFrame(frame);
  }

  // ─── 入力 ────────────────────────────────────────────────────
  const toRaster = (e: PointerEvent) => {
    const r = cv.getBoundingClientRect();
    aim.x = ((e.clientX - r.left) / r.width) * raster.w;
    aim.y = ((e.clientY - r.top) / r.height) * raster.h;
  };
  cv.addEventListener('pointermove', toRaster);
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    toRaster(e);
    pull();
  });
  const keyAxis: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  dialog.addEventListener('keydown', (e) => {
    const axis = keyAxis[e.key];
    if (axis) {
      aim.keyX = axis[0] || aim.keyX;
      aim.keyY = axis[1] || aim.keyY;
      e.preventDefault();
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      if (!e.repeat) pull();
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      if (!e.repeat) {
        loadOne();
        // 押し続けると、1 発ずつ拍を刻んで込める。
        loadHeld = true;
        window.clearInterval(loadTimer);
        loadTimer = window.setInterval(() => {
          if (loadHeld) loadOne();
        }, 210);
      }
    } else if (e.key === 's' || e.key === 'S') {
      spin();
    } else if (e.key === 'm' || e.key === 'M') {
      sound.muted = !sound.muted;
    }
  });
  dialog.addEventListener('keyup', (e) => {
    const axis = keyAxis[e.key];
    if (axis) {
      if (axis[0]) aim.keyX = 0;
      if (axis[1]) aim.keyY = 0;
    }
    if (e.key === 'r' || e.key === 'R') {
      loadHeld = false;
      window.clearInterval(loadTimer);
    }
  });
  reloadBtn.addEventListener('click', () => loadOne());
  exitBtn.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (raf) cancelAnimationFrame(raf);
    window.clearInterval(loadTimer);
    sound.shut();
    dialog.remove();
    onClose();
  });

  new ResizeObserver(resize).observe(cv);
  dialog.showModal();
  resize();
  raf = requestAnimationFrame(frame);
}
