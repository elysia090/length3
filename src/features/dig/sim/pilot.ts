import { gearOf } from '../content/gear';
import { cardDef, epithetDef } from '../content/registry';
import { archSetsOf, buildsOf, linksOf } from '../content/sources';
import type { Cmd } from '../core/events';
import type { Char, World } from '../core/model';
import { advise, type RouteKind } from './advise';
import { bestAction } from './ai';
import { maxHp, stats } from './ops';
import {
  breathed,
  canChoose,
  cardPrice,
  deckRoom,
  epPrice,
  ITEM_CAP,
  isBridge,
  isHall,
  reachable,
} from './run';

/**
 * 自動操縦。あなたの席に座る頭（ライバルと同じ 1 手読み）に、地図の上の
 * 簡単な好みを足したもの。テストと釣り合いの試算、それと「おまかせ」に使う。
 */
export function pilot(w: World): Cmd | null {
  if (w.ending) return null;
  const e = w.enc;
  if (e) {
    if (e.phase === 'over') return { c: 'close' };
    // 持ち物は手番を使わない。一手に一つ、効きそうなものを先に使う。
    const item = useful(w);
    if (item !== null) return { c: 'item', index: item };
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
        const pick = pickCard(w, p.cards);
        const tool = !pick && w.you.items.length < ITEM_CAP ? p.tools[0] : undefined;
        return { c: 'claim', take: p.take[0], help, card: pick ?? undefined, tool };
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
      case 'summit':
        // 試しの遊び手は、抜けたらそこで灯りを置く（測る挑戦の長さをそろえる）。
        return { c: 'onward', go: false };
      default:
        return null;
    }
  }
  // 抜けたあと、最後の相手から二度退いたら、そこで灯りを置く。
  if (w.flags.cleared && (w.flags[`retreat:${w.stratum}`] ?? 0) >= 2)
    return { c: 'onward', go: false };
  const ins = inscription(w);
  if (ins) return ins;
  const all = reachable(w);
  if (!all.length) return null;
  // 締め切りはないので、時間の余裕はいつもある（廊下も渡り廊下も選べる）。
  const slack = 99;
  // 廊下は夜に余裕があるときだけ。渡り廊下は回り道のぶん（2 時間）余裕が要る。
  const roomy = all.filter((n) =>
    isBridge(w, n) && w.pos !== null ? slack >= 3 : isHall(w, n) ? slack >= 1 : true,
  );
  const next = roomy.length ? roomy : all;
  // 傷んでいて、食堂に行けず、夜にまだ余裕があるなら、その場で一服。
  if (
    w.you.hp * 2 < maxHp(stats(w, 'you')) &&
    !next.some((n) => n.kind === 'rest') &&
    slack >= 1 &&
    !breathed(w)
  )
    return { c: 'breather' };
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
  let best: Cmd | null = null;
  let gain = 9;
  for (const id of p.cards) {
    if (p.sold.includes(id) || cardPrice(w, id) > w.you.coins || !deckRoom(w.you)) continue;
    // 後ろに入る札は構成を変えないので、余地があれば一枚だけ買う。
    if (gain < 10) {
      gain = 10;
      best = { c: 'buy', id };
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
    const cards = [...you.cards];
    cards[slot] = { ...card, eps: [...card.eps, ep] };
    const c = { ...you, cards };
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

/** 拾う札を選ぶ。持てる余地があれば、回数の多い札を。いっぱいなら拾わない。 */
function pickCard(w: World, offer: readonly string[]): string | null {
  if (!deckRoom(w.you) && w.you.cards.every(Boolean)) return null;
  let best: string | null = null;
  let most = -1;
  for (const id of offer) {
    const n = cardDef(id).uses;
    if (n > most) {
      most = n;
      best = id;
    }
  }
  return best;
}

/** 向き合っているあいだに使う持ち物（体が細ければ癒やすもの、あとは効き目のあるもの）。 */
function useful(w: World): number | null {
  const e = w.enc;
  if (!e || e.who !== 'you' || e.phase !== 'act' || e.st[`item:${e.turn}`]) return null;
  const low = w.you.hp * 2 < maxHp(stats(w, 'you'));
  let at: number | null = null;
  w.you.items.forEach((it, i) => {
    if (at !== null) return;
    const g = gearOf(it.id);
    if (!g) return;
    if (g.heal?.hp && low) at = i;
    else if (g.fx?.some((f) => ['hit', 'break', 'trust', 'clue', 'stun', 'cut'].includes(f[0])))
      at = i;
  });
  return at;
}
