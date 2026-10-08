import { drawText, textWidth } from '../../../shared/pixel/font';
import { clamp, lerp } from '../../../shared/pixel/math';
import { AMBER, INK, NONE, PAPER, Raster, threshold } from '../../../shared/pixel/raster';
import {
  BLUE,
  ENC_ZOOM,
  FAR_ZOOM,
  GEO,
  H,
  NEAR_ZOOM,
  PEER,
  PEER_BOSS,
  PEER_OVER,
  spot,
  wing,
} from './pixel/geo';
import { figure, mark, ring } from './pixel/paint';
import { hud, lamp, spotlight } from './pixel/scene';
import type { RoomView, TowerView } from './pixel/types';

export { BLUE, H } from './pixel/geo';
export type { RoomKind, RoomView, Scene, TowerView } from './pixel/types';

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
  private cam = { floor: -0.5, zoom: NEAR_ZOOM, x: 0, y: 0 };
  /**
   * カメラの演出（撮影の言葉で）。
   *   押し込み  連鎖・会心の瞬間に、一歩だけ寄って戻る（ドリーの一打）
   *   寄り切り  決着がついたら、ゆっくり寄って、そのまま止める
   */
  private kick = { at: -9, amt: 0 };
  private hold = { at: -9, amt: 0 };
  /**
   * あなたの立ち位置（床の上の u・v と、フロア f）。部屋を移ると、点線の道に
   * 沿ってそこまで歩く（一歩ずつ跳ばずに）。近景のカメラは寄りを変えずに、
   * 歩く人を追って横と下へ流れるだけ。
   */
  private me = { u: 0, v: 0, f: -1 };
  private walk = {
    id: null as number | null,
    from: { u: 0, v: 0, f: -1 },
    to: { u: 0, v: 0, f: -1 },
    at: -9,
    dur: 0,
  };

  /** 一歩だけ寄って戻る（amt は寄る割合）。 */
  punch(amt: number, t: number): void {
    this.kick = { at: t, amt };
  }

  /** ゆっくり寄って止める。0 で解く。 */
  settle(amt: number, t: number): void {
    this.hold = { at: t, amt };
  }
  /** 見渡す（引いて、区画をひと目に）。 */
  overview = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d');
    this.match();
    const style = getComputedStyle(canvas);
    this.palette = new Uint32Array([
      0,
      rgba(style.getPropertyValue('--bg'), 0xfffaf9f9),
      rgba(style.getPropertyValue('--ink'), 0xff1e1915),
      rgba(style.getPropertyValue('--amber'), 0xff0c58ea),
      rgba(style.getPropertyValue('--dig-blue'), 0xff9e3d1f),
      rgba(style.getPropertyValue('--dig-green'), 0xff4f7d2f),
    ]);
  }

  /** 横の画素数（枠の縦横比から）。 */
  private W = 320;

  /** 枠の大きさが変わっていたら、横の画素数を合わせる（帯や余白のない一枚に）。 */
  private match(): void {
    const rect = this.canvas.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 4 / 3;
    const w = Math.round(clamp(H * aspect, H * 0.75, H * 2.6));
    if (w === this.W && this.image) return;
    this.W = w;
    this.canvas.width = w;
    this.canvas.height = H;
    this.raster.resize(w, H);
    if (this.ctx) {
      this.image = this.ctx.createImageData(w, H);
      this.out = new Uint32Array(this.image.data.buffer);
    }
  }

  // ─── 投影 ───────────────────────────────────────────────────

  /** いま見ているフロアからの隔たり（下が正）。 */
  private away(f: number): number {
    return f - this.cam.floor;
  }

  /** 地図の上の人の大きさの倍率（遭遇の寄りでは 1）。 */
  private mapPeople(): number {
    return 1 + 0.25 * clamp((ENC_ZOOM - this.cam.zoom) / (ENC_ZOOM - NEAR_ZOOM));
  }

  /** そのフロアを細かく描くか（近いフロアだけ。遠景を静かに保つ）。 */
  private detailed(f: number): boolean {
    return this.away(f) < 2.4;
  }

  private project(u: number, v: number, f: number): { x: number; y: number } {
    const z = this.cam.zoom;
    return {
      x: this.W / 2 + (u * GEO.ux + v * GEO.vx) * z - this.cam.x * z,
      y: H * 0.3 + this.away(f) * GEO.gap * z + (u * GEO.uy + v * GEO.vy) * z - this.cam.y * z,
    };
  }

  /** 近景か（見渡していないとき。遭遇も近景）。 */
  private closeup(): boolean {
    return !this.overview;
  }

  /** 近景の寄り（一つのフロアが端から端まで入る大きさ。枠の大きさだけで決まる）。 */
  private nearZoom(): number {
    const span = 2 * (GEO.U * GEO.ux + GEO.V * -GEO.vx);
    return clamp((this.W * 0.88) / span, 1.25, NEAR_ZOOM);
  }

  /**
   * 歩く。行き先が変わったら、いまの立ち位置からそこまで、まっすぐ（点線の
   * 道どおりに）歩く。速さは一定で、短い道でもひと呼吸はかける。動きを減らす
   * 設定では、すぐ着く。歩いているあいだは true。
   */
  private step(here: RoomView | undefined, t: number): boolean {
    const id = here?.id ?? null;
    const to = here ? { ...spot(here), f: here.floor } : { u: 0, v: 0, f: -1 };
    const w = this.walk;
    if (id !== w.id) {
      const first = w.id === null && w.at < 0;
      const still =
        typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      const du = to.u - this.me.u;
      const dv = to.v - this.me.v;
      const dx = du * GEO.ux + dv * GEO.vx;
      const dy = du * GEO.uy + dv * GEO.vy + (to.f - this.me.f) * GEO.gap;
      this.walk = {
        id,
        from: { ...this.me },
        to,
        at: t,
        dur: first || still ? 0 : clamp(Math.hypot(dx, dy) / 150, 0.35, 0.95),
      };
    }
    const k = this.walk.dur > 0 ? clamp((t - this.walk.at) / this.walk.dur) : 1;
    // 歩き出しと止まりだけ、少しやわらかく。
    const e = k * k * (3 - 2 * k);
    const { from } = this.walk;
    const dest = this.walk.to;
    this.me = {
      u: lerp(from.u, dest.u, e),
      v: lerp(from.v, dest.v, e),
      f: lerp(from.f, dest.f, e),
    };
    return k < 1;
  }

  // ─── 描く ───────────────────────────────────────────────────

  draw(view: TowerView, t: number, dt: number): void {
    this.match();
    const r = this.raster;
    r.clear();
    // カメラ。遭遇中はその部屋へ寄る。ふだんは近景：あなたと、次に行ける
    // 部屋と、触れている部屋がちょうど収まるように寄せて、真ん中に置く。
    // 見渡すときは引いて、区画を上から。
    const here = view.rooms.find((x) => x.id === (view.enc?.room ?? view.you));
    const walking = this.step(here, t);
    const focusAt = here ? spot(here) : { u: 0, v: 0 };
    const sx = (p: { u: number; v: number }) => p.u * GEO.ux + p.v * GEO.vx;
    const sy = (p: { u: number; v: number }) => p.u * GEO.uy + p.v * GEO.vy;
    let targetFloor = this.me.f;
    let targetZoom = NEAR_ZOOM;
    let targetX = 0;
    let targetY = 0;
    if (view.enc && !walking) {
      // 向き合うのは、着いてから。その部屋を画面のまん中より少し下へ。
      targetFloor = here ? here.floor : this.me.f;
      targetZoom = ENC_ZOOM;
      targetX = sx(focusAt);
      targetY = sy(focusAt) - H * 0.14;
    } else if (this.overview || view.rooms.length === 0) {
      // 見渡す。人物を決めている間（まだ部屋が無い）も、建物を引きで見せる。
      targetFloor = (here?.floor ?? 0) - 0.3;
      targetZoom = FAR_ZOOM;
    } else {
      // 近景。寄りは枠の大きさだけで決め（床の端から端まで入る）、中身で変えない。
      // 横は、歩く人が画面の中ほどを出たぶんだけ追う。縦は、いまのフロアを上に、
      // 次のフロアが下に見えるところ。
      targetZoom = this.nearZoom();
      const x = sx(this.me);
      const dz = (this.W * 0.3) / targetZoom;
      targetX = Math.sign(x) * Math.max(0, Math.abs(x) - dz);
      targetY = -(H * 0.1) / targetZoom;
    }
    // 0.4 秒ほどで落ち着く（次の操作を待たせない）。
    const k = 1 - Math.exp(-dt * 7.5);
    this.cam.y = lerp(this.cam.y, targetY, k);
    this.cam.floor = lerp(this.cam.floor, targetFloor, k);
    this.cam.zoom = lerp(this.cam.zoom, targetZoom, k);
    this.cam.x = lerp(this.cam.x, targetX, k);
    // 演出の寄り。追いかけるカメラとは別に、描くあいだだけ掛ける。
    const base = this.cam.zoom;
    const since = t - this.kick.at;
    const kick = since >= 0 ? this.kick.amt * Math.exp(-since * 7) : 0;
    const hold = view.enc ? this.hold.amt * (1 - Math.exp(-(t - this.hold.at) * 2.2)) : 0;
    this.cam.zoom = base * (1 + kick + Math.max(0, hold));

    this.abyss(view);
    // 深いフロアから描く（上のフロアが手前に重なる）。同じ高さの隣の床が先。
    const lit = new Set(view.rooms.filter((x) => x.tower).map((x) => `${x.tower}:${x.floor}`));
    for (let f = view.floors; f >= -1; f--) {
      this.neighbors(f, lit);
      // f = -1 は区画の上の踊り場（入口に立つ場所）。
      if (f < view.floors) this.slab(view, f);
    }
    this.stairs(view, t);
    this.placed = [];
    const rooms = [...view.rooms].sort((a, b) => b.floor - a.floor);
    for (const room of rooms) this.room(view, room, t);
    this.routes(view, t);
    const scene = view.enc?.scene;
    // 寄るほど場面が立ち上がる（0 = 地図、1 = 向き合った場面）。
    const presence = clamp((this.cam.zoom - (NEAR_ZOOM + 0.1)) / (ENC_ZOOM - NEAR_ZOOM - 0.1));
    const at = view.enc ? view.rooms.find((x) => x.id === view.enc?.room) : undefined;
    const c = at ? this.center(at) : null;
    if (scene && c && presence > 0) {
      // 決着のあとは、灯りが二人のところまで絞られていく（アイリス）。
      const iris = this.hold.amt > 0 ? clamp((t - this.hold.at) / 0.7) : 0;
      lamp(this.raster, this.W, this.cam.zoom, c.x, c.y, scene, t, presence, iris);
      if (scene.stage) spotlight(this.raster, this.cam.zoom, c.x, c.y, t, presence);
    }
    this.people(view, t);
    if (scene && c && at && presence > 0.6)
      hud(this.raster, this.cam.zoom, c.x, c.y, at.kind === 'boss', scene, t);
    this.vignette(view.enc ? 0 : 1);
    if (this.ctx && this.image && this.out) {
      r.present(this.out, this.palette);
      this.ctx.putImageData(this.image, 0, 0);
    }
    this.cam.zoom = base;
  }

  /**
   * 額縁。地図の縁で床が断ち切られないように、四辺を網点で紙へ溶かす
   * （向き合った場面は灯りが縁を作るので、そのまま）。
   */
  private vignette(k: number): void {
    if (k <= 0) return;
    const r = this.raster;
    const mx = 28;
    const my = 14;
    for (let y = 0; y < H; y++) {
      const ty = 1 - Math.min(y, H - 1 - y) / my;
      for (let x = 0; x < this.W; x++) {
        const tx = 1 - Math.min(x, this.W - 1 - x) / mx;
        const t = Math.max(tx, ty) * k;
        if (t > 0 && threshold(x, y) < t) r.set(x, y, NONE);
      }
    }
  }

  /** 底。下へ行くほど墨の網点が濃くなり、何も見えなくなる。 */
  private abyss(view: TowerView): void {
    const r = this.raster;
    const bottom = this.project(0, 0, view.floors + 0.2).y;
    for (let y = Math.max(0, Math.floor(bottom - 40)); y < H; y++) {
      const tone = clamp((y - bottom + 40) / 120);
      for (let x = 0; x < this.W; x++) if (threshold(x, y) < tone * 0.9) r.set(x, y, INK);
    }
  }

  /**
   * フロアの床板。いま見ているフロアと次のフロアははっきり、遠いフロアほど
   * 塗りが薄く・縁が点線になって、底の闇に溶ける。f = -1 は区画の上（来た道）。
   */
  private slab(view: TowerView, f: number): void {
    const r = this.raster;
    const d = f - this.cam.floor;
    // 0 = いちばん遠い、1 = いま見ているあたり。
    // 区画の上（踊り場）は、入口に立っているあいだだけ、ふつうの床に見せる。
    const near = f < 0 ? (view.you === null ? 1 : 0.3) : clamp(1 - (d - 1.6) / 3.2, 0, 1);
    const { U, V } = GEO;
    const [a, b, c, e] = [
      this.project(-U, -V, f),
      this.project(U, -V, f),
      this.project(U, V, f),
      this.project(-U, V, f),
    ] as [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
    ];
    const thick = 5 * this.cam.zoom;
    const z = -f;
    // 上面：近いほど網点がしっかり、遠いほど紙に近い。
    const top = 0.95 + (1 - near) * 0.04;
    r.tri(a.x, a.y, z, b.x, b.y, z, c.x, c.y, z, top, INK, PAPER);
    r.tri(a.x, a.y, z, c.x, c.y, z, e.x, e.y, z, top, INK, PAPER);
    // 厚み（手前と右の辺）。
    const side = 0.35 + (1 - near) * 0.5;
    r.tri(e.x, e.y, z, c.x, c.y, z, c.x, c.y + thick, z, side, INK, PAPER);
    r.tri(e.x, e.y, z, c.x, c.y + thick, z, e.x, e.y + thick, z, side, INK, PAPER);
    r.tri(c.x, c.y, z, b.x, b.y, z, b.x, b.y + thick, z, side + 0.15, INK, PAPER);
    r.tri(c.x, c.y, z, b.x, b.y + thick, z, c.x, c.y + thick, z, side + 0.15, INK, PAPER);
    const dash: [number, number] | undefined =
      near > 0.7 ? undefined : near > 0.3 ? [2, 1] : [1, 2];
    for (const [s0, e0] of [
      [a, b],
      [b, c],
      [c, e],
      [e, a],
    ] as const)
      r.line(s0.x, s0.y, z, e0.x, e0.y, z, INK, false, 0, dash);
    if (f < 0 || near < 0.15) return;
    // フロアの番号（B いくつ）。床の左の縁に添える。
    const label = `B${view.top + f}`;
    const lx = Math.round(e.x - textWidth(label) - 5);
    const ly = Math.round(e.y - 3);
    if (lx > 0 && ly > 0 && ly < H - 8) drawText(r, label, lx, ly, INK);
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
      { ...wing(-1), key: '-1' },
      { ...wing(1), key: '1' },
    ];
    // 部屋のある隣の床だけ、床板として描く。ほかは本棟の床の縁が左右と奥へ
    // 続いて、点がまばらになって消える（同じ床が向こうにもある、という気配）。
    for (const p of plates)
      if (lit.has(`${p.key}:${f}`)) this.plate(p.u, p.v, f, fade, true, false);
    if (!this.closeup() && f >= 0) this.continues(f, fade);
  }

  /** 床の縁の延長。端から離れるほど点が間遠になる。 */
  private continues(f: number, fade: number): void {
    const r = this.raster;
    const { U, V } = GEO;
    const run = (u0: number, v0: number, du: number, dv: number, len: number) => {
      const a = this.project(u0, v0, f);
      const b = this.project(u0 + du * len, v0 + dv * len, f);
      const total = Math.hypot(b.x - a.x, b.y - a.y);
      // 点の間を 2, 3, 4… と広げていく（規則正しく間遠になって消える）。
      let at = 3;
      let gap = 2;
      while (at < total * fade) {
        const k = at / total;
        r.set(Math.round(a.x + (b.x - a.x) * k), Math.round(a.y + (b.y - a.y) * k), INK);
        at += gap;
        gap += 1;
      }
    };
    // 左右（u の向き）：手前と奥の縁を延ばす。
    for (const v of [-V, V]) {
      run(U, v, 1, 0, 3.2);
      run(-U, v, -1, 0, 3.2);
    }
    // 奥（v の向き）：左右の縁を延ばす。
    run(-U, -V, 0, -1, 2);
    run(U, -V, 0, -1, 2);
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
    const { U, V } = GEO;
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

  /**
   * 道の線。一つの意味に一本の線だけ（二重にしない）：
   *   階段（下へ）  細かい点線
   *   廊下（横へ）  短い破線
   *   渡り廊下      長い破線
   *   推奨の道      その線の上を琥珀で上書き（隣に並べない）
   * 端はどれも部屋の縁で切る（同じ端点を使うので、線が重なってずれない）。
   * 通り過ぎたフロアには、自分が歩いた跡だけを薄く残す。
   */
  private stairs(view: TowerView, _t: number): void {
    const r = this.raster;
    const pos = new Map(view.rooms.map((room) => [room.id, room]));
    const here = view.you !== null ? pos.get(view.you) : undefined;
    const floor = here?.floor ?? -1;
    const walked = (x: RoomView) => x.visited || x.id === view.you;
    const onRoute = this.routeEdges(view);
    // 廊下（同じフロア・同じ塔の隣どうし）。いま居るフロアと、その下だけ。
    for (const a of view.rooms) {
      if (a.floor < floor) continue;
      const b = view.rooms.find(
        (x) => x.floor === a.floor && x.tower === a.tower && x.col === a.col + 1,
      );
      if (!b || onRoute.has(`${a.id}-${b.id}`) || onRoute.has(`${b.id}-${a.id}`)) continue;
      const [p, q] = this.ends(a, b);
      r.line(p.x, p.y, 0, q.x, q.y, 0, INK, false, 0, [2, 2]);
    }
    for (const [from, to] of view.edges) {
      const a = pos.get(from);
      const b = pos.get(to);
      if (!a || !b || onRoute.has(`${from}-${to}`)) continue;
      // 先の先までは描かない（遠景の階段は、線が交差して読めなくなる）。
      if (a.floor - this.cam.floor > 2.2) continue;
      const trail = walked(a) && walked(b);
      // 通り過ぎた枝（もう選べない道）は描かない。
      if (b.floor <= floor && !trail) continue;
      const [p, q] = this.ends(a, b);
      const dash: [number, number] = a.tower !== b.tower ? [4, 2] : trail ? [1, 3] : [1, 2];
      r.line(p.x, p.y, 0, q.x, q.y, 0, INK, false, 0, dash);
    }
  }

  /** 二つの部屋を結ぶ線の端（部屋の菱形の縁で切る）。 */
  private ends(a: RoomView, b: RoomView): [{ x: number; y: number }, { x: number; y: number }] {
    const p = this.center(a);
    const q = this.center(b);
    const d = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const ux = (q.x - p.x) / d;
    const uy = (q.y - p.y) / d;
    // 部屋の台の縁までの距離（台は床と同じ向きの小さな板。遠いほど小さい）。
    const cut = (room: RoomView) => {
      const s = this.tile(room);
      return 1 / (Math.abs(ux) / s.w + Math.abs(uy) / Math.max(1, s.h)) + 1;
    };
    const ca = cut(a);
    const cb = cut(b);
    if (ca + cb >= d) return [p, q];
    return [
      { x: p.x + ux * ca, y: p.y + uy * ca },
      { x: q.x - ux * cb, y: q.y - uy * cb },
    ];
  }

  /** 推奨の道が通る線（from-to）。 */
  private routeEdges(view: TowerView): Set<string> {
    const out = new Set<string>();
    for (const route of view.routes) {
      let prev = view.you;
      for (const id of route.path) {
        if (prev !== null) out.add(`${prev}-${id}`);
        prev = id;
      }
    }
    return out;
  }

  private center(room: RoomView): { x: number; y: number } {
    const s = spot(room);
    return this.project(s.u, s.v, room.floor);
  }

  /** 部屋の台の大きさ（画面の画素。床の向きの小さな板の、横と縦の半分）。 */
  private tile(room: RoomView): { w: number; h: number } {
    const k = (room.kind === 'boss' ? 1.4 : 1) * this.cam.zoom;
    return { w: 9 * k, h: 4.5 * k };
  }

  /**
   * 部屋。床と同じ向きの小さな台と、中身の印（人・？・灯り・硬貨）。近い
   * フロアほど細かく、遠いフロアは台と点だけ（遠景を静かに保つ）。
   */
  private room(view: TowerView, room: RoomView, t: number): void {
    const r = this.raster;
    const { x, y } = this.center(room);
    const { u, v } = spot(room);
    const big = room.kind === 'boss' ? 1.4 : 1;
    const du = 0.3 * big;
    const dv = 0.24 * big;
    const [a, b, c, d] = [
      this.project(u - du, v - dv, room.floor),
      this.project(u + du, v - dv, room.floor),
      this.project(u + du, v + dv, room.floor),
      this.project(u - du, v + dv, room.floor),
    ] as [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
    ];
    const detail = this.detailed(room.floor);
    const hot = view.focus === room.id;
    // 行ける部屋は真っ白な台に琥珀の縁（網点の床から浮く）。行った部屋は沈んだ網点。
    const tone = room.reachable ? 1 : room.visited ? 0.45 : 0.97;
    const z = 10 - room.floor;
    r.tri(a.x, a.y, z, b.x, b.y, z, c.x, c.y, z, tone, INK, PAPER);
    r.tri(a.x, a.y, z, c.x, c.y, z, d.x, d.y, z, tone, INK, PAPER);
    const edge = room.reachable || hot ? AMBER : INK;
    // 行ける部屋は、外側にもう一回り、琥珀の点線が息をする（点滅より静かに目を引く）。
    if (room.reachable && Math.sin(t * 4) > -0.2) {
      const g = 0.09 * big;
      const ring = [
        this.project(u - du - g, v - dv - g, room.floor),
        this.project(u + du + g, v - dv - g, room.floor),
        this.project(u + du + g, v + dv + g, room.floor),
        this.project(u - du - g, v + dv + g, room.floor),
      ];
      for (let i = 0; i < 4; i++) {
        const p = ring[i] as { x: number; y: number };
        const q = ring[(i + 1) % 4] as { x: number; y: number };
        r.line(p.x, p.y, z, q.x, q.y, z, AMBER, false, 0, [1, 2]);
      }
    }
    const dash: [number, number] | undefined = detail || room.reachable ? undefined : [1, 1];
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, d],
      [d, a],
    ] as const)
      r.line(p.x, p.y, z, q.x, q.y, z, edge, false, 0, dash);
    if (detail) {
      if (room.stage) {
        r.set(Math.round(a.x) - 2, Math.round(y), AMBER);
        r.set(Math.round(c.x) + 2, Math.round(y), AMBER);
      }
      for (let i = 0; i < room.eps; i++)
        r.set(Math.round(d.x) + 2 + i * 2, Math.round(d.y) + 2, INK);
      if (!room.person) mark(this.raster, room.kind, x, y - 1, room.visited);
    } else if (!room.person && room.kind === 'rest') r.set(Math.round(x), Math.round(y), AMBER);
    this.placed.push({ id: room.id, x, y, z });
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
          // 下の線と同じ端点・同じ点の並びで、琥珀に塗り替える（二重にならない）。
          const [p, q] = this.ends(prev, room);
          const dash: [number, number] | undefined =
            prev.tower !== room.tower ? [4, 2] : prev.floor === room.floor ? [2, 2] : undefined;
          r.line(p.x, p.y, 20, q.x, q.y, 20, AMBER, false, 0, dash);
        }
        prev = room;
      }
      if (route.mark !== undefined) {
        const m = pos.get(route.mark);
        if (m && Math.floor(t * 2) % 2 === 0) {
          const c = this.center(m);
          ring(this.raster, c.x, c.y - 4, 9 * this.cam.zoom, AMBER);
        }
      }
    }
  }

  /** 人。丸と逆三角形。 */

  private people(view: TowerView, t: number): void {
    const zm = this.cam.zoom;
    const pos = new Map(view.rooms.map((room) => [room.id, room]));
    for (const room of view.rooms) {
      if (!room.person) continue;
      // 遠いフロアの人は描かない（近づけば見えてくる。画面を静かに保つ）。
      if (room.floor - this.cam.floor > 3.2 && room.kind !== 'boss') continue;
      const inEnc = view.enc?.room === room.id;
      const { x, y } = this.center(room);
      const far = !this.detailed(room.floor);
      // 地図の上では人を一回り大きく（誰がどこにいるかが、まず目に入るように）。
      // 相手もあなたとほとんど同じ大きさ（最後の相手だけ、わずかに大きい）。
      const k =
        (room.kind === 'boss' ? PEER_BOSS : room.over ? PEER_OVER : PEER) * zm * this.mapPeople();
      const e = view.enc;
      // 遠いフロアの人は、頭の点だけ（いる、ということだけ分かれば足りる）。
      if (!inEnc && far && room.kind !== 'boss') {
        if (!room.visited) {
          const c = room.reachable ? BLUE : INK;
          this.raster.rect(Math.round(x) - 1, Math.round(y - 6 * k), 2, 2, c);
          this.raster.set(Math.round(x), Math.round(y - 3 * k), c);
        }
        continue;
      }
      if (inEnc && e) {
        const gone = e.end && t - e.endAt > 0.3;
        if (gone && e.end === 'fall') continue;
        const hit = t - e.foeHitAt < 0.18;
        const shake = hit ? Math.sin(t * 90) * 1.5 : 0;
        figure(
          this.raster,
          x + 7 * zm + shake,
          y,
          k,
          hit ? INK : e.end === 'glow' && gone ? AMBER : BLUE,
          hit ? 'solid' : 'sparse',
          -0.4,
        );
      } else if (room.visited) figure(this.raster, x, y, k, PAPER, 'outline');
      // いま向き合える相手は深い青のまばら、まだ遠い人は墨。
      else if (room.reachable) figure(this.raster, x, y, k, BLUE, 'sparse');
      else figure(this.raster, x, y, k, INK);
      // 硬度（数字）。歯が立たない相手は、数字を墨の枠で囲む
      // （琥珀は「あなた」と「押せるもの」にだけ使う）。
      // 硬度の数字は見渡すときだけ（近景では脇の一覧と札に出ているので、絵には描かない）。
      if (room.hard !== null && !room.visited && !inEnc && !far && !this.closeup()) {
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
    // 向き合っている相手が部屋の人物でない（もう一人の灯り持ちなど）ときも、
    // 必ず相手の記号を立てる（計器だけが宙に浮かないように）。
    const e = view.enc;
    const encRoom = e ? pos.get(e.room) : undefined;
    if (e && encRoom && !encRoom.person) {
      const gone = e.end && t - e.endAt > 0.3;
      if (!(gone && e.end === 'fall')) {
        const { x, y } = this.center(encRoom);
        const hit = t - e.foeHitAt < 0.18;
        // 連鎖で受けた手は、続くほど大きく揺れる。
        const amp = 1.5 * (1 + 0.6 * (t - e.chainAt < 0.3 ? e.chain : 0));
        figure(
          this.raster,
          x + 7 * zm + (hit ? Math.sin(t * 90) * amp : 0),
          y,
          PEER * zm,
          hit ? INK : e.end === 'glow' && gone ? AMBER : BLUE,
          hit ? 'solid' : 'sparse',
          -0.4,
        );
      }
    }
    // もう一人の灯り持ち（輪郭だけ）。人のいる部屋では、反対側に立つ。
    if (view.rival !== null) {
      const room = pos.get(view.rival);
      if (room) {
        const { x, y } = this.center(room);
        const side = room.person ? -14 : 9;
        figure(this.raster, x + side * zm, y + 2, zm * this.mapPeople(), INK, true);
      }
    }
    // あなた（琥珀）。
    const here = view.enc
      ? pos.get(view.enc.room)
      : view.you !== null
        ? pos.get(view.you)
        : undefined;
    if (here) {
      const { x, y } = this.project(this.me.u, this.me.v, this.me.f);
      const e = view.enc;
      const hurt = e ? t - e.youHitAt < 0.18 : false;
      // 歩いているあいだは足取りで上下し、立ち止まると息をするだけ。
      const moving = t - this.walk.at < this.walk.dur;
      const bob = moving
        ? -Math.round(Math.abs(Math.sin((t - this.walk.at) * 16)) * 1.5)
        : Math.round(Math.sin(t * 3) * 0.6);
      // 連鎖：決まった瞬間に一歩踏み込む（続きの数は、手元の札と計器の揺れで見せる）。
      const since = e ? t - e.chainAt : 99;
      const lunge = since < 0.3 ? Math.sin((since / 0.3) * Math.PI) * 5 * zm : 0;
      // 向き合うときは、着いてから半歩脇へ寄る（相手と並ぶ）。
      const aside = e ? 7 * zm * clamp((t - this.walk.at - this.walk.dur) / 0.25) : 0;
      const fx = x - aside + lunge + (hurt ? Math.sin(t * 80) * 1.5 : 0);
      figure(
        this.raster,
        fx,
        y + bob,
        zm * this.mapPeople(),
        hurt ? INK : AMBER,
        false,
        e ? 0.4 : 0,
      );
    } else {
      // 入口（区画の上の踊り場に立つ）。
      const p = this.project(0, 0, -1);
      figure(this.raster, p.x, p.y, zm * this.mapPeople(), AMBER);
    }
  }

  // ─── 向き合った場面 ─────────────────────────────────────────

  /** 画面上の点（CSS 画素）から、その部屋を探す。 */
  pick(cssX: number, cssY: number): number | null {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = ((cssX - rect.left) / rect.width) * this.W;
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
