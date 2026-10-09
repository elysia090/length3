import type { AfterKind, Outcome } from '../core/model';
import type { PassiveSpec } from './defs';

/**
 * 決着の余韻。どう決着をつけたかが、この先の遭遇に大げさに尾を引く。四つの道は
 * 同じ「勝ち」ではなく、それぞれに得と癖がある（少しだけ不公平なくらいに）。
 *
 *   倒す       戦利品（金と品）。そのかわり悪名が先回りする（相手は荒れて構えている）
 *              が、勢いもついている（相手の体力を削る量 +3）
 *   折る       相手の名がエピテットとして落ちる。噂で、次の相手は怯えている
 *              （意志が三割削れて現れる）
 *   打ち解ける  味方がつく。遭遇の初めに守りと構えと信頼をくれ、倒れる一撃を
 *              一度だけ肩代わりする
 *   暴く       記憶を持ち帰る（前から）。しばらく相手が見透かせる（予告がいつも
 *              本当の姿で見え、手がかりが一つ見えている）
 *
 * 数えるのは遭遇の数（その遭遇の初めに効いて、一つ減る）。
 */
export interface AfterDef {
  kind: AfterKind;
  name: string;
  left: number;
  /** 決着の判の下に出る一文（これから何が起きるか）。 */
  text: string;
  /** 遭遇のあいだの規則。 */
  passive?: readonly PassiveSpec[];
}

export const AFTER: Readonly<Partial<Record<Outcome, AfterDef>>> = {
  beaten: {
    kind: 'notorious',
    name: '悪名',
    left: 3,
    text: '戦利品を漁った。次の三戦、悪名が先回りして相手は荒れているが、勢いのぶん相手の体力を削る量 +3。',
    passive: [
      { rule: 'startHostility', fn: (_c, v) => v + 2, text: '悪名：相手の敵意 +2' },
      {
        rule: 'hit',
        fn: (_c, v) => (v > 0 ? v + 3 : v),
        text: '悪名の勢い：相手の体力を削る量 +3',
      },
    ],
  },
  broken: {
    kind: 'feared',
    name: '畏れ',
    left: 3,
    text: '相手の名を奪った。次の三戦、噂を聞いた相手は意志が三割削れた状態で現れる。',
  },
  trusted: {
    kind: 'ally',
    name: '味方',
    left: 4,
    text: '味方がついた。次の四戦、初めに守り +4・構え +4・相手の信頼 +1。倒れる一撃を一度だけ肩代わりする。',
  },
  uncovered: {
    kind: 'insight',
    name: '見透かし',
    left: 3,
    text: '秘密を握った。次の三戦、相手の予告はいつも本当の姿で見え、手がかりが一つ見えている。',
    passive: [{ rule: 'intentVisible', fn: () => 1, text: '見透かし：予告が本当の姿で見える' }],
  },
};

export const afterDef = (kind: AfterKind): AfterDef | undefined =>
  Object.values(AFTER).find((a) => a?.kind === kind);
