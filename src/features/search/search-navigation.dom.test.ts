// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createSearchNavigation } from './search-navigation';

function createResultsDom(count = 2) {
  const results = Array.from(
    { length: count },
    (_value, index) => `
      <li class="pagefind-ui__result">
        <p class="pagefind-ui__result-title">
          <a class="pagefind-ui__result-link" href="/article-${index}">Article ${index}</a>
        </p>
      </li>
    `,
  ).join('');

  document.body.innerHTML = `
    <div id="pagefind-ui">
      <form class="pagefind-ui__form">
        <input class="pagefind-ui__search-input" type="text" />
        <div class="pagefind-ui__drawer">
          <ol class="pagefind-ui__results">${results}</ol>
        </div>
      </form>
    </div>
  `;

  return {
    input: document.querySelector('.pagefind-ui__search-input') as HTMLInputElement,
    list: document.querySelector('.pagefind-ui__results') as HTMLElement,
    mount: document.getElementById('pagefind-ui') as HTMLElement,
    results: [...document.querySelectorAll<HTMLElement>('.pagefind-ui__result')],
  };
}

function pressKey(navigation: ReturnType<typeof createSearchNavigation>, key: string) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key });
  const handled = navigation.handleKeydown(event);
  return { event, handled };
}

describe('createSearchNavigation', () => {
  it('wires the combobox relationship onto the input and the results list', () => {
    const { input, list, mount, results } = createResultsDom();

    createSearchNavigation({ listLabel: 'Search results', mount }).sync();

    expect(list.getAttribute('role')).toBe('listbox');
    expect(list.getAttribute('aria-label')).toBe('Search results');
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-controls')).toBe(list.id);
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    expect(results.every((result) => result.getAttribute('role') === 'option')).toBe(true);
  });

  it('moves the selection with the arrow keys while focus stays in the input', () => {
    const { input, mount, results } = createResultsDom(3);
    const navigation = createSearchNavigation({ mount });
    input.focus();

    const first = pressKey(navigation, 'ArrowDown');

    expect(first.handled).toBe(true);
    expect(first.event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(results[0]?.getAttribute('aria-selected')).toBe('true');
    expect(input.getAttribute('aria-activedescendant')).toBe(results[0]?.id);

    pressKey(navigation, 'ArrowDown');

    expect(results[0]?.getAttribute('aria-selected')).toBe('false');
    expect(results[1]?.getAttribute('aria-selected')).toBe('true');

    pressKey(navigation, 'ArrowUp');

    expect(results[0]?.getAttribute('aria-selected')).toBe('true');
  });

  it('wraps around at both ends', () => {
    const { mount, results } = createResultsDom(2);
    const navigation = createSearchNavigation({ mount });

    pressKey(navigation, 'ArrowUp');
    expect(results[1]?.getAttribute('aria-selected')).toBe('true');

    pressKey(navigation, 'ArrowDown');
    expect(results[0]?.getAttribute('aria-selected')).toBe('true');

    pressKey(navigation, 'ArrowUp');
    expect(results[1]?.getAttribute('aria-selected')).toBe('true');
  });

  it('opens the selected result on Enter', () => {
    const { mount, results } = createResultsDom(2);
    const navigation = createSearchNavigation({ mount });
    const link = results[1]?.querySelector('a') as HTMLAnchorElement;
    const click = vi.fn((event: Event) => event.preventDefault());
    link.addEventListener('click', click);

    pressKey(navigation, 'ArrowDown');
    pressKey(navigation, 'ArrowDown');
    const enter = pressKey(navigation, 'Enter');

    expect(enter.handled).toBe(true);
    expect(enter.event.defaultPrevented).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('opens the first result when Enter is pressed without a selection', () => {
    const { mount, results } = createResultsDom(2);
    const navigation = createSearchNavigation({ mount });
    const link = results[0]?.querySelector('a') as HTMLAnchorElement;
    const click = vi.fn((event: Event) => event.preventDefault());
    link.addEventListener('click', click);

    pressKey(navigation, 'Enter');

    expect(click).toHaveBeenCalledTimes(1);
  });

  it('still opens on Enter after Pagefind cancelled the form submission', () => {
    const { mount, results } = createResultsDom(2);
    const navigation = createSearchNavigation({ mount });
    const link = results[0]?.querySelector('a') as HTMLAnchorElement;
    const click = vi.fn((event: Event) => event.preventDefault());
    link.addEventListener('click', click);

    // Pagefind は入力欄の Enter を preventDefault してから流す。
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' });
    event.preventDefault();

    expect(navigation.handleKeydown(event)).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('leaves Enter alone while an IME conversion is open', () => {
    const { mount, results } = createResultsDom(1);
    const navigation = createSearchNavigation({ mount });
    const link = results[0]?.querySelector('a') as HTMLAnchorElement;
    const click = vi.fn((event: Event) => event.preventDefault());
    link.addEventListener('click', click);

    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      isComposing: true,
      key: 'Enter',
    });

    expect(navigation.handleKeydown(event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it('reports nothing to handle when no result is rendered', () => {
    document.body.innerHTML = `
      <div id="pagefind-ui">
        <form class="pagefind-ui__form"><input class="pagefind-ui__search-input" /></form>
      </div>
    `;
    const mount = document.getElementById('pagefind-ui') as HTMLElement;
    const input = document.querySelector('.pagefind-ui__search-input') as HTMLInputElement;
    const navigation = createSearchNavigation({ mount });

    const down = pressKey(navigation, 'ArrowDown');
    const enter = pressKey(navigation, 'Enter');

    expect(down.handled).toBe(false);
    expect(down.event.defaultPrevented).toBe(false);
    expect(enter.handled).toBe(false);
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('drops a selection that the next render replaced', () => {
    const { input, mount } = createResultsDom(2);
    const navigation = createSearchNavigation({ mount });

    pressKey(navigation, 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBeTruthy();

    const list = document.querySelector('.pagefind-ui__results') as HTMLElement;
    list.innerHTML = `
      <li class="pagefind-ui__result">
        <p class="pagefind-ui__result-title">
          <a class="pagefind-ui__result-link" href="/other">Other</a>
        </p>
      </li>
    `;
    navigation.sync();

    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    expect(document.querySelector('.pagefind-ui__result')?.getAttribute('aria-selected')).toBe(
      'false',
    );
  });

  it('clears the selection when the query changes', () => {
    const { input, mount, results } = createResultsDom(2);
    const navigation = createSearchNavigation({ mount });

    pressKey(navigation, 'ArrowDown');
    navigation.reset();

    expect(results[0]?.getAttribute('aria-selected')).toBe('false');
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
  });
});
