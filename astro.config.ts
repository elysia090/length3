import cloudflare from '@astrojs/cloudflare';
import mdx from '@astrojs/mdx';
import { defineConfig, sessionDrivers } from 'astro/config';
import segmentedPagefind from './src/integrations/segmented-pagefind';

export default defineConfig({
  site: 'https://length3.com',
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
    inlineStylesheets: 'always',
  },

  trailingSlash: 'never',

  session: {
    // This site is fully prerendered and does not use runtime sessions.
    // Keep the config first-party, but avoid the Cloudflare adapter's
    // default KV session provisioning during static builds.
    driver: sessionDrivers.lruCache(),
  },
});
