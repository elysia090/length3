// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  buildMergedPagefindIndexes,
  createPagefindSearchController,
  decorateSearchUi,
  getSearchCopy,
  normalizePagefindSearchTerm,
  type PagefindSearchControllerOptions,
  type PagefindSearchResult,
  type PagefindUIConstructor,
  searchErrorMessage,
  searchUnavailableMessage,
  summarizeSearchStatus,
} from './pagefind-search';

function createSearchDom(lang: 'en' | 'ja' = 'en') {
  const copy = getSearchCopy(lang);
  document.documentElement.lang = lang;
  document.body.innerHTML = `
    <div id="pagefind-ui"></div>
    <div id="search-empty-state" hidden>
      <p class="search-empty-title">${copy.emptyTitle}</p>
      <p class="search-empty-body">${copy.emptyBody}</p>
    </div>
    <p id="search-status"></p>
  `;

  return {
    emptyState: document.getElementById('search-empty-state') as HTMLElement,
    mount: document.getElementById('pagefind-ui') as HTMLElement,
    status: document.getElementById('search-status') as HTMLElement,
  };
}

function setMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
}

function createOptions(
  overrides: Partial<PagefindSearchControllerOptions> = {},
): PagefindSearchControllerOptions {
  return {
    browserWindow: window,
    getPagefindUI: () => null,
    importPagefind: async () => {},
    logError: vi.fn(),
    emptyState: document.getElementById('search-empty-state') as HTMLElement,
    mount: document.getElementById('pagefind-ui') as HTMLElement,
    mountSelector: '#pagefind-ui',
    nextFrame: async () => {},
    pagefindSrc: 'https://example.test/pagefind/pagefind-ui.js',
    status: document.getElementById('search-status') as HTMLElement,
    ...overrides,
  };
}

async function flushMutationObserver() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('createPagefindSearchController', () => {
  it('renders the unavailable state when importing Pagefind fails', async () => {
    const { mount, status } = createSearchDom();
    const logError = vi.fn();
    const controller = createPagefindSearchController(
      createOptions({
        importPagefind: async () => {
          throw new Error('import failed');
        },
        logError,
        mount,
        status,
      }),
    );

    await expect(controller.open()).resolves.toEqual({
      kind: 'unavailable',
      message: searchUnavailableMessage,
    });
    expect(logError).not.toHaveBeenCalled();
    expect(mount.textContent).toContain(searchUnavailableMessage);
    expect(status.textContent).toBe(searchUnavailableMessage);
  });

  it('surfaces missing global registration as an integration error', async () => {
    const { mount, status } = createSearchDom();
    const logError = vi.fn();
    const controller = createPagefindSearchController(
      createOptions({
        getPagefindUI: () => null,
        logError,
        mount,
        status,
      }),
    );

    await expect(controller.open()).resolves.toEqual({
      kind: 'error',
      message: searchErrorMessage,
    });
    expect(logError).toHaveBeenCalledWith('global registration', expect.any(Error));
  });

  it('decorates the generated search input and reports result count on desktop', async () => {
    const { mount, status } = createSearchDom();
    setMatchMedia(true);
    const PagefindUIMock = vi.fn(function PagefindUI(this: unknown) {
      mount.innerHTML = `
        <input class="pagefind-ui__search-input" />
        <ol class="pagefind-ui__results">
          <li class="pagefind-ui__result"></li>
          <li class="pagefind-ui__result"></li>
        </ol>
      `;
    });
    const PagefindUI = PagefindUIMock as unknown as PagefindUIConstructor;
    const controller = createPagefindSearchController(
      createOptions({
        getPagefindUI: () => PagefindUI,
        mount,
        status,
      }),
    );

    await expect(controller.open()).resolves.toEqual({ kind: 'ready' });

    const input = mount.querySelector('input');
    expect(PagefindUIMock).toHaveBeenCalledWith(
      expect.objectContaining({
        autofocus: false,
        element: '#pagefind-ui',
        mergeIndex: buildMergedPagefindIndexes(
          'https://example.test/pagefind/pagefind-ui.js',
          'en',
        ),
        processTerm: normalizePagefindSearchTerm,
        processResult: expect.any(Function),
        translations: {
          clear_search: 'Clear search',
          placeholder: 'Search articles…',
          search_label: 'Search articles',
        },
      }),
    );
    expect(input).not.toBeNull();
    expect(input?.getAttribute('name')).toBe('search');
    expect(input?.getAttribute('aria-label')).toBe('Search articles');
    expect(input?.getAttribute('placeholder')).toBe('Search articles…');
    expect(document.activeElement).toBe(input);
    expect(status.textContent).toBe('2 search results available.');

    const [pagefindOptions] = PagefindUIMock.mock.calls[0] as unknown as [
      {
        processTerm?: (term: string) => string;
        processResult?: (result: PagefindSearchResult) => PagefindSearchResult;
      },
    ];
    const processTerm = pagefindOptions.processTerm;
    const processResult = pagefindOptions.processResult;
    expect(processTerm?.('日本語タイポグラフィ')).toBe('日本語 タイポグラフィ');
    expect(
      processResult?.({
        meta: { url: '/tags/astro.html' },
        url: '/getting-started.html',
      }),
    ).toEqual({
      meta: { url: '/tags/astro' },
      url: '/getting-started',
    });
  });

  it('opens without focusing the search input on mobile', async () => {
    const { mount, status } = createSearchDom();
    setMatchMedia(false);
    const PagefindUI = vi.fn(function PagefindUI(this: unknown) {
      mount.innerHTML = `
        <input class="pagefind-ui__search-input" />
        <ol class="pagefind-ui__results">
          <li class="pagefind-ui__result"></li>
        </ol>
      `;
    }) as unknown as PagefindUIConstructor;
    const controller = createPagefindSearchController(
      createOptions({
        getPagefindUI: () => PagefindUI,
        mount,
        status,
      }),
    );

    await expect(controller.open()).resolves.toEqual({ kind: 'ready' });
    expect(document.activeElement).not.toBe(mount.querySelector('input'));
    expect(status.textContent).toBe('1 search result available.');
  });

  it('removes bootstrap loading copy once Pagefind appends its UI shell', async () => {
    const { mount, status } = createSearchDom();
    setMatchMedia(true);
    const PagefindUI = vi.fn(function PagefindUI(this: unknown) {
      mount.insertAdjacentHTML(
        'beforeend',
        `
          <div class="pagefind-ui">
            <input class="pagefind-ui__search-input" />
            <ol class="pagefind-ui__results">
              <li class="pagefind-ui__result"></li>
            </ol>
          </div>
        `,
      );
    }) as unknown as PagefindUIConstructor;
    const controller = createPagefindSearchController(
      createOptions({
        getPagefindUI: () => PagefindUI,
        mount,
        status,
      }),
    );

    await expect(controller.open()).resolves.toEqual({ kind: 'ready' });
    expect(mount.querySelector('.search-loading')).toBeNull();
    expect(status.textContent).toBe('1 search result available.');
  });

  it('allows retrying after a failed bootstrap', async () => {
    const { mount, status } = createSearchDom();
    let shouldFail = true;
    const PagefindUI = vi.fn(function PagefindUI(this: unknown) {
      mount.innerHTML = '<input class="pagefind-ui__search-input" />';
    }) as unknown as PagefindUIConstructor;
    const controller = createPagefindSearchController(
      createOptions({
        getPagefindUI: () => PagefindUI,
        importPagefind: async () => {
          if (shouldFail) {
            throw new Error('temporary failure');
          }
        },
        mount,
        status,
      }),
    );

    await expect(controller.open()).resolves.toEqual({
      kind: 'unavailable',
      message: searchUnavailableMessage,
    });

    shouldFail = false;
    await expect(controller.open()).resolves.toEqual({ kind: 'ready' });
    expect(mount.querySelector('.pagefind-ui__search-input')).not.toBeNull();
  });

  it('uses localized japanese copy when the controller language is ja', async () => {
    const { mount, status } = createSearchDom('ja');
    setMatchMedia(true);
    const PagefindUIMock = vi.fn(function PagefindUI(this: unknown) {
      mount.innerHTML = '<input class="pagefind-ui__search-input" />';
    });
    const PagefindUI = PagefindUIMock as unknown as PagefindUIConstructor;
    const controller = createPagefindSearchController(
      createOptions({
        getPagefindUI: () => PagefindUI,
        language: 'ja',
        mount,
        status,
      }),
    );

    await expect(controller.open()).resolves.toEqual({ kind: 'ready' });

    const input = mount.querySelector('input');
    expect(input?.getAttribute('aria-label')).toBe('記事を検索');
    expect(input?.getAttribute('placeholder')).toBe('記事を検索…');
    expect(PagefindUIMock).toHaveBeenCalledWith(
      expect.objectContaining({
        translations: {
          clear_search: '検索をクリア',
          placeholder: '記事を検索…',
          search_label: '記事を検索',
        },
      }),
    );
  });

  it('falls back to the page html lang when the controller language is omitted', async () => {
    const { mount, status } = createSearchDom('ja');
    setMatchMedia(true);
    const PagefindUIMock = vi.fn(function PagefindUI(this: unknown) {
      mount.innerHTML = '<input class="pagefind-ui__search-input" />';
    });
    const PagefindUI = PagefindUIMock as unknown as PagefindUIConstructor;
    const controller = createPagefindSearchController(
      createOptions({
        getPagefindUI: () => PagefindUI,
        language: null,
        mount,
        status,
      }),
    );

    await expect(controller.open()).resolves.toEqual({ kind: 'ready' });

    const input = mount.querySelector('input');
    expect(input?.getAttribute('aria-label')).toBe('記事を検索');
    expect(input?.getAttribute('placeholder')).toBe('記事を検索…');
    expect(PagefindUIMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mergeIndex: buildMergedPagefindIndexes(
          'https://example.test/pagefind/pagefind-ui.js',
          'ja',
        ),
        translations: {
          clear_search: '検索をクリア',
          placeholder: '記事を検索…',
          search_label: '記事を検索',
        },
      }),
    );
  });

  it('updates the external empty state when Pagefind mutates the search message after bootstrap', async () => {
    const { emptyState, mount, status } = createSearchDom();
    setMatchMedia(true);
    const PagefindUI = vi.fn(function PagefindUI(this: unknown) {
      mount.innerHTML = `
        <div class="pagefind-ui">
          <input class="pagefind-ui__search-input" />
          <ol class="pagefind-ui__results">
            <li class="pagefind-ui__result"></li>
          </ol>
        </div>
      `;
    }) as unknown as PagefindUIConstructor;
    const controller = createPagefindSearchController(
      createOptions({
        getPagefindUI: () => PagefindUI,
        mount,
        status,
      }),
    );

    await expect(controller.open()).resolves.toEqual({ kind: 'ready' });
    mount.innerHTML = `
      <div class="pagefind-ui">
        <input class="pagefind-ui__search-input" />
        <p class="pagefind-ui__message">No results for "astro"</p>
      </div>
    `;

    await flushMutationObserver();

    expect(emptyState.hidden).toBe(false);
    expect(status.textContent).toBe('No matching articles. Try a broader term or a topic label.');
    expect(mount.querySelector<HTMLElement>('.pagefind-ui__message')?.hidden).toBe(true);
  });

  it('hides the external empty state again when Pagefind results return', async () => {
    const { emptyState, mount, status } = createSearchDom();
    setMatchMedia(true);
    const PagefindUI = vi.fn(function PagefindUI(this: unknown) {
      mount.innerHTML = `
        <div class="pagefind-ui">
          <input class="pagefind-ui__search-input" />
          <p class="pagefind-ui__message">No results for "astro"</p>
        </div>
      `;
    }) as unknown as PagefindUIConstructor;
    const controller = createPagefindSearchController(
      createOptions({
        getPagefindUI: () => PagefindUI,
        mount,
        status,
      }),
    );

    await expect(controller.open()).resolves.toEqual({ kind: 'ready' });
    expect(emptyState.hidden).toBe(false);

    mount.innerHTML = `
      <div class="pagefind-ui">
        <input class="pagefind-ui__search-input" />
        <ol class="pagefind-ui__results">
          <li class="pagefind-ui__result"></li>
          <li class="pagefind-ui__result"></li>
        </ol>
      </div>
    `;

    await flushMutationObserver();

    expect(emptyState.hidden).toBe(true);
    expect(status.textContent).toBe('2 search results available.');
  });

  it('stops reacting to Pagefind DOM mutations after close', async () => {
    const { emptyState, mount, status } = createSearchDom();
    setMatchMedia(true);
    const PagefindUI = vi.fn(function PagefindUI(this: unknown) {
      mount.innerHTML = `
        <div class="pagefind-ui">
          <input class="pagefind-ui__search-input" />
          <ol class="pagefind-ui__results">
            <li class="pagefind-ui__result"></li>
          </ol>
        </div>
      `;
    }) as unknown as PagefindUIConstructor;
    const controller = createPagefindSearchController(
      createOptions({
        getPagefindUI: () => PagefindUI,
        mount,
        status,
      }),
    );

    await expect(controller.open()).resolves.toEqual({ kind: 'ready' });
    controller.close();

    mount.innerHTML = `
      <div class="pagefind-ui">
        <input class="pagefind-ui__search-input" />
        <p class="pagefind-ui__message">No results for "astro"</p>
      </div>
    `;

    await flushMutationObserver();

    expect(emptyState.hidden).toBe(true);
    expect(status.textContent).toBe('1 search result available.');
  });
});

describe('decorateSearchUi', () => {
  it('renders a real localized empty state in the DOM', () => {
    const { emptyState, mount } = createSearchDom('ja');
    mount.innerHTML = `
      <div class="pagefind-ui">
        <p class="pagefind-ui__message">No results for "タイポグラフィ"</p>
      </div>
    `;

    decorateSearchUi(mount, getSearchCopy('ja'), emptyState);

    expect(emptyState?.textContent).toContain('一致する記事はありません');
    expect(emptyState?.textContent).toContain('より広い語句やトピック名で試してください。');
    expect(emptyState.hidden).toBe(false);
    expect(mount.querySelector<HTMLElement>('.pagefind-ui__message')?.hidden).toBe(true);
  });
});

describe('summarizeSearchStatus', () => {
  it('returns curated copy for the branded empty state', () => {
    const { mount } = createSearchDom();
    mount.innerHTML = `
      <div class="pagefind-ui">
        <p class="pagefind-ui__message">No results for "astro"</p>
      </div>
    `;

    decorateSearchUi(mount, getSearchCopy('en'));
    expect(summarizeSearchStatus(mount, 'en')).toBe(
      'No matching articles. Try a broader term or a topic label.',
    );
  });

  it('returns localized empty-state status text for japanese', () => {
    const { mount } = createSearchDom('ja');
    mount.innerHTML = `
      <div class="pagefind-ui">
        <p class="pagefind-ui__message">No results for "タイポグラフィ"</p>
      </div>
    `;

    decorateSearchUi(mount, getSearchCopy('ja'));
    expect(summarizeSearchStatus(mount, 'ja')).toBe(
      '一致する記事はありません。より広い語句やトピック名で試してください。',
    );
  });
});
