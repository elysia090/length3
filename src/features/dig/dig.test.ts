import { describe, expect, it } from 'vitest';
import { autoPlay } from './engine/ai';
import { basic, createEncounter, useCard } from './engine/enc';
import { ORIGINS } from './engine/origins';
import { activeDef, allActives, allNpcs, allPerms, permDef } from './engine/registry';
import { autoStep, makeCharacter, newRun, statsOf } from './engine/run';

const setup = (npc: string, origin = 'surveyor') => {
  const you = makeCharacter(origin, 'あなた');
  return createEncounter({
    seed: 7,
    you,
    stats: statsOf(you),
    npc,
    tier: 'normal',
    depth: 0,
    stratum: 1,
    hour: 0,
  });
};

describe('dig content', () => {
  it('refers only to things that exist', () => {
    for (const c of allActives()) {
      for (const to of [c.alter?.care?.to, c.alter?.overuse?.to, c.alter?.secret?.to]) {
        if (to) expect(() => activeDef(to), `${c.id} → ${to}`).not.toThrow();
      }
      if (c.shift?.perm) expect(permDef(c.shift.perm), c.id).toBeDefined();
    }
    for (const n of allNpcs()) {
      for (const id of [...n.clues, ...n.take]) expect(permDef(id), `${n.id}: ${id}`).toBeDefined();
      for (const r of Object.values(n.rewards))
        if (r?.perm) expect(permDef(r.perm), n.id).toBeDefined();
    }
    for (const o of ORIGINS) {
      for (const id of o.cards) expect(() => activeDef(id)).not.toThrow();
      for (const id of o.perms) expect(permDef(id)).toBeDefined();
    }
    expect(allPerms().length).toBeGreaterThan(40);
  });
});

describe('cards: READY → SPENT', () => {
  it('keeps a spent card usable, with its own effect and a cost', () => {
    const e = setup('watchman');
    const slot = e.cards.findIndex((c) => c?.id === 'observe');
    const card = e.cards[slot];
    if (!card) throw new Error('no observe');
    card.uses = 0;
    expect(useCard(e, slot)).toBe(true);
    expect(card.marks.spent).toBe(1);
    expect(e.npc.clues.some((c) => c.shown)).toBe(true);
  });

  it('flee spent always escapes but loses an item', () => {
    const e = setup('watchman');
    const slot = e.cards.findIndex((c) => c?.id === 'flee');
    const card = e.cards[slot];
    if (!card) throw new Error('no flee');
    card.uses = 0;
    const items = e.you.items.length;
    useCard(e, slot);
    expect(e.outcome).toBe('left');
    expect(e.you.items.length).toBe(items - 1);
  });

  it('the opponent announces a move and lies about some', () => {
    const e = setup('watchman');
    expect(e.npc.intent).not.toBeNull();
    basic(e, 'brace');
    expect(e.turn).toBe(2);
  });
});

describe('runs', () => {
  it('play to an end, with the rival digging the same map', () => {
    const results: string[] = [];
    let alters = 0;
    let perms = 0;
    let met = 0;
    for (let seed = 1; seed <= 9; seed++) {
      const origin = ORIGINS[seed % ORIGINS.length]?.id ?? 'surveyor';
      const r = newRun({ seed, origin, depth: 0 });
      let guard = 0;
      while (!r.ending && guard++ < 400) autoStep(r);
      expect(r.ending, `seed ${seed}`).not.toBeNull();
      results.push(`${origin}:${r.ending?.title}@${r.stratum}`);
      alters += r.stats.alters;
      perms += r.you.permanents.length;
      if (r.rival.met) met++;
    }
    console.log(results.join(' '), { alters, perms, met });
    expect(perms).toBeGreaterThan(9 * 3);
  });

  it('decides fast enough on the main thread', () => {
    const e = setup('last-customer');
    const t0 = performance.now();
    autoPlay(e, 20);
    expect(performance.now() - t0).toBeLessThan(4000);
  });
});
