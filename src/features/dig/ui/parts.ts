import { afterDef } from '../content/after';
import { sectionOf, useOf } from '../content/floors';
import { quirkDef } from '../content/quirks';
import { epithetDef, foeDef } from '../content/registry';
import { titleDef } from '../content/titles';
import type { MapNode, World } from '../core/model';
import { TAG_NAME } from '../core/tags';
import { tr } from '../i18n';
import { hardnessLabel, nodeHardness, outmatched, youHardness } from '../sim/hardness';
import { nodeOf, OUTCOME_NAME, stratumName } from '../sim/run';
import { heals } from './cards';
import { type Child, h } from './dom';
import { floorNo, KIND_NAME, way, whoOf } from './words';

/** 小さな部品：欄の見出し・選ぶ箱・数え上げ・計器の点・硬度の札・場所の書き方。状態を持たない。 */

export const titled = (el: HTMLElement, text: string): HTMLElement => {
  el.title = tr(text);
  return el;
};

/** 小さな四角の並び（埋まった数 / 全部）。 */
export const pipRow = (n: number, of: number, cls: string, fresh = false) =>
  h(
    'span',
    { class: `dig-pips dig-pips--${cls}`, 'aria-hidden': 'true' },
    Array.from({ length: of }, (_, i) =>
      h('i', { class: i < n ? (fresh && i === n - 1 ? 'is-on is-new' : 'is-on') : '' }),
    ),
  );

export const hardTag = (hard: number, you?: number) =>
  h(
    'span',
    {
      class: `dig-hard${you !== undefined && outmatched(hard, you) ? ' is-over' : ''}`,
      title: hardnessLabel(hard),
    },
    `硬度 ${hard}`,
  );

/**
 * 場所・人物・硬度の書き方は一つにそろえる（上帯・触れた札・部屋・遭遇・道の読み）。
 *   場所  B3・閉店間際の酒場     （B# は太字、・でつなぐ）
 *   人物  名前　硬度 5          （硬度は数字だけ。鉱物の名は触れると出る）
 */
export const placeOf = (w: World, n: MapNode | undefined): Child[] =>
  n
    ? [
        h('b', {}, `B${floorNo(w, n.row)}`),
        `・${useOf(w.stratum, n.use)?.name ?? KIND_NAME[n.kind]}`,
      ]
    : [h('b', {}, `B${floorNo(w, 0)}`), `・${stratumName(w.stratum)}の上`];

export const section = (title: string, ...kids: (Child | readonly Child[])[]) =>
  h('section', { class: 'dig-sec' }, h('h3', {}, title), ...kids);

/** 名前と、押すと何が起きるか（一行）の二段の釦。結果が読める選択肢はこれでそろえる。 */
export function act(
  name: string,
  effect: string,
  on: () => void,
  attrs: Record<string, string | boolean | undefined | ((ev: Event) => void)> = {},
): HTMLButtonElement {
  return h(
    'button',
    { type: 'button', ...attrs, class: `dig-act ${attrs.class ?? ''}`.trim(), onclick: on },
    h('span', { class: 'dig-act__name' }, name),
    effect ? h('span', { class: 'dig-act__fx' }, ...heals(effect)) : null,
  );
}

export const tally = (k: string, v: string) =>
  h('div', { class: 'dig-tally__item' }, h('dt', {}, k), h('dd', {}, v));

/** 金の数を、0 から一段ずつ数え上げる（1-bit の段で、八段）。 */
export function countCoins(root: Element): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-count]')) {
    const n = Number(el.dataset.count);
    const wait = Math.max(0, Number(el.dataset.delay ?? 0) * 1000);
    el.textContent = '金 +0';
    for (let k = 1; k <= 8; k++)
      window.setTimeout(
        () => {
          el.textContent = `金 +${Math.round((n * k) / 8)}`;
        },
        wait + k * 45,
      );
  }
}

/** いま尾を引いている決着の余韻（残りの遭遇の数つき）。 */
export function afterRow(w: World): HTMLElement | null {
  if (!w.after.length) return null;
  return h(
    'span',
    { class: 'dig-afters' },
    w.after.map((a) => {
      const d = afterDef(a.kind);
      return h(
        'span',
        { class: `dig-after is-${a.kind}`, title: d?.text ?? '' },
        `${d?.name ?? a.kind}`,
        h('i', {}, ` あと ${a.left} 戦`),
      );
    }),
  );
}

/**
 * 前の傷。一度削って退いた相手の扉にだけ、残っている傷を一行で（削った体力の半分ぶん、
 * 体力と意志が減ったまま待っている）。初めての扉には出さない。
 */
export function woundLine(w: World, n: MapNode): HTMLElement | null {
  const wound = n.npc ? (w.flags[`wound:${n.npc}`] ?? 0) : 0;
  if (wound <= 0 || !n.npc) return null;
  const left = Math.round(wound / 2);
  return h(
    'p',
    { class: 'dig-wound' },
    h('b', {}, '前の傷'),
    ` ${foeDef(n.npc).name}は、あなたが付けた傷を抱えたまま待っている（体力と意志 −${left}%）`,
  );
}

export function roomInfo(w: World, n: MapNode): HTMLElement {
  const you = youHardness(w);
  const hard = n.npc ? nodeHardness(w, n) : null;
  const def = n.npc ? foeDef(n.npc) : null;
  return h(
    'div',
    { class: 'dig-room' },
    h('p', { class: 'dig-place' }, ...placeOf(w, n)),
    h(
      'p',
      { class: 'dig-room__name' },
      whoOf(n),
      hard !== null ? '　' : '',
      hard !== null ? hardTag(hard, you) : null,
    ),
    n.tower
      ? h(
          'p',
          { class: 'dig-quiet' },
          `${sectionOf(w.stratum).wing.name}の部屋。本棟では会わない顔と、珍しい棚。`,
        )
      : null,
    h('p', { class: 'dig-quiet' }, `${way(w, n).name}で ${way(w, n).hours} 時間`),
    def ? h('p', { class: 'dig-quiet' }, def.desc) : null,
    hard !== null && outmatched(hard, you)
      ? h(
          'p',
          { class: 'dig-warn' },
          `正面からは歯が立たない（あなたは硬度 ${you}）。退いて、出直せる。`,
        )
      : null,
    n.stage?.length
      ? h(
          'p',
          { class: 'dig-amber' },
          `見せ場［${n.stage.map((t) => TAG_NAME[t]).join('・')}］── 合うカードが強く、相手も手強い`,
        )
      : null,
    woundLine(w, n),
    ...n.eps.map((e) => {
      const d = epithetDef(e);
      const facet = n.npc ? d?.foe?.text : d?.place?.text;
      return h(
        'p',
        { class: 'dig-ep' },
        `《${d?.name ?? e}》`,
        facet ? ` ${facet}` : '',
        d ? h('span', { class: 'dig-quiet' }, ` ${d.gloss}`) : null,
      );
    }),
    n.rival
      ? h(
          'p',
          { class: 'dig-quiet' },
          `もう一人が先に寄った（${OUTCOME_NAME[n.rival as keyof typeof OUTCOME_NAME] ?? n.rival}）`,
        )
      : null,
  );
}

/** いまの状況：その階の癖、尾を引いている余韻、あなたの冠。どれも、何が起きるかを一行で。 */
export function statusPanel(w: World): HTMLElement | null {
  if (w.enc || w.ending) return null;
  const row = (name: string, meta: string, text: string, cls = '') =>
    h(
      'li',
      { class: `dig-state${cls ? ` ${cls}` : ''}` },
      h('b', {}, name),
      meta ? h('i', {}, meta) : null,
      h('span', {}, text),
    );
  const quirk = quirkDef(nodeOf(w, w.pos)?.quirk);
  const rows = [
    quirk ? row(quirk.name, 'この階', quirk.text, 'is-quirk') : null,
    // 受け取りのあいだは、結末の欄が余韻を言っているので重ねない。
    ...(w.pending?.kind === 'reward' ? [] : w.after).map((a) => {
      const d = afterDef(a.kind);
      return row(d?.name ?? a.kind, `あと ${a.left} 戦`, d?.text ?? '', `is-${a.kind}`);
    }),
    ...w.you.titles.map((id) =>
      row(`《${epithetDef(id)?.name ?? id}》`, '冠', titleDef(id)?.text ?? ''),
    ),
  ].filter((x): x is NonNullable<typeof x> => !!x);
  return rows.length
    ? h('section', { class: 'dig-sec dig-status' }, h('h3', {}, '状況'), h('ul', {}, rows))
    : null;
}
