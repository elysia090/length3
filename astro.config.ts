import cloudflare from '@astrojs/cloudflare';
import mdx from '@astrojs/mdx';
import { defineConfig } from 'astro/config';
import segmentedPagefind from './src/integrations/segmented-pagefind';

export default defineConfig({
  output: 'static',
  adapter: cloudflare({
    imageService: 'passthrough',
    prerenderEnvironment: 'node',
  }),

  integrations: [
    mdx({
      syntaxHighlight: false,
      optimize: true,
      gfm: true,
      smartypants: false,
    }),
    segmentedPagefind(),
  ],

  markdown: {
    syntaxHighlight: false,
    remarkPlugins: [],
    rehypePlugins: [],
  },

  vite: {
    ssr: {
      target: 'webworker',
    },
    optimizeDeps: {
      exclude: ['pagefind', '@astrojs/cloudflare/entrypoints/server'],
    },
    build: {
      chunkSizeWarningLimit: 1024,
    },
  },

  build: {
    format: 'file',
    concurrency: 4,
  },

  trailingSlash: 'never',
});
