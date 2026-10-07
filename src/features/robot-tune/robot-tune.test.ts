import { describe, expect, it } from 'vitest';
import { HIT, INTRO_SLOTS, LOOP_THROWS, sceneAt } from './choreo';
import { INTRO_SEC, LOOP_ACCENTS, LOOP_ONSET_SEC, LOOP_SEC, LOOP_SILENCES } from './envelope';
import { comparison, formatLength, formatVolume, groupDigits, unitCount } from './scale';
import {
  BEATS_PER_LOOP,
  BPM,
  beatAt,
  EIGHTH_SEC,
  INTRO_BEATS,
  LOOP_EIGHTHS,
  silenceStart,
} from './timeline';

describe('timeline (measured by scripts/robot-tune/bake.ts)', () => {
  it('divides the loop into a whole number of measured eighth notes', () => {
    expect(Number.isInteger(LOOP_EIGHTHS)).toBe(true);
    expect(LOOP_EIGHTHS * EIGHTH_SEC).toBeCloseTo(LOOP_SEC, 9);
    expect(LOOP_ACCENTS).toHaveLength(LOOP_EIGHTHS);
    // 測った値の大まかな範囲。テンポを決め打ちするための検査ではない。
    expect(BPM).toBeGreaterThan(120);
    expect(BPM).toBeLessThan(200);
  });

  it('keeps the beat continuous where the intro hands over to the loop', () => {
    const before = beatAt(INTRO_SEC - 1e-6);
    const after = beatAt(INTRO_SEC + 1e-6);
    expect(Math.abs(after - before)).toBeLessThan(0.05);
  });

  it('puts every loop head on INTRO_BEATS + n × BEATS_PER_LOOP', () => {
    for (const n of [0, 1, 7]) {
      const pos = INTRO_SEC + n * LOOP_SEC + LOOP_ONSET_SEC;
      expect(beatAt(pos)).toBeCloseTo(INTRO_BEATS + n * BEATS_PER_LOOP, 3);
    }
  });

  it('freezes at the start of a silence', () => {
    expect(silenceStart(0.2)).toBe(0);
    expect(silenceStart(0.5)).toBeNull();
    const [s0] = LOOP_SILENCES[0] ?? [0, 0];
    expect(silenceStart(INTRO_SEC + LOOP_SEC + s0 + 0.01)).toBeCloseTo(
      INTRO_SEC + LOOP_SEC + s0,
      6,
    );
  });
});

describe('choreography', () => {
  const key = (c: readonly number[]) => c.join(',');

  it('builds 3³ from 1 + 7 + 19 in the intro and in every loop', () => {
    expect(new Set(INTRO_SLOTS.map(key)).size).toBe(27);
    const loopCells = LOOP_THROWS.flatMap((t) => t.cells.map(key));
    expect(new Set(['0,0,0', ...loopCells]).size).toBe(27);
  });

  it('never stacks a cube over an empty cell', () => {
    const order = [[0, 0, 0] as const, ...LOOP_THROWS.flatMap((t) => t.cells)];
    for (const slots of [INTRO_SLOTS, order]) {
      slots.forEach(([x, y, z], i) => {
        if (y === 0) return;
        const below = slots.findIndex((c) => c[0] === x && c[1] === y - 1 && c[2] === z);
        expect(below).toBeGreaterThanOrEqual(0);
        expect(below).toBeLessThan(i);
      });
    }
  });

  it('lands every scoop on a strong measured onset, and gives every strong onset a landing', () => {
    const lands = LOOP_THROWS.map((t) => t.land);
    for (const t of LOOP_THROWS) {
      expect(LOOP_ACCENTS[t.land]).toBeGreaterThanOrEqual(HIT);
      expect(t.scoop).toBeLessThan(t.launch);
      expect(t.launch).toBeLessThan(t.land);
      expect(t.land).toBeLessThan(LOOP_EIGHTHS);
    }
    LOOP_ACCENTS.forEach((a, e) => {
      if (e > 0 && a >= HIT) expect(lands).toContain(e);
    });
    // 前半で 2³ の殻、後半で 3³ の殻。
    const half = LOOP_EIGHTHS / 2;
    const count = (pred: (land: number) => boolean) =>
      LOOP_THROWS.filter((t) => pred(t.land)).reduce((n, t) => n + t.cells.length, 0);
    expect(count((l) => l < half)).toBe(7);
    expect(count((l) => l >= half)).toBe(19);
  });

  it('completes 3³ at beat 27, and again inside every loop', () => {
    expect(sceneAt(26.9).count).toBe(26);
    expect(sceneAt(27.01).count).toBe(27);
    const head = sceneAt(INTRO_BEATS + 0.01);
    expect(head.count).toBe(1);
    const last = LOOP_THROWS[LOOP_THROWS.length - 1];
    const full = sceneAt(INTRO_BEATS + (last?.land ?? 0) / 2 + 0.2);
    expect(full.count).toBe(27);
    const next = sceneAt(INTRO_BEATS + BEATS_PER_LOOP + 0.01);
    expect(next.level).toBe(head.level + 1);
    expect(next.count).toBe(1);
  });

  it('keeps the volume continuous through the renormalisation', () => {
    const v = (b: number) => {
      const s = sceneAt(b);
      return unitCount(s.level, s.count);
    };
    expect(v(INTRO_BEATS - 0.01)).toBe(27n);
    expect(v(INTRO_BEATS + 0.01)).toBe(27n);
    expect(v(INTRO_BEATS + BEATS_PER_LOOP - 0.01)).toBe(27n ** 2n);
    expect(v(INTRO_BEATS + BEATS_PER_LOOP + 0.01)).toBe(27n ** 2n);
  });
});

describe('scale', () => {
  it('formats lengths and volumes in climbing units', () => {
    expect(formatLength(1)).toBe('1 cm');
    expect(formatLength(729)).toBe('7.29 m');
    expect(formatVolume(729)).toBe('729 mL');
    expect(formatVolume(27 ** 3)).toBe('19.7 L');
    expect(formatVolume(27 ** 6)).toBe('387 m³');
  });

  it('counts unit cubes without losing digits', () => {
    expect(groupDigits(unitCount(20, 1))).toBe(groupDigits(27n ** 20n));
    expect(unitCount(61, 1).toString().length).toBe(88);
  });

  it('has something to say past the observable universe', () => {
    expect(comparison(61)).toContain('観測可能な宇宙');
    expect(comparison(80)).toBeDefined();
  });
});
