import type { Ev } from './events';
import type { Stream, Who, World } from './model';
import { apply } from './reduce';
import { next } from './rng';
import { bookOf, evaluate, type RuleCtx, type RuleName, type Rulebook } from './rules';

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

  constructor(
    readonly w: World,
    /** 頭の試行（イベントは畳み込むが、画面には出さない）。 */
    readonly sim = false,
  ) {}

  emit(ev: Ev): void {
    apply(this.w, ev);
    this.out.push(ev);
    if (REBUILD.has(ev.type)) this.book = null;
    if (this.depth > 6) return;
    const triggers = this.rules().triggers[ev.type];
    if (!triggers) return;
    this.depth++;
    for (const t of triggers) if (!t.when || t.when(ev, this.w)) t.run(this, ev);
    this.depth--;
  }

  rules(): Rulebook {
    this.book ??= bookOf(this.w);
    return this.book;
  }

  rule(name: RuleName, ctx: Partial<RuleCtx> & { who?: Who }, base: number): number {
    return evaluate(this.rules(), name, { w: this.w, who: 'you', enc: this.w.enc, ...ctx }, base);
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

/** 規則の出どころが変わるイベント（集め直す）。 */
const REBUILD = new Set<Ev['type']>([
  'card.set',
  'card.ep',
  'perm',
  'perm.ep',
  'build',
  'enc.start',
  'enc.close',
  'run.started',
  'map.built',
  'time',
  'moved',
  'pending',
]);
