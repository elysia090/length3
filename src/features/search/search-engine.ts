import { toConcordance } from './concordance';
import {
  canonicalizePagefindResult,
  normalizePagefindSearchTerm,
  type PagefindSearchResult,
} from './pagefind-text';

/**
 * Pagefind の素の API（pagefind.js）を、検索画面が使う形に包む。出来合いの
 * UI（pagefind-ui.js）は使わない。並びも見た目もこちらで組むため。
 *
 * 結果は 1 件ずつ、道筋・記事の slug・題・用語索引に組んだ抜粋・一致した
 * 節（見出しへの道筋つき）にして返す。打つ速さに追い越された問い合わせは
 * null を返す（古い結果で画面を塗り替えない）。
 */

export interface SearchSection {
  title: string;
  url: string;
  excerpt: string;
}

export interface SearchHit {
  url: string;
  slug: string;
  title: string;
  excerpt: string;
  sections: SearchSection[];
}

export interface SearchEngine {
  search(query: string): Promise<SearchHit[] | null>;
}

interface PagefindModule {
  options(options: Record<string, unknown>): Promise<void>;
  init(): Promise<void>;
  debouncedSearch(
    term: string,
    options?: Record<string, unknown>,
    debounceMs?: number,
  ): Promise<{ results: { data(): Promise<PagefindSearchResult> }[] } | null>;
}

export const PAGEFIND_PATH = '/pagefind/pagefind.js';
export const MAX_HITS = 24;
const DEBOUNCE_MS = 120;

export function slugOf(url: string): string {
  return url.replace(/[#?].*$/, '').replace(/^\/+|\/+$/g, '');
}

export function toHit(raw: PagefindSearchResult, origin: string): SearchHit {
  const r = canonicalizePagefindResult(raw, origin);
  const sections = (r.sub_results ?? []).flatMap((s) =>
    s.title && s.url?.includes('#')
      ? [{ title: s.title, url: s.url, excerpt: toConcordance(s.excerpt) ?? '' }]
      : [],
  );
  return {
    url: r.url,
    slug: slugOf(r.url),
    title: r.meta?.title ?? slugOf(r.url),
    excerpt: toConcordance(r.excerpt) ?? '',
    sections,
  };
}

export async function loadSearchEngine(
  src: string,
  importer: (src: string) => Promise<unknown> = (s) => import(/* @vite-ignore */ s),
): Promise<SearchEngine> {
  const pagefind = (await importer(src)) as PagefindModule;
  await pagefind.options({ excerptLength: 24 });
  await pagefind.init();
  const origin = new URL(src, window.location.href).origin;
  return {
    async search(query) {
      const term = normalizePagefindSearchTerm(query);
      if (!term) return [];
      const found = await pagefind.debouncedSearch(term, {}, DEBOUNCE_MS);
      if (!found) return null;
      const data = await Promise.all(found.results.slice(0, MAX_HITS).map((r) => r.data()));
      return data.map((d) => toHit(d, origin));
    },
  };
}
