import { startBenchProfile } from './bench-profile';
import { formatRemainingReadingTime, getSiteCopy } from './ui-copy';

export interface ReadingProgressState {
  ariaValueNow: string;
  minutesLeft: number;
  minutesLeftLabel: string;
  percentRead: number;
  progressValue: string;
}

export interface ScrollMetrics {
  scrollHeight: number;
  scrollY: number;
  viewportHeight: number;
}

interface ArticleActionsElements {
  container: HTMLElement;
  copyButton: HTMLButtonElement;
  copyLabel: HTMLElement;
  copyRestoreLabel: string;
  copyTemporaryLabel: string;
  failureTemporaryLabel: string;
  language: 'en' | 'ja';
  minutesLeft: HTMLElement;
  percentRead: HTMLElement;
  progressBar: HTMLElement;
  shareButton: HTMLButtonElement;
  shareLabel: HTMLElement;
  shareRestoreLabel: string;
  status: HTMLElement;
}

export const articleActionMessages = {
  copyFailure: 'Could not copy the link. Copy the URL from the address bar.',
  copySuccess: 'Link copied to clipboard.',
  shareFailure: 'Could not share the article. Try copying the URL instead.',
  shareSuccess: 'Share dialog completed.',
} as const;

let cleanupArticleActions: (() => void) | null = null;

export function initializeArticleActions() {
  const finishProfile = startBenchProfile('articleActions.init');

  try {
    cleanupArticleActions?.();
    cleanupArticleActions = null;

    const elements = getArticleActionsElements(document);
    if (!elements) {
      return;
    }

    const readingTime = Number(elements.container.dataset.readingTime) || 5;
    const copy = getSiteCopy(elements.language);
    let framePending = false;

    const onCopyClick = () => {
      writeClipboardText(window.location.href)
        .then(() => {
          flash(elements.copyLabel, elements.copyTemporaryLabel, elements.copyRestoreLabel);
          announce(elements.status, copy.copySuccess);
        })
        .catch((error) => {
          warn('copy-link', error);
          flash(elements.copyLabel, elements.failureTemporaryLabel, elements.copyRestoreLabel);
          announce(elements.status, copy.copyFailure);
        });
    };

    const onShareClick = () => {
      const share = getShare();
      if (share) {
        share({
          title: document.title,
          url: window.location.href,
        })
          .then(() => {
            announce(elements.status, copy.shareSuccess);
          })
          .catch((error) => {
            if (error instanceof Error && error.name === 'AbortError') {
              return;
            }

            warn('share', error);
            flash(elements.shareLabel, elements.failureTemporaryLabel, elements.shareRestoreLabel);
            announce(elements.status, copy.shareFailure);
          });
        return;
      }

      writeClipboardText(window.location.href)
        .then(() => {
          flash(elements.shareLabel, elements.copyTemporaryLabel, elements.shareRestoreLabel);
          announce(elements.status, copy.copySuccess);
        })
        .catch((error) => {
          warn('share-fallback', error);
          flash(elements.shareLabel, elements.failureTemporaryLabel, elements.shareRestoreLabel);
          announce(elements.status, copy.shareFailure);
        });
    };

    const onScroll = () => {
      if (framePending) return;

      framePending = true;
      window.requestAnimationFrame(() => {
        framePending = false;
        updateReadingProgress(elements, readingTime);
      });
    };

    let initialProgressFrame = 0;

    window.addEventListener('scroll', onScroll, { passive: true });
    elements.copyButton.addEventListener('click', onCopyClick);
    elements.shareButton.addEventListener('click', onShareClick);

    initialProgressFrame = window.requestAnimationFrame(() => {
      const finishInitialRender = startBenchProfile('articleActions.initialProgress', {
        readingTime,
      });
      try {
        updateReadingProgress(elements, readingTime);
      } finally {
        finishInitialRender();
      }
    });

    cleanupArticleActions = () => {
      window.cancelAnimationFrame(initialProgressFrame);
      window.removeEventListener('scroll', onScroll);
      elements.copyButton.removeEventListener('click', onCopyClick);
      elements.shareButton.removeEventListener('click', onShareClick);
    };
  } finally {
    finishProfile();
  }
}

export function calculateReadingProgress({
  language = 'en',
  readingTime,
  scrollHeight,
  scrollY,
  viewportHeight,
}: ScrollMetrics & { language?: 'en' | 'ja'; readingTime: number }): ReadingProgressState {
  const totalScrollableHeight = Math.max(0, scrollHeight - viewportHeight);
  const percentRead =
    totalScrollableHeight > 0
      ? Math.min(100, Math.round((scrollY / totalScrollableHeight) * 100))
      : 0;
  const minutesLeft = Math.max(0, Math.round(readingTime * (1 - percentRead / 100)));

  return {
    ariaValueNow: String(percentRead),
    minutesLeft,
    minutesLeftLabel: formatRemainingReadingTime(minutesLeft, language),
    percentRead,
    progressValue: `${percentRead}%`,
  };
}

function getArticleActionsElements(doc: Document): ArticleActionsElements | null {
  const container = doc.querySelector<HTMLElement>('.article-actions');
  const status = doc.getElementById('article-action-status');
  const copyButton = doc.getElementById('copy-link-btn');
  const shareButton = doc.getElementById('share-btn');
  const percentRead = doc.getElementById('pct-read');
  const minutesLeft = doc.getElementById('min-left');
  const progressBar = doc.getElementById('reading-progress');

  if (
    !(container instanceof HTMLElement) ||
    !(status instanceof HTMLElement) ||
    !(copyButton instanceof HTMLButtonElement) ||
    !(shareButton instanceof HTMLButtonElement) ||
    !(percentRead instanceof HTMLElement) ||
    !(minutesLeft instanceof HTMLElement) ||
    !(progressBar instanceof HTMLElement)
  ) {
    return null;
  }

  const copyLabel = copyButton.querySelector<HTMLElement>('.action-label');
  const shareLabel = shareButton.querySelector<HTMLElement>('.action-label');
  if (!(copyLabel instanceof HTMLElement) || !(shareLabel instanceof HTMLElement)) {
    return null;
  }

  const language = container.dataset.lang === 'ja' ? 'ja' : 'en';
  const copy = getSiteCopy(language);

  return {
    container,
    copyButton,
    copyLabel,
    copyRestoreLabel: copy.copyLink,
    copyTemporaryLabel: copy.copiedLabel,
    failureTemporaryLabel: copy.copyFailureLabel,
    language,
    minutesLeft,
    percentRead,
    progressBar,
    shareButton,
    shareLabel,
    shareRestoreLabel: copy.share,
    status,
  };
}

function updateReadingProgress(elements: ArticleActionsElements, readingTime: number) {
  renderReadingProgress(
    elements,
    calculateReadingProgress({
      ...getScrollMetrics(),
      language: elements.language,
      readingTime,
    }),
  );
}

function getScrollMetrics(): ScrollMetrics {
  return {
    scrollHeight: document.body.scrollHeight,
    scrollY: window.scrollY,
    viewportHeight: window.innerHeight,
  };
}

function getShare() {
  const share = navigator.share?.bind(navigator);
  return typeof share === 'function' ? (data: { title: string; url: string }) => share(data) : null;
}

function writeClipboardText(text: string) {
  const writeText = navigator.clipboard?.writeText?.bind(navigator.clipboard);
  return writeText ? writeText(text) : Promise.reject(new Error('Clipboard API unavailable.'));
}

function warn(scope: string, error: unknown) {
  console.warn(`[${scope}]`, error);
}

function announce(status: HTMLElement, message: string) {
  status.textContent = '';
  window.requestAnimationFrame(() => {
    status.textContent = message;
  });
}

function flash(label: HTMLElement, temporaryText: string, restoreText: string) {
  label.textContent = temporaryText;
  window.setTimeout(() => {
    label.textContent = restoreText;
  }, 1500);
}

function renderReadingProgress(
  elements: Pick<ArticleActionsElements, 'minutesLeft' | 'percentRead' | 'progressBar'>,
  state: ReadingProgressState,
) {
  elements.percentRead.textContent = state.progressValue;
  elements.minutesLeft.textContent = state.minutesLeftLabel;
  elements.progressBar.style.setProperty('--progress', state.progressValue);
  elements.progressBar.setAttribute('aria-valuenow', state.ariaValueNow);
}
