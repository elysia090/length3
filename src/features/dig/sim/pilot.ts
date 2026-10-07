import { epithetDef } from '../content/registry';
import { archSetsOf, buildsOf, linksOf } from '../content/sources';
import type { Cmd } from '../core/events';
import type { Char, World } from '../core/model';
import { advise, type RouteKind } from './advise';
import { bestAction } from './ai';
import { canChoose, cardPrice, epPrice, newCard, reachable } from './run';

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
      case 'shop':
        return shopping(w) ?? { c: 'depart' };
      case 'told':
        return { c: 'depart' };
      default:
        return null;
    }
  }
  const ins = inscription(w);
  if (ins) return ins;
  const next = reachable(w);
  if (!next.length) return null;
  const tired = w.you.hp < 12 || w.you.cards.filter((c) => c && c.uses === 0).length >= 2;
  const want = (k: string) =>
    k === 'rest'
      ? tired
        ? 5
        : 0
      : k === 'event'
        ? 3
        : k === 'person'
          ? 2
          : k === 'shop'
            ? 1
            : 1.5;
  const best = next.reduce((a, b) => (want(b.kind) > want(a.kind) ? b : a));
  return { c: 'move', node: best.id };
}

/**
 * ルートの性格を決めて歩く自動操縦（釣り合いの試算用）。地図の上では助言の
 * うち指定の性格の道を一歩進み、それ以外は pilot と同じ。指定の性格の道が
 * 出ていなければ、安定の道を歩く。
 */
export function routePilot(w: World, kind: RouteKind): Cmd | null {
  if (w.enc || w.pending || w.ending) return pilot(w);
  const a = advise(w, { samples: 1 });
  const all = [...(a?.win ?? []), ...(a?.play ?? [])];
  const r = all.find((x) => x.kind === kind) ?? all.find((x) => x.kind === 'safe');
  const id = r?.path[0];
  return id === undefined ? pilot(w) : { c: 'move', node: id };
}

/** 構成の値打ち（ビルド・連携・原型の重なり）。買い物と刻みの判断に使う。 */
export function deckScore(c: Char): number {
  return buildsOf(c).length * 30 + linksOf(c).length * 10 + archSetsOf(c).length * 5;
}

function shopping(w: World): Cmd | null {
  const p = w.pending;
  if (p?.kind !== 'shop') return null;
  const base = deckScore(w.you);
  let best: Cmd | null = null;
  let gain = 9;
  for (const id of p.cards) {
    if (p.sold.includes(id) || cardPrice(w, id) > w.you.coins) continue;
    for (let slot = 0; slot < 5; slot++) {
      const c = structuredClone(w.you);
      c.cards[slot] = newCard(0, id);
      const g = deckScore(c) - base;
      if (g > gain) {
        gain = g;
        best = { c: 'buy', id, slot };
      }
    }
  }
  for (const it of p.items) {
    if (!it.startsWith('ep:') || p.sold.includes(it) || epPrice(w, it.slice(3)) > w.you.coins)
      continue;
    const g = bestInscription(w.you, it.slice(3))?.gain ?? 0;
    if (g > gain) {
      gain = g;
      best = { c: 'buy', id: it };
    }
  }
  return best;
}

function bestInscription(you: Char, ep: string): { slot: number; gain: number } | null {
  if (!epithetDef(ep)?.card) return null;
  const base = deckScore(you);
  let out: { slot: number; gain: number } | null = null;
  you.cards.forEach((card, slot) => {
    if (!card || card.eps.length >= 2 || card.eps.includes(ep)) return;
    const c = structuredClone(you);
    c.cards[slot]?.eps.push(ep);
    const g = deckScore(c) - base;
    if (g > 0 && (!out || g > out.gain)) out = { slot, gain: g };
  });
  return out;
}

function inscription(w: World): Cmd | null {
  for (const ep of w.you.epithets) {
    const b = bestInscription(w.you, ep);
    if (b) return { c: 'inscribe', ep, slot: b.slot };
  }
  return null;
}
