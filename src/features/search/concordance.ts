/**
 * 検索結果の抜粋を、用語索引（コンコーダンス）の一行に組み替える。
 *
 * 聖書やシェイクスピアの研究で使われてきた KWIC（Key Word In Context）の
 * 組み方。一致した語を行の真ん中に置き、前の文脈は右寄せ、後ろの文脈は
 * 左寄せで流す。全部の結果で一致語が縦一列に揃うので、語がどういう文脈で
 * 使われているかを上から下へ一息に読める。
 *
 * Pagefind の抜粋は `<mark>` で一致語を包んだ HTML。最初の一致（隣り合う
 * `<mark>` は一続きとみなす）を軸にして、三つの span に割る:
 *
 *   <span class="kwic-l">前の文脈</span><span class="kwic-k"><mark>語</mark></span><span class="kwic-r">後ろの文脈</span>
 *
 * 軸の外にある二つ目以降の一致は `<mark>` のまま残す。一致が無い抜粋は
 * 触らない。
 */
const MARK_RUN = /(?:<mark>[^<]*<\/mark>\s*)*<mark>[^<]*<\/mark>/;

export function toConcordance(excerpt: string | undefined): string | undefined {
  if (!excerpt) return excerpt;
  const match = MARK_RUN.exec(excerpt);
  if (!match) return excerpt;
  const left = excerpt.slice(0, match.index).trimEnd();
  const key = match[0].trim();
  const right = excerpt.slice(match.index + match[0].length).trimStart();
  return (
    `<span class="kwic-l"><bdi>${left}</bdi></span>` +
    `<span class="kwic-k">${key}</span>` +
    `<span class="kwic-r">${right}</span>`
  );
}
