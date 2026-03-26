// @ts-check
import cloudflare from '@astrojs/cloudflare';
import mdx from '@astrojs/mdx';
import { defineConfig } from 'astro/config';
import pagefind from 'astro-pagefind';

export default defineConfig({
  output: 'static',
  adapter: cloudflare(),

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

  vite: {
    ssr: {
      target: 'webworker',
    },
    optimizeDeps: {
      exclude: ['pagefind'],
    },
    build: {
      chunkSizeWarningLimit: 1024,
    },
  },

  build: {
    format: 'file',
  },

  trailingSlash: 'never',
});
