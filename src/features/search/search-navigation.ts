/**
 * 検索結果を ↑↓ で辿るための操作。
 *
 * 脚注には最初から「↑↓ navigate / ↵ open」と書いてあったが、鍵を受ける側が
 * どこにも無く、入力欄に焦点があるあいだ矢印はキャレットを動かすだけだった。
 *
 * 焦点は入力欄に置いたまま選択だけを動かす。結果のリンクへ焦点を移す方式だと、
 * 続けて字を打つたびに入力欄へ戻す操作が要る。代わりに WAI-ARIA の combobox
 * （listbox 付き）を組む。選択中の 1 件は aria-activedescendant で指し、
 * 見た目は既存の [aria-selected='true'] がそのまま受ける。
 *
 * Pagefind の DOM は Svelte が描き直す。id と role は描き直されるたびに
 * 付け直す必要があるので、sync() は結果が変わるたびに呼ばれる前提で書く
 * （属性しか触らないので、呼び出し側の MutationObserver は起こさない）。
 */
import { SEARCH_INPUT_SELECTOR } from './pagefind-search';

const RESULT_SELECTOR = '.pagefind-ui__result';
const RESULT_LINK_SELECTOR = '.pagefind-ui__result-link';
const RESULTS_LIST_SELECTOR = '.pagefind-ui__results';

export interface SearchNavigationOptions {
  listLabel?: string;
  mount: HTMLElement;
}

export interface SearchNavigation {
  /** 鍵を処理したら true。呼び出し側は既定動作を止める必要はない（内部で止める）。 */
  handleKeydown(event: KeyboardEvent): boolean;
  reset(): void;
  sync(): void;
}

let searchNavigationSequence = 0;

export function createSearchNavigation(options: SearchNavigationOptions): SearchNavigation {
  const { mount } = options;
  searchNavigationSequence += 1;
  const idPrefix = `search-result-${searchNavigationSequence}`;
  let selected: HTMLElement | null = null;

  return { handleKeydown, reset, sync };

  function getInput() {
    return mount.querySelector<HTMLInputElement>(SEARCH_INPUT_SELECTOR);
  }

  function getOptions() {
    return [...mount.querySelectorAll<HTMLElement>(RESULT_SELECTOR)];
  }

  function sync() {
    if (selected && !selected.isConnected) {
      // 結果が入れ替わった。前の選択はもう画面に無い。
      selected = null;
    }

    const list = mount.querySelector<HTMLElement>(RESULTS_LIST_SELECTOR);
    if (list) {
      list.setAttribute('role', 'listbox');
      if (options.listLabel) {
        list.setAttribute('aria-label', options.listLabel);
      }
      if (!list.id) {
        list.id = `${idPrefix}-list`;
      }
    }

    const results = getOptions();
    results.forEach((result, index) => {
      result.setAttribute('role', 'option');
      result.id = `${idPrefix}-${index}`;
      result.setAttribute('aria-selected', String(result === selected));
    });

    const input = getInput();
    if (!input) return;

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', String(results.length > 0));
    if (list?.id) {
      input.setAttribute('aria-controls', list.id);
    }
    syncActiveDescendant(input);
  }

  function reset() {
    for (const result of getOptions()) {
      result.setAttribute('aria-selected', 'false');
    }
    selected = null;

    const input = getInput();
    if (input) {
      syncActiveDescendant(input);
    }
  }

  function syncActiveDescendant(input: HTMLInputElement) {
    if (selected?.id) {
      input.setAttribute('aria-activedescendant', selected.id);
      return;
    }

    input.removeAttribute('aria-activedescendant');
  }

  function select(result: HTMLElement | null) {
    for (const other of getOptions()) {
      other.setAttribute('aria-selected', String(other === result));
    }
    selected = result;

    const input = getInput();
    if (input) {
      syncActiveDescendant(input);
    }

    // jsdom には scrollIntoView が無い。
    result?.scrollIntoView?.({ block: 'nearest' });
  }

  function move(delta: number) {
    const results = getOptions();
    if (results.length === 0) {
      return false;
    }

    const current = selected?.isConnected ? results.indexOf(selected) : -1;
    const next =
      current === -1
        ? delta > 0
          ? 0
          : results.length - 1
        : (current + delta + results.length) % results.length;

    select(results[next] ?? null);
    return true;
  }

  function open() {
    // 何も選んでいないまま ↵ を押すのは「先頭を開く」意図として扱う。
    const target = selected?.isConnected ? selected : getOptions()[0];
    const link = target?.querySelector<HTMLAnchorElement>(RESULT_LINK_SELECTOR);
    if (!link) {
      return false;
    }

    link.click();
    return true;
  }

  function handleKeydown(event: KeyboardEvent) {
    // 変換中の Enter は確定であって決定ではない。日本語入力を奪わない。
    //
    // defaultPrevented は見ない。Pagefind 自身が入力欄の Enter を
    // preventDefault している（フォーム送信を止めるため）ので、これを
    // 「他所が処理済み」と読むと ↵ が永久に死ぬ。既定動作が止めてあることと、
    // 鍵が消費されたことは別のこと。
    if (event.isComposing) {
      return false;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return false;
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') {
      return false;
    }

    sync();
    const handled = event.key === 'Enter' ? open() : move(event.key === 'ArrowDown' ? 1 : -1);
    if (handled) {
      event.preventDefault();
    }

    return handled;
  }
}
