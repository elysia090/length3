import { drawText, textWidth } from '../../../shared/pixel/font';
import { clamp, lerp } from '../../../shared/pixel/math';
import { AMBER, INK, PAPER, Raster, threshold } from '../../../shared/pixel/raster';

/**
 * 塔（底の見えない巨大な建物）。フロアを床板として斜めに見下ろし、下へ
 * 積み重ねて描く。下のフロアほど網点が粗くなり、底は闇に溶けて見えない。
 * 地図そのものが遊びの本体で、遭遇もこの上で起きる（その部屋へ寄って、
 * 二つの記号が向き合う）。
 *
 * 人間は記号で描く：丸（頭）と逆三角形（体）。あなたは琥珀で塗り、
 * もう一人の灯り持ちは輪郭だけ、ほかの人物は墨。
 */

export const W = 320;
export const H = 240;

export type RoomKind = 'person' | 'danger' | 'event' | 'rest' | 'shop' | 'boss';

export interface RoomView {
  id: number;
  /** 区画の中のフロア（0 = いちばん上）。 */
  floor: number;
  col: number;
  cols: number;
  kind: RoomKind;
  /** 人物がいるか（遭遇の部屋）。 */
  person: boolean;
  hard: number | null;
  /** 正面からは歯が立たない。 */
  over: boolean;
  visited: boolean;
  reachable: boolean;
  /** 刻まれたエピテットの数と、見せ場の有無。 */
  eps: number;
  stage: boolean;
  /** もう一人が先に寄った。 */
  rivalWas: boolean;
}

export interface TowerView {
  /** 区画のいちばん上のフロアの番号（B いくつ）。 */
  top: number;
  floors: number;
  rooms: RoomView[];
  edges: readonly (readonly [number, number])[];
  /** あなたのいる部屋（入口なら null）。 */
  you: number | null;
  /** もう一人の灯り持ちの居場所。 */
  rival: number | null;
  /** 推奨の道（濃さの違う三本）。 */
  routes: readonly { kind: 'safe' | 'chain' | 'almost'; path: readonly number[]; mark?: number }[];
  focus: number | null;
  /** 遭遇中。 */
  enc: {
    room: number;
    foeHitAt: number;
    youHitAt: number;
    end: 'fall' | 'glow' | null;
    endAt: number;
  } | null;
}

interface Placed {
  id: number;
  x: number;
  y: number;
  z: number;
}

function rgba(css: string, fallback: number): number {
  const m = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return fallback;
  const v = Number.parseInt(m[1] ?? '0', 16);
  return (0xff << 24) | ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff);
}

export class Tower {
  private raster = new Raster();
  private ctx: CanvasRenderingContext2D | null;
  private image: ImageData | null = null;
  private out: Uint32Array | null = null;
  private palette: Uint32Array;
  private placed: Placed[] = [];
  /** カメラ（フロアの位置と寄り）。なめらかに追う。 */
  private cam = { floor: -0.5, zoom: 1, x: 0, y: 0 };

  constructor(readonly canvas: HTMLCanvasElement) {
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

  // ─── 投影 ───────────────────────────────────────────────────

  /** 部屋の床の上の位置（u は左右、v は奥行き）。 */
  private static spot(r: RoomView): { u: number; v: number } {
    const span = r.cols <= 1 ? 0 : 2.6 / (r.cols - 1);
    const u = r.cols <= 1 ? 0 : -1.3 + r.col * span;
    const v = r.kind === 'boss' ? 0 : (r.col + r.floor) % 2 ? 0.28 : -0.28;
    return { u, v };
  }

  private project(u: number, v: number, f: number): { x: number; y: number } {
    const z = this.cam.zoom;
    return {
      x: W / 2 + (u - v) * 30 * z - this.cam.x * z,
      y: H * 0.24 + (u + v) * 13 * z + (f - this.cam.floor) * 50 * z - this.cam.y * z,
    };
  }

  // ─── 描く ───────────────────────────────────────────────────

  draw(view: TowerView, t: number, dt: number): void {
    const r = this.raster;
    r.clear();
    // カメラ：いる部屋のフロアを上寄りに。遭遇中はその部屋へ寄る。
    const here = view.rooms.find((x) => x.id === (view.enc?.room ?? view.you));
    const targetFloor = here ? here.floor - (view.enc ? 0 : 0.3) : -0.6;
    const targetZoom = view.enc ? 1.9 : 1;
    const spot = here ? Tower.spot(here) : { u: 0, v: 0 };
    const targetX = view.enc ? (spot.u - spot.v) * 30 : 0;
    // 遭遇中は、その部屋を画面のまん中より少し下へ。
    const targetY = view.enc ? (spot.u + spot.v) * 13 - H * 0.16 : 0;
    const k = 1 - Math.exp(-dt * 6);
    this.cam.y = lerp(this.cam.y, targetY, k);
    this.cam.floor = lerp(this.cam.floor, targetFloor, k);
    this.cam.zoom = lerp(this.cam.zoom, targetZoom, k);
    this.cam.x = lerp(this.cam.x, targetX, k);

    this.abyss(view);
    // 深いフロアから描く（上のフロアが手前に重なる）。
    for (let f = view.floors - 1; f >= 0; f--) this.slab(view, f);
    this.stairs(view, t);
    this.placed = [];
    const rooms = [...view.rooms].sort((a, b) => b.floor - a.floor);
    for (const room of rooms) this.room(view, room, t);
    this.routes(view, t);
    this.people(view, t);
    if (this.ctx && this.image && this.out) {
      r.present(this.out, this.palette);
      this.ctx.putImageData(this.image, 0, 0);
    }
  }

  /** 底。下へ行くほど墨の網点が濃くなり、何も見えなくなる。 */
  private abyss(view: TowerView): void {
    const r = this.raster;
    const bottom = this.project(0, 0, view.floors + 0.2).y;
    for (let y = Math.max(0, Math.floor(bottom - 40)); y < H; y++) {
      const tone = clamp((y - bottom + 40) / 120);
      for (let x = 0; x < W; x++) if (threshold(x, y) < tone * 0.9) r.set(x, y, INK);
    }
  }

  /** フロアの床板。厚みのある斜めの板。f = -1 は区画の上（来た道）。 */
  private slab(view: TowerView, f: number): void {
    const r = this.raster;
    const fade = f < 0 ? 0.35 : clamp(1 - (f - this.cam.floor - 2.5) / 4, 0.15, 1);
    const U = 2.1;
    const V = 0.75;
    const p = [
      this.project(-U, -V, f),
      this.project(U, -V, f),
      this.project(U, V, f),
      this.project(-U, V, f),
    ];
    const [a, b, c, d] = p as [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
    ];
    const thick = 5 * this.cam.zoom;
    const z = -f;
    // 床の上面（紙に薄い網点）。
    r.tri(a.x, a.y, z, b.x, b.y, z, c.x, c.y, z, 0.95 * fade + (1 - fade) * 0.55, INK, PAPER);
    r.tri(a.x, a.y, z, c.x, c.y, z, d.x, d.y, z, 0.95 * fade + (1 - fade) * 0.55, INK, PAPER);
    // 厚み（手前の二辺）。
    r.tri(d.x, d.y, z, c.x, c.y, z, c.x, c.y + thick, z, 0.35, INK, PAPER);
    r.tri(d.x, d.y, z, c.x, c.y + thick, z, d.x, d.y + thick, z, 0.35, INK, PAPER);
    r.tri(c.x, c.y, z, b.x, b.y, z, b.x, b.y + thick, z, 0.2, INK, PAPER);
    r.tri(c.x, c.y, z, b.x, b.y + thick, z, c.x, c.y + thick, z, 0.2, INK, PAPER);
    for (const [s, e] of [
      [a, b],
      [b, c],
      [c, d],
      [d, a],
    ] as const)
      r.line(s.x, s.y, z, e.x, e.y, z, INK, false);
    if (f < 0) return;
    // フロアの番号（B いくつ）。
    const label = `B${view.top + f}`;
    const lx = Math.round(d.x - textWidth(label) - 6);
    const ly = Math.round(d.y - 3);
    if (lx > 0 && ly > 0 && ly < H - 8) drawText(r, label, lx, ly, fade > 0.5 ? INK : INK);
  }

  private stairs(view: TowerView, _t: number): void {
    const r = this.raster;
    const pos = new Map(view.rooms.map((room) => [room.id, room]));
    // 廊下（同じフロアの隣どうし）。細い実線。
    for (const a of view.rooms) {
      const b = view.rooms.find((x) => x.floor === a.floor && x.col === a.col + 1);
      if (!b) continue;
      const pa = this.center(a);
      const pb = this.center(b);
      r.line(pa.x, pa.y, 0, pb.x, pb.y, 0, INK, false, 0, [3, 1]);
    }
    for (const [from, to] of view.edges) {
      const a = pos.get(from);
      const b = pos.get(to);
      if (!a || !b) continue;
      const pa = this.center(a);
      const pb = this.center(b);
      r.line(pa.x, pa.y + 2, 0, pb.x, pb.y - 2, 0, INK, false, 0, [1, 2]);
    }
  }

  private center(room: RoomView): { x: number; y: number } {
    const s = Tower.spot(room);
    return this.project(s.u, s.v, room.floor);
  }

  /** 部屋。床の上の小さな台。中身の印（人・？・灯り・硬貨）。 */
  private room(view: TowerView, room: RoomView, t: number): void {
    const r = this.raster;
    const zm = this.cam.zoom;
    const { x, y } = this.center(room);
    const s = (room.kind === 'boss' ? 7 : 5) * zm;
    const hot = view.focus === room.id;
    const tone = room.visited ? 0.45 : 0.97;
    const z = 10 - room.floor;
    r.tri(x - s, y, z, x, y - s / 2, z, x + s, y, z, tone, INK, PAPER);
    r.tri(x - s, y, z, x + s, y, z, x, y + s / 2, z, tone, INK, PAPER);
    const edge = room.reachable && Math.floor(t * 2.5) % 2 === 0 ? AMBER : hot ? AMBER : INK;
    r.line(x - s, y, z, x, y - s / 2, z, edge, false);
    r.line(x, y - s / 2, z, x + s, y, z, edge, false);
    r.line(x + s, y, z, x, y + s / 2, z, edge, false);
    r.line(x, y + s / 2, z, x - s, y, z, edge, false);
    if (room.stage) {
      r.set(x - s - 2, y, AMBER);
      r.set(x + s + 2, y, AMBER);
    }
    for (let i = 0; i < room.eps; i++) r.set(x - s + 2 + i * 2, y + s / 2 + 2, INK);
    if (!room.person) this.mark(room.kind, x, y - 1, room.visited);
    this.placed.push({ id: room.id, x, y, z });
  }

  /** 人のいない部屋の印。 */
  private mark(kind: RoomKind, x: number, y: number, dim: boolean): void {
    const r = this.raster;
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

  /** 推奨の道。安定は細い点線、高連鎖は琥珀の実線、未完成は琥珀の点線と目印。 */
  private routes(view: TowerView, t: number): void {
    const r = this.raster;
    const pos = new Map(view.rooms.map((room) => [room.id, room]));
    for (const route of view.routes) {
      let prev = view.you !== null ? pos.get(view.you) : undefined;
      for (const id of route.path) {
        const room = pos.get(id);
        if (!room) continue;
        if (prev) {
          const a = this.center(prev);
          const b = this.center(room);
          const off = route.kind === 'safe' ? -2 : route.kind === 'chain' ? 0 : 2;
          r.line(
            a.x + off,
            a.y,
            20,
            b.x + off,
            b.y,
            20,
            route.kind === 'safe' ? INK : AMBER,
            false,
            0,
            route.kind === 'chain' ? undefined : [2, 2],
          );
        }
        prev = room;
      }
      if (route.mark !== undefined) {
        const m = pos.get(route.mark);
        if (m && Math.floor(t * 2) % 2 === 0) {
          const c = this.center(m);
          this.ring(c.x, c.y - 4, 9 * this.cam.zoom, AMBER);
        }
      }
    }
  }

  private ring(cx: number, cy: number, rad: number, c: number): void {
    const n = Math.max(12, Math.round(rad * 5));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.raster.set(
        Math.round(cx + Math.cos(a) * rad),
        Math.round(cy + Math.sin(a) * rad * 0.5),
        c,
      );
    }
  }

  /** 人。丸と逆三角形。 */
  private figure(x: number, y: number, k: number, fill: number, outline = false, lean = 0): void {
    const r = this.raster;
    const hr = 2 * k;
    const bw = 3.2 * k;
    const bh = 7 * k;
    const top = y - bh;
    const hx = x + lean * k;
    const hy = top - hr - 1;
    // 体（逆三角形）。
    if (outline) {
      r.line(x - bw, top, 99, x + bw, top, 99, fill, false);
      r.line(x - bw, top, 99, x, y, 99, fill, false);
      r.line(x + bw, top, 99, x, y, 99, fill, false);
    } else r.tri(x - bw, top, 99, x + bw, top, 99, x, y, 99, 0, fill, fill);
    // 頭（丸）。
    for (let j = -Math.ceil(hr); j <= Math.ceil(hr); j++)
      for (let i = -Math.ceil(hr); i <= Math.ceil(hr); i++) {
        const d = Math.hypot(i, j);
        if (outline ? Math.abs(d - hr) < 0.6 : d <= hr + 0.2)
          r.set(Math.round(hx + i), Math.round(hy + j), fill);
      }
  }

  private people(view: TowerView, t: number): void {
    const zm = this.cam.zoom;
    const pos = new Map(view.rooms.map((room) => [room.id, room]));
    for (const room of view.rooms) {
      if (!room.person) continue;
      // 遠いフロアの人は描かない（近づけば見えてくる。画面を静かに保つ）。
      if (room.floor - this.cam.floor > 3.2 && room.kind !== 'boss') continue;
      const inEnc = view.enc?.room === room.id;
      const { x, y } = this.center(room);
      const k = (room.kind === 'boss' ? 1.8 : 1.25) * zm;
      const e = view.enc;
      if (inEnc && e) {
        const gone = e.end && t - e.endAt > 0.3;
        if (gone && e.end === 'fall') continue;
        const hit = t - e.foeHitAt < 0.18;
        const shake = hit ? Math.sin(t * 90) * 1.5 : 0;
        this.figure(
          x + 7 * zm + shake,
          y,
          k,
          hit || (e.end === 'glow' && gone) ? AMBER : INK,
          false,
          -0.4,
        );
      } else this.figure(x, y, k, room.visited ? PAPER : INK, room.visited);
      // 硬度（数字）。歯が立たない相手は、数字を墨の枠で囲む
      // （琥珀は「あなた」と「押せるもの」にだけ使う）。
      if (room.hard !== null && !room.visited && !inEnc) {
        const label = String(room.hard);
        const lx = Math.round(x + 5 * k);
        const ly = Math.round(y - 9 * k);
        drawText(this.raster, label, lx, ly, INK);
        if (room.over) {
          const w = textWidth(label) + 3;
          this.raster.line(lx - 2, ly - 2, 99, lx + w, ly - 2, 99, INK, false);
          this.raster.line(lx - 2, ly + 8, 99, lx + w, ly + 8, 99, INK, false);
          this.raster.line(lx - 2, ly - 2, 99, lx - 2, ly + 8, 99, INK, false);
          this.raster.line(lx + w, ly - 2, 99, lx + w, ly + 8, 99, INK, false);
        }
      }
    }
    // もう一人の灯り持ち（輪郭だけ）。
    if (view.rival !== null) {
      const room = pos.get(view.rival);
      if (room) {
        const { x, y } = this.center(room);
        this.figure(x + 8 * zm, y + 2, zm, INK, true);
      }
    }
    // あなた（琥珀）。
    const here = view.enc
      ? pos.get(view.enc.room)
      : view.you !== null
        ? pos.get(view.you)
        : undefined;
    if (here) {
      const { x, y } = this.center(here);
      const e = view.enc;
      const hurt = e ? t - e.youHitAt < 0.18 : false;
      const bob = Math.round(Math.sin(t * 3) * 0.6);
      this.figure(
        x - (e ? 7 * zm : 0) + (hurt ? Math.sin(t * 80) * 1.5 : 0),
        y + bob,
        zm * (e ? 1 : 1),
        hurt ? INK : AMBER,
        false,
        e ? 0.4 : 0,
      );
    } else {
      // 入口（区画の上）。
      const p = this.project(0, 0, -0.5);
      this.figure(p.x, p.y, zm, AMBER);
    }
  }

  /** 画面上の点（CSS 画素）から、その部屋を探す。 */
  pick(cssX: number, cssY: number): number | null {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = ((cssX - rect.left) / rect.width) * W;
    const y = ((cssY - rect.top) / rect.height) * H;
    let best: number | null = null;
    let d = 18 * this.cam.zoom;
    for (const p of this.placed) {
      const e = Math.hypot(p.x - x, (p.y - 4 - y) * 1.2);
      if (e < d) {
        d = e;
        best = p.id;
      }
    }
    return best;
  }
}
