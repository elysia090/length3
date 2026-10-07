import type { StatBlock } from './types';

/** 生まれ。先天値と、最初の 5 枚と、最初から持っている記憶。 */
export interface Origin {
  id: string;
  name: string;
  text: string;
  innate: StatBlock;
  cards: readonly string[];
  perms: readonly string[];
}

export const ORIGINS: readonly Origin[] = [
  {
    id: 'surveyor',
    name: '測量士',
    text: '見て、測って、掘る。知能と素早さ。体は強くない。',
    innate: { VIT: 2, ATK: 2, DEF: 2, WIL: 3, INT: 4, AGI: 3 },
    cards: ['observe', 'dig', 'lie', 'silence', 'flee'],
    perms: ['promise', 'habit-measure'],
  },
  {
    id: 'watch',
    name: '元夜警',
    text: '殴られ慣れた体と、短い言葉。知能は低い。',
    innate: { VIT: 4, ATK: 4, DEF: 3, WIL: 2, INT: 1, AGI: 2 },
    cards: ['strike', 'intimidate', 'shield', 'observe', 'flee'],
    perms: ['promise', 'old-wound'],
  },
  {
    id: 'projectionist',
    name: '映写技師',
    text: '暗闇で見ることに慣れた目と、消えない記憶。腕っぷしはない。',
    innate: { VIT: 2, ATK: 1, DEF: 2, WIL: 4, INT: 3, AGI: 3 },
    cards: ['remember', 'observe', 'lie', 'pray', 'flee'],
    perms: ['promise', 'accident'],
  },
];

export const originOf = (id: string) => ORIGINS.find((o) => o.id === id) ?? (ORIGINS[0] as Origin);
