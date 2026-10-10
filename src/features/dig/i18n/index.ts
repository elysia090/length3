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
const patterns: { re: RegExp; en: string; weight: number; lines: boolean; free: Set<string> }[] =
  [];
const cache = new Map<string, string>();
let loaded = false;
/** エピテットの名（「夜の」「けちな」）と、札・作品の名。冠した名前（「夜のダークナイト」）を組んで訳す。 */
const prefixes: string[] = [];
const nouns = new Set<string>();

export const getLang = (): Lang => lang;

/** 英語の辞書を足す（試験からも使う）。 */
export function addDict(d: Dict, name = ''): void {
  for (const [k, v] of Object.entries(d.statics ?? {})) {
    exact.set(k, v);
    // 前後に間を空けた見出し（「 約束は…」）は、間を外した形でも引ける（訳すときは間を外して引く）。
    const t = k.trim();
    if (t !== k && !exact.has(t)) exact.set(t, v.trim());
  }
  // 名前らしい短い見出し（句読点を含まない）だけを、冠する側・冠される側に登録する。
  const short = (k: string, n: number) => k.length <= n && !/[、。：，．\s]/.test(k);
  if (name === 'epithets')
    for (const k of Object.keys(d.statics ?? {})) if (short(k, 6)) prefixes.push(k);
  if (name === 'cards' || name === 'works')
    for (const k of Object.keys(d.statics ?? {})) if (short(k, 24)) nouns.add(k);
  prefixes.sort((a, b) => b.length - a.length);
  for (const [key, val] of Object.entries(d.templates ?? {})) {
    // 「。」で終わる文は句点を外してから型に当てるので、型も句点なしで覚える。
    // 前後の間も外す（訳すときは間を外して引き、間は付け直す）。
    const k = (key.endsWith('。') ? key.slice(0, -1) : key).trim();
    const v = (key.endsWith('。') ? val.replace(/\.$/, '') : val).trim();
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
    patterns.push({
      re: new RegExp(`^${src}$`),
      en: v,
      weight: literal.length,
      lines: k.includes('\n'),
      // 見出しの後ろの差し込み（「札に刻むと：{0}」）と、括弧で括った差し込み（館内放送：「{0}」）
      // だけは、文をまたいで受け取ってよい。
      free: new Set(
        [...k.matchAll(/\{(\d+)\}/g)]
          .filter((m) => {
            const end = m.index + m[0].length;
            const before = k[m.index - 1] ?? '';
            // 見出しの後ろの差し込み（「札に刻むと：{0}」）か、括弧で括った差し込み。
            return (
              (end === k.length && /[：　]/.test(before)) ||
              (!!CLOSE[before] && CLOSE[before] === k[end])
            );
          })
          .map((m) => `p${m[1]}`),
      ),
    });
  }
  patterns.sort((a, b) => b.weight - a.weight);
  cache.clear();
}

/** 言語を決める。英語は初めて使うときに辞書を読み込む。 */
export async function setLang(next: Lang): Promise<void> {
  if (next === 'en' && !loaded) {
    const mods = import.meta.glob<Dict>('./en/*.json', { import: 'default' });
    const dicts = await Promise.all(
      Object.entries(mods).map(async ([path, load]) => [path, await load()] as const),
    );
    for (const [path, d] of dicts) addDict(d, /([\w-]+)\.json$/.exec(path)?.[1] ?? '');
    loaded = true;
  }
  lang = next;
  cache.clear();
}

/**
 * ほどく順：行 → 全角の間 → 文（「。」で終わる一文ごと。一文まるごとの訳を先に試す）→ 句読点。
 * 粗い区切りから順にほどくので、二行の説明の一行目が一文の訳に当たる。
 */
const LINES = /(\n)/;
const GAPS = /(　)/;
const COMMA = /(、)/;
const SEP = /(。|・|：|／| \/ | → | × )/;
/** 括弧の組（括った語だけを訳して、英語の括弧に）。 */
const CLOSE: Record<string, string> = {
  '『': '』',
  '「': '」',
  '《': '》',
  '〈': '〉',
  '［': '］',
  '（': '）',
};
/** 括弧で括った語が続くだけの文（［夜］［場所］、『A』『B』）。 */
const GROUP = /([『「《〈［][^『』「」《》〈〉［］]*[』」》〉］])/;
const SEP_EN: Record<string, string> = {
  '\n': '\n',
  '　': '  ',
  '、': ', ',
  '。': '. ',
  '・': ' · ',
  '：': ': ',
  '／': ' / ',
  ' / ': ' / ',
  ' → ': ' → ',
  ' × ': ' × ',
};

/** 括弧が釣り合っているか（「夜］［場所」のように、括りをまたいでいないか）。 */
function balanced(s: string): boolean {
  const stack: string[] = [];
  for (const ch of s) {
    if (CLOSE[ch]) stack.push(CLOSE[ch]);
    else if (Object.values(CLOSE).includes(ch) && stack.pop() !== ch) return false;
  }
  return stack.length === 0;
}

function whole(s: string, depth: number): string | null {
  const hit = exact.get(s);
  if (hit !== undefined) return hit;
  // 辞書の一文は「。」まで含めて書いてある。句点を外した形で呼ばれたら、その訳の句点を外して返す。
  const full = exact.get(`${s}。`);
  if (full !== undefined) return full.replace(/\.$/, '');
  if (depth > 6) return null;
  // 「。」で終わる文は、句点を外してから型に当てる（型の差し込みに句点を呑ませない）。
  if (s.endsWith('。')) return null;
  const multi = s.includes('\n');
  for (const p of patterns) {
    // 一行の型は、複数行の文には当てない（行ごとにほどいてから当てる）。
    if (multi && !p.lines) continue;
    const m = p.re.exec(s);
    if (!m) continue;
    const groups = m.groups ?? {};
    // 差し込みが読点で終わる（文の続きまで呑んだ）か、括りをまたぐなら、この型ではない。
    if (
      Object.entries(groups).some(
        ([k, g]) =>
          /、$/.test(g ?? '') || !balanced(g ?? '') || (!p.free.has(k) && (g ?? '').includes('。')),
      )
    )
      continue;
    // 差し込みが一つでも訳せなければ、この型は使わない（日本語の混ざった訳は出さない）。
    const said: Record<string, string> = {};
    let ok = true;
    for (const [k, g] of Object.entries(groups)) {
      const t = attempt(g ?? '', depth + 1);
      if (t === null) {
        ok = false;
        break;
      }
      said[k] = t;
    }
    if (!ok) continue;
    return p.en.replace(/\{(\d+)\}/g, (_, i: string) => said[`p${i}`] ?? '');
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
/** 区切りでほどいて、部分ごとに訳す（区切りは英語の形に）。一つでも訳せなければ null。 */
function splitBy(s: string, re: RegExp, depth: number): string | null | undefined {
  // 括弧の中では切らない（〈聖人／殉教者〉・《レ・ミゼラブル》は一語）。
  const raw = s.split(re);
  const parts: string[] = [raw[0] ?? ''];
  for (let i = 1; i < raw.length; i += 2) {
    const last = parts.length - 1;
    if (balanced(parts[last] ?? '')) parts.push(raw[i] ?? '', raw[i + 1] ?? '');
    else parts[last] = `${parts[last]}${raw[i] ?? ''}${raw[i + 1] ?? ''}`;
  }
  if (parts.length < 2) return undefined;
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

/** 冠した名前（「夜のダークナイト」「けちな夜のカフェ」）。 */
function composed(s: string): string | null {
  for (const p of prefixes) {
    if (!s.startsWith(p) || s.length === p.length) continue;
    const rest = s.slice(p.length);
    const tail = nouns.has(rest) ? (exact.get(rest) ?? null) : composed(rest);
    // 作品名の冠詞は、冠した名前では落とす（Nocturnal Dark Knight）。
    if (tail !== null) return `${exact.get(p) ?? p} ${tail.replace(/^The /, '')}`;
  }
  return null;
}

/** 訳せたら英語、訳せなければ null（部分だけ訳した混ぜ物は出さない）。 */
function attempt(s: string, depth: number): string | null {
  if (!JA.test(s)) return s;
  // 前後の空白は残したまま、中身で引く（「 今日の夜に入る（…）」のような、間を空けた文）。
  const core = s.trim();
  if (core !== s) {
    const t = attempt(core, depth + 1);
    if (t === null) return null;
    const lead = /^\s*/.exec(s)?.[0] ?? '';
    const trail = /\s*$/.exec(s)?.[0] ?? '';
    return `${lead.replace(/　/g, '  ')}${t}${trail.replace(/　/g, '  ')}`;
  }
  const w = whole(s, depth);
  if (w !== null) return w;
  const name = composed(s);
  if (name !== null) return name;
  if (depth > 12) return null;
  // 一文の終わりの「。」は外して型に当て、英語の句点を付け直す。
  const stop = /^([\s\S]*[^。])。\s*$/.exec(s);
  if (stop?.[1]) {
    const t = attempt(stop[1], depth + 1);
    if (t !== null) return `${t.replace(/[.\s]+$/, '')}.`;
  }
  // 末尾の「 ×2」（回数）は外して訳し、付け直す。
  const times = /^([\s\S]*?\S)\s*(×\d+(?:\.\d+)?)$/.exec(s);
  if (times?.[1] && times[2] && JA.test(times[1])) {
    const t = attempt(times[1], depth + 1);
    if (t !== null) return `${t} ${times[2]}`;
  }
  // 末尾の「…」（道の続き）は外して訳し、付け直す。
  const ell = /^([\s\S]*?)\s*…$/.exec(s);
  if (ell?.[1] && JA.test(ell[1])) {
    const t = attempt(ell[1], depth + 1);
    return t === null ? null : `${t} …`;
  }
  // 括弧の中だけ訳す（『名前』のような、名前を包んだだけの文）。中に同じ閉じ括弧がある
  // （『A』『B』）なら一つの括りではない。
  const wrapped = /^([『「《〈［（])([\s\S]+)([』」》〉］）])$/.exec(s);
  const [, open, body, close] = wrapped ?? [];
  if (open && body && close && close === CLOSE[open] && !body.includes(close)) {
    const inner = attempt(body, depth + 1);
    if (inner !== null) return punct(`${open}${inner}${close}`);
  }
  // 括った語が続くだけ（［夜］［場所］・『A』『B』）なら、一つずつ。
  const groups = s.split(GROUP);
  if (groups.length > 2 && groups.every((g, i) => i % 2 === 1 || !JA.test(g))) {
    const out: string[] = [];
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i] ?? '';
      if (i % 2 === 0) out.push(g);
      else {
        const t = attempt(g, depth + 1);
        if (t === null) return null;
        out.push(t);
      }
    }
    return out.join('');
  }
  for (const re of [LINES, GAPS]) {
    const t = splitBy(s, re, depth);
    if (t !== undefined) return t;
  }
  // 一文ずつ（「。」まで含めた一文の訳を先に試す）。
  const sentences = s.split(/(?<=。)/).filter((x) => x.trim());
  if (sentences.length > 1) {
    // 前から、辞書に一まとまりで載っているいちばん長い文の塊を取り、残りを続けて訳す。
    const out: string[] = [];
    let i = 0;
    while (i < sentences.length) {
      let next = i + 1;
      let t: string | null = null;
      for (let j = sentences.length; j > i + 1; j--) {
        const hit = exact.get(sentences.slice(i, j).join('').trim());
        if (hit !== undefined) {
          t = hit;
          next = j;
          break;
        }
      }
      t ??= attempt(sentences[i] ?? '', depth + 1);
      if (t === null) return null;
      out.push(t.trim());
      i = next;
    }
    return out.join(' ');
  }
  for (const re of [COMMA, SEP]) {
    const t = splitBy(s, re, depth);
    if (t !== undefined) return t;
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
