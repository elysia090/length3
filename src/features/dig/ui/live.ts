import { ITEM_CAP } from '../content/gear';
import type { World } from '../core/model';
import { getLang, tr } from '../i18n';
import { maxHp, maxMind, stats } from '../sim/ops';
import { h } from './dom';
import { clock } from './words';

/**
 * 条件に今の値を添える。「体力が 1/3 を切っていれば」「深夜なら」「敵意 1 につき」のように
 * 体や時刻や相手の様子を呼ぶ文には、いまの値を括弧で一つだけ足す（「（いま 体力 26/28）」）。
 * 文そのものは辞書の形のまま訳したいので、添え書きは別の文として返す（無ければ空）。
 */
export function liveNote(text: string, w: World | null | undefined): string {
  if (!w || !text) return '';
  // 並びは「いま 3 手番目、23:00、体力 26/28」：場面（手番・時刻）が先、体の値、相手の様子の順。
  const out: string[] = [];
  const e = w.enc?.who === 'you' && w.enc.phase === 'act' ? w.enc : null;
  if (e && /手番目/.test(text)) out.push(`${e.turn + 1} 手番目`);
  if (/深夜|時を過ぎ|夜明け/.test(text)) out.push(clock(w.hour));
  const s = stats(w, 'you');
  if (/体力が[^。]*?(切|満ち|半分)/.test(text)) out.push(`体力 ${w.you.hp}/${maxHp(s)}`);
  if (/精神が[^。]*?(切|満ち|半分)/.test(text)) out.push(`精神 ${w.you.mind}/${maxMind(s)}`);
  if (e) {
    if (/敵意(が|) ?\d+ 以上|敵意 1 につき|敵意が高い/.test(text))
      out.push(`敵意は ${e.foe.hostility}`);
    if (/信頼が半ば/.test(text)) out.push(`信頼 ${e.foe.trust}/${e.foe.need}`);
    if (/手がかりが \d+ つ以上/.test(text))
      out.push(`手がかり ${e.foe.clues.filter((c) => c.shown).length}`);
  }
  if (/持ち物の空き/.test(text)) out.push(`空き ${Math.max(0, ITEM_CAP - w.you.items.length)}`);
  if (!out.length) return '';
  // 値は一つずつ訳して、括弧と区切りはその言葉の形で組む（まとめて訳すと型が値をまたいで当たる）。
  return getLang() === 'en'
    ? `(now ${out.map((x) => tr(x)).join(', ')})`
    : `（いま ${out.join('、')}）`;
}

/** 添え書きの小さな字（無ければ出さない）。 */
export const live = (text: string, w: World | null | undefined): HTMLElement | null => {
  const note = liveNote(text, w);
  return note ? h('span', { class: 'dig-live' }, note) : null;
};
