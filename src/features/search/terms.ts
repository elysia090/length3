/**
 * 用語索引。何も打っていないあいだの検索画面は、本の巻末索引のように
 * トピックを頭文字ごとに並べる。ラテン文字は大文字の頭文字、数字は
 * 「0–9」、仮名と漢字は「和」にまとめる。
 *
 * 何も見つからなかったときは、打った語に近いトピックを差し出す。
 */

export interface Term {
  name: string;
  count: number;
}

export interface TermGroup {
  letter: string;
  terms: Term[];
}

export function initialOf(name: string): string {
  const ch = name.replace(/^#/, '').trim().charAt(0);
  if (/[a-z]/i.test(ch)) return ch.toUpperCase();
  if (/[0-9]/.test(ch)) return '0–9';
  return '和';
}

const ORDER = (letter: string) => (letter === '0–9' ? '\u0000' : letter === '和' ? '￿' : letter);

export function groupTerms(terms: readonly Term[]): TermGroup[] {
  const groups = new Map<string, Term[]>();
  for (const t of terms) {
    const k = initialOf(t.name);
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => ORDER(a).localeCompare(ORDER(b)))
    .map(([letter, list]) => ({
      letter,
      terms: [...list].sort((a, b) => a.name.localeCompare(b.name, 'ja')),
    }));
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j] ?? 0;
      row[j] = Math.min(cur + 1, (row[j - 1] ?? 0) + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length] ?? 0;
}

/** 打った語に近いトピック。部分一致を先に、次に綴りの近いもの。 */
export function nearestTerms(query: string, terms: readonly Term[], limit = 4): Term[] {
  const q = query.trim().toLowerCase().replace(/^#/, '');
  if (!q) return [];
  const scored = terms.map((t) => {
    const n = t.name.toLowerCase();
    const part = n.includes(q) || q.includes(n);
    return { t, score: part ? 0 : distance(q, n) };
  });
  const near = scored
    .filter(({ t, score }) => score <= Math.max(2, Math.floor(t.name.length / 3)))
    .sort((a, b) => a.score - b.score || b.t.count - a.t.count)
    .map(({ t }) => t);
  return near.length > 0
    ? near.slice(0, limit)
    : [...terms].sort((a, b) => b.count - a.count).slice(0, limit);
}

/** 'gunman' と打つと射撃場が開く。 */
export function isGunman(query: string): boolean {
  return query.trim().toLowerCase() === 'gunman';
}
