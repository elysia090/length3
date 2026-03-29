import { startBenchProfile } from './bench-profile';
import { createPagefindSearchController } from './pagefind-search';

export function initializeSidebarSearch(browserDocument: Document = document) {
  const finishProfile = startBenchProfile('sidebar.init', {
    documentLang: browserDocument.documentElement.lang || 'unknown',
  });

  try {
    const browserWindow = browserDocument.defaultView ?? window;
    const trigger = browserDocument.getElementById('search-trigger');
    const modal = browserDocument.getElementById('search-modal');
    const closeButton = browserDocument.getElementById('search-close');
    const pagefindMount = browserDocument.getElementById('pagefind-ui');
    const emptyState = browserDocument.getElementById('search-empty-state');
    const status = browserDocument.getElementById('search-status');

    if (
      !(trigger instanceof HTMLButtonElement) ||
      !(modal instanceof HTMLDialogElement) ||
      !(closeButton instanceof HTMLButtonElement) ||
      !(pagefindMount instanceof HTMLElement) ||
      !(status instanceof HTMLElement)
    ) {
      return;
    }

    if (modal.dataset.searchInitialized === 'true') {
      return;
    }
    modal.dataset.searchInitialized = 'true';

    const modalLanguage = modal.dataset.searchLang === 'ja' ? 'ja' : null;
    const searchController = createPagefindSearchController({
      browserWindow,
      emptyState: emptyState instanceof HTMLElement ? emptyState : null,
      focusMode: 'desktop-only',
      language: modalLanguage,
      mount: pagefindMount,
      mountSelector: '#pagefind-ui',
      status,
    });

    const openSearch = () => {
      setExpandedState(trigger, true);
      if (!modal.open) {
        modal.showModal();
      }
      void searchController.open();
    };

    const closeSearch = () => {
      setExpandedState(trigger, false);
      searchController.close();
      if (modal.open) {
        modal.close();
      }
    };

    trigger.addEventListener('click', openSearch);
    closeButton.addEventListener('click', closeSearch);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        modal.close();
      }
    });
    modal.addEventListener('cancel', () => {
      setExpandedState(trigger, false);
      searchController.close();
    });
    modal.addEventListener('close', () => {
      setExpandedState(trigger, false);
      searchController.close();
      trigger.focus();
    });
    browserDocument.addEventListener('keydown', (event) => {
      if (!shouldOpenSearchFromKeydown(event.key, modal.open, browserDocument.activeElement)) {
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
