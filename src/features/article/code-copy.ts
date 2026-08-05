import type { SiteLanguage } from '../../i18n/language';
import { getSiteCopy } from '../../i18n/site-copy';
import { startBenchProfile } from '../../shared/bench-profile';

/** 「コピーしました」を出しておく時間。 */
const FLASH_MS = 1500;

/**
 * 二重四角（重ねた矩形＝複製の記号）と、押した直後に出すチェック。
 * currentColor で描くので、状態の色替えは CSS 側だけで済む。
 */
const COPY_ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true"
  stroke="currentColor" stroke-width="1.25" stroke-linejoin="round">
  <rect x="5.75" y="5.75" width="8.5" height="8.5" rx="1.5" />
  <path d="M11.25 3.25a1.5 1.5 0 0 0-1.5-1.5h-6a2 2 0 0 0-2 2v6a1.5 1.5 0 0 0 1.5 1.5" />
</svg>`;

const DONE_ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true"
  stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 8.5 6.5 12 13 4.5" />
</svg>`;

/** コピー対象の文字列。行末の空白と、末尾の改行は落とす。 */
export function extractCodeText(pre: HTMLElement): string {
  return (pre.textContent ?? '').replace(/[ \t]+$/gm, '').replace(/\n+$/, '');
}

/** ボタンを差し込むべき pre か。空のコードにボタンを付けても押す先がない。 */
export function shouldAttachCopyButton(pre: HTMLElement): boolean {
  return extractCodeText(pre).length > 0;
}

let cleanupCodeCopy: (() => void) | null = null;

/**
 * 各コードブロックの右上にコピーボタンを足す。
 *
 * pre 自体は横スクロールするので、ボタンを pre の中に入れると内容と一緒に
 * 流れて隠れる。pre を包む枠を作り、そちらを位置の基準にする。
 *
 * 生成は実行時。Markdown の出力は触らないので、JS が無い環境の HTML は
 * 今までと同じ（ボタンが無いだけ）。
 */
export function initializeCodeCopy(doc: Document = document) {
  const finishProfile = startBenchProfile('codeCopy.init');

  try {
    cleanupCodeCopy?.();
    cleanupCodeCopy = null;

    const article = doc.querySelector<HTMLElement>('.prose');
    if (!article) {
      return;
    }

    const language = (article.getAttribute('lang') as SiteLanguage | null) ?? 'en';
    const copy = getSiteCopy(language);
    const blocks = [...article.querySelectorAll<HTMLElement>('pre')].filter(shouldAttachCopyButton);

    if (blocks.length === 0) {
      return;
    }

    const teardowns: (() => void)[] = [];

    for (const pre of blocks) {
      const wrapper = doc.createElement('div');
      wrapper.className = 'code-block';
      pre.parentNode?.insertBefore(wrapper, pre);
      wrapper.append(pre);

      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'code-copy';
      button.innerHTML = COPY_ICON;
      button.setAttribute('aria-label', copy.copyCodeAria);
      wrapper.append(button);

      let restoreTimer = 0;

      const settle = (done: boolean, label: string) => {
        window.clearTimeout(restoreTimer);
        button.innerHTML = done ? DONE_ICON : COPY_ICON;
        button.classList.toggle('is-done', done);
        button.setAttribute('aria-label', label);

        restoreTimer = window.setTimeout(() => {
          button.innerHTML = COPY_ICON;
          button.classList.remove('is-done');
          button.setAttribute('aria-label', copy.copyCodeAria);
        }, FLASH_MS);
      };

      const onClick = () => {
        writeClipboardText(extractCodeText(pre))
          .then(() => settle(true, copy.codeCopied))
          .catch((error) => {
            console.warn('[copy-code]', error);
            settle(false, copy.copyFailureLabel);
          });
      };

      button.addEventListener('click', onClick);

      teardowns.push(() => {
        window.clearTimeout(restoreTimer);
        button.removeEventListener('click', onClick);
        wrapper.parentNode?.insertBefore(pre, wrapper);
        wrapper.remove();
      });
    }

    cleanupCodeCopy = () => {
      for (const teardown of teardowns) {
        teardown();
      }
    };
  } finally {
    finishProfile();
  }
}

function writeClipboardText(text: string) {
  const writeText = navigator.clipboard?.writeText?.bind(navigator.clipboard);
  return writeText ? writeText(text) : Promise.reject(new Error('Clipboard API unavailable.'));
}
