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
 *
 * 建物は一棟ではない。同じ高さの床が、左右と奥にもうっすら続いている（隣の
 * 塔の、同じフロア）。渡り廊下のある階でだけ、そこに部屋が灯る（渡ると、
 * カメラもそちらへ寄る）。
 */

/** 深い青（いま効いているもの：守り・落ち着き・信頼の糸・見せ場）。必ずまばらに置く。 */
export const BLUE = 4;

export const W = 320;
export const H = 240;

export type RoomKind = 'person' | 'danger' | 'event' | 'rest' | 'shop' | 'boss';

export interface RoomView {
  id: number;
  /** 区画の中のフロア（0 = いちばん上）。 */
  floor: number;
  col: number;
  cols: number;
  /** 0 は本棟、-1 / 1 は左右の隣の塔。 */
  tower: number;
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
    scene?: Scene | null;
  } | null;
}

/** 向き合っている場面（寄ったときにだけ描く、計器と気配）。 */
export interface Scene {
  you: { hp: number; maxHp: number; mind: number; maxMind: number; guard: number; calm: number };
  /** 次の手で失いそうな分（守りを引く前）。 */
  loss: { hp: number; mind: number };
  foe: {
    hp: number;
    maxHp: number;
    will: number;
    maxWill: number;
    trust: number;
    need: number;
    guard: number;
    hostility: number;
    clues: number;
    shown: number;
    boss: boolean;
  };
  intent: { kind: string; power: number | null } | null;
  /** 見せ場（合うタグのカードが響いている）。 */
  stage: boolean;
  resonance: number;
  /** 長引いて、相手が苛立っている。 */
  stall: boolean;
  /** 跳ねる数（当たった・戻った・受け止めた）。 */
  pops: readonly { who: 'you' | 'foe'; text: string; tone: 'ink' | 'amber' | 'blue'; at: number }[];
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
      rgba(style.getPropertyValue('--dig-blue'), 0xff9e3d1f),
    ]);
  }

  // ─── 投影 ───────────────────────────────────────────────────

  /**
   * 隣の塔の中心。u と v を逆向きに同じだけずらすと、画面の上では真横になる
   * （同じフロアの高さのまま、左右に並ぶ）。
   */
  private static wing(side: number): { u: number; v: number } {
    return { u: side * 3.05, v: -side * 3.05 };
  }

  /** 部屋の床の上の位置（u は左右、v は奥行き）。 */
  private static spot(r: RoomView): { u: number; v: number } {
    if (r.tower) {
      // 隣の床の、こちら寄りの端。
      const c = Tower.wing(r.tower);
      return { u: c.u - r.tower * 1.2, v: c.v + r.tower * 0.5 + (r.floor % 2 ? 0.12 : -0.12) };
    }
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
    const targetZoom = view.enc ? 2.4 : 1;
    const spot = here ? Tower.spot(here) : { u: 0, v: 0 };
    // 隣の塔にいるときは、そちらへ寄せる。渡れる部屋が見えているときは、少しだけ。
    const bridge = view.rooms.find((x) => x.reachable && x.tower);
    const side = here?.tower ? spot : bridge ? Tower.spot(bridge) : null;
    const targetX = view.enc
      ? (spot.u - spot.v) * 30
      : side
        ? (side.u - side.v) * 30 * (here?.tower ? 0.6 : 0.3)
        : 0;
    // 遭遇中は、その部屋を画面のまん中より少し下へ。
    const targetY = view.enc ? (spot.u + spot.v) * 13 - H * 0.16 : 0;
    const k = 1 - Math.exp(-dt * 6);
    this.cam.y = lerp(this.cam.y, targetY, k);
    this.cam.floor = lerp(this.cam.floor, targetFloor, k);
    this.cam.zoom = lerp(this.cam.zoom, targetZoom, k);
    this.cam.x = lerp(this.cam.x, targetX, k);

    this.abyss(view);
    // 深いフロアから描く（上のフロアが手前に重なる）。同じ高さの隣の床が先。
    const lit = new Set(view.rooms.filter((x) => x.tower).map((x) => `${x.tower}:${x.floor}`));
    for (let f = view.floors; f >= -1; f--) {
      this.neighbors(f, lit);
      if (f >= 0 && f < view.floors) this.slab(view, f);
    }
    this.stairs(view, t);
    this.placed = [];
    const rooms = [...view.rooms].sort((a, b) => b.floor - a.floor);
    for (const room of rooms) this.room(view, room, t);
    this.routes(view, t);
    const scene = view.enc?.scene;
    // 寄るほど場面が立ち上がる（0 = 地図、1 = 向き合った場面）。
    const presence = clamp((this.cam.zoom - 1.2) / 0.9);
    const at = view.enc ? view.rooms.find((x) => x.id === view.enc?.room) : undefined;
    const c = at ? this.center(at) : null;
    if (scene && c && presence > 0) {
      this.lamp(c.x, c.y, scene, t, presence);
      if (scene.stage) this.spotlight(c.x, c.y, t, presence);
    }
    this.people(view, t);
    if (scene && c && at && presence > 0.6) this.hud(c.x, c.y, at.kind === 'boss', scene, t);
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

  /**
   * 同じ高さの、隣の床。本棟の床と同じ形で、左右と奥に続いている。塗りは
   * まばらな網点、縁は点線。遠いフロアほど消える。部屋のある床だけ少し濃い。
   */
  private neighbors(f: number, lit: ReadonlySet<string>): void {
    const away = f - this.cam.floor;
    if (away > 4.2 || away < -1.6) return;
    const fade = clamp(1 - (away - 1.5) / 3, 0, 1);
    const plates: { u: number; v: number; key: string }[] = [
      { u: 0, v: -1.8, key: 'back' },
      { ...Tower.wing(-1), key: '-1' },
      { ...Tower.wing(1), key: '1' },
    ];
    for (const p of plates) {
      const on = lit.has(`${p.key}:${f}`);
      // 寄っているあいだ（遭遇中）は、部屋のある床だけ。
      if (this.cam.zoom > 1.2 && !on) continue;
      this.plate(p.u, p.v, f, fade, on, p.key === 'back');
    }
  }

  private plate(
    cu: number,
    cv: number,
    f: number,
    fade: number,
    lit: boolean,
    back: boolean,
  ): void {
    if (fade <= 0) return;
    const r = this.raster;
    const U = 2.1;
    const V = 0.75;
    const [a, b, c, d] = [
      this.project(cu - U, cv - V, f),
      this.project(cu + U, cv - V, f),
      this.project(cu + U, cv + V, f),
      this.project(cu - U, cv + V, f),
    ] as [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
    ];
    const z = -f - 0.5;
    // ごくまばらな網点。部屋のある床だけ、本棟に近い濃さと厚み。
    if (lit) {
      r.tri(a.x, a.y, z, b.x, b.y, z, c.x, c.y, z, 0.97, INK, PAPER);
      r.tri(a.x, a.y, z, c.x, c.y, z, d.x, d.y, z, 0.97, INK, PAPER);
      const thick = 4 * this.cam.zoom;
      r.tri(d.x, d.y, z, c.x, c.y, z, c.x, c.y + thick, z, 0.6, INK, PAPER);
      r.tri(d.x, d.y, z, c.x, c.y + thick, z, d.x, d.y + thick, z, 0.6, INK, PAPER);
    } else if (!back) {
      r.tri(a.x, a.y, z, b.x, b.y, z, c.x, c.y, z, 0.996, INK, PAPER);
      r.tri(a.x, a.y, z, c.x, c.y, z, d.x, d.y, z, 0.996, INK, PAPER);
    }
    // 縁。奥の床は手前の一辺だけ（同じ床が向こうへ続いている、という気配）。
    const dash: [number, number] = lit ? [2, 2] : fade > 0.6 ? [1, 4] : [1, 7];
    const edges = back
      ? ([[d, c]] as const)
      : ([
          [a, b],
          [b, c],
          [c, d],
          [d, a],
        ] as const);
    for (const [s0, e0] of edges) r.line(s0.x, s0.y, z, e0.x, e0.y, z, INK, false, 0, dash);
  }

  private stairs(view: TowerView, _t: number): void {
    const r = this.raster;
    const pos = new Map(view.rooms.map((room) => [room.id, room]));
    // 廊下（同じフロアの隣どうし）。細い実線。
    for (const a of view.rooms) {
      const b = view.rooms.find(
        (x) => x.floor === a.floor && x.tower === a.tower && x.col === a.col + 1,
      );
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
      if (a.tower !== b.tower) {
        // 渡り廊下（二本の破線）。
        r.line(pa.x, pa.y, 0, pb.x, pb.y - 3, 0, INK, false, 0, [3, 2]);
        r.line(pa.x, pa.y + 3, 0, pb.x, pb.y, 0, INK, false, 0, [3, 2]);
      } else r.line(pa.x, pa.y + 2, 0, pb.x, pb.y - 2, 0, INK, false, 0, [1, 2]);
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
  /**
   * style: solid はべた塗り（あなた）、outline は輪郭だけ（もう一人・会い終えた人）、
   * sparse は輪郭と、まばらな網点の中身（いま向き合える相手。深い青で）。
   */
  private figure(
    x: number,
    y: number,
    k: number,
    fill: number,
    style: 'solid' | 'outline' | 'sparse' | boolean = 'solid',
    lean = 0,
  ): void {
    const mode = style === true ? 'outline' : style === false ? 'solid' : style;
    const outline = mode !== 'solid';
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
          hit ? INK : e.end === 'glow' && gone ? AMBER : BLUE,
          hit ? 'solid' : 'sparse',
          -0.4,
        );
      } else if (room.visited) this.figure(x, y, k, PAPER, 'outline');
      // いま向き合える相手は深い青のまばら、まだ遠い人は墨。
      else if (room.reachable) this.figure(x, y, k, BLUE, 'sparse');
      else this.figure(x, y, k, INK);
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

  // ─── 向き合った場面 ─────────────────────────────────────────

  /**
   * 灯り。あなたの灯りが届く輪の外は、墨の網点で沈む。輪の大きさは心の残り
   * で決まり、揺らぐ。長引くと、外の闇が脈打つ。
   */
  private lamp(cx: number, cy: number, s: Scene, t: number, presence: number): void {
    const r = this.raster;
    const zm = this.cam.zoom;
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
        if (s.stage && y < cy && Math.abs(dx) < this.beamHalf(y, cy)) continue;
        const far = x < x0 || x >= x1 ? 1 : clamp((d - R) / (R * 1.1));
        const tone = (0.5 * far + pulse) * presence;
        if (threshold(x, y) < tone) r.set(x, y, INK);
      }
    }
  }

  /** 見せ場の光の筋の、その高さでの半幅。 */
  private beamHalf(y: number, cy: number): number {
    const half = 24 * this.cam.zoom;
    return 4 + (half - 4) * clamp(y / Math.max(1, cy));
  }

  /** 見せ場。上から細い光が降りる（筋の縁と、光の中を降る埃）。 */
  private spotlight(cx: number, cy: number, t: number, presence: number): void {
    const r = this.raster;
    for (let y = 0; y < cy; y++) {
      const w = this.beamHalf(y, cy);
      for (const x of [Math.round(cx - w), Math.round(cx + w)])
        if (threshold(x, y) < 0.5 * presence) r.set(x, y, INK);
    }
    if (presence < 0.5) return;
    for (let n = 0; n < 14; n++) {
      const u = ((n * 0.618 + t * 0.05 * (1 + (n % 3))) % 1) * cy;
      const sx = cx + Math.sin(n * 12.9 + t * 0.7) * this.beamHalf(u, cy) * 0.8;
      r.set(Math.round(sx), Math.round(u), INK);
    }
  }

  /** 円環にまばらな点（守り・落ち着き）。from〜to は角度（ラジアン）。 */
  private veil(
    cx: number,
    cy: number,
    rad: number,
    thick: number,
    density: number,
    c: number,
    from = 0,
    to = Math.PI * 2,
  ): void {
    const r = this.raster;
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

  /** 計器の点の大きさ（拡大して見られるので、二倍の点で描く）。 */
  private static readonly K = 2;

  private dot(x: number, y: number, c: number): void {
    const k = Tower.K;
    this.raster.rect(x, y, k, k, c);
  }

  /**
   * 横棒の計器（点で描く）。w は点の数、step は点の間（1 = べた、2 = まばら）。
   * 守りは棒の先に点線で伸び、次の手で失う分は点滅する。
   */
  private bar(
    x: number,
    y: number,
    w: number,
    ratio: number,
    fill: number,
    step: number,
    extra: { shield?: number; loss?: number; blink?: boolean } = {},
  ): void {
    const k = Tower.K;
    const n = Math.round(w * clamp(ratio));
    const loss = Math.min(n, Math.max(0, Math.round(extra.loss ?? 0)));
    this.raster.rect(x - 1, y - 1, w * k + 2, k + 2, PAPER);
    for (let i = 0; i < w; i++) {
      const px = x + i * k;
      if (i < n - loss) {
        if (i % step === 0) this.dot(px, y, fill);
      } else if (i < n) {
        if (!extra.blink) this.dot(px, y, fill);
      } else if (i % 2 === 0) this.raster.set(px, y + k - 1, INK);
    }
    const sh = Math.min(w, Math.round(extra.shield ?? 0));
    for (let i = 0; i < sh; i++) if (i % 2 === 0) this.raster.set(x + (n + i) * k, y, fill);
  }

  /** 予告の印（7×7）。 */
  private glyph(kind: string, x: number, y: number, c: number): void {
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
      for (let i = 0; i < row.length; i++)
        if (row[i] === '1') this.dot(x + i * Tower.K, y + j * Tower.K, c);
    });
  }

  /** 計器と気配（二人の頭の上、信頼の糸、守り、予告、跳ねる数）。 */
  private hud(cx: number, cy: number, boss: boolean, s: Scene, t: number): void {
    const r = this.raster;
    const zm = this.cam.zoom;
    const youX = cx - 7 * zm;
    const foeX = cx + 7 * zm;
    const fk = (boss ? 1.8 : 1.25) * zm;
    const youTop = cy - 7 * zm - 4 * zm - 2;
    const foeTop = cy - 7 * fk - 4 * fk - 2;
    const blink = Math.floor(t * 2.2) % 2 === 0;
    const K = Tower.K;
    // 守り（体の前に、相手へ向けた半円）と落ち着き（頭のまわり）。あなたの側は
    // 琥珀、相手の側は青で、どちらもまばらに。
    if (s.you.guard > 0)
      this.veil(
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
      this.veil(youX, cy - 9.5 * zm, 3.6 * zm, 1.6, 0.14 + Math.min(0.3, s.you.calm / 25), AMBER);
    if (s.foe.guard > 0)
      this.veil(
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
    const yx = Math.round(youX + 2 - bw * K);
    const yy = Math.round(youTop - 12);
    const lossHp = Math.max(0, s.loss.hp - s.you.guard);
    const lossMind = Math.max(0, s.loss.mind - s.you.calm);
    this.bar(yx, yy, bw, s.you.hp / Math.max(1, s.you.maxHp), AMBER, 1, {
      shield: (s.you.guard / Math.max(1, s.you.maxHp)) * bw,
      loss: (lossHp / Math.max(1, s.you.maxHp)) * bw,
      blink,
    });
    this.bar(yx, yy + 5, bw, s.you.mind / Math.max(1, s.you.maxMind), AMBER, 2, {
      shield: (s.you.calm / Math.max(1, s.you.maxMind)) * bw,
      loss: (lossMind / Math.max(1, s.you.maxMind)) * bw,
      blink,
    });
    const fx = Math.round(foeX - 2);
    const fy = Math.round(foeTop - 12);
    this.bar(fx, fy, bw, s.foe.hp / Math.max(1, s.foe.maxHp), BLUE, 1, {
      shield: (s.foe.guard / Math.max(1, s.foe.maxHp)) * bw,
    });
    this.bar(fx, fy + 5, bw, s.foe.will / Math.max(1, s.foe.maxWill), BLUE, 2);
    // 手がかりは小さな菱形（見つけたものは琥珀で塗る）。
    for (let i = 0; i < s.foe.clues; i++) {
      const bx = fx + i * 4 * K;
      const by = fy + 11;
      const got = i < s.foe.shown;
      const c = got ? AMBER : INK;
      this.dot(bx + K, by - K, c);
      this.dot(bx, by, c);
      this.dot(bx + 2 * K, by, c);
      this.dot(bx + K, by + K, c);
      if (got) this.dot(bx + K, by, c);
    }
    // 予告（相手の計器の上）。
    if (s.intent) {
      const gx = Math.round(fx);
      const gy = Math.round(fy - 19 + Math.sin(t * 3) * 0.8);
      r.rect(gx - 2, gy - 2, 7 * K + 4, 7 * K + 4, PAPER);
      this.glyph(s.intent.kind, gx, gy, INK);
      if (s.intent.power) {
        const label = String(s.intent.power);
        r.rect(gx + 7 * K + 2, gy - 1, textWidth(label, K) + 3, 7 * K + 2, PAPER);
        drawText(r, label, gx + 7 * K + 3, gy, INK, K);
      }
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
