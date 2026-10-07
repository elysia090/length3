import { add, clamp, hash, IDENTITY, mul, rotY, rotZ, type Vec3 } from '../../../shared/pixel/math';
import { AMBER, INK, Raster } from '../../../shared/pixel/raster';
import {
  type CubeState,
  cubeSolid,
  drawEdges,
  drawFaces,
  View,
} from '../../../shared/pixel/solids';
import { type Box, MODELS } from './models';

/**
 * 遭遇の舞台。相手の立体を 1 ビットの網点で描く。待っているあいだは息を
 * し、敵意が上がると前のめりになり、打たれると揺れて琥珀に灼け、決着が
 * つくと崩れる（倒す・折る）か、灯る（打ち解ける・暴く）。
 */

export interface Mood {
  hostility: number;
  hurtAt: number;
  actAt: number;
  /** 決着（崩れる・灯る）。 */
  end: 'fall' | 'glow' | null;
  endAt: number;
  /** 体積の一辺。 */
  edge: number;
}

const W = 200;
const H = 150;

function rgba(css: string, fallback: number): number {
  const m = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return fallback;
  const v = Number.parseInt(m[1] ?? '0', 16);
  return (0xff << 24) | ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff);
}

export class Stage {
  private raster = new Raster();
  private ctx: CanvasRenderingContext2D | null;
  private image: ImageData | null = null;
  private out: Uint32Array | null = null;
  private palette: Uint32Array;
  model = 'watchman';
  mood: Mood = { hostility: 3, hurtAt: -9, actAt: -9, end: null, endAt: -9, edge: 4 };

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d');
    canvas.width = W;
    canvas.height = H;
    this.raster.resize(W, H);
    if (this.ctx) {
      this.image = this.ctx.createImageData(W, H);
      this.out = new Uint32Array(this.image.data.buffer);
    }
    const style = getComputedStyle(canvas);
    this.palette = new Uint32Array([
      0,
      rgba(style.getPropertyValue('--bg'), 0xfffaf9f9),
      rgba(style.getPropertyValue('--ink'), 0xff1e1915),
      rgba(style.getPropertyValue('--amber'), 0xff0c58ea),
    ]);
  }

  private boxes(t: number): CubeState[] {
    const m = this.mood;
    if (this.model === 'volume') {
      const s = 1 + 0.02 * Math.sin(t * 1.4);
      return [
        {
          base: [0, 0, 0],
          size: m.edge * 0.42,
          rot: rotY(t * 0.15),
          squash: [s, 1 / s, s],
          hot: clamp(1 - (t - m.hurtAt) / 0.3),
          composite: true,
          airborne: 0,
          landed: true,
        },
      ];
    }
    const list: Box[] = MODELS[this.model] ?? MODELS.watchman ?? [];
    const breathe = 1 + 0.025 * Math.sin(t * 2.1);
    const lean = (m.hostility - 4) * 0.025;
    const hurt = clamp(1 - (t - m.hurtAt) / 0.35);
    const shake = hurt * 0.06 * Math.sin(t * 60);
    const act = clamp(1 - (t - m.actAt) / 0.4);
    const fall = m.end === 'fall' ? clamp((t - m.endAt) / 0.8) : 0;
    const glow = m.end === 'glow' ? clamp((t - m.endAt) / 0.6) : 0;
    return list.map((bx, i) => {
      const [x, y, z] = bx.at;
      const [w, h, d] = bx.size;
      let base: Vec3 = [x + shake, y, z];
      let rot = bx.tilt ? rotZ(bx.tilt) : IDENTITY;
      if (bx.body) {
        base = [base[0] + lean * y + act * 0.08 * Math.sin(t * 20), y * breathe, z + act * 0.12];
        rot = mul(rotZ(-lean * 0.6), rot);
      }
      if (fall > 0) {
        // 崩れる。箱がばらけて床へ落ちる。
        const k = hash(i * 7.13);
        base = add(base, [(k - 0.5) * fall * 1.4, -y * fall * fall, (hash(i * 3.1) - 0.5) * fall]);
        rot = mul(rotZ((k - 0.5) * fall * 3), rot);
      }
      return {
        base,
        size: 1,
        rot,
        squash: [w, h, d],
        hot: Math.max(bx.hot ?? 0, hurt * 0.8, glow * (0.3 + 0.7 * hash(i))),
        composite: false,
        airborne: 0,
        landed: false,
      };
    });
  }

  draw(t: number): void {
    const r = this.raster;
    if (!this.ctx || !this.image || !this.out) return;
    r.clear();
    const big = this.model === 'volume' ? this.mood.edge * 0.42 : 2;
    const span = Math.max(3.4, big * 1.9);
    const view = new View(
      {
        azimuth: Math.PI / 4 - 0.35 + 0.04 * Math.sin(t * 0.3),
        elevation: 0.42,
        target: [0, big * 0.48, 0],
        span,
      },
      Math.min(W, H) / span,
      W / 2,
      H / 2 + 6,
    );
    // 床の点。
    for (let gx = -4; gx <= 4; gx++) {
      for (let gz = -4; gz <= 4; gz++) {
        const p = view.project([gx * 0.5, 0, gz * 0.5]);
        r.set(Math.round(p[0]), Math.round(p[1]), INK);
      }
    }
    const solids = this.boxes(t).map((c) => cubeSolid(c, 0));
    for (const s of solids) drawFaces(r, view, s, 0.85);
    for (const s of solids) drawEdges(r, view, s, false, 0.02);
    // 打たれた瞬間、縁に琥珀の点を散らす。
    const hurt = clamp(1 - (t - this.mood.hurtAt) / 0.25);
    if (hurt > 0) {
      for (let i = 0; i < 40 * hurt; i++)
        r.set(Math.floor(hash(i + t) * W), Math.floor(hash(i * 3 + t) * H), AMBER);
    }
    r.present(this.out, this.palette);
    this.ctx.putImageData(this.image, 0, 0);
  }
}
