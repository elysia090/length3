import { mountQueryStrip } from './query-strip';

/**
 * 検索の遊び。入力欄と結果を見張って、立体の字の帯に知らせる。
 *
 * 'gunman' と打つと射撃場が開く。射撃場のコードはそのときに初めて読む
 * ので、ふだんの検索の重さは変わらない。
 */

const RESULT_SELECTOR = '.pagefind-ui__results > .pagefind-ui__result';
const SETTLE_MS = 450;

export function isGunman(query: string): boolean {
  return query.trim().toLowerCase() === 'gunman';
}

export interface SearchPlay {
  start(): void;
  stop(): void;
}

export function attachSearchPlay(modal: HTMLElement, mount: HTMLElement): SearchPlay | null {
  const canvas = modal.querySelector<HTMLCanvasElement>('[data-search-strip]');
  if (!canvas) return null;
  const strip = mountQueryStrip(canvas);
  let query = '';
  let settled = false;
  let timer = 0;
  let rangeOpen = false;
  const count = () => mount.querySelectorAll(RESULT_SELECTOR).length;
  const report = () => strip?.setCount(count(), settled && query.trim().length > 0);

  modal.addEventListener('input', (event) => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement)) return;
    query = field.value;
    settled = false;
    strip?.setQuery(query);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      settled = true;
      report();
    }, SETTLE_MS);
    if (isGunman(query) && !rangeOpen) {
      rangeOpen = true;
      void import('../gunman').then(({ openRange }) =>
        openRange(modal.ownerDocument, () => {
          rangeOpen = false;
          field.focus();
        }),
      );
    }
  });
  new MutationObserver(report).observe(mount, { childList: true, subtree: true });

  return {
    start: () => strip?.start(),
    stop: () => strip?.stop(),
  };
}
