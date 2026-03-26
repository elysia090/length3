export interface SearchModalController {
  close(): void;
  destroy(): void;
  open(): void;
}

interface SearchModalControllerOptions {
  closeButton: HTMLButtonElement;
  document: Document;
  modal: HTMLDialogElement;
  onOpenSearch: () => Promise<unknown> | unknown;
  trigger: HTMLButtonElement;
}

export function createSearchModalController({
  closeButton,
  document,
  modal,
  onOpenSearch,
  trigger,
}: SearchModalControllerOptions): SearchModalController {
  const onTriggerClick = () => open();
  const onCloseButtonClick = () => close();
  const onModalClick = (event: MouseEvent) => {
    if (event.target === modal) {
      modal.close();
    }
  };
  const onModalCancel = () => setExpandedState(trigger, false);
  const onModalClose = () => {
    setExpandedState(trigger, false);
    trigger.focus();
  };
  const onDocumentKeydown = (event: KeyboardEvent) => {
    if (!shouldOpenSearchFromKeydown(event.key, modal.open, document.activeElement)) {
      return;
    }

    event.preventDefault();
    open();
  };

  trigger.addEventListener('click', onTriggerClick);
  closeButton.addEventListener('click', onCloseButtonClick);
  modal.addEventListener('click', onModalClick);
  modal.addEventListener('cancel', onModalCancel);
  modal.addEventListener('close', onModalClose);
  document.addEventListener('keydown', onDocumentKeydown);

  return {
    close,
    destroy() {
      trigger.removeEventListener('click', onTriggerClick);
      closeButton.removeEventListener('click', onCloseButtonClick);
      modal.removeEventListener('click', onModalClick);
      modal.removeEventListener('cancel', onModalCancel);
      modal.removeEventListener('close', onModalClose);
      document.removeEventListener('keydown', onDocumentKeydown);
    },
    open,
  };

  function open() {
    setExpandedState(trigger, true);
    if (!modal.open) {
      modal.showModal();
    }
    void Promise.resolve(onOpenSearch());
  }

  function close() {
    setExpandedState(trigger, false);
    if (modal.open) {
      modal.close();
    }
  }
}

export function shouldOpenSearchFromKeydown(
  key: string,
  modalOpen: boolean,
  activeElement: Element | null,
) {
  return key === '/' && !modalOpen && !isTextEntryElement(activeElement);
}

export function isTextEntryElement(element: Element | null) {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    Boolean(element instanceof HTMLElement && element.isContentEditable)
  );
}

function setExpandedState(trigger: HTMLButtonElement, isExpanded: boolean) {
  trigger.setAttribute('aria-expanded', String(isExpanded));
}
