import type { CollectionEntry } from 'astro:content';

export type BlogPost = CollectionEntry<'blog'>;
export type BlogPostData = BlogPost['data'];

export interface ProcessedPost {
  entry: BlogPost;
  slug: string;
  readingTime: number;
  excerpt: string;
}

export interface TocHeading {
  depth: number;
  slug: string;
  text: string;
}

