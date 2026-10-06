import { describe, expect, it } from 'vitest';
import { archiveSceneAt, CUT, litAt } from './choreo';
import { buildArchive, MAX_EDGE } from './layout';

const sources = [83, 68, 28, 24, 24, 8, 14, 6, 5].map((minutes, i) => ({
  slug: `p${i}`,
  number: 9 - i,
  minutes,
  date: '2026.08.07',
}));
const idle = { hover: -1, litSince: 0, thrown: -1, thrownAt: 0 };

describe('archive layout', () => {
  it('gives every article its own cell, newest first', () => {
    const a = buildArchive(sources);
    const cells = new Set(a.specimens.map((s) => `${s.x},${s.z}`));
    expect(cells.size).toBe(sources.length);
    expect(a.specimens[0]?.slug).toBe('p0');
  });

  it('sizes each cube by the cube root of its reading time', () => {
    const a = buildArchive(sources);
    expect(a.specimens[0]?.edge).toBeCloseTo(MAX_EDGE, 6);
    expect(a.specimens[8]?.edge).toBeCloseTo(MAX_EDGE * Math.cbrt(5 / 83), 6);
    expect(a.volume).toBe(260);
  });
});

describe('archive choreography', () => {
  it('moves the spotlight once per cut, and a hover takes it over', () => {
    expect(litAt(0, 9, idle)).toBe(0);
    expect(litAt(CUT * 2 + 0.1, 9, idle)).toBe(2);
    expect(litAt(CUT * 9, 9, idle)).toBe(0);
    expect(litAt(1, 9, { ...idle, hover: 5 })).toBe(5);
  });

  it('lights exactly one cube with volume when still', () => {
    const a = buildArchive(sources);
    const scene = archiveSceneAt(0, a, idle, true);
    expect(scene.cubes.filter((c) => !c.landed)).toHaveLength(1);
    expect(scene.cubes.every((c) => c.airborne === 0)).toBe(true);
  });

  it('throws the pressed cube up and towards the camera', () => {
    const a = buildArchive(sources);
    const pressed = { hover: 3, litSince: 0, thrown: 3, thrownAt: 1 };
    const before = archiveSceneAt(1, a, pressed, false).cubes[3];
    const after = archiveSceneAt(1.5, a, pressed, false).cubes[3];
    expect(after?.base[1]).toBeGreaterThan(before?.base[1] ?? 0);
    expect(after?.base[2]).toBeGreaterThan(before?.base[2] ?? 0);
  });
});
