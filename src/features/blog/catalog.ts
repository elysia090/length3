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
  /**
   * 台帳番号。古い順に 1 から振る。新しい記事が増えても既存の番号は動かない
   * （新しい順に振ると、1 本足すたびに全部の番号が繰り下がる）。
   */
  catalogNumbers: ReadonlyMap<string, number>;
  /** いちばん長い記事の読了時間。体積の立方体はこれを最大の一辺にとる。 */
  maxReadingTime: number;
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

  const catalogNumbers = new Map(
    processedPosts.map((post, i) => [post.slug, processedPosts.length - i] as const),
  );
  const maxReadingTime = Math.max(1, ...processedPosts.map((post) => post.readingTime));

  return {
    catalogNumbers,
    maxReadingTime,
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
