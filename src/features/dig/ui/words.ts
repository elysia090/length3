import { sectionOf } from '../content/floors';
import { cardDef, epithetDef, foeDef, jobDef, permDef } from '../content/registry';
import type { Basic } from '../core/events';
import type { MapNode, World } from '../core/model';
import { ARCH_NAME, type Archetype, TAG_NAME } from '../core/tags';
import { clockOf } from '../core/time';
import { nodeHardness } from '../sim/hardness';
import { isBridge, isHall, nodeOf, ROWS } from '../sim/run';
import type { SpotAction } from '../sim/spot';
import { h } from './dom';

/** 画面の言葉：部屋・素手・共鳴の呼び名、時刻と階の数え方、台詞の選び方、行き方の言い方。 */

export const KIND_NAME: Record<MapNode['kind'], string> = {
  person: '人',
  danger: '危険',
  event: '出来事',
  rest: '食堂',
  shop: '古物商',
  boss: '最後の相手',
};

/** 札を使わない手が何をするか（触れると出る。効き目は四つの道にも映る）。 */
export const BASIC_GLOSS: Record<Basic, string> = {
  press: '相手の体力を少し削る（信頼は 1 下がる）',
  brace: '守りと構えを得る（次の一撃と脅しを受け止める）',
  talk: '相手の信頼を少し得る',
  leave: 'この遭遇から抜ける（うまくいけば）',
  accept: '相手の申し出を受ける',
};

export const BASIC_NAME: Record<Basic, string> = {
  press: '押す',
  brace: '構える',
  talk: '話す',
  leave: '立ち去る',
  accept: '応じる',
};

export const clock = (hour: number) => `${String(clockOf(hour)).padStart(2, '0')}:00`;

export const floorNo = (w: World, row: number) => (w.stratum - 1) * (ROWS + 1) + row + 1;

/** 体と心の割合を、言葉の目盛り（満ちている・擦れている・傷んでいる・尽きかけ）に。 */
export const band = (r: number): 0 | 1 | 2 | 3 =>
  r >= 0.75 ? 0 : r >= 0.45 ? 1 : r >= 0.2 ? 2 : 3;

/** 共鳴の段（灯りの数で、決着のときに受け取るもの）。 */
export const RES_STEPS: readonly [number, string][] = [
  [2, '金'],
  [3, '札の回数 +1'],
  [4, '札にエピテットが宿ることも'],
  [6, '体と心が戻る'],
];

/** 文の一つを、決まった鍵で選ぶ（描き直しても揺れないように）。 */
export const pickBy = <T>(list: readonly T[], key: string): T | undefined => {
  let x = 0;
  for (let i = 0; i < key.length; i++) x = (x * 31 + key.charCodeAt(i)) >>> 0;
  return list[x % Math.max(1, list.length)];
};

/** 声を一つ（種と場所と時刻から決まる。世界の乱数は使わない）。 */
export const voiceOf = (list: readonly string[], w: World, salt: string): string =>
  pickBy(list, `${w.seed}:${w.pos}:${w.hour}:${salt}`) ?? '';

/** 手持ちの中で、回数の尽きた札の数。 */
export const dryCount = (w: World) =>
  [...w.you.cards, ...w.you.back].filter((c) => c && c.uses <= 0).length;

export const whoOf = (n: MapNode) => (n.npc ? foeDef(n.npc).name : KIND_NAME[n.kind]);

/** そこへの行き方（廊下・渡り廊下・階段）と、かかる時間。どの画面でも同じ言い方で。 */
export function way(w: World, n: MapNode): { name: string; verb: string; hours: number } {
  const place = n.eps.reduce((a, e) => a + (epithetDef(e)?.place?.time ?? 0), 0);
  if (w.pos !== null && isBridge(w, n)) {
    const to = n.tower ? sectionOf(w.stratum).wing.name : '本棟';
    return { name: '渡り廊下', verb: `渡り廊下で${to}へ`, hours: Math.max(0, 2 + place) };
  }
  if (isHall(w, n)) return { name: '廊下', verb: '廊下を歩く', hours: Math.max(0, 1 + place) };
  return { name: '階段', verb: '下りる', hours: Math.max(0, 1 + place) };
}

export function firstStep(w: World, id: number | undefined): HTMLElement | null {
  if (id === undefined) return null;
  const n = nodeOf(w, id);
  if (!n) return null;
  return h('span', { class: 'dig-chip__step' }, `${way(w, n).name} → ${whoOf(n)}`);
}

/** その道の最初の一歩（行き方と、そこにいる人・ある物）。 */
export function stepLabel(w: World, id: number): string {
  const n = nodeOf(w, id);
  if (!n) return '進む';
  const hard = n.npc ? nodeHardness(w, n) : null;
  return `${way(w, n).verb}：${whoOf(n)}${hard !== null ? `　硬度 ${hard}` : ''}`;
}

export function lackText(l: { tag?: string; arch?: string; perm?: string; card?: string }): string {
  if (l.tag) return `［${TAG_NAME[l.tag as keyof typeof TAG_NAME]}］が 1 つ`;
  if (l.arch) return `〈${ARCH_NAME[l.arch as Archetype]}〉が 1 つ`;
  if (l.perm) return `記憶《${permDef(l.perm)?.name ?? l.perm}》`;
  if (l.card) return `『${cardDef(l.card).name}』`;
  return '何か';
}

export function persona(w: World): string {
  const arch: Record<string, number> = {};
  for (const c of w.you.cards)
    for (const a of c ? (cardDef(c.id).arch ?? []) : []) arch[a] = (arch[a] ?? 0) + 1;
  const top = Object.entries(arch).sort((a, b) => b[1] - a[1])[0]?.[0] as Archetype | undefined;
  const outcomes: Record<string, number> = {};
  for (const m of Object.values(w.minds))
    for (const [k, v] of Object.entries(m.outcomes)) outcomes[k] = (outcomes[k] ?? 0) + (v ?? 0);
  const memory = w.you.perms.find((p) => p !== 'promise' && !permDef(p)?.bad);
  return [
    jobDef(w.you.job)?.name,
    top ? ARCH_NAME[top] : null,
    ...w.you.titles.map((id) => epithetDef(id)?.name),
    memory ? permDef(memory)?.name : null,
    `${outcomes.trusted ?? 0} 人と打ち解けた`,
    `${(outcomes.left ?? 0) + (outcomes.fled ?? 0)} 件 未解決`,
  ]
    .filter(Boolean)
    .join(' / ');
}

/** エピテットの効き方を、刻む先ごとに（札・人・場所・出来事・記憶）。 */
export function facetLines(ep: string): string {
  const d = epithetDef(ep);
  if (!d) return '';
  return [
    d.gloss,
    d.card ? `札：${d.card.text}` : '',
    d.foe ? `人：${d.foe.text}` : '',
    d.place ? `場所：${d.place.text}` : '',
    d.story ? `出来事：${d.story.text}` : '',
    d.memory ? `記憶：${d.memory.text}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * その場で：いまの具合から、効く順に組み立てた一行ずつ（多くて四つ）。どの行も
 * 押せばそのまま起きる。それ以外の持ち物は、左の欄を手札にすれば全部ある。
 */
export const SPOT_VERB: Record<SpotAction['kind'], string> = {
  rest: '休む',
  fill: '満たす',
  ink: '刻む',
  prep: '備える',
  seek: '探る',
};

/**
 * 並びは、休む（満たすも）→ 備える → 探る。道を選ぶと、その道に効くもの
 * （その道の相手への備え、その道で尽きる札を満たすもの、傷の深い道なら休む）が
 * 琥珀の枠になって上へ動く。道を変えれば、また入れ替わる。
 */
export const SPOT_ORDER: Record<SpotAction['kind'], number> = {
  rest: 0,
  fill: 0,
  ink: 1,
  prep: 1,
  seek: 2,
};
