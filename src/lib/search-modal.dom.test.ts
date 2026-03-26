// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createSearchModalController, shouldOpenSearchFromKeydown } from './search-modal';

function createDialogDom() {
  document.body.innerHTML = `
    <button id="trigger" aria-expanded="false"></button>
    <dialog id="modal"></dialog>
    <button id="close"></button>
    <input id="editor" />
  `;

  const trigger = document.getElementById('trigger') as HTMLButtonElement;
  const modal = document.getElementById('modal') as HTMLDialogElement & { open: boolean };
  const closeButton = document.getElementById('close') as HTMLButtonElement;
  const editor = document.getElementById('editor') as HTMLInputElement;

  Object.defineProperty(modal, 'open', {
    configurable: true,
    value: false,
    writable: true,
  });
  modal.showModal = vi.fn(() => {
    modal.open = true;
  });
  modal.close = vi.fn(() => {
    modal.open = false;
    modal.dispatchEvent(new Event('close'));
  });

  return { closeButton, editor, modal, trigger };
}

describe('createSearchModalController', () => {
  it('opens the dialog from the trigger and syncs aria-expanded', () => {
    const { closeButton, modal, trigger } = createDialogDom();
    const onOpenSearch = vi.fn();

    createSearchModalController({
      closeButton,
      document,
      modal,
      onOpenSearch,
      trigger,
    });

    trigger.click();

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(modal.showModal).toHaveBeenCalledTimes(1);
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it('closes from the close button and returns focus to the trigger', () => {
    const { closeButton, modal, trigger } = createDialogDom();

    createSearchModalController({
      closeButton,
      document,
      modal,
      onOpenSearch: vi.fn(),
      trigger,
    }).open();

    closeButton.click();

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(modal.close).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on overlay click', () => {
    const { closeButton, modal, trigger } = createDialogDom();
    const controller = createSearchModalController({
      closeButton,
      document,
      modal,
      onOpenSearch: vi.fn(),
      trigger,
    });

    controller.open();
    modal.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(modal.close).toHaveBeenCalledTimes(1);
  });

  it('opens from slash only when focus is outside text entry controls', () => {
    const { closeButton, editor, modal, trigger } = createDialogDom();
    const onOpenSearch = vi.fn();

    createSearchModalController({
      closeButton,
      document,
      modal,
      onOpenSearch,
      trigger,
    });

    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: '/' }));
    expect(onOpenSearch).toHaveBeenCalledTimes(1);

    onOpenSearch.mockClear();
    editor.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: '/' }));
    expect(onOpenSearch).not.toHaveBeenCalled();
  });
});

describe('shouldOpenSearchFromKeydown', () => {
  it('rejects slash while the modal is open', () => {
    expect(shouldOpenSearchFromKeydown('/', true, document.body)).toBe(false);
  });
});
