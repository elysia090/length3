// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  initializeTableOfContents,
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

function mockBrowserApis() {
  const observers: FakeIntersectionObserver[] = [];

  function IntersectionObserverMock(
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    const observer = new FakeIntersectionObserver(callback, options);
    observers.push(observer);
    return observer;
  }

  vi.stubGlobal('IntersectionObserver', IntersectionObserverMock);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  );

  return { observers };
}

afterEach(() => {
  document.body.innerHTML = '';
  initializeTableOfContents();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('initializeTableOfContents', () => {
  it('marks the topmost intersecting heading as active', () => {
    const { firstHeading, links, secondHeading } = createTocDom();
    const { observers } = mockBrowserApis();

    initializeTableOfContents();

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
    expect(links[0]?.getAttribute('aria-current')).toBe('location');
    expect(links[1]?.classList.contains('active')).toBe(false);
    expect(links[1]?.hasAttribute('aria-current')).toBe(false);
  });

  it('smooth-scrolls, focuses the heading, and updates the hash on click', () => {
    const { headingEls, links } = createTocDom();
    mockBrowserApis();
    const pushState = vi.spyOn(history, 'pushState');

    initializeTableOfContents();

    links[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(headingEls[1]?.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth' });
    expect(document.activeElement).toBe(headingEls[1]);
    expect(pushState).toHaveBeenCalledWith(null, '', '#second');
  });

  it('does not append an article-end sentinel or create a second observer', () => {
    const { articleBody, secondHeading, tocNav } = createTocDom();
    const { observers } = mockBrowserApis();

    initializeTableOfContents();

    expect(articleBody.lastElementChild).toBe(secondHeading);
    expect(observers).toHaveLength(1);

    window.dispatchEvent(new Event('scroll'));
    expect(tocNav.classList.contains('toc--hidden')).toBe(false);
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
