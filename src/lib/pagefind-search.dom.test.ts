// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  buildMergedPagefindIndexes,
  createPagefindSearchController,
  normalizePagefindSearchTerm,
  type PagefindSearchControllerOptions,
  type PagefindSearchResult,
  type PagefindUIConstructor,
  searchErrorMessage,
  searchUnavailableMessage,
} from './pagefind-search';

function createSearchDom() {
  document.documentElement.lang = 'en';
  document.body.innerHTML = `
    <div id="pagefind-ui"></div>
    <p id="search-status"></p>
  `;

  return {
    mount: document.getElementById('pagefind-ui') as HTMLElement,
    status: document.getElementById('search-status') as HTMLElement,
  };
}

function createOptions(
  overrides: Partial<PagefindSearchControllerOptions> = {},
): PagefindSearchControllerOptions {
  return {
    browserWindow: window,
    getPagefindUI: () => null,
    importPagefind: async () => {},
    logError: vi.fn(),
    mount: document.getElementById('pagefind-ui') as HTMLElement,
    mountSelector: '#pagefind-ui',
    nextFrame: async () => {},
    pagefindSrc: 'https://example.test/pagefind/pagefind-ui.js',
    status: document.getElementById('search-status') as HTMLElement,
    ...overrides,
  };
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

  it('decorates the generated search input and reports result count', async () => {
    const { mount, status } = createSearchDom();
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
        element: '#pagefind-ui',
        mergeIndex: buildMergedPagefindIndexes(
          'https://example.test/pagefind/pagefind-ui.js',
          'en',
        ),
        processTerm: normalizePagefindSearchTerm,
        processResult: expect.any(Function),
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
});
