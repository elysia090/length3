import type { CollectionEntry } from 'astro:content';

export type BlogPost = CollectionEntry<'blog'>;
export type BlogPostData = BlogPost['data'];

export interface TagLink {
  href: string;
  name: string;
}

export interface TagRoute {
  canonicalSlug: string;
  name: string;
  posts: BlogPost[];
}

export interface TagResolver {
  linkFor(name: string): TagLink;
  routes(): readonly TagRoute[];
}

export interface ProcessedPost {
  entry: BlogPost;
  slug: string;
  readingTime: number;
  description: string;
  tags: TagLink[];
}

export interface TocHeading {
  depth: number;
  slug: string;
  text: string;
}

export type SearchBootstrapResult =
  | { kind: 'ready' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'error'; message: string };
