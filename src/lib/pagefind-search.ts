import type { SearchBootstrapResult } from './types';

export interface PagefindUIConstructor {
  new (options: {
    autofocus?: boolean;
    element: string;
    mergeIndex?: PagefindMergeIndex[];
    processTerm?: (term: string) => string;
    processResult?: (result: PagefindSearchResult) => PagefindSearchResult;
    showImages?: boolean;
    showSubResults?: boolean;
    translations?: Record<string, string>;
  }): unknown;
}

interface PagefindWindow extends Window {
  PagefindUI?: PagefindUIConstructor;
}

export interface PagefindSearchResult {
  excerpt?: string;
  filters?: Record<string, string[]>;
  meta?: Record<string, string | undefined>;
  sub_results?: unknown[];
  url: string;
}

export interface PagefindMergeIndex {
  bundlePath: string;
  language: SiteLanguage;
}

export interface PagefindSearchControllerOptions {
  browserWindow: PagefindWindow;
  emptyState?: HTMLElement | null;
  focusMode?: PagefindSearchFocusMode;
  getPagefindUI?: () => PagefindUIConstructor | null;
  importPagefind?: (src: string) => Promise<void>;
  language?: SiteLanguage | null;
  logError?: (phase: string, error: unknown) => void;
  mount: HTMLElement;
  mountSelector: string;
  nextFrame?: () => Promise<void>;
  pagefindSrc?: string;
  status: HTMLElement;
}

export interface PagefindSearchController {
  close(): void;
  open(): Promise<SearchBootstrapResult>;
  syncStatus(): void;
}

const PAGEFIND_UI_PATH = '/pagefind/pagefind-ui.js';
const SITE_LANGUAGES = ['en', 'ja'] as const;
const JAPANESE_QUERY_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const WORDLIKE_QUERY_PATTERN = /[\p{Letter}\p{Number}]/u;
const SEARCH_EMPTY_MESSAGE_PATTERN = /^No results for\b/i;
const DESKTOP_FOCUS_MEDIA_QUERY = '(hover: hover) and (pointer: fine)';

export type SiteLanguage = (typeof SITE_LANGUAGES)[number];
export type PagefindSearchFocusMode = 'always' | 'desktop-only' | 'never';

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
  searchHintMobileOpen: string;
  searchHintNavigate: string;
  searchHintOpen: string;
  searchLabel: string;
  searchPlaceholder: string;
  unavailable: string;
}

type SearchUiState =
  | { kind: 'idle'; message: string }
  | { kind: 'loading'; message: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'empty'; message: string }
  | { kind: 'results'; count: number; message: string };

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
    searchHintMobileOpen: 'Tap a result to open',
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
    searchHintMobileOpen: '結果をタップして開く',
    searchHintNavigate: '↑↓ 移動',
    searchHintOpen: '↵ 開く',
    searchLabel: '記事を検索',
    searchPlaceholder: '記事を検索…',
    unavailable: 'Pagefind のインデックスが未生成のため検索できません。',
  },
};

export const SEARCH_INPUT_SELECTOR = '.pagefind-ui__search-input';
export const searchUnavailableMessage = SEARCH_COPY_BY_LANGUAGE.en.unavailable;
export const searchErrorMessage = SEARCH_COPY_BY_LANGUAGE.en.error;

export function getSearchCopy(language: SiteLanguage | null | undefined): SearchCopy {
  if (language === 'ja') {
    return SEARCH_COPY_BY_LANGUAGE.ja;
  }

  return SEARCH_COPY_BY_LANGUAGE.en;
}

export function createPagefindSearchController(options: PagefindSearchControllerOptions) {
  const { browserWindow, mount, mountSelector, status } = options;
  const emptyState = options.emptyState ?? null;
  const pagefindSrc =
    options.pagefindSrc ?? new URL(PAGEFIND_UI_PATH, browserWindow.location.origin).toString();
  const language =
    options.language ?? getPageLanguage(browserWindow.document.documentElement.lang) ?? 'en';
  const copy = getSearchCopy(language);
  const focusMode = options.focusMode ?? 'desktop-only';
  const getPagefindUI =
    options.getPagefindUI ??
    (() => (typeof browserWindow.PagefindUI === 'function' ? browserWindow.PagefindUI : null));
  const importPagefind =
    options.importPagefind ?? ((src: string) => import(/* @vite-ignore */ src));
  const logError =
    options.logError ??
    ((phase: string, error: unknown) => {
      console.error(`Pagefind search ${phase} failed.`, error);
    });
  const nextFrame =
    options.nextFrame ??
    (() => new Promise<void>((resolve) => browserWindow.requestAnimationFrame(() => resolve())));
  let bootstrapPromise: Promise<SearchBootstrapResult> | null = null;
  let statusObserver: MutationObserver | null = null;
  let observerConnected = false;

  return {
    close() {
      stopObserving();
    },
    async open() {
      if (getSearchField(mount)) {
        ensureStatusObserver();
        syncUiState();
        focusSearchFieldIfNeeded(browserWindow, mount, focusMode);
        return { kind: 'ready' };
      }

      if (!bootstrapPromise) {
        renderLoading(mount, copy);
        syncStatus();
        bootstrapPromise = bootstrap();
      }

      const result = await bootstrapPromise;
      if (result.kind !== 'ready') {
        bootstrapPromise = null;
      }

      syncStatus();
      if (result.kind === 'ready') {
        focusSearchFieldIfNeeded(browserWindow, mount, focusMode);
      }
      return result;
    },
    syncStatus,
  } satisfies PagefindSearchController;

  async function bootstrap(): Promise<SearchBootstrapResult> {
    setBusy(mount, true);

    try {
      try {
        await importPagefind(pagefindSrc);
      } catch (_error) {
        return renderUnavailable(mount, copy);
      }

      const PagefindUI = getPagefindUI();
      if (!PagefindUI) {
        return renderError(
          mount,
          logError,
          'global registration',
          new Error('window.PagefindUI is unavailable after loading pagefind-ui.js.'),
          copy,
        );
      }

      const pagefindOrigin = new URL(pagefindSrc).origin;
      const currentLanguage = getPageLanguage(browserWindow.document.documentElement.lang);
      const mergeIndex = buildMergedPagefindIndexes(pagefindSrc, currentLanguage);

      try {
        clearBootstrapMessages(mount);
        new PagefindUI({
          element: mountSelector,
          mergeIndex,
          processTerm: normalizePagefindSearchTerm,
          processResult: (result) => canonicalizePagefindResult(result, pagefindOrigin),
          showImages: false,
          showSubResults: true,
          autofocus: false,
          translations: {
            clear_search: copy.clearSearch,
            placeholder: copy.searchPlaceholder,
            search_label: copy.searchLabel,
          },
        });
      } catch (error) {
        return renderError(mount, logError, 'UI bootstrap', error, copy);
      }

      await nextFrame();
      ensureStatusObserver();
      syncUiState();
      return { kind: 'ready' };
    } finally {
      setBusy(mount, false);
    }
  }

  function syncStatus() {
    const state = deriveSearchUiState(mount, copy);
    mount.dataset.searchState = state.kind;
    status.textContent = state.message;
  }

  function ensureStatusObserver() {
    if (!statusObserver) {
      statusObserver = new MutationObserver(() => {
        syncUiState();
      });
    }

    startObserving();
  }

  function startObserving() {
    if (!statusObserver || observerConnected) return;

    statusObserver.observe(mount, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    observerConnected = true;
  }

  function stopObserving() {
    if (!statusObserver || !observerConnected) return;

    statusObserver.disconnect();
    observerConnected = false;
  }

  function syncUiState() {
    stopObserving();
    try {
      decorateSearchUi(mount, copy, emptyState);
      syncStatus();
    } finally {
      startObserving();
    }
  }
}

export function decorateSearchField(field: HTMLInputElement | null, copy: SearchCopy) {
  if (!field) return;

  field.setAttribute('aria-label', copy.searchLabel);
  field.setAttribute('autocomplete', 'off');
  field.setAttribute('name', 'search');
  field.setAttribute('placeholder', copy.searchPlaceholder);
}

export function decorateSearchUi(
  mount: ParentNode,
  copy: SearchCopy,
  emptyState?: HTMLElement | null,
) {
  clearBootstrapMessages(mount);
  decorateSearchField(getSearchField(mount), copy);
  decorateSearchMessage(
    mount.querySelector<HTMLElement>('.pagefind-ui__message'),
    emptyState ?? null,
  );
}

export function summarizeSearchStatus(mount: ParentNode, language?: SiteLanguage | null) {
  const resolvedLanguage = language ?? getPageLanguage(mount.ownerDocument?.documentElement.lang);
  return deriveSearchUiState(mount, getSearchCopy(resolvedLanguage)).message;
}

export function getPageLanguage(lang: string | null | undefined): SiteLanguage | null {
  const normalized = lang?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
  if (normalized === 'ja' || normalized.startsWith('ja-')) return 'ja';
  return null;
}

export function buildMergedPagefindIndexes(
  pagefindSrc: string,
  currentLanguage: SiteLanguage | null,
): PagefindMergeIndex[] {
  if (!currentLanguage) {
    return [];
  }

  const bundlePath = new URL('./', pagefindSrc).toString();
  return SITE_LANGUAGES.filter((language) => language !== currentLanguage).map((language) => ({
    bundlePath,
    language,
  }));
}

export function normalizePagefindSearchTerm(term: string) {
  const trimmed = term.trim();
  if (!trimmed || !JAPANESE_QUERY_PATTERN.test(trimmed)) {
    return trimmed;
  }

  const quoted = trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1;
  const rawTerm = quoted ? trimmed.slice(1, -1).trim() : trimmed;
  if (!rawTerm) {
    return trimmed;
  }

  const Segmenter = globalThis.Intl?.Segmenter;
  if (typeof Segmenter !== 'function') {
    return trimmed;
  }

  const segments = Array.from(new Segmenter('ja', { granularity: 'word' }).segment(rawTerm))
    .filter((segment) => segment.isWordLike || WORDLIKE_QUERY_PATTERN.test(segment.segment))
    .map((segment) => segment.segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return trimmed;
  }

  const normalized = segments.join(' ');
  return quoted ? `"${normalized}"` : normalized;
}

export function canonicalizePagefindResultUrl(url: string, origin: string) {
  try {
    const resolved = new URL(url, origin);
    if (resolved.origin !== origin) {
      return url;
    }

    if (resolved.pathname === '/index.html') {
      return `/${resolved.search}${resolved.hash}`;
    }

    if (resolved.pathname.endsWith('/index.html')) {
      const pathname = resolved.pathname.slice(0, -'/index.html'.length) || '/';
      return `${pathname}${resolved.search}${resolved.hash}`;
    }

    if (resolved.pathname.endsWith('.html')) {
      const pathname = resolved.pathname.slice(0, -'.html'.length) || '/';
      return `${pathname}${resolved.search}${resolved.hash}`;
    }
  } catch {
    return url;
  }

  return url;
}

export function canonicalizePagefindResult(result: PagefindSearchResult, origin: string) {
  const normalizedUrl = canonicalizePagefindResultUrl(result.url, origin);
  const normalizedMetaUrl = result.meta?.url
    ? canonicalizePagefindResultUrl(result.meta.url, origin)
    : undefined;
  const normalizedSubResults = result.sub_results?.map((subResult) =>
    canonicalizePagefindSubResult(subResult, origin),
  );

  return {
    ...result,
    meta:
      normalizedMetaUrl || result.meta
        ? {
            ...result.meta,
            ...(normalizedMetaUrl ? { url: normalizedMetaUrl } : {}),
          }
        : result.meta,
    sub_results: normalizedSubResults ?? result.sub_results,
    url: normalizedUrl,
  };
}

function canonicalizePagefindSubResult(subResult: unknown, origin: string) {
  if (!subResult || typeof subResult !== 'object') {
    return subResult;
  }

  const candidate = subResult as {
    meta?: Record<string, string | undefined>;
    url?: string;
  };
  const normalizedUrl =
    typeof candidate.url === 'string'
      ? canonicalizePagefindResultUrl(candidate.url, origin)
      : undefined;
  const normalizedMetaUrl =
    typeof candidate.meta?.url === 'string'
      ? canonicalizePagefindResultUrl(candidate.meta.url, origin)
      : undefined;

  return {
    ...candidate,
    meta:
      normalizedMetaUrl || candidate.meta
        ? {
            ...candidate.meta,
            ...(normalizedMetaUrl ? { url: normalizedMetaUrl } : {}),
          }
        : candidate.meta,
    ...(normalizedUrl ? { url: normalizedUrl } : {}),
  };
}

function getSearchField(mount: ParentNode) {
  return mount.querySelector<HTMLInputElement>(SEARCH_INPUT_SELECTOR);
}

function clearBootstrapMessages(mount: ParentNode) {
  if (!mount.querySelector('.pagefind-ui, .pagefind-ui__form')) {
    return;
  }

  for (const message of mount.querySelectorAll('.search-loading')) {
    message.remove();
  }
}

function decorateSearchMessage(message: HTMLElement | null, emptyState: HTMLElement | null) {
  if (!message) {
    syncEmptyState(emptyState, false);
    return;
  }

  const currentText = message.textContent?.trim() ?? '';
  if (currentText) {
    message.dataset.searchMessageSource = currentText;
  }

  const sourceText = message.dataset.searchMessageSource ?? currentText;
  if (SEARCH_EMPTY_MESSAGE_PATTERN.test(sourceText)) {
    message.dataset.searchMessageKind = 'empty';
    message.hidden = true;
    syncEmptyState(emptyState, true);
    return;
  }

  delete message.dataset.searchMessageKind;
  delete message.dataset.searchMessageSource;
  message.hidden = false;
  syncEmptyState(emptyState, false);
}

function focusSearchField(mount: ParentNode) {
  getSearchField(mount)?.focus();
}

function focusSearchFieldIfNeeded(
  browserWindow: PagefindWindow,
  mount: ParentNode,
  focusMode: PagefindSearchFocusMode,
) {
  if (!shouldFocusSearchField(browserWindow, focusMode)) {
    return;
  }

  focusSearchField(mount);
}

function shouldFocusSearchField(browserWindow: PagefindWindow, focusMode: PagefindSearchFocusMode) {
  if (focusMode === 'never') return false;
  if (focusMode === 'always') return true;
  if (typeof browserWindow.matchMedia !== 'function') return true;

  return browserWindow.matchMedia(DESKTOP_FOCUS_MEDIA_QUERY).matches;
}

function setBusy(mount: HTMLElement, isBusy: boolean) {
  mount.setAttribute('aria-busy', String(isBusy));
}

function renderLoading(mount: HTMLElement, copy: SearchCopy) {
  mount.innerHTML = `<p class="search-loading">${copy.loading}</p>`;
}

function renderUnavailable(mount: HTMLElement, copy: SearchCopy): SearchBootstrapResult {
  mount.innerHTML = `<p class="search-unavailable">${copy.unavailable}</p>`;
  return { kind: 'unavailable', message: copy.unavailable };
}

function renderError(
  mount: HTMLElement,
  logError: (phase: string, error: unknown) => void,
  phase: string,
  error: unknown,
  copy: SearchCopy,
): SearchBootstrapResult {
  logError(phase, error);
  mount.innerHTML = `<p class="search-error">${copy.error}</p>`;
  return { kind: 'error', message: copy.error };
}

function deriveSearchUiState(mount: ParentNode, copy: SearchCopy): SearchUiState {
  const unavailable = mount.querySelector<HTMLElement>('.search-unavailable')?.textContent?.trim();
  if (unavailable) {
    return { kind: 'unavailable', message: unavailable };
  }

  const error = mount.querySelector<HTMLElement>('.search-error')?.textContent?.trim();
  if (error) {
    return { kind: 'error', message: error };
  }

  const loading = mount.querySelector<HTMLElement>('.search-loading')?.textContent?.trim();
  if (loading) {
    return { kind: 'loading', message: loading };
  }

  const emptyMessage = mount.querySelector<HTMLElement>(
    '.pagefind-ui__message[data-search-message-kind="empty"]',
  );
  if (emptyMessage) {
    return {
      kind: 'empty',
      message: copy.emptyStatus,
    };
  }

  const resultCount = mount.querySelectorAll('.pagefind-ui__result').length;
  if (resultCount > 0) {
    return {
      kind: 'results',
      count: resultCount,
      message: copy.resultCount(resultCount),
    };
  }

  const message = mount
    .querySelector<HTMLElement>('.pagefind-ui__message:not([hidden])')
    ?.textContent?.trim();
  if (message) {
    return { kind: 'idle', message };
  }

  return { kind: 'idle', message: '' };
}

function syncEmptyState(emptyState: HTMLElement | null, isEmpty: boolean) {
  if (!emptyState) return;

  emptyState.hidden = !isEmpty;
}
