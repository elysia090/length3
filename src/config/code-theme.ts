/**
 * Shiki theme for code blocks.
 *
 * ページは寒色に寄せた紙 (--bg #f9f9fa) の上に等高線テクスチャが乗っている。
 * その上に描かれるものはすべて寒色（色相 212°）に揃えてあり、コード面は
 * その寒色を字ではなく面の大きさで敷いたもの (#20272f)。
 *
 * トークン色は amber を軸にした muted なセット（琥珀・セージ・テラコッタ・
 * 羊皮紙・ダスティラベンダー）。ページ全体で暖色に残してあるのは琥珀と
 * この面の上のトークンだけなので、寒色の面に補色側から当たって立つ。
 * 沈めたい種類（コメント・記号）だけ面と同じ寒色に置く。
 * すべて #20272f に対して 4.5:1 以上（実測 4.61〜10.22）。
 *
 * ここの値は src/styles/tokens.css の --code-* と対になっている。片方だけ
 * 変えると、ハイライトされないコード（言語指定なしのフェンス）とずれる。
 */

const surface = '#20272f'; // 炭 — --code-bg
const fg = '#d9d4cb'; // 地の文字 — --code-fg
const dim = '#878f99'; // コメント — --code-dim
const operator = '#959da8'; // 記号・区切り
const amber = '#e8a030'; // キーワード・タグ (--amber-lt)
const sage = '#a3b18a'; // 文字列
const terracotta = '#cf8a72'; // 数値・定数
const parchment = '#e6d3a3'; // 関数名
const lavender = '#b9a5c9'; // 型・クラス

export const codeTheme = {
  name: 'length3-ink',
  type: 'dark' as const,
  colors: {
    'editor.background': surface,
    'editor.foreground': fg,
  },
  settings: [
    { settings: { background: surface, foreground: fg } },
    {
      scope: ['comment', 'punctuation.definition.comment', 'string.comment'],
      settings: { foreground: dim, fontStyle: 'italic' },
    },
    {
      scope: ['string', 'string.quoted', 'markup.inline.raw', 'markup.raw'],
      settings: { foreground: sage },
    },
    {
      scope: ['constant.character.escape', 'string.regexp'],
      settings: { foreground: terracotta },
    },
    {
      scope: ['constant.numeric', 'constant.language', 'constant.other', 'support.constant'],
      settings: { foreground: terracotta },
    },
    {
      scope: ['keyword', 'storage', 'storage.type', 'storage.modifier', 'keyword.control'],
      settings: { foreground: amber },
    },
    {
      scope: ['keyword.operator', 'punctuation', 'meta.brace', 'punctuation.separator'],
      settings: { foreground: operator },
    },
    {
      scope: ['entity.name.function', 'support.function', 'meta.function-call.generic'],
      settings: { foreground: parchment },
    },
    {
      scope: [
        'entity.name.type',
        'entity.name.class',
        'entity.name.namespace',
        'support.type',
        'support.class',
      ],
      settings: { foreground: lavender },
    },
    {
      scope: ['entity.name.tag', 'punctuation.definition.tag'],
      settings: { foreground: amber },
    },
    {
      scope: ['entity.other.attribute-name'],
      settings: { foreground: sage },
    },
    {
      scope: ['variable', 'variable.other', 'support.variable', 'meta.object-literal.key'],
      settings: { foreground: fg },
    },
    {
      scope: ['variable.parameter', 'meta.definition.variable'],
      settings: { foreground: fg },
    },
    {
      scope: ['markup.heading', 'entity.name.section'],
      settings: { foreground: parchment, fontStyle: 'bold' },
    },
    {
      scope: ['markup.italic'],
      settings: { fontStyle: 'italic' },
    },
    {
      scope: ['markup.bold'],
      settings: { fontStyle: 'bold' },
    },
    {
      scope: ['invalid', 'invalid.illegal'],
      settings: { foreground: terracotta },
    },
  ],
};
