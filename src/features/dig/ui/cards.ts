import { LV_MARK, LV_MULT } from '../content/balance';
import { EP_TIER_NAME, epTier } from '../content/epithets';
import type { Fx } from '../content/fx';
import { fxText } from '../content/fx';
import { gearOf } from '../content/gear';
import { cardDef, epithetDef } from '../content/registry';
import type { Card, World } from '../core/model';
import { ARCH_NAME, TAG_NAME, type Tag } from '../core/tags';
import { getLang } from '../i18n';
import { bonusOf, chainNext } from '../sim/encounter';
import { BADGE_NAME, badgesOf } from './badges';
import { type Child, h } from './dom';
import { cardEffect } from './preview';

/** 札の顔：効き目の印・エピテットの名札・拾い物の印・いま使ったら動く数・拾える札と品の箱。 */

/** 回数の目盛り（残り＝塗り、使った分＝枠だけ）。文字ではなく四角で、字体に左右されない。 */
export const pips = (c: Card) =>
  h(
    'span',
    { class: 'dig-card__uses', 'aria-label': `${Math.max(0, c.uses)}/${c.max}` },
    Array.from({ length: Math.max(c.max, c.uses) }, (_, i) =>
      h('i', { class: i < c.uses ? 'is-on' : '' }),
    ),
  );

/** 文の中の「体力 +n」「精神 +n」（戻る分）を緑に。 */
/** 札のレベルの印（Ⅱ・Ⅲ。Ⅰは出さない）。名前のすぐ後ろに置く。 */
export function lvTag(card: Pick<Card, 'lv'>): HTMLElement | null {
  const lv = card.lv ?? 1;
  return lv > 1
    ? h(
        'span',
        { class: 'dig-lv', title: `レベル${LV_MARK[lv]}：効き目 ×${LV_MULT[lv]}` },
        LV_MARK[lv] ?? '',
      )
    : null;
}

export function heals(text: string): Child[] {
  const parts = text.split(/((?:体力|精神) \+[0-9A-Za-z+.×]+)/);
  // 英語では句読点のあとに語の間が要る（訳した文は末尾の間を落とすので、ここで足す）。
  const gap = getLang() === 'en';
  return parts.flatMap((p, i): Child[] =>
    i % 2
      ? [h('span', { class: 'dig-heal' }, p)]
      : gap && p && i < parts.length - 1 && /[、。]$/.test(p)
        ? [p, ' ']
        : [p],
  );
}

/** 札の目当ての印（読まずに分かる）。癒すは緑。 */
/**
 * 札の目当ての印（読まずに分かる）。癒すは緑。遭遇の最中は、覚えておかなくて
 * いいように、いま効く条件も印にする：直前の札とタグが重なれば「連鎖」、
 * 見せ場のタグに合えば「見せ場」（どちらも強くなる）。
 */
export function badges(
  list: readonly Fx[],
  tags: readonly Tag[] | null = null,
  w?: World,
): HTMLElement | null {
  const bs = badgesOf(list);
  const e = w?.enc;
  const n = tags && w ? chainNext(w, tags) : 0;
  const chain = n > 0;
  const stage = !!tags && !!e && e.stage.some((t) => tags.includes(t));
  if (!bs.length && !chain && !stage) return null;
  return h(
    'span',
    { class: 'dig-badges' },
    chain ? h('i', { class: 'dig-badge dig-badge--boost dig-badge--chain' }, '連鎖') : null,
    stage ? h('i', { class: 'dig-badge dig-badge--boost' }, '見せ場') : null,
    bs.map((b) => h('i', { class: `dig-badge dig-badge--${b}` }, BADGE_NAME[b])),
  );
}

/** エピテットの名札（格の色で）。 */
export function epChip(e: string): HTMLElement {
  const d = epithetDef(e);
  const t = d ? epTier(d) : 'plain';
  return h(
    'span',
    { class: `dig-ep is-${t}`, title: `${EP_TIER_NAME[t]}　${d?.gloss ?? ''}` },
    `《${d?.name ?? e}》`,
  );
}

/** 拾い物の印（運がよかったぶん。失うものはない、という合図）。 */
export const luckyTag = () =>
  h(
    'i',
    { class: 'dig-lucky', title: '拾い物：運がよかったぶん。選んでも、何も失わない' },
    '拾い物',
  );

/**
 * いまこの札を使ったら、何がいくつ動くか（世界の写しで実際に使ってみた数）。
 * その下に、効き目一つ一つに足される点の内訳（連鎖・見せ場・弱いタグ…）。
 */
export function outcome(w: World, slot: number, c: Card): HTMLElement {
  const x = cardEffect(w, slot);
  const b = bonusOf(w, c);
  const chip = (text: string, cls = '') => h('i', { class: `dig-out${cls}` }, text);
  const sign = (n: number) => (n > 0 ? `+${n}` : `−${-n}`);
  const list: HTMLElement[] = [];
  // この一手で決着がつくなら、それがいちばん先（倒せる・折れる・打ち解ける・暴ける）。
  const END: Record<string, string> = {
    beaten: '倒せる',
    broken: '折れる',
    trusted: '打ち解ける',
    uncovered: '暴ける',
  };
  if (x.ends && END[x.ends]) list.push(chip(END[x.ends] ?? '', ' is-end'));
  if (x.hp) list.push(chip(`相手の体力 ${sign(x.hp)}`));
  if (x.resolve) list.push(chip(`相手の意志 ${sign(x.resolve)}`));
  if (x.trust) list.push(chip(`相手の信頼 ${sign(x.trust)}`, ' is-blue'));
  if (x.clues) list.push(chip(`手がかり +${x.clues}`, ' is-blue'));
  if (x.guard) list.push(chip(`あなたの守り +${x.guard}`, ' is-you'));
  if (x.calm) list.push(chip(`あなたの構え +${x.calm}`, ' is-you'));
  if (x.youHp)
    list.push(chip(`あなたの体力 ${sign(x.youHp)}`, x.youHp > 0 ? ' is-heal' : ' is-cost'));
  if (x.youMind)
    list.push(chip(`あなたの精神 ${sign(x.youMind)}`, x.youMind > 0 ? ' is-heal' : ' is-cost'));
  // 棒には出ない効き目（止める・攻めと守り・敵意）も、札片で言う。
  if (x.stun) list.push(chip('相手の手番が止まる'));
  if (x.atk) list.push(chip(`相手の攻め ${sign(x.atk)}`));
  if (x.def) list.push(chip(`相手の守り ${sign(x.def)}`));
  if (x.hostility) list.push(chip(`相手の敵意 ${sign(x.hostility)}`, ' is-cost'));
  return h(
    'span',
    { class: 'dig-card__out' },
    h('span', { class: 'dig-outs' }, list.length ? list : chip('棒は動かない', ' is-none')),
    // 点が足されるのは体力・意志・信頼を動かす札だけ（守るだけの札には出さない）。
    b.parts.length && (x.hp || x.resolve || x.trust)
      ? h(
          'span',
          { class: 'dig-why' },
          b.parts.map((p) =>
            h(
              'i',
              {
                class: `dig-why__p${p.text.startsWith('連鎖') ? ' is-chain' : ''}${p.n < 0 ? ' is-minus' : ''}`,
              },
              p.text,
            ),
          ),
        )
      : null,
  );
}

/** 拾う札・買う札。押すか、枠へ落とす。決める前に、構成がどう変わるかを一行で。 */
export function cardOffer(
  id: string,
  on: () => void,
  source: 'pick' | 'buy' | null = null,
  picked = false,
  price?: string,
  /** 拾い物（運がよかったぶんの、余分な一枚）。 */
  lucky = false,
  /** エピテットが刻まれたまま出てきた札。 */
  inked?: readonly string[],
): HTMLElement {
  const d = cardDef(id);
  return h(
    'button',
    {
      type: 'button',
      class: `dig-offer${picked ? ' is-chosen' : ''}${lucky ? ' is-lucky' : ''}${inked?.length ? ' is-inked' : ''}`,
      'aria-pressed': picked ? 'true' : undefined,
      disabled: !source && !picked,
      onclick: on,
    },
    h(
      'span',
      { class: 'dig-offer__head' },
      lucky ? luckyTag() : null,
      inked?.map((e) => epChip(e)),
      h('b', {}, d.name),
      price ? h('span', { class: 'dig-price' }, price) : null,
    ),
    h(
      'span',
      { class: 'dig-quiet' },
      ` ${d.uses} 回 ［${d.tags.map((t) => TAG_NAME[t]).join('・')}］${(d.arch ?? []).map((a) => `〈${ARCH_NAME[a]}〉`).join('')}`,
    ),
    badges(d.ready),
    h('span', { class: 'dig-offer__fx' }, heals(fxText(d.ready))),
    d.sig ? h('span', { class: 'dig-offer__sig' }, d.sig) : null,
    inked?.length
      ? h(
          'span',
          { class: 'dig-offer__next' },
          inked
            .map((e) => `《${epithetDef(e)?.name ?? e}》${epithetDef(e)?.card?.text ?? ''}`)
            .join(' '),
        )
      : null,
  );
}

/** 拾える道具・品（その場で使う。回数つき）。 */
export function gearOffer(
  id: string,
  can: boolean,
  on: () => void,
  price?: string,
  why = '持ち物がいっぱい',
): HTMLElement {
  const g = gearOf(id);
  return h(
    'button',
    { type: 'button', class: 'dig-offer is-gear', disabled: !can, onclick: on },
    h(
      'span',
      { class: 'dig-offer__head' },
      h('b', {}, g?.name ?? id),
      h(
        'span',
        { class: 'dig-quiet' },
        g?.kind === 'keep' ? ' 身につける' : ` ${g?.tool ? '道具' : '品'}・${g?.uses ?? 1} 回`,
      ),
      price ? h('span', { class: 'dig-price' }, price) : null,
    ),
    h('span', { class: 'dig-offer__fx' }, heals(g?.text ?? '')),
    h(
      'span',
      { class: 'dig-quiet' },
      !can
        ? why
        : g?.kind === 'keep'
          ? '持っているあいだ、ずっと効く'
          : '手札の一覧で使う（向き合っていないときに）',
    ),
  );
}

/** 人物を決める画面の、初めの手札（押せない。遊ぶときと同じ顔）。 */
export function previewCard(id: string, slot: number): HTMLElement {
  const d = cardDef(id);
  const c: Card = { uid: 0, id, uses: d.uses, max: d.uses, marks: {}, eps: [] };
  return h(
    'div',
    { class: 'dig-card', title: [d.sig, d.flavor].filter(Boolean).join('\n') },
    h(
      'span',
      { class: 'dig-card__head' },
      h('b', { class: 'dig-card__name' }, d.name),
      h('span', { class: 'dig-card__key' }, String(slot + 1)),
    ),
    pips(c),
    badges(d.ready),
    h('span', { class: 'dig-card__fx' }, heals(fxText(d.ready))),
    d.spent.length ? h('span', { class: 'dig-card__sleep' }, `眠りぎわ　${fxText(d.spent)}`) : null,
  );
}
