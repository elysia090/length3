/**
 * 時刻。世界の hour は区画に着いてからの経過時間（22 時に 0）。夜は明けて、
 * 朝・昼・夕を過ぎて、また夜になる（締め切りはない。繰り返すだけ）。
 * 「深夜」の効き目は、夜が来るたびにまた効く。
 */

export type Phase = 'night' | 'deep' | 'morning' | 'day' | 'evening';

/** 時計の時（0〜23）。 */
export const clockOf = (hour: number): number => (((22 + hour) % 24) + 24) % 24;

/** 深夜（0 時〜6 時）。 */
export const isDeep = (hour: number): boolean => clockOf(hour) < 6;

/** 深夜に入ってから何時間たったか（深夜でなければ -1）。 */
export const deepHours = (hour: number): number => (isDeep(hour) ? clockOf(hour) : -1);

/** 朝（6 時〜10 時）。 */
export const isMorning = (hour: number): boolean => {
  const c = clockOf(hour);
  return c >= 6 && c < 10;
};

export function phaseOf(hour: number): Phase {
  const c = clockOf(hour);
  if (c < 6) return 'deep';
  if (c < 10) return 'morning';
  if (c < 17) return 'day';
  if (c < 20) return 'evening';
  return 'night';
}

export const PHASE_NAME: Readonly<Record<Phase, string>> = {
  night: '夜',
  deep: '深夜',
  morning: '朝',
  day: '昼',
  evening: '夕',
};
