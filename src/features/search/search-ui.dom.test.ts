// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSearchCopy } from './search-copy';
import type { SearchEngine, SearchHit } from './search-engine';
import { createSearchUi, type SearchUiElements } from './search-ui';

const hit = (slug: string, sections = 0): SearchHit => ({
  url: `/${slug}`,
  slug,
  title: `Title ${slug}`,
  excerpt: `a <span class="kwic-k"><mark>${slug}</mark></span> b`,
  sections: Array.from({ length: sections }, (_, i) => ({
    title: `Section ${i}`,
    url: `/${slug}#s${i}`,
    excerpt: 'x',
  })),
});

function dom(): SearchUiElements {
  document.body.innerHTML = `
    <input data-input />
    <div data-body>
      <nav data-terms><button data-term="simd">simd</button></nav>
      <div data-results hidden><ul id="sx-list" data-list></ul><section data-preview></section></div>
      <div data-void hidden><p data-void-title></p><div data-void-terms></div></div>
      <p data-message hidden></p>
    </div>
    <p data-status></p>`;
  const q = (s: string) => document.querySelector(s) as HTMLElement;
  return {
    input: q('[data-input]') as HTMLInputElement,
    body: q('[data-body]'),
    terms: q('[data-terms]'),
    results: q('[data-results]'),
    list: q('[data-list]'),
    preview: q('[data-preview]'),
    void: q('[data-void]'),
    message: q('[data-message]'),
    status: q('[data-status]'),
  };
}

function setup(results: Record<string, SearchHit[]>) {
  const e = dom();
  const engine: SearchEngine = { search: async (q) => results[q] ?? [] };
  const navigate = vi.fn();
  const onGunman = vi.fn();
  const field = { show: vi.fn(), start: vi.fn(), stop: vi.fn() };
  const ui = createSearchUi({
    elements: e,
    copy: getSearchCopy('en'),
    entries: [
      { slug: 'one', number: 7, minutes: 12, date: '2026.08.07', title: 'One', lead: 'Lead one.' },
    ],
    terms: [
      { name: 'simd', count: 3 },
      { name: 'astro', count: 2 },
    ],
    formatMinutes: (m) => `${m} min`,
    loadEngine: async () => engine,
    field,
    navigate,
    onGunman,
  });
  const type = async (value: string) => {
    e.input.value = value;
    e.input.dispatchEvent(new Event('input'));
    await vi.waitFor(() => expect(ui.view).not.toBe('loading'));
    await new Promise((r) => setTimeout(r, 0));
  };
  const key = (k: string, init: KeyboardEventInit = {}) =>
    e.input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }));
  return { e, ui, type, key, navigate, onGunman, field };
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe('createSearchUi', () => {
  it('starts on the index of topics', () => {
    const { e, ui } = setup({});
    expect(ui.view).toBe('terms');
    expect(e.terms.hidden).toBe(false);
    expect(e.results.hidden).toBe(true);
  });

  it('lists results as options, selects the first and previews it', async () => {
    const { e, ui, type, field } = setup({ one: [hit('one', 2), hit('two')] });
    await type('one');
    expect(ui.view).toBe('results');
    const options = e.list.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(2);
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');
    expect(e.input.getAttribute('aria-expanded')).toBe('true');
    expect(e.input.getAttribute('aria-activedescendant')).toBe(options[0]?.id);
    expect(options[0]?.textContent).toContain('No. 007');
    expect(e.preview.textContent).toContain('2026.08.07');
    expect(e.preview.textContent).toContain('Lead one.');
    expect(e.preview.querySelectorAll('.sx-pv-section')).toHaveLength(2);
    expect(field.show).toHaveBeenLastCalledWith(new Set(['one', 'two']), 'one');
    expect(e.status.textContent).toBe('2 search results available.');
  });

  it('moves the selection with the arrow keys and opens it with Enter', async () => {
    const { e, type, key, navigate } = setup({ one: [hit('one'), hit('two')] });
    await type('one');
    key('ArrowDown');
    expect(e.input.getAttribute('aria-activedescendant')).toBe('sx-list-1');
    expect(e.preview.textContent).toContain('Title two');
    key('ArrowDown');
    expect(e.input.getAttribute('aria-activedescendant')).toBe('sx-list-1');
    key('Enter');
    expect(navigate).toHaveBeenLastCalledWith('/two', false);
    key('Enter', { metaKey: true });
    expect(navigate).toHaveBeenLastCalledWith('/two', true);
  });

  it('opens a result on click, in a new tab with a modifier', async () => {
    const { e, type, navigate } = setup({ one: [hit('one'), hit('two')] });
    await type('one');
    const second = e.list.querySelector<HTMLElement>('[data-index="1"] .sx-hit-title');
    second?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(navigate).toHaveBeenLastCalledWith('/two', false);
    second?.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    expect(navigate).toHaveBeenLastCalledWith('/two', true);
  });

  it('shows the void with nearby topics when nothing matches', async () => {
    const { e, ui, type, field } = setup({});
    await type('simx');
    expect(ui.view).toBe('void');
    expect(e.void.textContent).toContain('Nothing in the index for “simx”.');
    expect(e.void.querySelector('[data-term]')?.textContent).toBe('simd');
    expect(field.show).toHaveBeenLastCalledWith(new Set(), null);
  });

  it('searches a topic when it is chosen from the index', async () => {
    const { e, ui } = setup({ simd: [hit('one')] });
    e.terms.querySelector<HTMLElement>('[data-term]')?.click();
    await vi.waitFor(() => expect(ui.view).toBe('results'));
    expect(e.input.value).toBe('simd');
  });

  it('clears the query on Escape before letting the dialog close', async () => {
    const { e, ui, type } = setup({ one: [hit('one')] });
    await type('one');
    expect(ui.escape()).toBe(true);
    expect(e.input.value).toBe('');
    await vi.waitFor(() => expect(ui.view).toBe('terms'));
    expect(ui.escape()).toBe(false);
  });

  it('opens the range for gunman', async () => {
    const { type, onGunman } = setup({});
    await type('gunman');
    expect(onGunman).toHaveBeenCalledTimes(1);
  });
});
