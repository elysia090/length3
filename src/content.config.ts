import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'zod';
import { BLOG_COLLECTION_LOADER_BASE } from './config/content';

const blog = defineCollection({
  loader: glob({
    pattern: '**/*.{md,mdx}',
    base: BLOG_COLLECTION_LOADER_BASE,
  }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    lang: z.enum(['en', 'ja']).default('en'),
  }),
});

export const collections = { blog };
