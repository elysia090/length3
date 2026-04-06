import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildSyntheticSearchHtml,
  collectIndexablePathnames,
  getContentType,
  isJapaneseLanguage,
  readDocumentLanguage,
  resolvePagefindAssetPath,
  segmentJapaneseSearchText,
  toContentSlug,
  toOutputHtmlPath,
  toPagefindUrl,
} from './segmented-pagefind';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('segmentJapaneseSearchText', () => {
  it('segments Japanese search text into word-like units', () => {
    expect(segmentJapaneseSearchText('ウェブにおける日本語タイポグラフィ')).toBe(
      'ウェブ における 日本語 タイポグラフィ',
    );
  });

  it('leaves non-Japanese text unchanged', () => {
    expect(segmentJapaneseSearchText('astro pagefind')).toBe('astro pagefind');
  });
});

describe('buildSyntheticSearchHtml', () => {
  it('passes through non-Japanese documents without code blocks unchanged', () => {
    const html = `<!doctype html><html lang="en"><head><title>Astro Pagefind</title></head><body><article data-pagefind-body>Astro Pagefind</article></body></html>`;

    expect(buildSyntheticSearchHtml(html)).toBe(html);
  });

  it('passes through pages without a pagefind body unchanged', () => {
    const html = `<!doctype html><html lang="ja"><head><title>日本語タイポグラフィ</title></head><body><main>本文なし</main></body></html>`;

    expect(buildSyntheticSearchHtml(html)).toBe(html);
  });

  it('adds data-pagefind-ignore to pre elements in non-Japanese documents', () => {
    const html = `<!doctype html><html lang="en"><head><title>Code Example</title></head><body><article data-pagefind-body><p>Some text</p><pre><code>div { color: red; }</code></pre></article></body></html>`;

    const result = buildSyntheticSearchHtml(html);

    expect(result).toContain('data-pagefind-ignore');
    expect(result).toContain('<pre data-pagefind-ignore');
    expect(result).toContain('Some text');
  });

  it('only ignores pre elements inside the pagefind body', () => {
    const html = `<!doctype html><html lang="en"><head><title>Code Example</title></head><body><pre><code>outside body</code></pre><article data-pagefind-body><pre><code>inside body</code></pre></article></body></html>`;

    const result = buildSyntheticSearchHtml(html);

    // Only the pre inside data-pagefind-body should get data-pagefind-ignore
    const insideMatch = result.match(/<article[^>]*>[\s\S]*?<\/article>/);
    expect(insideMatch?.[0]).toContain('data-pagefind-ignore');
  });

  it('segments Japanese searchable text and skips ignored nodes', () => {
    const html = `<!doctype html><html lang="ja"><head><title>日本語タイポグラフィ</title></head><body><article data-pagefind-body>日本語タイポグラフィ<span data-pagefind-ignore>除外テキスト</span><script>const message = "日本語";</script></article></body></html>`;

    const result = buildSyntheticSearchHtml(html);

    expect(result).toContain('<html lang="en">');
    expect(result).toContain('<title>日本語 タイポグラフィ</title>');
    expect(result).toContain('日本語 タイポグラフィ');
    expect(result).toContain('除外テキスト');
    expect(result).toContain('const message = "日本語";');
    expect(result).not.toContain('除外 テキスト');
  });

  it('adds data-pagefind-ignore to pre elements in Japanese documents', () => {
    const html = `<!doctype html><html lang="ja"><head><title>コード例</title></head><body><article data-pagefind-body><p>本文テキスト</p><pre><code>.cls { color: red; }</code></pre></article></body></html>`;

    const result = buildSyntheticSearchHtml(html);

    expect(result).toContain('<pre data-pagefind-ignore');
    expect(result).toContain('本文 テキスト');
  });
});

describe('content-driven page selection', () => {
  it('targets only built article pages from the blog content directory', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'segmented-pagefind-'));
    tempDirs.push(projectRoot);

    const blogDir = path.join(projectRoot, 'src', 'content', 'blog', 'nested');
    await mkdir(blogDir, { recursive: true });
    await writeFile(
      path.join(projectRoot, 'src', 'content', 'blog', 'getting-started.mdx'),
      '---\n---',
    );
    await writeFile(path.join(blogDir, 'deep-dive.md'), '---\n---');

    await expect(
      collectIndexablePathnames(projectRoot, [
        { pathname: '/' },
        { pathname: '/about' },
        { pathname: '/getting-started/' },
        { pathname: '/nested/deep-dive' },
      ]),
    ).resolves.toEqual(['/getting-started', '/nested/deep-dive']);
  });

  it('derives slugs and output paths deterministically', () => {
    expect(toContentSlug(path.join('nested', 'Deep-Dive.mdx'))).toBe('nested/deep-dive');
    expect(toOutputHtmlPath('/tmp/out', '/')).toBe(path.join('/tmp/out', 'index.html'));
    expect(toOutputHtmlPath('/tmp/out', '/nested/deep-dive/')).toBe(
      path.join('/tmp/out', 'nested', 'deep-dive.html'),
    );
  });
});

describe('document language helpers', () => {
  it('detects Japanese language values', () => {
    expect(isJapaneseLanguage('ja')).toBe(true);
    expect(isJapaneseLanguage('ja-JP')).toBe(true);
    expect(isJapaneseLanguage('en')).toBe(false);
    expect(isJapaneseLanguage(undefined)).toBe(false);
  });

  it('reads the html lang attribute', () => {
    expect(readDocumentLanguage('<html lang="ja">')).toBe('ja');
    expect(readDocumentLanguage('<html class="site" lang="ja-JP">')).toBe('ja-JP');
    expect(readDocumentLanguage('<html>')).toBeUndefined();
  });
});

describe('path helpers', () => {
  it('guards pagefind asset resolution against traversal', () => {
    const pagefindDir = path.resolve('/tmp/pagefind');

    expect(resolvePagefindAssetPath(pagefindDir, '/pagefind/pagefind-ui.js')).toBe(
      path.join(pagefindDir, 'pagefind-ui.js'),
    );
    expect(resolvePagefindAssetPath(pagefindDir, '/pagefind/../secret.txt')).toBeNull();
    expect(resolvePagefindAssetPath(pagefindDir, '/search/pagefind-ui.js')).toBeNull();
  });

  it('maps build output paths to canonical pagefind urls', () => {
    expect(toPagefindUrl('index.html')).toBe('/');
    expect(toPagefindUrl(path.join('tags', 'index.html'))).toBe('/tags');
    expect(toPagefindUrl('getting-started.html')).toBe('/getting-started');
  });

  it('returns a stable content type for pagefind assets', () => {
    expect(getContentType('pagefind-ui.js')).toBe('text/javascript; charset=utf-8');
    expect(getContentType('pagefind.wasm')).toBe('application/wasm');
    expect(getContentType('pagefind.bin')).toBe('application/octet-stream');
  });
});
