import { startBenchProfile } from './bench-profile';
import { createPagefindSearchController, type PagefindSearchController } from './pagefind-search';

interface SearchModalRuntime {
  searchController: PagefindSearchController;
}

export function initializeSidebarSearch(browserDocument: Document = document) {
  const finishProfile = startBenchProfile('sidebar.init', {
    documentLang: browserDocument.documentElement.lang || 'unknown',
  });

  try {
    const browserWindow = browserDocument.defaultView ?? window;
    const trigger = browserDocument.getElementById('search-trigger');
    const modal = browserDocument.getElementById('search-modal');

    if (!(trigger instanceof HTMLButtonElement) || !(modal instanceof HTMLDialogElement)) {
      return;
    }

    const searchTrigger = trigger;
    const searchModal = modal;

    if (searchModal.dataset.searchInitialized === 'true') {
      return;
    }
    searchModal.dataset.searchInitialized = 'true';

    let modalRuntime: SearchModalRuntime | null = null;

    function ensureModalRuntime() {
      if (modalRuntime) {
        return modalRuntime;
      }

      const template = browserDocument.getElementById('search-modal-template');
      if (!(template instanceof HTMLTemplateElement)) {
        return null;
      }

      searchModal.replaceChildren(template.content.cloneNode(true));

      const closeButton = browserDocument.getElementById('search-close');
      const pagefindMount = browserDocument.getElementById('pagefind-ui');
      const emptyState = browserDocument.getElementById('search-empty-state');
      const status = browserDocument.getElementById('search-status');

      if (
        !(closeButton instanceof HTMLButtonElement) ||
        !(pagefindMount instanceof HTMLElement) ||
        !(status instanceof HTMLElement)
      ) {
        return null;
      }

      const modalLanguage = searchModal.dataset.searchLang === 'ja' ? 'ja' : null;
      const searchController = createPagefindSearchController({
        browserWindow,
        emptyState: emptyState instanceof HTMLElement ? emptyState : null,
        focusMode: 'desktop-only',
        language: modalLanguage,
        mount: pagefindMount,
        mountSelector: '#pagefind-ui',
        status,
      });

      closeButton.addEventListener('click', closeSearch);
      modalRuntime = { searchController };
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
      modalRuntime?.searchController.close();
      searchTrigger.focus();
    });
    browserDocument.addEventListener('keydown', (event) => {
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
