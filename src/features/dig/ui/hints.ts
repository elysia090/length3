import { buildsOf } from '../content/sources';
import type { World } from '../core/model';
import { foeHardness, nodeHardness, outmatched, youHardness } from '../sim/hardness';
import { isBridge, lateral, reachable } from '../sim/run';

/**
 * 案内（チュートリアルとヒント）。塔の上の帯に、いまの状況にいちばん関係する
 * まだ見ていない一つだけを出す。見たものは端末に覚えて、二度目からは出さない
 * （一覧からはいつでも読み返せる）。並び順がそのまま優先順。
 */
export interface Hint {
  id: string;
  title: string;
  text: string;
  when: (w: World) => boolean;
}

const onMap = (w: World) => !w.enc && !w.pending && !w.ending;

export const HINTS: readonly Hint[] = [
  {
    id: 'move',
    title: '下りる',
    text: '光っている部屋を押すと、そこへ下りる。← → で選んで Enter でもいい。一つ下りるごとに 1 時間。',
    when: (w) => onMap(w) && w.pos === null,
  },
  {
    id: 'hard',
    title: '硬度',
    text: '人の横の数字は硬度（1 滑石〜10 金剛石）。枠で囲まれていたら、正面からは歯が立たない相手。',
    when: (w) => onMap(w) && reachable(w).some((n) => n.npc && nodeHardness(w, n) !== null),
  },
  {
    id: 'encounter',
    title: '向き合う',
    text: '相手の体力・意志・信頼・手がかり。どれか一つを尽くせば決着がつく。倒すだけが終わり方ではない。',
    when: (w) => !!w.enc && w.enc.phase === 'act',
  },
  {
    id: 'intent',
    title: '次の手',
    text: '相手は次の手を先に見せる。強い一撃の前は構え、話してくる時は話す。見せている手が嘘のこともある。',
    when: (w) => !!w.enc?.foe.intent,
  },
  {
    id: 'cards',
    title: 'カード',
    text: 'カードは使うと回数が減る（●）。0 回になっても、危うい別の効き目で使える。休むか、条件で戻る。',
    when: (w) => !!w.enc && w.you.cards.some((c) => c && c.uses < c.max),
  },
  {
    id: 'empty',
    title: '空き枠',
    text: '初めのカードは 3 枚。空き枠は、決着のあとに拾うカードで埋まっていく。何を拾うかで、人物が決まる。',
    when: (w) => w.pending?.kind === 'reward' && w.you.cards.some((c) => !c),
  },
  {
    id: 'hall',
    title: '廊下',
    text: '同じフロアの隣の部屋へは、廊下を歩いて行ける。下りずに 1 時間。出来事と人の両方を取れる。そのぶん、時計は進む。',
    when: (w) => onMap(w) && lateral(w).length > 0,
  },
  {
    id: 'bridge',
    title: '隣の塔',
    text: '建物は一棟ではない。渡り廊下（2 時間）で隣の塔へ渡れる部屋がある。本棟では会わない顔と、珍しい棚がある。二フロア下りると、本棟へ戻ってくる。',
    when: (w) => onMap(w) && w.pos !== null && reachable(w).some((n) => isBridge(w, n)),
  },
  {
    id: 'epithet',
    title: 'エピテット',
    text: '下の《》は札に貼れる。押して、白くなった札を押す（札へ落としてもいい）。札の効き目と原型が変わる。',
    when: (w) =>
      onMap(w) && w.you.epithets.length > 0 && w.you.cards.some((c) => !!c && c.eps.length < 2),
  },
  {
    id: 'routes',
    title: '道の読み',
    text: '三つの道は、性格が違う。安定は勝ちやすいが得るものが少ない。高連鎖は噛み合うが崩れると大きい。あと一つは、強い構成が成立しかけている道。',
    when: (w) => onMap(w) && w.pos !== null,
  },
  {
    id: 'stage',
    title: '見せ場',
    text: '［ ］つきの部屋は見せ場。タグの合うカードがよく効き、噛み合った数だけ見返りがある。相手も手強い。',
    when: (w) => onMap(w) && reachable(w).some((n) => !!n.stage?.length),
  },
  {
    id: 'retreat',
    title: '退く',
    text: '歯が立たない相手からは退いていい。最後の相手からも。相手は傷を覚えていて、あとで再戦できる。',
    when: (w) => !!w.enc && outmatched(foeHardness(w.enc.foe), youHardness(w)),
  },
  {
    id: 'memory',
    title: '記憶',
    text: '記憶（永続カード）は使わない。持っているだけで効き続け、組み合わさると新しい記憶や出来事が開く。',
    when: (w) => w.pending?.kind === 'reward' && w.pending.take.length > 0,
  },
  {
    id: 'rest',
    title: '食堂',
    text: '食堂では一つだけ選べる。休む・ひと晩・整える・一枚捨てる。カードの変質もここ。同じ区画で休むほど、効きは薄れる。',
    when: (w) => w.pending?.kind === 'rest',
  },
  {
    id: 'shop',
    title: '古物商',
    text: '古物商は、あなたが探しているものを聞きつけている。あと一つ足りないものが、棚に並んでいることがある。',
    when: (w) => w.pending?.kind === 'shop',
  },
  {
    id: 'build',
    title: 'ビルド',
    text: 'ビルドが成立した。主役の札の第二章か、原型の四枚重ねで暴走する。暴走には必ず上限がある。極めれば外れる。',
    when: (w) => buildsOf(w.you).length > 0,
  },
  {
    id: 'title',
    title: '冠',
    text: '振る舞いは噂になる。付いた冠は、会う前の相手の読みを変える。',
    when: (w) => w.you.titles.length > 0,
  },
];

/** いまいちばん関係する、まだ見ていない案内。 */
export function nextHint(w: World, seen: readonly string[]): Hint | null {
  return HINTS.find((h) => !seen.includes(h.id) && h.when(w)) ?? null;
}
