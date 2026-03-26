// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  createTableOfContentsController,
  pickActiveHeadingId,
  resolveTocScrollBehavior,
} from './toc-controller';

class FakeIntersectionObserver {
  constructor(
    public readonly callback: IntersectionObserverCallback,
    public readonly options?: IntersectionObserverInit,
  ) {}

  disconnect = vi.fn();
  observe = vi.fn();
}

function createTocDom() {
  document.body.innerHTML = `
    <nav class="toc">
      <a class="toc-link" href="#first">First</a>
      <a class="toc-link" href="#second">Second</a>
    </nav>
    <article data-pagefind-body>
      <h2 id="first">First</h2>
      <h2 id="second">Second</h2>
    </article>
  `;

  const tocNav = document.querySelector('.toc') as HTMLElement;
  const links = [...document.querySelectorAll<HTMLAnchorElement>('.toc-link')];
  const headingEls = [...document.querySelectorAll<HTMLElement>('article h2[id]')];
  const articleBody = document.querySelector('article[data-pagefind-body]') as HTMLElement;
  const [firstHeading, secondHeading] = headingEls as [HTMLElement, HTMLElement];

  for (const heading of headingEls) {
    heading.scrollIntoView = vi.fn();
  }

  return { articleBody, firstHeading, headingEls, links, secondHeading, tocNav };
}

describe('createTableOfContentsController', () => {
  it('marks the topmost intersecting heading as active', () => {
    const { articleBody, firstHeading, headingEls, links, secondHeading, tocNav } = createTocDom();
    const observers: FakeIntersectionObserver[] = [];

    createTableOfContentsController(
      { articleBody, headingEls, links, tocNav },
      {
        createObserver: (callback, options) => {
          const observer = new FakeIntersectionObserver(callback, options);
          observers.push(observer);
          return observer;
        },
        onFirstScroll: () => () => {},
        prefersReducedMotion: () => false,
        pushHistoryHash: vi.fn(),
      },
    );

    observers[0]?.callback(
      [
        {
          boundingClientRect: {} as DOMRectReadOnly,
          intersectionRatio: 1,
          intersectionRect: {} as DOMRectReadOnly,
          isIntersecting: true,
          rootBounds: null,
          target: secondHeading,
          time: 0,
        },
        {
          boundingClientRect: {} as DOMRectReadOnly,
          intersectionRatio: 1,
          intersectionRect: {} as DOMRectReadOnly,
          isIntersecting: true,
          rootBounds: null,
          target: firstHeading,
          time: 0,
        },
      ],
      {} as IntersectionObserver,
    );

    expect(links[0]?.classList.contains('active')).toBe(true);
    expect(links[1]?.classList.contains('active')).toBe(false);
  });

  it('smooth-scrolls, focuses the heading, and updates the hash on click', () => {
    const { articleBody, headingEls, links, tocNav } = createTocDom();
    const pushHistoryHash = vi.fn();

    createTableOfContentsController(
      { articleBody, headingEls, links, tocNav },
      {
        createObserver: () => new FakeIntersectionObserver(vi.fn()),
        onFirstScroll: () => () => {},
        prefersReducedMotion: () => false,
        pushHistoryHash,
      },
    );

    links[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(headingEls[1]?.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth' });
    expect(document.activeElement).toBe(headingEls[1]);
    expect(pushHistoryHash).toHaveBeenCalledWith('#second');
  });

  it('fades the toc only after the user has scrolled past the article body', () => {
    const { articleBody, headingEls, links, tocNav } = createTocDom();
    const observers: FakeIntersectionObserver[] = [];
    let triggerFirstScroll: (() => void) | undefined;

    createTableOfContentsController(
      { articleBody, headingEls, links, tocNav },
      {
        createObserver: (callback, options) => {
          const observer = new FakeIntersectionObserver(callback, options);
          observers.push(observer);
          return observer;
        },
        onFirstScroll: (listener) => {
          triggerFirstScroll = listener;
          return () => {};
        },
        prefersReducedMotion: () => false,
        pushHistoryHash: vi.fn(),
      },
    );

    const sentinel = articleBody.lastElementChild;
    expect(sentinel).not.toBeNull();

    observers[1]?.callback(
      [
        {
          boundingClientRect: { top: -1 } as DOMRectReadOnly,
          intersectionRatio: 0,
          intersectionRect: {} as DOMRectReadOnly,
          isIntersecting: false,
          rootBounds: null,
          target: sentinel as Element,
          time: 0,
        },
      ],
      {} as IntersectionObserver,
    );
    expect(tocNav.classList.contains('toc--hidden')).toBe(false);

    triggerFirstScroll?.();
    observers[1]?.callback(
      [
        {
          boundingClientRect: { top: -1 } as DOMRectReadOnly,
          intersectionRatio: 0,
          intersectionRect: {} as DOMRectReadOnly,
          isIntersecting: false,
          rootBounds: null,
          target: sentinel as Element,
          time: 0,
        },
      ],
      {} as IntersectionObserver,
    );
    expect(tocNav.classList.contains('toc--hidden')).toBe(true);
  });
});

describe('toc helpers', () => {
  it('picks the first heading in document order from the intersecting set', () => {
    expect(pickActiveHeadingId(['first', 'second'], new Set(['second', 'first']))).toBe('first');
  });

  it('uses auto scrolling when reduced motion is preferred', () => {
    expect(resolveTocScrollBehavior(true)).toBe('auto');
    expect(resolveTocScrollBehavior(false)).toBe('smooth');
  });
});
