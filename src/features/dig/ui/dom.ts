import { tr } from '../i18n';

/**
 * 小さな DOM の組み立て。属性は文字列、on* は関数、子は文字列か要素か偽。
 * 文字列（子と、読み上げ・題の属性）は、ここで画面の言語に置き換える。
 */
const SAID = new Set(['aria-label', 'title', 'placeholder', 'alt']);
export type Child = Node | string | number | false | null | undefined;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | ((ev: Event) => void) | undefined> = {},
  ...children: (Child | readonly Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, SAID.has(k) ? tr(String(v)) : String(v));
  }
  fill(el, children);
  return el;
}

export function fill(el: Element, children: readonly (Child | readonly Child[])[]): void {
  for (const c of children.flat()) {
    if (c === false || c === null || c === undefined) continue;
    el.append(typeof c === 'number' ? String(c) : typeof c === 'string' ? tr(c) : c);
  }
}

export const button = (
  label: string,
  on: () => void,
  attrs: Record<string, string | boolean | undefined | ((ev: Event) => void)> = {},
) => h('button', { type: 'button', ...attrs, onclick: on }, label);

/**
 * 目盛り。shield は今効いている守り（減る前に受け止める分）で、棒の先に点線で
 * 伸びる。loss は次の手で失いそうな分で、棒の端が点滅する。
 */
export function meter(
  v: number,
  max: number,
  cls: string,
  label: string,
  extra: { shield?: number; loss?: number; gain?: number } = {},
): HTMLElement {
  const pct = (n: number) => Math.max(0, Math.min(100, (100 * n) / Math.max(1, max)));
  const have = Math.max(0, v);
  const shield = Math.max(0, extra.shield ?? 0);
  // 守りを越えた分だけが、本当に減る。
  const loss = Math.min(have, Math.max(0, (extra.loss ?? 0) - shield));
  // 増えそうな分（信頼・手がかり）。棒の先に、点滅で継ぎ足す。
  const gain = Math.max(0, Math.min(max - have, extra.gain ?? 0));
  return h(
    'span',
    {
      class: `dig-meter dig-meter--${cls}${loss > 0 ? ' is-threatened' : ''}`,
      role: 'meter',
      'aria-valuenow': v,
      'aria-valuemin': 0,
      'aria-valuemax': max,
      'aria-label': label,
    },
    h('span', { class: 'dig-meter__label' }, label),
    h(
      'span',
      { class: 'dig-meter__bar' },
      h('span', { class: 'dig-meter__fill', style: `width:${pct(have - loss)}%` }),
      loss > 0 ? h('span', { class: 'dig-meter__loss', style: `width:${pct(loss)}%` }) : null,
      gain > 0 ? h('span', { class: 'dig-meter__gain', style: `width:${pct(gain)}%` }) : null,
      shield > 0
        ? h('span', { class: 'dig-meter__shield', style: `width:${Math.min(60, pct(shield))}%` })
        : null,
    ),
    h(
      'span',
      { class: 'dig-meter__num' },
      `${have}/${max}`,
      shield > 0 ? h('span', { class: 'dig-meter__guard' }, ` +${shield}`) : null,
    ),
  );
}
