import type { Ev } from '../core/events';
import type { Outcome, World } from '../core/model';
import type { RuleCtx } from '../core/rules';
import { isDeep } from '../core/time';
import type { Tx } from '../core/tx';
import { charOf, coins, maxHp, maxMind, stats } from '../sim/ops';
import { cardLv } from './cardinfo';
import type { ItemDef, PassiveSpec } from './defs';
import { ITEM_CAP } from './gear';

/**
 * 身につける品。使っても減らない持ち物（持ち物の上限には数える）。持っているあいだ、
 * ずっと効く。三つの手触りに分かれる。
 *
 *   素直に強い   一撃の上限・判定の振り直し・溢れた回復の貯え…持つだけで効く
 *   組み合わせ   使い切る・手放す・深夜・重ねる・刻む・長引かせる…を狙うほど効く
 *   極端         大きく得て、何かを差し出す
 *
 * ほかの仕組みと手触りが重ならないようにしてある。能力値をただ足すのは記憶、
 * 決着に応じた倍率は肩書きと余韻、回復と回数の補充は品、遭遇の初めの守りは
 * 記憶（夜警の借り）と味方の仕事。身につける品は、そのどれでもない口を使う。
 * 数はこの遊びの尺度に合わせてある（最大体力は 30〜50 ほど、札の回数は 2〜6）。
 */

const mine = (w: World) => (w.enc?.who ?? 'you') === 'you';
const flag = (w: World, k: string) => w.flags[`keep:${k}`] ?? 0;
const setFlag = (tx: Tx, k: string, v: number) => tx.emit({ type: 'flag', key: `keep:${k}`, v });
/** 決着の種類の番号（四度目の正直が数える）。 */
const SETTLED: Partial<Record<Outcome, number>> = {
  beaten: 1,
  broken: 2,
  trusted: 3,
  uncovered: 4,
};
const ended = (ev: Ev) => (ev.type === 'enc.end' ? ev.outcome : null);
/** 札を手放した（受け取りの入れ替え・古物商の入れ替え・休むで捨てる）。 */
const dropped = (ev: Ev) =>
  ev.type === 'deck.drop' ||
  (ev.type === 'card.set' && !ev.card && (ev.why === 'dropped' || ev.why === 'discard'));
/** いま手にしている札（枠）のうち、その id の札。 */
const slotCard = (w: World, id?: string) =>
  id ? charOf(w, w.enc?.who ?? 'you').cards.find((c) => c?.id === id) : undefined;

/** 部屋を移った（向き合っていないとき）。 */
const walked = (ev: Ev, w: World) => ev.type === 'moved' && ev.node !== null && !w.enc;
/** 札の効き目の倍率。あなたの札にだけ。 */
const mult = (
  text: string,
  when: (c: RuleCtx) => boolean,
  k: number | ((c: RuleCtx) => number),
): PassiveSpec => ({
  rule: 'mult',
  when: (c) => c.who === 'you' && !!c.card && when(c),
  fn: (c, v) => v * (typeof k === 'number' ? k : k(c)),
  text,
});

export const KEEPSAKES: readonly ItemDef[] = [
  // ─── 素直に強い ───────────────────────────────────────────
  {
    id: 'big-heart',
    kind: 'keep',
    name: '大きな心臓',
    text: '受ける一撃は、どれだけ重くても最大体力の 1/4 までにとどまる。',
    passive: [
      {
        rule: 'strikeTaken',
        prio: 50,
        when: (c) => c.who === 'you',
        fn: (c, v) => Math.min(v, Math.ceil(maxHp(stats(c.w, 'you')) / 4)),
        text: '大きな心臓：一撃は最大体力の 1/4 まで',
      },
    ],
    price: 70,
    flavor: '人より一回り大きいと、医者に言われた。止まる気配がない。',
  },
  {
    id: 'spare-glasses',
    kind: 'keep',
    name: '予備の眼鏡',
    text: '判定は二度振って、よいほうを取る。',
    passive: [
      {
        rule: 'checkChance',
        prio: 50,
        when: (c) => c.who === 'you',
        fn: (_c, v) => {
          const p = Math.max(0, Math.min(100, v)) / 100;
          return 100 * (1 - (1 - p) * (1 - p));
        },
        text: '予備の眼鏡：二度振る',
      },
    ],
    price: 70,
    flavor: '度が少し合わない。だから、もう一度見る。',
  },
  {
    id: 'canteen',
    kind: 'keep',
    name: '不滅の水筒',
    text: '溢れた回復を汲み置き（体力 10 まで）、体力が減ったときにそこから戻す。',
    // 溢れた分は、回復の手続き（ops.ts の heal）が汲み置く。
    triggers: [
      {
        on: 'vital',
        when: (ev, w) =>
          ev.type === 'vital' && ev.who === 'you' && (ev.hp ?? 0) < 0 && flag(w, 'flask') > 0,
        run: (tx, ev) => {
          if (ev.type !== 'vital') return;
          const room = maxHp(stats(tx.w, 'you')) - tx.w.you.hp;
          const n = Math.min(flag(tx.w, 'flask'), -(ev.hp ?? 0), room);
          if (n <= 0 || tx.w.you.hp <= 0) return;
          setFlag(tx, 'flask', flag(tx.w, 'flask') - n);
          tx.emit({ type: 'vital', who: 'you', hp: n });
        },
        text: '不滅の水筒：汲み置きから体力が戻る',
      },
    ],
    price: 55,
    flavor: 'いつ汲んだのか、思い出せない。まだ冷たい。',
  },
  {
    id: 'old-charm',
    kind: 'keep',
    name: '古いお守り',
    text: '精神が半分を切ると、受ける脅し −3。',
    passive: [
      {
        rule: 'threatTaken',
        when: (c) => c.who === 'you' && c.w.you.mind * 2 < maxMind(stats(c.w, 'you')),
        fn: (_c, v) => Math.max(0, v - 3),
        text: '古いお守り：脅し −3',
      },
    ],
    price: 55,
    flavor: '中の紙は、読まないことにしている。',
  },
  {
    id: 'spare-mag',
    kind: 'keep',
    name: '予備弾倉',
    text: '遭遇で最初に回数の尽きた札は、その場で回数が 1 戻る。',
    triggers: [
      {
        on: 'card.uses',
        when: (ev, w) =>
          ev.type === 'card.uses' &&
          ev.who === 'you' &&
          ev.n < 0 &&
          w.you.cards[ev.slot]?.uses === 0 &&
          !!w.enc &&
          mine(w) &&
          !w.enc.st.mag,
        run: (tx, ev) => {
          if (ev.type !== 'card.uses') return;
          tx.emit({ type: 'enc.st', key: 'mag', n: 1 });
          tx.emit({ type: 'card.uses', who: 'you', slot: ev.slot, n: 1 });
        },
        text: '予備弾倉：回数 +1',
      },
    ],
    price: 60,
    flavor: '型は合わない。けれど、ポケットに入れておくと落ち着く。',
  },
  {
    id: 'thick-coat',
    kind: 'keep',
    name: '厚手の外套',
    text: '遭遇で最初に受ける一撃を半分にする。',
    passive: [
      {
        rule: 'strikeTaken',
        when: (c) => !!c.enc && c.who === 'you' && !c.enc.st.coat,
        fn: (_c, v) => (v > 0 ? Math.ceil(v / 2) : v),
        text: '厚手の外套：最初の一撃を半分',
      },
    ],
    // 使い済みの印は、相手の一撃を受けたときだけ付く（自分の札の代償では減らない）。ops.ts の hurt が付ける。
    price: 60,
    flavor: '肩に、誰かの古い雨の匂い。',
  },
  {
    id: 'worn-map',
    kind: 'keep',
    name: '擦り切れた地図',
    text: '着くのに 2 時間以上かかる部屋は、1 時間早く着く。',
    passive: [
      {
        rule: 'timeCost',
        when: (c) => c.who === 'you' && (c.kind === 'move' || c.kind === 'walk'),
        fn: (_c, v) => (v >= 2 ? v - 1 : v),
        text: '擦り切れた地図：1 時間早く着く',
      },
    ],
    price: 50,
    flavor: '折り目のところだけ、道が消えている。そこは覚えている。',
  },
  {
    id: 'coin-purse',
    kind: 'keep',
    name: 'がま口',
    text: '手に入る金 ×1.4。',
    passive: [
      {
        rule: 'coins',
        when: (c) => c.who === 'you',
        fn: (_c, v) => v * 1.4,
        text: 'がま口 ×1.4',
      },
    ],
    price: 45,
    flavor: '口金がゆるい。入るものは、だいたい入る。',
  },
  {
    id: 'thick-match',
    kind: 'keep',
    name: '極太マッチ',
    text: '遭遇で最初に使う札 ×1.8。',
    passive: [mult('極太マッチ ×1.8', (c) => (c.enc?.cards ?? 1) === 0, 1.8)],
    price: 55,
    flavor: '一本で、煙草が三本吸える。擦る音で、だいたいの人がこちらを向く。',
  },
  {
    id: 'happy-burger',
    kind: 'keep',
    name: 'ご機嫌なバーガー',
    text: '体力が満ちているあいだ、札 ×1.25。',
    passive: [mult('ご機嫌なバーガー ×1.25', (c) => c.w.you.hp >= maxHp(stats(c.w, 'you')), 1.25)],
    price: 50,
    flavor: '包み紙の顔が笑っている。食べ終わっても、まだ笑っている。',
  },
  {
    id: 'blue-lemonade',
    kind: 'keep',
    name: '青いレモネード',
    text: '札の代償（自分に返る傷）が半分になる。',
    passive: [
      {
        rule: 'selfCost',
        when: (c) => c.who === 'you',
        fn: (_c, v) => Math.floor(v / 2),
        text: '青いレモネード：代償が半分',
      },
    ],
    price: 50,
    flavor: '何味かと聞かれると、青い味だと答えるしかない。',
  },
  // ─── 組み合わせを狙う ─────────────────────────────────────
  {
    id: 'last-round',
    kind: 'keep',
    name: '最後の一発',
    text: '回数が残り 1 の札を使うと ×1.5。',
    passive: [mult('最後の一発 ×1.5', (c) => !c.spent && slotCard(c.w, c.card)?.uses === 1, 1.5)],
    price: 55,
    flavor: '数えていなくても、最後の一つは分かる。',
  },
  {
    id: 'casings',
    kind: 'keep',
    name: '空薬莢の箱',
    text: '札の回数を使い切るたび、精神 +3。',
    triggers: [
      {
        on: 'card.uses',
        when: (ev, w) =>
          ev.type === 'card.uses' &&
          ev.who === 'you' &&
          ev.n < 0 &&
          w.you.cards[ev.slot]?.uses === 0,
        run: (tx) => {
          const room = maxMind(stats(tx.w, 'you')) - tx.w.you.mind;
          if (room > 0) tx.emit({ type: 'vital', who: 'you', mind: Math.min(3, room) });
        },
        text: '空薬莢の箱：精神 +3',
      },
    ],
    price: 50,
    flavor: '振ると、乾いた音がする。中身は増え続けている。',
  },
  {
    id: 'torn-ticket',
    kind: 'keep',
    name: '破れた整理券',
    text: '札を手放すたび、次に使う札 +20%（重ねられる）。',
    passive: [
      mult(
        '破れた整理券',
        (c) => flag(c.w, 'ticket') > 0,
        (c) => 1 + 0.2 * flag(c.w, 'ticket'),
      ),
    ],
    triggers: [
      {
        on: 'deck.drop',
        when: (_ev, w) => !w.enc || mine(w),
        run: (tx) => setFlag(tx, 'ticket', flag(tx.w, 'ticket') + 1),
        text: '破れた整理券 +20%',
      },
      {
        on: 'card.set',
        when: (ev, w) => dropped(ev) && (!w.enc || mine(w)),
        run: (tx) => setFlag(tx, 'ticket', flag(tx.w, 'ticket') + 1),
        text: '破れた整理券 +20%',
      },
      {
        on: 'card.use',
        when: (ev, w) => ev.type === 'card.use' && ev.who === 'you' && flag(w, 'ticket') > 0,
        run: (tx) => setFlag(tx, 'ticket', 0),
        text: '破れた整理券を使った',
      },
    ],
    price: 45,
    flavor: '番号の半分だけが残っている。呼ばれるのは、いつも次の人。',
  },
  {
    id: 'alarm-3am',
    kind: 'keep',
    name: '午前三時の目覚まし',
    text: '深夜（0〜5 時）は札 ×1.4。それ以外の時間は ×0.9。',
    passive: [
      mult(
        '午前三時の目覚まし',
        () => true,
        (c) => (isDeep(c.w.hour) ? 1.4 : 0.9),
      ),
    ],
    price: 55,
    flavor: '一度も、三時に鳴ったことがない。',
  },
  {
    id: 'worn-boots',
    kind: 'keep',
    name: '使い古した安全靴',
    text: '立ち去って逃げ延びるたび、体格 +1（最大体力 +4。5 回まで）。',
    triggers: [
      {
        on: 'enc.end',
        when: (ev, w) => ended(ev) === 'left' && mine(w) && flag(w, 'boots') < 5,
        run: (tx) => setFlag(tx, 'boots', flag(tx.w, 'boots') + 1),
        text: '使い古した安全靴：体格 +1',
      },
    ],
    price: 45,
    flavor: '底がすり減って、足の形を覚えている。',
  },
  {
    id: 'warranty',
    kind: 'keep',
    name: '返品保証書',
    text: '札を手放すとき、その札に回数が残っていれば、枠でいちばん減っている札の回数 +1。',
    // 手放す札の回数は、手放す前でないと読めないので、手放す手続き（run.ts の refund）が読む。
    price: 45,
    flavor: '「保証は、商品ではなく、あなたに付きます」と小さく印刷されている。',
  },
  {
    id: 'extra-kindness',
    kind: 'keep',
    name: '余計な親切',
    text: '打ち解けて終えると、次の相手の手がかりが初めから一つ見えている（噂が先回りする）。',
    triggers: [
      {
        on: 'enc.end',
        when: (ev, w) => ended(ev) === 'trusted' && mine(w),
        run: (tx) => setFlag(tx, 'kind', 1),
        text: '余計な親切',
      },
      {
        on: 'enc.start',
        when: (_ev, w) => mine(w) && flag(w, 'kind') > 0,
        run: (tx) => {
          setFlag(tx, 'kind', 0);
          const x = tx.w.enc?.foe.clues.find((c) => !c.shown && !c.false);
          if (x) tx.emit({ type: 'clue', id: x.id, shown: true });
        },
        text: '余計な親切：手がかりが一つ見える',
      },
    ],
    price: 50,
    flavor: '頼まれていないことまで、つい手伝ってしまう。',
  },
  {
    id: 'bad-name',
    kind: 'keep',
    name: '悪い評判',
    text: '相手の敵意 1 につき、札 +4%。',
    passive: [
      mult(
        '悪い評判',
        (c) => (c.enc?.foe.hostility ?? 0) > 0,
        (c) => 1 + 0.04 * (c.enc?.foe.hostility ?? 0),
      ),
    ],
    price: 45,
    flavor: '名前を言う前に、相手の顔がこわばる。それで話が早い。',
  },
  {
    id: 'overprepared',
    kind: 'keep',
    name: '過剰な準備',
    text: '向き合っていないときにエピテットを付け替えた札は、次に使う一回だけ ×2。',
    passive: [
      mult(
        '過剰な準備 ×2',
        (c) => {
          const card = slotCard(c.w, c.card);
          return !!card && flag(c.w, `prep${card.uid}`) > 0;
        },
        2,
      ),
    ],
    triggers: [
      {
        on: 'card.ep',
        when: (ev, w) => ev.type === 'card.ep' && ev.who === 'you' && !w.enc,
        run: (tx, ev) => {
          const card = ev.type === 'card.ep' ? tx.w.you.cards[ev.slot] : null;
          if (card) setFlag(tx, `prep${card.uid}`, 1);
        },
        text: '過剰な準備',
      },
      {
        on: 'deck.ep',
        when: (ev, w) => ev.type === 'deck.ep' && ev.who === 'you' && !w.enc,
        run: (tx, ev) => {
          const card = ev.type === 'deck.ep' ? tx.w.you.back[ev.index] : null;
          if (card) setFlag(tx, `prep${card.uid}`, 1);
        },
        text: '過剰な準備',
      },
      {
        on: 'card.use',
        when: (ev, w) => {
          if (ev.type !== 'card.use' || ev.who !== 'you') return false;
          const card = w.you.cards[ev.slot];
          return !!card && flag(w, `prep${card.uid}`) > 0;
        },
        run: (tx, ev) => {
          const card = ev.type === 'card.use' ? tx.w.you.cards[ev.slot] : null;
          if (card) setFlag(tx, `prep${card.uid}`, 0);
        },
        text: '過剰な準備を使った',
      },
    ],
    price: 45,
    flavor: '鞄の中に、使わない地図が三枚。',
  },
  {
    id: 'receipts',
    kind: 'keep',
    name: '領収書の束',
    text: '古物商で何も買わずに立ち去ると、次の古物商で一品だけ半額。',
    // 立ち去ったかどうかは、古物商を閉じる手続き（run.ts の depart）が書く。
    passive: [
      {
        rule: 'price',
        when: (c) =>
          c.who === 'you' &&
          c.w.pending?.kind === 'shop' &&
          c.w.pending.sold.length === 0 &&
          flag(c.w, 'receipt') > 0,
        fn: (_c, v) => Math.ceil(v / 2),
        text: '領収書の束：半額',
      },
    ],
    price: 40,
    flavor: '日付はどれも、今夜になっている。',
  },
  {
    id: 'fountain-pen',
    kind: 'keep',
    name: '使い込んだ万年筆',
    text: 'Ⅲまで重ねた札は、遭遇ごとに最初の一回、回数を使わない。',
    passive: [
      {
        rule: 'useSpend',
        when: (c) =>
          c.who === 'you' &&
          !!c.card &&
          !!c.enc &&
          !c.enc.st[`pen:${c.card}`] &&
          cardLv(c.w.you, c.card) >= 3,
        fn: () => 0,
        text: '使い込んだ万年筆：回数を使わない',
      },
    ],
    triggers: [
      {
        on: 'card.use',
        when: (ev, w) =>
          ev.type === 'card.use' &&
          ev.who === 'you' &&
          !!w.enc &&
          !w.enc.st[`pen:${ev.card}`] &&
          cardLv(w.you, ev.card) >= 3,
        run: (tx, ev) => {
          if (ev.type === 'card.use') tx.emit({ type: 'enc.st', key: `pen:${ev.card}`, n: 1 });
        },
        text: '使い込んだ万年筆',
      },
    ],
    price: 55,
    flavor: 'ペン先が、持ち主の筆圧に曲がっている。',
  },
  {
    id: 'new-gloves',
    kind: 'keep',
    name: '新品の手袋',
    text: 'まだ重ねていない札（Ⅰ）は ×1.25。',
    passive: [mult('新品の手袋 ×1.25', (c) => cardLv(c.w.you, c.card ?? '') === 1, 1.25)],
    price: 50,
    flavor: '値札が付いたまま。汚す相手を、まだ決めていない。',
  },
  {
    id: 'ink-ribbon',
    kind: 'keep',
    name: '替えのインクリボン',
    text: 'エピテットが二つ以上刻まれた札は ×1.25。',
    passive: [
      mult('替えのインクリボン ×1.25', (c) => (slotCard(c.w, c.card)?.eps?.length ?? 0) >= 2, 1.25),
    ],
    price: 50,
    flavor: '打てば打つほど、字が濃くなる。',
  },
  {
    id: 'jukebox-coin',
    kind: 'keep',
    name: 'ジュークボックスの硬貨',
    text: '連鎖で足される点 ×2。',
    passive: [
      {
        rule: 'chain',
        when: (c) => c.who === 'you',
        fn: (_c, v) => v * 2,
        text: 'ジュークボックスの硬貨：連鎖 ×2',
      },
    ],
    price: 50,
    flavor: '同じ曲を、続けてかける。店の誰も止めない。',
  },
  {
    id: 'pawn-ticket',
    kind: 'keep',
    name: '質札',
    text: '持ち物の空き一つにつき、札 +5%。',
    passive: [
      mult(
        '質札',
        (c) => c.w.you.items.length < ITEM_CAP,
        (c) => 1 + 0.05 * (ITEM_CAP - c.w.you.items.length),
      ),
    ],
    price: 45,
    flavor: '流したものの名前は、もう読めない。身軽ではある。',
  },
  {
    id: 'stopped-watch',
    kind: 'keep',
    name: '止まった腕時計',
    text: '遭遇が長引くほど効く。5 手番目からは札 ×1.3。',
    passive: [mult('止まった腕時計 ×1.3', (c) => (c.enc?.turn ?? 0) >= 4, 1.3)],
    price: 50,
    flavor: '針は、あの夜の時刻で止まっている。急ぐ理由がない。',
  },
  {
    id: 'wiretap',
    kind: 'keep',
    name: '盗聴器',
    text: '相手の秘密が漏れる率 +15%。',
    passive: [
      {
        rule: 'slip',
        when: (c) => c.who === 'you',
        fn: (_c, v) => v + 15,
        text: '盗聴器 +15%',
      },
    ],
    price: 50,
    flavor: '電池が切れているのに、ときどき何か聞こえる。',
  },
  {
    id: 'mushroom-steak',
    kind: 'keep',
    name: 'きのこマット（ステーキ味）',
    text: '相手の体力を削る量 ×1.35。意志を削る量と信頼の伸びは ×0.8。',
    passive: [
      {
        rule: 'hit',
        when: (c) => c.who === 'you',
        fn: (_c, v) => v * 1.35,
        text: 'きのこマット（ステーキ味）×1.35',
      },
      {
        rule: 'break',
        when: (c) => c.who === 'you',
        fn: (_c, v) => v * 0.8,
        text: 'きのこマット（ステーキ味）×0.8',
      },
      {
        rule: 'trust',
        when: (c) => c.who === 'you',
        fn: (_c, v) => v * 0.8,
        text: 'きのこマット（ステーキ味）×0.8',
      },
    ],
    price: 50,
    flavor: '菌床を育てるための培地。肉の匂いがする。誰が、何のために。',
  },
  {
    id: 'mushroom-vanilla',
    kind: 'keep',
    name: 'きのこマット（バニラ味）',
    text: '信頼の伸び ×1.35。相手の体力を削る量は ×0.8。',
    passive: [
      {
        rule: 'trust',
        when: (c) => c.who === 'you',
        fn: (_c, v) => v * 1.35,
        text: 'きのこマット（バニラ味）×1.35',
      },
      {
        rule: 'hit',
        when: (c) => c.who === 'you',
        fn: (_c, v) => v * 0.8,
        text: 'きのこマット（バニラ味）×0.8',
      },
    ],
    price: 50,
    flavor: '同じ培地の、甘い匂いのほう。こちらのほうが、人が寄ってくる。',
  },
  {
    id: 'slick-globe',
    kind: 'keep',
    name: 'つるつるの地球儀',
    text: '夜明けを過ぎても、相手が荒れにくい（夜明けの荒れが半分）。',
    passive: [
      {
        rule: 'lateness',
        when: (c) => c.who === 'you',
        fn: (_c, v) => v / 2,
        text: 'つるつるの地球儀：時差',
      },
    ],
    price: 50,
    flavor: '国境が擦り切れて、どこが朝なのか分からない。指で回すと、少し時間が戻る気がする。',
  },
  {
    id: 'heavy-bow',
    kind: 'keep',
    name: '工業的剛弓',
    text: '相手が守りを固めているとき、札 ×1.4。',
    passive: [mult('工業的剛弓 ×1.4', (c) => (c.enc?.foe.guard ?? 0) > 0, 1.4)],
    price: 55,
    flavor: '引くのに、ウインチが要る。誰が、塔の中で、こんなものを。',
  },
  {
    id: 'arrow',
    kind: 'keep',
    name: '矢印！',
    text: '出来事の判定 +15%。',
    passive: [
      {
        rule: 'storyChance',
        when: (c) => c.who === 'you',
        fn: (_c, v) => v + 15,
        text: '矢印！ +15%',
      },
    ],
    price: 45,
    flavor: '工事現場から外してきた。どこに置いても、正しいほうを指している。',
  },
  {
    id: 'chatty-machete',
    kind: 'keep',
    name: 'よく喋るマチェーテ',
    text: '相手の体力を削るたび、意志も 1 削る（刃が話しかける）。',
    triggers: [
      {
        on: 'foe',
        when: (ev, w) =>
          ev.type === 'foe' &&
          ev.field === 'hp' &&
          ev.n < 0 &&
          ev.by === 'you' &&
          !!w.enc &&
          mine(w) &&
          w.enc.foe.resolve > 0,
        run: (tx) => tx.emit({ type: 'foe', field: 'resolve', n: -1, by: 'you' }),
        text: 'よく喋るマチェーテ：意志 −1',
      },
    ],
    price: 50,
    flavor: '切るたびに、何か言う。たいてい、相手の悪口。',
  },
  // ─── 極端 ───────────────────────────────────────────────
  {
    id: 'lifelong-shoes',
    kind: 'keep',
    name: '一生ものの靴',
    text: '休まないあいだ、部屋を 4 つ移るごとに体格 +1（最大体力 +4）。休む（一服・休憩所）と、この靴で増えた分は消える。',
    triggers: [
      {
        on: 'moved',
        when: walked,
        run: (tx) => setFlag(tx, 'shoes', flag(tx.w, 'shoes') + 1),
        text: '一生ものの靴',
      },
      {
        on: 'flag',
        when: (ev, w) =>
          ev.type === 'flag' &&
          (ev.key.startsWith('rested') || ev.key.startsWith('breath:')) &&
          flag(w, 'shoes') > 0,
        run: (tx) => {
          setFlag(tx, 'shoes', 0);
          const over = tx.w.you.hp - maxHp(stats(tx.w, 'you'));
          if (over > 0) tx.emit({ type: 'vital', who: 'you', hp: -over });
        },
        text: '一生ものの靴：休んだので元に戻る',
      },
    ],
    price: 60,
    flavor: '一度脱いだら、もう同じ足には戻らない。',
  },
  {
    id: 'worst-insurance',
    kind: 'keep',
    name: '最悪の保険',
    text: '体力が尽きたとき、一度だけ体力が満ちて立ち上がる。そのかわり精神が 1 になり、この保険は消える。',
    // 倒れる一撃の扱いは、決着を決める所（ops.ts の settle）が読む。
    price: 65,
    flavor: '約款の最後の一行は、虫眼鏡でも読めない。',
  },
  {
    id: 'fourth-time',
    kind: 'keep',
    name: '四度目の正直',
    text: '同じ決着を三度続けると、四度目の遭遇ではその決着に要る量が半分になる。',
    triggers: [
      {
        on: 'enc.end',
        when: (ev, w) => mine(w) && !!SETTLED[ended(ev) ?? 'left'],
        run: (tx, ev) => {
          const code = SETTLED[ended(ev) ?? 'left'] ?? 0;
          const streak = flag(tx.w, 'last') === code ? flag(tx.w, 'streak') + 1 : 1;
          setFlag(tx, 'last', code);
          setFlag(tx, 'streak', streak);
        },
        text: '四度目の正直',
      },
      {
        on: 'enc.start',
        when: (_ev, w) => mine(w) && flag(w, 'streak') >= 3,
        run: (tx) => {
          const f = tx.w.enc?.foe;
          if (!f) return;
          const code = flag(tx.w, 'last');
          if (code === 1) tx.emit({ type: 'foe', field: 'hp', n: -Math.floor(f.hp / 2) });
          if (code === 2) tx.emit({ type: 'foe', field: 'resolve', n: -Math.floor(f.resolve / 2) });
          if (code === 3) tx.emit({ type: 'foe', field: 'need', n: -Math.floor(f.need / 2) });
          if (code === 4) {
            const hidden = f.clues.filter((x) => !x.shown && !x.false);
            for (const x of hidden.slice(0, Math.ceil(hidden.length / 2)))
              tx.emit({ type: 'clue', id: x.id, shown: true });
          }
          setFlag(tx, 'streak', 0);
        },
        text: '四度目の正直：要る量が半分',
      },
    ],
    price: 55,
    flavor: '三度目までは、練習だったことにする。',
  },
  {
    id: 'one-way',
    kind: 'keep',
    name: '片道切符',
    text: '札 ×1.3。そのかわり、立ち去れる見込みはいつも 5%。',
    passive: [
      mult('片道切符 ×1.3', () => true, 1.3),
      {
        rule: 'leaveChance',
        prio: 90,
        when: (c) => c.who === 'you',
        fn: () => 0,
        text: '片道切符：立ち去る 5%',
      },
    ],
    price: 60,
    flavor: '帰りの欄は、最初から刷られていない。',
  },
  {
    id: 'iou',
    kind: 'keep',
    name: '借用書',
    text: '手にしたとき金 +150。区画を下りるたびに金 40 を払う（足りない分は体力で払う）。',
    triggers: [
      {
        on: 'item',
        when: (ev) => ev.type === 'item' && ev.who === 'you' && ev.id === 'iou' && ev.n > 0,
        run: (tx) => tx.emit({ type: 'coins', who: 'you', n: 150 }),
        text: '借用書：金 +150',
      },
      {
        on: 'map.built',
        when: (_ev, w) => !w.enc,
        run: (tx) => {
          const pay = Math.min(40, tx.w.you.coins);
          if (pay) coins(tx, -pay, 'you');
          const owe = Math.ceil((40 - pay) / 4);
          if (owe > 0) tx.emit({ type: 'vital', who: 'you', hp: -Math.min(owe, tx.w.you.hp - 1) });
        },
        text: '借用書：金 40 を払う',
      },
    ],
    price: 10,
    flavor: '貸した側の名前のところが、破り取られている。',
  },
  {
    id: 'kipper',
    kind: 'keep',
    name: '燻製ニシン',
    text: 'あなたの噂は伝わらない（偽の足跡を残す）。そのかわり、匂いで相手は初めから敵意 +1。',
    passive: [
      {
        rule: 'gossip',
        when: (c) => c.who === 'you',
        fn: () => 0,
        text: '燻製ニシン：噂が伝わらない',
      },
      {
        rule: 'startHostility',
        when: (c) => c.who === 'you',
        fn: (_c, v) => v + 1,
        text: '燻製ニシン：匂う',
      },
    ],
    price: 40,
    flavor: '追っ手の鼻を逸らすのに使う。あなたの鼻も、もう利かない。',
  },
];
