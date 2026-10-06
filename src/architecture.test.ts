import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 構成の約束を、読めば分かる形ではなく落ちるテストで持つ。
 *
 * - features/<名前>/ は一つの機能。外へ見せるのは index.ts だけ。
 *   ほかの機能もページも、index.ts を通してしか中へ入らない。
 * - shared/・i18n/・config/ は土台。機能・ページ・レイアウトを知らない。
 * - 機能はページとレイアウトを知らない（上から下へだけ依存する）。
 */

const SRC = resolve(import.meta.dirname);
const FEATURES = join(SRC, 'features');
const FOUNDATION = ['shared', 'i18n', 'config'].map((d) => join(SRC, d));
const UPPER = ['pages', 'layouts'].map((d) => join(SRC, d));
const IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(ts|astro|mdx)$/.test(name) ? [path] : [];
  });
}

function resolveImport(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const ext of ['', '.ts', '.astro', '.css', '/index.ts']) {
    const p = base + ext;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

const within = (path: string, dir: string) => path === dir || path.startsWith(dir + sep);
const featureOf = (path: string) =>
  within(path, FEATURES) ? relative(FEATURES, path).split(sep)[0] : null;

const edges = walk(SRC).flatMap((file) => {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(IMPORT)].flatMap((m) => {
    const target = resolveImport(file, m[1] ?? '');
    return target ? [{ file, target }] : [];
  });
});

const show = (e: { file: string; target: string }) =>
  `${relative(SRC, e.file)} → ${relative(SRC, e.target)}`;

describe('architecture', () => {
  it('enters another feature only through its index.ts', () => {
    const bad = edges.filter(({ file, target }) => {
      const to = featureOf(target);
      if (!to || featureOf(file) === to) return false;
      return target !== join(FEATURES, to, 'index.ts');
    });
    expect(bad.map(show)).toEqual([]);
  });

  it('keeps the foundation free of features, pages and layouts', () => {
    const bad = edges.filter(
      ({ file, target }) =>
        FOUNDATION.some((d) => within(file, d)) &&
        (within(target, FEATURES) || UPPER.some((d) => within(target, d))),
    );
    expect(bad.map(show)).toEqual([]);
  });

  it('never lets a feature reach up into pages or layouts', () => {
    const bad = edges.filter(
      ({ file, target }) => within(file, FEATURES) && UPPER.some((d) => within(target, d)),
    );
    expect(bad.map(show)).toEqual([]);
  });

  it('gives every feature a public index.ts', () => {
    const missing = readdirSync(FEATURES).filter(
      (name) =>
        statSync(join(FEATURES, name)).isDirectory() &&
        !existsSync(join(FEATURES, name, 'index.ts')),
    );
    expect(missing).toEqual([]);
  });
});
