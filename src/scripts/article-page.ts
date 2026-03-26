import { createArticleActionsController } from '../lib/article-actions';
import { createTableOfContentsController } from '../lib/toc-controller';

initTableOfContents();
initArticleActions();

function initTableOfContents() {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('.toc-link')];
  const tocNav = document.querySelector<HTMLElement>('.toc');
  const articleBody = document.querySelector<HTMLElement>('article[data-pagefind-body]');

  if (!tocNav || !articleBody || links.length === 0) return;

  createTableOfContentsController(
    {
      articleBody,
      headingEls: [...document.querySelectorAll<HTMLElement>('article h2[id], article h3[id]')],
      links,
      tocNav,
    },
    {
      createObserver: (callback, options) => new IntersectionObserver(callback, options),
      onFirstScroll: (listener) => {
        window.addEventListener('scroll', listener, { once: true, passive: true });
        return () => window.removeEventListener('scroll', listener);
      },
      prefersReducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      pushHistoryHash: (href) => history.pushState(null, '', href),
    },
  );
}

function initArticleActions() {
  const container = document.querySelector<HTMLElement>('.article-actions');
  const status = document.getElementById('article-action-status');
  const copyButton = document.getElementById('copy-link-btn') as HTMLButtonElement | null;
  const shareButton = document.getElementById('share-btn') as HTMLButtonElement | null;
  const percentRead = document.getElementById('pct-read');
  const minutesLeft = document.getElementById('min-left');
  const progressBar = document.getElementById('reading-progress');
  const copyLabel = copyButton?.querySelector<HTMLElement>('.action-label') ?? null;
  const shareLabel = shareButton?.querySelector<HTMLElement>('.action-label') ?? null;

  if (
    !container ||
    !status ||
    !copyButton ||
    !shareButton ||
    !copyLabel ||
    !shareLabel ||
    !percentRead ||
    !minutesLeft ||
    !progressBar
  ) {
    return;
  }

  const share = navigator.share?.bind(navigator);

  createArticleActionsController(
    {
      elements: {
        copyButton,
        copyLabel,
        minutesLeft,
        percentRead,
        progressBar,
        shareButton,
        shareLabel,
        status,
      },
      readingTime: Number(container.dataset.readingTime) || 5,
    },
    {
      addScrollListener: (listener) => {
        window.addEventListener('scroll', listener, { passive: true });
        return () => window.removeEventListener('scroll', listener);
      },
      clipboardWriteText: (text) => {
        const writeText = navigator.clipboard?.writeText?.bind(navigator.clipboard);
        return writeText
          ? writeText(text)
          : Promise.reject(new Error('Clipboard API unavailable.'));
      },
      getDocumentTitle: () => document.title,
      getLocationHref: () => window.location.href,
      getScrollMetrics: () => ({
        scrollHeight: document.body.scrollHeight,
        scrollY: window.scrollY,
        viewportHeight: window.innerHeight,
      }),
      requestFrame: (callback) => window.requestAnimationFrame(() => callback()),
      setTimeout: (callback, ms) => window.setTimeout(callback, ms),
      share: share ? (data) => share({ title: data.title, url: data.url }) : null,
      warn: (scope, error) => console.warn(`[${scope}]`, error),
    },
  );
}
