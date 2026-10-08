import type { PassiveSpec } from './defs';

/**
 * 掟。区画ごとに一つ、手番の回し方が少しだけ変わる。覚えることは一つずつ増え、
 * 前の区画の掟は下でも生きている（三つ目より下では、すべてが重なる）。
 *
 *   夜の街     掟なし。四つの道と、連鎖を覚える
 *   記録の階   読まれる  同じ札を続けて使うと、二度目からは効き目が −3
 *                        （札を回す。手札の幅が効いてくる）
 *   琥珀の階   固まる    守りと心の構えが、手番をまたいで半分残る。
 *                        そのかわり、相手の一撃は +1（受けて、溜めて、返す）
 */
export interface Law {
  id: string;
  /** 掟の名（二文字か三文字）。 */
  name: string;
  /** 着いたときに一度だけ出る、一文。 */
  text: string;
  passive: readonly PassiveSpec[];
}

export const LAWS: Readonly<Record<number, Law>> = {
  2: {
    id: 'read',
    name: '読まれる',
    text: '同じ札を続けると、二度目からは読まれる。',
    passive: [
      {
        rule: 'bonus',
        when: (c) => !!c.enc && !!c.card && c.enc.lastCard === c.card,
        fn: (_c, v) => v - 3,
        text: '掟《読まれる》 −3',
      },
    ],
  },
  3: {
    id: 'set',
    name: '固まる',
    text: '守りは固まって、手番をまたぐ。そのぶん、相手の一撃も重い。',
    passive: [
      { rule: 'guardKeep', fn: (_c, v) => Math.max(v, 0.5), text: '掟《固まる》 守りが半分残る' },
      { rule: 'calmKeep', fn: (_c, v) => Math.max(v, 0.75), text: '掟《固まる》 構えが残る' },
      {
        rule: 'strikeTaken',
        fn: (_c, v) => (v > 0 ? v + 1 : v),
        text: '掟《固まる》 受ける傷 +1',
      },
    ],
  },
};

/**
 * 深み。底の手前より下で、区画ごとに一段ずつ。秘密は固く（漏れにくく）、
 * 誤った手がかりが混じる。体で押すだけでなく、暴く道にも重さが乗る。
 */
function depths(deep: number): Law {
  return {
    id: `deep${deep}`,
    name: '深み',
    text: '深いほど、秘密は固く、嘘が混じる。',
    passive: [
      { rule: 'slip', fn: (_c, v) => v * 0.8 ** deep, text: `掟《深み》 漏れにくい` },
      { rule: 'falseChance', fn: (_c, v) => v + 10 * deep, text: `掟《深み》 誤り +${10 * deep}%` },
    ],
  };
}

/** その区画で効いている掟（上の区画の掟も、下では生きている）。 */
export function lawsAt(stratum: number): Law[] {
  const out: Law[] = [];
  for (let s = 2; s <= Math.min(stratum, 3); s++) {
    const l = LAWS[s];
    if (l) out.push(l);
  }
  if (stratum > 3) out.push(depths(stratum - 3));
  return out;
}
