import type { SiteLanguage } from '../../i18n/language';
import type { BlogPost, ProcessedPost, TagResolver, TagRoute } from './types';

/**
 * Collection filter: excludes draft posts.
 * Pass directly to getCollection('blog', notDraft) to avoid repeating the
 * inline predicate on every page.
 */
export const notDraft = (entry: BlogPost) => !entry.data.draft;

/** Removes file extension from a Content Layer entry ID to produce a URL slug. */
export function toSlug(id: string): string {
  return id.replace(/\.mdx?$/, '').toLowerCase();
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  const bytes = new TextEncoder().encode(value);

  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

/** Canonical slug for tag routes. */
export function canonicalizeTagSlug(tag: string): string {
  const normalized = tag.normalize('NFKC').trim().toLowerCase();
  const base = normalized
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return base || `tag-${hashText(normalized || tag)}`;
}

/** Returns the canonical URL path for a tag slug. */
export function getTagUrl(slug: string): string {
  return `/tags/${slug}`;
}

/**
 * Builds the canonical tag routing model from the full post collection.
 * Canonical slugs are collision-safe and deterministic.
 */
export function buildTagRoutes(posts: BlogPost[]): TagRoute[] {
  const postsByName = new Map<string, BlogPost[]>();

  for (const post of posts) {
    for (const tag of new Set(post.data.tags)) {
      let taggedPosts = postsByName.get(tag);
      if (!taggedPosts) {
        taggedPosts = [];
        postsByName.set(tag, taggedPosts);
      }
      taggedPosts.push(post);
    }
  }

  const names = [...postsByName.keys()].sort();
  const namesByBase = new Map<string, string[]>();

  for (const name of names) {
    const base = canonicalizeTagSlug(name);
    let bucket = namesByBase.get(base);
    if (!bucket) {
      bucket = [];
      namesByBase.set(base, bucket);
    }
    bucket.push(name);
  }

  return names
    .map((name) => {
      const base = canonicalizeTagSlug(name);
      const collisions = namesByBase.get(base) ?? [name];

      return {
        name,
        canonicalSlug: collisions.length > 1 ? `${base}-${hashText(name)}` : base,
        posts: postsByName.get(name) ?? [],
      };
    })
    .sort((a, b) => a.canonicalSlug.localeCompare(b.canonicalSlug) || a.name.localeCompare(b.name));
}

export function buildTagResolver(posts: BlogPost[]): TagResolver {
  const routes = buildTagRoutes(posts);
  const linksByName = new Map(
    routes.map((route) => [
      route.name,
      {
        href: getTagUrl(route.canonicalSlug),
        name: route.name,
      },
    ]),
  );

  return {
    linkFor(name) {
      const link = linksByName.get(name);
      if (!link) {
        throw new Error(`Unknown tag "${name}".`);
      }
      return link;
    },
    routes() {
      return routes;
    },
  };
}

/**
 * Converts a raw blog collection entry into a ProcessedPost ready for
 * rendering. Centralised here so every page derives slugs, reading time, and
 * tag links from the same logic.
 */
export function processPost(entry: BlogPost, tagResolver: TagResolver): ProcessedPost {
  const tagNames = entry.data.tags ?? [];

  return {
    entry,
    slug: toSlug(entry.id),
    readingTime: estimateReadingTime(entry.body ?? ''),
    description: entry.data.description,
    tags: tagNames.map((name) => tagResolver.linkFor(name)),
  };
}

/** Estimates reading time in minutes, accounting for CJK character density. */
export function estimateReadingTime(text: string): number {
  const cjkChars = text.match(/[\u3000-\u9FFF\uF900-\uFAFF]/gu)?.length ?? 0;
  const latinWords = text.replace(/[\u3000-\u9FFF\uF900-\uFAFF]/gu, ' ').match(/\S+/g)?.length ?? 0;

  const minutes = cjkChars / 400 + latinWords / 200;
  return Math.max(1, Math.ceil(minutes));
}

export function formatDate(date: Date, locale: SiteLanguage): string {
  const parts = new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value ?? '';
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const day = parts.find((part) => part.type === 'day')?.value ?? '';

  return `${year}/${month}/${day}`;
}
