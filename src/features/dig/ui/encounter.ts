import { cardName, cardTags } from '../content/cardinfo';
import { POSTURE } from '../content/flavor';
import { fxText } from '../content/fx';
import { lawsAt } from '../content/laws';
import { cardDef, epithetDef, foeDef } from '../content/registry';
import type { Basic } from '../core/events';
import type { World } from '../core/model';
import { TAG_NAME } from '../core/tags';
import { sourceLabel } from '../sim/advise';
import {
  acceptPrice,
  bonusOf,
  canAccept,
  leaveChance,
  resonance,
  shownIntent,
} from '../sim/encounter';
import { foeHardness, youHardness } from '../sim/hardness';
import { heals } from './cards';
import { button, type Child, h, meter } from './dom';
import { live } from './live';
import { afterRow, hardTag, pipRow } from './parts';
import { cardEffect, effectOf } from './preview';
import type { TurnLine } from './state';
import type { Ui } from './ui';
import { BASIC_GLOSS, BASIC_NAME, pickBy, RES_STEPS } from './words';

/**
 * 向き合う欄：一巡（前の手番 → 相手の次の手）、四つの道の棒、素手の手、連鎖と共鳴、
 * 構えた札の中身（スマホ）。画面の持ち物は EncView で読むだけで、書き換えは point で頼む。
 */

export interface EncView {
  hoverSlot: number | null;
  armedSlot: number | null;
  hoverAct: Basic | null;
  lastTurn: readonly TurnLine[];
  inkAt: number;
  litAt: number;
  now(): number;
  /** 触れている素手の手を替えて、脇だけ描き直す。 */
  point(a: Basic | null): void;
}

export function encounterPanel(w: World, ui: Ui, v: EncView): HTMLElement {
  const e = w.enc;
  if (!e) return h('div');
  const f = e.foe;
  const def = foeDef(f.id);
  const hard = foeHardness(f);
  const you = youHardness(w);
  const intent = shownIntent(w);
  const shown = f.clues.filter((c) => c.shown && !c.false).length;
  // 触れている札の効き目（相手の番の前まで）。四つの道の棒の先に、点滅で映す。
  const eff =
    e.phase !== 'act'
      ? null
      : (v.armedSlot ?? v.hoverSlot) !== null && w.you.cards[v.armedSlot ?? v.hoverSlot ?? -1]
        ? cardEffect(w, v.armedSlot ?? v.hoverSlot ?? 0)
        : v.hoverAct
          ? effectOf(w, { c: 'act', a: v.hoverAct })
          : null;
  // 四つの決着の道。どれか一つを尽くせば終わる（これが遭遇の目当て）。
  // 道ごとに、終えたあとに何が尾を引くかを一言（四つの道は同じ勝ちではない）。
  const AFTER_HINT: Record<string, string> = {
    倒す: '戦利品・悪名',
    折る: '名を奪う・畏れ',
    打ち解ける: '味方がつく',
    暴く: '記憶・見透かし',
  };
  const way = (verb: string, el: HTMLElement) =>
    h(
      'div',
      { class: 'dig-way' },
      h('span', { class: 'dig-way__verb' }, verb),
      el,
      h('span', { class: 'dig-way__after' }, AFTER_HINT[verb] ?? ''),
    );
  const ways = [
    way(
      '倒す',
      meter(f.hp, f.maxHp, 'foe-hp', '体力', { shield: f.guard, loss: eff ? -eff.hp : 0 }),
    ),
    way(
      '折る',
      meter(f.resolve, f.maxResolve, 'foe-will', '意志', { loss: eff ? -eff.resolve : 0 }),
    ),
    f.need < 50
      ? way('打ち解ける', meter(f.trust, f.need, 'foe-trust', '信頼', { gain: eff?.trust ?? 0 }))
      : way('打ち解ける', h('span', { class: 'dig-quiet' }, '言葉は通じない')),
    f.clues.length
      ? way('暴く', meter(shown, f.clues.length, 'foe-clue', '手がかり', { gain: eff?.clues ?? 0 }))
      : null,
  ];
  const kids: (Child | readonly Child[])[] = [
    // 刻んだエピテットは、相手の名の前に冠として付く（刻んだ直後は琥珀で押される）。
    h(
      'p',
      { class: 'dig-room__name', title: def.desc },
      f.eps.map((x, i) =>
        h(
          'span',
          {
            class: `dig-crown${i === f.eps.length - 1 && v.now() - v.inkAt < 1.2 ? ' is-in' : ''}`,
            title: epithetDef(x)?.foe?.text,
          },
          `《${epithetDef(x)?.name ?? x}》`,
        ),
      ),
      f.name,
      '　',
      hardTag(hard, you),
    ),
    afterRow(w),
    // 一巡：前の手番（あなた → 相手）と、相手の次の手。
    v.lastTurn.length
      ? h(
          'div',
          { class: 'dig-turn' },
          v.lastTurn.map((l) =>
            h(
              'p',
              { class: `dig-turn__line is-${l.who}` },
              h('b', {}, l.who === 'you' ? 'あなた' : l.who === 'foe' ? '相手' : '決着'),
              ' ',
              l.what,
              l.effects.length
                ? h(
                    'span',
                    { class: 'dig-turn__fx' },
                    ' → ',
                    l.effects.flatMap((x, i) => [i ? '・' : '', ...heals(x)]),
                  )
                : '',
            ),
          ),
        )
      : null,
    // 次の手。身ぶりの一文は、触れたときだけ。
    intent && e.phase === 'act'
      ? h(
          'p',
          {
            class: 'dig-intent',
            title: pickBy(POSTURE[intent.kind] ?? [], `${f.id}:${e.turn}`) ?? '',
          },
          h('span', { class: 'dig-intent__k' }, '次の手'),
          h('b', {}, intent.label),
          intent.power ? h('span', { class: 'dig-intent__n' }, String(intent.power)) : null,
        )
      : null,
    // 四つの道は、戦闘（倒す・折る）と交渉（打ち解ける・暴く）の二つに分かれる。
    h(
      'div',
      { class: 'dig-ways' },
      h('span', { class: 'dig-ways__k' }, '戦闘'),
      ways[0],
      ways[1],
      h('span', { class: 'dig-ways__k' }, '交渉'),
      ways[2],
      ways[3],
    ),
    e.phase === 'act' ? flowRows(w, v) : null,
    // 覚えておかなくていいものは出さない。敵意は荒れているときだけ（信頼が伸びにくく、
    // 手が重くなる）。見せ場のタグは札の印に出るので、ここでは名前だけ。
    h(
      'p',
      { class: 'dig-quiet dig-enc__aside' },
      f.hostility >= 7 ? h('span', { class: 'dig-warn' }, '荒れている') : '',
      e.stage.length
        ? `${f.hostility >= 7 ? '・' : ''}見せ場［${e.stage.map((t) => TAG_NAME[t]).join('・')}］`
        : '',
      // 区画の掟（名前だけ。中身は触れると）。
      lawsAt(w.stratum).map((l) =>
        h('span', { class: 'dig-law', title: l.text }, `掟《${l.name}》`),
      ),
    ),
  ];
  if (e.phase === 'over' && e.outcome) {
    // 結末は一巡の行（決着 倒した）に出ているので、ここは受け取る釦だけ。
    kids.push(button('決着を受け取る', () => ui.send({ c: 'close' }), { class: 'dig-go' }));
  } else {
    // 札を使わない手は、立ち去る（と、取引に応じる）だけ。持ち物は手番を使わず、一手に一つ。
    const lc = leaveChance(w);
    const basics: Basic[] = ['leave'];
    if (canAccept(w)) basics.push('accept');
    kids.push(
      h(
        'div',
        { class: 'dig-bare' },
        // 札を使わない手も、ほかの選ぶ箱と同じ形（名前と、何が起きるか）。
        basics.map((a) =>
          h(
            'button',
            {
              type: 'button',
              class: 'dig-bare__act',
              title: a === 'leave' ? '立ち去る（R）' : '応じる（T）',
              onclick: () => ui.send({ c: 'act', a }),
              onmouseenter: () => {
                if (v.hoverAct === a) return;
                v.point(a);
              },
              onmouseleave: () => {
                if (v.hoverAct !== a) return;
                v.point(null);
              },
            },
            h('b', {}, BASIC_NAME[a]),
            h(
              'span',
              {},
              a === 'leave'
                ? `抜け出せる見込み ${lc}%・決着はつかない`
                : `金 ${acceptPrice(w)} を払って、${BASIC_GLOSS[a]}`,
            ),
          ),
        ),
      ),
    );
  }
  // 人となりの一文は、向き合った最初だけ（二手目からは名前に触れれば読める）。
  if (e.turn <= 1 && !v.lastTurn.length)
    kids.push(h('p', { class: 'dig-quiet dig-enc__desc' }, def.desc));
  return h('div', { class: 'dig-enc' }, ...kids);
}

/**
 * 噛み合いの見える化。連鎖（続け打ち）と共鳴（構成の灯り）を、いつも同じ場所に
 * 四角の列で出す。次に何が起きるかを一言で。
 */
export function flowRows(w: World, v: EncView): HTMLElement {
  const srcs = resonance(w);
  const n = srcs.length;
  const step = RES_STEPS.find(([k]) => k > n);
  const fresh = v.now() - v.litAt < 1.2;
  return h(
    'p',
    { class: 'dig-flow' },
    h(
      'span',
      {
        class: `dig-flow__g${n ? ' is-on' : ''}`,
        title: [
          '共鳴：札・記憶・エピテットが働くたびに一つ灯り、決着で受け取る',
          ...RES_STEPS.map(([k, v]) => `${k}　${v}`),
          n
            ? `灯っている：${srcs
                .map((x) => sourceLabel(x) ?? '')
                .filter(Boolean)
                .join('・')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
      },
      h('b', {}, '共鳴'),
      pipRow(Math.min(n, 6), 6, 'res', fresh),
      step ? h('span', { class: 'dig-flow__x' }, `→ ${step[1]}`) : null,
    ),
  );
}

/**
 * 狭い画面で一度目に押した札の中身（広い画面で札に触れたときの説明と同じもの）。
 * 手札の下に開く。効き目の文・眠りぎわ・足される点の内訳・タグ・ひとこと。
 */
export function armDetail(w: World, v: EncView): HTMLElement | null {
  if (w.enc?.phase !== 'act' || w.enc.who !== 'you') return null;
  const c = v.armedSlot !== null ? w.you.cards[v.armedSlot] : null;
  // 何も構えていないときは出さない（押せば開く。手順の説明は置かない）。
  if (!c) return null;
  const d = cardDef(c.id);
  const spent = c.uses <= 0;
  const b = bonusOf(w, c);
  const tags = cardTags(c);
  return h(
    'div',
    { class: 'dig-armdetail', 'aria-live': 'polite' },
    h(
      'p',
      { class: 'dig-armdetail__head' },
      h('b', {}, cardName(c, spent)),
      tags.length
        ? h(
            'span',
            { class: 'dig-armdetail__tags' },
            tags.map((t) => `［${TAG_NAME[t]}］`).join(''),
          )
        : null,
    ),
    h(
      'p',
      { class: 'dig-armdetail__fx' },
      spent ? `${d.spentName}：${fxText(d.spent)}` : fxText(d.ready),
      live(fxText(spent ? d.spent : d.ready), w),
    ),
    !spent && d.spent.length
      ? h('p', { class: 'dig-armdetail__sub' }, `眠りぎわ　${fxText(d.spent)}`)
      : null,
    b.parts.length
      ? h(
          'p',
          { class: 'dig-armdetail__why' },
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
    d.flavor ? h('p', { class: 'dig-armdetail__flavor' }, d.flavor) : null,
    h('p', { class: 'dig-armdetail__go' }, 'もう一度押すと切る'),
  );
}
