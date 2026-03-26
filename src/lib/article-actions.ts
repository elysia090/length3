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

export interface ArticleActionsElements {
  copyButton: HTMLButtonElement;
  copyLabel: HTMLElement;
  minutesLeft: HTMLElement;
  percentRead: HTMLElement;
  progressBar: HTMLElement;
  shareButton: HTMLButtonElement;
  shareLabel: HTMLElement;
  status: HTMLElement;
}

export interface ArticleActionsDeps {
  addScrollListener: (listener: () => void) => () => void;
  clipboardWriteText: (text: string) => Promise<void>;
  getDocumentTitle: () => string;
  getLocationHref: () => string;
  getScrollMetrics: () => ScrollMetrics;
  requestFrame: (callback: () => void) => number;
  setTimeout: (callback: () => void, ms: number) => number;
  share: ((data: { title: string; url: string }) => Promise<void>) | null;
  warn: (scope: string, error: unknown) => void;
}

interface ArticleActionsControllerOptions {
  elements: ArticleActionsElements;
  readingTime: number;
}

export interface ArticleActionsController {
  destroy(): void;
  updateReadingProgress(): void;
}

export const articleActionMessages = {
  copyFailure: 'Could not copy the link. Copy the URL from the address bar.',
  copySuccess: 'Link copied to clipboard.',
  shareFailure: 'Could not share the article. Try copying the URL instead.',
  shareSuccess: 'Share dialog completed.',
} as const;

export function createArticleActionsController(
  { elements, readingTime }: ArticleActionsControllerOptions,
  deps: ArticleActionsDeps,
): ArticleActionsController {
  let framePending = false;

  const onCopyClick = () => {
    deps
      .clipboardWriteText(deps.getLocationHref())
      .then(() => {
        flash(elements.copyLabel, 'Copied!', 'Copy link', deps);
        announce(elements.status, articleActionMessages.copySuccess, deps);
      })
      .catch((error) => {
        deps.warn('copy-link', error);
        flash(elements.copyLabel, 'Failed', 'Copy link', deps);
        announce(elements.status, articleActionMessages.copyFailure, deps);
      });
  };

  const onShareClick = () => {
    if (deps.share) {
      deps
        .share({
          title: deps.getDocumentTitle(),
          url: deps.getLocationHref(),
        })
        .then(() => {
          announce(elements.status, articleActionMessages.shareSuccess, deps);
        })
        .catch((error) => {
          if (error instanceof Error && error.name === 'AbortError') {
            return;
          }

          deps.warn('share', error);
          flash(elements.shareLabel, 'Failed', 'Share', deps);
          announce(elements.status, articleActionMessages.shareFailure, deps);
        });
      return;
    }

    deps
      .clipboardWriteText(deps.getLocationHref())
      .then(() => {
        flash(elements.shareLabel, 'Copied!', 'Share', deps);
        announce(elements.status, articleActionMessages.copySuccess, deps);
      })
      .catch((error) => {
        deps.warn('share-fallback', error);
        flash(elements.shareLabel, 'Failed', 'Share', deps);
        announce(elements.status, articleActionMessages.shareFailure, deps);
      });
  };

  const onScroll = () => {
    if (framePending) return;

    framePending = true;
    deps.requestFrame(() => {
      framePending = false;
      updateReadingProgress();
    });
  };

  const removeScrollListener = deps.addScrollListener(onScroll);
  elements.copyButton.addEventListener('click', onCopyClick);
  elements.shareButton.addEventListener('click', onShareClick);
  updateReadingProgress();

  return {
    destroy() {
      removeScrollListener();
      elements.copyButton.removeEventListener('click', onCopyClick);
      elements.shareButton.removeEventListener('click', onShareClick);
    },
    updateReadingProgress,
  };

  function updateReadingProgress() {
    renderReadingProgress(
      elements,
      calculateReadingProgress({
        ...deps.getScrollMetrics(),
        readingTime,
      }),
    );
  }
}

export function calculateReadingProgress({
  readingTime,
  scrollHeight,
  scrollY,
  viewportHeight,
}: ScrollMetrics & { readingTime: number }): ReadingProgressState {
  const totalScrollableHeight = Math.max(0, scrollHeight - viewportHeight);
  const percentRead =
    totalScrollableHeight > 0
      ? Math.min(100, Math.round((scrollY / totalScrollableHeight) * 100))
      : 0;
  const minutesLeft = Math.max(0, Math.round(readingTime * (1 - percentRead / 100)));

  return {
    ariaValueNow: String(percentRead),
    minutesLeft,
    minutesLeftLabel: minutesLeft > 0 ? `~${minutesLeft} min` : '< 1 min',
    percentRead,
    progressValue: `${percentRead}%`,
  };
}

function announce(
  status: HTMLElement,
  message: string,
  deps: Pick<ArticleActionsDeps, 'requestFrame'>,
) {
  status.textContent = '';
  deps.requestFrame(() => {
    status.textContent = message;
  });
}

function flash(
  label: HTMLElement,
  temporaryText: string,
  restoreText: string,
  deps: Pick<ArticleActionsDeps, 'setTimeout'>,
) {
  label.textContent = temporaryText;
  deps.setTimeout(() => {
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
