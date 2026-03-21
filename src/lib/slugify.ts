/** Removes file extension from a Content Layer entry ID to produce a URL slug. */
export function toSlug(id: string): string {
  return id.replace(/\.(mdx?|md)$/, '').toLowerCase();
}

/** Converts a tag string to a URL-safe slug. */
export function tagToSlug(tag: string): string {
  return tag.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
}
