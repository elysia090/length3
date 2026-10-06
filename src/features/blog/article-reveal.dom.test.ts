// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { initializeArticleReveal } from './article-reveal';

function createListDom(count: number) {
  const cards = Array.from(
    { length: count },
    (_, index) =>
      `<article class="article-card"><a href="/post-${index}">Post ${index}</a></article>`,
  ).join('');

  document.body.innerHTML = `
    <section class="article-list">${cards}</section>
    <div class="list-more" data-article-reveal hidden>
      <button type="button" class="list-more-btn"><span aria-hidden="true">…</span></button>
    </div>
    <p data-article-reveal-status></p>
  `;

  return {
    button: document.querySelector('button') as HTMLButtonElement,
    cards: [...document.querySelectorAll<HTMLElement>('.article-card')],
    footer: document.querySelector('[data-article-reveal]') as HTMLElement,
    status: document.querySelector('[data-article-reveal-status]') as HTMLElement,
  };
}

function visibleCount(cards: HTMLElement[]) {
  return cards.filter((card) => !card.hidden).length;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('initializeArticleReveal', () => {
  it('collapses to the first six and offers the rest', () => {
    const { button, cards, footer } = createListDom(9);

    initializeArticleReveal(document);

    expect(visibleCount(cards)).toBe(6);
    expect(footer.hidden).toBe(false);
    expect(button.getAttribute('aria-label')).toBe('Show 3 more articles');
  });

  it('marks only the last visible card as the teaser', () => {
    const { cards } = createListDom(9);

    initializeArticleReveal(document);

    expect(cards.filter((card) => card.hasAttribute('data-teaser'))).toEqual([cards[5]]);
  });

  it('drops the teaser once nothing is left to reveal', () => {
    const { button, cards } = createListDom(7);

    initializeArticleReveal(document);
    button.click();

    expect(cards.some((card) => card.hasAttribute('data-teaser'))).toBe(false);
  });

  it('opens six more per click and drops the button at the end', () => {
    const { button, cards, footer } = createListDom(9);

    initializeArticleReveal(document);

    button.click();
    expect(visibleCount(cards)).toBe(9);
    expect(footer.hidden).toBe(true);
  });

  it('announces what was revealed and what is left', () => {
    const { button, status } = createListDom(15);

    initializeArticleReveal(document);
    button.click();

    expect(status.textContent).toBe('6 more articles shown. 3 remaining.');

    button.click();
    expect(status.textContent).toBe('3 more articles shown. End of the list.');
  });

  it('moves focus to the first newly revealed article', () => {
    const { button, cards } = createListDom(9);

    initializeArticleReveal(document);
    button.click();

    expect(document.activeElement).toBe(cards[6]?.querySelector('a'));
  });

  it('leaves a short list untouched and keeps the button hidden', () => {
    const { cards, footer } = createListDom(6);

    initializeArticleReveal(document);

    expect(visibleCount(cards)).toBe(6);
    expect(footer.hidden).toBe(true);
  });

  it('does nothing when the page has no list', () => {
    document.body.innerHTML = '<main></main>';

    expect(() => initializeArticleReveal(document)).not.toThrow();
  });

  it('restores every card when re-initialised', () => {
    const { button, cards } = createListDom(9);

    initializeArticleReveal(document);
    button.click();
    initializeArticleReveal(document);

    expect(visibleCount(cards)).toBe(6);
  });
});
