import { describe, expect, test } from 'vitest';
import { setLang, tr, untranslated } from '.';

const JA = /[　-〿぀-ヿ一-鿿！-｠]/;

/** 中身（content/*.ts）にある日本語の文を、残らず拾う（関数の中で組む文は画面の走査で見る）。 */
function contentStrings(): Map<string, string[]> {
  const mods = import.meta.glob('../content/*.ts', { eager: true }) as Record<
    string,
    Record<string, unknown>
  >;
  const out = new Map<string, string[]>();
  const seen = new Set<unknown>();
  const walk = (v: unknown, file: string, depth: number) => {
    if (depth > 8 || v === null || v === undefined) return;
    if (typeof v === 'string') {
      if (JA.test(v)) out.set(file, [...(out.get(file) ?? []), v]);
      return;
    }
    if (typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    for (const x of Array.isArray(v) ? v : Object.values(v as object)) walk(x, file, depth + 1);
  };
  for (const [f, m] of Object.entries(mods))
    for (const v of Object.values(m)) walk(v, f.replace('../content/', ''), 0);
  return out;
}

describe('English', () => {
  test('every content string has an English translation', async () => {
    await setLang('en');
    const missing: string[] = [];
    for (const [file, list] of contentStrings())
      for (const s of new Set(list)) if (untranslated(s)) missing.push(`${file}: ${s}`);
    await setLang('ja');
    expect(missing).toEqual([]);
  });

  test('splitting keeps brackets, sentences and lines together', async () => {
    await setLang('en');
    const cases: [string, RegExp][] = [
      // 二行の説明は行ごとに、一文まるごとの訳を先に。
      [
        '帰り道：倒して終えると、［場所］のカードの回数 +1\n疲れた犬と、坂の下の村の灯り。',
        /^The Way Home: .+\nTired dogs/,
      ],
      // 括った語が続くだけの文は、一つずつ。
      ['［夜］［場所］', /^\[Night\]\[Place\]$/],
      // 型の差し込みに句点を呑ませない。
      ['代償：精神 −2。', /^Cost: −2 mind\.$/],
      // 一行の型は、複数行の文に当てない。
      [
        '眠りぎわ　相手の意志を 8 削る。代償：体力 −2。\nもっと大きな船が要る：危険な相手と〈怪物〉に ×1.6',
        /^On sleep {2}Opponent will −8\. Cost: −2 body\.\nA Bigger Boat/,
      ],
      // 冠した名前。
      ['夜のダークナイト', /^Nocturnal Dark Knight$/],
    ];
    for (const [ja, en] of cases) expect(tr(ja)).toMatch(en);
    await setLang('ja');
  });
});
