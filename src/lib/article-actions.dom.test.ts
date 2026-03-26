// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  type ArticleActionsDeps,
  type ArticleActionsElements,
  articleActionMessages,
  createArticleActionsController,
} from './article-actions';

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function createArticleActionsDom() {
  document.body.innerHTML = `
    <div id="reading-progress"></div>
    <div class="article-actions">
      <button id="copy-link-btn"><span class="action-label">Copy link</span></button>
      <button id="share-btn"><span class="action-label">Share</span></button>
    </div>
    <p id="article-action-status"></p>
    <span id="pct-read"></span>
    <span id="min-left"></span>
  `;

  return {
    copyButton: document.getElementById('copy-link-btn') as HTMLButtonElement,
    copyLabel: document.querySelector('#copy-link-btn .action-label') as HTMLElement,
    minutesLeft: document.getElementById('min-left') as HTMLElement,
    percentRead: document.getElementById('pct-read') as HTMLElement,
    progressBar: document.getElementById('reading-progress') as HTMLElement,
    shareButton: document.getElementById('share-btn') as HTMLButtonElement,
    shareLabel: document.querySelector('#share-btn .action-label') as HTMLElement,
    status: document.getElementById('article-action-status') as HTMLElement,
  } satisfies ArticleActionsElements;
}

function createDeps(overrides: Partial<ArticleActionsDeps> = {}) {
  let scrollListener: (() => void) | null = null;
  const frameQueue: Array<() => void> = [];
  const timeoutQueue: Array<() => void> = [];

  return {
    deps: {
      addScrollListener: (listener: () => void) => {
        scrollListener = listener;
        return () => {
          scrollListener = null;
        };
      },
      clipboardWriteText: async () => {},
      getDocumentTitle: () => 'Length³',
      getLocationHref: () => 'https://length3.pages.dev/getting-started',
      getScrollMetrics: () => ({
        scrollHeight: 2000,
        scrollY: 0,
        viewportHeight: 1000,
      }),
      requestFrame: (callback: () => void) => {
        frameQueue.push(callback);
        return frameQueue.length;
      },
      setTimeout: (callback: () => void) => {
        timeoutQueue.push(callback);
        return timeoutQueue.length;
      },
      share: null,
      warn: vi.fn(),
      ...overrides,
    } satisfies ArticleActionsDeps,
    frameQueue,
    scroll() {
      scrollListener?.();
    },
    timeoutQueue,
  };
}

describe('createArticleActionsController', () => {
  it('announces copy success and restores the button label', async () => {
    const elements = createArticleActionsDom();
    const { deps, frameQueue, timeoutQueue } = createDeps({
      clipboardWriteText: async () => {},
    });

    createArticleActionsController({ elements, readingTime: 8 }, deps);
    elements.copyButton.click();
    await flushPromises();

    expect(elements.copyLabel.textContent).toBe('Copied!');
    frameQueue.shift()?.();
    expect(elements.status.textContent).toBe(articleActionMessages.copySuccess);

    timeoutQueue.shift()?.();
    expect(elements.copyLabel.textContent).toBe('Copy link');
  });

  it('announces share fallback success when navigator.share is unavailable', async () => {
    const elements = createArticleActionsDom();
    const { deps, frameQueue, timeoutQueue } = createDeps({
      clipboardWriteText: async () => {},
      share: null,
    });

    createArticleActionsController({ elements, readingTime: 8 }, deps);
    elements.shareButton.click();
    await flushPromises();

    expect(elements.shareLabel.textContent).toBe('Copied!');
    frameQueue.shift()?.();
    expect(elements.status.textContent).toBe(articleActionMessages.copySuccess);

    timeoutQueue.shift()?.();
    expect(elements.shareLabel.textContent).toBe('Share');
  });

  it('announces share failures but suppresses AbortError', async () => {
    const elements = createArticleActionsDom();
    const failing = createDeps({
      share: async () => {
        throw new Error('share failed');
      },
    });

    createArticleActionsController({ elements, readingTime: 8 }, failing.deps);
    elements.shareButton.click();
    await flushPromises();

    expect(elements.shareLabel.textContent).toBe('Failed');
    failing.frameQueue.shift()?.();
    expect(elements.status.textContent).toBe(articleActionMessages.shareFailure);
    expect(failing.deps.warn).toHaveBeenCalledWith('share', expect.any(Error));

    failing.timeoutQueue.shift()?.();
    expect(elements.shareLabel.textContent).toBe('Share');

    const aborting = createDeps({
      share: async () => {
        const error = new Error('dismissed');
        error.name = 'AbortError';
        throw error;
      },
    });
    const abortElements = createArticleActionsDom();

    createArticleActionsController({ elements: abortElements, readingTime: 8 }, aborting.deps);
    abortElements.shareButton.click();
    await flushPromises();

    expect(aborting.deps.warn).not.toHaveBeenCalled();
    expect(abortElements.status.textContent).toBe('');
  });

  it('updates reading progress on init and coalesces scroll events', () => {
    const elements = createArticleActionsDom();
    let scrollY = 250;
    const { deps, frameQueue, scroll } = createDeps({
      getScrollMetrics: () => ({
        scrollHeight: 2000,
        scrollY,
        viewportHeight: 1000,
      }),
    });

    createArticleActionsController({ elements, readingTime: 8 }, deps);
    expect(elements.percentRead.textContent).toBe('25%');
    expect(elements.minutesLeft.textContent).toBe('~6 min');
    expect(elements.progressBar.getAttribute('aria-valuenow')).toBe('25');

    scrollY = 500;
    scroll();
    scroll();
    expect(frameQueue).toHaveLength(1);

    frameQueue.shift()?.();
    expect(elements.percentRead.textContent).toBe('50%');
    expect(elements.minutesLeft.textContent).toBe('~4 min');
    expect(elements.progressBar.getAttribute('aria-valuenow')).toBe('50');
  });
});
