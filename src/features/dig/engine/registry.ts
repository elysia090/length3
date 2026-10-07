import { ACTIVE_LIST } from './actives';
import type { ActiveDef, ComboDef, EventDef, ItemDef, NpcDef, PermDef } from './defs';
import { EVENT_LIST } from './events';
import { ITEM_LIST } from './items';
import { NPC_LIST } from './npcs';
import { COMBO_LIST, PERM_LIST } from './perms';

/**
 * id から定義を引く表。定義の中の効き目はエンジンの操作を呼び、操作は
 * この表を引くので、表は最初に引かれたときに作る（読み込みの順に依らない）。
 */
const tables: {
  actives?: Map<string, ActiveDef>;
  perms?: Map<string, PermDef>;
  npcs?: Map<string, NpcDef>;
  items?: Map<string, ItemDef>;
  events?: Map<string, EventDef>;
} = {};

const index = <T extends { id: string }>(list: readonly T[]) => new Map(list.map((d) => [d.id, d]));

export function activeDef(id: string): ActiveDef {
  tables.actives ??= index(ACTIVE_LIST);
  const d = tables.actives.get(id);
  if (!d) throw new Error(`unknown card ${id}`);
  return d;
}

export function permDef(id: string): PermDef | undefined {
  tables.perms ??= index(PERM_LIST);
  return tables.perms.get(id);
}

export function npcDef(id: string): NpcDef {
  tables.npcs ??= index(NPC_LIST);
  const d = tables.npcs.get(id);
  if (!d) throw new Error(`unknown npc ${id}`);
  return d;
}

export function itemDef(id: string): ItemDef | undefined {
  tables.items ??= index(ITEM_LIST);
  return tables.items.get(id);
}

export function eventDef(id: string): EventDef | undefined {
  tables.events ??= index(EVENT_LIST);
  return tables.events.get(id);
}

export const allActives = (): readonly ActiveDef[] => ACTIVE_LIST;
export const allPerms = (): readonly PermDef[] => PERM_LIST;
export const allNpcs = (): readonly NpcDef[] => NPC_LIST;
export const allItems = (): readonly ItemDef[] => ITEM_LIST;
export const allEvents = (): readonly EventDef[] => EVENT_LIST;
export const allCombos = (): readonly ComboDef[] => COMBO_LIST;
