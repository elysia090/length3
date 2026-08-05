/**
 * 記事の中のリンクを、書いたまま置いておけるようにする rehype プラグイン。
 *
 * 記事から記事へ繋ぐとき、これまでは「.com から先」を手で打ち直していた。
 * ブラウザのアドレス欄からコピーした URL をそのまま貼れば済むはずのものを、
 * 貼ってから頭を消す作業が毎回入っていたということ。
 *
 * ここでやることは 2 つ。
 *
 * 1. 自分のサイトを指す絶対 URL を、サイト内の相対パスへ畳む。
 *    https://length3.com/foo → /foo。www の有無、http/https、.html、
 *    末尾スラッシュはすべて吸う（astro.config の trailingSlash: 'never' に
 *    合わせる）。クエリと片仮名混じりのフラグメントは残す。
 *    貼った URL のままでも本番では動くが、それだと開発サーバやプレビューで
 *    本番へ飛ぶし、リンクは全部リロードを伴う遷移になる。
 *
 * 2. 畳んだあとのサイト内リンクが実在する道かを確かめる。記事の綴りは
 *    ファイル名がそのまま URL なので、打ち間違いは 404 になるまで気づけない。
 *    ここで落としてビルドを止める。
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { BLOG_COLLECTION_DIRECTORY } from '../config/content';

const MARKDOWN_EXTENSION_PATTERN = /\.mdx?$/i;
const HTML_EXTENSION_PATTERN = /(?:\/index)?\.html$/i;

interface HastElement {
  type: string;
  tagName?: string;
  /** hast の properties は何でも入るが、ここが読むのは href だけ。 */
  properties?: { href?: string };
  children?: HastElement[];
}

interface VFileLike {
  path?: string;
}

export interface InternalLinkOptions {
  /** サイトの正典 origin。astro.config の `site`。 */
  site: string;
  /** 実在を確かめる道の一覧。省略時は記事のファイル名から作る。 */
  knownRoutes?: Iterable<string>;
}

/** 記事のファイル名 = URL の綴り。拡張子を落としただけのものが道になる。 */
export function readBlogSlugs(directory = BLOG_COLLECTION_DIRECTORY): string[] {
  return readdirSync(directory)
    .filter((entry) => MARKDOWN_EXTENSION_PATTERN.test(entry))
    .map((entry) => entry.replace(MARKDOWN_EXTENSION_PATTERN, ''));
}

/** 記事以外の固定ページ。`/tags/…` は語ごとに生えるので接頭辞で許す。 */
const STATIC_ROUTES = new Set(['/', '/about', '/404']);
const PREFIX_ROUTES = ['/tags/'];

/**
 * 1 本の href をサイト内の形へ畳む。外部リンク・メール・アンカーはそのまま。
 * 畳めたときだけ新しい値を返し、変える必要がなければ null を返す。
 */
export function foldInternalHref(href: string, site: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('/')) {
    return normalizeSitePath(trimmed);
  }

  // URL で分解して組み直すと、日本語の見出しを指すフラグメントが
  // %E8%A6%8B… に化ける。書いた字のまま残したいので、頭だけを文字列で削る。
  const parsed = /^(https?:)\/\/([^/?#]*)([\s\S]*)$/i.exec(trimmed);
  if (!parsed) {
    return null; // 相対パスやスキームなしはそのまま置いておく。
  }

  const [, , authority = '', rest = ''] = parsed;
  let siteHost: string;
  try {
    siteHost = stripWww(new URL(site).host);
  } catch {
    return null;
  }

  if (stripWww(authority) !== siteHost) {
    return null;
  }

  const folded = rest === '' ? '/' : rest.startsWith('/') ? rest : `/${rest}`;
  return normalizeSitePath(folded) ?? folded;
}

function stripWww(host: string) {
  return host.replace(/^www\./i, '').toLowerCase();
}

/** `.html` と末尾スラッシュを落とす。`/` 自身とアンカーだけの href は据え置き。 */
function normalizeSitePath(value: string): string | null {
  if (!value.startsWith('/')) {
    return null;
  }

  const [pathnameWithSearch, ...hashParts] = value.split('#');
  const hash = hashParts.length > 0 ? `#${hashParts.join('#')}` : '';
  const [pathname = '', ...searchParts] = (pathnameWithSearch ?? '').split('?');
  const search = searchParts.length > 0 ? `?${searchParts.join('?')}` : '';

  let normalized = pathname.replace(HTML_EXTENSION_PATTERN, '');
  if (normalized.length > 1) {
    normalized = normalized.replace(/\/+$/, '');
  }
  if (normalized === '') {
    normalized = '/';
  }

  const result = `${normalized}${search}${hash}`;
  return result === value ? null : result;
}

export function isKnownRoute(href: string, knownRoutes: ReadonlySet<string>): boolean {
  const pathname = href.split(/[?#]/)[0] ?? '';
  if (pathname === '') {
    return true; // 同じページ内のアンカー。
  }
  if (STATIC_ROUTES.has(pathname) || knownRoutes.has(pathname)) {
    return true;
  }

  return PREFIX_ROUTES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * rehype プラグイン本体。remark/rehype の型は astro 側から降ってこないので、
 * 最小限の hast だけを見る。
 */
export function rehypeInternalLinks(options: InternalLinkOptions) {
  const knownRoutes = new Set(
    [...(options.knownRoutes ?? readBlogSlugs())].map((slug) =>
      slug.startsWith('/') ? slug : `/${slug}`,
    ),
  );

  return (tree: HastElement, file?: VFileLike) => {
    const broken: string[] = [];
    visitAnchors(tree, (node) => {
      const properties = node.properties;
      const href = properties?.href;
      if (typeof href !== 'string') {
        return;
      }

      const folded = foldInternalHref(href, options.site);
      const resolved = folded ?? href;
      if (folded !== null && properties) {
        properties.href = folded;
      }

      if (resolved.startsWith('/') && !isKnownRoute(resolved, knownRoutes)) {
        broken.push(resolved);
      }
    });

    if (broken.length > 0) {
      const where = file?.path ? path.relative(process.cwd(), file.path) : 'a content file';
      throw new Error(
        `${where} links to ${broken.map((href) => `"${href}"`).join(', ')}, which is not a page on this site. ` +
          'Paste the address bar URL and it will be folded to a site path; a typo in the slug fails here instead of at runtime.',
      );
    }
  };
}

function visitAnchors(node: HastElement, visit: (node: HastElement) => void) {
  if (node.type === 'element' && node.tagName === 'a') {
    visit(node);
  }

  for (const child of node.children ?? []) {
    visitAnchors(child, visit);
  }
}
