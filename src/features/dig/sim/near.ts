import { ARCH_SETS } from '../content/archetypes';
import { archCount, tagCount } from '../content/cardinfo';
import { allBuilds, allCombos, allLinks } from '../content/registry';
import { buildNeed, buildsOf } from '../content/sources';
import type { World } from '../core/model';
import { ARCH_NAME, type Archetype, type Tag } from '../core/tags';

/**
 * あと一つ。ビルド・記憶の組み合わせ・連携・原型の重なりのうち、あと 1 要素で
 * 成立するもの。ルート読みが「寄り道の理由」として示し、古物商は聞きつけて
 * それに近いものを仕入れる。
 */

export interface Miss {
  kind: 'build' | 'combo' | 'link' | 'arch';
  name: string;
  text: string;
  lack: { tag?: Tag; arch?: Archetype; perm?: string; card?: string };
  value: number;
}

/** あと 1 つで成立するもの（ビルド・記憶の組み合わせ・連携・原型の重なり）。 */
export function misses(w: World): Miss[] {
  const y = w.you;
  const tags = tagCount(y);
  const arch = archCount(y);
  const ids = new Set(y.cards.map((c) => c?.id).filter(Boolean));
  const on = new Set(buildsOf(y).map((b) => b.id));
  const out: Miss[] = [];
  for (const b of allBuilds()) {
    if (on.has(b.id)) continue;
    const lacks: Miss['lack'][] = [];
    for (const [t, n] of Object.entries(buildNeed(b.need, ids.has(b.id)))) {
      const d = (n ?? 0) - (tags[t as Tag] ?? 0);
      for (let i = 0; i < d; i++) lacks.push({ tag: t as Tag });
    }
    for (const [a, n] of Object.entries(b.arch ?? {})) {
      const d = (n ?? 0) - (arch[a as Archetype] ?? 0);
      for (let i = 0; i < d; i++) lacks.push({ arch: a as Archetype });
    }
    if (b.any && !b.any.some((id) => ids.has(id))) lacks.push({ card: b.any[0] });
    const first = lacks[0];
    if (lacks.length === 1 && first)
      out.push({ kind: 'build', name: `《${b.name}》`, text: b.text, lack: first, value: 100 });
  }
  for (const c of allCombos()) {
    if (w.flags[`combo:${c.id}`]) continue;
    const lack = c.needs.filter((p) => !y.perms.includes(p));
    if (lack.length === 1 && lack[0])
      out.push({ kind: 'combo', name: c.name, text: c.text, lack: { perm: lack[0] }, value: 70 });
  }
  for (const l of allLinks()) {
    const lack = l.cards.filter((id) => !ids.has(id));
    if (lack.length === 1 && lack[0] && l.cards.length > 1)
      out.push({
        kind: 'link',
        name: `〈${l.name}〉`,
        text: l.text,
        lack: { card: lack[0] },
        value: 50,
      });
  }
  for (const s of ARCH_SETS) {
    if ((arch[s.arch] ?? 0) === s.at - 1)
      out.push({
        kind: 'arch',
        name: `〈${ARCH_NAME[s.arch]}×${s.at}〉`,
        text: s.text,
        lack: { arch: s.arch },
        value: 25 + 5 * s.at,
      });
  }
  return out.sort((a, b) => b.value - a.value);
}
