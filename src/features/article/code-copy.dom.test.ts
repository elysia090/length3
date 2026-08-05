// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractCodeText, initializeCodeCopy, shouldAttachCopyButton } from './code-copy';

function createArticleDom(blocks: string[]) {
  document.body.innerHTML = `
    <article class="prose" lang="en">
      ${blocks.map((code) => `<pre><code>${code}</code></pre>`).join('')}
    </article>
  `;
}

function mockClipboard() {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('extractCodeText', () => {
  it('drops trailing whitespace on each line and the final newline', () => {
    const pre = document.createElement('pre');
    pre.textContent = 'const a = 1;   \nconst b = 2;\t\n\n\n';

    expect(extractCodeText(pre)).toBe('const a = 1;\nconst b = 2;');
  });

  it('keeps indentation', () => {
    const pre = document.createElement('pre');
    pre.textContent = 'if (x) {\n  run();\n}';

    expect(extractCodeText(pre)).toBe('if (x) {\n  run();\n}');
  });
});

describe('shouldAttachCopyButton', () => {
  it('skips a block with nothing to copy', () => {
    const pre = document.createElement('pre');
    pre.textContent = '\n  \n';

    expect(shouldAttachCopyButton(pre)).toBe(false);
  });
});

describe('initializeCodeCopy', () => {
  it('wraps each code block and adds one button', () => {
    createArticleDom(['a();', 'b();']);

    initializeCodeCopy(document);

    expect(document.querySelectorAll('.code-block').length).toBe(2);
    expect(document.querySelectorAll('.code-copy').length).toBe(2);
    expect(document.querySelector('.code-block > pre')).not.toBeNull();
  });

  it('names the button for assistive tech', () => {
    createArticleDom(['a();']);

    initializeCodeCopy(document);

    expect(document.querySelector('.code-copy')?.getAttribute('aria-label')).toBe(
      'Copy code to clipboard',
    );
  });

  it('copies the block text and reports back, then settles', async () => {
    const writeText = mockClipboard();
    createArticleDom(['const a = 1;\n']);

    initializeCodeCopy(document);
    const button = document.querySelector('.code-copy') as HTMLButtonElement;
    button.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('const a = 1;'));

    expect(button.classList.contains('is-done')).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('Copied');

    vi.advanceTimersByTime(2000);
    expect(button.classList.contains('is-done')).toBe(false);
    expect(button.getAttribute('aria-label')).toBe('Copy code to clipboard');
  });

  it('reports a failure without throwing when the clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createArticleDom(['a();']);

    initializeCodeCopy(document);
    const button = document.querySelector('.code-copy') as HTMLButtonElement;
    button.click();

    await vi.waitFor(() => expect(button.getAttribute('aria-label')).toBe('Failed'));
    expect(button.classList.contains('is-done')).toBe(false);
    warn.mockRestore();
  });

  it('skips empty blocks', () => {
    createArticleDom(['   \n']);

    initializeCodeCopy(document);

    expect(document.querySelectorAll('.code-copy').length).toBe(0);
  });

  it('unwraps on re-initialisation instead of stacking wrappers', () => {
    createArticleDom(['a();']);

    initializeCodeCopy(document);
    initializeCodeCopy(document);

    expect(document.querySelectorAll('.code-block').length).toBe(1);
    expect(document.querySelectorAll('.code-copy').length).toBe(1);
  });

  it('does nothing on a page without prose', () => {
    document.body.innerHTML = '<main></main>';

    expect(() => initializeCodeCopy(document)).not.toThrow();
  });
});
