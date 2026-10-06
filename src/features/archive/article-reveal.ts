import { startBenchProfile } from '../../shared/bench-profile';

/**
 * 一覧の初期表示件数と、1 回押すごとに開く件数。
 *
 * 記事が増えるほど、検索とトピック一覧（一覧の下にある）へ届くまでの
 * スクロールが伸びる。先頭で切っておけば、初回の画面から下端までの距離が
 * 記事数に依らず一定になる。
 *
 * 5 件目は読ませるためではなく、続きがあることを示すために出す。裾が薄れ、
 * その上にボタンが被る。読める形で並ぶのは 4 件、開くのも 4 件ずつ。
 */
export const INITIAL_VISIBLE_ARTICLES = 5;
export const ARTICLE_REVEAL_STEP = 4;

export interface RevealState {
  /** 表示する件数（total を超えない）。 */
  visible: number;
  /** まだ隠れている件数。 */
  remaining: number;
  /** 続きがあるか。false のときボタンは出さない。 */
  hasMore: boolean;
}

/** 現在の表示件数を total で丸め、残数と続きの有無を返す。 */
export function resolveRevealState(total: number, visible: number): RevealState {
  const clamped = Math.min(Math.max(visible, 0), Math.max(total, 0));
  const remaining = Math.max(total, 0) - clamped;

  return { visible: clamped, remaining, hasMore: remaining > 0 };
}

/** 次に開く件数。端数は切り上げず、残っているぶんだけ開く。 */
export function nextVisibleCount(
  total: number,
  visible: number,
  step: number = ARTICLE_REVEAL_STEP,
): number {
  return resolveRevealState(total, visible + Math.max(step, 1)).visible;
}

/**
 * ボタンの読み上げ名。数を出すのは、押すと何件増えるかが見た目（… だけ）
 * からは判らないため。
 */
export function formatRevealLabel(remaining: number, step: number = ARTICLE_REVEAL_STEP): string {
  const count = Math.min(remaining, Math.max(step, 1));
  return count === 1 ? 'Show 1 more article' : `Show ${count} more articles`;
}

/**
 * 押したあとに読み上げる状態。焦点は開いた先頭へ移すが、それだけでは
 * 「何件増えて、あと何件あるか」が伝わらない。
 */
export function formatRevealStatus(added: number, remaining: number): string {
  const shown = added === 1 ? '1 more article shown' : `${added} more articles shown`;
  return remaining > 0 ? `${shown}. ${remaining} remaining.` : `${shown}. End of the list.`;
}

interface ArticleRevealElements {
  button: HTMLButtonElement;
  cards: HTMLElement[];
  footer: HTMLElement;
  status: HTMLElement | null;
}

let cleanupArticleReveal: (() => void) | null = null;

/**
 * 記事カードの一部を畳み、ボタンで 4 件ずつ開く。
 *
 * 畳むのは JS が動いたときだけ。サーバは全件を出しているので、JS が無い環境
 * では今までどおり全部読める（ボタンのほうが hidden のまま残る）。DOM から
 * 消しはしないので、ページ内検索とクローラは畳まれたぶんにも届く。
 */
export function initializeArticleReveal(doc: Document = document) {
  const finishProfile = startBenchProfile('articleReveal.init');

  try {
    cleanupArticleReveal?.();
    cleanupArticleReveal = null;

    const elements = getArticleRevealElements(doc);
    if (!elements) {
      return;
    }

    const { button, cards, footer, status } = elements;
    const total = cards.length;
    let state = resolveRevealState(total, INITIAL_VISIBLE_ARTICLES);

    if (!state.hasMore) {
      return;
    }

    const render = () => {
      cards.forEach((card, index) => {
        card.hidden = index >= state.visible;
        // 末尾の 1 件だけ、続きがあるあいだは裾を薄れさせる（CSS 側で処理）。
        card.toggleAttribute('data-teaser', state.hasMore && index === state.visible - 1);
      });

      footer.hidden = !state.hasMore;
      button.setAttribute('aria-label', formatRevealLabel(state.remaining));
    };

    const onClick = () => {
      const before = state.visible;
      const firstRevealed = cards[before];
      state = resolveRevealState(total, nextVisibleCount(total, before));
      render();

      // 開いた先頭へ焦点を移す。ボタンが消える最後の一押しでも、キーボードの
      // 現在地が body に落ちない。
      const target = firstRevealed?.querySelector<HTMLElement>('a');
      target?.focus();

      if (status) {
        status.textContent = formatRevealStatus(state.visible - before, state.remaining);
      }
    };

    button.addEventListener('click', onClick);
    render();

    cleanupArticleReveal = () => {
      button.removeEventListener('click', onClick);
      for (const card of cards) {
        card.hidden = false;
        card.removeAttribute('data-teaser');
      }
      footer.hidden = true;
      if (status) {
        status.textContent = '';
      }
    };
  } finally {
    finishProfile();
  }
}

function getArticleRevealElements(doc: Document): ArticleRevealElements | null {
  const footer = doc.querySelector<HTMLElement>('[data-article-reveal]');
  const button = footer?.querySelector<HTMLButtonElement>('button');
  const cards = [...doc.querySelectorAll<HTMLElement>('.article-list .article-card')];

  if (!footer || !button || cards.length === 0) {
    return null;
  }

  // 読み上げ用の領域はボタンの外に置く。最後の一押しでボタンごと hidden に
  // なるので、中にあると肝心の「終わり」が読まれない。
  const status = doc.querySelector<HTMLElement>('[data-article-reveal-status]');

  return { button, cards, footer, status };
}
