import { WORK_ARCH } from '../content/archetypes';
import { DATA_VERSION, PACE } from '../content/balance';
import { memoryMods, tagCount } from '../content/cardinfo';
import type { CardDef } from '../content/defs';
import { BEATS, type FloorUse, SECTIONS, useOf } from '../content/floors';
import { holds } from '../content/fx';
import {
  defaultSheet,
  JOB_EPITHETS,
  JOB_ITEMS,
  ORIGINS,
  type Sheet,
  START_CARDS,
} from '../content/origins';
import {
  allBuilds,
  allCards,
  allCombos,
  allEpithets,
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
import { misses } from './near';
import { charOf, coins, gainPerm, losePerm, maxHp, maxMind, refill, stats, xp } from './ops';

/**
 * 挑戦。三つの層を一夜ずつ下りる（22 時に始まり、6 時に夜が明ける）。
 * 段を進むたびに 1 時間。遅いほど相手は荒れている。
 */

export const ROWS = PACE.rows;
export const DAWN = PACE.dawn;
export const STRATUM_NAME = ['', ...[1, 2, 3].map((n) => SECTIONS[n]?.name ?? '')];

// ─── 人物を作る ───────────────────────────────────────────────

export function newCard(uid: number, id: string, eps: string[] = []): Card {
  const def = cardDef(id);
  return { uid, id, uses: def.uses, max: def.uses, marks: {}, eps };
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
    items: [item],
    // 初めは 3 枚。残りの枠は空いている（拾って埋める）。
    cards: [0, 1, 2, 3, 4].map((i) => {
      const id = j.cards[i];
      return i < START_CARDS && id ? newCard(i + 1, id) : null;
    }),
    perms: [...new Set(['promise', origin].filter(Boolean))],
    permEps: {},
    epithets: ep ? [ep] : [],
    debts: {},
    deeds: {},
    titles: [],
    uid: START_CARDS + 1,
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
  const sec = SECTIONS[stratum] ?? SECTIONS[1];
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
    const kinds = [...beat.rooms].sort(() => tx.rand('map') - 0.5);
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
  return w.map.filter((n) => n.row === here.row && Math.abs(n.col - here.col) === 1 && !n.visited);
}

/** その部屋へは廊下か（同じフロア）。 */
export const isHall = (w: World, n: MapNode) => nodeOf(w, w.pos)?.row === n.row;

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
  if (depth >= 5 && !you.perms.includes('fear')) you.perms.push('fear');
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
  buildMap(tx, 1);
  tx.emit({
    type: 'note',
    text: `22:00。${SECTIONS[1]?.open ?? ''} 下のほうに、もう一つ灯りが揺れている。${rival.name}だ。`,
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
  // 昼になれば、縦坑は閉じる（何度でも退けるが、時間は戻らない）。
  if (tx.w.hour >= PACE.dawn + PACE.noon && !tx.w.ending) {
    if (tx.w.enc) tx.emit({ type: 'enc.close' });
    finish(tx, 'dawn', '夜が明けた');
  }
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
    ? here.next.map((id) => nodeOf(w, id)).filter((n): n is MapNode => !!n)
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
    if (rv.stratum >= 3) {
      tx.emit({ type: 'rival', down: true, first: !w.ending });
      if (!w.ending) tx.emit({ type: 'note', text: `${ch.name}の灯りが、先に底のほうへ消えた。` });
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
  const have = new Set(c.cards.map((x) => x?.id));
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
  const pool = allCards().filter(
    (d) => (d.layer === 'archetype' || d.layer === 'basic') && !d.retired && !have.has(d.id),
  );
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
  const hall = isHall(w, node);
  tx.emit({ type: 'moved', node: node.id });
  const use = useOf(w.stratum, node.use);
  if (hall) tx.emit({ type: 'note', text: '廊下を歩いて、隣の部屋へ。' });
  else if (use)
    tx.emit({
      type: 'note',
      text: `B${(w.stratum - 1) * (ROWS + 1) + node.row + 1}・${use.name}。${use.line}`,
    });
  tx.emit({ type: 'node', id: node.id, visited: true });
  // 着くのにかかる時間（場所のエピテットと、規則）。
  let hours = 1;
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
    (w.flags[`met${w.stratum}`] ?? 0) === 0 &&
    node.kind !== 'boss'
  ) {
    tx.emit({ type: 'flag', key: `met${w.stratum}`, v: 1 });
    tx.emit({ type: 'note', text: `${rv.char.name}と鉢合わせた。同じ階段を下りてきたらしい。` });
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

function enter(tx: Tx, node: MapNode, from: number | null = null): void {
  const w = tx.w;
  if (node.npc) {
    if (node.eps.some((e) => epithetDef(e)?.place?.empty) && node.kind !== 'boss') {
      tx.emit({ type: 'note', text: 'そこには、誰もいなかった。' });
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
        tx.emit({ type: 'note', text: '眠っているあいだに、そこには誰もいなくなっていた。' });
        return;
      }
      const id = pickStory(tx);
      if (id)
        tx.emit({
          type: 'pending',
          p: { kind: 'story', id, eps: node.eps.filter((e) => !!epithetDef(e)?.story) },
        });
      return;
    }
    case 'rest':
      tx.emit({ type: 'pending', p: { kind: 'rest', used: false, altered: false } });
      return;
    case 'shop': {
      const have = new Set(w.you.cards.map((c) => c?.id));
      const pool = allCards().filter(
        (d) =>
          d.layer !== 'legacy' &&
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
      const items = [...allItems()]
        .sort(() => tx.rand('loot') - 0.5)
        .slice(0, 3)
        .map((i) => i.id);
      const eps = allEpithets()
        .filter((e) => !!e.card)
        .sort(() => tx.rand('loot') - 0.5)
        .slice(0, 2)
        .map((e) => `ep:${e.id}`);
      const t = want?.tag;
      const tagEp = t
        ? allEpithets().find((e) => e.card?.add?.includes(t) && !eps.includes(`ep:${e.id}`))
        : undefined;
      if (tagEp) eps.splice(0, 1, `ep:${tagEp.id}`);
      tx.emit({ type: 'pending', p: { kind: 'shop', cards, items: [...items, ...eps], sold: [] } });
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
export function breather(tx: Tx): void {
  const w = tx.w;
  refill(tx, 1 + (w.you.perms.includes('insomnia') ? 1 : 0), undefined, 'you', true);
  careBonus(tx);
  shiftAll(tx, 'you');
  passTime(tx, Math.max(0, Math.round(tx.rule('timeCost', { kind: 'rest' }, 1))));
  tx.emit({ type: 'note', text: '壁にもたれて、一服した。' });
}

/** 古びた・未完のカードは、休ませたことを 2 倍に数える。 */
function careBonus(tx: Tx): void {
  tx.w.you.cards.forEach((card, slot) => {
    if (card?.eps.some((e) => epithetDef(e)?.card?.care))
      tx.emit({ type: 'card.mark', who: 'you', slot, mark: 'rested', n: 1 });
  });
}

export function useItem(tx: Tx, index: number): boolean {
  const w = tx.w;
  const id = w.you.items[index];
  const def = id ? itemDef(id) : undefined;
  if (!def || !id) return false;
  tx.emit({ type: 'item', who: 'you', id, n: -1 });
  const s = stats(w, 'you');
  const hp = Math.min(def.heal?.hp ?? 0, maxHp(s) - w.you.hp);
  const mind = Math.min(def.heal?.mind ?? 0, maxMind(s) - w.you.mind);
  if (hp > 0 || mind > 0)
    tx.emit({ type: 'vital', who: 'you', hp: Math.max(0, hp), mind: Math.max(0, mind) });
  if (def.refill) {
    if (def.refill.tags.length === 0) refill(tx, def.refill.n, undefined, 'you');
    else for (const t of def.refill.tags) refill(tx, def.refill.n, t, 'you');
  }
  tx.emit({ type: 'note', text: `${def.name}を使った。` });
  return true;
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
    tx.emit({ type: 'note', text: `退いた。${e.foe.name}は、あなたを覚えている。` });
    return true;
  }
  const notes = [...rewards(tx, 'you', e.foe.id, o, node?.rival), ...resonate(tx, 'you')];
  if (o === 'beaten') tx.emit({ type: 'flag', key: 'beaten', v: (w.flags.beaten ?? 0) + 1 });
  if (p.npc === 'rival') tx.emit({ type: 'flag', key: 'rivalMet', v: 1 });
  // 打ち解けたり暴いたりすると、エピテットを拾うことがある。
  if ((o === 'trusted' || o === 'uncovered') && tx.rand('loot') < 0.45) {
    const pool = allEpithets();
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
  if (notes.length) tx.emit({ type: 'note', text: `手に入れた：${notes.join('、')}` });
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
      cards: o === 'left' || o === 'fled' ? [] : offerCards(tx, 'you'),
    },
  });
  sync(tx);
  return true;
}

export function claim(tx: Tx, take?: string, help?: number, card?: string, slot?: number): boolean {
  const w = tx.w;
  const p = w.pending;
  if (p?.kind !== 'reward') return false;
  if (card && p.cards.includes(card)) {
    const at = slot ?? w.you.cards.findIndex((c) => !c);
    if (at < 0 || at > 4) return false;
    tx.emit({
      type: 'card.set',
      who: 'you',
      slot: at,
      card: newCard(w.you.uid, card),
      why: 'picked',
    });
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
      });
    }
  }
  tx.emit({ type: 'pending', p: null });
  if (p.boss) {
    if (w.stratum >= 3) {
      crown(tx);
      finale(tx, p.outcome);
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
  tx.emit({ type: 'note', text: `あなたは《${ep.name}》人だと噂されはじめた。${t.text}` });
  for (const f of allFoes())
    if (f.id !== 'rival') tx.emit({ type: 'mind', npc: f.id, d: { heard: 1, ...t.mind } });
}

function descend(tx: Tx): void {
  const w = tx.w;
  crown(tx);
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
  tx.emit({ type: 'note', text: `B${(next - 1) * (ROWS + 1) + 1}。${SECTIONS[next]?.open ?? ''}` });
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
  const o = storyDef(p.id)?.options[i];
  if (!o) return false;
  if (o.needPerm && !w.you.perms.includes(o.needPerm)) return false;
  if (o.needItem && !w.you.items.includes(o.needItem)) return false;
  if (o.needCoins && w.you.coins < o.needCoins) return false;
  if (o.needTags && !meets(tagCount(w.you), o.needTags)) return false;
  return true;
}

export function choose(tx: Tx, i: number): boolean {
  const w = tx.w;
  const p = w.pending;
  if (p?.kind !== 'story' || !canChoose(w, i)) return false;
  const def = storyDef(p.id);
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
  tx.emit({ type: 'note', text: `${def.title}：${text}` });
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
  if (p?.kind !== 'rest' || p.used) return false;
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
  switch (a) {
    case 'rest': {
      // 同じ層で休むほど、効きは薄れる（安全な道ばかりでは、夜を越えられない）。
      const again = w.flags[`rested${w.stratum}`] ?? 0;
      tx.emit({ type: 'flag', key: `rested${w.stratum}`, v: again + 1 });
      heal(PACE.rest * (again ? PACE.restAgain : 1));
      refill(tx, 1 + (y.perms.includes('insomnia') ? 1 : 0), undefined, 'you', true);
      careBonus(tx);
      passTime(tx, timeFor(1));
      break;
    }
    case 'full': {
      const card = slot !== undefined ? y.cards[slot] : null;
      if (!card || slot === undefined) return false;
      heal(0.6);
      if (card.uses < card.max)
        tx.emit({ type: 'card.uses', who: 'you', slot, n: card.max - card.uses });
      tx.emit({ type: 'card.mark', who: 'you', slot, mark: 'rested', n: 2 });
      passTime(tx, timeFor(2));
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
        for (const t of tags) refill(tx, 1, t, 'you', true);
        xp(tx, a === 'tune-int' ? 'INT' : 'WIL', 2, 'you');
      } else tx.emit({ type: 'vital', who: 'you', mind: -Math.min(3, y.mind - 1) });
      passTime(tx, timeFor(1));
      break;
    }
    case 'discard': {
      if (slot === undefined || !y.cards[slot]) return false;
      tx.emit({ type: 'card.set', who: 'you', slot, card: null, why: 'discard' });
      y.cards.forEach((card, i) => {
        if (card && card.uses < card.max)
          tx.emit({ type: 'card.uses', who: 'you', slot: i, n: card.max - card.uses });
      });
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
export function inscribe(tx: Tx, ep: string, slot?: number, perm?: string): boolean {
  const w = tx.w;
  if (w.enc || !w.you.epithets.includes(ep)) return false;
  if (w.pending && w.pending.kind !== 'rest') return false;
  const def = epithetDef(ep);
  if (!def) return false;
  if (slot !== undefined) {
    const card = w.you.cards[slot];
    if (!card || !def.card || card.eps.length >= 2 || card.eps.includes(ep)) return false;
    tx.emit({ type: 'card.ep', who: 'you', slot, ep, on: true });
  } else if (perm) {
    const list = w.you.permEps[perm] ?? [];
    if (!w.you.perms.includes(perm) || !def.memory || list.length >= 2 || list.includes(ep))
      return false;
    tx.emit({ type: 'perm.ep', who: 'you', perm, ep, on: true });
  } else return false;
  tx.emit({ type: 'ep.held', who: 'you', ep, n: -1 });
  sync(tx);
  return true;
}

// ─── 古物商 ───────────────────────────────────────────────────

export const priceOf = (w: World, base: number) =>
  Math.round(ask(w, 'price', {}, base * (1 + 0.1 * w.depth)));
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

export function buy(tx: Tx, id: string, slot?: number): boolean {
  const w = tx.w;
  const p = w.pending;
  if (p?.kind !== 'shop' || p.sold.includes(id)) return false;
  if (p.cards.includes(id)) {
    const price = cardPrice(w, id);
    if (w.you.coins < price || slot === undefined || slot < 0 || slot > 4) return false;
    coins(tx, -price, 'you');
    tx.emit({ type: 'card.set', who: 'you', slot, card: newCard(w.you.uid, id), why: 'bought' });
  } else if (p.items.includes(id)) {
    if (id.startsWith('ep:')) {
      const ep = id.slice(3);
      const price = epPrice(w, ep);
      if (w.you.coins < price) return false;
      coins(tx, -price, 'you');
      tx.emit({ type: 'ep.held', who: 'you', ep, n: 1 });
    } else {
      const price = priceOf(w, itemDef(id)?.price ?? 99);
      if (w.you.coins < price) return false;
      coins(tx, -price, 'you');
      tx.emit({ type: 'item', who: 'you', id, n: 1 });
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
    tx.emit({ type: 'note', text: `記憶が繋がった ── ${c.name}。${c.text}` });
    if (c.grant) gainPerm(tx, c.grant, `combo:${c.id}`, 'you');
    if (c.story) tx.emit({ type: 'unlock', story: c.story });
  }
  const s = stats(w, 'you');
  if (w.you.hp > maxHp(s)) tx.emit({ type: 'vital', who: 'you', hp: maxHp(s) - w.you.hp });
  if (w.you.mind > maxMind(s))
    tx.emit({ type: 'vital', who: 'you', mind: maxMind(s) - w.you.mind });
}

// ─── 終わり ───────────────────────────────────────────────────

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
          ? '朝になった。建物じゅうの灯りが一斉に落ち、階段の扉が閉まる。あなたの灯りだけが、まだ点いている。'
          : `${STRATUM_NAME[w.stratum]}の途中で、あなたの灯りが消えた。`,
      score: score(w, false),
      won: false,
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
    if (was === undefined) tx.emit({ type: 'note', text: `《${b.name}》が成立した。${b.text}` });
    const sv = SURGES[id];
    if (!sv || t <= (was ?? 0)) continue;
    tx.emit({
      type: 'note',
      text:
        t === 2
          ? `《${b.name}》が極まった ── ${sv.name}：${sv.peakText}`
          : `《${b.name}》が暴走した ── ${sv.name}：${sv.text}`,
    });
  }
  for (const id of before.keys()) {
    const b = allBuilds().find((x) => x.id === id);
    if (b && !now.has(id)) tx.emit({ type: 'note', text: `《${b.name}》が崩れた。` });
  }
}
