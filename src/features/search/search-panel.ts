import { formatCompactReadingTime } from '../../i18n/site-copy';
import { startBenchProfile } from '../../shared/bench-profile';
import { mountArchiveField } from '../archive/client';
import { getPageLanguage, getSearchCopy } from './search-copy';
import { loadSearchEngine, PAGEFIND_PATH } from './search-engine';
import { createSearchUi, type Entry, type SearchUi } from './search-ui';
import type { Term } from './terms';

/**
 * 検索の入口（一覧の横の欄と、どこからでも効く「/」）と、全画面の検索
 * 画面の開け閉め。閉じる道は三つ: 左上の「← 戻る」、Esc（語があれば先に
 * 語を消す）、ブラウザの「戻る」。画面の中身は最初に開いたときに template
 * から組む。
 */

let searchPanelSequence = 0;

export function initializeSearchPanel(root: ParentNode = document) {
  for (const searchRoot of resolveSearchRoots(root)) {
    initializeSearchPanelRoot(searchRoot);
  }
}

function readJson<T>(value: string | undefined, fallback: T): T {
  try {
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function initializeSearchPanelRoot(searchRoot: HTMLElement) {
  const browserDocument = searchRoot.ownerDocument;
  const finishProfile = startBenchProfile('search-panel.init', {
    documentLang: browserDocument.documentElement.lang || 'unknown',
  });

  try {
    const trigger = searchRoot.querySelector('[data-search-trigger]');
    const modal = searchRoot.querySelector('[data-search-modal]');
    if (!(trigger instanceof HTMLButtonElement) || !(modal instanceof HTMLDialogElement)) return;
    const searchTrigger = trigger;
    const searchModal = modal;
    if (searchRoot.dataset.searchInitialized === 'true') return;
    searchRoot.dataset.searchInitialized = 'true';
    searchTrigger.setAttribute('aria-controls', ensureElementId(searchModal, 'search-modal'));

    let ui: SearchUi | null = null;
    // 開くたびに履歴を一段積む。ブラウザの「戻る」（携帯のスワイプも）で
    // 検索が閉じ、ページはそのまま残る。
    let pushed = false;
    const browserWindow = browserDocument.defaultView ?? window;

    function ensureUi(): SearchUi | null {
      if (ui) return ui;
      const template = searchRoot.querySelector('[data-search-modal-template]');
      if (!(template instanceof HTMLTemplateElement)) return null;
      searchModal.replaceChildren(template.content.cloneNode(true));
      const q = <T extends Element>(selector: string) => searchModal.querySelector<T>(selector);
      const input = q<HTMLInputElement>('[data-search-input]');
      const body = q<HTMLElement>('[data-search-body]');
      const terms = q<HTMLElement>('[data-search-terms]');
      const results = q<HTMLElement>('[data-search-results]');
      const list = q<HTMLElement>('[data-search-list]');
      const preview = q<HTMLElement>('[data-search-preview]');
      const voidEl = q<HTMLElement>('[data-search-void]');
      const message = q<HTMLElement>('[data-search-message]');
      const status = q<HTMLElement>('[data-search-status]');
      const close = q<HTMLButtonElement>('[data-search-close]');
      const canvas = q<HTMLCanvasElement>('[data-search-field]');
      if (
        !input ||
        !body ||
        !terms ||
        !results ||
        !list ||
        !preview ||
        !voidEl ||
        !message ||
        !status ||
        !close
      ) {
        return null;
      }
      const language =
        searchModal.dataset.searchLang === 'ja'
          ? 'ja'
          : getPageLanguage(browserDocument.documentElement.lang);
      const entries = readJson<Entry[]>(searchModal.dataset.entries, []);
      const field = canvas ? mountArchiveField(canvas, entries) : null;
      close.addEventListener('click', closeSearch);
      ui = createSearchUi({
        elements: { input, body, terms, results, list, preview, void: voidEl, message, status },
        copy: getSearchCopy(language),
        entries,
        terms: readJson<Term[]>(searchModal.dataset.terms, []),
        formatMinutes: (m) => formatCompactReadingTime(m, language),
        loadEngine: () =>
          loadSearchEngine(new URL(PAGEFIND_PATH, browserDocument.location.origin).toString()),
        field,
        onGunman: () => {
          void import('../gunman').then(({ openRange }) =>
            openRange(browserDocument, () => input.focus()),
          );
        },
      });
      return ui;
    }

    function openSearch() {
      const runtime = ensureUi();
      if (!runtime) return;
      searchTrigger.setAttribute('aria-expanded', 'true');
      if (!searchModal.open) searchModal.showModal();
      browserDocument.documentElement.dataset.searchOpen = '';
      if (!pushed) {
        browserWindow.history.pushState({ ...browserWindow.history.state, l3Search: true }, '');
        pushed = true;
      }
      runtime.open();
    }

    function closeSearch() {
      if (searchModal.open) searchModal.close();
    }

    searchTrigger.addEventListener('click', openSearch);
    // Esc は、語があれば語を消すだけ。空のときに閉じる。
    searchModal.addEventListener('cancel', (event) => {
      if (ui?.escape()) event.preventDefault();
    });
    searchModal.addEventListener('close', () => {
      if (pushed) {
        pushed = false;
        if (browserWindow.history.state?.l3Search) browserWindow.history.back();
      }
      ui?.close();
      delete browserDocument.documentElement.dataset.searchOpen;
      searchTrigger.setAttribute('aria-expanded', 'false');
      searchTrigger.focus();
    });
    browserWindow.addEventListener('popstate', () => {
      if (!pushed || !searchModal.open) return;
      pushed = false;
      searchModal.close();
    });
    browserDocument.addEventListener('keydown', (event) => {
      if (!ownsGlobalShortcut(searchRoot)) return;
      if (event.key !== '/' || searchModal.open) return;
      if (isTextEntryElement(browserDocument.activeElement)) return;
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
  if (element.id) return element.id;
  searchPanelSequence += 1;
  element.id = `${prefix}-${searchPanelSequence}`;
  return element.id;
}

function isTextEntryElement(element: Element | null) {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    Boolean(element instanceof HTMLElement && element.isContentEditable)
  );
}
