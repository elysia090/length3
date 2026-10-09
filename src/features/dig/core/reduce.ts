import type { Ev } from './events';
import { perceive } from './mind';
import { blankMind, type Char, type Who, type World, zeroStats } from './model';

/**
 * 畳み込み。世界を書き換えるのはここだけ。乱数を引かず、時計も見ない。
 * 同じイベント列からは、いつも同じ世界ができる。
 */

const blankChar = (): Char => ({
  name: '',
  job: '',
  innate: zeroStats(),
  growth: zeroStats(),
  xp: zeroStats(),
  hp: 0,
  mind: 0,
  coins: 0,
  items: [],
  cards: [null, null, null, null, null],
  back: [],
  level: 0,
  perms: [],
  permEps: {},
  epithets: [],
  debts: {},
  deeds: {},
  titles: [],
  uid: 1,
});

export function emptyWorld(): World {
  return {
    v: '',
    seed: 0,
    rng: { map: 1, enc: 2, ai: 3, story: 4, rival: 5, gossip: 6, loot: 7, flavor: 8 },
    depth: 0,
    stratum: 1,
    hour: 0,
    map: [],
    pos: null,
    you: blankChar(),
    rival: {
      char: blankChar(),
      stratum: 1,
      row: -1,
      node: null,
      down: false,
      first: false,
      log: [],
    },
    minds: {},
    enc: null,
    pending: null,
    flags: {},
    goals: [],
    unlocked: [],
    seen: [],
    found: [],
    ending: null,
    seq: 0,
  };
}

const charOf = (w: World, who: Who) => (who === 'you' ? w.you : w.rival.char);

function mindOf(w: World, npc: string) {
  const m = w.minds[npc] ?? blankMind();
  w.minds[npc] = m;
  return m;
}

/** 振る舞いを数える（冠の元）。空の名前は数えない。 */
function deed(c: Char, ...names: string[]): void {
  for (const n of names) if (n) c.deeds[n] = (c.deeds[n] ?? 0) + 1;
}

export function apply(w: World, ev: Ev): void {
  w.seq++;
  // 見た者の認識世界を先に動かす（いまの盤面のまま見たことにする）。
  perceive(w, ev);
  switch (ev.type) {
    case 'run.started':
      w.seed = ev.seed;
      w.v = ev.v;
      w.depth = ev.depth;
      w.you = structuredClone(ev.you);
      w.rival.char = structuredClone(ev.rival);
      break;
    case 'rng':
      Object.assign(w.rng, ev.s);
      break;
    case 'map.built':
      w.stratum = ev.stratum;
      w.map = ev.nodes.map((n) => ({
        ...n,
        next: [...n.next],
        eps: [...n.eps],
        ...(n.stage ? { stage: [...n.stage] } : {}),
      }));
      w.pos = null;
      break;
    case 'time':
      w.hour += ev.hours;
      break;
    case 'moved':
      w.pos = ev.node;
      break;
    case 'node': {
      const n = w.map.find((x) => x.id === ev.id);
      if (n) {
        if (ev.visited !== undefined) n.visited = ev.visited;
        if (ev.rival !== undefined) n.rival = ev.rival;
      }
      break;
    }
    case 'pending':
      w.pending = ev.p ? structuredClone(ev.p) : null;
      break;
    case 'vital': {
      const c = charOf(w, ev.who);
      if (ev.hp) c.hp += ev.hp;
      if (ev.mind) c.mind += ev.mind;
      break;
    }
    case 'coins': {
      const c = charOf(w, ev.who);
      c.coins = Math.max(0, c.coins + ev.n);
      break;
    }
    case 'item': {
      const c = charOf(w, ev.who);
      if (ev.n > 0) c.items.push({ id: ev.id, uses: Math.max(1, ev.uses ?? 1) });
      else {
        const i = c.items.findIndex((x) => x.id === ev.id);
        if (i >= 0) c.items.splice(i, 1);
      }
      break;
    }
    case 'item.use': {
      const c = charOf(w, ev.who);
      const it = c.items[ev.index];
      if (!it) break;
      it.uses -= 1;
      if (it.uses <= 0) c.items.splice(ev.index, 1);
      break;
    }
    case 'xp':
      charOf(w, ev.who).xp[ev.stat] += ev.n;
      break;
    case 'grew': {
      const c = charOf(w, ev.who);
      (ev.innate ? c.innate : c.growth)[ev.stat] += ev.n ?? 1;
      break;
    }
    case 'perm': {
      const c = charOf(w, ev.who);
      if (ev.gain && !c.perms.includes(ev.id)) c.perms.push(ev.id);
      if (!ev.gain) c.perms = c.perms.filter((p) => p !== ev.id);
      break;
    }
    case 'card.use':
      deed(
        charOf(w, ev.who),
        ev.quiet ? 'quiet' : '',
        ev.spent ? 'spent' : '',
        ev.tags.includes('tech') ? 'tech' : '',
        'used',
      );
      if (w.enc) {
        if (!ev.quiet) w.enc.cards++;
        w.enc.last = [...ev.tags];
        w.enc.lastCard = ev.card;
      }
      break;
    case 'perm.ep': {
      const c = charOf(w, ev.who);
      const list = c.permEps[ev.perm] ?? [];
      const i = list.indexOf(ev.ep);
      c.permEps[ev.perm] = ev.on ? [...list, ev.ep] : list.filter((_, k) => k !== i);
      break;
    }
    case 'ep.held': {
      const c = charOf(w, ev.who);
      if (ev.n > 0) c.epithets.push(ev.ep);
      else {
        const i = c.epithets.indexOf(ev.ep);
        if (i >= 0) c.epithets.splice(i, 1);
      }
      break;
    }
    case 'card.ep': {
      const card = charOf(w, ev.who).cards[ev.slot];
      if (card) {
        // 同じエピテットは重ねて刻める。剥がすときは一つずつ。
        if (ev.on) card.eps = [...card.eps, ev.ep];
        else {
          const i = card.eps.indexOf(ev.ep);
          if (i >= 0) card.eps = card.eps.filter((_, k) => k !== i);
        }
      }
      break;
    }
    case 'card.uses': {
      const card = charOf(w, ev.who).cards[ev.slot];
      if (card) card.uses = Math.max(0, Math.min(card.max, card.uses + ev.n));
      break;
    }
    case 'card.max': {
      const card = charOf(w, ev.who).cards[ev.slot];
      if (card) card.max = Math.max(1, card.max + ev.n);
      break;
    }
    case 'card.mark': {
      const card = charOf(w, ev.who).cards[ev.slot];
      if (card) card.marks[ev.mark] = (card.marks[ev.mark] ?? 0) + ev.n;
      break;
    }
    case 'deck.add': {
      const c = charOf(w, ev.who);
      c.back.push(structuredClone(ev.card));
      c.uid = Math.max(c.uid, ev.card.uid + 1);
      break;
    }
    case 'deck.swap': {
      // 枠の札と後ろの札を入れ替える（枠の札は後ろの最後に回る）。
      const c = charOf(w, ev.who);
      const inn = c.back[ev.index];
      if (!inn) break;
      const out = c.cards[ev.slot] ?? null;
      c.back.splice(ev.index, 1);
      c.cards[ev.slot] = inn;
      if (out) {
        // 後ろへ回った札は「眠った」ことを覚えている（戻るときにエピテットが剥がれる）。
        out.marks.slept = (out.marks.slept ?? 0) + 1;
        c.back.push(out);
      }
      break;
    }
    case 'deck.uses': {
      const card = charOf(w, ev.who).back[ev.index];
      if (card) card.uses = Math.max(0, Math.min(card.max, card.uses + ev.n));
      break;
    }
    case 'deck.drop':
      charOf(w, ev.who).back.splice(ev.index, 1);
      break;
    case 'level':
      charOf(w, ev.who).level += ev.n;
      break;
    case 'card.set': {
      const c = charOf(w, ev.who);
      c.cards[ev.slot] = ev.card ? structuredClone(ev.card) : null;
      if (ev.card) c.uid = Math.max(c.uid, ev.card.uid + 1);
      break;
    }
    case 'debt': {
      const c = charOf(w, ev.who);
      c.debts[ev.npc] = Math.max(0, (c.debts[ev.npc] ?? 0) + ev.n);
      if (ev.n > 0) deed(c, 'debts');
      break;
    }
    case 'flag':
      w.flags[ev.key] = ev.v;
      break;
    case 'goal.set':
      w.goals = [...w.goals.filter((g) => g.size !== ev.goal.size), { ...ev.goal }];
      break;
    case 'goal.done':
      w.goals = w.goals.filter((g) => g.size !== ev.size);
      break;
    case 'unlock':
      if (!w.unlocked.includes(ev.story)) w.unlocked.push(ev.story);
      break;
    case 'story.seen':
      w.seen.push(ev.id);
      break;
    case 'found':
      if (!w.found.includes(ev.id)) w.found.push(ev.id);
      break;
    case 'enc.start':
      w.enc = {
        who: ev.who,
        foe: structuredClone(ev.foe),
        tier: ev.tier,
        turn: 1,
        phase: 'act',
        outcome: null,
        guard: 0,
        calm: 0,
        st: {},
        last: [],
        lastCard: null,
        cards: 0,
        lies: 0,
        caught: 0,
        stage: [...(ev.stage ?? [])],
      };
      break;
    case 'intent':
      if (w.enc) {
        w.enc.foe.move = ev.move;
        w.enc.foe.intent = { ...ev.intent };
        w.enc.foe.seen = false;
      }
      break;
    case 'foe':
      if (w.enc) {
        const f = w.enc.foe;
        if (ev.field === 'hostility') f.hostility = Math.max(0, Math.min(10, f.hostility + ev.n));
        else if (ev.field === 'trust') f.trust = Math.max(0, f.trust + ev.n);
        else if (ev.field === 'guard') f.guard = Math.max(0, f.guard + ev.n);
        else f[ev.field] += ev.n;
      }
      break;
    case 'foe.ep':
      if (w.enc && !w.enc.foe.eps.includes(ev.ep)) w.enc.foe.eps.push(ev.ep);
      break;
    case 'node.ep': {
      const n = w.map.find((x) => x.id === ev.id);
      if (n) n.eps = [...n.eps, ev.ep];
      break;
    }
    case 'foe.st':
      if (w.enc) {
        const st = w.enc.foe.st;
        st[ev.key] = (st[ev.key] ?? 0) + ev.n;
        if (!st[ev.key]) delete st[ev.key];
      }
      break;
    case 'enc.you':
      if (w.enc) w.enc[ev.field] = Math.max(0, w.enc[ev.field] + ev.n);
      break;
    case 'enc.st':
      if (w.enc) {
        w.enc.st[ev.key] = (w.enc.st[ev.key] ?? 0) + ev.n;
        if (!w.enc.st[ev.key]) delete w.enc.st[ev.key];
      }
      break;
    case 'clue':
      if (w.enc) {
        const c = w.enc.foe.clues.find((x) => x.id === ev.id && !!x.false === !!ev.false);
        if (c) c.shown = ev.shown;
        else w.enc.foe.clues.push({ id: ev.id, shown: ev.shown, false: ev.false });
      }
      break;
    case 'seen':
      if (w.enc) w.enc.foe.seen = true;
      break;
    case 'claim':
      if (w.enc) {
        w.enc.lies += ev.truth ? 0 : 1;
        deed(charOf(w, w.enc.who), ev.truth ? 'vows' : 'lies');
      }
      break;
    case 'caught':
      if (w.enc) {
        w.enc.caught++;
        deed(charOf(w, w.enc.who), 'caught');
      }
      break;
    case 'act':
      if (w.enc) w.enc.foe.history.push(ev.move);
      break;
    case 'turn':
      if (w.enc) {
        w.enc.turn++;
        w.enc.foe.guard = 0;
      }
      break;
    case 'enc.end':
      if (w.enc) {
        w.enc.outcome = ev.outcome;
        w.enc.phase = 'over';
        deed(charOf(w, w.enc.who), ev.outcome);
      }
      break;
    case 'enc.close':
      w.enc = null;
      break;
    case 'mind': {
      const m = mindOf(w, ev.npc);
      for (const [k, v] of Object.entries(ev.d)) {
        const key = k as keyof typeof ev.d;
        m[key] = Math.max(0, (m[key] ?? 0) + (v ?? 0));
      }
      if (ev.cards) m.cards = [...new Set([...m.cards, ...ev.cards])];
      if (ev.known) m.known = [...new Set([...m.known, ...ev.known])];
      if (ev.outcome) m.outcomes[ev.outcome] = (m.outcomes[ev.outcome] ?? 0) + 1;
      break;
    }
    case 'gossip': {
      const m = mindOf(w, ev.to);
      const d = ev.d;
      m.violent += d.violent ?? 0;
      m.kind += d.kind ?? 0;
      m.nosy += d.nosy ?? 0;
      m.honest += d.honest ?? 0;
      m.suspicion += d.suspicion ?? 0;
      m.heard += 1;
      if (d.cards) m.cards = [...new Set([...m.cards, ...d.cards])];
      if (d.known) m.known = [...new Set([...m.known, ...d.known])];
      break;
    }
    case 'rival': {
      const r = w.rival;
      if (ev.stratum !== undefined) r.stratum = ev.stratum;
      if (ev.row !== undefined) r.row = ev.row;
      if (ev.node !== undefined) r.node = ev.node;
      if (ev.down !== undefined) r.down = ev.down;
      if (ev.first !== undefined) r.first = ev.first;
      if (ev.log) r.log.push(ev.log);
      break;
    }
    case 'title': {
      const c = charOf(w, ev.who);
      if (!c.titles.includes(ev.id)) c.titles.push(ev.id);
      break;
    }
    case 'rival.char':
      w.rival.char = structuredClone(ev.char);
      break;
    case 'ending':
      w.ending = { ...ev.ending };
      break;
    default:
      break;
  }
}

export function fold(events: readonly Ev[], w: World = emptyWorld()): World {
  for (const ev of events) apply(w, ev);
  return w;
}

/** 世界の指紋（決定論の確かめ）。 */
export function hashWorld(w: World): string {
  const s = JSON.stringify(w);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}
