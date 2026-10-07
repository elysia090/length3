/**
 * アーカイブを床に並べる。記事 1 本が立方体 1 個で、一辺は読了時間の
 * 立方根（いちばん長い記事が MAX_EDGE）。一覧の台帳の立方体と同じ物差し。
 *
 * 新しい順に、手前の列の左から。区画は 2 単位四方で、立方体はその中央に
 * 置く。大きさは不揃いでも、区画の格子は揃っている。
 */

export interface ArchiveSource {
  slug: string;
  number: number;
  minutes: number;
  date: string;
}

export interface Specimen extends ArchiveSource {
  x: number;
  z: number;
  edge: number;
}

export const CELL = 2;
export const MAX_EDGE = 1.55;
export const MAX_SPECIMENS = 24;

export interface Archive {
  specimens: Specimen[];
  cols: number;
  rows: number;
  /** 床の上で占める広さ（単位）。 */
  width: number;
  depth: number;
  /** 総体積（分）。L = ∛V。 */
  volume: number;
}

export function buildArchive(newestFirst: readonly ArchiveSource[]): Archive {
  const sources = newestFirst.slice(0, MAX_SPECIMENS);
  const n = Math.max(1, sources.length);
  const cols = Math.min(6, Math.max(2, Math.ceil(Math.sqrt(n * 1.8))));
  const rows = Math.ceil(n / cols);
  const max = Math.max(1, ...sources.map((s) => s.minutes));
  const specimens = sources.map((s, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      ...s,
      x: (col - (cols - 1) / 2) * CELL,
      // 手前（カメラ側、+z）から奥へ。
      z: ((rows - 1) / 2 - row) * CELL,
      edge: MAX_EDGE * Math.cbrt(Math.max(1, s.minutes) / max),
    };
  });
  return {
    specimens,
    cols,
    rows,
    width: cols * CELL,
    depth: rows * CELL,
    volume: newestFirst.reduce((sum, s) => sum + Math.max(0, s.minutes), 0),
  };
}
