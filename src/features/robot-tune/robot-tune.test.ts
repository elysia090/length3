import { describe, expect, it } from 'vitest';
import { INTRO_SLOTS, LOOP_SLOTS, sceneAt } from './choreo';
import { INTRO_SEC, LOOP_SEC } from './envelope';
import { comparison, formatLength, formatVolume, groupDigits, unitCount } from './scale';
import { BEAT_SEC, BEATS_PER_LOOP, beatAt, INTRO_BEATS, silenceStart } from './timeline';

describe('timeline', () => {
  it('counts the loop as exactly 13 beats at 166 BPM', () => {
    expect(BEAT_SEC * BEATS_PER_LOOP).toBeCloseTo(LOOP_SEC, 9);
    expect(60 / BEAT_SEC).toBeCloseTo(166, 0);
  });

  it('keeps the beat continuous where the intro hands over to the loop', () => {
    const before = beatAt(INTRO_SEC - 1e-6);
    const after = beatAt(INTRO_SEC + 1e-6);
    expect(Math.abs(after - before)).toBeLessThan(0.01);
  });

  it('puts every loop downbeat on 33 + 13n', () => {
    for (const n of [0, 1, 7]) {
      const downbeat = INTRO_BEATS + n * BEATS_PER_LOOP;
      const pos = INTRO_SEC + n * LOOP_SEC + 0.126;
      expect(beatAt(pos)).toBeCloseTo(downbeat, 1);
    }
  });

  it('freezes at the start of the silence, reaching back across the file boundary', () => {
    expect(silenceStart(0.2)).toBe(0);
    expect(silenceStart(0.5)).toBeNull();
    // ループ 1 周目の頭の無音は、イントロ末尾の無音の続き。
    const first = silenceStart(INTRO_SEC + 0.05);
    expect(first).not.toBeNull();
    expect(first ?? 0).toBeLessThan(INTRO_SEC);
    // 2 周目以降はループの頭から。
    expect(silenceStart(INTRO_SEC + LOOP_SEC + 0.05)).toBeCloseTo(INTRO_SEC + LOOP_SEC, 6);
  });
});

describe('choreography', () => {
  it('fills every cell of 3³ exactly once', () => {
    const key = (c: readonly number[]) => c.join(',');
    expect(new Set(INTRO_SLOTS.map(key)).size).toBe(27);
    expect(new Set(LOOP_SLOTS.map(key)).size).toBe(26);
    expect(LOOP_SLOTS.some((c) => key(c) === '0,0,0')).toBe(false);
  });

  it('never stacks a cube over an empty cell', () => {
    for (const slots of [INTRO_SLOTS, [[0, 0, 0] as const, ...LOOP_SLOTS]]) {
      slots.forEach(([x, y, z], i) => {
        if (y === 0) return;
        const below = slots.findIndex((c) => c[0] === x && c[1] === y - 1 && c[2] === z);
        expect(below).toBeGreaterThanOrEqual(0);
        expect(below).toBeLessThan(i);
      });
    }
  });

  it('completes 3³ at beat 27 and again at every loop downbeat', () => {
    expect(sceneAt(26.9).count).toBe(26);
    expect(sceneAt(27.01).count).toBe(27);
    const last = sceneAt(INTRO_BEATS + BEATS_PER_LOOP - 0.01);
    expect(last.count).toBe(26);
    const next = sceneAt(INTRO_BEATS + BEATS_PER_LOOP + 0.01);
    expect(next.level).toBe(last.level + 1);
    expect(next.count).toBe(1);
  });

  it('keeps the volume continuous through the renormalisation', () => {
    const v = (b: number) => {
      const s = sceneAt(b);
      return unitCount(s.level, s.count);
    };
    // 27 個目が着地した直後と、数え直した直後は同じ体積。
    expect(v(INTRO_BEATS - 0.01)).toBe(27n);
    expect(v(INTRO_BEATS + 0.01)).toBe(27n);
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
