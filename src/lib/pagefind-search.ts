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
  getPagefindUI?: () => PagefindUIConstructor | null;
  importPagefind?: (src: string) => Promise<void>;
  logError?: (phase: string, error: unknown) => void;
  mount: HTMLElement;
  mountSelector: string;
  nextFrame?: () => Promise<void>;
  pagefindSrc?: string;
  status: HTMLElement;
}

export interface PagefindSearchController {
  open(): Promise<SearchBootstrapResult>;
  syncStatus(): void;
}

const PAGEFIND_UI_PATH = '/pagefind/pagefind-ui.js';
const SITE_LANGUAGES = ['en', 'ja'] as const;
const JAPANESE_QUERY_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const WORDLIKE_QUERY_PATTERN = /[\p{Letter}\p{Number}]/u;

type SiteLanguage = (typeof SITE_LANGUAGES)[number];

export const SEARCH_INPUT_SELECTOR = '.pagefind-ui__search-input';
export const searchUnavailableMessage =
  'Search is unavailable until the Pagefind index has been built.';
export const searchErrorMessage = 'Search failed to load. Check the Pagefind integration.';

export function createPagefindSearchController(options: PagefindSearchControllerOptions) {
  const { browserWindow, mount, mountSelector, status } = options;
  const pagefindSrc =
    options.pagefindSrc ?? new URL(PAGEFIND_UI_PATH, browserWindow.location.origin).toString();
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

  ensureStatusObserver();

  return {
    async open() {
      if (getSearchField(mount)) {
        syncStatus();
        focusSearchField(mount);
        return { kind: 'ready' };
      }

      if (!bootstrapPromise) {
        renderLoading(mount);
        bootstrapPromise = bootstrap();
      }

      const result = await bootstrapPromise;
      if (result.kind !== 'ready') {
        bootstrapPromise = null;
      }

      syncStatus();
      if (result.kind === 'ready') {
        focusSearchField(mount);
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
        return renderUnavailable(mount);
      }

      const PagefindUI = getPagefindUI();
      if (!PagefindUI) {
        return renderError(
          mount,
          logError,
          'global registration',
          new Error('window.PagefindUI is unavailable after loading pagefind-ui.js.'),
        );
      }

      const pagefindOrigin = new URL(pagefindSrc).origin;
      const currentLanguage = getPageLanguage(browserWindow.document.documentElement.lang);
      const mergeIndex = buildMergedPagefindIndexes(pagefindSrc, currentLanguage);

      try {
        new PagefindUI({
          element: mountSelector,
          mergeIndex,
          processTerm: normalizePagefindSearchTerm,
          processResult: (result) => canonicalizePagefindResult(result, pagefindOrigin),
          showImages: false,
          showSubResults: true,
          autofocus: true,
          translations: {
            clear_search: 'Clear search',
            placeholder: 'Search articles…',
            search_label: 'Search articles',
          },
        });
      } catch (error) {
        return renderError(mount, logError, 'UI bootstrap', error);
      }

      await nextFrame();
      decorateSearchField(getSearchField(mount));
      syncStatus();
      return { kind: 'ready' };
    } finally {
      setBusy(mount, false);
    }
  }

  function ensureStatusObserver() {
    if (statusObserver) return;

    statusObserver = new MutationObserver(() => {
      decorateSearchField(getSearchField(mount));
      syncStatus();
    });
    statusObserver.observe(mount, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function syncStatus() {
    status.textContent = summarizeSearchStatus(mount);
  }
}

export function decorateSearchField(field: HTMLInputElement | null) {
  if (!field) return;

  field.setAttribute('aria-label', 'Search articles');
  field.setAttribute('autocomplete', 'off');
  field.setAttribute('name', 'search');
  field.setAttribute('placeholder', 'Search articles…');
}

export function summarizeSearchStatus(mount: ParentNode) {
  const loading = mount.querySelector<HTMLElement>('.search-loading')?.textContent?.trim();
  if (loading) return loading;

  const unavailable = mount.querySelector<HTMLElement>('.search-unavailable')?.textContent?.trim();
  if (unavailable) return unavailable;

  const error = mount.querySelector<HTMLElement>('.search-error')?.textContent?.trim();
  if (error) return error;

  const message = mount.querySelector<HTMLElement>('.pagefind-ui__message')?.textContent?.trim();
  if (message) return message;

  const resultCount = mount.querySelectorAll('.pagefind-ui__result').length;
  if (resultCount > 0) {
    return `${resultCount} search result${resultCount === 1 ? '' : 's'} available.`;
  }

  return '';
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

function focusSearchField(mount: ParentNode) {
  getSearchField(mount)?.focus();
}

function setBusy(mount: HTMLElement, isBusy: boolean) {
  mount.setAttribute('aria-busy', String(isBusy));
}

function renderLoading(mount: HTMLElement) {
  mount.innerHTML = '<p class="search-loading">Loading…</p>';
}

function renderUnavailable(mount: HTMLElement): SearchBootstrapResult {
  mount.innerHTML = `<p class="search-unavailable">${searchUnavailableMessage}</p>`;
  return { kind: 'unavailable', message: searchUnavailableMessage };
}

function renderError(
  mount: HTMLElement,
  logError: (phase: string, error: unknown) => void,
  phase: string,
  error: unknown,
): SearchBootstrapResult {
  logError(phase, error);
  mount.innerHTML = `<p class="search-error">${searchErrorMessage}</p>`;
  return { kind: 'error', message: searchErrorMessage };
}
