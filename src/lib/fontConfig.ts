/**
 * Fraunces font paths — single source of truth for JS/TS consumers.
 *
 * The CSS @font-face declarations in src/styles/fonts.css must stay in sync
 * with these paths (CSS cannot import from TypeScript).
 * These constants are used in:
 *   - src/layouts/BaseLayout.astro  (<link rel="preload">)
 *   - tests/helpers/fonts.ts        (programmatic FontFace for screenshots)
 */
export const FRAUNCES_WOFF2 = '/fonts/Fraunces-Variable.woff2';
export const FRAUNCES_ITALIC_WOFF2 = '/fonts/Fraunces-Italic-Variable.woff2';
