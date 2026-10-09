import { gearOf } from '../content/gear';
import { cardDef, foeDef } from '../content/registry';
import type { Cmd } from '../core/events';
import type { Card, World } from '../core/model';
import { nodeHardness, outmatched, youHardness } from './hardness';
import { maxHp, maxMind, stats } from './ops';
import { breathed, reachable } from './run';

/**
 * その場で：いま、ここでできることを、効く順に並べる。持ち物の一覧を見せるの
 * ではなく、いまの具合（体と心の減り、尽きた札、次の部屋の相手、手元の
 * エピテット）から「何をすれば、何が戻る・備わるか」を一行ずつ組み立てる。
 *
 *   休む   体と心が減っていれば、癒やす品・一服を、戻る量つきで
 *   満たす  尽きた・減った札があれば、合う品で、その札の名と回数つきで
 *   刻む   回数を増やす言葉があれば、いちばん減っている札に
 *   備える  次の部屋に人がいれば、備えの品を、相手の名と硬さつきで
 *   探る   手が空いていれば、道具で、その階を
 *
 * 点（score）は、いま使う値打ちの見積もり。低いものは出さない。
 */
export interface SpotAction {
  cmd: Cmd;
  /** 何をするか（品の名と、相手の札・人）。 */
  label: string;
  /** 何が戻る・備わるか（数つき）。 */
  gain: string;
  kind: 'rest' | 'fill' | 'ink' | 'prep' | 'seek';
  score: number;
}

const all = (w: World): Card[] => [...w.you.cards.filter((c): c is Card => !!c), ...w.you.back];

/** refill と同じ選び方で、満たされる札（タグの合う、いちばん減っている札）。 */
function refillTarget(w: World, tags: readonly string[]): Card | undefined {
  let best: Card | undefined;
  for (const c of all(w)) {
    if (c.uses >= c.max) continue;
    if (tags.length && !cardDef(c.id).tags.some((t) => tags.includes(t))) continue;
    if (!best || c.max - c.uses > best.max - best.uses) best = c;
  }
  return best;
}

export function spotActions(w: World): SpotAction[] {
  if (w.enc || w.ending) return [];
  const out: SpotAction[] = [];
  const s = stats(w, 'you');
  const hpGap = maxHp(s) - w.you.hp;
  const mindGap = maxMind(s) - w.you.mind;
  const hpLow = 1 - w.you.hp / maxHp(s);
  const mindLow = 1 - w.you.mind / maxMind(s);
  const free = !w.pending;
  // 次の部屋の相手（いちばん手強い人）。
  const next = free ? reachable(w).filter((n) => !!n.npc) : [];
  const you = youHardness(w);
  const foe = next
    .map((n) => ({ n, hard: nodeHardness(w, n) ?? 0 }))
    .sort((a, b) => b.hard - a.hard)[0];
  const preparing = (w.you.prep ?? []).length > 0;

  if (free && !breathed(w) && (hpLow > 0.3 || mindLow > 0.3)) {
    const hp = Math.min(hpGap, Math.round(maxHp(s) * 0.1));
    const mind = Math.min(mindGap, Math.round(maxMind(s) * 0.1));
    out.push({
      cmd: { c: 'breather' },
      label: '壁にもたれて一服',
      gain: [hp ? `体力 +${hp}` : '', mind ? `精神 +${mind}` : '', '1 時間']
        .filter(Boolean)
        .join('・'),
      kind: 'rest',
      score: 2 + 6 * Math.max(hpLow, mindLow),
    });
  }

  w.you.items.forEach((it, index) => {
    const g = gearOf(it.id);
    if (!g) return;
    const left = it.uses > 1 ? `（あと ${it.uses} 回）` : '';
    if (g.kind === 'rest') {
      const hp = Math.min(g.heal?.hp ?? 0, hpGap);
      const mind = Math.min(g.heal?.mind ?? 0, mindGap);
      const target = g.refill ? refillTarget(w, g.refill.tags) : undefined;
      const fill = target ? Math.min(g.refill?.n ?? 0, target.max - target.uses) : 0;
      // 満たすのは、尽きたか半分を切った札だけ（一つ足りないくらいなら、まだ要らない）。
      if (target && fill > 0 && target.uses * 2 <= target.max) {
        const name = cardDef(target.id).name;
        out.push({
          cmd: { c: 'item', index },
          label: `『${name}』に${g.name}${left}`,
          gain: `回数 ${target.uses}/${target.max} → ${target.uses + fill}/${target.max}${mind > 0 ? `・精神 +${mind}` : ''}`,
          kind: 'fill',
          score: (target.uses <= 0 ? 7 : 3) + fill + mind / 4,
        });
      } else if (hp > 0 || mind > 0) {
        const want = hp / Math.max(1, g.heal?.hp ?? 1) + mind / Math.max(1, g.heal?.mind ?? 1);
        out.push({
          cmd: { c: 'item', index },
          label: `${g.name}${left}`,
          gain: [hp ? `体力 +${hp}` : '', mind ? `精神 +${mind}` : ''].filter(Boolean).join('・'),
          kind: 'rest',
          // 減りが大きいほど、無駄なく効くほど上に。
          score: 1 + 7 * Math.max(hpLow, mindLow) * Math.min(1, want),
        });
      }
    } else if (g.kind === 'prep' && foe && !preparing) {
      const name = foeDef(foe.n.npc ?? '').name;
      const tough = outmatched(foe.hard, you) || foe.hard > you;
      out.push({
        cmd: { c: 'item', index },
        label: `${name}に${g.name}${left}`,
        gain: g.text.replace(/^次の相手/, `${name}`),
        kind: 'prep',
        score: tough ? 6 : 3,
      });
    } else if (g.kind === 'seek' && free && !out.some((a) => a.kind === 'seek')) {
      out.push({
        cmd: { c: 'item', index },
        label: `${g.tool ? `「${g.name}」` : g.name}${left}`,
        gain:
          g.seek && g.seek.story >= 0.5
            ? '出来事が起きやすい・1 時間'
            : g.seek && g.seek.find >= 0.5
              ? '何か見つかりやすい・1 時間'
              : '何かが起きるかもしれない・1 時間',
        kind: 'seek',
        score: 2 + (w.you.items.length >= 6 ? 1 : 0),
      });
    }
  });

  return out.filter((a) => a.score >= 2).sort((a, b) => b.score - a.score);
}
