// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  createPagefindSearchController,
  type PagefindUIConstructor,
  type SearchBootstrapDeps,
  searchErrorMessage,
  searchUnavailableMessage,
} from './pagefind-search';

function createSearchDom() {
  document.body.innerHTML = `
    <div id="pagefind-ui"></div>
    <p id="search-status"></p>
  `;

  return {
    mount: document.getElementById('pagefind-ui') as HTMLElement,
    status: document.getElementById('search-status') as HTMLElement,
  };
}

function createDeps(overrides: Partial<SearchBootstrapDeps> = {}): SearchBootstrapDeps {
  return {
    forceBootstrap: false,
    getPagefindUI: () => null,
    importPagefind: async () => {},
    isDev: false,
    isPagefindAvailable: async () => true,
    logError: vi.fn(),
    nextFrame: async () => {},
    pagefindSrc: 'https://example.test/pagefind/pagefind-ui.js',
    ...overrides,
  };
}

describe('createPagefindSearchController', () => {
  it('renders the dev unavailable state without attempting bootstrap', async () => {
    const { mount, status } = createSearchDom();
    const isPagefindAvailable = vi.fn(async () => true);
    const controller = createPagefindSearchController(
      {
        mount,
        mountSelector: '#pagefind-ui',
        status,
      },
      createDeps({
        forceBootstrap: false,
        isDev: true,
        isPagefindAvailable,
      }),
    );

    await expect(controller.open()).resolves.toEqual({
      kind: 'unavailable',
      message: searchUnavailableMessage,
    });
    expect(isPagefindAvailable).not.toHaveBeenCalled();
    expect(mount.textContent).toContain(searchUnavailableMessage);
    expect(status.textContent).toBe(searchUnavailableMessage);
  });

  it('surfaces import failures as integration errors', async () => {
    const { mount, status } = createSearchDom();
    const logError = vi.fn();
    const controller = createPagefindSearchController(
      {
        mount,
        mountSelector: '#pagefind-ui',
        status,
      },
      createDeps({
        importPagefind: async () => {
          throw new Error('import failed');
        },
        logError,
      }),
    );

    await expect(controller.open()).resolves.toEqual({
      kind: 'error',
      message: searchErrorMessage,
    });
    expect(logError).toHaveBeenCalledWith('module import', expect.any(Error));
    expect(mount.textContent).toContain(searchErrorMessage);
    expect(status.textContent).toBe(searchErrorMessage);
  });

  it('surfaces missing global registration as an integration error', async () => {
    const { mount, status } = createSearchDom();
    const logError = vi.fn();
    const controller = createPagefindSearchController(
      {
        mount,
        mountSelector: '#pagefind-ui',
        status,
      },
      createDeps({
        getPagefindUI: () => null,
        logError,
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
    const PagefindUI = vi.fn(function PagefindUI(this: unknown) {
      mount.innerHTML = `
        <input class="pagefind-ui__search-input" />
        <ol class="pagefind-ui__results">
          <li class="pagefind-ui__result"></li>
          <li class="pagefind-ui__result"></li>
        </ol>
      `;
    }) as unknown as PagefindUIConstructor;
    const controller = createPagefindSearchController(
      {
        mount,
        mountSelector: '#pagefind-ui',
        status,
      },
      createDeps({
        getPagefindUI: () => PagefindUI,
      }),
    );

    await expect(controller.open()).resolves.toEqual({ kind: 'ready' });

    const input = mount.querySelector('input');
    expect(PagefindUI).toHaveBeenCalledWith(
      expect.objectContaining({
        element: '#pagefind-ui',
      }),
    );
    expect(input).not.toBeNull();
    expect(input?.getAttribute('name')).toBe('search');
    expect(input?.getAttribute('aria-label')).toBe('Search articles');
    expect(input?.getAttribute('placeholder')).toBe('Search articles…');
    expect(document.activeElement).toBe(input);
    expect(status.textContent).toBe('2 search results available.');
  });

  it('allows retrying after a failed bootstrap', async () => {
    const { mount, status } = createSearchDom();
    let shouldFail = true;
    const PagefindUI = vi.fn(function PagefindUI(this: unknown) {
      mount.innerHTML = '<input class="pagefind-ui__search-input" />';
    }) as unknown as PagefindUIConstructor;
    const controller = createPagefindSearchController(
      {
        mount,
        mountSelector: '#pagefind-ui',
        status,
      },
      createDeps({
        getPagefindUI: () => PagefindUI,
        importPagefind: async () => {
          if (shouldFail) {
            throw new Error('temporary failure');
          }
        },
      }),
    );

    await expect(controller.open()).resolves.toEqual({
      kind: 'error',
      message: searchErrorMessage,
    });

    shouldFail = false;
    await expect(controller.open()).resolves.toEqual({ kind: 'ready' });
    expect(mount.querySelector('.pagefind-ui__search-input')).not.toBeNull();
  });
});
