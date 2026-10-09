import { AFTER } from '../content/after';
import { WORK_ARCH } from '../content/archetypes';
import { DATA_VERSION, PACE } from '../content/balance';
import { memoryMods, tagCount } from '../content/cardinfo';
import type { CardDef } from '../content/defs';
import { EXTRA_AUTO, FLOOR_EGGS } from '../content/eggs';
import { poolEpithets } from '../content/epithets';
import { ARRIVE, AUTO } from '../content/flavor';
import {
  BEATS,
  type FloorUse,
  heatOf,
  LAST,
  SECTIONS,
  sectionName,
  sectionNo,
  sectionOf,
  THEMES,
  useOf,
} from '../content/floors';
import { holds, run as runFx } from '../content/fx';
import { allTools, type Gear, gearOf, ITEM_CAP } from '../content/gear';
import { LAWS, lawsAt } from '../content/laws';
import { LEGENDS } from '../content/legends';
import { type OrderDef, orderOf } from '../content/orders';
import {
  defaultSheet,
  JOB_EPITHETS,
  JOB_ITEMS,
  ORIGINS,
  type Sheet,
  START_CARDS,
} from '../content/origins';
import { QUIRKS, quirkDef } from '../content/quirks';
import {
  allBuilds,
  allCards,
  allCombos,
  allFoes,
  allItems,
  allStories,
  cardDef,
  epithetDef,
  foeDef,
  itemDef,
  jobDef,
  permDef,
  storyDef,
} from '../content/registry';
import { buildsOf } from '../content/sources';
import { SURGES, tierOf } from '../content/surges';
import { earnTitle, titleDef } from '../content/titles';
import { branch } from '../core/branch';
import type { RestAction } from '../core/events';
import {
  blankMind,
  type Card,
  type Char,
  type MapNode,
  type Mind,
  type Outcome,
  STATS,
  type Stat,
  type Who,
  type World,
  zeroStats,
} from '../core/model';
import { ask } from '../core/rules';
import { meets, type Tag } from '../core/tags';
import type { Tx } from '../core/tx';
import { Tx as TxClass } from '../core/tx';
import { autoPlay } from './ai';
import { cardsAfter, resonate, rewards, shiftAll, startEnc, transform } from './encounter';
import { youHardness } from './hardness';
import { misses } from './near';
import {
  cardAt,
  charOf,
  coins,
  epUses,
  findCard,
  gainPerm,
  giveItem,
  heal,
  itemRoom,
  losePerm,
  markEp,
  maxHp,
  maxMind,
  refill,
  refillOne,
  settle,
  stats,
  xp,
} from './ops';

/**
 * 挑戦。三つの層を一夜ずつ下りる（22 時に始まり、6 時に夜が明ける）。
 * 段を進むたびに 1 時間。遅いほど相手は荒れている。
 */

export const ROWS = PACE.rows;
export const DAWN = PACE.dawn;
/** 区画の呼び名（三つ目より下は「深い」「底の」）。 */
export const stratumName = sectionName;

// ─── 人物を作る ───────────────────────────────────────────────

export function newCard(uid: number, id: string, eps: string[] = []): Card {
  const n = cardDef(id).uses + epUses(eps);
  return { uid, id, uses: n, max: n, marks: {}, eps };
}

/** 挑戦の初めに後ろへ配る札の数。 */
export const START_BACK = 2;
/** 持てる札の上限（枠と後ろを合わせて）。 */
export const DECK_MAX = 7;

/**
 * 持てる札の数。どの職でも七枚で、増えない（遭遇のたびに五枚が配られ、二枚は
 * 出番がない）。拾うたびに一枚を手放すので、何を残すかが毎回の判断になる。
 */
export const deckCap = (_c: Char): number => DECK_MAX;
/** いま持っている札の数（枠と後ろ）。 */
export const deckSize = (c: Char): number => c.cards.filter(Boolean).length + c.back.length;
/** もう一枚持てるか。 */
export const deckRoom = (c: Char): boolean => deckSize(c) < deckCap(c);

/** 札を手持ちに加える（空いた枠があれば枠へ、なければ後ろへ）。持てなければ false。 */
export function addCard(
  tx: Tx,
  id: string,
  why: string,
  who: Who = 'you',
  eps: readonly string[] = [],
): boolean {
  const c = charOf(tx.w, who);
  const at = c.cards.findIndex((x) => !x);
  if (at >= 0) {
    tx.emit({ type: 'card.set', who, slot: at, card: newCard(c.uid, id, [...eps]), why });
    return true;
  }
  if (!deckRoom(c)) return false;
  tx.emit({ type: 'deck.add', who, card: newCard(c.uid, id, [...eps]) });
  return true;
}

/**
 * もう一枚持てるようにする。余地があればそのまま。いっぱいなら、drop の札
 * （uid）を手放す（枠の札でも、後ろの札でも）。手放す札が無ければ false。
 */
export function makeRoom(tx: Tx, drop?: number): boolean {
  const c = tx.w.you;
  if (deckRoom(c) || c.cards.some((x) => !x)) return true;
  if (drop === undefined) return false;
  const slot = c.cards.findIndex((x) => x?.uid === drop);
  const index = c.back.findIndex((x) => x.uid === drop);
  const gone = slot >= 0 ? c.cards[slot] : c.back[index];
  if (!gone) return false;
  if (slot >= 0) tx.emit({ type: 'card.set', who: 'you', slot, card: null, why: 'dropped' });
  else tx.emit({ type: 'deck.drop', who: 'you', index });
  tx.emit({ type: 'note', text: `『${cardDef(gone.id).name}』を手放した。`, level: 1 });
  return true;
}

/**
 * 向き合っているあいだに回数の尽きた枠の札を、回数のある後ろの札と入れ替える
 * （空いた枠も埋める）。入れ替えは必ず知らせる（黙って消えない）。回数のある札が
 * 後ろに無ければ、尽きた札はそのまま枠に残る。
 */
function rotate(tx: Tx, who: Who): void {
  const w = tx.w;
  const c = charOf(w, who);
  c.cards.forEach((card, slot) => {
    if (card && card.uses > 0) return;
    const index = c.back.findIndex((b) => b.uses > 0);
    if (index < 0) return;
    const inn = c.back[index];
    if (!inn) return;
    tx.emit({ type: 'deck.swap', who, slot, index, out: card?.id, inn: inn.id });
    const e = w.enc;
    // 眠りぎわ：向き合っているあいだに尽きた札は、後ろへ回るときに休眠の顔を一度だけ見せる。
    if (card && e && e.who === who && e.phase === 'act') {
      const def = cardDef(card.id);
      if (def.spent.length) {
        runFx(tx, def.spent, { mult: 1, card: card.id, slot, first: false });
        settle(tx);
      }
    }
    if (who === 'you')
      tx.emit({
        type: 'note',
        text: card
          ? `『${cardDef(card.id).name}』を使い切った。後ろの『${cardDef(inn.id).name}』と入れ替える。`
          : `『${cardDef(inn.id).name}』が前へ。`,
        level: 0,
      });
  });
}

/** 地力が新しい高さに届いたことを覚えておく（届いた高さは、上の帯の硬度で見える）。 */
function levelUp(tx: Tx): void {
  const hd = youHardness(tx.w);
  if (hd > (tx.w.flags.peak ?? 0)) tx.emit({ type: 'flag', key: 'peak', v: hd });
}

export function makeChar(job: string, name: string, carry?: string, sheet: Sheet = {}): Char {
  const j = jobDef(job) ?? jobDef('surveyor');
  if (!j) throw new Error('no job');
  const pick = { ...defaultSheet(j.id), ...sheet };
  const origins = ORIGINS[j.id] ?? [];
  const origin = origins.includes(pick.origin) ? pick.origin : (origins[0] ?? '');
  const ep = (JOB_EPITHETS[j.id] ?? []).includes(pick.ep) ? pick.ep : null;
  const item = (JOB_ITEMS[j.id] ?? []).includes(pick.item) ? pick.item : 'bandage';
  const c: Char = {
    name,
    job: j.id,
    innate: { ...j.innate },
    growth: zeroStats(),
    xp: zeroStats(),
    hp: 0,
    mind: 0,
    coins: 30,
    items: [{ id: item, uses: gearOf(item)?.uses ?? 1 }],
    // 初めは 3 枚。残りの枠は空いている（拾って埋める）。
    // 職の五枚が枠に入る。後ろの札は、挑戦の初めに配る（start）。
    cards: [0, 1, 2, 3, 4].map((i) => {
      const id = j.cards[i];
      return id ? newCard(i + 1, id) : null;
    }),
    back: [],
    prep: [],
    level: 0,
    perms: [...new Set(['promise', origin].filter(Boolean))],
    permEps: {},
    epithets: ep ? [ep] : [],
    debts: {},
    deeds: {},
    titles: [],
    uid: 6,
  };
  if (carry && permDef(carry) && !c.perms.includes(carry)) c.perms.push(carry);
  const s = statsOfChar(c);
  c.hp = maxHp(s);
  c.mind = maxMind(s);
  return c;
}

function statsOfChar(c: Char) {
  const out = zeroStats();
  for (const s of STATS) out[s] = c.innate[s] + c.growth[s];
  for (const id of c.perms) {
    const d = permDef(id);
    const k = memoryMods(c, id);
    for (const s of STATS) out[s] += Math.round((d?.mods?.[s] ?? 0) * k);
  }
  return out;
}

// ─── 地図 ─────────────────────────────────────────────────────

function buildMap(tx: Tx, stratum: number): void {
  const sec = sectionOf(stratum);
  if (!sec) return;
  const rows: MapNode[][] = [];
  const nodes: MapNode[] = [];
  let id = 0;
  // フロアの用途を並べる（隣り合うフロアは同じ用途にしない）。
  const deck = [...sec.uses];
  const uses: FloorUse[] = [];
  for (let row = 0; row < ROWS; row++) {
    if (!deck.length) deck.push(...sec.uses.filter((u) => u.id !== uses.at(-1)?.id));
    const [u] = deck.splice(Math.floor(tx.rand('map') * deck.length), 1);
    if (u) uses.push(u);
  }
  const everyone = [...new Set(sec.uses.flatMap((u) => u.people))];
  for (let row = 0; row < ROWS; row++) {
    const beat = BEATS[row] ?? BEATS[0];
    const use = uses[row] ?? sec.uses[0];
    if (!beat || !use) continue;
    // 拍子の部屋を、左右の並びだけ混ぜる（安全と冒険の位置は毎回変わる）。
    const kinds = tx.shuffle('map', beat.rooms);
    const list: MapNode[] = [];
    kinds.forEach((k, col) => {
      let kind: MapNode['kind'] =
        k === '?'
          ? tx.rand('map') < 0.35 + sec.danger * 2 && use.danger.length
            ? 'danger'
            : 'person'
          : k;
      if (kind === 'danger' && !use.danger.length) kind = 'person';
      const node: MapNode = {
        id: id++,
        row,
        col,
        kind,
        next: [],
        visited: false,
        eps: [],
        use: use.id,
      };
      if (kind === 'person') node.npc = tx.pick('map', use.people.length ? use.people : everyone);
      if (kind === 'danger') node.npc = tx.pick('map', use.danger);
      // 見せ場は、そのフロアの用途で決まる（喫茶なら［夜・人物］）。
      if (node.npc && tx.rand('map') < beat.stage) node.stage = [...use.stage];
      // 場所のエピテットも用途から（人のいる部屋は人物の面、いない部屋は場所の面が働く）。
      if (tx.rand('map') < 0.25 + 0.1 * stratum) {
        const e = tx.pick(
          'map',
          use.eps.filter((x) => (node.npc ? !!epithetDef(x)?.foe : !!epithetDef(x)?.place)),
        );
        if (e && !(epithetDef(e)?.place?.empty && (kind === 'rest' || kind === 'shop')))
          node.eps.push(e);
      }
      list.push(node);
      nodes.push(node);
    });
    rows.push(list);
  }
  const boss: MapNode = {
    id: id++,
    row: ROWS,
    col: 0,
    kind: 'boss',
    npc: sec.boss.people[0],
    next: [],
    visited: false,
    eps: [],
    stage: [...sec.boss.stage],
    use: sec.boss.id,
  };
  nodes.push(boss);
  for (let row = 0; row < ROWS; row++) {
    const here = rows[row] ?? [];
    const there = rows[row + 1];
    for (const n of here) {
      if (!there) {
        n.next = [boss.id];
        continue;
      }
      const target = Math.round(
        (n.col / Math.max(1, here.length - 1)) * Math.max(1, there.length - 1),
      );
      n.next = there
        .filter(
          (m) =>
            Math.abs(m.col - target) === 0 ||
            (Math.abs(m.col - target) === 1 && tx.rand('map') < 0.6),
        )
        .map((m) => m.id);
      if (n.next.length === 0) n.next = [there[Math.min(there.length - 1, target)]?.id ?? 0];
    }
    if (there) {
      for (const m of there) {
        if (!here.some((n) => n.next.includes(m.id))) {
          const from =
            here[
              Math.min(
                here.length - 1,
                Math.round((m.col / Math.max(1, there.length - 1)) * (here.length - 1)),
              )
            ];
          from?.next.push(m.id);
        }
      }
    }
  }
  // 渡り廊下。区画に一度か二度、隣の塔へ渡れる部屋がある。隣の塔は二フロアだけ
  // 下りて、本棟の下のフロアへ戻ってくる（戻り先は選べない）。
  const starts = sec.wing.bridges >= 2 ? [1, 4] : [tx.int('map', 1, 4)];
  for (const r of starts) {
    const from = tx.pick(
      'map',
      (rows[r] ?? []).filter((n) => n.kind !== 'rest'),
    );
    const back = rows[r + 3] ?? [];
    const [ua, ub] = sec.wing.uses;
    if (!from || !back.length || !ua || !ub) continue;
    const side = tx.rand('map') < 0.5 ? -1 : 1;
    const room = (row: number, use: FloorUse): MapNode => {
      const npc = use.people.length ? tx.pick('map', use.people) : undefined;
      const n: MapNode = {
        id: id++,
        row,
        col: 0,
        kind: npc ? 'person' : 'shop',
        next: [],
        visited: false,
        eps: [],
        use: use.id,
        tower: side,
      };
      if (npc) {
        n.npc = npc;
        n.stage = [...use.stage];
      }
      const e = tx.pick(
        'map',
        use.eps.filter((x) => (npc ? !!epithetDef(x)?.foe : !!epithetDef(x)?.place)),
      );
      if (e && tx.rand('map') < 0.6 && !epithetDef(e)?.place?.empty) n.eps.push(e);
      return n;
    };
    const a = room(r + 1, ua);
    const b = room(r + 2, ub);
    from.next.push(a.id);
    a.next = [b.id];
    b.next = back.filter((_, i) => i === 0 || tx.rand('map') < 0.5).map((n) => n.id);
    nodes.push(a, b);
  }
  // 階の癖。入口の階と最後の相手の階を除いて、三つに一つほど。隣り合う階は同じ癖にしない。
  let prevQuirk: string | undefined;
  for (let row = 1; row < ROWS; row++) {
    if (tx.rand('map') >= PACE.quirk) {
      prevQuirk = undefined;
      continue;
    }
    const q = tx.pick(
      'map',
      QUIRKS.filter((x) => x.id !== prevQuirk),
    );
    prevQuirk = q?.id;
    if (q) for (const n of nodes) if (n.row === row && n.kind !== 'boss') n.quirk = q.id;
  }
  tx.emit({ type: 'map.built', stratum, nodes });
}

export const nodeOf = (w: World, id: number | null) =>
  id === null ? undefined : w.map.find((n) => n.id === id);

/**
 * 行ける部屋。下のフロアへの階段と、同じフロアの廊下（隣の、まだ入っていない
 * 部屋）。廊下を歩くと、下りずに時間だけが過ぎる（同じフロアの出来事と人物の
 * 両方を取れるが、夜明けが近づく）。
 */
export function reachable(w: World): MapNode[] {
  if (w.pending || w.enc || w.ending) return [];
  const here = nodeOf(w, w.pos);
  if (!here) return w.map.filter((n) => n.row === 0);
  const down = here.next.map((id) => nodeOf(w, id)).filter((n): n is MapNode => !!n);
  return [...lateral(w), ...down];
}

/** 同じフロアの、隣のまだ入っていない部屋。 */
export function lateral(w: World): MapNode[] {
  const here = nodeOf(w, w.pos);
  if (!here || here.kind === 'boss' || w.pending || w.enc || w.ending) return [];
  return w.map.filter(
    (n) =>
      n.row === here.row &&
      (n.tower ?? 0) === (here.tower ?? 0) &&
      Math.abs(n.col - here.col) === 1 &&
      !n.visited,
  );
}

/** その部屋へは廊下か（同じフロア）。 */
export const isHall = (w: World, n: MapNode) => nodeOf(w, w.pos)?.row === n.row;
/** その部屋へは渡り廊下か（塔が替わる）。 */
export const isBridge = (w: World, n: MapNode) => (nodeOf(w, w.pos)?.tower ?? 0) !== (n.tower ?? 0);

// ─── 始める ───────────────────────────────────────────────────

export function start(
  tx: Tx,
  seed: number,
  job: string,
  depth: number,
  carry?: string,
  remembered?: Record<string, Partial<Mind>>,
  sheet: Sheet = {},
): void {
  const you = makeChar(job, sheet.name ?? 'あなた', carry, sheet);
  if (depth >= 2 && !you.perms.includes('fear')) you.perms.push('fear');
  const others = [
    'surveyor',
    'watch',
    'projectionist',
    'reporter',
    'locksmith',
    'nurse',
    'welder',
  ].filter((j) => j !== job);
  const rj = others[Math.floor(((seed >>> 3) % 1000) / (1000 / others.length))] ?? 'watch';
  const rival = makeChar(rj, `${jobDef(rj)?.name ?? ''}の灯り持ち`);
  tx.emit({ type: 'run.started', seed, v: DATA_VERSION, depth, you, rival });
  tx.emit({
    type: 'rng',
    s: {
      map: seed ^ 0x1234,
      enc: seed ^ 0x5678,
      ai: seed ^ 0x9abc,
      story: seed ^ 0xdef0,
      rival: seed ^ 0x2468,
      gossip: seed ^ 0x1357,
      loot: seed ^ 0x8642,
    },
  });
  // 街は前の挑戦を覚えている。
  for (const [npc, m] of Object.entries(remembered ?? {})) {
    tx.emit({
      type: 'mind',
      npc,
      d: {
        heard: 1,
        violent: (m.violent ?? 0) / 2,
        kind: (m.kind ?? 0) / 2,
        nosy: (m.nosy ?? 0) / 2,
        grudge: m.grudge ?? 0,
        trust: m.trust ?? 0,
      },
    });
  }
  // 後ろの札を配る（作品から。職のタグに寄せて）と、道具を二つ。
  const jobTags = new Set(
    (jobDef(job)?.cards ?? []).flatMap((id) => cardDef(id).tags as readonly string[]),
  );
  const have = new Set(jobDef(job)?.cards ?? []);
  const works = allCards().filter(
    (d) =>
      d.layer === 'archetype' &&
      !d.retired &&
      !d.legend &&
      d.rarity !== 'rare' &&
      !have.has(d.id) &&
      d.tags.some((t) => jobTags.has(t)),
  );
  for (let k = 0; k < START_BACK && works.length; k++) {
    const i = Math.floor(tx.rand('loot') * works.length);
    const [d] = works.splice(i, 1);
    if (d) tx.emit({ type: 'deck.add', who: 'you', card: newCard(tx.w.you.uid, d.id) });
  }
  const tools = allTools().filter((id) => cardDef(id.slice(5)).tags.some((t) => jobTags.has(t)));
  for (let k = 0; k < 2 && tools.length; k++) {
    const [id] = tools.splice(Math.floor(tx.rand('loot') * tools.length), 1);
    if (id) tx.emit({ type: 'item', who: 'you', id, n: 1, uses: gearOf(id)?.uses });
  }
  buildMap(tx, 1);
  tx.emit({
    type: 'note',
    text: `22:00。${SECTIONS[1]?.open ?? ''}ずっと下のほうでは、${rival.name}の灯りがもう一つ揺れている。`,
    level: 2,
  });
  sync(tx);
}

// ─── 時間・噂・もう一人 ───────────────────────────────────────

function passTime(tx: Tx, hours: number): void {
  if (hours <= 0) return;
  tx.emit({ type: 'time', hours });
  for (let i = 0; i < hours; i++) {
    rivalStep(tx);
    gossip(tx);
  }
  // 締め切りはない。夜が明けて、昼が過ぎて、また夜になる。
}

/** 噂。あなたに会った人の像が、同じ層の別の人へ伝わる。 */
function gossip(tx: Tx): void {
  const w = tx.w;
  const known = Object.entries(w.minds).filter(([id, m]) => id !== 'rival' && m.met > 0);
  if (!known.length) return;
  const [from, m] = known[Math.floor(tx.rand('gossip') * known.length)] ?? [];
  if (!from || !m) return;
  const npcs = [...new Set(w.map.map((n) => n.npc).filter((x): x is string => !!x && x !== from))];
  const to = npcs[Math.floor(tx.rand('gossip') * npcs.length)];
  if (!to) return;
  if (tx.rand('gossip') * 100 >= ask(w, 'gossip', {}, 35)) return;
  tx.emit({
    type: 'gossip',
    from,
    to,
    d: {
      violent: m.violent / 2,
      kind: m.kind / 2,
      nosy: m.nosy / 2,
      honest: m.honest / 2,
      suspicion: m.suspicion / 2,
      cards: m.cards.slice(0, 2),
      known: m.known.slice(0, 2),
    },
  });
}

/** もう一人の灯り持ちが 1 時間ぶん進む。同じ規則で、遭遇を複製した世界で解く。 */
function rivalStep(tx: Tx): void {
  const w = tx.w;
  const rv = w.rival;
  // 試行（道の読み・予告）では、もう一人の歩みは止めておく。あなたの道の見積もりには
  // 効かないのに、相手の遭遇を丸ごと自動で戦わせると、読みの時間の四割を食う。
  if (tx.sim) return;
  if (rv.down || rv.stratum > w.stratum) return;
  if (rv.row < -1) {
    tx.emit({ type: 'rival', row: rv.row + 1 });
    return;
  }
  const ch = rv.char;
  const s = stats(w, 'rival');
  if (rv.stratum < w.stratum) {
    const row = rv.row + 1;
    tx.emit(
      row >= ROWS
        ? { type: 'rival', stratum: rv.stratum + 1, row: -1, node: null }
        : { type: 'rival', row },
    );
    return;
  }
  if (ch.hp < maxHp(s) * 0.4 || ch.mind < maxMind(s) * 0.35) {
    tx.emit({
      type: 'vital',
      who: 'rival',
      hp: Math.round(maxHp(s) * 0.35),
      mind: Math.round(maxMind(s) * 0.35),
    });
    refill(tx, 1, undefined, 'rival', true);
    return;
  }
  const here = rv.node === null ? undefined : nodeOf(w, rv.node);
  const options = here
    ? here.next.map((id) => nodeOf(w, id)).filter((n): n is MapNode => !!n && !n.tower)
    : w.map.filter((n) => n.row === 0);
  if (!options.length) return;
  const tired = ch.hp < maxHp(s) * 0.7;
  const want = (n: MapNode) =>
    (n.kind === 'person'
      ? 3
      : n.kind === 'danger'
        ? 2
        : n.kind === 'rest'
          ? tired
            ? 4
            : 0.5
          : n.kind === 'boss'
            ? 5
            : 1) -
    (n.visited ? 2 : 0) +
    tx.rand('rival');
  const target = options.reduce((a, b) => (want(b) > want(a) ? b : a));
  tx.emit({ type: 'rival', node: target.id, row: target.row });
  if (
    target.npc &&
    (target.kind !== 'boss' || true) &&
    !(target.visited && target.kind !== 'boss')
  ) {
    const outcome = rivalFight(
      tx,
      target.npc,
      target.kind === 'person' ? 'normal' : target.kind === 'boss' ? 'boss' : 'danger',
      target.eps,
      target.stage,
    );
    if (target.kind !== 'boss') tx.emit({ type: 'node', id: target.id, rival: outcome });
    tx.emit({ type: 'rival', log: `${foeDef(target.npc).name}：${OUTCOME_NAME[outcome]}` });
    if (outcome === 'fallen' || outcome === 'shattered') {
      const back = charOf(tx.w, 'rival');
      const s2 = stats(tx.w, 'rival');
      tx.emit({
        type: 'vital',
        who: 'rival',
        hp: Math.round(maxHp(s2) * 0.5) - back.hp,
        mind: Math.round(maxMind(s2) * 0.5) - back.mind,
      });
      tx.emit({ type: 'rival', row: rv.row - 1, node: null });
    }
  } else if (target.kind === 'rest') {
    tx.emit({
      type: 'vital',
      who: 'rival',
      hp: Math.min(maxHp(s) - ch.hp, Math.round(maxHp(s) * 0.4)),
      mind: Math.min(maxMind(s) - ch.mind, Math.round(maxMind(s) * 0.4)),
    });
    refill(tx, 1, undefined, 'rival', true);
    ch.cards.forEach((card, slot) => {
      if (!card) return;
      const care = cardDef(card.id).alter?.care;
      if (care && (card.marks.rested ?? 0) >= care.need)
        transform(tx, 'rival', slot, care.to, 'care');
    });
    tx.emit({ type: 'node', id: target.id, rival: 'passed' });
  } else tx.emit({ type: 'node', id: target.id, rival: 'passed' });
  if (target.kind === 'boss') {
    if (rv.stratum >= LAST) {
      tx.emit({ type: 'rival', down: true, first: !w.ending });
      if (!w.ending)
        tx.emit({ type: 'note', text: `${ch.name}の灯りが、先に底のほうへ消えた。`, level: 2 });
    } else tx.emit({ type: 'rival', stratum: rv.stratum + 1, row: -2, node: null });
  }
}

/**
 * 遭遇のあとに拾える札（3 枚から 1 枚）。職の手癖（職の残りの札）、
 * あと一つで成立するものの要素、下の層ほど珍しい札、で重みをつける。
 */
export function offerCards(tx: Tx, who: Who): string[] {
  const w = tx.w;
  const c = charOf(w, who);
  const have = new Set([...c.cards.map((x) => x?.id), ...c.back.map((x) => x.id)]);
  const tail = new Set(jobDef(c.job)?.cards.slice(START_CARDS) ?? []);
  const want = who === 'you' ? misses(w)[0]?.lack : undefined;
  const fits = (d: CardDef) =>
    !!want &&
    (want.tag
      ? d.tags.includes(want.tag)
      : want.arch
        ? (WORK_ARCH[d.id] ?? []).includes(want.arch)
        : d.id === want.card);
  const weight = (d: CardDef) =>
    (tail.has(d.id) ? 6 : 1) *
    (fits(d) ? 3 : 1) *
    (d.layer === 'basic'
      ? 0.8
      : d.rarity === 'rare'
        ? 0.2 + 0.2 * w.stratum
        : d.rarity === 'uncommon'
          ? 0.8
          : 1.2);
  const pool = allCards().filter((d) => d.layer === 'archetype' && !d.retired && !have.has(d.id));
  const out: string[] = [];
  for (let k = 0; k < 3 && pool.length; k++) {
    const total = pool.reduce((a, d) => a + weight(d), 0);
    let r = tx.rand('loot') * total;
    let i = 0;
    for (; i < pool.length - 1; i++) {
      r -= weight(pool[i] as CardDef);
      if (r < 0) break;
    }
    const [d] = pool.splice(i, 1);
    if (d) out.push(d.id);
  }
  return out;
}

/**
 * 拾い物。ときどき（六分ほど）、選択肢が一つ増える。どれも足し算だけで、
 * 何かを失うことはない（運に賭けさせるのではなく、運がよかったと思える一押し）。
 * 画面では「拾い物」の印で、ほかの選択肢と見分けがつく。
 */
function luckyCard(tx: Tx, have: readonly string[]): string | undefined {
  if (tx.rand('loot') >= PACE.whim) return undefined;
  const odd = allCards().filter(
    (d) => LEGENDS.some((l) => l.id === d.id) && !have.includes(d.id) && !d.retired,
  );
  const pick = tx.pick('loot', odd);
  if (pick)
    tx.emit({ type: 'note', text: '拾い物 ── 見慣れない札が一枚、まぎれている。', level: 1 });
  return pick?.id;
}

/** 拾い物（出来事）：妙な選択肢が一つ増えている。 */
function whimStory(tx: Tx): { odd?: boolean } {
  return tx.rand('story') < PACE.whim ? { odd: true } : {};
}

/** 妙な選択肢：黙って、灯りを落として待つ。何が起きるかは、待ってみないとわからない。 */
function oddChoice(tx: Tx, title: string, id: string): boolean {
  // 必ず何かを得る（精神と金は確実、三割で札の回数も）。
  heal(tx, 0, 4, 'you');
  coins(tx, 4, 'you');
  const more = tx.rand('story') < 0.3;
  if (more) refill(tx, 1, undefined, 'you');
  const text = more
    ? '灯りを落として待った。足元に硬貨が転がってきた。ついでに手札を見直した。'
    : '灯りを落として待った。足元に硬貨が転がってきた。頭も冷えた。';
  tx.emit({ type: 'story.seen', id });
  tx.emit({ type: 'note', text: `${title}：${text}`, level: 0 });
  tx.emit({ type: 'pending', p: { kind: 'told', id, ok: true, text } });
  sync(tx);
  return true;
}

/** 食堂の気まぐれ：店主が、伏せた札の表か裏かで賭けを持ちかける（一度だけ）。 */
function bet(tx: Tx): boolean {
  const p = tx.w.pending;
  if (p?.kind !== 'rest' || !p.bet) return false;
  // 負けのない賭け：表なら金、裏ならコーヒーを一杯（店主のおごり）。
  const win = tx.rand('loot') < 0.5;
  tx.emit({ type: 'pending', p: { ...p, bet: false } });
  if (win) {
    coins(tx, 10, 'you');
    tx.emit({ type: 'note', text: '表。店主は舌打ちして、硬貨を十枚よこした。', level: 2 });
  } else {
    heal(tx, 0, 5, 'you');
    tx.emit({ type: 'note', text: '裏。店主は笑って、コーヒーを一杯おごってくれた。', level: 2 });
  }
  return true;
}

function rivalFight(
  tx: Tx,
  npc: string,
  tier: 'normal' | 'danger' | 'boss',
  eps: readonly string[],
  stage?: readonly Tag[],
): Outcome {
  const sub = branch(tx.w);
  sub.enc = null;
  sub.pending = null;
  sub.rng = {
    ...sub.rng,
    enc: (tx.rand('rival') * 4294967296) >>> 0,
    ai: (tx.rand('rival') * 4294967296) >>> 0,
    story: (tx.rand('rival') * 4294967296) >>> 0,
  };
  const stx = new TxClass(sub, true);
  startEnc(stx, 'rival', npc, tier, { eps, stage });
  autoPlay(stx, 30);
  stx.flush();
  const e = sub.enc as World['enc'];
  const outcome: Outcome = e?.outcome ?? 'left';
  if (e) {
    cardsAfter(stx, 'rival', outcome, {
      cards: e.cards,
      lies: e.lies,
      caught: e.caught,
      hostility: e.foe.hostility,
    });
    rewards(stx, 'rival', npc, outcome);
    resonate(stx, 'rival');
    // もう一人も札を拾う（空いた枠があれば）。
    const empty = sub.rival.char.cards.findIndex((x) => !x);
    const pick = outcome === 'left' || outcome === 'fled' ? undefined : offerCards(stx, 'rival')[0];
    if (pick && empty >= 0)
      stx.emit({
        type: 'card.set',
        who: 'rival',
        slot: empty,
        card: newCard(sub.rival.char.uid, pick),
        why: 'picked',
      });
    if (outcome === 'uncovered') {
      const take = foeDef(npc).take.find((id) => !sub.rival.char.perms.includes(id));
      if (take) gainPerm(stx, take, npc, 'rival');
    }
  }
  tx.emit({ type: 'rival.char', char: sub.rival.char });
  return outcome;
}

export const OUTCOME_NAME: Record<Outcome, string> = {
  beaten: '倒した',
  broken: '折った',
  trusted: '打ち解けた',
  uncovered: '暴いた',
  left: '立ち去った',
  fled: '逃げられた',
  fallen: '倒れた',
  shattered: '心が崩れた',
};

// ─── 進む ─────────────────────────────────────────────────────

export function move(tx: Tx, id: number): boolean {
  const w = tx.w;
  const node = reachable(w).find((n) => n.id === id);
  if (!node) return false;
  const from = w.pos;
  const fromRow = nodeOf(w, from)?.row;
  const hall = isHall(w, node);
  const bridge = isBridge(w, node);
  tx.emit({ type: 'moved', node: node.id });
  // 癖のある階に着いたら、一度だけ名場面の帯で告げる。
  const q = quirkDef(node.quirk);
  if (q && fromRow !== node.row)
    tx.emit({
      type: 'note',
      text: `B${(w.stratum - 1) * (ROWS + 1) + node.row + 1}・${q.name} ── ${q.text}`,
      level: 3,
    });
  const use = useOf(w.stratum, node.use);
  if (hall) tx.emit({ type: 'note', text: '廊下を歩いて、隣の部屋へ。', level: 0 });
  else if (bridge)
    tx.emit({
      type: 'note',
      text: node.tower
        ? `渡り廊下で、${sectionOf(w.stratum).wing.name}へ。${use?.line ?? ''}`
        : '渡り廊下を戻って、本棟へ。',
      level: 1,
    });
  else if (use)
    tx.emit({
      type: 'note',
      // 着いたときの一文は、同じ部屋でも夜ごとに違う言い方で。
      text: `B${(w.stratum - 1) * (ROWS + 1) + node.row + 1}・${use.name}。${tx.pick('flavor', [use.line, ...(ARRIVE[use.id] ?? [])]) ?? use.line}`,
      level: 1,
    });
  // 決まった階の小ネタ（初めて着いたときだけ）。
  const egg = FLOOR_EGGS[(w.stratum - 1) * (ROWS + 1) + node.row + 1];
  if (egg && !hall && !node.visited) tx.emit({ type: 'note', text: egg.text, level: egg.level });
  tx.emit({ type: 'node', id: node.id, visited: true });
  // 着くのにかかる時間（場所のエピテットと、規則）。
  let hours = bridge ? 2 : 1;
  for (const e of node.eps) hours += epithetDef(e)?.place?.time ?? 0;
  if (node.eps.includes('closed') && w.you.perms.includes('shaft-key')) hours -= 2;
  passTime(
    tx,
    Math.max(0, Math.round(tx.rule('timeCost', { kind: hall ? 'walk' : 'move' }, hours))),
  );
  for (const e of node.eps) {
    const a = epithetDef(e)?.place?.arrive;
    if (a) {
      const y = w.you;
      tx.emit({
        type: 'vital',
        who: 'you',
        hp: -Math.min(y.hp - 1, a.hp ?? 0),
        mind: -Math.min(y.mind - 1, a.mind ?? 0),
      });
    }
  }
  if (!hall) happen(tx, node);
  // 新しい場所で戻るカード。
  w.you.cards.forEach((card, slot) => {
    if (card && cardDef(card.id).recover.on.includes('newPlace') && card.uses < card.max)
      tx.emit({ type: 'card.uses', who: 'you', slot, n: 1 });
  });
  const rv = w.rival;
  if (
    !rv.down &&
    rv.stratum === w.stratum &&
    rv.row === node.row &&
    // 夜の街（最初の区画）では見かけるだけで、鉢合わせない（基本を覚える区画）。
    w.stratum >= 2 &&
    node.row >= PACE.rivalFrom &&
    (w.flags[`met${w.stratum}`] ?? 0) === 0 &&
    node.kind !== 'boss'
  ) {
    tx.emit({ type: 'flag', key: `met${w.stratum}`, v: 1 });
    tx.emit({
      type: 'note',
      text: `${rv.char.name}と鉢合わせた。同じ階段を下りてきたらしい。`,
      level: 2,
    });
    tx.emit({
      type: 'pending',
      p: { kind: 'encounter', npc: 'rival', tier: 'rival', resume: node.id },
    });
    startEnc(tx, 'you', 'rival', 'rival', { rival: rv.char });
    return true;
  }
  enter(tx, node, from);
  return true;
}

/**
 * 下りた先でときどき起きる、選択のない小さな出来事（一挑戦に同じものは一度）。
 * 動く数はほんの少しで、理由は文の中に書いてある。
 */
function happen(tx: Tx, node: MapNode): void {
  const w = tx.w;
  if (tx.rand('flavor') >= PACE.auto) return;
  const pool = [...AUTO, ...EXTRA_AUTO].filter(
    (a) =>
      (!a.section || a.section === sectionNo(w.stratum)) &&
      (!a.use || (node.use !== undefined && a.use.includes(node.use))) &&
      !w.flags[`auto:${a.id}`],
  );
  const a = tx.pick('flavor', pool);
  if (!a) return;
  tx.emit({ type: 'flag', key: `auto:${a.id}`, v: 1 });
  tx.emit({ type: 'note', text: a.text, level: 2 });
  const fx = a.fx;
  if (!fx) return;
  if (fx.coins) coins(tx, fx.coins, 'you');
  if (fx.hp || fx.mind) {
    const y = w.you;
    const s = stats(w, 'you');
    const clamp = (n: number, now: number, max: number) =>
      n < 0 ? -Math.min(now - 1, -n) : Math.min(max - now, n);
    const hp = clamp(fx.hp ?? 0, y.hp, maxHp(s));
    const mind = clamp(fx.mind ?? 0, y.mind, maxMind(s));
    if (hp || mind) tx.emit({ type: 'vital', who: 'you', hp, mind });
  }
  if (fx.hour) passTime(tx, fx.hour);
}

function enter(tx: Tx, node: MapNode, from: number | null = null): void {
  const w = tx.w;
  // 最後の相手の扉の前で、一度だけ息を整える（体も心も、七割半までは戻る）。
  // 弱ったまま試験に入って、何もできずに崩れることがないように。
  if (node.kind === 'boss' && !w.flags[`gate:${w.stratum}`]) {
    tx.emit({ type: 'flag', key: `gate:${w.stratum}`, v: 1 });
    const s = stats(w, 'you');
    const dh = Math.max(0, Math.round(maxHp(s) * PACE.gate) - w.you.hp);
    const dm = Math.max(0, Math.round(maxMind(s) * PACE.gate) - w.you.mind);
    if (dh || dm) {
      tx.emit({ type: 'vital', who: 'you', hp: dh, mind: dm });
      tx.emit({ type: 'note', text: '扉の前で、息を整えた。', level: 1 });
    }
    // 区画の底に着いた（名場面の帯で、一度だけ）。
    const who = node.npc ? foeDef(node.npc).name : '最後の相手';
    tx.emit({
      type: 'note',
      text: `${'一二三四五六七八九'[w.stratum - 1] ?? w.stratum}の区画の底、B${(w.stratum - 1) * (ROWS + 1) + node.row + 1}。${who}が待っていた。`,
      level: 3,
    });
  }
  if (node.npc) {
    if (node.eps.some((e) => epithetDef(e)?.place?.empty) && node.kind !== 'boss') {
      tx.emit({ type: 'note', text: 'そこには、誰もいなかった。', level: 1 });
      return;
    }
    const tier = node.kind === 'person' ? 'normal' : node.kind === 'boss' ? 'boss' : 'danger';
    tx.emit({ type: 'pending', p: { kind: 'encounter', npc: node.npc, tier, back: from } });
    startEnc(tx, 'you', node.npc, tier, {
      stage: node.stage,
      eps: node.eps,
      after: node.rival && node.rival !== 'passed' ? node.rival : undefined,
    });
    return;
  }
  switch (node.kind) {
    case 'event': {
      if (w.flags.skipStory) {
        tx.emit({ type: 'flag', key: 'skipStory', v: 0 });
        tx.emit({
          type: 'note',
          text: '眠っているあいだに、そこには誰もいなくなっていた。',
          level: 1,
        });
        return;
      }
      const id = pickStory(tx);
      if (id)
        tx.emit({
          type: 'pending',
          p: {
            kind: 'story',
            id,
            eps: node.eps.filter((e) => !!epithetDef(e)?.story),
            ...whimStory(tx),
          },
        });
      return;
    }
    case 'rest':
      tx.emit({
        type: 'pending',
        p: { kind: 'rest', used: false, altered: false, bet: tx.rand('loot') < PACE.whim * 1.2 },
      });
      return;
    case 'shop': {
      const have = new Set(w.you.cards.map((c) => c?.id));
      const pool = allCards().filter(
        (d) =>
          d.layer === 'archetype' &&
          !d.retired &&
          !have.has(d.id) &&
          !d.alter?.care?.to?.startsWith('__'),
      );
      const cards: string[] = [];
      for (let i = 0; i < 3 && pool.length; i++) {
        const d = pool.splice(Math.floor(tx.rand('loot') * pool.length), 1)[0];
        if (d) cards.push(d.id);
      }
      if (node.rival) cards.pop();
      // 古物商は、あなたが探しているものを聞きつけている（あと一つの要素）。
      const want = misses(w)[0]?.lack;
      const fits = (d: (typeof pool)[number]) =>
        want?.tag
          ? d.tags.includes(want.tag)
          : want?.arch
            ? (WORK_ARCH[d.id] ?? []).includes(want.arch)
            : d.id === want?.card;
      if (want && !want.perm && tx.rand('loot') < 0.65) {
        const near = pool.filter(fits);
        const d = near[Math.floor(tx.rand('loot') * near.length)];
        if (d) cards.splice(0, 1, d.id);
      }
      const items = [
        ...tx
          .shuffle('loot', allItems())
          .slice(0, 3)
          .map((i) => i.id),
        ...tx.shuffle('loot', allTools()).slice(0, 2),
      ];
      const eps = tx
        .shuffle('loot', poolEpithets())
        .slice(0, 2)
        .map((e) => `ep:${e.id}`);
      const t = want?.tag;
      const tagEp = t
        ? poolEpithets().find((e) => e.card?.add?.includes(t) && !eps.includes(`ep:${e.id}`))
        : undefined;
      if (tagEp) eps.splice(0, 1, `ep:${tagEp.id}`);
      // 隣の塔の棚には、本棟では出回らない主役の札が一枚まざる。
      if (node.tower) {
        const stars = pool.filter(
          (d) => LEGENDS.some((l) => l.id === d.id) && !cards.includes(d.id),
        );
        const d = stars[Math.floor(tx.rand('loot') * stars.length)];
        if (d) cards.splice(cards.length - 1, 1, d.id);
      }
      // 拾い物：棚の一枚が、半値になっている。
      const bargain = tx.rand('loot') < PACE.whim ? tx.pick('loot', cards) : undefined;
      if (bargain)
        tx.emit({ type: 'note', text: '拾い物 ── 棚の一枚に、半値の札が下がっている。', level: 1 });
      tx.emit({
        type: 'pending',
        p: { kind: 'shop', cards, items: [...items, ...eps], sold: [], bargain },
      });
      return;
    }
    default:
      return;
  }
}

function pickStory(tx: Tx): string | null {
  const w = tx.w;
  if (Object.values(w.you.debts).some((n) => n > 0) && tx.rand('story') < 0.35) return 'favor-due';
  const open = w.unlocked.find(
    (id) => !w.seen.includes(id) && storyDef(id)?.strata.includes(w.stratum),
  );
  if (open) return open;
  const tags = tagCount(w.you);
  const pool = allStories().filter(
    (s) =>
      !s.locked &&
      s.strata.includes(w.stratum) &&
      !w.seen.includes(s.id) &&
      (!s.needTags || meets(tags, s.needTags)),
  );
  const pick = pool[Math.floor(tx.rand('story') * pool.length)];
  return pick?.id ?? null;
}

/** 一服。全カード +1（休ませて戻した、と数える）。逃走の系統は戻らない。1 時間。 */
/** このフロアで、もう一服したか。 */
export const breathed = (w: World): boolean =>
  (w.flags[`breath:${w.stratum}:${nodeOf(w, w.pos)?.row ?? -1}`] ?? 0) > 0;

/** 目押しの出来を、効き目の倍率に（外れ 0.6・良し 1・会心 1.5）。 */
export const knack = (q?: number): number => Math.min(1.5, Math.max(0.6, q ?? 1));

export function breather(tx: Tx, q?: number): void {
  const w = tx.w;
  const o = useOrder(tx, null, 'breather');
  tx.emit({ type: 'flag', key: `breath:${w.stratum}:${nodeOf(w, w.pos)?.row ?? -1}`, v: 1 });
  if (w.you.perms.includes('insomnia')) refill(tx, 1, undefined, 'you', true);
  const s = stats(w, 'you');
  const k = knack(q) * (o?.boost.heal ?? 1);
  heal(tx, Math.round(maxHp(s) * 0.1 * k), Math.round(maxMind(s) * 0.1 * k), 'you');
  careBonus(tx);
  shiftAll(tx, 'you');
  passTime(tx, Math.max(0, Math.round(tx.rule('timeCost', { kind: 'rest' }, 1))));
  tx.emit({ type: 'note', text: '壁にもたれて、一服した。', level: 0 });
}

/**
 * 隠し順序：直前に、同じ部屋で使ったものに続けて使うと、効き目が変わる。起きた
 * 順序を返し、いま使ったものを直前として覚える。初めて起きたときは隠し効果として
 * 明らかにし、二度目からは短く告げる。
 */
function useOrder(tx: Tx, g: Gear | null, id: string): OrderDef | undefined {
  const w = tx.w;
  const last = w.you.lastUse;
  const prev =
    last && last.at === w.pos
      ? last.id === 'breather'
        ? null
        : (gearOf(last.id) ?? undefined)
      : undefined;
  const o = orderOf(prev, g);
  tx.emit({ type: 'use.mark', id, at: w.pos });
  if (!o) return undefined;
  const key = `order:${o.id}`;
  if (!w.found.includes(key)) {
    tx.emit({ type: 'found', id: key });
    tx.emit({ type: 'say', who: 'voice', text: `隠し効果：${o.name}（${o.effect}）` });
  } else tx.emit({ type: 'note', text: `順番が効いた：${o.name}（${o.effect}）`, level: 1 });
  return o;
}

/** 古びた・未完のカードは、休ませたことを 2 倍に数える。 */
function careBonus(tx: Tx): void {
  tx.w.you.cards.forEach((card, slot) => {
    if (card?.eps.some((e) => epithetDef(e)?.card?.care))
      tx.emit({ type: 'card.mark', who: 'you', slot, mark: 'rested', n: 1 });
  });
}

export { ITEM_CAP };

/** 決着の見返りの品（道具ではない品から。重みは同じ）。 */
function lootItem(tx: Tx): string | undefined {
  return tx.pick('loot', allItems())?.id;
}

/**
 * 持ち物を一回使う。どれも向き合っていないとき（地図の上、受け取り・店・休憩所の
 * 最中も）に、「その場で」使う。休む品はその場で戻し、備える品は次の遭遇の初めに
 * 効く備えになり、探る品と道具は、その階を探る（出来事が起きるかもしれない）。
 */
export function useItem(tx: Tx, index: number, q?: number): boolean {
  const w = tx.w;
  const held = w.you.items[index];
  const g = held ? gearOf(held.id) : undefined;
  if (!g || !held || w.enc) return false;
  // 探るのは、地図の上で手の空いているときだけ（何かが起きるので）。
  if (g.kind === 'seek' && w.pending) return false;
  const o = useOrder(tx, g, held.id);
  tx.emit({ type: 'item.use', who: 'you', index });
  const left = held.uses > 1 ? `（あと ${held.uses - 1} 回）` : '';
  const k = knack(q);
  const how = k > 1 ? '会心。' : k < 1 ? '手元が狂った。' : '';
  if (g.kind === 'prep') {
    const mult = k * (1 + (o?.boost.mult ?? 0));
    tx.emit({ type: 'prep', who: 'you', name: g.name, fx: [...(g.prep ?? [])], mult });
    tx.emit({ type: 'note', text: `${how}${g.name}を手に、次の相手に備える。${left}`, level: 1 });
    return true;
  }
  if (g.kind === 'seek') {
    tx.emit({ type: 'note', text: `${how}${g.name}で、この階を探る。${left}`, level: 1 });
    const sk = g.seek ?? { story: 0.4, find: 0.3 };
    // 会心なら当たりやすく、気づかれない。外れなら当たりにくい。
    rummage(tx, {
      story: sk.story * k,
      find: sk.find * k + (o?.boost.find ?? 0),
      quiet: sk.quiet || k > 1 || !!o?.boost.quiet,
    });
    return true;
  }
  const s = stats(w, 'you');
  const kh = k * (o?.boost.heal ?? 1);
  const hp = Math.min(Math.round((g.heal?.hp ?? 0) * kh), maxHp(s) - w.you.hp);
  const mind = Math.min(Math.round((g.heal?.mind ?? 0) * kh), maxMind(s) - w.you.mind);
  if (hp > 0 || mind > 0)
    tx.emit({ type: 'vital', who: 'you', hp: Math.max(0, hp), mind: Math.max(0, mind) });
  if (g.refill) {
    const n = Math.max(1, Math.round(g.refill.n * k));
    if (g.refill.tags.length === 0) refill(tx, n, undefined, 'you');
    else for (const t of g.refill.tags) if (refill(tx, n, t as Tag, 'you')) break;
  }
  if (g.cost) {
    tx.emit({ type: 'after', after: { kind: 'crash', npc: '', left: g.cost } });
    tx.emit({
      type: 'note',
      text: `${how}${g.name}で持ち直した。次の ${g.cost} 戦、反動が残る。${left}`,
      level: 1,
    });
    return true;
  }
  tx.emit({ type: 'note', text: `${how}${g.name}を使った。${left}`, level: 1 });
  return true;
}

/**
 * その階を探る（1 時間）。出来事が起きるか、何かが見つかるか、物音で誰かに
 * 気づかれる（次の相手が身構える）。何も起きないこともある。
 */
function rummage(tx: Tx, seek: { story: number; find: number; quiet?: boolean }): void {
  const w = tx.w;
  passTime(tx, Math.max(0, Math.round(tx.rule('timeCost', { kind: 'rest' }, 1))));
  const r = tx.rand('story');
  if (r < seek.story && !w.flags.skipStory) {
    const id = pickStory(tx);
    if (id) {
      tx.emit({ type: 'note', text: '物陰で、何かが始まった。', level: 1 });
      tx.emit({ type: 'pending', p: { kind: 'story', id, eps: [], ...whimStory(tx) } });
      return;
    }
  }
  if (r < seek.story + seek.find) {
    const k = tx.rand('loot');
    const ep = k < 0.15 ? tx.pick('loot', poolEpithets()) : undefined;
    const item = !ep && k < 0.5 ? lootItem(tx) : undefined;
    if (ep) {
      tx.emit({ type: 'ep.held', who: 'you', ep: ep.id, n: 1 });
      tx.emit({ type: 'note', text: `床板の下に、《${ep.name}》が落ちていた。`, level: 2 });
    } else if (item) {
      tx.emit({ type: 'note', text: `${gearOf(item)?.name ?? item}を見つけた。`, level: 1 });
      giveItem(tx, item);
    } else {
      const n = 6 + 3 * w.stratum;
      coins(tx, n, 'you');
      tx.emit({ type: 'note', text: `引き出しの奥に、金が ${n} あった。`, level: 1 });
    }
    return;
  }
  if (!seek.quiet && tx.rand('story') < 0.5) {
    tx.emit({ type: 'prep', who: 'you', name: '物音', fx: [['host', 2]] });
    tx.emit({
      type: 'note',
      text: '物音に、誰かが気づいた。次の相手は、身構えて待っている。',
      level: 1,
    });
    return;
  }
  tx.emit({ type: 'note', text: '探して回ったが、何も起きなかった。', level: 0 });
}

// ─── 決着のあと ───────────────────────────────────────────────

export function close(tx: Tx): boolean {
  const w = tx.w;
  const e = w.enc;
  const p = w.pending;
  if (!e || e.phase !== 'over' || !e.outcome || p?.kind !== 'encounter') return false;
  const o = e.outcome;
  const node = nodeOf(w, w.pos);
  cardsAfter(tx, 'you', o, {
    cards: e.cards,
    lies: e.lies,
    caught: e.caught,
    hostility: e.foe.hostility,
  });
  // 最後の相手から退いたら、来た場所へ戻る。相手は傷を覚えている（再戦できる）。
  if (p.tier === 'boss' && (o === 'left' || o === 'fled')) {
    const lost = Math.round(100 * (1 - Math.max(0, e.foe.hp) / Math.max(1, e.foe.maxHp)));
    const key = `wound:${e.foe.id}`;
    if (lost > (w.flags[key] ?? 0)) tx.emit({ type: 'flag', key, v: lost });
    tx.emit({ type: 'enc.close' });
    tx.emit({ type: 'pending', p: null });
    tx.emit({ type: 'moved', node: p.back ?? null });
    passTime(tx, 1);
    tx.emit({ type: 'note', text: `退いた。${e.foe.name}は、あなたを覚えている。`, level: 2 });
    tx.emit({
      type: 'flag',
      key: `retreat:${w.stratum}`,
      v: (w.flags[`retreat:${w.stratum}`] ?? 0) + 1,
    });
    return true;
  }
  const notes = [...rewards(tx, 'you', e.foe.id, o, node?.rival), ...resonate(tx, 'you')];
  if (o === 'beaten') tx.emit({ type: 'flag', key: 'beaten', v: (w.flags.beaten ?? 0) + 1 });
  // 決着の余韻（どう決着をつけたかが、この先に大げさに尾を引く）。
  const aft = AFTER[o];
  if (aft) {
    tx.emit({ type: 'after', after: { kind: aft.kind, npc: e.foe.id, left: aft.left } });
    if (o === 'beaten') {
      // 戦利品：金と、品を一つ（持ちきれなければ金で）。
      const loot = 8 + 4 * w.stratum;
      coins(tx, loot, 'you');
      notes.push(`戦利品 金 ${loot}`);
      const id = tx.rand('loot') < PACE.lootBeaten ? lootItem(tx) : undefined;
      if (id && giveItem(tx, id)) notes.push(gearOf(id)?.name ?? id);
    } else if (o === 'broken' && tx.rand('loot') < PACE.epBroken) {
      // 相手の名を奪う：ときどき、エピテットが一つ落ちる（相手に刻まれていたものがあれば、それ）。
      const pool = poolEpithets().filter((x) => x.rarity !== 'rare');
      const ep = e.foe.eps[0] ?? tx.pick('loot', pool)?.id;
      if (ep) {
        tx.emit({ type: 'ep.held', who: 'you', ep, n: 1 });
        notes.push(`エピテット《${epithetDef(ep)?.name ?? ep}》`);
      }
    }
  }
  if (p.npc === 'rival') tx.emit({ type: 'flag', key: 'rivalMet', v: 1 });
  // 打ち解けたり暴いたりすると、エピテットを拾うことがある。
  if ((o === 'trusted' || o === 'uncovered') && tx.rand('loot') < PACE.epSoft) {
    const pool = poolEpithets();
    const ep = pool[Math.floor(tx.rand('loot') * pool.length)];
    if (ep) {
      tx.emit({ type: 'ep.held', who: 'you', ep: ep.id, n: 1 });
      notes.push(`エピテット《${ep.name}》`);
    }
  }
  const def = foeDef(e.foe.id);
  const takeFrom = p.npc === 'rival' ? e.foe.clues.map((c) => c.id) : def.take;
  const take =
    o === 'uncovered'
      ? takeFrom.filter(
          (id) =>
            e.foe.clues.some((c) => c.id === id && c.shown && !c.false) &&
            !w.you.perms.includes(id),
        )
      : [];
  const help = o === 'trusted' && (p.npc === 'rival' || !!def.rewards.trusted?.help);
  const boss = p.tier === 'boss';
  const npc = e.foe.id;
  tx.emit({ type: 'enc.close' });
  if (o === 'fallen' || o === 'shattered') {
    finish(tx, 'dead', o === 'fallen' ? '倒れた' : '心が崩れた');
    return true;
  }
  // 息を整える：体と心が底をついたまま次へ行かないように、少しだけ戻す。
  const s = stats(w, 'you');
  const hpFloor = Math.round(maxHp(s) * PACE.breath);
  const mindFloor = Math.round(maxMind(s) * PACE.breath);
  const dh = Math.max(0, hpFloor - w.you.hp);
  const dm = Math.max(0, mindFloor - w.you.mind);
  // 決着がつけば、半分ほどの割合で、その場で使える品を一つ（持てるのは ITEM_CAP まで）。
  if (o !== 'left' && o !== 'fled' && tx.rand('loot') < PACE.loot) {
    const id = lootItem(tx);
    if (id && giveItem(tx, id)) notes.push(itemDef(id)?.name ?? id);
  }
  if (notes.length) tx.emit({ type: 'note', text: `手に入れた：${notes.join('、')}`, level: 1 });
  if (dh || dm) {
    tx.emit({ type: 'vital', who: 'you', hp: dh, mind: dm });
    tx.emit({ type: 'note', text: '壁にもたれて、息を整えた。', level: 1 });
  }
  const settled = o !== 'left' && o !== 'fled';
  const offered = settled ? offerCards(tx, 'you').slice(0, 2) : [];
  // ときどき、エピテットが刻まれたままの札がまざる（強いが、手持ちを空けて悩む）。
  let inked: Record<string, string[]> | undefined;
  offered.forEach((id, k) => {
    if (tx.rand('loot') >= PACE.inked / (k + 1)) return;
    const pool = poolEpithets();
    const n = tx.rand('loot') < 0.2 ? 2 : 1;
    const eps = Array.from({ length: n }, () => tx.pick('loot', pool)?.id).filter(
      (x): x is string => !!x,
    );
    if (eps.length) inked = { ...inked, [id]: eps };
  });
  if (settled) selfMark(tx);
  tx.emit({
    type: 'pending',
    p: {
      kind: 'reward',
      npc,
      outcome: o,
      take,
      help,
      boss,
      resume: p.resume,
      // 作品の札を二枚と、道具を一つ。拾えるのはどれか一つ（手持ちがいっぱいなら、
      // 札は一枚手放して拾う）。
      cards: offered,
      tools: settled ? tx.shuffle('loot', allTools()).slice(0, 1) : [],
      inked,
      lucky:
        o === 'left' || o === 'fled'
          ? undefined
          : luckyCard(
              tx,
              w.you.cards.flatMap((c) => (c ? [c.id] : [])),
            ),
    },
  });
  sync(tx);
  return true;
}

export function claim(
  tx: Tx,
  cmd: { take?: string; help?: number; card?: string; drop?: number; tool?: string },
): boolean {
  const w = tx.w;
  const p = w.pending;
  if (p?.kind !== 'reward') return false;
  const { take, help, card, drop, tool } = cmd;
  // 拾えるのは、作品の札か道具のどちらか一つ。
  if (card && tool) return false;
  if (card && (p.cards.includes(card) || p.lucky === card)) {
    // 持てる数を超えるなら、代わりに一枚手放す（どれを手放すかは、あなたが選ぶ）。
    if (!makeRoom(tx, drop)) return false;
    addCard(tx, card, 'picked', 'you', p.inked?.[card] ?? []);
  }
  if (tool && p.tools.includes(tool)) {
    if (!itemRoom(w.you, tool)) return false;
    giveItem(tx, tool);
  }
  if (take && p.take.includes(take)) gainPerm(tx, take, p.npc, 'you');
  if (help !== undefined && p.help) {
    const card = w.you.cards[help];
    if (card && card.uses < card.max) {
      tx.emit({ type: 'card.uses', who: 'you', slot: help, n: card.max - card.uses });
      const mercy = buildsOf(w.you).some((b) => b.id === 'miserables');
      if (!mercy) tx.emit({ type: 'debt', who: 'you', npc: p.npc, n: 1 });
      tx.emit({
        type: 'note',
        text: `${foeDef(p.npc).name}に頼って《${cardDef(card.id).name}》を回復させた。${mercy ? '借りは、なかったことにされた。' : '借りができた。'}`,
        level: 2,
      });
    }
  }
  tx.emit({ type: 'pending', p: null });
  if (p.boss) {
    if (w.stratum >= LAST) {
      // 底の手前を抜けた。抜けたことは、ここで決まる（この先で倒れても消えない）。
      crown(tx);
      if (!w.flags.cleared) {
        tx.emit({ type: 'flag', key: 'cleared', v: CLEAR_CODE[p.outcome] ?? 1 });
        tx.emit({ type: 'note', text: `抜けた ── ${CLEAR_TITLE[p.outcome] ?? ''}`, level: 3 });
      }
      tx.emit({ type: 'pending', p: { kind: 'summit', outcome: p.outcome } });
    } else descend(tx);
  } else if (p.resume !== undefined) {
    const node = nodeOf(w, p.resume);
    if (node) enter(tx, node);
  }
  sync(tx);
  return true;
}

/** 層の終わりに、振る舞いから冠が一つ付く（三つまで）。冠は噂になって全員に届く。 */
function crown(tx: Tx): void {
  const y = tx.w.you;
  if (y.titles.length >= 3) return;
  const id = earnTitle(y.deeds, y.titles);
  const t = id ? titleDef(id) : undefined;
  const ep = id ? epithetDef(id) : undefined;
  if (!id || !t || !ep) return;
  tx.emit({ type: 'title', who: 'you', id });
  tx.emit({
    type: 'note',
    text: `あなたは《${ep.name}》人だと噂されはじめた。${t.text}`,
    level: 3,
  });
  for (const f of allFoes())
    if (f.id !== 'rival') tx.emit({ type: 'mind', npc: f.id, d: { heard: 1, ...t.mind } });
}

/** 抜けたときの結末（数で旗に残す）。 */
const CLEAR_CODE: Partial<Record<Outcome, number>> = {
  beaten: 1,
  broken: 2,
  trusted: 3,
  uncovered: 4,
};
const CLEAR_OF: Record<number, Outcome> = {
  1: 'beaten',
  2: 'broken',
  3: 'trusted',
  4: 'uncovered',
};
const CLEAR_TITLE: Partial<Record<Outcome, string>> = {
  beaten: '砕いた',
  broken: '黙らせた',
  trusted: '受け入れた',
  uncovered: '掘り当てた',
};

/** 抜けたあと：さらに下りるか、ここで灯りを置くか。 */
export function onward(tx: Tx, go: boolean): boolean {
  const w = tx.w;
  const p = w.pending;
  // 抜けたあとは、地図の上ならいつでも灯りを置ける（壁に当たったら、そこまで）。
  if (!p && !go && w.flags.cleared && !w.enc && !w.ending) {
    finale(tx, CLEAR_OF[w.flags.cleared] ?? 'trusted');
    return true;
  }
  if (p?.kind !== 'summit') return false;
  tx.emit({ type: 'pending', p: null });
  if (go) descend(tx);
  else finale(tx, CLEAR_OF[tx.w.flags.cleared ?? 0] ?? p.outcome);
  return true;
}

function descend(tx: Tx): void {
  const w = tx.w;
  // 区画の記録：この区画で、誰とどう決着をつけたか（名場面の帯に一行）。
  const ways: [string, string][] = [
    ['beaten', '倒した'],
    ['broken', '折った'],
    ['trusted', '打ち解けた'],
    ['uncovered', '暴いた'],
  ];
  const tally = ways
    .map(([k, name]) => {
      const n = (w.you.deeds[k] ?? 0) - (w.flags[`snap:${k}`] ?? 0);
      return n > 0 ? `${name} ${n}` : '';
    })
    .filter(Boolean);
  tx.emit({
    type: 'note',
    text: `${'一二三四五六七八九'[w.stratum - 1] ?? w.stratum}の区画を抜けた${tally.length ? ` ── ${tally.join('・')}` : ''}`,
    level: 3,
  });
  for (const [k] of ways) tx.emit({ type: 'flag', key: `snap:${k}`, v: w.you.deeds[k] ?? 0 });
  if (w.stratum < LAST) crown(tx);
  const next = w.stratum + 1;
  buildMap(tx, next);
  tx.emit({ type: 'time', hours: -w.hour + (w.you.perms.includes('shaft-key') ? -1 : 0) });
  w.you.cards.forEach((card, slot) => {
    if (!card) return;
    const full = card.eps.includes('amber');
    const look = w.you.perms.includes('habit-observe') && cardDef(card.id).tags.includes('gaze');
    const n = full ? card.max - card.uses : 1 + (look ? 1 : 0);
    if (n > 0 && card.uses < card.max) tx.emit({ type: 'card.uses', who: 'you', slot, n });
  });
  if (w.rival.stratum < next && !w.rival.down)
    tx.emit({ type: 'rival', stratum: next, row: -2, node: null });
  const sec = sectionOf(next);
  tx.emit({
    type: 'note',
    text:
      next <= THEMES
        ? `${'一二三'[next - 1] ?? next}の区画、${sec.name}。B${(next - 1) * (ROWS + 1) + 1}〜B${next * (ROWS + 1)}。${sec.open}`
        : next <= LAST
          ? `${'一二三四五六'[next - 1] ?? next}の区画、${sectionName(next)}。B${(next - 1) * (ROWS + 1) + 1}〜B${next * (ROWS + 1)}。上の${sec.name}と同じ造りだが、空気が古い。`
          : `B${(next - 1) * (ROWS + 1) + 1}。${sectionName(next)}。抜けたあとの、もっと古い階。`,
    level: 2,
  });
  // 新しい掟は、着いたときに一度だけ（名場面の帯に）。
  const law = LAWS[next];
  if (law) tx.emit({ type: 'note', text: `掟《${law.name}》 ── ${law.text}`, level: 3 });
  else if (next > THEMES)
    tx.emit({
      type: 'note',
      text: `掟はそのまま ── ${lawsAt(next)
        .map((l) => `《${l.name}》`)
        .join('')}。相手はさらに手強い。`,
      level: 3,
    });
}

// ─── 出来事 ───────────────────────────────────────────────────

export function storyChance(w: World, stat: Stat, diff: number): number {
  return Math.max(
    5,
    Math.min(95, Math.round(ask(w, 'storyChance', {}, 25 + 8 * stats(w, 'you')[stat] - diff))),
  );
}

export function canChoose(w: World, i: number): boolean {
  const p = w.pending;
  if (p?.kind !== 'story') return false;
  const def = storyDef(p.id);
  if (p.odd && def && i === def.options.length) return true;
  const o = def?.options[i];
  if (!o) return false;
  if (o.needPerm && !w.you.perms.includes(o.needPerm)) return false;
  if (o.needItem && !w.you.items.some((x) => x.id === o.needItem)) return false;
  if (o.needCoins && w.you.coins < o.needCoins) return false;
  if (o.needTags && !meets(tagCount(w.you), o.needTags)) return false;
  return true;
}

export function choose(tx: Tx, i: number): boolean {
  const w = tx.w;
  const p = w.pending;
  if (p?.kind !== 'story' || !canChoose(w, i)) return false;
  const def = storyDef(p.id);
  if (def && p.odd && i === def.options.length) return oddChoice(tx, def.title, p.id);
  const o = def?.options[i];
  if (!def || !o) return false;
  let ok = true;
  let chance: number | undefined;
  let roll: number | undefined;
  if (o.stat) {
    chance = storyChance(w, o.stat, o.diff ?? 0);
    roll = Math.floor(tx.rand('story') * 100);
    ok = roll < chance;
    xp(tx, o.stat, ok ? 2 : 1, 'you');
  }
  const twice = ok && p.eps.some((e) => epithetDef(e)?.story?.twice);
  const extra = ok ? o.effect(tx) : o.failEffect?.(tx);
  if (twice) o.effect(tx);
  if (w.flags['clear-debt']) {
    const owed = Object.keys(w.you.debts).find((id) => (w.you.debts[id] ?? 0) > 0);
    if (owed) tx.emit({ type: 'debt', who: 'you', npc: owed, n: -1 });
    tx.emit({ type: 'flag', key: 'clear-debt', v: 0 });
  }
  tx.emit({ type: 'story.seen', id: p.id });
  const text = [ok ? o.ok : (o.fail ?? o.ok), extra || ''].filter(Boolean).join(' ');
  tx.emit({ type: 'note', text: `${def.title}：${text}`, level: 0 });
  tx.emit({ type: 'pending', p: { kind: 'told', id: p.id, ok, text, chance, roll } });
  sync(tx);
  return true;
}

// ─── 食堂 ─────────────────────────────────────────────────────

export function restChance(w: World, a: 'tune-int' | 'tune-wil'): number {
  const s = stats(w, 'you');
  return Math.max(5, Math.min(95, 25 + 8 * (a === 'tune-int' ? s.INT : s.WIL)));
}

export function rest(tx: Tx, a: RestAction, slot?: number): boolean {
  const w = tx.w;
  const p = w.pending;
  if (p?.kind !== 'rest' || (p.used && a !== 'bet')) return false;
  const y = w.you;
  const s = stats(w, 'you');
  const heal = (frac: number) => {
    const node = nodeOf(w, w.pos);
    const inverted = node?.eps.includes('inverted');
    const h = Math.round(tx.rule('restHeal', {}, maxHp(s) * frac));
    const m = Math.round(tx.rule('restHeal', {}, maxMind(s) * frac));
    tx.emit({
      type: 'vital',
      who: 'you',
      hp: Math.max(0, Math.min(h, maxHp(s) - y.hp)),
      mind: Math.max(0, Math.min(m, maxMind(s) - y.mind)),
    });
    if (inverted) for (const st of STATS) xp(tx, st, 1, 'you');
  };
  const timeFor = (h: number) => Math.max(0, Math.round(tx.rule('timeCost', { kind: 'rest' }, h)));
  if (a === 'bet') return bet(tx);
  switch (a) {
    case 'rest': {
      // 休む：体と心を戻し、いちばん減っている札が一枚、満ちる。
      const again = w.flags[`rested${w.stratum}`] ?? 0;
      tx.emit({ type: 'flag', key: `rested${w.stratum}`, v: again + 1 });
      heal(PACE.rest);
      refillOne(tx);
      if (y.perms.includes('insomnia')) refill(tx, 1, undefined, 'you', true);
      careBonus(tx);
      passTime(tx, timeFor(1));
      break;
    }
    case 'eat': {
      // 食べる：金を払って、体と心を少し（札の回数は戻らない）。
      if (y.coins < PACE.meal) return false;
      coins(tx, -PACE.meal, 'you');
      heal(0.25);
      passTime(tx, timeFor(1));
      break;
    }
    case 'full': {
      // ひと晩ここで：体と心は大きく戻るが、夜が明けて噂も冷める
      // （決着の余韻はすべて消える）。次の出来事も逃す。
      heal(0.8);
      // 札は二枚だけ満ちる（ひと晩でも、全部は戻らない）。
      refillOne(tx);
      refillOne(tx);
      for (const af of [...w.after]) tx.emit({ type: 'after.end', kind: af.kind });
      passTime(tx, timeFor(3));
      tx.emit({ type: 'flag', key: 'skipStory', v: 1 });
      break;
    }
    case 'tune-int':
    case 'tune-wil': {
      const ok = tx.rand('story') * 100 < restChance(w, a);
      if (ok) {
        const tags =
          a === 'tune-int'
            ? (['gaze', 'public', 'private'] as const)
            : (['memory', 'trust', 'body'] as const);
        // 合うタグの札が一枚、二回ぶん戻る。
        for (const t of tags) if (refill(tx, 2, t, 'you', true)) break;
        xp(tx, a === 'tune-int' ? 'INT' : 'WIL', 2, 'you');
      } else tx.emit({ type: 'vital', who: 'you', mind: -Math.min(3, y.mind - 1) });
      passTime(tx, timeFor(1));
      break;
    }
    case 'discard': {
      if (slot === undefined || !y.cards[slot]) return false;
      // 一枚を手放して、ほかの二枚を満たす。
      tx.emit({ type: 'card.set', who: 'you', slot, card: null, why: 'discard' });
      refillOne(tx);
      refillOne(tx);
      break;
    }
  }
  shiftAll(tx, 'you');
  tx.emit({ type: 'pending', p: { ...p, used: true } });
  sync(tx);
  return true;
}

export interface AlterOption {
  to: string;
  kind: 'care' | 'overuse' | 'secret';
  ready: boolean;
  need: string;
}

export function alterOptions(c: Char, slot: number): AlterOption[] {
  const card = c.cards[slot];
  if (!card || card.eps.includes('amber') || card.eps.includes('forgotten')) return [];
  const a = cardDef(card.id).alter;
  if (!a) return [];
  const half = card.eps.includes('unfinished');
  const need = (n: number) => (half ? Math.ceil(n / 2) : n);
  const out: AlterOption[] = [];
  if (a.care) {
    const n = card.marks.rested ?? 0;
    out.push({
      to: a.care.to,
      kind: 'care',
      ready: n >= need(a.care.need),
      need: `休ませて回復 ${n}/${need(a.care.need)}`,
    });
  }
  if (a.overuse) {
    const n = card.marks.spent ?? 0;
    out.push({
      to: a.overuse.to,
      kind: 'overuse',
      ready: n >= need(a.overuse.need),
      need: `0 回のまま使う ${n}/${need(a.overuse.need)}`,
    });
  }
  if (a.secret) {
    const have = a.secret.perms.filter((p) => c.perms.includes(p)).length;
    out.push({
      to: a.secret.to,
      kind: 'secret',
      ready: have === a.secret.perms.length,
      need: a.secret.perms.map((p) => `《${permDef(p)?.name ?? p}》`).join(' + '),
    });
  }
  return out;
}

export function alter(tx: Tx, slot: number, to: string): boolean {
  const w = tx.w;
  const p = w.pending;
  if (p?.kind !== 'rest' || p.altered) return false;
  if (!alterOptions(w.you, slot).some((o) => o.to === to && o.ready)) return false;
  transform(tx, 'you', slot, to, 'alter');
  tx.emit({ type: 'pending', p: { ...p, altered: true } });
  sync(tx);
  return true;
}

/** エピテットを刻む（カードか記憶へ。どちらにも 2 つまで）。地図の上か、食堂で。 */
/**
 * エピテットを刻む。刻める先は五つあって、同じ語でも刻んだ先で意味が変わる。
 *   札      効き方（地図の上か、食堂で）
 *   記憶    補正の働き方（同じ）
 *   部屋    先の部屋。人のいる部屋なら、その人の気質に。いなければ場所の性質に
 *   相手    向き合っている相手（遭遇に一度だけ。すぐに効く）
 *   出来事  いま開いている出来事の、判定と実り
 */
export function inscribe(
  tx: Tx,
  ep: string,
  to: {
    slot?: number;
    uid?: number;
    perm?: string;
    node?: number;
    foe?: boolean;
    story?: boolean;
  },
): boolean {
  const w = tx.w;
  if (!w.you.epithets.includes(ep)) return false;
  const def = epithetDef(ep);
  if (!def) return false;
  const { slot, perm } = to;
  if (to.foe) {
    if (!inkFoe(tx, ep)) return false;
  } else if (to.story) {
    const p = w.pending;
    if (p?.kind !== 'story' || !def.story || p.eps.length >= 2 || p.eps.includes(ep)) return false;
    tx.emit({ type: 'pending', p: { ...p, eps: [...p.eps, ep] } });
  } else if (to.node !== undefined) {
    const n = nodeOf(w, to.node);
    const here = nodeOf(w, w.pos)?.row ?? -1;
    // 先の部屋へは、向き合っていなければいつでも（受け取り・店・出来事の最中でも）。
    if (w.enc || !n || n.visited || n.row <= here) return false;
    if (!(n.npc ? def.foe : def.place) || n.eps.length >= PACE.stack) return false;
    tx.emit({ type: 'node.ep', id: n.id, ep });
    tx.emit({
      type: 'note',
      text: `《${def.name}》を${n.npc ? foeDef(n.npc).name : '部屋'}に刻んだ。${(n.npc ? def.foe : def.place)?.text ?? ''}`,
      level: 1,
    });
  } else if (slot !== undefined || to.uid !== undefined) {
    // 札と記憶へは、どの場面でも（向き合っているあいだも、手番を使わずに）。後ろの札へは、
    // 向き合っていないときに（支度として）。
    const at =
      slot !== undefined ? { slot } : to.uid !== undefined ? findCard(w.you, to.uid) : null;
    if (!at || ('index' in at && w.enc)) return false;
    const card = cardAt(w.you, at);
    if (!card || !def.card || card.eps.length >= PACE.stack) return false;
    markEp(tx, 'you', at, ep, true);
  } else if (perm) {
    const list = w.you.permEps[perm] ?? [];
    if (!w.you.perms.includes(perm) || !def.memory || list.length >= PACE.stack) return false;
    tx.emit({ type: 'perm.ep', who: 'you', perm, ep, on: true });
  } else return false;
  tx.emit({ type: 'ep.held', who: 'you', ep, n: -1 });
  sync(tx);
  return true;
}

/**
 * 札からエピテットを剥がして手に戻す（別の札に刻み直せる）。向き合っていない
 * ときの支度。回数を増やす語なら、剥がした札の最大回数は戻る。
 */
export function peel(tx: Tx, uid: number, ep: string): boolean {
  const w = tx.w;
  if (w.enc) return false;
  const at = findCard(w.you, uid);
  const card = at ? cardAt(w.you, at) : undefined;
  if (!at || !card?.eps.includes(ep)) return false;
  markEp(tx, 'you', at, ep, false);
  tx.emit({ type: 'ep.held', who: 'you', ep, n: 1 });
  tx.emit({
    type: 'note',
    text: `『${cardDef(card.id).name}』から《${epithetDef(ep)?.name ?? ep}》を剥がした。`,
    level: 0,
  });
  return true;
}

/**
 * 決着のあと、ときどき、手元の札の一枚にエピテットがひとりでに宿る（拾える語から）。
 * 尽きた札を手放さずに持っておく理由になる（回数を増やす語が宿れば、また使える）。
 */
function selfMark(tx: Tx): void {
  const w = tx.w;
  if (tx.rand('loot') >= PACE.mark) return;
  const open = w.you.cards.flatMap((c, slot) => (c && c.eps.length < PACE.stack ? [slot] : []));
  const slot = tx.pick('loot', open);
  const ep = tx.pick('loot', poolEpithets());
  const card = slot !== undefined ? w.you.cards[slot] : undefined;
  if (slot === undefined || !ep || !card) return;
  markEp(tx, 'you', { slot }, ep.id, true);
  tx.emit({
    type: 'note',
    text: `『${cardDef(card.id).name}』に、《${ep.name}》がひとりでに宿った。${ep.card?.text ?? ''}`,
    level: 2,
  });
}

/**
 * 向き合っている相手にエピテットを刻む（遭遇に一度だけ、手番は使わない）。
 * 体力や意志は割合で縮み（今の値も同じ割合で）、気質はその場で変わる。
 */
function inkFoe(tx: Tx, ep: string): boolean {
  const w = tx.w;
  const e = w.enc;
  const ff = epithetDef(ep)?.foe;
  if (!e || e.phase !== 'act' || e.who !== 'you' || !ff) return false;
  if ((e.st.inked ?? 0) >= PACE.inkEnc || e.foe.eps.length >= PACE.stackFoe) return false;
  const f = e.foe;
  tx.emit({ type: 'enc.st', key: 'inked', n: 1 });
  tx.emit({ type: 'foe.ep', ep });
  const scale = (field: 'hp' | 'resolve', max: 'maxHp' | 'maxResolve', k: number) => {
    const m = Math.max(1, Math.round(f[max] * k));
    const v = Math.max(1, Math.round(f[field] * k));
    tx.emit({ type: 'foe', field: max, n: m - f[max] });
    tx.emit({ type: 'foe', field, n: v - f[field] });
  };
  if (ff.hp) scale('hp', 'maxHp', ff.hp);
  if (ff.resolve) scale('resolve', 'maxResolve', ff.resolve);
  if (ff.need) tx.emit({ type: 'foe', field: 'need', n: Math.max(1 - f.need, ff.need) });
  if (ff.hostility) tx.emit({ type: 'foe', field: 'hostility', n: ff.hostility });
  if (ff.trust) tx.emit({ type: 'foe', field: 'trust', n: ff.trust });
  for (const k of ['atk', 'def', 'int', 'agi'] as const) {
    const d = ff[k];
    if (d) tx.emit({ type: 'foe', field: k, n: Math.max(-f[k], d) });
  }
  if (ff.stun) tx.emit({ type: 'foe.st', key: 'stun', n: 1 });
  if (ff.lies === 'always') tx.emit({ type: 'foe.st', key: 'liar', n: 1 });
  if (ff.lies === 'never') tx.emit({ type: 'foe.st', key: 'honest', n: 1 });
  // 初めから見えている手がかり：刻んだ瞬間に、確かに一つ見える（漏れる・漏れないの判定なし）。
  for (const c of f.clues.filter((x) => !x.shown && !x.false).slice(0, ff.show ?? 0))
    tx.emit({ type: 'clue', id: c.id, shown: true });
  tx.emit({
    type: 'note',
    text: `《${epithetDef(ep)?.name ?? ep}》を${f.name}に刻んだ。${ff.text}`,
    level: 2,
  });
  return true;
}

// ─── 古物商 ───────────────────────────────────────────────────

export const priceOf = (w: World, base: number) =>
  Math.round(ask(w, 'price', {}, base * (1 + 0.08 * heatOf(w))));
export const cardPrice = (w: World, id: string) =>
  priceOf(w, 45 + cardDef(id).uses * 3 + (cardDef(id).rarity === 'rare' ? 25 : 0));
export const epPrice = (w: World, id: string) =>
  priceOf(
    w,
    epithetDef(id)?.rarity === 'rare' ? 60 : epithetDef(id)?.rarity === 'uncommon' ? 42 : 30,
  );
export const curePrice = (w: World) => priceOf(w, 70);

export function permValue(c: Char, id: string): number {
  let v = permDef(id)?.value ?? 0;
  for (const e of c.permEps[id] ?? []) v *= epithetDef(e)?.memory?.value ?? 1;
  return Math.round(v);
}

export function buy(tx: Tx, id: string, drop?: number): boolean {
  const w = tx.w;
  const p = w.pending;
  if (p?.kind !== 'shop' || p.sold.includes(id)) return false;
  if (p.cards.includes(id)) {
    const price = p.bargain === id ? Math.ceil(cardPrice(w, id) / 2) : cardPrice(w, id);
    if (w.you.coins < price) return false;
    if (!makeRoom(tx, drop)) return false;
    coins(tx, -price, 'you');
    addCard(tx, id, 'bought');
  } else if (p.items.includes(id)) {
    if (id.startsWith('ep:')) {
      const ep = id.slice(3);
      const price = epPrice(w, ep);
      if (w.you.coins < price) return false;
      coins(tx, -price, 'you');
      tx.emit({ type: 'ep.held', who: 'you', ep, n: 1 });
    } else {
      const g = gearOf(id);
      const price = priceOf(w, g?.price ?? 99);
      if (!g || w.you.coins < price || !itemRoom(w.you, id)) return false;
      coins(tx, -price, 'you');
      tx.emit({ type: 'item', who: 'you', id, n: 1, uses: g.uses });
    }
  } else return false;
  tx.emit({ type: 'pending', p: { ...p, sold: [...p.sold, id] } });
  sync(tx);
  return true;
}

export function sell(tx: Tx, perm: string): boolean {
  const w = tx.w;
  const v = permValue(w.you, perm);
  if (w.pending?.kind !== 'shop' || v <= 0 || !w.you.perms.includes(perm)) return false;
  losePerm(tx, perm, 'sold', 'you');
  coins(tx, v, 'you');
  if (perm === 'promise') tx.emit({ type: 'flag', key: 'soldPromise', v: 1 });
  sync(tx);
  return true;
}

export function cure(tx: Tx, perm: string): boolean {
  const w = tx.w;
  if (w.pending?.kind !== 'shop' || !permDef(perm)?.bad || !w.you.perms.includes(perm))
    return false;
  const price = curePrice(w);
  if (w.you.coins < price) return false;
  coins(tx, -price, 'you');
  losePerm(tx, perm, 'cured', 'you');
  sync(tx);
  return true;
}

export function sacrifice(tx: Tx, s: Stat, slot: number): boolean {
  const w = tx.w;
  const card = w.you.cards[slot];
  if (w.pending?.kind !== 'shop' || !card || w.you.innate[s] + w.you.growth[s] <= 1) return false;
  // 成長値から先に差し出す（無ければ先天値）。
  tx.emit({ type: 'grew', who: 'you', stat: s, n: -1, innate: w.you.growth[s] <= 0 });
  tx.emit({ type: 'card.max', who: 'you', slot, n: 1 });
  tx.emit({ type: 'card.uses', who: 'you', slot, n: 99 });
  sync(tx);
  return true;
}

export function depart(tx: Tx): boolean {
  const k = tx.w.pending?.kind;
  if (k !== 'shop' && k !== 'rest' && k !== 'told') return false;
  tx.emit({ type: 'pending', p: null });
  return true;
}

// ─── ビルドと組み合わせ ───────────────────────────────────────

/** 揃った記憶の組み合わせを記録し、能力値の上限で体力・精神を切りそろえる。 */
export function sync(tx: Tx): void {
  const w = tx.w;
  for (const c of allCombos()) {
    const key = `combo:${c.id}`;
    if (w.flags[key] || !c.needs.every((p) => w.you.perms.includes(p))) continue;
    tx.emit({ type: 'flag', key, v: 1 });
    tx.emit({ type: 'note', text: `記憶が繋がった ── ${c.name}。${c.text}`, level: 3 });
    if (c.grant) gainPerm(tx, c.grant, `combo:${c.id}`, 'you');
    if (c.story) tx.emit({ type: 'unlock', story: c.story });
  }
  // 尽きた札の入れ替えは、向き合っているあいだだけ（地図の上では、次の遭遇で配り直す）。
  for (const who of ['you', 'rival'] as const)
    if (w.enc?.who === who && w.enc.phase === 'act') rotate(tx, who);
  levelUp(tx);
  const s = stats(w, 'you');
  if (w.you.hp > maxHp(s)) tx.emit({ type: 'vital', who: 'you', hp: maxHp(s) - w.you.hp });
  if (w.you.mind > maxMind(s))
    tx.emit({ type: 'vital', who: 'you', mind: maxMind(s) - w.you.mind });
}

// ─── 終わり ───────────────────────────────────────────────────

/** いまのフロアの番号（B いくつ）。 */
const floorOf = (w: World): number =>
  (w.stratum - 1) * (ROWS + 1) + (nodeOf(w, w.pos)?.row ?? 0) + 1;

function score(w: World, won: boolean): number {
  return (
    (w.stratum - 1) * 150 +
    w.you.perms.length * 12 +
    buildsOf(w.you).length * 30 +
    w.found.length * 20 +
    (won ? 400 + w.depth * 120 : 0) +
    (won && !w.rival.first ? 100 : 0)
  );
}

function finish(tx: Tx, kind: 'dead' | 'dawn', title: string): void {
  const w = tx.w;
  tx.emit({
    type: 'ending',
    ending: {
      kind,
      title,
      text:
        kind === 'dawn'
          ? '朝になった。階段の扉が閉まった。'
          : w.flags.cleared
            ? `底の手前を抜けたあと、B${floorOf(w)}（${sectionName(w.stratum)}）で灯りが消えた。`
            : `${sectionName(w.stratum)}の途中で、あなたの灯りが消えた。`,
      score: score(w, !!w.flags.cleared),
      won: !!w.flags.cleared,
    },
  });
  tx.emit({ type: 'pending', p: { kind: 'ending' } });
}

function finale(tx: Tx, outcome: Outcome): void {
  const w = tx.w;
  const her = !!w.flags['her-trail'] || w.you.perms.includes('truth');
  let title = '引き返した';
  let text = 'あなたは底の手前で引き返した。立方体は、まだそこにある。次の夜も。';
  switch (outcome) {
    case 'beaten':
      title = '砕いた';
      text =
        'あなたは自分の履歴を砕いた。土に戻った立方体の中に、何も残っていなかった。身軽になった。それが良いことかは、まだわからない。';
      break;
    case 'broken':
      title = '黙らせた';
      text = '立方体は黙った。あなたの記憶は、もう何も言わない。夜明けの階段を、ひとりで上る。';
      break;
    case 'trusted':
      title = '受け入れた';
      text = 'ぜんぶ持っていく、と決めた。重さはそのまま。それでも、歩ける。';
      break;
    case 'uncovered':
      title = her ? '彼女を見つけた' : '掘り当てた';
      text = her
        ? '最後の面に、彼女の名前があった。その下に、あなたの名前も。明かりをつける。約束どおりに。'
        : '面をひとつずつ剥がしていくと、底に小さな空洞があった。何が入っていたのかは、もう思い出せない。';
      break;
    default:
      break;
  }
  if (w.flags.soldPromise) text += ' 約束は、古物商の棚に置いてきた。';
  // 抜けたあと、さらに下りてから置いた灯り。
  if (w.stratum > LAST) {
    title = `B${floorOf(w)}で置いた`;
    text += ` そのあと、${sectionName(w.stratum)}まで下りて、B${floorOf(w)}で灯りを置いた。`;
  }
  if (w.rival.first) text += ` ${w.rival.char.name}の灯りが、あなたより先にここを照らしていた。`;
  const won = outcome !== 'left' && outcome !== 'fled';
  tx.emit({ type: 'ending', ending: { kind: outcome, title, text, score: score(w, won), won } });
  tx.emit({ type: 'pending', p: { kind: 'ending' } });
}

export const memo = { blankMind, holds };

/**
 * ビルドとその段は、構成から毎回導く（世界に書き残さない）。コマンドの前後で
 * 比べて、変わったぶんだけを告げる。
 */
export function tiersOf(c: Char): Map<string, number> {
  return new Map(buildsOf(c).map((b) => [b.id, tierOf(c, b.id)]));
}

export function announce(tx: Tx, before: Map<string, number>): void {
  const now = tiersOf(tx.w.you);
  for (const [id, t] of now) {
    const was = before.get(id);
    const b = allBuilds().find((x) => x.id === id);
    if (!b) continue;
    if (was === undefined)
      tx.emit({ type: 'note', text: `《${b.name}》が成立した ── ${b.text}`, level: 3 });
    const sv = SURGES[id];
    if (!sv || t <= (was ?? 0)) continue;
    tx.emit({
      type: 'note',
      text:
        t === 2
          ? `《${b.name}》が極まった ── ${sv.name}：${sv.peakText}`
          : `《${b.name}》が暴走した ── ${sv.name}：${sv.text}`,
      level: 3,
    });
  }
  for (const id of before.keys()) {
    const b = allBuilds().find((x) => x.id === id);
    if (b && !now.has(id)) tx.emit({ type: 'note', text: `《${b.name}》が崩れた。`, level: 2 });
  }
}
