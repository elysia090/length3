import type { CollectionEntry } from 'astro:content';

export type BlogPost = CollectionEntry<'blog'>;
export type BlogPostData = BlogPost['data'];

export interface ProcessedPost {
  entry: BlogPost;
  slug: string;
  readingTime: number;
  description: string;
}

export interface TocHeading {
  depth: number;
  slug: string;
  text: string;
}

/** Return type of buildTagIndex — centralised tag aggregation result. */
export interface TagIndex {
  /** slug → posts in that tag, in collection order */
  bySlug: Map<string, BlogPost[]>;
  /** slug → first-seen display name (preserves original casing) */
  names: Map<string, string>;
}
