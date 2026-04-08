import { describe, expect, it } from 'vitest';
import { buildBlogCatalog } from './catalog';
import type { BlogPost } from './types';

function makeEntry({
  id,
  publishDate,
  tags,
}: {
  id: string;
  publishDate: string;
  tags: string[];
}): BlogPost {
  return {
    body: '',
    data: {
      description: `${id} description`,
      draft: false,
      lang: 'en',
      publishDate: new Date(publishDate),
      tags,
      title: id,
      updatedDate: undefined,
    },
    id,
  } as unknown as BlogPost;
}

describe('buildBlogCatalog', () => {
  it('sorts posts once and derives topics and tag pages from the same order', () => {
    const newest = makeEntry({
      id: 'newest.mdx',
      publishDate: '2026-03-22T00:00:00Z',
      tags: ['astro', 'shared'],
    });
    const oldest = makeEntry({
      id: 'oldest.mdx',
      publishDate: '2026-03-20T00:00:00Z',
      tags: ['css', 'shared'],
    });
    const middle = makeEntry({
      id: 'middle.mdx',
      publishDate: '2026-03-21T00:00:00Z',
      tags: ['shared'],
    });

    const catalog = buildBlogCatalog([oldest, newest, middle]);

    expect(catalog.posts.map((post) => post.id)).toEqual([
      'newest.mdx',
      'middle.mdx',
      'oldest.mdx',
    ]);
    expect(catalog.processedPosts.map((post) => post.slug)).toEqual(['newest', 'middle', 'oldest']);
    expect(catalog.topics).toEqual([
      { count: 3, href: '/tags/shared', name: 'shared' },
      { count: 1, href: '/tags/astro', name: 'astro' },
      { count: 1, href: '/tags/css', name: 'css' },
    ]);
    expect(
      catalog.tagPages
        .find(({ route }) => route.name === 'shared')
        ?.processedPosts.map((post) => post.slug),
    ).toEqual(['newest', 'middle', 'oldest']);
  });
});
