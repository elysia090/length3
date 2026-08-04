import type { SiteLanguage } from '../../i18n/language';
import { startBenchProfile } from '../../shared/bench-profile';
import {
  getPageLanguage,
  getSearchCopy,
  type SearchCopy,
  searchErrorMessage,
  searchUnavailableMessage,
} from './search-copy';
import type { SearchBootstrapResult } from './types';

export interface PagefindUIOptions {
  autofocus?: boolean;
  element: string;
  mergeIndex?: PagefindMergeIndex[];
  processTerm?: (term: string) => string;
  processResult?: (result: PagefindSearchResult) => PagefindSearchResult;
  showImages?: boolean;
  showSubResults?: boolean;
  translations?: Record<string, string>;
}

export interface PagefindUIConstructor {
  new (options: PagefindUIOptions): unknown;
}

interface PagefindWindow extends Window {
  PagefindUI?: PagefindUIConstructor;
}

export interface PagefindResultMeta {
  [key: string]: string | undefined;
  url?: string;
}

export interface PagefindSearchSubResult {
  excerpt?: string;
  meta?: PagefindResultMeta;
  title?: string;
  url?: string;
}

export interface PagefindSearchResult {
  excerpt?: string;
  filters?: Record<string, string[]>;
  meta?: PagefindResultMeta;
  sub_results?: PagefindSearchSubResult[];
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
const JAPANESE_QUERY_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const WORDLIKE_QUERY_PATTERN = /[\p{Letter}\p{Number}]/u;
const SEARCH_EMPTY_MESSAGE_PATTERN = /^No results for\b/i;
const DESKTOP_FOCUS_MEDIA_QUERY = '(hover: hover) and (pointer: fine)';

export type PagefindSearchFocusMode = 'always' | 'desktop-only' | 'never';

type SearchUiState =
  | { kind: 'idle'; message: string }
  | { kind: 'loading'; message: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'empty'; message: string }
  | { kind: 'results'; count: number; message: string };

export type { SearchCopy, SiteLanguage };
export { getPageLanguage, getSearchCopy, searchErrorMessage, searchUnavailableMessage };

export const SEARCH_INPUT_SELECTOR = '.pagefind-ui__search-input';
const SEARCH_CLEAR_SELECTOR = '.pagefind-ui__search-clear';
const SEARCH_FORM_SELECTOR = '.pagefind-ui__form';
const SEARCH_RESULTS_AREA_SELECTOR = '.pagefind-ui__results-area';
const SEARCH_RESULTS_DRAWER_SELECTOR = '.pagefind-ui__drawer';
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
      const finishProfile = startBenchProfile('search.open', {
        language,
        warm: Boolean(getSearchField(mount)),
      });

      try {
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
      } finally {
        finishProfile();
      }
    },
    syncStatus,
  } satisfies PagefindSearchController;

  async function bootstrap(): Promise<SearchBootstrapResult> {
    const finishProfile = startBenchProfile('search.bootstrap.total', { language });
    setBusy(mount, true);

    try {
      try {
        const finishImport = startBenchProfile('search.bootstrap.importPagefind', { language });
        try {
          await importPagefind(pagefindSrc);
        } finally {
          finishImport();
        }
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
        const finishConstruct = startBenchProfile('search.bootstrap.constructUi', {
          language,
          mergeIndexCount: mergeIndex.length,
        });
        try {
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
        } finally {
          finishConstruct();
        }
      } catch (error) {
        return renderError(mount, logError, 'UI bootstrap', error, copy);
      }

      const finishNextFrame = startBenchProfile('search.bootstrap.nextFrame');
      try {
        await nextFrame();
      } finally {
        finishNextFrame();
      }
      ensureStatusObserver();
      syncUiState();
      return { kind: 'ready' };
    } finally {
      setBusy(mount, false);
      finishProfile();
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
    const finishProfile = startBenchProfile('search.syncUiState');
    stopObserving();
    try {
      decorateSearchUi(mount, copy, emptyState);
      syncStatus();
    } finally {
      startObserving();
      finishProfile();
    }
  }
}

export function decorateSearchField(field: HTMLInputElement | null, copy: SearchCopy) {
  if (!field) return;

  field.setAttribute('aria-label', copy.searchLabel);
  field.setAttribute('autocomplete', 'off');
  field.setAttribute('enterkeyhint', 'search');
  field.setAttribute('inputmode', 'search');
  field.setAttribute('name', 'search');
  field.setAttribute('placeholder', copy.searchPlaceholder);
  field.setAttribute('spellcheck', 'false');
  field.dataset.searchRegion = 'input';
}

export function decorateSearchUi(
  mount: ParentNode,
  copy: SearchCopy,
  emptyState?: HTMLElement | null,
) {
  clearBootstrapMessages(mount);
  decorateSearchLayout(mount, copy);
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
export function buildMergedPagefindIndexes(
  _pagefindSrc: string,
  _currentLanguage: SiteLanguage | null,
): PagefindMergeIndex[] {
  // The custom segmented-pagefind integration writes a single search bundle that
  // already contains both English content and pre-segmented Japanese content.
  // Merging per-language indexes would duplicate results.
  return [];
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

export function restoreSegmentedJapaneseText(value: string | undefined) {
  if (!value?.includes(' ') || !JAPANESE_QUERY_PATTERN.test(value)) {
    return value;
  }

  return value
    .replace(
      /(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu,
      '',
    )
    .replace(/(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])\s+(?=<mark\b)/gu, '')
    .replace(/(?<=<\/mark>)\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu, '')
    .replace(/(?<=<\/mark>)\s+(?=<mark\b)/gu, '')
    .replace(
      /(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])\s+(?=[、。，．！？：；」』）〉》】])/gu,
      '',
    )
    .replace(
      /(?<=[「『（〈《【])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu,
      '',
    )
    .replace(/(?<=[「『（〈《【])\s+(?=<mark\b)/gu, '')
    .replace(/(?<=<\/mark>)\s+(?=[、。，．！？：；」』）〉》】])/gu, '');
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

    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return url;
  }
}

export function canonicalizePagefindResult(result: PagefindSearchResult, origin: string) {
  const normalizedUrl = canonicalizePagefindResultUrl(result.url, origin);
  const normalizedMeta = canonicalizePagefindMeta(result.meta, origin);
  const normalizedSubResults = result.sub_results?.map((subResult) =>
    canonicalizePagefindSubResult(subResult, origin),
  );

  return {
    ...result,
    excerpt: restoreSegmentedJapaneseText(result.excerpt),
    meta: normalizedMeta,
    sub_results: normalizedSubResults ?? result.sub_results,
    url: normalizedUrl,
  };
}

function canonicalizePagefindMeta(meta: PagefindResultMeta | undefined, origin: string) {
  if (!meta) {
    return meta;
  }

  const normalizedMeta: PagefindResultMeta = { ...meta };
  for (const [key, value] of Object.entries(normalizedMeta)) {
    if (key === 'url' || typeof value !== 'string') {
      continue;
    }

    normalizedMeta[key] = restoreSegmentedJapaneseText(value);
  }

  if (typeof meta.url === 'string') {
    normalizedMeta.url = canonicalizePagefindResultUrl(meta.url, origin);
  }

  return normalizedMeta;
}

function canonicalizePagefindSubResult(subResult: PagefindSearchSubResult, origin: string) {
  const normalizedUrl =
    typeof subResult.url === 'string'
      ? canonicalizePagefindResultUrl(subResult.url, origin)
      : subResult.url;

  return {
    ...subResult,
    excerpt: restoreSegmentedJapaneseText(subResult.excerpt),
    meta: canonicalizePagefindMeta(subResult.meta, origin),
    title: restoreSegmentedJapaneseText(subResult.title),
    ...(normalizedUrl ? { url: normalizedUrl } : {}),
  };
}

function getSearchField(mount: ParentNode) {
  return mount.querySelector<HTMLInputElement>(SEARCH_INPUT_SELECTOR);
}

function getSearchClearButton(mount: ParentNode) {
  return mount.querySelector<HTMLButtonElement>(SEARCH_CLEAR_SELECTOR);
}

function getSearchForm(mount: ParentNode) {
  return mount.querySelector<HTMLFormElement>(SEARCH_FORM_SELECTOR);
}

function getSearchResultsArea(mount: ParentNode) {
  return mount.querySelector<HTMLElement>(SEARCH_RESULTS_AREA_SELECTOR);
}

function getSearchResultsDrawer(mount: ParentNode) {
  return mount.querySelector<HTMLElement>(SEARCH_RESULTS_DRAWER_SELECTOR);
}

function decorateSearchLayout(mount: ParentNode, copy: SearchCopy) {
  getSearchForm(mount)?.setAttribute('data-search-layout', 'stack');

  const clearButton = getSearchClearButton(mount);
  if (clearButton) {
    clearButton.setAttribute('data-search-region', 'clear');
    // ボタンは入力欄の中の × として描くのでラベル文字列は表示しない。
    // 読み上げ名が消えないよう aria-label を明示する。
    clearButton.setAttribute('aria-label', copy.clearSearch);
  }

  getSearchResultsArea(mount)?.setAttribute('data-search-region', 'results-area');

  const resultsDrawer = getSearchResultsDrawer(mount);
  if (!resultsDrawer) {
    return;
  }

  resultsDrawer.dataset.searchRegion = 'results';
  resultsDrawer.dataset.searchScrollable = 'true';
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
  } else {
    // Message text was cleared by Pagefind (e.g. between merged-index updates).
    // Discard any stale source so the previous "No results" label cannot
    // re-trigger the empty state while results are arriving.
    delete message.dataset.searchMessageSource;
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

function renderMessage(mount: HTMLElement, className: string, text: string) {
  const p = mount.ownerDocument.createElement('p');
  p.className = className;
  p.textContent = text;
  mount.replaceChildren(p);
}

function renderLoading(mount: HTMLElement, copy: SearchCopy) {
  renderMessage(mount, 'search-loading', copy.loading);
}

function renderUnavailable(mount: HTMLElement, copy: SearchCopy): SearchBootstrapResult {
  renderMessage(mount, 'search-unavailable', copy.unavailable);
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
  renderMessage(mount, 'search-error', copy.error);
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
