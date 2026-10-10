import { describe, expect, it } from 'vitest';
import { OPS } from './content/fx';
import { LEGENDS } from './content/legends';
import { allCards, allEpithets, cardDef } from './content/registry';
import { SIGNATURES } from './content/signatures';
import { fold, hashWorld } from './core/reduce';
import { ARCHETYPES } from './core/tags';
import { decide } from './sim/decide';
import { Game } from './sim/game';
import { pilot } from './sim/pilot';
import { newCard } from './sim/run';

function play(g: Game, limit = 4000): void {
  for (let i = 0; i < limit && !g.world.ending; i++) {
    const c = pilot(g.world);
    if (!c || !g.dispatch(c).length) break;
  }
}

describe('scale', () => {
  it('keeps the vocabulary in its intended ranges', () => {
    const works = allCards().filter((d) => d.layer === 'archetype');
    const basics = allCards().filter((d) => d.layer === 'basic');
    expect(works).toHaveLength(100);
    expect(basics.length).toBeGreaterThanOrEqual(50);
    expect(basics.length).toBeLessThanOrEqual(100);
    expect(allEpithets().length).toBeGreaterThanOrEqual(30);
    expect(allEpithets().length).toBeLessThanOrEqual(60);
    expect(ARCHETYPES.length).toBeGreaterThanOrEqual(20);
    expect(ARCHETYPES.length).toBeLessThanOrEqual(30);
    const ops = Object.keys(OPS).length;
    expect(ops).toBeGreaterThanOrEqual(15);
    expect(ops).toBeLessThanOrEqual(25);
  });

  it('gives every work card a rule of its own', () => {
    for (const d of allCards().filter((x) => x.layer === 'archetype')) {
      const own = !!(d.passive?.length || d.triggers?.length || d.hidden || SIGNATURES[d.id]);
      expect(own, d.id).toBe(true);
    }
  });

  it('gives twenty cards a rule for each of their three levels', () => {
    expect(LEGENDS).toHaveLength(20);
    for (const l of LEGENDS) expect(cardDef(l.id).levels).toHaveLength(3);
  });
});

describe('determinism', () => {
  it('replays a whole run from its commands to the same world', () => {
    const g = Game.start(424242, 'watch');
    play(g);
    expect(g.verify()).toBe(true);
    const again = Game.load(g.save());
    expect(again?.hash()).toBe(g.hash());
  }, 60000);

  it('folds the event log into the same world', () => {
    const g = Game.start(777, 'reporter');
    play(g, 300);
    expect(hashWorld(fold(g.events))).toBe(g.hash());
  });

  it('refuses commands that do not apply, leaving no events', () => {
    const g = Game.start(1, 'nurse');
    expect(decide(g.world, { c: 'close' })).toEqual([]);
    expect(decide(g.world, { c: 'card', slot: 0 })).toEqual([]);
  });
});

describe('conversion', () => {
  it('turns overflowing healing into damage for a nurse with a tourniquet', () => {
    const g = Game.start(9, 'nurse');
    const w = g.world;
    w.you.cards[0] = newCard(900, 'overdose');
    // 遭遇のたびに五枚が配り直されるので、手持ちを枠の五枚だけにしておく。
    w.you.back = [];
    const first = w.map.find((n) => n.row === 0 && n.npc);
    expect(first).toBeDefined();
    if (!first) return;
    g.dispatch({ c: 'move', node: first.id });
    if (!g.world.enc) return;
    const hp = g.world.enc.foe.hp;
    const slot = g.world.you.cards.findIndex((c) => c?.id === 'overdose');
    expect(slot).toBeGreaterThanOrEqual(0);
    const out = g.dispatch({ c: 'card', slot });
    const hits = out.filter((e) => e.type === 'foe' && e.field === 'hp' && e.n < 0);
    expect(hits.length).toBeGreaterThan(0);
    expect(g.world.enc?.foe.hp ?? 0).toBeLessThan(hp);
  });
});

describe('branching', () => {
  it('never touches the real world from an encounter trial', async () => {
    const { act, actions, fork } = await import('./sim/ai');
    const { Tx } = await import('./core/tx');
    const g = Game.start(31337, 'watch');
    for (let i = 0; i < 400 && !g.world.ending; i++) {
      const w = g.world;
      if (w.enc?.phase === 'act') {
        const before = hashWorld(w);
        actions(w).forEach((a, k) => {
          const s = fork(w, k);
          act(new Tx(s, true), a);
        });
        expect(hashWorld(w)).toBe(before);
      }
      const c = pilot(w);
      if (!c || !g.dispatch(c).length) break;
    }
  }, 60000);
});

describe('copies', () => {
  it('hand-written copies equal a deep clone', async () => {
    const { branch, copyChar, copyEnc } = await import('./core/branch');
    const g = Game.start(4242, 'reporter');
    for (let i = 0; i < 600 && !g.world.ending; i++) {
      const w = g.world;
      expect(copyChar(w.you)).toEqual(structuredClone(w.you));
      if (w.enc) expect(copyEnc(w.enc)).toEqual(structuredClone(w.enc));
      if (i % 50 === 0) expect(branch(w)).toEqual(structuredClone(w));
      const c = pilot(w);
      if (!c || !g.dispatch(c).length) break;
    }
  }, 60000);
});

describe('agent report #103', () => {
  it('does not refill uses by peeling and re-inscribing the same epithet', () => {
    const g = Game.start(5, 'surveyor');
    const w = g.world;
    const card = w.you.cards[0];
    expect(card).toBeTruthy();
    if (!card) return;
    w.you.epithets.push('unworn');
    g.dispatch({ c: 'inscribe', ep: 'unworn', slot: 0 });
    const max = g.world.you.cards[0]?.max ?? 0;
    // 使い切った状態から、剥がして刻み直すを繰り返す。
    const c0 = g.world.you.cards[0];
    if (c0) c0.uses = 0;
    for (let i = 0; i < 3; i++) {
      g.dispatch({ c: 'peel', uid: card.uid, ep: 'unworn' });
      g.dispatch({ c: 'inscribe', ep: 'unworn', slot: 0 });
    }
    expect(g.world.you.cards[0]?.max).toBe(max);
    expect(g.world.you.cards[0]?.uses).toBe(0);
  });

  it('keeps the uses an epithet carries when the card still has them', () => {
    const g = Game.start(5, 'surveyor');
    const card = g.world.you.cards[0];
    if (!card) return;
    g.world.you.epithets.push('unworn');
    g.dispatch({ c: 'inscribe', ep: 'unworn', slot: 0 });
    const full = g.world.you.cards[0]?.uses ?? 0;
    g.dispatch({ c: 'peel', uid: card.uid, ep: 'unworn' });
    g.dispatch({ c: 'inscribe', ep: 'unworn', slot: 0 });
    expect(g.world.you.cards[0]?.uses).toBe(full);
  });

  it('lowers trust for cards whose effect lowers trust', () => {
    const g = Game.start(9, 'watch');
    const w = g.world;
    w.you.cards[0] = newCard(901, 'khnopff');
    w.you.back = [];
    const first = w.map.find((n) => n.row === 0 && n.npc);
    if (!first) return;
    g.dispatch({ c: 'move', node: first.id });
    const e = g.world.enc;
    if (!e || e.phase !== 'act' || e.who !== 'you') return;
    const slot = g.world.you.cards.findIndex((c) => c?.id === 'khnopff');
    const out = g.dispatch({ c: 'card', slot });
    const ups = out.filter((ev) => ev.type === 'foe' && ev.field === 'trust' && ev.n > 0);
    expect(ups).toHaveLength(0);
  });

  it('finds events in the repeating sections below B30', async () => {
    const { allStories } = await import('./content/registry');
    const { sectionNo } = await import('./content/floors');
    for (const stratum of [4, 5, 6]) {
      const theme = sectionNo(stratum);
      expect(allStories().some((s) => !s.locked && s.strata.includes(theme))).toBe(true);
    }
  });
});

describe('agent report #105', () => {
  it('raises every stat once when 2001 stacks to Ⅲ', async () => {
    const { Tx } = await import('./core/tx');
    const { addCard } = await import('./sim/run');
    const g = Game.start(11, 'projectionist');
    const w = g.world;
    w.you.cards[0] = newCard(950, 'odyssey');
    const before = { ...w.you.growth };
    const tx = new Tx(w);
    addCard(tx, 'odyssey', 'picked', 'you');
    addCard(tx, 'odyssey', 'picked', 'you');
    expect(w.you.cards[0]?.lv).toBe(3);
    for (const s of ['VIT', 'ATK', 'DEF', 'WIL', 'INT', 'AGI'] as const)
      expect(w.you.growth[s]).toBe(before[s] + 1);
    expect(w.flags.starchild).toBe(1);
  });

  it('keeps the heavy overcoat for the first blow when a card costs body', async () => {
    const { Tx } = await import('./core/tx');
    const { startEnc } = await import('./sim/encounter');
    const { cost, hurt } = await import('./sim/ops');
    const g = Game.start(12, 'watch');
    const w = g.world;
    w.you.items.push({ id: 'thick-coat', uses: 1 });
    const tx = new Tx(w);
    startEnc(tx, 'you', 'counterman', 'normal');
    cost(tx, 3, 0, 'you');
    expect(w.enc?.st.coat).toBeUndefined();
    const guard = w.enc?.guard ?? 0;
    const hp = w.you.hp;
    hurt(tx, 10 + guard);
    expect(hp - w.you.hp).toBeLessThan(10);
    expect(w.enc?.st.coat).toBe(1);
  });

  it('leaves the one-way ticket at 5% even against a calm opponent', async () => {
    const { Tx } = await import('./core/tx');
    const { leaveChance, startEnc } = await import('./sim/encounter');
    const g = Game.start(13, 'watch');
    const w = g.world;
    w.you.items.push({ id: 'one-way', uses: 1 });
    startEnc(new Tx(w), 'you', 'counterman', 'normal');
    expect(w.enc?.foe.hostility ?? 9).toBeLessThanOrEqual(2);
    expect(leaveChance(w)).toBe(5);
  });
});
