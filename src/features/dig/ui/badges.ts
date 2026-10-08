import type { Fx } from '../content/fx';

/**
 * 札の目当て（読まずに分かる印）。効き目の並びから、その札が四つの決着の道の
 * どれを押すのか、守るのか、癒やすのかを拾う。条件や判定の中の効き目も数える。
 * 名前は遭遇の脇の「四つの道」と同じ言葉にそろえる。
 */
export type Badge = 'down' | 'break' | 'trust' | 'expose' | 'guard' | 'heal' | 'coin' | 'leave';

export const BADGE_NAME: Readonly<Record<Badge, string>> = {
  down: '倒す',
  break: '折る',
  trust: '打ち解ける',
  expose: '暴く',
  guard: '守る',
  heal: '癒す',
  coin: '金',
  leave: '去る',
};

const ORDER: readonly Badge[] = [
  'down',
  'break',
  'trust',
  'expose',
  'guard',
  'heal',
  'coin',
  'leave',
];

function collect(list: readonly Fx[], out: Set<Badge>): void {
  for (const f of list) {
    switch (f[0]) {
      case 'hit':
        out.add('down');
        break;
      case 'break':
        out.add('break');
        break;
      case 'trust':
      case 'lie':
        out.add('trust');
        break;
      case 'clue':
        out.add('expose');
        break;
      case 'guard':
      case 'calm':
      case 'cut':
        out.add('guard');
        break;
      case 'heal':
        out.add('heal');
        break;
      case 'coins':
        if (f[1] > 0) out.add('coin');
        break;
      case 'leave':
        out.add('leave');
        break;
      case 'check':
        collect(f[3], out);
        if (f[4]) collect(f[4], out);
        break;
      case 'if':
        collect(f[2], out);
        if (f[3]) collect(f[3], out);
        break;
      default:
        break;
    }
  }
}

/** 札の目当て（多くても三つ。決着の道を先に）。 */
export function badgesOf(list: readonly Fx[]): Badge[] {
  const out = new Set<Badge>();
  collect(list, out);
  return ORDER.filter((b) => out.has(b)).slice(0, 3);
}
