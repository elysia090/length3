/**
 * 触れたときの説明。ブラウザの title の代わりに、地図の札と同じ枠で、どこでも
 * 同じ言い方で出す。一行目が本文（墨）、二行目からは添え書き（薄墨）。
 *
 *   出る    マウス・ペンで触れて、少し待ったとき（一度出たら、隣へ移るときは待たない）
 *           キーボードで選んだとき（:focus-visible）
 *   出ない  指で触る端末（押せば中身が開くので）。押した瞬間・巻き取ったとき
 *
 * 札の title は触れたときに預かって（data-tip へ）、読み上げには aria-description で残す。
 */

const DELAY = 420;
const WARM = 500;
const GAP = 6;
const EDGE = 8;

export interface HoverTips {
  hide(): void;
  /** 描き直したあと、触れていた札が消えていたら畳む。 */
  sync(): void;
}

export function hoverTips(root: HTMLElement): HoverTips {
  const tip = document.createElement('div');
  tip.className = 'dig-tip dig-tip--hover';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  root.append(tip);
  let on: HTMLElement | null = null;
  let timer = 0;
  let warmUntil = 0;

  const take = (el: HTMLElement): string => {
    const t = el.getAttribute('title');
    if (t !== null) {
      el.dataset.tip = t;
      el.removeAttribute('title');
      if (t.trim() && !el.hasAttribute('aria-description'))
        el.setAttribute('aria-description', t.replace(/\n+/g, '　'));
    }
    return el.dataset.tip ?? '';
  };

  const place = (el: HTMLElement): void => {
    const r = el.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let top = r.bottom + GAP;
    if (top + th > window.innerHeight - EDGE) top = Math.max(EDGE, r.top - th - GAP);
    const left = Math.min(Math.max(EDGE, r.left), window.innerWidth - tw - EDGE);
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  };

  const show = (el: HTMLElement): void => {
    const text = take(el);
    const lines = text.split('\n').filter((l) => l.trim());
    if (!lines.length) {
      hide();
      return;
    }
    on = el;
    tip.replaceChildren(
      ...lines.map((line, i) => {
        const s = document.createElement('span');
        s.textContent = line;
        if (i) s.className = 'dig-tip__sub';
        return s;
      }),
    );
    tip.hidden = false;
    place(el);
  };

  const hide = (): void => {
    clearTimeout(timer);
    if (on) warmUntil = performance.now() + WARM;
    on = null;
    tip.hidden = true;
  };

  const want = (el: HTMLElement | null): void => {
    clearTimeout(timer);
    if (!el) {
      hide();
      return;
    }
    if (el === on) return;
    take(el);
    if (on || performance.now() < warmUntil) show(el);
    else
      timer = window.setTimeout(() => {
        if (el.isConnected) show(el);
      }, DELAY);
  };

  const find = (t: EventTarget | null): HTMLElement | null =>
    t instanceof Element ? (t.closest<HTMLElement>('[title],[data-tip]') ?? null) : null;
  const fine = (ev: PointerEvent) => ev.pointerType === 'mouse' || ev.pointerType === 'pen';

  root.addEventListener('pointerover', (ev) => {
    if (fine(ev)) want(find(ev.target));
  });
  root.addEventListener('pointerout', (ev) => {
    if (!fine(ev)) return;
    const next = find(ev.relatedTarget);
    if (next !== on) want(next);
  });
  root.addEventListener('pointerdown', hide);
  root.addEventListener('scroll', hide, true);
  root.addEventListener('focusin', (ev) => {
    const el = find(ev.target);
    if (el && ev.target instanceof Element && ev.target.matches(':focus-visible')) {
      clearTimeout(timer);
      show(el);
    }
  });
  root.addEventListener('focusout', hide);

  return {
    hide,
    sync: () => {
      if (on && !on.isConnected) hide();
    },
  };
}
