import type { ArchiveField } from '../archive/client';
import type { SearchCopy } from './search-copy';
import type { SearchEngine, SearchHit } from './search-engine';
import { isDig, isGunman, nearestTerms, type Term } from './terms';

/**
 * 検索画面の中身。巻末索引のように引く。
 *
 *   問い     打った語がそのまま見出しになる大きな一行（本物の入力欄）
 *   標本     一覧と同じ立方体の舞台。一致した記事だけが体積を持ち、
 *            選んでいる 1 件が跳ねて琥珀に光る
 *   本文     何も打っていなければトピックの索引。打てば左に結果、右に
 *            選んでいる記事の下見（日付・読了時間・リード・一致した節）。
 *            何も無ければ、標本は全部長さだけになり、近い語を差し出す
 *
 * 結果の並びは combobox + listbox。焦点は入力欄に置いたまま、↑↓ で選び、
 * Enter で開く（⌘ / Ctrl なら新しいタブ）。指でも、触れた 1 件が選ばれ、
 * 押せば開く。
 */

export interface Entry {
  slug: string;
  number: number;
  minutes: number;
  date: string;
  title: string;
  lead: string;
}

export interface SearchUiElements {
  input: HTMLInputElement;
  body: HTMLElement;
  terms: HTMLElement;
  results: HTMLElement;
  list: HTMLElement;
  preview: HTMLElement;
  void: HTMLElement;
  message: HTMLElement;
  status: HTMLElement;
}

export interface SearchUiOptions {
  elements: SearchUiElements;
  copy: SearchCopy;
  entries: readonly Entry[];
  terms: readonly Term[];
  formatMinutes: (minutes: number) => string;
  loadEngine: () => Promise<SearchEngine>;
  field?: ArchiveField | null;
  navigate?: (url: string, newTab: boolean) => void;
  onGunman?: () => void;
  onDig?: () => void;
}

export type SearchView = 'terms' | 'loading' | 'results' | 'void' | 'unavailable' | 'error';

export interface SearchUi {
  open(): void;
  close(): void;
  /** Esc。語があれば消して true、無ければ false（閉じてよい）。 */
  escape(): boolean;
  readonly view: SearchView;
}

const pad = (n: number) => String(n).padStart(3, '0');

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createSearchUi(options: SearchUiOptions): SearchUi {
  const { elements: e, copy, field = null } = options;
  const entries = new Map(options.entries.map((x) => [x.slug, x]));
  const navigate =
    options.navigate ??
    ((url: string, newTab: boolean) => {
      if (newTab) window.open(url, '_blank', 'noopener');
      else window.location.assign(url);
    });
  let engine: Promise<SearchEngine> | null = null;
  let ready = false;
  let view: SearchView = 'terms';
  let hits: SearchHit[] = [];
  let active = -1;
  let sequence = 0;
  let gunmanOpen = false;
  let digOpen = false;
  const listId = e.list.id || 'search-results';
  e.list.id = listId;

  function show(next: SearchView, message = '') {
    view = next;
    e.body.dataset.view = next;
    e.terms.hidden = next !== 'terms';
    e.results.hidden = next !== 'results';
    e.void.hidden = next !== 'void';
    e.message.hidden = !['loading', 'unavailable', 'error'].includes(next);
    e.message.textContent = message;
    e.input.setAttribute('aria-expanded', String(next === 'results'));
    if (next !== 'results') e.input.removeAttribute('aria-activedescendant');
  }

  function ensureEngine(): Promise<SearchEngine> {
    if (!engine) {
      engine = options.loadEngine();
      engine.then(
        () => {
          ready = true;
        },
        () => {
          engine = null;
        },
      );
    }
    return engine;
  }

  function renderHit(hit: SearchHit, i: number): HTMLElement {
    const entry = entries.get(hit.slug);
    const li = el('li', 'sx-hit');
    li.id = `${listId}-${i}`;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', 'false');
    li.dataset.index = String(i);
    li.append(el('span', 'sx-hit-no', entry ? `No. ${pad(entry.number)}` : ''));
    li.append(el('span', 'sx-hit-title', hit.title));
    const kwic = el('span', 'sx-hit-kwic');
    kwic.innerHTML = hit.excerpt;
    li.append(kwic);
    return li;
  }

  function renderPreview(hit: SearchHit | undefined) {
    e.preview.replaceChildren();
    if (!hit) return;
    const entry = entries.get(hit.slug);
    if (entry) {
      e.preview.append(
        el(
          'p',
          'sx-pv-meta',
          `No. ${pad(entry.number)} · ${entry.date} · ${options.formatMinutes(entry.minutes)}`,
        ),
      );
    }
    const title = el('h2', 'sx-pv-title');
    const link = el('a', '', hit.title);
    link.href = hit.url;
    title.append(link);
    e.preview.append(title);
    if (entry?.lead) e.preview.append(el('p', 'sx-pv-lead', entry.lead));
    if (hit.sections.length > 0) {
      const ol = el('ol', 'sx-pv-sections');
      for (const s of hit.sections.slice(0, 6)) {
        const li = el('li', '');
        const a = el('a', 'sx-pv-section');
        a.href = s.url;
        a.append(el('span', 'sx-pv-section-title', s.title));
        const k = el('span', 'sx-pv-section-kwic');
        k.innerHTML = s.excerpt;
        a.append(k);
        li.append(a);
        ol.append(li);
      }
      e.preview.append(ol);
    }
    const open = el('a', 'sx-pv-open');
    open.href = hit.url;
    open.append(document.createTextNode(`${copy.open} `), el('kbd', '', '↵'));
    e.preview.append(open);
  }

  function setActive(i: number, scroll = false) {
    if (hits.length === 0) return;
    const next = Math.max(0, Math.min(hits.length - 1, i));
    if (next === active) return;
    e.list.querySelector(`[aria-selected="true"]`)?.setAttribute('aria-selected', 'false');
    active = next;
    const option = e.list.querySelector<HTMLElement>(`[data-index="${next}"]`);
    option?.setAttribute('aria-selected', 'true');
    if (option) e.input.setAttribute('aria-activedescendant', option.id);
    if (scroll) option?.scrollIntoView({ block: 'nearest' });
    renderPreview(hits[next]);
    field?.show(new Set(hits.map((h) => h.slug)), hits[next]?.slug ?? null);
  }

  function renderResults(found: SearchHit[]) {
    hits = found;
    active = -1;
    e.list.replaceChildren(...found.map(renderHit));
    show('results');
    setActive(0);
    e.list.scrollTop = 0;
    e.status.textContent = copy.resultCount(found.length);
  }

  function renderVoid(query: string) {
    hits = [];
    active = -1;
    e.list.replaceChildren();
    const title = e.void.querySelector<HTMLElement>('[data-void-title]');
    if (title) title.textContent = copy.voidTitle(query);
    const near = e.void.querySelector<HTMLElement>('[data-void-terms]');
    near?.replaceChildren(
      ...nearestTerms(query, options.terms).map((t) => {
        const b = el('button', 'sx-term sx-term--inline', t.name);
        b.type = 'button';
        b.dataset.term = t.name;
        return b;
      }),
    );
    show('void');
    field?.show(new Set(), null);
    e.status.textContent = copy.voidStatus(query);
  }

  async function run(query: string) {
    const ticket = ++sequence;
    const trimmed = query.trim();
    if (!trimmed) {
      hits = [];
      active = -1;
      e.list.replaceChildren();
      show('terms');
      field?.show(null, null);
      e.status.textContent = '';
      return;
    }
    let found: SearchHit[] | null;
    try {
      if (!ready) show('loading', copy.loading);
      const searcher = await ensureEngine();
      found = await searcher.search(trimmed);
    } catch (error) {
      if (ticket !== sequence) return;
      const unavailable = error instanceof TypeError || String(error).includes('import');
      show(unavailable ? 'unavailable' : 'error', unavailable ? copy.unavailable : copy.error);
      e.status.textContent = e.message.textContent ?? '';
      return;
    }
    if (found === null || ticket !== sequence) return;
    if (found.length > 0) renderResults(found);
    else renderVoid(trimmed);
  }

  function setQuery(value: string) {
    e.input.value = value;
    e.input.focus();
    void run(value);
  }

  e.input.addEventListener('input', () => {
    const q = e.input.value;
    if (isGunman(q) && !gunmanOpen && options.onGunman) {
      gunmanOpen = true;
      options.onGunman();
    }
    if (!isGunman(q)) gunmanOpen = false;
    if (isDig(q) && !digOpen && options.onDig) {
      digOpen = true;
      options.onDig();
    }
    if (!isDig(q)) digOpen = false;
    void run(q);
  });

  e.input.addEventListener('keydown', (event) => {
    if (event.isComposing || view !== 'results') return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(active + (event.key === 'ArrowDown' ? 1 : -1), true);
    } else if (event.key === 'Enter') {
      const hit = hits[active];
      if (!hit) return;
      event.preventDefault();
      navigate(hit.url, event.metaKey || event.ctrlKey);
    }
  });

  const optionAt = (target: EventTarget | null) =>
    target instanceof Element ? target.closest<HTMLElement>('[role="option"]') : null;

  e.list.addEventListener('pointermove', (event) => {
    const option = optionAt(event.target);
    if (option) setActive(Number(option.dataset.index));
  });
  e.list.addEventListener('click', (event) => {
    const option = optionAt(event.target);
    const hit = option ? hits[Number(option.dataset.index)] : undefined;
    if (hit) navigate(hit.url, event.metaKey || event.ctrlKey || event.shiftKey);
  });
  e.list.addEventListener('auxclick', (event) => {
    const option = optionAt(event.target);
    const hit = option ? hits[Number(option.dataset.index)] : undefined;
    if (hit && event.button === 1) navigate(hit.url, true);
  });

  // 索引の語・近い語は、押せばその語で引き直す。
  for (const container of [e.terms, e.void]) {
    container.addEventListener('click', (event) => {
      const button =
        event.target instanceof Element ? event.target.closest<HTMLElement>('[data-term]') : null;
      if (button?.dataset.term) setQuery(button.dataset.term);
    });
  }

  show('terms');

  return {
    open() {
      field?.start();
      e.input.focus();
      void ensureEngine().catch(() => undefined);
      void run(e.input.value);
    },
    close() {
      field?.stop();
      sequence++;
    },
    escape() {
      if (!e.input.value) return false;
      setQuery('');
      return true;
    },
    get view() {
      return view;
    },
  };
}
