import { getCollection } from 'astro:content';
import type { BlogPost, ProcessedPost, TagResolver, TagRoute } from './types';
import { buildTagResolver, getTagUrl, notDraft, processPost, toSlug } from './utils';

export interface TopicSummary {
  count: number;
  href: string;
  name: string;
}

export interface BlogIndex {
  posts: BlogPost[];
  postsBySlug: Map<string, BlogPost>;
  processedPosts: ProcessedPost[];
  processedPostsById: Map<string, ProcessedPost>;
  tagResolver: TagResolver;
  tagRoutes: readonly TagRoute[];
  topics: TopicSummary[];
}

let blogIndexPromise: Promise<BlogIndex> | null = null;

export function getBlogIndex(): Promise<BlogIndex> {
  blogIndexPromise ??= getCollection('blog', notDraft).then((posts) => buildBlogIndex(posts));
  return blogIndexPromise;
}

export function buildBlogIndex(posts: BlogPost[]): BlogIndex {
  const sortedPosts = [...posts].sort(
    (a, b) => b.data.publishDate.valueOf() - a.data.publishDate.valueOf(),
  );
  const tagResolver = buildTagResolver(sortedPosts);
  const processedPosts = sortedPosts.map((post) => processPost(post, tagResolver));

  return {
    posts: sortedPosts,
    postsBySlug: new Map(sortedPosts.map((post) => [toSlug(post.id), post])),
    processedPosts,
    processedPostsById: new Map(processedPosts.map((post) => [post.entry.id, post])),
    tagResolver,
    tagRoutes: tagResolver.routes(),
    topics: [...tagResolver.routes()]
      .sort((a, b) => b.posts.length - a.posts.length || a.name.localeCompare(b.name))
      .map((route) => ({
        count: route.posts.length,
        href: getTagUrl(route.canonicalSlug),
        name: route.name,
      })),
  };
}
