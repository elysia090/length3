import type { Archetype } from '../core/tags';
import { FOE_ARCH, WORK_ARCH } from './archetypes';
import { LEGACY, tuned } from './balance';
import { BASICS } from './basics';
import { BUILD_LIST, LINK_LIST } from './builds';
import type {
  BuildDef,
  CardDef,
  ComboDef,
  FoeDef,
  ItemDef,
  JobDef,
  LinkDef,
  PermDef,
  StoryDef,
} from './defs';
import { EPITHETS, type Epithet } from './epithets';
import { FOE_LIST } from './foes';
import { ITEM_LIST } from './items';
import { JOB_LIST } from './jobs';
import { KEEPSAKES } from './keepsakes';
import { LEGENDS, levelRules } from './legends';
import { COMBO_LIST, PERM_LIST } from './perms';
import { SIGNATURES } from './signatures';
import { STORY_LIST } from './story';
import { WORKS } from './works';

/**
 * id から定義を引く表。定義の中の効き目はエンジンの操作を呼び、操作は
 * この表を引くので、表は最初に引かれたときに作る（読み込みの順に依らない）。
 * カードには版ごとの調整（tune）と原型を重ねてから載せる。
 */
const memo = new Map<string, Map<string, unknown>>();

function table<T extends { id: string }>(name: string, list: () => readonly T[]): Map<string, T> {
  let t = memo.get(name) as Map<string, T> | undefined;
  if (!t) {
    t = new Map(list().map((d) => [d.id, d]));
    memo.set(name, t as Map<string, unknown>);
  }
  return t;
}

const cards = () =>
  table<CardDef>('cards', () =>
    [...WORKS, ...BASICS, ...LEGACY].map((d) => {
      // 札の力は、札そのもの（効き目と一文）とレベルとエピテットだけ（主役の章・構成は無い）。
      // いくつかの札は、レベルごとに効き目が一つずつ開く（Ⅰ・Ⅱ・Ⅲ）。
      const sig = SIGNATURES[d.id];
      const legend = LEGENDS.find((l) => l.id === d.id);
      const lr = legend ? levelRules(legend) : null;
      return tuned({
        ...d,
        arch: d.arch ?? WORK_ARCH[d.id] ?? [],
        sig: sig?.text,
        levels: legend?.chapters.map((ch) => ch.text),
        passive: [...(d.passive ?? []), ...(sig?.passive ?? []), ...(lr?.passive ?? [])],
        triggers: [...(d.triggers ?? []), ...(sig?.triggers ?? []), ...(lr?.triggers ?? [])],
      });
    }),
  );
const foes = () =>
  table<FoeDef>('foes', () =>
    FOE_LIST.map((d) => ({ ...d, arch: d.arch ?? (FOE_ARCH[d.id] as readonly Archetype[]) ?? [] })),
  );

export function cardDef(id: string): CardDef {
  const d = cards().get(id);
  if (!d) throw new Error(`unknown card ${id}`);
  return d;
}

export function foeDef(id: string): FoeDef {
  const d = foes().get(id);
  if (!d) throw new Error(`unknown foe ${id}`);
  return d;
}

export const permDef = (id: string): PermDef | undefined => table('perms', () => PERM_LIST).get(id);
export const itemDef = (id: string): ItemDef | undefined =>
  table('items', () => [...ITEM_LIST, ...KEEPSAKES]).get(id);
export const storyDef = (id: string): StoryDef | undefined =>
  table('stories', () => STORY_LIST).get(id);
export const jobDef = (id: string): JobDef | undefined => table('jobs', () => JOB_LIST).get(id);
export const epithetDef = (id: string): Epithet | undefined => table('eps', () => EPITHETS).get(id);

export const allCards = (): CardDef[] => [...cards().values()];
export const allFoes = (): FoeDef[] => [...foes().values()];
export const allPerms = (): readonly PermDef[] => PERM_LIST;
export const allItems = (): readonly ItemDef[] => ITEM_LIST;
export const allKeepsakes = (): readonly ItemDef[] => KEEPSAKES;
export const allStories = (): readonly StoryDef[] => STORY_LIST;
export const allJobs = (): readonly JobDef[] => JOB_LIST;
export const allBuilds = (): readonly BuildDef[] => BUILD_LIST;
export const allLinks = (): readonly LinkDef[] => LINK_LIST;
export const allEpithets = (): readonly Epithet[] => EPITHETS;
export const allCombos = (): readonly ComboDef[] => COMBO_LIST;
