let cleanupTableOfContents: (() => void) | null = null;

export function initializeTableOfContents() {
  cleanupTableOfContents?.();
  cleanupTableOfContents = null;

  const articleBody = document.querySelector<HTMLElement>('article[data-pagefind-body]');
  const headingEls = [...document.querySelectorAll<HTMLElement>('article h2[id], article h3[id]')];
  const links = [...document.querySelectorAll<HTMLAnchorElement>('.toc-link')];
  const tocNav = document.querySelector<HTMLElement>('.toc');
  const cleanups: Array<() => void> = [];

  bindLinkClicks(links, cleanups);
  observeActiveHeading(links, headingEls, cleanups);
  observeArticleEnd(tocNav, articleBody, cleanups);

  cleanupTableOfContents = () => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
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

function bindLinkClicks(links: readonly HTMLAnchorElement[], cleanups: Array<() => void>) {
  for (const link of links) {
    const onClick = (event: MouseEvent) => {
      const href = link.getAttribute('href');
      if (!href) return;

      const target = link.ownerDocument.querySelector<HTMLElement>(href);
      if (!target) return;

      event.preventDefault();
      target.scrollIntoView({
        behavior: resolveTocScrollBehavior(prefersReducedMotion()),
      });
      focusHeadingTarget(target);
      history.pushState(null, '', href);
    };

    link.addEventListener('click', onClick);
    cleanups.push(() => link.removeEventListener('click', onClick));
  }
}

function observeActiveHeading(
  links: readonly HTMLAnchorElement[],
  headingEls: readonly HTMLElement[],
  cleanups: Array<() => void>,
) {
  if (links.length === 0 || headingEls.length === 0 || typeof IntersectionObserver !== 'function') {
    return;
  }

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
  const observer = new IntersectionObserver(
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
      activeLink?.removeAttribute('aria-current');
      nextLink?.classList.add('active');
      nextLink?.setAttribute('aria-current', 'location');
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
  cleanups: Array<() => void>,
) {
  if (!tocNav || !articleBody || typeof IntersectionObserver !== 'function') return;

  const sentinel = articleBody.ownerDocument.createElement('div');
  sentinel.setAttribute('aria-hidden', 'true');
  articleBody.appendChild(sentinel);

  let userHasScrolled = false;
  const onFirstScroll = () => {
    userHasScrolled = true;
  };
  window.addEventListener('scroll', onFirstScroll, { once: true, passive: true });

  const observer = new IntersectionObserver(
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
    window.removeEventListener('scroll', onFirstScroll);
    observer.disconnect();
    sentinel.remove();
  });
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
