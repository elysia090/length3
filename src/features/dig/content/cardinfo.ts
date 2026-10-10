import type { Card, Char } from '../core/model';
import { type ArchCount, type Archetype, TAGS, type Tag, type TagCount } from '../core/tags';
import { LV_MARK } from './balance';
import { cardDef, epithetDef, permDef } from './registry';

/** 刻まれたエピテットを重ねた、カードのタグ。 */
export function cardTags(card: Card): Tag[] {
  let tags: Tag[] = [...cardDef(card.id).tags];
  for (const e of card.eps ?? []) {
    const d = epithetDef(e)?.card;
    if (!d) continue;
    if (d.remove === 'all') tags = [];
    else if (d.remove) tags = tags.filter((t) => !(d.remove as readonly Tag[]).includes(t));
    for (const t of d.add ?? []) if (!tags.includes(t)) tags.push(t);
  }
  return tags.filter((t) => (TAGS as readonly string[]).includes(t));
}

export const cardArch = (card: Card): readonly Archetype[] => cardDef(card.id).arch ?? [];

/** 手持ちのその札のレベル（Ⅰ〜Ⅲ。持っていなければ 0）。同じ札は重なるので一枚だけ。 */
export function cardLv(c: Char, id: string): number {
  const card = c.cards.find((x) => x?.id === id) ?? c.back.find((x) => x.id === id);
  return card ? (card.lv ?? 1) : 0;
}

/** レベルの印（Ⅰ・Ⅱ・Ⅲ）。 */
export const lvMark = (card: Pick<Card, 'lv'>): string => LV_MARK[card.lv ?? 1] ?? '';

/** エピテットを冠した名前（「夜の 海辺の僧侶」）。 */
export function cardName(card: Card, spent = false): string {
  const def = cardDef(card.id);
  const base = spent ? def.spentName : def.name;
  const eps = (card.eps ?? []).map((e) => epithetDef(e)?.name ?? '').join('');
  return eps ? `${eps}${base}` : base;
}

export function tagCount(c: Char): TagCount {
  const out: TagCount = {};
  const add = (t: Tag) => {
    out[t] = (out[t] ?? 0) + 1;
  };
  for (const card of c.cards) if (card) cardTags(card).forEach(add);
  for (const id of c.perms) {
    const mode = memoryTags(c, id);
    if (mode === 'none') continue;
    for (const t of permDef(id)?.tags ?? []) {
      add(t);
      if (mode === 'double') add(t);
    }
  }
  return out;
}

/** 職そのものの原型（夜警は門番、看護師は聖人…）。原型の重なりに数える。 */
export const JOB_ARCH: Readonly<Record<string, Archetype>> = {
  surveyor: 'observer',
  watch: 'gatekeeper',
  projectionist: 'observer',
  reporter: 'witness',
  locksmith: 'trickster',
  nurse: 'saint',
  welder: 'machine',
};

export function archCount(c: Char): ArchCount {
  const out: ArchCount = {};
  for (const card of c.cards) {
    if (!card) continue;
    for (const a of cardArch(card)) out[a] = (out[a] ?? 0) + 1;
  }
  const j = JOB_ARCH[c.job];
  if (j) out[j] = (out[j] ?? 0) + 1;
  return out;
}

/** 記憶に刻まれたエピテットの、タグの数え方。 */
export function memoryTags(c: Char, perm: string): 'double' | 'none' | 'normal' {
  let mode: 'double' | 'none' | 'normal' = 'normal';
  for (const e of c.permEps?.[perm] ?? []) {
    const t = epithetDef(e)?.memory?.tags;
    if (t === 'none') return 'none';
    if (t === 'double') mode = 'double';
  }
  return mode;
}

/** 記憶に刻まれたエピテットの、補正の倍率。 */
export function memoryMods(c: Char, perm: string): number {
  let m = 1;
  for (const e of c.permEps?.[perm] ?? []) m *= epithetDef(e)?.memory?.mods ?? 1;
  return m;
}

export function memoryName(c: Char, perm: string): string {
  const eps = (c.permEps?.[perm] ?? []).map((e) => epithetDef(e)?.name ?? '').join('');
  return `${eps}${permDef(perm)?.name ?? perm}`;
}
