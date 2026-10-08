import { DATA_VERSION } from '../content/balance';
import type { Cmd, Ev } from '../core/events';
import type { World } from '../core/model';
import { emptyWorld, fold, hashWorld } from '../core/reduce';
import { bookOf } from '../core/rules';
import { decide } from './decide';

/**
 * 外から見た遊び。持つのは三つだけ。
 *   cmds    指したコマンドの列（保存はこれと版だけ。seed は最初の start に入っている）
 *   events  起きたことの列（世界はこれを畳み込んだもの）
 *   world   いまの世界（events の畳み込みと、いつも同じ指紋）
 * 読み込みはコマンドを指し直すだけ。同じ版なら、同じ夜がもう一度起きる。
 */

export interface Save {
  v: string;
  cmds: Cmd[];
}

export interface RunStats {
  turns: number;
  cards: number;
  spent: number;
  quiet: number;
  lies: number;
  caught: number;
  clues: number;
  gossip: number;
  alters: number;
  hours: number;
  outcomes: Record<string, number>;
  used: Record<string, number>;
}

export class Game {
  readonly world: World = emptyWorld();
  readonly events: Ev[] = [];
  readonly cmds: Cmd[] = [];

  /** 指す。断られたら空の列。 */
  /** why を渡すと、値を動かした規則を書き留める（画面のため。結果は変わらない）。 */
  dispatch(cmd: Cmd, why?: { src: string; text: string; at: number }[]): Ev[] {
    const out = decide(this.world, cmd, why ? { why } : {});
    if (!out.length) return out;
    this.cmds.push(cmd);
    for (const ev of out) this.events.push(ev);
    return out;
  }

  save(): Save {
    return { v: DATA_VERSION, cmds: structuredClone(this.cmds) };
  }

  /** 指し直す。版が違えば null（規則が変わると、同じ夜にはならない）。 */
  static load(s: Save): Game | null {
    if (s.v !== DATA_VERSION) return null;
    const g = new Game();
    for (const c of s.cmds) if (!g.dispatch(c).length) return null;
    return g;
  }

  static start(
    seed: number,
    job: string,
    depth = 0,
    extra: Partial<Extract<Cmd, { c: 'start' }>> = {},
  ): Game {
    const g = new Game();
    g.dispatch({ ...extra, c: 'start', seed: seed >>> 0, job, depth });
    return g;
  }

  /** イベント列だけから作った世界と、いまの世界が同じか。 */
  verify(): boolean {
    return hashWorld(fold(this.events)) === hashWorld(this.world);
  }

  hash(): string {
    return hashWorld(this.world);
  }

  /** いま効いている規則（出どころつき）。 */
  patches(): { source: string; text: string }[] {
    const b = bookOf(this.world);
    return [...b.all.patches, ...b.all.triggers]
      .filter((p) => p.text)
      .map((p) => ({ source: p.source, text: p.text }));
  }

  stats(): RunStats {
    return statsOf(this.events);
  }
}

/** プレイヤー統計。イベント列の射影。 */
export function statsOf(events: readonly Ev[]): RunStats {
  const s: RunStats = {
    turns: 0,
    cards: 0,
    spent: 0,
    quiet: 0,
    lies: 0,
    caught: 0,
    clues: 0,
    gossip: 0,
    alters: 0,
    hours: 0,
    outcomes: {},
    used: {},
  };
  for (const ev of events) {
    switch (ev.type) {
      case 'turn':
        s.turns++;
        break;
      case 'card.use':
        if (ev.who !== 'you') break;
        s.cards++;
        if (ev.spent) s.spent++;
        if (ev.quiet) s.quiet++;
        s.used[ev.card] = (s.used[ev.card] ?? 0) + 1;
        break;
      case 'claim':
        if (!ev.truth) s.lies++;
        break;
      case 'caught':
        s.caught++;
        break;
      case 'clue':
        if (ev.shown) s.clues++;
        break;
      case 'gossip':
        s.gossip++;
        break;
      case 'card.set':
        if (ev.why === 'alter' || ev.why === 'care' || ev.why === 'overuse') s.alters++;
        break;
      case 'time':
        if (ev.hours > 0) s.hours += ev.hours;
        break;
      case 'enc.end':
        s.outcomes[ev.outcome] = (s.outcomes[ev.outcome] ?? 0) + 1;
        break;
      default:
        break;
    }
  }
  return s;
}
