// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { initializeSidebarSearch } from './sidebar-search';

function createSidebarSearchDom() {
  document.body.innerHTML = `
    <div data-sidebar-search>
      <button type="button" data-search-trigger aria-expanded="false">Search</button>
      <dialog data-search-modal data-search-lang="en"></dialog>
      <template data-search-modal-template>
        <div>
          <button type="button" data-search-close>Close</button>
          <p data-search-status></p>
          <div data-pagefind-ui></div>
          <div data-search-empty-state hidden></div>
        </div>
      </template>
    </div>
    <div data-sidebar-search>
      <button type="button" data-search-trigger aria-expanded="false">Search</button>
      <dialog data-search-modal data-search-lang="ja"></dialog>
      <template data-search-modal-template>
        <div>
          <button type="button" data-search-close>Close</button>
          <p data-search-status></p>
          <div data-pagefind-ui></div>
          <div data-search-empty-state hidden></div>
        </div>
      </template>
    </div>
  `;

  return [...document.querySelectorAll<HTMLElement>('[data-sidebar-search]')];
}

describe('initializeSidebarSearch', () => {
  it('initializes each search root without relying on document-global ids', () => {
    const roots = createSidebarSearchDom();

    initializeSidebarSearch();

    const controls = roots.map((root) =>
      root.querySelector<HTMLButtonElement>('[data-search-trigger]')?.getAttribute('aria-controls'),
    );

    expect(roots.every((root) => root.dataset.searchInitialized === 'true')).toBe(true);
    expect(new Set(controls).size).toBe(2);
    expect(controls.every((value) => value?.startsWith('search-modal-'))).toBe(true);
  });
});
