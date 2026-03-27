import type { BlogPost, ProcessedPost, TagResolver, TagRoute } from './types';
import { buildTagResolver, getTagUrl, notDraft, processPost } from './utils';

export interface TopicSummary {
  count: number;
  href: string;
  name: string;
}

export interface TagPageData {
  processedPosts: ProcessedPost[];
  route: TagRoute;
}

export interface BlogCatalog {
  posts: BlogPost[];
  processedPosts: ProcessedPost[];
  tagPages: TagPageData[];
  tagResolver: TagResolver;
  tagRoutes: TagRoute[];
  topics: TopicSummary[];
}

let blogCatalogPromise: Promise<BlogCatalog> | null = null;

export async function getBlogCatalog() {
  if (!blogCatalogPromise) {
    blogCatalogPromise = loadBlogCatalog();
  }

  return blogCatalogPromise;
}

export function buildBlogCatalog(posts: BlogPost[]): BlogCatalog {
  const sortedPosts = [...posts].sort(
    (a, b) => b.data.publishDate.valueOf() - a.data.publishDate.valueOf(),
  );
  const tagResolver = buildTagResolver(sortedPosts);
  const tagRoutes = [...tagResolver.routes()];
  const processedPosts = sortedPosts.map((post) => processPost(post, tagResolver));
  const tagPages = tagRoutes.map((route) => ({
    processedPosts: route.posts.map((post) => processPost(post, tagResolver)),
    route,
  }));
  const topics = [...tagRoutes]
    .sort((a, b) => b.posts.length - a.posts.length)
    .map((route) => ({
      count: route.posts.length,
      href: getTagUrl(route.canonicalSlug),
      name: route.name,
    }));

  return {
    posts: sortedPosts,
    processedPosts,
    tagPages,
    tagResolver,
    tagRoutes,
    topics,
  };
}

async function loadBlogCatalog() {
  const { getCollection } = await import('astro:content');
  const posts = await getCollection('blog', notDraft);
  return buildBlogCatalog(posts);
}
