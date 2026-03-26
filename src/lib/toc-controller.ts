export interface TocController {
  destroy(): void;
}

export interface TocControllerDeps {
  createObserver: (
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) => {
    disconnect(): void;
    observe(target: Element): void;
  };
  onFirstScroll: (listener: () => void) => () => void;
  prefersReducedMotion: () => boolean;
  pushHistoryHash: (href: string) => void;
}

interface TocControllerOptions {
  articleBody: HTMLElement | null;
  headingEls: readonly HTMLElement[];
  links: readonly HTMLAnchorElement[];
  tocNav: HTMLElement | null;
}

export function createTableOfContentsController(
  { articleBody, headingEls, links, tocNav }: TocControllerOptions,
  deps: TocControllerDeps,
): TocController {
  const cleanups: Array<() => void> = [];

  bindLinkClicks(links, deps, cleanups);
  observeActiveHeading(links, headingEls, deps, cleanups);
  observeArticleEnd(tocNav, articleBody, deps, cleanups);

  return {
    destroy() {
      while (cleanups.length > 0) {
        cleanups.pop()?.();
      }
    },
  };
}

export function focusHeadingTarget(target: HTMLElement) {
  if (!target.hasAttribute('tabindex')) {
    target.setAttribute('tabindex', '-1');
  }
  target.focus({ preventScroll: true });
}

export function pickActiveHeadingId(
  headingIds: readonly string[],
  intersectingIds: ReadonlySet<string>,
) {
  for (const headingId of headingIds) {
    if (intersectingIds.has(headingId)) {
      return headingId;
    }
  }

  return null;
}

export function resolveTocScrollBehavior(prefersReducedMotion: boolean): ScrollBehavior {
  return prefersReducedMotion ? 'auto' : 'smooth';
}

function bindLinkClicks(
  links: readonly HTMLAnchorElement[],
  deps: TocControllerDeps,
  cleanups: Array<() => void>,
) {
  for (const link of links) {
    const onClick = (event: MouseEvent) => {
      const href = link.getAttribute('href');
      if (!href) return;

      const target = link.ownerDocument.querySelector<HTMLElement>(href);
      if (!target) return;

      event.preventDefault();
      target.scrollIntoView({
        behavior: resolveTocScrollBehavior(deps.prefersReducedMotion()),
      });
      focusHeadingTarget(target);
      deps.pushHistoryHash(href);
    };

    link.addEventListener('click', onClick);
    cleanups.push(() => link.removeEventListener('click', onClick));
  }
}

function observeActiveHeading(
  links: readonly HTMLAnchorElement[],
  headingEls: readonly HTMLElement[],
  deps: TocControllerDeps,
  cleanups: Array<() => void>,
) {
  if (links.length === 0 || headingEls.length === 0) return;

  const linkByHeadingId = new Map<string, HTMLAnchorElement>();
  for (const link of links) {
    const headingId = link.getAttribute('href')?.slice(1);
    if (headingId) {
      linkByHeadingId.set(headingId, link);
    }
  }

  let activeLink: HTMLAnchorElement | null = null;
  const intersectingIds = new Set<string>();
  const headingIds = headingEls.map((heading) => heading.id);
  const observer = deps.createObserver(
    (entries) => {
      for (const entry of entries) {
        if (!(entry.target instanceof HTMLElement)) continue;

        if (entry.isIntersecting) {
          intersectingIds.add(entry.target.id);
        } else {
          intersectingIds.delete(entry.target.id);
        }
      }

      const nextHeadingId = pickActiveHeadingId(headingIds, intersectingIds);
      const nextLink = nextHeadingId ? (linkByHeadingId.get(nextHeadingId) ?? null) : null;
      if (nextLink === activeLink) return;

      activeLink?.classList.remove('active');
      nextLink?.classList.add('active');
      activeLink = nextLink;
    },
    { rootMargin: '0px 0px -55% 0px', threshold: 0 },
  );

  for (const heading of headingEls) {
    observer.observe(heading);
  }

  cleanups.push(() => observer.disconnect());
}

function observeArticleEnd(
  tocNav: HTMLElement | null,
  articleBody: HTMLElement | null,
  deps: TocControllerDeps,
  cleanups: Array<() => void>,
) {
  if (!tocNav || !articleBody) return;

  const sentinel = articleBody.ownerDocument.createElement('div');
  sentinel.setAttribute('aria-hidden', 'true');
  articleBody.appendChild(sentinel);

  let userHasScrolled = false;
  const removeScrollListener = deps.onFirstScroll(() => {
    userHasScrolled = true;
  });

  const observer = deps.createObserver(
    ([entry]) => {
      if (!userHasScrolled) return;

      const pastArticleBody = Boolean(
        entry && !entry.isIntersecting && entry.boundingClientRect.top < 0,
      );
      tocNav.classList.toggle('toc--hidden', pastArticleBody);
    },
    { threshold: 0 },
  );

  observer.observe(sentinel);
  cleanups.push(() => {
    removeScrollListener();
    observer.disconnect();
    sentinel.remove();
  });
}
