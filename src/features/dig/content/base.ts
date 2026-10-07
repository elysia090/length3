import type { Tag } from '../core/tags';
import { believes } from '../core/mind';
import { hostile, say } from '../sim/ops';
import type { PassiveSpec, TriggerSpec } from './defs';
import { ANSWERS } from './archetypes';
import { foeDef, permDef } from './registry';

/**
 * いつもかかっている規則（素の規則の上の、最初のパッチ）。
 *
 *   弱点と守り  相手の弱いタグを持つカードは ×1.5、守っているタグなら ×0.6
 *   攻め筋      見えている手がかり（相手の記憶）が、押す・話す・威圧・嘘を変える
 *   夜          深夜ほど相手は荒れている
 *   深さ        深いほど相手は荒れ、去りにくい
 */
const overlap = (a: readonly Tag[] | undefined, b: readonly Tag[]) => !!a?.some((t) => b.includes(t));

function exploit(key: 'press' | 'talk' | 'force' | 'lie') {
  return (c: { enc?: { foe: { clues: { id: string; shown: boolean; false?: boolean }[] } } | null }) => {
    let m = 1;
    for (const x of c.enc?.foe.clues ?? []) {
      if (!x.shown || x.false) continue;
      m *= permDef(x.id)?.exploit?.[key] ?? 1;
    }
    return m;
  };
}

export const BASE_RULES: readonly PassiveSpec[] = [
  {
    rule: 'mult',
    prio: -10,
    when: (c) => !!c.enc && overlap(c.tags, foeDef(c.enc.foe.id).weak),
    fn: (_c, v) => v * 1.5,
    text: '相手の弱いタグ ×1.5',
  },
  {
    rule: 'mult',
    prio: -10,
    when: (c) => !!c.enc && overlap(c.tags, foeDef(c.enc.foe.id).guarded),
    fn: (_c, v) => v * 0.6,
    text: '相手の守るタグ ×0.6',
  },
  {
    rule: 'mult',
    prio: -10,
    when: (c) => !!c.enc && !!c.arch?.some((a) => (foeDef(c.enc?.foe.id ?? '').arch ?? []).some((f) => ANSWERS[f].includes(a))),
    fn: (_c, v) => v * 1.4,
    text: '原型が相手の原型に答える ×1.4',
  },
  { rule: 'hit', prio: -10, fn: (c, v) => v * exploit('press')(c), text: '手がかりの攻め筋（押す）' },
  { rule: 'break', prio: -10, fn: (c, v) => v * exploit('force')(c), text: '手がかりの攻め筋（威圧）' },
  { rule: 'trust', prio: -10, fn: (c, v) => (v > 0 ? v * exploit('talk')(c) : v), text: '手がかりの攻め筋（話す）' },
  { rule: 'lieChance', prio: -10, fn: (c, v) => v * exploit('lie')(c), text: '手がかりの攻め筋（嘘）' },
  {
    rule: 'startHostility',
    prio: -10,
    fn: (c, v) => v + Math.max(0, c.w.hour - 3) / 2 + c.w.depth / 3,
    text: '夜が深いほど、深いほど荒れている',
  },
  {
    rule: 'leaveChance',
    prio: -10,
    fn: (c, v) => (v >= 100 ? v : v - 3 * c.w.depth),
    text: '深いほど去りにくい',
  },
];

/** 深さ（難しさの段）。段を上がるごとに一つずつ重なる。 */
export const DEPTH_RULES: readonly { at: number; spec: PassiveSpec }[] = [
  { at: 1, spec: { rule: 'startHostility', fn: (_c, v) => v + 1, text: '深さ 1：相手は初めから荒れている（+1）' } },
  { at: 2, spec: { rule: 'strikeTaken', fn: (_c, v) => (v > 0 ? v + 1 : v), text: '深さ 2：受ける傷 +1' } },
  { at: 3, spec: { rule: 'restHeal', fn: (_c, v) => Math.round(v * 0.8), text: '深さ 3：休んでも 2 割少ない' } },
  { at: 4, spec: { rule: 'price', fn: (_c, v) => Math.round(v * 1.2), text: '深さ 4：値段 ×1.2' } },
  { at: 6, spec: { rule: 'threatTaken', fn: (_c, v) => (v > 0 ? v + 1 : v), text: '深さ 6：精神への傷 +1' } },
  { at: 7, spec: { rule: 'falseChance', fn: (_c, v) => v + 10, text: '深さ 7：誤った手がかり +10%' } },
  { at: 8, spec: { rule: 'leaveChance', fn: (_c, v) => (v >= 100 ? v : v - 10), text: '深さ 8：去る −10%' } },
];

/**
 * いつも働く反応。主張と矛盾する行動を見られると、露見する。
 * 「手は出さない」と言ってから殴れば、嘘でも本当の誓いでも、ばれる。
 */
export const BASE_TRIGGERS: readonly TriggerSpec[] = [
  {
    on: 'foe',
    when: (ev, w) =>
      ev.type === 'foe' &&
      ev.field === 'hp' &&
      ev.n < 0 &&
      ev.by === 'you' &&
      w.enc?.who === 'you' &&
      believes(w.minds[w.enc.foe.id], 'harmless'),
    run: (tx) => {
      tx.emit({ type: 'caught', about: 'harmless' });
      say(tx, 'foe', '……手は出さないと言ったな。');
      hostile(tx, 3);
    },
    text: '「手は出さない」と言ってから殴ると、露見する',
  },
];
