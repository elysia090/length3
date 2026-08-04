import type { SiteLanguage } from '../../i18n/language';

export type { SiteLanguage };

export interface SearchCopy {
  clearSearch: string;
  closeSearch: string;
  emptyBody: string;
  emptyStatus: string;
  emptyTitle: string;
  error: string;
  loading: string;
  resultCount: (count: number) => string;
  resultsLabel: string;
  searchDialogLabel: string;
  searchHintClose: string;
  searchHintNavigate: string;
  searchHintOpen: string;
  searchLabel: string;
  searchPlaceholder: string;
  unavailable: string;
}

const SEARCH_COPY_BY_LANGUAGE: Record<SiteLanguage, SearchCopy> = {
  en: {
    clearSearch: 'Clear search',
    closeSearch: 'Close search',
    emptyBody: 'Try a broader term or a topic label.',
    emptyStatus: 'No matching articles. Try a broader term or a topic label.',
    emptyTitle: 'No matching articles',
    error: 'Search failed to load. Check the Pagefind integration.',
    loading: 'Loading…',
    resultCount: (count) => `${count} search result${count === 1 ? '' : 's'} available.`,
    resultsLabel: 'Search results',
    searchDialogLabel: 'Search',
    searchHintClose: 'Esc close',
    searchHintNavigate: '↑↓ navigate',
    searchHintOpen: '↵ open',
    searchLabel: 'Search articles',
    searchPlaceholder: 'Search articles…',
    unavailable: 'Search is unavailable until the Pagefind index has been built.',
  },
  ja: {
    clearSearch: '検索をクリア',
    closeSearch: '検索を閉じる',
    emptyBody: 'より広い語句やトピック名で試してください。',
    emptyStatus: '一致する記事はありません。より広い語句やトピック名で試してください。',
    emptyTitle: '一致する記事はありません',
    error: '検索の読み込みに失敗しました。Pagefind の設定を確認してください。',
    loading: '読み込み中…',
    resultCount: (count) => `${count}件の検索結果があります。`,
    resultsLabel: '検索結果',
    searchDialogLabel: '検索',
    searchHintClose: 'Esc 閉じる',
    searchHintNavigate: '↑↓ 移動',
    searchHintOpen: '↵ 開く',
    searchLabel: '記事を検索',
    searchPlaceholder: '記事を検索…',
    unavailable: 'Pagefind のインデックスが未生成のため検索できません。',
  },
};

export const searchUnavailableMessage = SEARCH_COPY_BY_LANGUAGE.en.unavailable;
export const searchErrorMessage = SEARCH_COPY_BY_LANGUAGE.en.error;

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
