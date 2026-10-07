import type { Cmd } from '../core/events';
import type { World } from '../core/model';
import { bestAction } from './ai';
import { canChoose, reachable } from './run';

/**
 * 自動操縦。あなたの席に座る頭（ライバルと同じ 1 手読み）に、地図の上の
 * 簡単な好みを足したもの。テストと釣り合いの試算、それと「おまかせ」に使う。
 */
export function pilot(w: World): Cmd | null {
  if (w.ending) return null;
  const e = w.enc;
  if (e) {
    if (e.phase === 'over') return { c: 'close' };
    const a = bestAction(w);
    return a.kind === 'basic' ? { c: 'act', a: a.a } : { c: 'card', slot: a.slot };
  }
  const p = w.pending;
  if (p) {
    switch (p.kind) {
      case 'reward': {
        let help: number | undefined;
        if (p.help) {
          let low = 1;
          w.you.cards.forEach((c, i) => {
            if (c && c.uses / c.max < low) {
              low = c.uses / c.max;
              help = i;
            }
          });
        }
        return { c: 'claim', take: p.take[0], help };
      }
      case 'story': {
        for (let i = 0; i < 6; i++) if (canChoose(w, i)) return { c: 'choose', option: i };
        return { c: 'choose', option: 0 };
      }
      case 'rest':
        return p.used ? { c: 'depart' } : { c: 'rest', action: 'rest' };
      case 'told':
      case 'shop':
        return { c: 'depart' };
      default:
        return null;
    }
  }
  const next = reachable(w);
  if (!next.length) return null;
  const tired = w.you.hp < 12 || w.you.cards.filter((c) => c && c.uses === 0).length >= 2;
  const want = (k: string) => (k === 'rest' ? (tired ? 5 : 0) : k === 'event' ? 3 : k === 'person' ? 2 : k === 'shop' ? 1 : 1.5);
  const best = next.reduce((a, b) => (want(b.kind) > want(a.kind) ? b : a));
  return { c: 'move', node: best.id };
}
