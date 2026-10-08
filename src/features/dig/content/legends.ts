import type { Ev, EvType } from '../core/events';
import type { Char, Who, World } from '../core/model';
import type { RuleCtx } from '../core/rules';
import { ARCH_NAME } from '../core/tags';
import { isDeep, isMorning } from '../core/time';
import type { Tx } from '../core/tx';
import {
  breakFoe,
  calm,
  coins,
  expose,
  heal,
  hostile,
  refill,
  revealClue,
  say,
  see,
  stun,
  trust,
} from '../sim/ops';
import { FOE_ARCH } from './archetypes';
import type { PassiveSpec, TriggerSpec } from './defs';

/**
 * 主役の札。レア度ではなく、物語で特別になる 20 枚。
 *
 *   章     作品らしい遊び方を積むと、一章ずつ進む（進み具合は札に刻まれ、
 *          札を手放すと物語も終わる）。章が進むたびに規則が書き換わり、
 *          名場面の一文が出る
 *   結末   第三章。その作品の、いちばん良いところ
 *   場面   特定の人物と出会うと、一度だけ起きる出来事
 *
 * 第二章まで進んだ主役は、同じ名前のビルドを第二段（暴走）へ押し上げる
 * 鍵にもなる（builds.ts）。
 */

export interface Chapter {
  name: string;
  /** 進め方（画面の言葉）。 */
  need: string;
  on: EvType;
  when: (ev: Ev, w: World) => boolean;
  /** 1 回で進む量（体力の傷など）。既定 1。 */
  amount?: (ev: Ev, w: World) => number;
  count: number;
  /** この章を越えたときの一文。 */
  line: string;
  /** 越えたあとに効く規則。 */
  text: string;
  passive?: readonly PassiveSpec[];
  triggers?: readonly TriggerSpec[];
}

export interface Scene {
  npc: string;
  text: string;
  run: (tx: Tx) => void;
}

export interface Legend {
  id: string;
  title: string;
  chapters: readonly [Chapter, Chapter, Chapter];
  scenes: readonly Scene[];
}

// ─── 道具 ─────────────────────────────────────────────────────

const ownerOf = (w: World): Who => w.enc?.who ?? 'you';
const charOf = (w: World, who: Who): Char => (who === 'rival' ? w.rival.char : w.you);
const slotOf = (w: World, id: string) => charOf(w, ownerOf(w)).cards.findIndex((c) => c?.id === id);
export const chapterOf = (c: Char, id: string) => c.cards.find((x) => x?.id === id)?.marks.ch ?? 0;
const chapterNow = (w: World, id: string) => chapterOf(charOf(w, ownerOf(w)), id);
const ctxChar = (c: RuleCtx) => charOf(c.w, c.who);
const night = (w: World) => isDeep(w.hour);
const lowHp = (c: Char) => c.hp * 3 < 16 + 4 * (c.innate.VIT + c.growth.VIT);
const foeArch = (w: World) => FOE_ARCH[w.enc?.foe.id ?? ''] ?? [];

const usedSelf = (id: string) => (ev: Ev, w: World) =>
  ev.type === 'card.use' && ev.card === id && ev.who === ownerOf(w);
const usedTag = (tag: string) => (ev: Ev, w: World) =>
  ev.type === 'card.use' && ev.who === ownerOf(w) && ev.tags.includes(tag as never);
const ended =
  (...outcomes: string[]) =>
  (ev: Ev) =>
    ev.type === 'enc.end' && outcomes.includes(ev.outcome);
const hurt = (ev: Ev, w: World) => ev.type === 'vital' && ev.who === ownerOf(w) && (ev.hp ?? 0) < 0;
const hurtBy = (ev: Ev) => (ev.type === 'vital' ? -(ev.hp ?? 0) : 0);
const shaken = (ev: Ev, w: World) =>
  ev.type === 'vital' && ev.who === ownerOf(w) && (ev.mind ?? 0) < 0;
const shakenBy = (ev: Ev) => (ev.type === 'vital' ? -(ev.mind ?? 0) : 0);
const trueClue = (ev: Ev) => ev.type === 'clue' && ev.shown && !ev.false;
const reached = (stratum: number) => (ev: Ev) => ev.type === 'map.built' && ev.stratum >= stratum;
const arrivedOdd = (ev: Ev, w: World) =>
  ev.type === 'moved' && !!w.map.find((n) => n.id === ev.node)?.eps.length;

// ─── 二十の主役 ───────────────────────────────────────────────

export const LEGENDS: readonly Legend[] = [
  {
    id: 'nighthawks',
    title: '夜更かしの客たち',
    chapters: [
      {
        name: 'カウンターの灯り',
        need: '0 時を過ぎてから使う',
        on: 'card.use',
        when: (ev, w) => usedSelf('nighthawks')(ev, w) && night(w),
        count: 3,
        line: '店の灯りだけが、通りに落ちている。',
        text: '深夜、毎手番 心の構え +2',
        passive: [
          { rule: 'turnCalm', when: (c) => night(c.w), fn: (_c, v) => v + 2, text: '灯り' },
        ],
      },
      {
        name: 'ガラス越しの視線',
        need: '深夜、立ち去らずに遭遇を終える',
        on: 'enc.end',
        when: (ev, w) =>
          ev.type === 'enc.end' &&
          night(w) &&
          !['left', 'fled', 'fallen', 'shattered'].includes(ev.outcome),
        count: 3,
        line: '誰も話していないのに、全員が互いを知っている。',
        text: '初めから信頼 +1。深夜、嘘の予告が見える',
        passive: [
          { rule: 'startTrust', fn: (_c, v) => v + 1, text: '常連の顔' },
          { rule: 'intentVisible', when: (c) => night(c.w), fn: () => 1, text: 'ガラス越し' },
        ],
      },
      {
        name: '閉まらない店',
        need: '夜明けを過ぎてから、誰かと向き合う',
        on: 'enc.start',
        when: (ev, w) => ev.type === 'enc.start' && ev.who === ownerOf(w) && isMorning(w.hour),
        count: 1,
        line: 'この店は閉まらない。夜も、明けない。',
        text: '夜明けを過ぎても、相手は荒れない',
        passive: [{ rule: 'lateness', fn: () => 0, text: '明けない夜' }],
      },
    ],
    scenes: [
      {
        npc: 'counterman',
        text: '給仕は何も聞かずに、コーヒーをもう一杯注いだ。',
        run: (tx) => {
          heal(tx, 0, 5);
          trust(tx, 2);
        },
      },
    ],
  },
  {
    id: 'saturn',
    title: '土星の環',
    chapters: [
      {
        name: 'サフォークを歩く',
        need: '持ったまま、場所を移る',
        on: 'moved',
        when: () => true,
        count: 6,
        line: '歩いているあいだだけ、考えがまとまる。',
        text: '出来事の判定 +10%',
        passive: [{ rule: 'storyChance', fn: (_c, v) => v + 10, text: '歩く人' }],
      },
      {
        name: '脱線',
        need: '［記憶］のカードのあとで、本当の手がかりを見る',
        on: 'clue',
        when: (ev, w) => trueClue(ev) && !!w.enc?.last.includes('memory'),
        count: 4,
        line: '話はいつも逸れて、逸れた先に答えがある。',
        text: '［記憶］のカード ×1.3',
        passive: [
          {
            rule: 'mult',
            when: (c) => !!c.tags?.includes('memory'),
            fn: (_c, v) => v * 1.3,
            text: '脱線 ×1.3',
          },
        ],
      },
      {
        name: '塵と灰',
        need: '記憶（永続カード）を得る',
        on: 'perm',
        when: (ev, w) => ev.type === 'perm' && ev.gain && ev.who === ownerOf(w),
        count: 3,
        line: 'すべては、もう書かれている。あとは読むだけだ。',
        text: 'どの遭遇も、手がかりを 1 つ見えた状態で始まる',
        triggers: [
          {
            on: 'enc.start',
            when: (ev, w) => ev.type === 'enc.start' && ev.who === ownerOf(w),
            run: (tx) => void revealClue(tx),
            text: '既に書かれている',
          },
        ],
      },
    ],
    scenes: [
      {
        npc: 'archivist',
        text: '記録係は、あなたが歩いた道をもう地図に起こしていた。',
        run: (tx) => {
          revealClue(tx);
          revealClue(tx);
        },
      },
    ],
  },
  {
    id: 'ironman',
    title: 'アイアンマン',
    chapters: [
      {
        name: '洞窟の試作',
        need: '体力を削られる（合計）',
        on: 'vital',
        when: hurt,
        amount: hurtBy,
        count: 20,
        line: '胸の光が、鉄屑の中で点いた。',
        text: '守りの半分が手番をまたいで残る',
        passive: [{ rule: 'guardKeep', fn: (_c, v) => Math.max(v, 0.5), text: '試作の装甲' }],
      },
      {
        name: 'マーク II',
        need: '［技術］のカードを使う',
        on: 'card.use',
        when: usedTag('tech'),
        count: 6,
        line: '飛べる。たぶん。',
        text: '体力を削る量 +2',
        passive: [{ rule: 'hit', fn: (_c, v) => (v > 0 ? v + 2 : v), text: 'マーク II' }],
      },
      {
        name: '私がアイアンマンだ',
        need: '倒して終える',
        on: 'enc.end',
        when: ended('beaten'),
        count: 3,
        line: '名乗った瞬間、もう誰も鎧の中身を疑わない。',
        text: '毎手番 守り +4。受ける傷 −2',
        passive: [
          { rule: 'turnGuard', fn: (_c, v) => v + 4, text: '装甲' },
          { rule: 'strikeTaken', fn: (_c, v) => Math.max(0, v - 2), text: '装甲' },
        ],
      },
    ],
    scenes: [
      {
        npc: 'drone',
        text: 'ドローンの照準が、あなたの胸の光で止まった。',
        run: (tx) => stun(tx),
      },
    ],
  },
  {
    id: 'miserables',
    title: 'ジャン・ヴァルジャン',
    chapters: [
      {
        name: '銀の燭台',
        need: '誰かに頼るか、打ち解ける',
        on: 'enc.end',
        when: ended('trusted'),
        count: 2,
        line: '「この燭台も、持っていきなさい」',
        text: '信頼の伸び ×1.25',
        passive: [{ rule: 'trust', fn: (_c, v) => (v > 0 ? v * 1.25 : v), text: '燭台' }],
      },
      {
        name: '二四六〇一号',
        need: '嘘がばれる',
        on: 'caught',
        when: () => true,
        count: 1,
        line: '名前を変えても、番号は追ってくる。',
        text: 'あなたが煽る敵意が半分になる',
        passive: [{ rule: 'hostility', fn: (_c, v) => (v > 0 ? v * 0.5 : v), text: '赦し' }],
      },
      {
        name: 'バリケード',
        need: '体力 1/3 を切ったまま、遭遇を終える',
        on: 'enc.end',
        when: (ev, w) =>
          ev.type === 'enc.end' &&
          lowHp(charOf(w, ownerOf(w))) &&
          !['fallen', 'shattered'].includes(ev.outcome),
        count: 1,
        line: '下水道を、誰かを背負って歩いた。',
        text: '体力が 1/3 を切ると、カード ×2・毎手番 守り +5',
        passive: [
          {
            rule: 'mult',
            when: (c) => lowHp(ctxChar(c)),
            fn: (_c, v) => v * 2,
            text: 'バリケード ×2',
          },
          {
            rule: 'turnGuard',
            when: (c) => lowHp(ctxChar(c)),
            fn: (_c, v) => v + 5,
            text: 'バリケード',
          },
        ],
      },
    ],
    scenes: [
      {
        npc: 'watchman',
        text: '夜警はあなたの顔を覚えていた。そして、見逃した。',
        run: (tx) => {
          trust(tx, 3);
          hostile(tx, -2);
        },
      },
    ],
  },
  {
    id: 'chrome',
    title: 'クローム襲撃',
    chapters: [
      {
        name: 'ICE の地図',
        need: '本当の予告を見る',
        on: 'seen',
        when: () => true,
        count: 5,
        line: '氷の壁の、継ぎ目が見えた。',
        text: '誤った手がかり −15%',
        passive: [{ rule: 'falseChance', fn: (_c, v) => v - 15, text: 'ICE の地図' }],
      },
      {
        name: 'ロシアのウイルス',
        need: '相手の守りを剥がす',
        on: 'foe',
        when: (ev) => ev.type === 'foe' && ev.field === 'guard' && ev.n < 0,
        count: 3,
        line: '金庫は、外からではなく内側から溶ける。',
        text: '［制度］の相手に ×1.3',
        passive: [
          {
            rule: 'mult',
            when: (c) => !!c.enc?.foe.tags.includes('institution'),
            fn: (_c, v) => v * 1.3,
            text: 'ウイルス',
          },
        ],
      },
      {
        name: '襲撃',
        need: '暴いて終える',
        on: 'enc.end',
        when: ended('uncovered'),
        count: 2,
        line: 'クロームの金庫が燃える。あとは、どれだけ持って帰れるか。',
        text: '使うたびに 金 15 と手がかり 1',
        triggers: [
          {
            on: 'card.use',
            when: usedSelf('chrome'),
            run: (tx) => {
              coins(tx, 15);
              revealClue(tx);
            },
            text: '襲撃',
          },
        ],
      },
    ],
    scenes: [
      {
        npc: 'censor',
        text: '検閲官の金庫が、内側から燃えはじめた。',
        run: (tx) => {
          expose(tx, 5);
          coins(tx, 20);
        },
      },
    ],
  },
  {
    id: 'solaris',
    title: 'ソラリスの海',
    chapters: [
      {
        name: '来訪者',
        need: '〈亡霊〉と向き合う',
        on: 'enc.start',
        when: (ev, w) => ev.type === 'enc.start' && foeArch(w).includes('revenant'),
        count: 1,
        line: '死んだはずの人が、ドアを叩いた。',
        text: '精神への傷 −1',
        passive: [{ rule: 'threatTaken', fn: (_c, v) => Math.max(0, v - 1), text: '来訪者' }],
      },
      {
        name: '海の鏡',
        need: '精神を削られる（合計）',
        on: 'vital',
        when: shaken,
        amount: shakenBy,
        count: 15,
        line: '海は、あなたが忘れたものしか映さない。',
        text: '心の構えが手番をまたいで残る',
        passive: [{ rule: 'calmKeep', fn: () => 1, text: '海の鏡' }],
      },
      {
        name: '帰郷',
        need: '打ち解けて終える',
        on: 'enc.end',
        when: ended('trusted'),
        count: 2,
        line: '父の家の窓に、雨が内側から降っていた。',
        text: '打ち解けるたび、精神が全快し、全カード +1',
        triggers: [
          {
            on: 'enc.end',
            when: ended('trusted'),
            run: (tx) => {
              heal(tx, 0, 99);
              refill(tx, 1);
            },
            text: '海が返す',
          },
        ],
      },
    ],
    scenes: [
      {
        npc: 'ghost',
        text: '幽霊は、あなたが覚えているとおりの顔をしていた。',
        run: (tx) => trust(tx, 4),
      },
    ],
  },
  {
    id: 'stalker',
    title: 'ゾーン',
    chapters: [
      {
        name: 'ナットを投げる',
        need: '遭遇の最初の手番に使う',
        on: 'card.use',
        when: (ev, w) => usedSelf('stalker')(ev, w) && (w.enc?.turn ?? 9) <= 1,
        count: 3,
        line: 'ナットは、まっすぐには落ちなかった。',
        text: '初めの敵意 −1',
        passive: [{ rule: 'startHostility', fn: (_c, v) => v - 1, text: 'ナット' }],
      },
      {
        name: '罠の地',
        need: 'エピテットのある場所に着く',
        on: 'moved',
        when: arrivedOdd,
        count: 3,
        line: 'まっすぐ行くのが、いちばん遠い。',
        text: '着くまでの時間 −0.5',
        passive: [
          {
            rule: 'timeCost',
            when: (c) => c.kind === 'move',
            fn: (_c, v) => v - 0.5,
            text: '回り道',
          },
        ],
      },
      {
        name: '部屋',
        need: '三の区画（琥珀の階）に着く',
        on: 'map.built',
        when: reached(3),
        count: 1,
        line: '部屋は、口に出した願いではなく、本当の願いを叶える。',
        text: '出来事の判定 +40%。休む回復 ×1.5',
        passive: [
          { rule: 'storyChance', fn: (_c, v) => v + 40, text: '部屋' },
          { rule: 'restHeal', fn: (_c, v) => v * 1.5, text: '部屋' },
        ],
      },
    ],
    scenes: [
      {
        npc: 'geologist',
        text: '地質学者は、ナットの落ちた跡を見て黙った。',
        run: (tx) => {
          revealClue(tx);
          revealClue(tx);
        },
      },
    ],
  },
  {
    id: 'bladerunner',
    title: 'ヴォイト＝カンプフ',
    chapters: [
      {
        name: '検査',
        need: '暴いて終える',
        on: 'enc.end',
        when: ended('uncovered'),
        count: 2,
        line: '瞳孔は、言葉より先に答える。',
        text: 'INT の判定 +10%',
        passive: [
          {
            rule: 'checkChance',
            when: (c) => !!c.stat?.includes('INT'),
            fn: (_c, v) => v + 10,
            text: '検査',
          },
        ],
      },
      {
        name: '共感の欠如',
        need: '相手が嘘をつく手番にカードを使う',
        on: 'card.use',
        when: (ev, w) =>
          ev.type === 'card.use' && ev.who === ownerOf(w) && !!w.enc?.foe.intent?.lie,
        count: 3,
        line: '亀をひっくり返したのは、あなたですか。',
        text: '予告がいつも見える',
        passive: [{ rule: 'intentVisible', fn: () => 1, text: '共感の欠如' }],
      },
      {
        name: '雨の中の涙',
        need: '体力を削られる（合計）',
        on: 'vital',
        when: hurt,
        amount: hurtBy,
        count: 25,
        line: 'その記憶も、いつか雨の中の涙のように。',
        text: '暴いて終えるたび、体力 30% と 金 20',
        triggers: [
          {
            on: 'enc.end',
            when: ended('uncovered'),
            run: (tx) => {
              heal(tx, 8, 4);
              coins(tx, 20);
            },
            text: '雨',
          },
        ],
      },
    ],
    scenes: [
      {
        npc: 'projector',
        text: '映写機が、あなたの網膜をそのまま映した。',
        run: (tx) => {
          see(tx);
          stun(tx);
        },
      },
    ],
  },
  {
    id: 'leaves',
    title: 'ネイビッドソン記録',
    chapters: [
      {
        name: '五分半の廊下',
        need: 'エピテットのある場所に着く',
        on: 'moved',
        when: arrivedOdd,
        count: 3,
        line: '家の内側が、外側より 4 分の 1 インチ広い。',
        text: '奇妙な場所では、すべてのカード ×1.2',
        passive: [
          {
            rule: 'mult',
            when: (c) => !!c.w.map.find((n) => n.id === c.w.pos)?.eps.length,
            fn: (_c, v) => v * 1.2,
            text: '廊下',
          },
        ],
      },
      {
        name: '探検隊',
        need: '使う',
        on: 'card.use',
        when: usedSelf('leaves'),
        count: 5,
        line: '階段は、降りるほど長くなる。',
        text: '奇妙な場所では、回数を減らさない',
        passive: [
          {
            rule: 'useSpend',
            when: (c) => c.card === 'leaves' && !!c.w.map.find((n) => n.id === c.w.pos)?.eps.length,
            fn: () => 0,
            text: '探検隊',
          },
        ],
      },
      {
        name: '内側の階段',
        need: '三の区画（琥珀の階）に着く',
        on: 'map.built',
        when: reached(3),
        count: 1,
        line: '底はない。だから、まだ降りられる。',
        text: '使うたびに、守り +6・心の構え +4',
        triggers: [
          {
            on: 'card.use',
            when: usedSelf('leaves'),
            run: (tx) => {
              tx.emit({ type: 'enc.you', field: 'guard', n: 6 });
              calm(tx, 4);
            },
            text: '内側',
          },
        ],
      },
    ],
    scenes: [
      {
        npc: 'usher',
        text: '案内係が、どこにもない扉を指さした。',
        run: (tx) => expose(tx, 3),
      },
    ],
  },
  {
    id: 'threebody',
    title: '面壁者',
    chapters: [
      {
        name: '暗い森',
        need: '使う',
        on: 'card.use',
        when: usedSelf('threebody'),
        count: 1,
        line: '宇宙は暗い森だ。誰もが、息を潜めた狩人だ。',
        text: '嘘をつく相手に、すべてのカード ×1.2',
        passive: [
          {
            rule: 'mult',
            when: (c) => !!c.enc?.foe.intent?.lie,
            fn: (_c, v) => v * 1.2,
            text: '暗い森',
          },
        ],
      },
      {
        name: '面壁',
        need: '嘘の予告を見破る',
        on: 'seen',
        when: (_ev, w) => !!w.enc?.foe.intent?.lie,
        count: 3,
        line: '計画は、頭の中にだけある。誰にも読ませない。',
        text: 'あなたの嘘 +15%',
        passive: [{ rule: 'lieChance', fn: (_c, v) => v + 15, text: '面壁' }],
      },
      {
        name: '抑止',
        need: '区画の最後の相手を越える',
        on: 'enc.end',
        when: (ev, w) =>
          ev.type === 'enc.end' &&
          w.enc?.tier === 'boss' &&
          !['fallen', 'shattered'].includes(ev.outcome),
        count: 1,
        line: '撃てば、こちらも見える。だから、誰も撃たない。',
        text: 'どの遭遇も、相手が 1 手番うごけない状態で始まる',
        triggers: [
          {
            on: 'enc.start',
            when: (ev, w) => ev.type === 'enc.start' && ev.who === ownerOf(w),
            run: (tx) => stun(tx),
            text: '抑止',
          },
        ],
      },
    ],
    scenes: [
      {
        npc: 'volume',
        text: '立方体の面に、三つの太陽が映った。',
        run: (tx) => void breakFoe(tx, 10),
      },
    ],
  },
  {
    id: 'akira',
    title: '鉄雄',
    chapters: [
      {
        name: 'カプセル',
        need: '同じ遭遇で 3 回使う',
        on: 'card.use',
        when: (ev, w) => usedSelf('akira')(ev, w) && (w.enc?.st.akira ?? 0) >= 2,
        count: 1,
        line: '頭の中で、誰かが目を覚ました。',
        text: '代償を払わない',
        passive: [
          { rule: 'selfCost', when: (c) => c.card === 'akira', fn: () => 0, text: 'カプセル' },
        ],
      },
      {
        name: 'アキラの棺',
        need: '体力を削られる（合計）',
        on: 'vital',
        when: hurt,
        amount: hurtBy,
        count: 30,
        line: '冷凍庫の底に、子どもの臓器が並んでいた。',
        text: '体力を削る量 +3',
        passive: [{ rule: 'hit', fn: (_c, v) => (v > 0 ? v + 3 : v), text: '棺' }],
      },
      {
        name: '覚醒',
        need: '危険な相手を倒す',
        on: 'enc.end',
        when: (ev, w) =>
          ev.type === 'enc.end' && ev.outcome === 'beaten' && w.enc?.tier === 'danger',
        count: 2,
        line: '腕が、街の半分を飲み込んだ。',
        text: '『AKIRA』×2',
        passive: [
          { rule: 'mult', when: (c) => c.card === 'akira', fn: (_c, v) => v * 2, text: '覚醒 ×2' },
        ],
      },
    ],
    scenes: [
      {
        npc: 'insect',
        text: '虫が、あなたの腕の膨らみに怯えて後ずさった。',
        run: (tx) => {
          hostile(tx, -3);
          stun(tx);
        },
      },
    ],
  },
  {
    id: 'ghost',
    title: '囁くゴースト',
    chapters: [
      {
        name: '義体',
        need: '［技術］か［身体］のカードを使う',
        on: 'card.use',
        when: (ev, w) => usedTag('tech')(ev, w) || usedTag('body')(ev, w),
        count: 5,
        line: 'この体のどこまでが、わたしなのか。',
        text: '精神への傷 −1',
        passive: [{ rule: 'threatTaken', fn: (_c, v) => Math.max(0, v - 1), text: '義体' }],
      },
      {
        name: '電脳潜入',
        need: '本当の手がかりを見る',
        on: 'clue',
        when: trueClue,
        count: 4,
        line: '相手の記憶の中を、泳いで渡る。',
        text: '誤った手がかり −20%',
        passive: [{ rule: 'falseChance', fn: (_c, v) => v - 20, text: '潜入' }],
      },
      {
        name: 'ネットは広大',
        need: '暴いて終える',
        on: 'enc.end',
        when: ended('uncovered'),
        count: 3,
        line: 'ネットは広大だわ。',
        text: '手がかりはもう誤らない。使うたびに手がかり 1',
        passive: [{ rule: 'falseChance', fn: () => 0, text: '囁き' }],
        triggers: [
          {
            on: 'card.use',
            when: usedSelf('ghost'),
            run: (tx) => void revealClue(tx),
            text: '囁き',
          },
        ],
      },
    ],
    scenes: [
      {
        npc: 'drone',
        text: 'ドローンの視界に、あなたの義眼の型番が映った。',
        run: (tx) => trust(tx, 3),
      },
    ],
  },
  {
    id: 'matrix',
    title: '赤い薬',
    chapters: [
      {
        name: '白兎を追え',
        need: '出来事を見る',
        on: 'story.seen',
        when: () => true,
        count: 3,
        line: '白兎の刺青をした女が、ドアを叩いた。',
        text: '出来事の判定 +10%',
        passive: [{ rule: 'storyChance', fn: (_c, v) => v + 10, text: '白兎' }],
      },
      {
        name: '弾丸を止める',
        need: '守りを積む（合計）',
        on: 'enc.you',
        when: (ev, w) => ev.type === 'enc.you' && ev.field === 'guard' && ev.n > 0 && !!w.enc,
        amount: (ev) => (ev.type === 'enc.you' ? ev.n : 0),
        count: 30,
        line: '避けるのではない。もう、そこにいない。',
        text: '毎手番 守り +2',
        passive: [{ rule: 'turnGuard', fn: (_c, v) => v + 2, text: '止まる弾丸' }],
      },
      {
        name: '救世主',
        need: '三の区画（琥珀の階）に着く',
        on: 'map.built',
        when: reached(3),
        count: 1,
        line: '緑の文字列が、世界の向こう側に見えた。',
        text: '予告がいつも見える。受ける傷 −2',
        passive: [
          { rule: 'intentVisible', fn: () => 1, text: '文字列' },
          { rule: 'strikeTaken', fn: (_c, v) => Math.max(0, v - 2), text: '救世主' },
        ],
      },
    ],
    scenes: [
      {
        npc: 'censor',
        text: '検閲官の顔が、緑の文字列に崩れた。',
        run: (tx) => void breakFoe(tx, 8),
      },
    ],
  },
  {
    id: 'odyssey',
    title: 'モノリス',
    chapters: [
      {
        name: '人類の夜明け',
        need: '倒して終える',
        on: 'enc.end',
        when: ended('beaten'),
        count: 1,
        line: '骨が、空へ放り上げられた。',
        text: '体力を削る量 +1',
        passive: [{ rule: 'hit', fn: (_c, v) => (v > 0 ? v + 1 : v), text: '骨' }],
      },
      {
        name: 'HAL',
        need: '［技術］のカードを使う',
        on: 'card.use',
        when: usedTag('tech'),
        count: 8,
        line: 'すまない、デイヴ。それはできない。',
        text: '判定 +10%',
        passive: [{ rule: 'checkChance', fn: (_c, v) => v + 10, text: 'HAL' }],
      },
      {
        name: 'スターチャイルド',
        need: '三の区画（琥珀の階）に着く',
        on: 'map.built',
        when: reached(3),
        count: 1,
        line: '部屋の中で年老いて、部屋の外で生まれ直した。',
        text: '着いた瞬間、すべての能力値 +1',
        triggers: [
          {
            on: 'card.mark',
            when: (ev, w) =>
              ev.type === 'card.mark' &&
              ev.mark === 'ch' &&
              chapterNow(w, 'odyssey') >= 3 &&
              !w.flags['starchild'],
            run: (tx) => {
              tx.emit({ type: 'flag', key: 'starchild', v: 1 });
              for (const s of ['VIT', 'ATK', 'DEF', 'WIL', 'INT', 'AGI'] as const)
                tx.emit({ type: 'grew', who: ownerOf(tx.w), stat: s });
            },
            text: '生まれ直す',
          },
        ],
      },
    ],
    scenes: [
      {
        npc: 'projector',
        text: '映写機の光が、黒い板に吸い込まれていった。',
        run: (tx) => calm(tx, 10),
      },
    ],
  },
  {
    id: 'mulholland',
    title: '青い箱',
    chapters: [
      {
        name: 'クラブ・シレンシオ',
        need: '嘘をつく（ばれなかった分）',
        on: 'claim',
        when: (ev, w) => ev.type === 'claim' && !ev.truth && !w.enc?.st.caughtNow,
        count: 2,
        line: 'No hay banda. 楽団はいない。それでも、歌が聞こえる。',
        text: 'あなたの嘘 +10%',
        passive: [{ rule: 'lieChance', fn: (_c, v) => v + 10, text: 'シレンシオ' }],
      },
      {
        name: '二人のベティ',
        need: '誤った手がかりを見る',
        on: 'clue',
        when: (ev) => ev.type === 'clue' && ev.shown && !!ev.false,
        count: 2,
        line: '夢の中のわたしのほうが、本物だった。',
        text: '誤った手がかりを見るたび、信頼 +1',
        triggers: [
          {
            on: 'clue',
            when: (ev) => ev.type === 'clue' && ev.shown && !!ev.false,
            run: (tx) => trust(tx, 1),
            text: 'ベティ',
          },
        ],
      },
      {
        name: '青い鍵',
        need: '打ち解けるか、暴いて終える',
        on: 'enc.end',
        when: ended('trusted', 'uncovered'),
        count: 3,
        line: '箱が開くと、部屋ごと裏返った。',
        text: '使うたびに、相手の信頼の 2 倍だけ意志を削る（夢が裏返る）',
        triggers: [
          {
            on: 'card.use',
            when: usedSelf('mulholland'),
            run: (tx) => void breakFoe(tx, 2 * (tx.w.enc?.foe.trust ?? 0)),
            text: '裏返る',
          },
        ],
      },
    ],
    scenes: [
      {
        npc: 'ghost',
        text: '幽霊が「静かに」と囁いた。劇場は満員だった。',
        run: (tx) => calm(tx, 8),
      },
    ],
  },
  {
    id: 'meninas',
    title: '鏡の中の王',
    chapters: [
      {
        name: '画家の視線',
        need: '本当の予告を見る',
        on: 'seen',
        when: () => true,
        count: 3,
        line: '描かれているのは、こちらを見ている誰かだ。',
        text: '［制度］の相手に ×1.15',
        passive: [
          {
            rule: 'mult',
            when: (c) => !!c.enc?.foe.tags.includes('institution'),
            fn: (_c, v) => v * 1.15,
            text: '視線',
          },
        ],
      },
      {
        name: '鏡の王',
        need: 'あなたの噂が広まる',
        on: 'gossip',
        when: () => true,
        count: 3,
        line: '鏡の奥に映っているのは、見ている側だった。',
        text: '初めの敵意 −1',
        passive: [{ rule: 'startHostility', fn: (_c, v) => v - 1, text: '鏡' }],
      },
      {
        name: '宮廷',
        need: `〈${ARCH_NAME.sovereign}〉の相手と向き合って終える`,
        on: 'enc.end',
        when: (ev, w) =>
          ev.type === 'enc.end' &&
          foeArch(w).includes('sovereign') &&
          !['fallen', 'shattered'].includes(ev.outcome),
        count: 1,
        line: '王も、王女も、侍女も、みな画家の方を向いている。',
        text: '意志を削る量 ×1.5',
        passive: [{ rule: 'break', fn: (_c, v) => v * 1.5, text: '宮廷' }],
      },
    ],
    scenes: [
      {
        npc: 'censor',
        text: '検閲官は、鏡に映る自分の顔に気づいた。',
        run: (tx) => void breakFoe(tx, 8),
      },
    ],
  },
  {
    id: 'cities',
    title: '見えない都市',
    chapters: [
      {
        name: 'マルコの報告',
        need: 'エピテットのある場所に着く',
        on: 'moved',
        when: arrivedOdd,
        count: 4,
        line: 'どの都市の話をしても、ヴェネツィアの話になる。',
        text: '出来事の判定 +10%',
        passive: [{ rule: 'storyChance', fn: (_c, v) => v + 10, text: '報告' }],
      },
      {
        name: '地図帳',
        need: '出来事を見る',
        on: 'story.seen',
        when: () => true,
        count: 3,
        line: '地図帳には、まだ無い都市まで載っていた。',
        text: '着くたび、［場所］のカード +1',
        triggers: [{ on: 'moved', run: (tx) => refill(tx, 1, 'place'), text: '地図帳' }],
      },
      {
        name: '地獄ではないもの',
        need: '三の区画（琥珀の階）に着く',
        on: 'map.built',
        when: reached(3),
        count: 1,
        line: '地獄の中で、地獄でないものを見分け、それに場所を与える。',
        text: '着くたび、全カード +1',
        triggers: [{ on: 'moved', run: (tx) => refill(tx, 1), text: '地獄ではないもの' }],
      },
    ],
    scenes: [
      {
        npc: 'archivist',
        text: '記録係は、あなたの話を聞いて都市を一つ書き足した。',
        run: (tx) => coins(tx, 15),
      },
    ],
  },
  {
    id: 'ficciones',
    title: '八岐の園',
    chapters: [
      {
        name: '分かれ道',
        need: 'ほかのカードを使う',
        on: 'card.use',
        when: (ev, w) => ev.type === 'card.use' && ev.who === ownerOf(w) && ev.card !== 'ficciones',
        count: 8,
        line: 'すべての道が、同時に選ばれている。',
        text: '連鎖 +1',
        passive: [{ rule: 'chain', fn: (_c, v) => (v > 0 ? v + 1 : v), text: '分かれ道' }],
      },
      {
        name: 'バベルの図書館',
        need: 'エピテットを拾う',
        on: 'ep.held',
        when: (ev) => ev.type === 'ep.held' && ev.n > 0,
        count: 2,
        line: 'どこかの棚に、あなたの一生を書いた本がある。',
        text: '誤った手がかり −10%。手がかりの攻め筋が見えやすい',
        passive: [{ rule: 'falseChance', fn: (_c, v) => v - 10, text: '図書館' }],
      },
      {
        name: 'トレーン',
        need: '記憶（永続カード）を得る',
        on: 'perm',
        when: (ev, w) => ev.type === 'perm' && ev.gain && ev.who === ownerOf(w),
        count: 3,
        line: '百科事典の一項目が、世界を書き換えはじめた。',
        text: '使うたびに、手がかり 2',
        triggers: [
          {
            on: 'card.use',
            when: usedSelf('ficciones'),
            run: (tx) => {
              revealClue(tx);
              revealClue(tx);
            },
            text: 'トレーン',
          },
        ],
      },
    ],
    scenes: [
      {
        npc: 'archivist',
        text: '記録係の棚に、まだ書かれていない本があった。',
        run: (tx) => {
          revealClue(tx);
          revealClue(tx);
        },
      },
    ],
  },
  {
    id: 'heat',
    title: 'ニール・マッコーリー',
    chapters: [
      {
        name: '規律',
        need: '倒して終える',
        on: 'enc.end',
        when: ended('beaten'),
        count: 3,
        line: '準備が九割。残りの一割で死ぬ。',
        text: '体力を削る量 +1',
        passive: [{ rule: 'hit', fn: (_c, v) => (v > 0 ? v + 1 : v), text: '規律' }],
      },
      {
        name: '三十秒',
        need: '立ち去って終える',
        on: 'enc.end',
        when: ended('left'),
        count: 2,
        line: '角の向こうに熱を感じたら、三十秒で消えろ。',
        text: '立ち去る +30%',
        passive: [{ rule: 'leaveChance', fn: (_c, v) => (v > 0 ? v + 30 : v), text: '三十秒' }],
      },
      {
        name: '最後の仕事',
        need: '金を 150 持つ',
        on: 'coins',
        when: (ev, w) => ev.type === 'coins' && charOf(w, ownerOf(w)).coins >= 150,
        count: 1,
        line: '空港の灯りが見える。あと一つだけ。',
        text: '立ち去るたび、金 10 と全カード +1',
        triggers: [
          {
            on: 'enc.end',
            when: ended('left'),
            run: (tx) => {
              coins(tx, 10);
              refill(tx, 1);
            },
            text: '最後の仕事',
          },
        ],
      },
    ],
    scenes: [
      {
        npc: 'watchman',
        text: '夜警とあなたは、同じ店でコーヒーを飲んだことがある。',
        run: (tx) => {
          trust(tx, 3);
          hostile(tx, -2);
        },
      },
    ],
  },
  {
    id: 'highlow',
    title: '天国と地獄',
    chapters: [
      {
        name: '身代金',
        need: '金を払う（合計）',
        on: 'coins',
        when: (ev, w) => ev.type === 'coins' && ev.n < 0 && ev.who === ownerOf(w),
        amount: (ev) => (ev.type === 'coins' ? -ev.n : 0),
        count: 30,
        line: '他人の子のために、全財産を鞄に詰めた。',
        text: '値段 ×0.9',
        passive: [{ rule: 'price', fn: (_c, v) => Math.round(v * 0.9), text: '身代金' }],
      },
      {
        name: '煙突の煙',
        need: '本当の手がかりを見る',
        on: 'clue',
        when: trueClue,
        count: 5,
        line: '白黒の街に、桃色の煙が一筋あがった。',
        text: '誤った手がかり −10%',
        passive: [{ rule: 'falseChance', fn: (_c, v) => v - 10, text: '煙' }],
      },
      {
        name: '面会室',
        need: '暴いて終える',
        on: 'enc.end',
        when: ended('uncovered'),
        count: 2,
        line: 'ガラス越しに、坂の下から見上げていた目と会った。',
        text: '暴くたび、金 25・体力 20%',
        triggers: [
          {
            on: 'enc.end',
            when: ended('uncovered'),
            run: (tx) => {
              coins(tx, 25);
              heal(tx, 6, 0);
            },
            text: '面会室',
          },
        ],
      },
    ],
    scenes: [
      {
        npc: 'regular',
        text: '常連客の靴に、桃色の粉が付いていた。',
        run: (tx) => {
          revealClue(tx);
          revealClue(tx);
        },
      },
    ],
  },
];

// ─── 規則へ組み立てる ─────────────────────────────────────────

/** 主役の札の章を、その札の規則（パッシブとトリガ）へ組み立てる。 */
export function legendRules(l: Legend): { passive: PassiveSpec[]; triggers: TriggerSpec[] } {
  const passive: PassiveSpec[] = [];
  const triggers: TriggerSpec[] = [];
  l.chapters.forEach((ch, k) => {
    // 進める。
    triggers.push({
      on: ch.on,
      when: (ev, w) => chapterNow(w, l.id) === k && slotOf(w, l.id) >= 0 && ch.when(ev, w),
      run: (tx, ev) => {
        const w = tx.w;
        const who = ownerOf(w);
        const slot = slotOf(w, l.id);
        const card = charOf(w, who).cards[slot];
        if (!card) return;
        const n = Math.max(0, Math.round(ch.amount?.(ev, w) ?? 1));
        if (!n) return;
        tx.emit({ type: 'card.mark', who, slot, mark: 'p', n });
        if ((card.marks.p ?? 0) < ch.count) return;
        tx.emit({ type: 'card.mark', who, slot, mark: 'p', n: -(card.marks.p ?? 0) });
        tx.emit({ type: 'card.mark', who, slot, mark: 'ch', n: 1 });
        if (who === 'you')
          tx.emit({
            type: 'note',
            text: `『${l.title}』第${'一二三'[k]}章「${ch.name}」── ${ch.line}`,
            level: 3,
          });
      },
      text: `『${l.title}』を進める`,
    });
    // 越えた章の規則。
    for (const p of ch.passive ?? [])
      passive.push({
        ...p,
        when: (c) => chapterOf(ctxChar(c), l.id) > k && (!p.when || p.when(c)),
      });
    for (const t of ch.triggers ?? [])
      triggers.push({
        ...t,
        when: (ev, w) => chapterNow(w, l.id) > k && (!t.when || t.when(ev, w)),
      });
  });
  // 場面（その人物と、一度だけ）。
  for (const s of l.scenes)
    triggers.push({
      on: 'enc.start',
      when: (ev, w) =>
        ev.type === 'enc.start' &&
        ev.foe.id === s.npc &&
        ev.who === 'you' &&
        !w.flags[`scene:${l.id}:${s.npc}`],
      run: (tx) => {
        tx.emit({ type: 'flag', key: `scene:${l.id}:${s.npc}`, v: 1 });
        say(tx, 'voice', s.text);
        s.run(tx);
      },
      text: `場面：${s.text}`,
    });
  return { passive, triggers };
}

/** 画面向け：いまの章と進み具合。 */
export function legendState(
  c: Char,
  id: string,
): { legend: Legend; chapter: number; progress: number } | null {
  const l = LEGENDS.find((x) => x.id === id);
  const card = c.cards.find((x) => x?.id === id);
  if (!l || !card) return null;
  return { legend: l, chapter: card.marks.ch ?? 0, progress: card.marks.p ?? 0 };
}
