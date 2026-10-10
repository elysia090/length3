/**
 * ことば。遊びの中身（エンジンとデータ）は日本語で書かれていて、英語は画面に
 * 出る直前に置き換える。だから記録・再生・試算は言語に関係なく同じになる。
 *
 * 置き換えは三段：
 *   1. そのままの一致（カード名・台詞・説明）
 *   2. 型の一致（`B{0}・{1}` のような、数や名前を差し込んだ文）。差し込まれた
 *      部分も、また置き換える
 *   3. 区切り（、・。　改行）でほどいて、部分ごとに 1 と 2 を試す
 * どれにも当たらなければ日本語のまま出す（足りない訳は試験で見つける）。
 */

export type Lang = 'ja' | 'en';

interface Dict {
  statics: Record<string, string>;
  templates: Record<string, string>;
}

const JA = /[　-〿぀-ヿ一-鿿！-｠]/;

let lang: Lang = 'ja';
const exact = new Map<string, string>();
const patterns: { re: RegExp; en: string; weight: number }[] = [];
const cache = new Map<string, string>();
let loaded = false;

export const getLang = (): Lang => lang;

/** 英語の辞書を足す（試験からも使う）。 */
export function addDict(d: Dict): void {
  for (const [k, v] of Object.entries(d.statics ?? {})) exact.set(k, v);
  for (const [k, v] of Object.entries(d.templates ?? {})) {
    const literal = k.replace(/\{\d+\}/g, '');
    // 差し込みで始まって差し込みで終わり、決まった字が一字だけの型（「{0}に{1}{2}」のような）は、
    // どんな文にも当たって訳を壊すので使わない（「金 {0}」のような、字で始まる短い型は使う）。
    const loose = /^\{\d+\}/.test(k) && /\{\d+\}$/.test(k) && literal.replace(/\s/g, '').length < 2;
    if (!JA.test(literal) || loose) continue;
    const src = k
      .split(/(\{\d+\})/)
      .map((part) => {
        const m = /^\{(\d+)\}$/.exec(part);
        return m ? `(?<p${m[1]}>[\\s\\S]+?)` : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('');
    patterns.push({ re: new RegExp(`^${src}$`), en: v, weight: literal.length });
  }
  patterns.sort((a, b) => b.weight - a.weight);
  cache.clear();
}

/** 言語を決める。英語は初めて使うときに辞書を読み込む。 */
export async function setLang(next: Lang): Promise<void> {
  if (next === 'en' && !loaded) {
    const mods = import.meta.glob<Dict>('./en/*.json', { import: 'default' });
    const dicts = await Promise.all(Object.values(mods).map((load) => load()));
    for (const d of dicts) addDict(d);
    loaded = true;
  }
  lang = next;
  cache.clear();
}

const SEP = /(\n|　|、|。|・|：|／| → | × )/;
const SEP_EN: Record<string, string> = {
  '\n': '\n',
  '　': '  ',
  '、': ', ',
  '。': '. ',
  '・': ' · ',
  '：': ': ',
  '／': ' / ',
  ' → ': ' → ',
  ' × ': ' × ',
};

function whole(s: string, depth: number): string | null {
  const hit = exact.get(s);
  if (hit !== undefined) return hit;
  if (depth > 6) return null;
  for (const p of patterns) {
    const m = p.re.exec(s);
    if (!m) continue;
    const groups = m.groups ?? {};
    return p.en.replace(/\{(\d+)\}/g, (_, i: string) =>
      translate(groups[`p${i}`] ?? '', depth + 1),
    );
  }
  return null;
}

/** 括弧と句読点だけが残ったときの、英語の形。 */
function punct(s: string): string {
  return s
    .replace(/『([^』]*)』/g, '“$1”')
    .replace(/「([^」]*)」/g, '“$1”')
    .replace(/《([^》]*)》/g, '«$1»')
    .replace(/〈([^〉]*)〉/g, '⟨$1⟩')
    .replace(/［([^］]*)］/g, '[$1]')
    .replace(/（([^）]*)）/g, ' ($1)')
    .replace(/……/g, '…')
    .replace(/──/g, ' — ')
    .replace(/　/g, '  ')
    .replace(/、/g, ', ')
    .replace(/。/g, '. ')
    .replace(/・/g, ' · ')
    .replace(/：/g, ': ')
    .replace(/[ ]{3,}/g, '  ')
    .trimEnd();
}

const WORDS = /[\u3040-\u30ff\u4e00-\u9fff]/;

/** 訳せたら英語、訳せなければ null（部分だけ訳した混ぜ物は出さない）。 */
function attempt(s: string, depth: number): string | null {
  if (!JA.test(s)) return s;
  const w = whole(s, depth) ?? whole(s.trim(), depth);
  if (w !== null) return w;
  // 括弧の中だけ訳す（『名前』のような、名前を包んだだけの文）。
  const wrapped = /^([『「《〈［（])([\s\S]+)([』」》〉］）])$/.exec(s);
  if (wrapped?.[2]) {
    const inner = attempt(wrapped[2], depth + 1);
    if (inner !== null) return punct(`${wrapped[1]}${inner}${wrapped[3]}`);
  }
  if (depth > 6) return null;
  const parts = s.split(SEP);
  if (parts.length > 1) {
    const out: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i] ?? '';
      if (i % 2) out.push(SEP_EN[p] ?? p);
      else if (p) {
        const t = attempt(p, depth + 1);
        if (t === null) return null;
        out.push(t);
      }
    }
    return out
      .join('')
      .replace(/[ ]+\n/g, '\n')
      .trimEnd();
  }
  // 記号だけが残った（括弧と数字）なら、英語の記号に。
  return WORDS.test(s) ? null : punct(s);
}

function translate(s: string, depth: number): string {
  return attempt(s, depth) ?? s;
}

/** 画面に出す文字列。日本語のときはそのまま。 */
/**
 * 能力値の呼び名。エンジンとデータは 3 文字の記号（VIT ATK …）で書かれていて、
 * 日本語の画面では日本語の呼び名にする（体力・精神・意志などと並んで読めるように。
 * どれとも字が重ならない名前を選んである）。英語の画面では記号のまま。
 */
export const STAT_NAME: Readonly<Record<string, string>> = {
  VIT: '体格',
  ATK: '腕力',
  DEF: '防御',
  WIL: '胆力',
  INT: '洞察',
  AGI: '敏捷',
};
const STAT = /\b(VIT|ATK|DEF|WIL|INT|AGI)\b/g;
const jaCache = new Map<string, string>();

function jaStats(s: string): string {
  if (!/[A-Z]{3}/.test(s)) return s;
  const c = jaCache.get(s);
  if (c !== undefined) return c;
  const out = s.replace(STAT, (m) => STAT_NAME[m] ?? m);
  if (jaCache.size > 4000) jaCache.clear();
  jaCache.set(s, out);
  return out;
}

export function tr(s: string): string {
  if (lang === 'ja') return jaStats(s);
  if (!JA.test(s)) return s;
  const c = cache.get(s);
  if (c !== undefined) return c;
  const out = translate(s, 0);
  if (cache.size > 4000) cache.clear();
  cache.set(s, out);
  return out;
}

/** 訳が残らず当たったか（試験用）。 */
export const untranslated = (s: string): boolean => JA.test(tr(s));
