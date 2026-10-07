/**
 * 小さな DOM の組み立て。属性は文字列、on* は関数、子は文字列か要素か偽。
 */
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
    else el.setAttribute(k, String(v));
  }
  fill(el, children);
  return el;
}

export function fill(el: Element, children: readonly (Child | readonly Child[])[]): void {
  for (const c of children.flat()) {
    if (c === false || c === null || c === undefined) continue;
    el.append(typeof c === 'number' ? String(c) : c);
  }
}

export const button = (
  label: string,
  on: () => void,
  attrs: Record<string, string | boolean | undefined | ((ev: Event) => void)> = {},
) => h('button', { type: 'button', ...attrs, onclick: on }, label);

export const meter = (v: number, max: number, cls: string, label: string) =>
  h(
    'span',
    {
      class: `dig-meter dig-meter--${cls}`,
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
      h('span', { style: `width:${Math.max(0, Math.min(100, (100 * v) / Math.max(1, max)))}%` }),
    ),
    h('span', { class: 'dig-meter__num' }, `${Math.max(0, v)}/${max}`),
  );
