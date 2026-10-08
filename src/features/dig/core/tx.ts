import type { Ev } from './events';
import type { Stream, Who, World } from './model';
import { apply } from './reduce';
import { next } from './rng';
import { bookOf, evaluate, type Rulebook, type RuleCtx, type RuleName } from './rules';

/**
 * ひとつのコマンドを処理する取引。emit したイベントはその場で世界に
 * 畳み込まれ（あとの計算は新しい世界を見る）、記録に積まれ、トリガを
 * 起こす。乱数は用途ごとの流れから引き、最後に rng のイベントとして
 * 書き残す（イベント列だけで世界を作り直せるように）。
 */
export class Tx {
  readonly out: Ev[] = [];
  private dirty = new Set<Stream>();
  private depth = 0;
  private book: Rulebook | null = null;
  /** 渡すと、効いた規則とトリガの出どころを数える（ルート読み用）。 */
  trace: Map<string, number> | null = null;
  /** この遭遇で値を動かした、構成の出どころ（共鳴）。flush で遭遇に書く。 */
  private res = new Set<string>();

  constructor(
    readonly w: World,
    /** 頭の試行（イベントは畳み込むが、画面には出さない）。 */
    readonly sim = false,
  ) {}

  emit(ev: Ev): void {
    apply(this.w, ev);
    this.out.push(ev);
    if (REBUILD.has(ev.type) || (ev.type === 'card.mark' && ev.mark === 'ch')) this.book = null;
    if (this.depth > 6) return;
    const triggers = this.rules().triggers[ev.type];
    if (!triggers) return;
    this.depth++;
    for (const t of triggers) {
      if (t.when && !t.when(ev, this.w)) continue;
      this.mark(t.source);
      t.run(this, ev);
    }
    this.depth--;
  }

  rules(): Rulebook {
    this.book ??= bookOf(this.w);
    return this.book;
  }

  rule(name: RuleName, ctx: Partial<RuleCtx> & { who?: Who }, base: number): number {
    return evaluate(
      this.rules(),
      name,
      { w: this.w, who: 'you', enc: this.w.enc, ...ctx },
      base,
      (p) => this.mark(p.source),
    );
  }

  private mark(source: string): void {
    if (this.trace) this.trace.set(source, (this.trace.get(source) ?? 0) + 1);
    if (this.w.enc && RESONANT.test(source)) this.res.add(source);
  }

  /** 共鳴した出どころを、遭遇の状態として記録する（イベントになる）。 */
  flush(): void {
    const e = this.w.enc;
    const list = [...this.res];
    this.res.clear();
    if (!e) return;
    for (const src of list)
      if (!e.st[`r:${src}`]) this.emit({ type: 'enc.st', key: `r:${src}`, n: 1 });
  }

  /** 0 以上 1 未満。用途ごとの流れから。 */
  rand(stream: Stream): number {
    const r = { s: this.w.rng[stream] };
    const v = next(r);
    this.w.rng[stream] = r.s;
    this.dirty.add(stream);
    return v;
  }

  int(stream: Stream, lo: number, hi: number): number {
    return lo + Math.floor(this.rand(stream) * (hi - lo + 1));
  }

  /**
   * 混ぜる（Fisher–Yates）。並べ替えに乱数の比較を渡すと、比較の回数がエンジン
   * ごとに違って結果がずれる（記録の再生が端末で変わる）ので、必ずこちらで。
   */
  shuffle<T>(stream: Stream, list: readonly T[]): T[] {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand(stream) * (i + 1));
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  }

  pick<T>(stream: Stream, list: readonly T[]): T | undefined {
    return list.length ? list[Math.floor(this.rand(stream) * list.length)] : undefined;
  }

  /** 引いた乱数の状態を、イベントとして残す。 */
  close(): Ev[] {
    if (this.dirty.size) {
      const s: Partial<Record<Stream, number>> = {};
      for (const k of this.dirty) s[k] = this.w.rng[k];
      this.dirty.clear();
      const ev: Ev = { type: 'rng', s };
      apply(this.w, ev);
      this.out.push(ev);
    }
    return this.out;
  }
}

/** 共鳴に数える出どころ（構成から来たもの。基本の規則・深さ・版・職は数えない）。 */
const RESONANT = /^(card|perm|build|link|arch|ep|stage|surge):/;

/** 規則の出どころが変わるイベント（集め直す）。 */
const REBUILD = new Set<Ev['type']>([
  'card.set',
  'card.ep',
  'perm',
  'perm.ep',
  'enc.start',
  'enc.close',
  'run.started',
  'map.built',
  'time',
  'moved',
  'pending',
]);
