import type { Ev } from '../core/events';
import type { Char, World } from '../core/model';
import type { RuleCtx } from '../core/rules';
import type { Tx } from '../core/tx';
import { breakFoe, cut, expose, hostile, revealClue, stun } from '../sim/ops';
import { tagCount } from './cardinfo';
import type { PassiveSpec, TriggerSpec } from './defs';

/**
 * 見せ場（シグネチャ）。数だけで動いていた札に、その作品のモチーフから
 * 一つだけ「その札にしかない規則」を足す。死に札をなくすためのもの。
 * どれも規則パッチかトリガなので、ほかの札・記憶・場所とも噛み合う。
 */
export interface Signature {
  text: string;
  passive?: readonly PassiveSpec[];
  triggers?: readonly TriggerSpec[];
}

const charOf = (c: { w: World; who: string }): Char =>
  c.who === 'rival' ? c.w.rival.char : c.w.you;
const is = (id: string) => (c: RuleCtx) => c.card === id;
const st = (c: RuleCtx, k: string) => c.enc?.st[k] ?? 0;
/** その札を、遭遇している本人が使った。 */
const used = (id: string) => (ev: Ev, w: World) =>
  ev.type === 'card.use' && ev.card === id && ev.who === w.enc?.who;
const mark = (tx: Tx, key: string, n = 1) => tx.emit({ type: 'enc.st', key, n });
const lowHp = (c: RuleCtx) => {
  const ch = charOf(c);
  return ch.hp * 3 < 16 + 4 * (ch.innate.VIT + ch.growth.VIT);
};

export const SIGNATURES: Readonly<Record<string, Signature>> = {
  agnus: {
    text: '縛られた子羊：0 回で差し出すと ×2、代償なし',
    passive: [
      {
        rule: 'mult',
        when: (c) => is('agnus')(c) && !!c.spent,
        fn: (_c, v) => v * 2,
        text: '差し出す ×2',
      },
      { rule: 'selfCost', when: (c) => is('agnus')(c) && !!c.spent, fn: () => 0, text: '代償なし' },
    ],
  },
  hunters: {
    text: '帰り道：倒して終えると、［場所］のカードの回数 +1',
    triggers: [
      {
        on: 'enc.end',
        when: (ev) => ev.type === 'enc.end' && ev.outcome === 'beaten',
        run: (tx) => {
          const e = tx.w.enc;
          if (!e) return;
          const ch = e.who === 'rival' ? tx.w.rival.char : tx.w.you;
          ch.cards.forEach((card, slot) => {
            if (card && card.uses < card.max && card.id !== 'hunters')
              tx.emit({ type: 'card.uses', who: e.who, slot, n: 1 });
          });
        },
        text: '倒すと［場所］+1',
      },
    ],
  },
  wave: {
    text: '大波：続けて使うと、波が重なる（×1.6）',
    passive: [
      {
        rule: 'mult',
        when: (c) => is('wave')(c) && c.enc?.lastCard === 'wave',
        fn: (_c, v) => v * 1.6,
        text: '重なる波 ×1.6',
      },
    ],
  },
  night: {
    text: '夜の部屋：0 時を過ぎると、回数を減らさない',
    passive: [
      {
        rule: 'useSpend',
        when: (c) => is('night')(c) && c.w.hour >= 2,
        fn: () => 0,
        text: '深夜は減らない',
      },
    ],
  },
  prisons: {
    text: '終わらない階段：［場所］［制度］の相手を、守りごと閉じ込める（守り −2）',
    triggers: [
      {
        on: 'card.use',
        when: (ev, w) =>
          used('prisons')(ev, w) &&
          !!w.enc?.foe.tags.some((t) => t === 'place' || t === 'institution'),
        run: (tx) => expose(tx, 2),
        text: '閉じ込める',
      },
    ],
  },
  chirico: {
    text: '長い影：遭遇の初めの予告は、嘘でも見える',
    passive: [
      {
        rule: 'intentVisible',
        when: (c) => (c.enc?.turn ?? 9) <= 1,
        fn: () => 1,
        text: '初手が見える',
      },
    ],
  },
  karljohan: {
    text: '群衆の眼：［公開情報］を持つほど強い（1 つにつき ×1.15）',
    passive: [
      {
        rule: 'mult',
        when: is('karljohan'),
        fn: (c, v) => v * (1 + 0.15 * (tagCount(charOf(c)).public ?? 0)),
        text: '群衆の眼',
      },
    ],
  },
  vertigo: {
    text: 'めまい：使った次のカードが ×1.5',
    passive: [
      {
        rule: 'mult',
        when: (c) => !is('vertigo')(c) && st(c, 'vertigo') > 0,
        fn: (_c, v) => v * 1.5,
        text: 'めまいのあと ×1.5',
      },
    ],
    triggers: [
      { on: 'card.use', when: used('vertigo'), run: (tx) => mark(tx, 'vertigo'), text: 'めまい' },
      {
        on: 'card.use',
        when: (ev, w) =>
          ev.type === 'card.use' && ev.card !== 'vertigo' && (w.enc?.st.vertigo ?? 0) > 0,
        run: (tx) => mark(tx, 'vertigo', -(tx.w.enc?.st.vertigo ?? 0)),
        text: 'めまいが醒める',
      },
    ],
  },
  glove: {
    text: '拾った手袋：誤った手がかりが見えていると、本物を 1 つ拾い直す',
    triggers: [
      {
        on: 'card.use',
        when: (ev, w) => used('glove')(ev, w) && !!w.enc?.foe.clues.some((c) => c.shown && c.false),
        run: (tx) => void revealClue(tx),
        text: '拾い直す',
      },
    ],
  },
  interior: {
    text: '背中：心の構えが手番をまたいで残る',
    passive: [{ rule: 'calmKeep', fn: () => 1, text: '構えが残る' }],
  },
  khnopff: {
    text: '自分に鍵をかける：心の構えが 5 以上なら、相手の嘘の予告が見える',
    passive: [
      {
        rule: 'intentVisible',
        when: (c) => (c.enc?.calm ?? 0) >= 5,
        fn: () => 1,
        text: '閉じた扉から見える',
      },
    ],
  },
  correction: {
    text: '訂正：相手が嘘をついている手番は ×2',
    passive: [
      {
        rule: 'mult',
        when: (c) => is('correction')(c) && !!c.enc?.foe.intent?.lie,
        fn: (_c, v) => v * 2,
        text: '訂正 ×2',
      },
    ],
  },
  boris: {
    text: '強いられた自白：嘘がばれても、相手の意志 −6',
    triggers: [
      {
        on: 'caught',
        when: (_ev, w) => w.enc?.lastCard === 'boris',
        run: (tx) => void breakFoe(tx, 6),
        text: '自白',
      },
    ],
  },
  falling: {
    text: '落ちる人：体力が 1/3 を切っていると ×2',
    passive: [
      {
        rule: 'mult',
        when: (c) => is('falling')(c) && lowHp(c),
        fn: (_c, v) => v * 2,
        text: '落ちながら ×2',
      },
    ],
  },
  cosmos: {
    text: '妄想の連鎖：誤った手がかりを見るたび、相手の意志 −3（相手が気味悪がる）',
    triggers: [
      {
        on: 'clue',
        when: (ev) => ev.type === 'clue' && ev.shown && !!ev.false,
        run: (tx) => void breakFoe(tx, 3),
        text: '気味悪がる',
      },
    ],
  },
  w: {
    text: 'W の島：［記憶］を 4 つ以上持っていれば、使うたび［記憶］のカード +1',
    triggers: [
      {
        on: 'card.use',
        when: (ev, w) =>
          used('w')(ev, w) &&
          (tagCount(w.enc?.who === 'rival' ? w.rival.char : w.you).memory ?? 0) >= 4,
        run: (tx) => {
          const e = tx.w.enc;
          if (!e) return;
          const ch = e.who === 'rival' ? tx.w.rival.char : tx.w.you;
          ch.cards.forEach((card, slot) => {
            if (card && card.id !== 'w' && card.uses < card.max)
              tx.emit({ type: 'card.uses', who: e.who, slot, n: 1 });
          });
        },
        text: '記憶が記憶を呼ぶ',
      },
    ],
  },
  merulana: {
    text: '混乱：敵意 6 以上の相手からは、手がかりをもう 1 つ',
    triggers: [
      {
        on: 'card.use',
        when: (ev, w) => used('merulana')(ev, w) && (w.enc?.foe.hostility ?? 0) >= 6,
        run: (tx) => void revealClue(tx),
        text: '混乱から拾う',
      },
    ],
  },
  molloy: {
    text: '続けられない、続ける：0 回でも代償なしで ×1.3',
    passive: [
      {
        rule: 'mult',
        when: (c) => is('molloy')(c) && !!c.spent,
        fn: (_c, v) => v * 1.3,
        text: '続ける ×1.3',
      },
      {
        rule: 'selfCost',
        when: (c) => is('molloy')(c) && !!c.spent,
        fn: () => 0,
        text: '代償なし',
      },
    ],
  },
  crocodiles: {
    text: '肉桂色の店：持っているあいだ、古物商の値段 ×0.8',
    passive: [{ rule: 'price', fn: (_c, v) => Math.round(v * 0.8), text: '値段 ×0.8' }],
  },
  policeman: {
    text: '自転車とアトム：判定 +25%。［制度］の相手には必ず通る',
    passive: [
      {
        rule: 'checkChance',
        when: is('policeman'),
        fn: (c, v) => (c.enc?.foe.tags.includes('institution') ? 100 : v + 25),
        text: '判定 +25%',
      },
    ],
  },
  labyrinth: {
    text: '迷宮：持っているあいだ、立ち去る +25%',
    passive: [{ rule: 'leaveChance', fn: (_c, v) => (v > 0 ? v + 25 : v), text: '立ち去る +25%' }],
  },
  paramo: {
    text: '死者のささやき：〈亡霊〉の相手に ×1.8',
    passive: [
      {
        rule: 'mult',
        when: (c) =>
          is('paramo')(c) && !!c.enc && ['ghost', 'hound', 'volume'].includes(c.enc.foe.id),
        fn: (_c, v) => v * 1.8,
        text: '死者に ×1.8',
      },
    ],
  },
  ice: {
    text: '氷の壁：使った遭遇では、守りが手番をまたいで残る',
    passive: [
      { rule: 'guardKeep', when: (c) => st(c, 'ice') > 0, fn: () => 1, text: '凍った守り' },
    ],
    triggers: [{ on: 'card.use', when: used('ice'), run: (tx) => mark(tx, 'ice'), text: '凍る' }],
  },
  threebody: {
    text: '暗い森：使った遭遇では、予告がすべて見え、すべてのカード ×1.3',
    passive: [
      { rule: 'intentVisible', when: (c) => st(c, 'dark') > 0, fn: () => 1, text: '位置が知れた' },
      { rule: 'mult', when: (c) => st(c, 'dark') > 0, fn: (_c, v) => v * 1.3, text: '暗い森 ×1.3' },
    ],
    triggers: [
      { on: 'card.use', when: used('threebody'), run: (tx) => mark(tx, 'dark'), text: '暗い森' },
    ],
  },
  leaves: {
    text: '内側のほうが広い：場所のエピテットと見せ場が多いほど強い（1 つにつき ×1.25）',
    passive: [
      {
        rule: 'mult',
        when: is('leaves'),
        fn: (c, v) => {
          const node = c.w.map.find((n) => n.id === c.w.pos);
          return v * (1 + 0.25 * ((node?.eps.length ?? 0) + (c.enc?.stage.length ?? 0)));
        },
        text: '奇妙な場所ほど',
      },
    ],
  },
  pulp: {
    text: '時系列の入れ替え：使った次のカードは、回数を減らさない',
    passive: [
      {
        rule: 'useSpend',
        when: (c) => !is('pulp')(c) && st(c, 'pulp') > 0,
        fn: () => 0,
        text: '順番が狂う',
      },
    ],
    triggers: [
      { on: 'card.use', when: used('pulp'), run: (tx) => mark(tx, 'pulp'), text: '入れ替え' },
      {
        on: 'card.use',
        when: (ev, w) => ev.type === 'card.use' && ev.card !== 'pulp' && (w.enc?.st.pulp ?? 0) > 0,
        run: (tx) => mark(tx, 'pulp', -(tx.w.enc?.st.pulp ?? 0)),
        text: '元に戻る',
      },
    ],
  },
  jaws: {
    text: 'もっと大きな船が要る：危険な相手と〈怪物〉に ×1.6',
    passive: [
      {
        rule: 'mult',
        when: (c) =>
          is('jaws')(c) &&
          (c.enc?.tier === 'danger' ||
            ['insect', 'silverfish', 'hound'].includes(c.enc?.foe.id ?? '')),
        fn: (_c, v) => v * 1.6,
        text: '大物 ×1.6',
      },
    ],
  },
  robocop: {
    text: '第四指令：［制度］の相手には ×0.6、それ以外には ×1.3。体力 1/3 を切ると、人間に戻る（×2）',
    passive: [
      {
        rule: 'mult',
        when: is('robocop'),
        fn: (c, v) => v * (lowHp(c) ? 2 : c.enc?.foe.tags.includes('institution') ? 0.6 : 1.3),
        text: '指令',
      },
    ],
  },
  thing: {
    text: '誰が本物か：相手が嘘をついていれば、見抜いて止める',
    triggers: [
      {
        on: 'card.use',
        when: (ev, w) => used('thing')(ev, w) && !!w.enc?.foe.intent?.lie,
        run: (tx) => stun(tx),
        text: '見抜く',
      },
    ],
  },
  fightclub: {
    text: '自分を殴る：失った体力 4 ごとに、削る量 +1',
    passive: [
      {
        rule: 'hit',
        when: is('fightclub'),
        fn: (c, v) => {
          const ch = charOf(c);
          const max = 16 + 4 * (ch.innate.VIT + ch.growth.VIT);
          return v + Math.max(0, Math.floor((max - ch.hp) / 4));
        },
        text: '傷が拳になる',
      },
    ],
  },
  children: {
    text: '銃声が止む：敵意 7 以上の相手の次の一撃を −6、敵意 −2',
    triggers: [
      {
        on: 'card.use',
        when: (ev, w) => used('children')(ev, w) && (w.enc?.foe.hostility ?? 0) >= 7,
        run: (tx) => {
          cut(tx, 6);
          hostile(tx, -2);
        },
        text: '銃声が止む',
      },
    ],
  },
  akira: {
    text: '暴走：同じ遭遇で使うたび、削る量 +3（止まらない）',
    passive: [
      { rule: 'hit', when: is('akira'), fn: (c, v) => v + 3 * st(c, 'akira'), text: '暴走' },
    ],
    triggers: [
      { on: 'card.use', when: used('akira'), run: (tx) => mark(tx, 'akira'), text: '膨らむ' },
    ],
  },
  democracy: {
    text: '多数：この遭遇で 3 種以上のカードが共鳴していれば ×2',
    passive: [
      {
        rule: 'mult',
        when: (c) =>
          is('democracy')(c) &&
          Object.keys(c.enc?.st ?? {}).filter((k) => k.startsWith('r:card:')).length >= 3,
        fn: (_c, v) => v * 2,
        text: '合意 ×2',
      },
    ],
  },
  origins: {
    text: '凡庸な悪：敵意 3 以下の（落ち着いた）相手に ×1.8',
    passive: [
      {
        rule: 'mult',
        when: (c) => is('origins')(c) && (c.enc?.foe.hostility ?? 9) <= 3,
        fn: (_c, v) => v * 1.8,
        text: '凡庸 ×1.8',
      },
    ],
  },
  cybernetics: {
    text: '帰還：この遭遇で体力を削られるたび、次の使用 +30%',
    passive: [
      {
        rule: 'mult',
        when: is('cybernetics'),
        fn: (c, v) => v * (1 + 0.3 * st(c, 'feedback')),
        text: '帰還',
      },
    ],
    triggers: [
      {
        on: 'vital',
        when: (ev, w) =>
          ev.type === 'vital' &&
          ev.who === w.enc?.who &&
          (ev.hp ?? 0) < 0 &&
          w.enc?.phase === 'act',
        run: (tx) => mark(tx, 'feedback'),
        text: '帰還を溜める',
      },
    ],
  },
  space: {
    text: '家の夢：持っているあいだ、食堂の回復 ×1.3',
    passive: [{ rule: 'restHeal', fn: (_c, v) => v * 1.3, text: '回復 ×1.3' }],
  },
  delirious: {
    text: '過密の文化：金を 60 以上持っていれば、すべてのカード ×1.15',
    passive: [
      {
        rule: 'mult',
        when: (c) => charOf(c).coins >= 60,
        fn: (_c, v) => v * 1.15,
        text: '過密 ×1.15',
      },
    ],
  },
};
