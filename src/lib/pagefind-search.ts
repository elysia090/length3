import type { SearchBootstrapResult } from './types';

export interface PagefindUIConstructor {
  new (options: {
    autofocus?: boolean;
    element: string;
    showImages?: boolean;
    showSubResults?: boolean;
    translations?: Record<string, string>;
  }): unknown;
}

export interface PagefindSearchControllerOptions {
  mount: HTMLElement;
  mountSelector: string;
  status: HTMLElement;
}

interface PagefindWindow extends Window {
  __FORCE_PAGEFIND_BOOTSTRAP__?: boolean;
  PagefindUI?: PagefindUIConstructor;
}

export interface SearchBootstrapDeps {
  forceBootstrap: boolean;
  getPagefindUI: () => PagefindUIConstructor | null;
  importPagefind: (src: string) => Promise<void>;
  isDev: boolean;
  isPagefindAvailable: (src: string) => Promise<boolean>;
  logError: (phase: string, error: unknown) => void;
  nextFrame: () => Promise<void>;
  pagefindSrc: string;
}

export interface PagefindSearchController {
  open(): Promise<SearchBootstrapResult>;
  syncStatus(): void;
}

const PAGEFIND_UI_PATH = '/pagefind/pagefind-ui.js';
const PAGEFIND_REQUEST_TIMEOUT_MS = 1500;

export const SEARCH_INPUT_SELECTOR = '.pagefind-ui__search-input';
export const searchUnavailableMessage = 'Search is only available in a built site.';
export const searchErrorMessage = 'Search failed to load. Check the Pagefind integration.';

export function createPagefindSearchController(
  { mount, mountSelector, status }: PagefindSearchControllerOptions,
  deps: SearchBootstrapDeps,
): PagefindSearchController {
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
  };

  async function bootstrap(): Promise<SearchBootstrapResult> {
    setBusy(mount, true);

    try {
      if (deps.isDev && !deps.forceBootstrap) {
        return renderUnavailable(mount);
      }

      if (!(await deps.isPagefindAvailable(deps.pagefindSrc))) {
        return renderUnavailable(mount);
      }

      try {
        await deps.importPagefind(deps.pagefindSrc);
      } catch (error) {
        return renderError(mount, deps, 'module import', error);
      }

      const PagefindUI = deps.getPagefindUI();
      if (!PagefindUI) {
        return renderError(
          mount,
          deps,
          'global registration',
          new Error('window.PagefindUI is unavailable after loading pagefind-ui.js.'),
        );
      }

      try {
        new PagefindUI({
          element: mountSelector,
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
        return renderError(mount, deps, 'UI bootstrap', error);
      }

      await deps.nextFrame();
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

export function createBrowserSearchBootstrapDeps({
  browserWindow,
  isDev,
}: {
  browserWindow: PagefindWindow;
  isDev: boolean;
}): SearchBootstrapDeps {
  return {
    forceBootstrap: Boolean(browserWindow.__FORCE_PAGEFIND_BOOTSTRAP__),
    getPagefindUI: () =>
      typeof browserWindow.PagefindUI === 'function' ? browserWindow.PagefindUI : null,
    importPagefind: (src) => import(/* @vite-ignore */ src),
    isDev,
    isPagefindAvailable: (src) => isPagefindAvailable(browserWindow, src),
    logError: (phase, error) => {
      console.error(`Pagefind search ${phase} failed.`, error);
    },
    nextFrame: () =>
      new Promise<void>((resolve) => browserWindow.requestAnimationFrame(() => resolve())),
    pagefindSrc: new URL(PAGEFIND_UI_PATH, browserWindow.location.origin).toString(),
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
  deps: SearchBootstrapDeps,
  phase: string,
  error: unknown,
): SearchBootstrapResult {
  deps.logError(phase, error);
  mount.innerHTML = `<p class="search-error">${searchErrorMessage}</p>`;
  return { kind: 'error', message: searchErrorMessage };
}

async function isPagefindAvailable(browserWindow: PagefindWindow, pagefindSrc: string) {
  const controller = new AbortController();
  const timeoutId = browserWindow.setTimeout(() => controller.abort(), PAGEFIND_REQUEST_TIMEOUT_MS);

  try {
    const response = await browserWindow.fetch(pagefindSrc, {
      headers: { accept: 'text/javascript' },
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') ?? '';
    return response.ok && /(javascript|ecmascript)/i.test(contentType);
  } catch {
    return false;
  } finally {
    browserWindow.clearTimeout(timeoutId);
  }
}
