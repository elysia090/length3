import { describe, expect, it } from 'vitest';
import type { BlogPost } from './types';
import {
  buildTagResolver,
  buildTagRoutes,
  canonicalizeTagSlug,
  estimateReadingTime,
  formatDate,
  notDraft,
  processPost,
  toSlug,
} from './utils';

function makeEntry({
  body = '',
  description = 'desc',
  draft = false,
  id = 'post.mdx',
  lang = 'en',
  tags = [] as string[],
}: {
  body?: string;
  description?: string;
  draft?: boolean;
  id?: string;
  lang?: 'en' | 'ja';
  tags?: string[];
} = {}): BlogPost {
  return {
    id,
    body,
    data: {
      description,
      draft,
      lang,
      publishDate: new Date('2026-03-20T00:00:00Z'),
      tags,
      title: 'Title',
      updatedDate: undefined,
    },
  } as unknown as BlogPost;
}

describe('toSlug', () => {
  it('strips .mdx extension', () => {
    expect(toSlug('getting-started.mdx')).toBe('getting-started');
  });

  it('strips .md extension', () => {
    expect(toSlug('hello.md')).toBe('hello');
  });

  it('lowercases the result', () => {
    expect(toSlug('Hello-World.mdx')).toBe('hello-world');
  });

  it('leaves slugs without a known extension unchanged', () => {
    expect(toSlug('no-extension')).toBe('no-extension');
  });

  it('handles nested path IDs', () => {
    expect(toSlug('2026/getting-started.mdx')).toBe('2026/getting-started');
  });
});

describe('canonicalizeTagSlug', () => {
  it('normalizes whitespace and repeated hyphens', () => {
    expect(canonicalizeTagSlug(' TypeScript / JS ')).toBe('typescript-js');
  });

  it('preserves CJK characters', () => {
    expect(canonicalizeTagSlug('機械学習')).toBe('機械学習');
  });

  it('normalizes compatibility characters', () => {
    expect(canonicalizeTagSlug('Ａstro')).toBe('astro');
  });

  it('falls back to a stable hash when the slug would be empty', () => {
    expect(canonicalizeTagSlug('!!!')).toMatch(/^tag-[0-9a-f]{8}$/);
  });
});

describe('buildTagRoutes', () => {
  it('emits canonical routes only', () => {
    const routes = buildTagRoutes([makeEntry({ id: 'one.mdx', tags: ['TypeScript / JS'] })]);
    expect(routes).toEqual([
      {
        canonicalSlug: 'typescript-js',
        name: 'TypeScript / JS',
        posts: [expect.objectContaining({ id: 'one.mdx' })],
      },
    ]);
  });

  it('keeps empty slugs routable', () => {
    const routes = buildTagRoutes([makeEntry({ id: 'one.mdx', tags: ['!!!'] })]);
    expect(routes[0]?.canonicalSlug).toMatch(/^tag-[0-9a-f]{8}$/);
  });

  it('is stable regardless of post order when canonical bases collide', () => {
    const first = buildTagRoutes([
      makeEntry({ id: 'one.mdx', tags: ['foo-bar'] }),
      makeEntry({ id: 'two.mdx', tags: ['foo--bar'] }),
    ]).map(({ canonicalSlug, name }) => [name, canonicalSlug]);

    const second = buildTagRoutes([
      makeEntry({ id: 'two.mdx', tags: ['foo--bar'] }),
      makeEntry({ id: 'one.mdx', tags: ['foo-bar'] }),
    ]).map(({ canonicalSlug, name }) => [name, canonicalSlug]);

    expect(first).toEqual(second);
    expect(new Set(first.map(([, canonicalSlug]) => canonicalSlug)).size).toBe(2);
  });
});

describe('buildTagResolver', () => {
  it('resolves every tag to its canonical URL', () => {
    const resolver = buildTagResolver([makeEntry({ id: 'one.mdx', tags: ['TypeScript / JS'] })]);
    expect(resolver.linkFor('TypeScript / JS')).toEqual({
      href: '/tags/typescript-js',
      name: 'TypeScript / JS',
    });
  });

  it('throws when a tag is not part of the routing model', () => {
    const resolver = buildTagResolver([makeEntry({ id: 'one.mdx', tags: ['astro'] })]);
    expect(() => resolver.linkFor('missing')).toThrow('Unknown tag "missing".');
  });
});

describe('estimateReadingTime', () => {
  it('returns at least 1 for any input', () => {
    expect(estimateReadingTime('')).toBe(1);
    expect(estimateReadingTime('hi')).toBe(1);
  });

  it('200 Latin words → 1 min', () => {
    expect(estimateReadingTime('word '.repeat(200).trim())).toBe(1);
  });

  it('201 Latin words → 2 min (ceil)', () => {
    expect(estimateReadingTime('word '.repeat(201).trim())).toBe(2);
  });

  it('400 CJK chars → 1 min', () => {
    expect(estimateReadingTime('漢'.repeat(400))).toBe(1);
  });

  it('401 CJK chars → 2 min (ceil)', () => {
    expect(estimateReadingTime('漢'.repeat(401))).toBe(2);
  });

  it('mixed CJK + Latin accumulates both rates', () => {
    const text = `${'漢'.repeat(200)} ${'word '.repeat(100).trim()}`;
    expect(estimateReadingTime(text)).toBe(1);
  });

  it('multiple blank lines do not inflate word count', () => {
    const words = Array.from({ length: 200 }, () => 'word').join('\n\n');
    expect(estimateReadingTime(words)).toBe(1);
  });

  it('counts non-CJK tokens in code blocks the same way as prose tokens', () => {
    const text = `${'word '.repeat(100)}\n\n\`\`\`\ncode here\n\`\`\`\n\n${'word '.repeat(100)}`;
    expect(estimateReadingTime(text)).toBeGreaterThanOrEqual(1);
  });
});

describe('formatDate', () => {
  const dateOnlyValue = new Date('2026-03-20');
  const explicitUtcValue = new Date('2026-03-20T18:30:00Z');

  it('formats date-only values in UTC for en locale', () => {
    expect(formatDate(dateOnlyValue, 'en')).toBe('2026/03/20');
  });

  it('formats date-only values in UTC for ja locale', () => {
    expect(formatDate(dateOnlyValue, 'ja')).toBe('2026/03/20');
  });

  it('keeps explicit UTC timestamps stable for en locale', () => {
    expect(formatDate(explicitUtcValue, 'en')).toBe('2026/03/20');
  });

  it('keeps explicit UTC timestamps stable for ja locale', () => {
    expect(formatDate(explicitUtcValue, 'ja')).toBe('2026/03/20');
  });
});

describe('notDraft', () => {
  it('returns true for published posts', () => {
    expect(notDraft(makeEntry({ draft: false }))).toBe(true);
  });

  it('returns false for draft posts', () => {
    expect(notDraft(makeEntry({ draft: true }))).toBe(false);
  });
});

describe('processPost', () => {
  it('derives slug from entry id', () => {
    const entry = makeEntry({ id: 'hello.mdx', tags: ['astro'] });
    const result = processPost(entry, buildTagResolver([entry]));
    expect(result.slug).toBe('hello');
  });

  it('sets description from data.description', () => {
    const entry = makeEntry({ description: 'My excerpt', tags: ['astro'] });
    const result = processPost(entry, buildTagResolver([entry]));
    expect(result.description).toBe('My excerpt');
  });

  it('maps tags to canonical hrefs through the resolver', () => {
    const entry = makeEntry({ tags: ['TypeScript / JS'] });
    const result = processPost(entry, buildTagResolver([entry]));
    expect(result.tags).toEqual([{ href: '/tags/typescript-js', name: 'TypeScript / JS' }]);
  });

  it('readingTime is at least 1', () => {
    const entry = makeEntry({ tags: ['astro'] });
    const result = processPost(entry, buildTagResolver([entry]));
    expect(result.readingTime).toBeGreaterThanOrEqual(1);
  });

  it('preserves the original entry reference', () => {
    const entry = makeEntry({ body: 'body text', tags: ['astro'] });
    expect(processPost(entry, buildTagResolver([entry])).entry).toBe(entry);
  });
});
