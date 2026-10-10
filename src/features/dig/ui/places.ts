import { PACE } from '../content/balance';
import { EP_TIER_NAME, epTier } from '../content/epithets';
import { fxText } from '../content/fx';
import { gearOf } from '../content/gear';
import { cardDef, epithetDef, permDef, storyDef } from '../content/registry';
import {
  DINER_AFTER,
  DINER_BET,
  DINER_FULL,
  DINER_LEAVE,
  DINER_LIGHT,
  DINER_MORNING,
  DINER_NIGHT,
  SHOP_BARGAIN,
  SHOP_HELLO,
  SHOP_LEAVE,
  SHOP_SOLD,
} from '../content/voices';
import type { Card, World } from '../core/model';
import { phaseOf } from '../core/time';
import { itemRoom } from '../sim/ops';
import {
  alterOptions,
  canChoose,
  cardPrice,
  curePrice,
  deckRoom,
  epPrice,
  permValue,
  priceOf,
  storyChance,
} from '../sim/run';
import { cardOffer, epChip, gearOffer, heals, luckyTag } from './cards';
import { button, type Child, h } from './dom';
import { live, liveNote } from './live';
import { act, section } from './parts';
import type { Ui } from './ui';
import { voiceOf } from './words';

/** 場所の欄：食堂・古物商（入れ替えで買う）・出来事と結果。持ち物の列と、札のエピテットの欄。 */

/** 古物商で、手持ちがいっぱいのときに入れ替えで買おうとしている札。 */
let shopSwap: string | null = null;

/** 食堂：休み方は二つだけ（どちらか一つ）。変質と、ときどき店主の賭け。 */
export function restPanel(w: World, ui: Ui): HTMLElement {
  const p = w.pending;
  if (p?.kind !== 'rest') return h('div');
  const choice = (name: string, lines: string[], on: () => void, cls = '', dish = '') =>
    h(
      'button',
      { type: 'button', class: `dig-scene__choice ${cls}`.trim(), onclick: on },
      h('b', {}, name),
      lines.map((l) => h('span', {}, ...heals(l))),
      dish ? h('span', { class: 'dig-dish' }, dish) : null,
    );
  // 主人の一言：食べる前は挨拶（夜か朝か）、食べたあとは見送りの前の一言。
  const morning = phaseOf(w.hour) === 'morning' || phaseOf(w.hour) === 'day';
  const host = p.used
    ? voiceOf(DINER_AFTER, w, 'after')
    : voiceOf(morning ? DINER_MORNING : DINER_NIGHT, w, 'hello');
  const alters = p.altered
    ? []
    : w.you.cards.flatMap((c, slot) =>
        c
          ? alterOptions(w.you, slot).map((o) =>
              h(
                'button',
                {
                  type: 'button',
                  class: 'dig-alter__b',
                  disabled: !o.ready,
                  title: fxText(cardDef(o.to).ready),
                  onclick: () => ui.send({ c: 'alter', slot, to: o.to }),
                },
                h('b', {}, `『${cardDef(o.to).name}』`),
                h('span', {}, `『${cardDef(c.id).name}』から・${o.need}`),
              ),
            )
          : [],
      );
  return h(
    'div',
    { class: 'dig-reward' },
    h(
      'div',
      { class: 'dig-scene__head' },
      h('span', { class: 'dig-scene__label' }, '食堂'),
      h('b', { class: 'dig-scene__word' }, p.used ? '休んだ' : 'どう休む'),
    ),
    host ? h('p', { class: 'dig-host' }, `「${host}」`) : null,
    p.used
      ? null
      : h(
          'div',
          { class: 'dig-scene__choices' },
          choice(
            '休む',
            [
              `体力 +${Math.round(PACE.rest * 100)}%・精神 +${Math.round(PACE.rest * 100)}%`,
              'いちばん減っている札が一枚満ちる',
              '1 時間',
            ],
            () => ui.send({ c: 'rest', action: 'rest' }),
            '',
            voiceOf(DINER_LIGHT, w, 'light'),
          ),
          choice(
            'ひと晩ここで',
            [
              '体力 +80%・精神 +80%',
              '減っている札が二枚満ちる',
              `3 時間・次の出来事を逃す${w.after.length ? '・決着の余韻が消える' : ''}`,
            ],
            () => ui.send({ c: 'rest', action: 'full' }),
            w.after.length ? 'is-costly' : '',
            voiceOf(DINER_FULL, w, 'full'),
          ),
        ),
    alters.length
      ? h(
          'div',
          { class: 'dig-alter' },
          h('h4', { class: 'dig-plan__h' }, '変質'),
          h('div', { class: 'dig-alter__list' }, alters),
        )
      : null,
    p.bet
      ? h(
          'div',
          { class: 'dig-scene__row' },
          h('span', { class: 'dig-host dig-host--aside' }, voiceOf(DINER_BET, w, 'bet')),
          button('店主と賭ける', () => ui.send({ c: 'rest', action: 'bet' }), {
            class: 'dig-scene__pick is-lucky',
            title: '負けのない賭け。表なら金 +10、裏ならコーヒーを一杯（精神 +5）',
          }),
        )
      : null,
    h(
      'div',
      { class: 'dig-scene__foot' },
      button(
        '出る',
        () => {
          const bye = voiceOf(DINER_LEAVE, w, 'leave');
          if (ui.send({ c: 'depart' }) && bye) ui.caption(bye);
        },
        { class: p.used ? 'dig-go' : '' },
      ),
    ),
  );
}

export function shopPanel(w: World, ui: Ui): HTMLElement {
  const p = w.pending;
  if (p?.kind !== 'shop') {
    shopSwap = null;
    return h('div');
  }
  const kids: (Child | readonly Child[])[] = [];
  for (const id of p.cards) {
    const sold = p.sold.includes(id);
    // 拾い物：半値の掘り出し物（元の値段を添えて）。
    const full = cardPrice(w, id);
    const cost = p.bargain === id ? Math.ceil(full / 2) : full;
    const room = deckRoom(w.you) || w.you.cards.some((c) => !c);
    const price = p.bargain === id ? `金 ${cost}（${full}）` : `金 ${cost}`;
    kids.push(
      cardOffer(
        id,
        () => {
          if (sold || w.you.coins < cost) return;
          // 手持ちがいっぱいなら、手放す一枚を選んでから買う（選ぶまでは何も減らない）。
          if (room) ui.send({ c: 'buy', id });
          else {
            shopSwap = shopSwap === id ? null : id;
            ui.render();
          }
        },
        sold || w.you.coins < cost ? null : 'buy',
        shopSwap === id && !sold,
        sold ? '売約' : room ? price : `${price}・一枚と入れ替え`,
        p.bargain === id && !sold,
      ),
    );
    if (shopSwap === id && !sold && !room) kids.push(swapPicker(w, id, ui));
  }
  for (const id of p.items) {
    const sold = p.sold.includes(id);
    const ep = id.startsWith('ep:') ? epithetDef(id.slice(3)) : undefined;
    if (ep) {
      const price = epPrice(w, id.slice(3));
      kids.push(
        act(
          `エピテット《${ep.name}》（${EP_TIER_NAME[epTier(ep)]}）　金 ${price}${sold ? '（売約）' : ''}`,
          `札に刻むと：${ep.card?.text ?? ep.gloss}`,
          () => ui.send({ c: 'buy', id }),
          { disabled: sold || w.you.coins < price, class: `is-ep is-${epTier(ep)}` },
        ),
      );
      continue;
    }
    const price = priceOf(w, gearOf(id)?.price ?? 99);
    kids.push(
      gearOffer(
        id,
        !sold && w.you.coins >= price && itemRoom(w.you, id),
        () => ui.send({ c: 'buy', id }),
        sold ? '売約' : `金 ${price}`,
        sold ? '売約' : !itemRoom(w.you, id) ? '持ち物がいっぱい' : '金が足りない',
      ),
    );
  }
  for (const perm of w.you.perms) {
    const d = permDef(perm);
    if (!d) continue;
    if (d.bad)
      kids.push(
        button(`《${d.name}》を手放す（金 ${curePrice(w)}）`, () => ui.send({ c: 'cure', perm })),
      );
    else if (perm !== 'promise' && permValue(w.you, perm) > 0)
      kids.push(
        button(`記憶《${d.name}》を売る（金 ${permValue(w.you, perm)}）`, () =>
          ui.send({ c: 'sell', perm }),
        ),
      );
  }
  kids.push(
    button(
      '出る',
      () => {
        const bye = voiceOf(SHOP_LEAVE, w, 'leave');
        if (ui.send({ c: 'depart' }) && bye) ui.caption(bye);
      },
      { class: 'dig-go' },
    ),
  );
  // 古物商の一言：買ったあと／掘り出し物があるとき／ふだん。
  const talk = p.sold.length
    ? voiceOf(SHOP_SOLD, w, `sold${p.sold.length}`)
    : p.bargain && !p.sold.includes(p.bargain)
      ? voiceOf(SHOP_BARGAIN, w, 'bargain')
      : voiceOf(SHOP_HELLO, w, 'hello');
  return section('古物商', talk ? h('p', { class: 'dig-host' }, `「${talk}」`) : null, ...kids);
}

/** 古物商の入れ替え：手放す一枚を押すと、入れ替えて買う。 */
export function swapPicker(w: World, id: string, ui: Ui): HTMLElement {
  const all = [...w.you.cards.filter((c): c is Card => !!c), ...w.you.back];
  return h(
    'div',
    { class: 'dig-swap' },
    h(
      'p',
      { class: 'dig-swap__ask' },
      `手放す一枚を押すと、『${cardDef(id).name}』と入れ替えて買う`,
    ),
    h(
      'div',
      { class: 'dig-swap__list' },
      all.map((c) =>
        button(
          `『${cardDef(c.id).name}』 ${c.uses}/${c.max}${c.eps.length ? `　${c.eps.map((e) => `《${epithetDef(e)?.name ?? e}》`).join('')}` : ''}`,
          () => {
            shopSwap = null;
            ui.send({ c: 'buy', id, drop: c.uid });
          },
          { class: 'dig-swap__b' },
        ),
      ),
    ),
    button('やめる', () => {
      shopSwap = null;
      ui.render();
    }),
  );
}

export function storyPanel(w: World, ui: Ui): HTMLElement {
  const p = w.pending;
  if (p?.kind !== 'story') return h('div');
  const def = storyDef(p.id);
  if (!def) return h('div');
  return section(
    def.title,
    h('p', {}, def.text),
    p.eps.length
      ? h(
          'p',
          { class: 'dig-ep' },
          p.eps
            .map((e) => `《${epithetDef(e)?.name ?? e}》${epithetDef(e)?.story?.text ?? ''}`)
            .join(' '),
        )
      : null,
    // 手元のエピテットのうち、出来事に効くものは、この出来事に刻める（二つまで）。
    p.eps.length < 2
      ? h(
          'p',
          { class: 'dig-row dig-ink' },
          [...new Set(w.you.epithets)]
            .filter((ep) => !!epithetDef(ep)?.story && !p.eps.includes(ep))
            .map((ep) =>
              button(
                `＋《${epithetDef(ep)?.name ?? ep}》 ${epithetDef(ep)?.story?.text ?? ''}`,
                () => ui.send({ c: 'inscribe', ep, story: true }),
                {
                  class: 'dig-pill dig-pill--ep is-ink-target',
                  title: '刻むと、この出来事の判定と実りが変わる',
                },
              ),
            ),
        )
      : null,
    def.options.map((o, i) =>
      button(
        `${o.label}${o.stat ? `（${o.stat} ${storyChance(w, o.stat, o.diff ?? 0)}%）` : ''}`,
        () => ui.send({ c: 'choose', option: i }),
        { disabled: !canChoose(w, i) },
      ),
    ),
    // 拾い物：妙な選択肢が一つ増えている（選べば必ず何か得る。失うものはない）。
    p.odd
      ? h(
          'button',
          {
            type: 'button',
            class: 'dig-odd is-lucky',
            onclick: () => ui.send({ c: 'choose', option: def.options.length }),
          },
          luckyTag(),
          '黙って、灯りを落として待つ',
        )
      : null,
  );
}

export function toldPanel(w: World, ui: Ui): HTMLElement {
  const p = w.pending;
  if (p?.kind !== 'told') return h('div');
  return section(
    storyDef(p.id)?.title ?? '',
    h('p', {}, p.text),
    // 何が出て、何を払ったか（選んだあとに確かめられる）。
    p.got ? h('p', { class: 'dig-got' }, p.got) : null,
    p.chance !== undefined ? h('p', { class: 'dig-quiet' }, `判定 ${p.roll} / ${p.chance}%`) : null,
    button('先へ', () => ui.send({ c: 'ack' }), { class: 'dig-go' }),
  );
}

/** 整えるの中の持ち物（休む・備える・探る・身につけるの列）。 */
/**
 * pick を渡すと「置いていく一つを選ぶ」形になる（受け取りで、持ち物がいっぱいのとき）。
 * 場所はいつもの持ち物の列のまま、押すと置いていく印が付く（使いはしない）。
 */
export function gearRows(
  w: World,
  ui: Ui,
  pick?: { chosen: string | null; on: (id: string) => void; fresh?: boolean },
): HTMLElement | null {
  if (!w.you.items.length) return null;
  const gear = (kind: 'rest' | 'prep' | 'seek' | 'keep') =>
    w.you.items.flatMap((it, i) => {
      const g = gearOf(it.id);
      if (!g || g.kind !== kind) return [];
      if (pick) {
        const chosen = pick.chosen === it.id;
        // 選んだ品は取り消し線。押した直後の一度だけ、箱が沈んで線が引かれる（自分で置いた手応え）。
        return [
          h(
            'button',
            {
              type: 'button',
              class: `dig-gear__item${g.tool ? ' is-tool' : ''}${chosen ? ' is-drop' : ''}${chosen && pick.fresh ? ' is-placing' : ''}`,
              'aria-pressed': chosen ? 'true' : 'false',
              'aria-label': chosen ? `${g.name}（置いていく）` : undefined,
              title: [g.text, g.flavor].filter(Boolean).join('\n'),
              onclick: () => pick.on(it.id),
            },
            `${g.name}${it.uses > 1 ? ` ×${it.uses}` : ''}`,
          ),
        ];
      }
      // 身につける品は押して使うものではないので、名前だけ（入れ替えは決着のあとの受け取りで）。
      if (kind === 'keep')
        return [
          h(
            'span',
            {
              class: 'dig-gear__item is-keep',
              title: [g.text, liveNote(g.text, w), g.flavor].filter(Boolean).join('\n'),
            },
            g.name,
          ),
        ];
      return [
        button(
          `${g.name}${it.uses > 1 ? ` ×${it.uses}` : ''}`,
          () => ui.send({ c: 'item', index: i }),
          {
            class: `dig-gear__item${g.tool ? ' is-tool' : ''}`,
            disabled: kind === 'seek' && !!w.pending,
            title: `${g.text}\n${g.flavor}`,
          },
        ),
      ];
    });
  const row = (label: string, gloss: string, kids: HTMLElement[]) =>
    kids.length
      ? h(
          'div',
          { class: 'dig-place' },
          h('span', { class: 'dig-place__label', title: gloss }, label),
          h('span', { class: 'dig-place__items' }, kids),
        )
      : null;
  return h(
    'div',
    { class: 'dig-places is-gear' },
    row('休む', '体と心、札一枚の回数を戻す', gear('rest')),
    row('備える', '次に出会う相手との遭遇の初めに効く', gear('prep')),
    row('探る', 'この階を探る（1 時間）。出来事か、拾い物か、誰かに気づかれるか', gear('seek')),
    row('身につける', '使わない。持っているあいだ、ずっと効く（持ち物の枠は使う）', gear('keep')),
  );
}

/**
 * 札に刻まれたエピテットの欄（札の中、本文の下）：語・効き目・剥がす釦。剥がすと手元に戻る。
 * 整えると受け取りの手札で、同じ形。札そのものを押す操作とは混ぜない。
 */
export function cardEps(c: Card, ui: Ui, w?: World): HTMLElement | null {
  if (!c.eps.length) return null;
  return h(
    'span',
    { class: 'dig-deck__eps' },
    c.eps.map((e) =>
      h(
        'span',
        { class: 'dig-deck__ep' },
        epChip(e),
        h(
          'span',
          { class: 'dig-quiet' },
          epithetDef(e)?.card?.text ?? '',
          live(epithetDef(e)?.card?.text ?? '', w),
        ),
        h(
          'button',
          {
            type: 'button',
            onclick: (ev: Event) => {
              ev.stopPropagation();
              ui.send({ c: 'peel', uid: c.uid, ep: e });
            },
          },
          '剥がす',
        ),
      ),
    ),
  );
}

/** 遭遇中に触れている札（相手の四つの道に、効き目を先に映す）。 */
