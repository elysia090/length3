import type { Card, Char, Enc, Mind, World } from './model';

/**
 * 試行用の世界の写し。丸ごと structuredClone すると、それだけで頭の計算の
 * 半分を食う（地図・全員の認識・もう一人の履歴まで写すため）。そこで、
 * その試行で変わりうるところだけを写し、変わらないところは本物と共有する。
 *
 *   encounter  遭遇の中だけを試す（手の読み・相手の読み）。変わるのは
 *              遭遇・当人・乱数・旗・見つけた隠し効果・その相手の認識だけ
 *   branch     地図の上も動く（もう一人の遭遇・ルート読みの試行）。地図の
 *              節点は浅く写す（節点の配列や語は書き換えられない）
 *
 * 共有した部分を書き換えるイベントを、試行の中で起こしてはいけない
 * （起きていないことは dig.test.ts が確かめる）。
 *
 * 写しは手書きの構造コピー（structuredClone は小さな物ほど割高）。
 * 形が変わったら、ここも変える（深い写しと一致することもテストが確かめる）。
 */

const copyCard = (c: Card | null): Card | null =>
  c ? { ...c, marks: { ...c.marks }, eps: [...c.eps] } : null;

export function copyChar(c: Char): Char {
  const permEps: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(c.permEps)) permEps[k] = [...v];
  return {
    ...c,
    innate: { ...c.innate },
    growth: { ...c.growth },
    xp: { ...c.xp },
    items: [...c.items],
    cards: c.cards.map(copyCard),
    perms: [...c.perms],
    permEps,
    epithets: [...c.epithets],
    debts: { ...c.debts },
  };
}

export function copyEnc(e: Enc): Enc {
  const f = e.foe;
  return {
    ...e,
    st: { ...e.st },
    last: [...e.last],
    stage: [...e.stage],
    foe: {
      ...f,
      tags: [...f.tags],
      eps: [...f.eps],
      clues: f.clues.map((x) => ({ ...x })),
      intent: f.intent ? { ...f.intent } : null,
      st: { ...f.st },
      history: [...f.history],
    },
  };
}

export const copyMind = (m: Mind): Mind => ({
  ...m,
  cards: [...m.cards],
  known: [...m.known],
  claims: m.claims.map((c) => ({ ...c })),
  outcomes: { ...m.outcomes },
});

export function forkEncounter(w: World): World {
  const e = w.enc;
  const who = e?.who ?? 'you';
  const foe = e?.foe.id;
  const minds = { ...w.minds };
  const m = foe ? minds[foe] : undefined;
  if (foe && m) minds[foe] = copyMind(m);
  return {
    ...w,
    rng: { ...w.rng },
    flags: { ...w.flags },
    found: [...w.found],
    enc: e ? copyEnc(e) : null,
    you: who === 'you' ? copyChar(w.you) : w.you,
    rival: who === 'rival' ? { ...w.rival, char: copyChar(w.rival.char) } : w.rival,
    minds,
  };
}

export function branch(w: World): World {
  return {
    ...w,
    rng: { ...w.rng },
    flags: { ...w.flags },
    found: [...w.found],
    seen: [...w.seen],
    unlocked: [...w.unlocked],
    map: w.map.map((n) => ({ ...n })),
    enc: w.enc ? copyEnc(w.enc) : null,
    pending: w.pending ? structuredClone(w.pending) : null,
    you: copyChar(w.you),
    rival: { ...w.rival, char: copyChar(w.rival.char), log: [...w.rival.log] },
    minds: Object.fromEntries(Object.entries(w.minds).map(([k, m]) => [k, copyMind(m)])),
    ending: w.ending ? { ...w.ending } : null,
  };
}
