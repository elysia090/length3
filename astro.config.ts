import cloudflare from '@astrojs/cloudflare';
import mdx from '@astrojs/mdx';
import { defineConfig, sessionDrivers } from 'astro/config';
import { codeTheme } from './src/config/code-theme';
import segmentedPagefind from './src/integrations/segmented-pagefind';

/**
 * Shiki は <pre> に背景色と前景色をインラインで書き込む。面の色は
 * tokens.css の --code-* で持ちたいので、pre の style だけ落としてトークンの
 * 色（span 側）は残す。
 */
const shikiConfig = {
  theme: codeTheme,
  wrap: false,
  transformers: [
    {
      name: 'length3:strip-pre-style',
      pre(node: { properties: Record<string, unknown> }) {
        delete node.properties['style'];
      },
    },
  ],
};

export default defineConfig({
  site: 'https://length3.com',
  output: 'static',
  adapter: cloudflare({
    imageService: 'passthrough',
    prerenderEnvironment: 'node',
  }),

  integrations: [
    mdx({
      syntaxHighlight: 'shiki',
      shikiConfig,
      optimize: true,
      gfm: true,
      smartypants: false,
    }),
    segmentedPagefind(),
  ],

  markdown: {
    syntaxHighlight: 'shiki',
    shikiConfig,
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
