import type { SiteLanguage } from '../../i18n/language';

export type { SiteLanguage };

export interface SearchCopy {
  closeSearch: string;
  error: string;
  indexLabel: string;
  loading: string;
  nearbyTerms: string;
  open: string;
  previewLabel: string;
  resultCount: (count: number) => string;
  resultsLabel: string;
  searchDialogLabel: string;
  searchLabel: string;
  searchPlaceholder: string;
  unavailable: string;
  voidStatus: (query: string) => string;
  voidTitle: (query: string) => string;
}

const SEARCH_COPY_BY_LANGUAGE: Record<SiteLanguage, SearchCopy> = {
  en: {
    closeSearch: 'Close search',
    error: 'Search failed to load.',
    indexLabel: 'Index of topics',
    loading: 'Opening the index…',
    nearbyTerms: 'Nearby in the index',
    open: 'Open',
    previewLabel: 'Selected article',
    resultCount: (count) => `${count} search result${count === 1 ? '' : 's'} available.`,
    resultsLabel: 'Search results',
    searchDialogLabel: 'Search',
    searchLabel: 'Search articles',
    searchPlaceholder: 'Search the index',
    unavailable: 'Search is unavailable until the Pagefind index has been built.',
    voidStatus: (query) => `Nothing in the index for ${query}.`,
    voidTitle: (query) => `Nothing in the index for “${query}”.`,
  },
  ja: {
    closeSearch: '検索を閉じる',
    error: '検索の読み込みに失敗しました。',
    indexLabel: 'トピックの索引',
    loading: '索引を開いています…',
    nearbyTerms: '索引の近く',
    open: '開く',
    previewLabel: '選んでいる記事',
    resultCount: (count) => `${count}件の検索結果があります。`,
    resultsLabel: '検索結果',
    searchDialogLabel: '検索',
    searchLabel: '記事を検索',
    searchPlaceholder: '索引を引く',
    unavailable: 'Pagefind のインデックスが未生成のため検索できません。',
    voidStatus: (query) => `${query} は索引にありません。`,
    voidTitle: (query) => `「${query}」は索引にありません。`,
  },
};

export function getSearchCopy(language: SiteLanguage | null | undefined): SearchCopy {
  if (language === 'ja') {
    return SEARCH_COPY_BY_LANGUAGE.ja;
  }

  return SEARCH_COPY_BY_LANGUAGE.en;
}

export function getPageLanguage(lang: string | null | undefined): SiteLanguage | null {
  const normalized = lang?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
  if (normalized === 'ja' || normalized.startsWith('ja-')) return 'ja';
  return null;
}
