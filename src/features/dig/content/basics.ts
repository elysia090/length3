import type { CardDef, Recover } from './defs';
import type { Fx } from './fx';
import type { Tag } from '../core/tags';
import type { Stat } from '../core/model';

/**
 * 共通語彙《ベーシック》。誰でも使える 20 枚。単体では地味だが、規則の
 * 隙間に差し込む部品になる（真似る・書き留める・誓う・燃やす）。
 */
function b(
  no: number,
  id: string,
  name: string,
  tags: Tag[],
  stats: Stat[],
  uses: number,
  ready: Fx[],
  spentName: string,
  spent: Fx[],
  recover: Recover[],
  flavor: string,
  rarity: CardDef['rarity'] = 'common',
): CardDef {
  return { id, layer: 'basic', no, name, tags, stats, uses, rarity, ready, spentName, spent, recover: { on: recover }, since: '1.2.0', flavor };
}

export const BASICS: readonly CardDef[] = [
  b(101, 'look', '見る', ['gaze'], ['INT'], 4, [['see']], '目を凝らす', [['see'], ['clue', 1, true], ['cost', 0, 1]], ['uncover'], 'まず、見る。'),
  b(102, 'listen', '聞く', ['person', 'trust'], ['WIL'], 4, [['trust', 1], ['if', ['trustHalf'], [['clue', 1]]]], '聞き流す', [['trust', 1], ['cost', 0, 1]], ['trusted'], '相手が話し終えるまで待つ。'),
  b(103, 'hush', '黙る', ['private', 'time'], ['WIL'], 4, [['calm', 3], ['host', -1]], '押し黙る', [['calm', 4], ['trust', -1]], ['quiet'], '言わないことも、言葉のうち。'),
  b(104, 'push', '押し返す', ['body'], ['ATK'], 4, [['hit', { n: 3, s: 'ATK' }]], '振り払う', [['hit', { n: 5, s: 'ATK' }], ['cost', 1]], ['win'], '手のひらで、相手の胸を。'),
  b(105, 'brace', '構え直す', ['body', 'time'], ['DEF'], 4, [['guard', { n: 4, s: 'DEF' }]], '踏みとどまる', [['guard', { n: 6, s: 'DEF' }], ['cost', 0, 1]], ['win'], '足の位置を変える。'),
  b(106, 'fib', '嘘をつく', ['private'], ['INT'], 3, [['lie', 2]], '言い張る', [['lie', 3, 10]], ['lieKept'], '小さな嘘から始める。'),
  b(107, 'run', '走る', ['place', 'body'], ['AGI'], 2, [['guard', 2], ['check', 'AGI', 40, [['leave']]]], '逃げ出す', [['leave', true]], [], 'どこへ、とは決めずに。'),
  b(108, 'pinch', '盗む', ['private', 'body'], ['AGI'], 3, [['check', 'AGI', 30, [['coins', 6], ['clue', 1]], [['host', 2]]]], 'ひったくる', [['coins', 8], ['host', 4]], ['left'], 'ポケットの中身は、持ち主の記憶でもある。'),
  b(109, 'pay', '払う', ['public', 'trust'], ['INT'], 3, [['coins', -6], ['trust', 2]], '札束を見せる', [['coins', -12], ['trust', 3]], ['trusted'], '値段のつく話は早い。'),
  b(110, 'note', '書き留める', ['public', 'memory'], ['INT'], 3, [['note'], ['see']], '走り書き', [['note'], ['cost', 0, 1]], ['quiet'], '次の一手のために、いまを書いておく。', 'uncommon'),
  b(111, 'measure', '測る', ['place', 'gaze'], ['INT'], 3, [['see'], ['expose', 1]], '目測', [['expose', 2], ['cost', 0, 1]], ['newPlace'], '距離と角度。'),
  b(112, 'pray', '祈る', ['trust', 'time'], ['WIL'], 3, [['heal', 0, 3]], 'すがる', [['heal', 0, 2], ['cost', 1]], ['quiet'], '誰に、とは決めていない。'),
  b(113, 'shout', '怒鳴る', ['body', 'public'], ['ATK', 'WIL'], 3, [['break', { n: 3, s: 'ATK', m: 0.5 }], ['host', 2]], '喚く', [['break', { n: 5, s: 'ATK', m: 0.5 }], ['host', 3], ['trust', -2]], ['broken'], '声を大きくすれば、相手は小さくなる。たいていは。'),
  b(114, 'wait', '待つ', ['time'], ['WIL'], 4, [['cut', 3], ['calm', 2]], '待ちくたびれる', [['cut', 2], ['host', 1]], ['quiet'], '相手が先に動くのを。'),
  b(115, 'recall', '思い出す', ['memory'], ['WIL'], 2, [['heal', 0, { n: 1, per: 'memory' }]], '反芻', [['heal', 0, 2], ['cost', 1]], ['newPlace'], '同じ夜を、何度でも。'),
  b(116, 'call', '呼ぶ', ['person', 'night'], ['WIL'], 3, [['trust', 1], ['guard', 3]], '叫ぶ', [['guard', 4], ['host', 1]], ['trusted'], '呼べば、誰かが来る。来なくても。'),
  b(117, 'hide', '隠れる', ['place', 'night'], ['AGI'], 3, [['guard', 6]], '息を殺す', [['cost', 0, 1], ['leave']], ['left'], '暗がりは、いつも一歩先にある。'),
  b(118, 'vow', '誓う', ['trust', 'institution'], ['WIL'], 2, [['vow'], ['trust', 2]], '重ねて誓う', [['vow'], ['trust', 3], ['cost', 0, 1]], ['trusted'], '本当の約束。だから、破ると重い。', 'uncommon'),
  b(119, 'burn', '燃やす', ['tech', 'memory'], ['WIL'], 2, [['break', 4], ['cost', 0, 1]], '焼き捨てる', [['burnBad'], ['cost', 3]], ['broken'], '残しておきたくないものもある。', 'uncommon'),
  b(120, 'mimic', '真似る', ['person', 'gaze'], ['AGI'], 3, [['mimic', 0.7]], 'なりきる', [['mimic', 1], ['cost', 0, 2]], ['uncover'], '同じ手を、もう一度。今度は自分の手で。', 'uncommon'),
];
