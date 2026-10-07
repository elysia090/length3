import type { Ev } from './events';
import { blankMind, type Mind, type World } from './model';
import type { Tag } from './tags';

/**
 * 認識世界。人物は、自分が居合わせたイベントだけから「あなた像」を作る。
 * 遭遇のなかの出来事は、その相手が見ている。あなたの心の中（判定の目、
 * 一服、品の使用）は誰も見ていない。噂は gossip のイベントで人から人へ
 * 伝わる。
 *
 * 像は観測の数で持つ（乱暴だった回数、優しかった回数…）。頭（ai）は
 * この像から「この人はこう動くだろう」と想像して、手を選ぶ。
 */

function mindOf(w: World, id: string): Mind {
  w.minds[id] ??= blankMind();
  return w.minds[id] as Mind;
}

const VIOLENT_TAGS: readonly Tag[] = ['body'];
const NOSY_TAGS: readonly Tag[] = ['gaze', 'private'];
const KIND_TAGS: readonly Tag[] = ['trust'];

/** イベントを、居合わせた者の認識に写す。apply の頭で呼ばれる。 */
export function perceive(w: World, ev: Ev): void {
  const enc = w.enc;
  // ライバルの遭遇は、ライバル自身の像を作らない（相手が見るのはライバル）。
  if (!enc || enc.who !== 'you') return;
  const witness = enc.foe.id;
  const m = mindOf(w, witness);
  switch (ev.type) {
    case 'foe':
      if (ev.by !== 'you') break;
      if (ev.field === 'hp' && ev.n < 0) m.violent += 1;
      if (ev.field === 'resolve' && ev.n < 0) m.violent += 0.5;
      if (ev.field === 'trust' && ev.n > 0) m.kind += 0.5;
      break;
    case 'card.use': {
      // 無言のカードは見られない。
      if (ev.quiet) break;
      const cards = ev.tags;
      if (cards.some((t) => VIOLENT_TAGS.includes(t))) m.violent += 0.3;
      if (cards.some((t) => NOSY_TAGS.includes(t))) m.nosy += 0.3;
      if (cards.some((t) => KIND_TAGS.includes(t))) m.kind += 0.3;
      if (!m.cards.includes(ev.card)) m.cards.push(ev.card);
      break;
    }
    case 'clue':
      if (ev.shown && !ev.false) m.nosy += 0.5;
      break;
    case 'claim':
      m.claims.push({ about: ev.about, truth: ev.truth, at: w.seq });
      break;
    case 'caught':
      m.suspicion += 1;
      m.honest = Math.max(0, m.honest - 1);
      m.claims = m.claims.filter((c) => c.about !== ev.about);
      break;
    case 'enc.end':
      m.met += 1;
      m.outcomes[ev.outcome] = (m.outcomes[ev.outcome] ?? 0) + 1;
      if (ev.outcome === 'trusted') m.trust += 1;
      if (ev.outcome === 'beaten' || ev.outcome === 'broken') m.grudge += 1;
      if (enc.caught === 0 && enc.lies === 0) m.honest += 0.5;
      break;
    default:
      break;
  }
}

/** 像の要約（0..1）。観測が少なければ真ん中に寄る。 */
export function portrait(m: Mind | undefined) {
  const n = (x: number) => x / (x + 2);
  if (!m) return { violent: 0, kind: 0, nosy: 0, honest: 0.5, suspicion: 0, known: 0 };
  return {
    violent: n(m.violent),
    kind: n(m.kind),
    nosy: n(m.nosy),
    honest: (m.honest + 1) / (m.honest + m.suspicion + 2),
    suspicion: n(m.suspicion),
    known: m.met + m.heard,
  };
}

/** この人が、いまあなたについて信じている主張。 */
export const believes = (m: Mind | undefined, about: string) => !!m?.claims.some((c) => c.about === about);
