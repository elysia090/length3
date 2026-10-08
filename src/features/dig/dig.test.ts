import { describe, expect, it } from 'vitest';
import { OPS } from './content/fx';
import { LEGENDS } from './content/legends';
import { allCards, allEpithets, cardDef } from './content/registry';
import { SIGNATURES } from './content/signatures';
import { SURGES } from './content/surges';
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

  it('has twenty leading cards with three chapters each', () => {
    expect(LEGENDS).toHaveLength(20);
    for (const l of LEGENDS) {
      expect(cardDef(l.id).legend).toBe(l.title);
      expect(l.chapters).toHaveLength(3);
    }
    for (const id of Object.keys(SURGES)) expect(() => cardDef(id)).not.toThrow();
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
    const first = w.map.find((n) => n.row === 0 && n.npc);
    expect(first).toBeDefined();
    if (!first) return;
    g.dispatch({ c: 'move', node: first.id });
    if (!g.world.enc) return;
    const hp = g.world.enc.foe.hp;
    const out = g.dispatch({ c: 'card', slot: 0 });
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
