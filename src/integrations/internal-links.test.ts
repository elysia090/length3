import { describe, expect, it } from 'vitest';
import {
  foldInternalHref,
  isKnownRoute,
  readBlogSlugs,
  rehypeInternalLinks,
} from './internal-links';

const SITE = 'https://length3.com';

function anchor(href: string) {
  return { type: 'element', tagName: 'a', properties: { href }, children: [] };
}

function tree(...children: ReturnType<typeof anchor>[]) {
  return { type: 'root', children };
}

function run(href: string, knownRoutes: string[] = ['27-byte-vm-parallel-radix-sort']) {
  const node = anchor(href);
  rehypeInternalLinks({ site: SITE, knownRoutes })(tree(node), { path: '/repo/post.mdx' });
  return node.properties.href;
}

describe('foldInternalHref', () => {
  it('folds an address-bar URL for this site to a site path', () => {
    expect(foldInternalHref(`${SITE}/tail-byte-quotient-csr-map-rank`, SITE)).toBe(
      '/tail-byte-quotient-csr-map-rank',
    );
  });

  it('accepts the www and http spellings of the same host', () => {
    expect(foldInternalHref('http://www.length3.com/about', SITE)).toBe('/about');
  });

  it('keeps the query and the fragment', () => {
    expect(foldInternalHref(`${SITE}/japanese-test?x=1#見出し`, SITE)).toBe(
      '/japanese-test?x=1#見出し',
    );
  });

  it('drops .html and a trailing slash, matching trailingSlash: never', () => {
    expect(foldInternalHref(`${SITE}/about.html`, SITE)).toBe('/about');
    expect(foldInternalHref(`${SITE}/tags/astro/`, SITE)).toBe('/tags/astro');
    expect(foldInternalHref(`${SITE}/index.html`, SITE)).toBe('/');
    expect(foldInternalHref('/about/', SITE)).toBe('/about');
  });

  it('leaves the root alone', () => {
    expect(foldInternalHref(`${SITE}/`, SITE)).toBe('/');
    expect(foldInternalHref('/', SITE)).toBeNull();
  });

  it('leaves other origins, anchors, and mail links untouched', () => {
    expect(foldInternalHref('https://pagefind.app/', SITE)).toBeNull();
    expect(foldInternalHref('https://length3.example.com/foo', SITE)).toBeNull();
    expect(foldInternalHref('#section', SITE)).toBeNull();
    expect(foldInternalHref('mailto:someone@example.com', SITE)).toBeNull();
  });
});

describe('isKnownRoute', () => {
  const routes = new Set(['/getting-started']);

  it('accepts articles, static pages, and tag pages', () => {
    expect(isKnownRoute('/getting-started', routes)).toBe(true);
    expect(isKnownRoute('/about', routes)).toBe(true);
    expect(isKnownRoute('/', routes)).toBe(true);
    expect(isKnownRoute('/tags/astro', routes)).toBe(true);
    expect(isKnownRoute('#anchor-only', routes)).toBe(true);
  });

  it('rejects a slug that is not a page', () => {
    expect(isKnownRoute('/getting-startd', routes)).toBe(false);
  });
});

describe('rehypeInternalLinks', () => {
  it('rewrites the href in place', () => {
    expect(run(`${SITE}/27-byte-vm-parallel-radix-sort`)).toBe('/27-byte-vm-parallel-radix-sort');
  });

  it('keeps an external link as authored', () => {
    expect(run('https://pagefind.app/')).toBe('https://pagefind.app/');
  });

  it('fails the build on a slug that does not exist, naming the file', () => {
    expect(() => run(`${SITE}/27-byte-vm-parallel-radix-sortt`)).toThrow(/post\.mdx/);
  });

  it('reads the real article slugs when none are supplied', () => {
    expect(readBlogSlugs()).toContain('27-byte-vm-parallel-radix-sort');
  });
});
