// @ts-check
import cloudflare from '@astrojs/cloudflare';
import mdx from '@astrojs/mdx';
import { defineConfig } from 'astro/config';
import pagefind from 'astro-pagefind';

export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    imageService: 'compile',
  }),

  site: 'https://length3.pages.dev',

  integrations: [
    mdx({
      syntaxHighlight: false,
      optimize: true,
      gfm: true,
      smartypants: false,
    }),
    pagefind(),
  ],

  markdown: {
    syntaxHighlight: false,
    remarkPlugins: [],
    rehypePlugins: [],
  },

  image: {
    service: {
      entrypoint: 'astro/assets/services/compile',
    },
  },

  vite: {
    ssr: {
      target: 'webworker',
      noExternal: ['codemirror', /@codemirror\/.*/],
    },
    optimizeDeps: {
      exclude: ['pagefind'],
    },
  },

  build: {
    format: 'file',
    concurrency: 4,
  },

  trailingSlash: 'never',
});
