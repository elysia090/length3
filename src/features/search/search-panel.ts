import { startBenchProfile } from '../../shared/bench-profile';
import { createPagefindSearchController, type PagefindSearchController } from './pagefind-search';
import { getPageLanguage, getSearchCopy } from './search-copy';
import { createSearchNavigation, type SearchNavigation } from './search-navigation';

interface SearchModalRuntime {
  searchController: PagefindSearchController;
  searchNavigation: SearchNavigation;
}

let searchPanelSequence = 0;

export function initializeSearchPanel(root: ParentNode = document) {
  for (const searchRoot of resolveSearchRoots(root)) {
    initializeSearchPanelRoot(searchRoot);
  }
}

function initializeSearchPanelRoot(searchRoot: HTMLElement) {
  const browserDocument = searchRoot.ownerDocument;
  const finishProfile = startBenchProfile('search-panel.init', {
    documentLang: browserDocument.documentElement.lang || 'unknown',
  });

  try {
    const browserWindow = browserDocument.defaultView ?? window;
    const trigger = searchRoot.querySelector('[data-search-trigger]');
    const modal = searchRoot.querySelector('[data-search-modal]');

    if (!(trigger instanceof HTMLButtonElement) || !(modal instanceof HTMLDialogElement)) {
      return;
    }

    const searchTrigger = trigger;
    const searchModal = modal;

    if (searchRoot.dataset.searchInitialized === 'true') {
      return;
    }
    searchRoot.dataset.searchInitialized = 'true';
    searchTrigger.setAttribute('aria-controls', ensureElementId(searchModal, 'search-modal'));

    let modalRuntime: SearchModalRuntime | null = null;

    function ensureModalRuntime() {
      if (modalRuntime) {
        return modalRuntime;
      }

      const template = searchRoot.querySelector('[data-search-modal-template]');
      if (!(template instanceof HTMLTemplateElement)) {
        return null;
      }

      searchModal.replaceChildren(template.content.cloneNode(true));

      const closeButton = searchModal.querySelector('[data-search-close]');
      const pagefindMount = searchModal.querySelector('[data-pagefind-ui]');
      const emptyState = searchModal.querySelector('[data-search-empty-state]');
      const status = searchModal.querySelector('[data-search-status]');

      if (
        !(closeButton instanceof HTMLButtonElement) ||
        !(pagefindMount instanceof HTMLElement) ||
        !(status instanceof HTMLElement)
      ) {
        return null;
      }

      const modalLanguage = searchModal.dataset.searchLang === 'ja' ? 'ja' : null;
      const copy = getSearchCopy(
        modalLanguage ?? getPageLanguage(browserDocument.documentElement.lang),
      );
      const searchNavigation = createSearchNavigation({
        listLabel: copy.resultsLabel,
        mount: pagefindMount,
      });
      const searchController = createPagefindSearchController({
        browserWindow,
        emptyState: emptyState instanceof HTMLElement ? emptyState : null,
        focusMode: 'desktop-only',
        language: modalLanguage,
        mount: pagefindMount,
        mountSelector: `#${ensureElementId(pagefindMount, 'pagefind-ui')}`,
        onSync: () => searchNavigation.sync(),
        status,
      });

      closeButton.addEventListener('click', closeSearch);
      // 語が変われば結果も変わる。前の選択は指す先を失うので落とす。
      searchModal.addEventListener('input', () => searchNavigation.reset());
      searchModal.addEventListener('keydown', (event) => searchNavigation.handleKeydown(event));
      modalRuntime = { searchController, searchNavigation };
      return modalRuntime;
    }

    function openSearch() {
      const runtime = ensureModalRuntime();
      if (!runtime) {
        return;
      }

      setExpandedState(searchTrigger, true);
      if (!searchModal.open) {
        searchModal.showModal();
      }
      void runtime.searchController.open();
    }

    function closeSearch() {
      setExpandedState(searchTrigger, false);
      modalRuntime?.searchNavigation.reset();
      modalRuntime?.searchController.close();
      if (searchModal.open) {
        searchModal.close();
      }
    }

    searchTrigger.addEventListener('click', openSearch);
    searchModal.addEventListener('click', (event) => {
      if (event.target === searchModal) {
        searchModal.close();
      }
    });
    searchModal.addEventListener('cancel', () => {
      setExpandedState(searchTrigger, false);
      modalRuntime?.searchController.close();
    });
    searchModal.addEventListener('close', () => {
      setExpandedState(searchTrigger, false);
      modalRuntime?.searchNavigation.reset();
      modalRuntime?.searchController.close();
      searchTrigger.focus();
    });
    browserDocument.addEventListener('keydown', (event) => {
      if (!ownsGlobalShortcut(searchRoot)) {
        return;
      }

      if (
        !shouldOpenSearchFromKeydown(event.key, searchModal.open, browserDocument.activeElement)
      ) {
        return;
      }

      event.preventDefault();
      openSearch();
    });
  } finally {
    finishProfile();
  }
}

function resolveSearchRoots(root: ParentNode): HTMLElement[] {
  if (root instanceof HTMLElement && root.matches('[data-search-panel]')) {
    return [root];
  }

  return [...root.querySelectorAll<HTMLElement>('[data-search-panel]')];
}

function ownsGlobalShortcut(searchRoot: HTMLElement) {
  return searchRoot.ownerDocument.querySelector('[data-search-panel]') === searchRoot;
}

function ensureElementId(element: HTMLElement, prefix: string) {
  if (element.id) {
    return element.id;
  }

  searchPanelSequence += 1;
  element.id = `${prefix}-${searchPanelSequence}`;
  return element.id;
}

function shouldOpenSearchFromKeydown(
  key: string,
  modalOpen: boolean,
  activeElement: Element | null,
) {
  return key === '/' && !modalOpen && !isTextEntryElement(activeElement);
}

function isTextEntryElement(element: Element | null) {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    Boolean(element instanceof HTMLElement && element.isContentEditable)
  );
}

function setExpandedState(button: HTMLButtonElement, isExpanded: boolean) {
  button.setAttribute('aria-expanded', String(isExpanded));
}
