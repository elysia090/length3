import { PACE } from '../content/balance';
import { type Gear, gearOf } from '../content/gear';
import { orderOf } from '../content/orders';
import { cardDef, epithetDef } from '../content/registry';
import type { Cmd } from '../core/events';
import type { Card, MapNode, World } from '../core/model';
import type { Route } from '../sim/advise';
import { nodeOf } from '../sim/run';
import type { SpotAction } from '../sim/spot';
import { h } from './dom';
import { whoOf } from './words';

/** 道の読みの欄：道の中身の表、その場での箱の並び（隠し順序・道に効くか）、付け替えと刻む先の箱。 */

/**
 * 選んだ道の中身を、文ではなく見出しつきの短い行で（道・見込み・繋がる・
 * 足りない・拾える・危うい）。噛み合う相互作用の一覧は、触れると出る。
 */
export function routeFacts(w: World, r: Route): HTMLElement {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const names = r.path.map((id) => nodeOf(w, id)).flatMap((n) => (n ? [whoOf(n)] : []));
  const rows: [string, string, boolean][] = [
    ['道', `${names.slice(0, 4).join(' → ')}${names.length > 4 ? ' …' : ''}`, false],
    ['見込み', `抜ける ${pct(r.survive)}・着いて体力 ${pct(r.hpEnd)}`, r.survive < 0.7],
  ];
  const lean = r.lean
    .map((u) => w.you.cards.find((c) => c?.uid === u))
    .flatMap((c) => (c ? [`『${cardDef(c.id).name}』`] : []));
  if (lean.length) rows.push(['頼る札', lean.join(''), false]);
  if (r.gets?.length) rows.push(['繋がる', r.gets.join('・'), false]);
  const warn = r.warn.filter((x) => !x.startsWith('倒れる見込み'));
  if (warn.length) rows.push(['危うい', warn.join('。'), true]);
  return h(
    'dl',
    {
      class: `dig-route dig-route--${r.kind}`,
      title: r.links.length ? `噛み合う相互作用：${r.links.join(' × ')}` : '',
    },
    rows.flatMap(([k, v, hot]) => [h('dt', { class: hot ? 'is-hot' : '' }, k), h('dd', {}, v)]),
  );
}

/** 道の付け替え（剥がして刻む）を、その場での一箱に。 */
export function inkRow(w: World, route: Route | undefined): (SpotAction & { peel?: Cmd }) | null {
  const k = route?.ink;
  if (!k) return null;
  const all = [...w.you.cards.filter((c): c is Card => !!c), ...w.you.back];
  const to = all.find((c) => c.uid === k.to);
  const from = k.from !== undefined ? all.find((c) => c.uid === k.from) : undefined;
  const ep = epithetDef(k.ep);
  if (!to || !ep || (k.from !== undefined && !from?.eps.includes(k.ep))) return null;
  if (k.from === undefined && !w.you.epithets.includes(k.ep)) return null;
  return {
    id: `ink:${k.ep}:${k.to}`,
    cmd: { c: 'inscribe', ep: k.ep, uid: k.to },
    peel: from ? { c: 'peel', uid: from.uid, ep: k.ep } : undefined,
    label: `《${ep.name}》を『${cardDef(to.id).name}』へ`,
    gain: `${from ? `『${cardDef(from.id).name}』から剥がして・` : '手元から・'}${k.why}`,
    kind: 'ink',
    score: 99,
  };
}

/** 道の先へ刻む（この道で出会う相手か、寄る部屋へ）を、その場での一箱に。 */
export function markRow(w: World, route: Route | undefined): (SpotAction & { peel?: Cmd }) | null {
  const m = route?.mark;
  if (!m) return null;
  const n = nodeOf(w, m.node);
  const ep = epithetDef(m.ep);
  const all = [...w.you.cards.filter((c): c is Card => !!c), ...w.you.back];
  const from = m.from !== undefined ? all.find((c) => c.uid === m.from) : undefined;
  if (!n || !ep || n.visited || n.eps.includes(m.ep)) return null;
  if (m.from !== undefined ? !from?.eps.includes(m.ep) : !w.you.epithets.includes(m.ep))
    return null;
  return {
    id: `mark:${m.ep}:${m.node}`,
    cmd: { c: 'inscribe', ep: m.ep, node: m.node },
    peel: from ? { c: 'peel', uid: from.uid, ep: m.ep } : undefined,
    label: `《${ep.name}》を${whoOf(n)}へ`,
    gain: `${from ? `『${cardDef(from.id).name}』から剥がして・` : '手元から・'}道の先に刻む・${m.why}`,
    kind: 'ink',
    score: 98,
  };
}

export function spotFits(
  a: SpotAction,
  toward: number | undefined,
  route: Route | undefined,
): boolean {
  if (toward === undefined) return false;
  if (a.kind === 'prep') return true;
  if (!route) return false;
  if (a.kind === 'fill') return a.card !== undefined && route.wear.includes(a.card);
  if (a.kind === 'rest') return !!a.hp && (route.hpEnd < 0.6 || route.survive < 0.85);
  return false;
}

/** 箱の品（一服なら null、品でなければ undefined）。 */
export const spotGear = (a: SpotAction): Gear | null | undefined =>
  a.id === 'breather' ? null : a.id.startsWith('item:') ? gearOf(a.id.slice(5)) : undefined;

export const pairOrder = (x: SpotAction, y: SpotAction) => {
  const gx = spotGear(x);
  const gy = spotGear(y);
  return gx === undefined || gy === undefined ? undefined : orderOf(gx, gy);
};

/**
 * 道の手順の並び：隠し順序が効くように並べ替える（前に置くべきものを前へ、続けて
 * 効くものを直後へ）。代償つきの品は最後に（使わずに進む余地を残す）。
 */
export function inOrder<T extends { a: SpotAction }>(list: readonly T[]): T[] {
  const rest = [...list].sort((x, y) => Number(!!x.a.cost) - Number(!!y.a.cost));
  const out: T[] = [];
  while (rest.length) {
    const head = rest[0] as T;
    const lead = rest.findIndex((x) => x !== head && !!pairOrder(x.a, head.a));
    let cur = rest.splice(lead >= 0 ? lead : 0, 1)[0] as T;
    out.push(cur);
    for (;;) {
      const j = rest.findIndex((y) => !!pairOrder(cur.a, y.a));
      if (j < 0) break;
      cur = rest.splice(j, 1)[0] as T;
      out.push(cur);
    }
  }
  return out;
}

/** いま向き合っている相手に、そのエピテットを刻めるか。 */
export function foeInkable(w: World, ep: string): boolean {
  const e = w.enc;
  return (
    !!e &&
    e.phase === 'act' &&
    e.who === 'you' &&
    !!epithetDef(ep)?.foe &&
    (e.st.inked ?? 0) < PACE.inkEnc &&
    e.foe.eps.length < PACE.stackFoe
  );
}

/** その部屋に、そのエピテットを刻めるか（先の部屋、二つまで）。 */
export function nodeInkable(w: World, ep: string, n: MapNode): boolean {
  const d = epithetDef(ep);
  const here = nodeOf(w, w.pos)?.row ?? -1;
  return (
    !w.enc &&
    !n.visited &&
    n.row > here &&
    !!(n.npc ? d?.foe : d?.place) &&
    n.eps.length < PACE.stack
  );
}
