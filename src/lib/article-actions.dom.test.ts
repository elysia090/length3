// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { articleActionMessages, initializeArticleActions } from './article-actions';

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function createArticleActionsDom() {
  document.body.innerHTML = `
    <div id="reading-progress"></div>
    <div class="article-actions" data-reading-time="8">
      <button id="copy-link-btn"><span class="action-label">Copy link</span></button>
      <button id="share-btn"><span class="action-label">Share</span></button>
    </div>
    <p id="article-action-status"></p>
    <span id="pct-read"></span>
    <span id="min-left"></span>
  `;
  document.title = 'Length³';
  history.replaceState(null, '', '/getting-started');

  return {
    copyButton: document.getElementById('copy-link-btn') as HTMLButtonElement,
    copyLabel: document.querySelector('#copy-link-btn .action-label') as HTMLElement,
    minutesLeft: document.getElementById('min-left') as HTMLElement,
    percentRead: document.getElementById('pct-read') as HTMLElement,
    progressBar: document.getElementById('reading-progress') as HTMLElement,
    shareButton: document.getElementById('share-btn') as HTMLButtonElement,
    shareLabel: document.querySelector('#share-btn .action-label') as HTMLElement,
    status: document.getElementById('article-action-status') as HTMLElement,
  };
}

function createBrowserMocks() {
  const frameQueue: Array<() => void> = [];
  const timeoutQueue: Array<() => void> = [];
  let scrollY = 0;

  Object.defineProperty(document.body, 'scrollHeight', {
    configurable: true,
    get: () => 2000,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: 1000,
  });
  Object.defineProperty(window, 'scrollY', {
    configurable: true,
    get: () => scrollY,
  });

  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: vi.fn((callback: FrameRequestCallback) => {
      frameQueue.push(() => callback(0));
      return frameQueue.length;
    }),
  });
  Object.defineProperty(window, 'setTimeout', {
    configurable: true,
    value: vi.fn((callback: TimerHandler) => {
      if (typeof callback === 'function') {
        timeoutQueue.push(callback as () => void);
      }

      return timeoutQueue.length as unknown as number;
    }),
  });

  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: undefined,
  });

  return {
    frameQueue,
    scroll() {
      window.dispatchEvent(new Event('scroll'));
    },
    setScrollY(nextScrollY: number) {
      scrollY = nextScrollY;
    },
    timeoutQueue,
    writeText,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  initializeArticleActions();
  vi.restoreAllMocks();
});

describe('initializeArticleActions', () => {
  it('announces copy success and restores the button label', async () => {
    const elements = createArticleActionsDom();
    const { frameQueue, timeoutQueue } = createBrowserMocks();

    initializeArticleActions();
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
    const { frameQueue, timeoutQueue } = createBrowserMocks();

    initializeArticleActions();
    elements.shareButton.click();
    await flushPromises();

    expect(elements.shareLabel.textContent).toBe('Copied!');
    frameQueue.shift()?.();
    expect(elements.status.textContent).toBe(articleActionMessages.copySuccess);

    timeoutQueue.shift()?.();
    expect(elements.shareLabel.textContent).toBe('Share');
  });

  it('announces share failures', async () => {
    const elements = createArticleActionsDom();
    const failing = createBrowserMocks();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: vi.fn(async () => {
        throw new Error('share failed');
      }),
    });

    initializeArticleActions();
    elements.shareButton.click();
    await flushPromises();

    expect(elements.shareLabel.textContent).toBe('Failed');
    failing.frameQueue.shift()?.();
    expect(elements.status.textContent).toBe(articleActionMessages.shareFailure);
    expect(warn).toHaveBeenCalledWith('[share]', expect.any(Error));

    failing.timeoutQueue.shift()?.();
    expect(elements.shareLabel.textContent).toBe('Share');
  });

  it('suppresses AbortError from navigator.share', async () => {
    const elements = createArticleActionsDom();
    const { frameQueue } = createBrowserMocks();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: vi.fn(async () => {
        const error = new Error('dismissed');
        error.name = 'AbortError';
        throw error;
      }),
    });

    initializeArticleActions();
    elements.shareButton.click();
    await flushPromises();

    expect(warn).not.toHaveBeenCalled();
    expect(elements.status.textContent).toBe('');
    expect(frameQueue).toHaveLength(0);
  });

  it('updates reading progress on init and coalesces scroll events', () => {
    const elements = createArticleActionsDom();
    const { frameQueue, scroll, setScrollY } = createBrowserMocks();

    setScrollY(250);
    initializeArticleActions();
    expect(elements.percentRead.textContent).toBe('25%');
    expect(elements.minutesLeft.textContent).toBe('~6 min');
    expect(elements.progressBar.getAttribute('aria-valuenow')).toBe('25');

    setScrollY(500);
    scroll();
    scroll();
    expect(frameQueue).toHaveLength(1);

    frameQueue.shift()?.();
    expect(elements.percentRead.textContent).toBe('50%');
    expect(elements.minutesLeft.textContent).toBe('~4 min');
    expect(elements.progressBar.getAttribute('aria-valuenow')).toBe('50');
  });
});
