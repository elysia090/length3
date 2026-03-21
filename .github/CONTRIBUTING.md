# Contributing

## Prerequisites

- Node 22+
- pnpm 9+

```sh
pnpm install
```

## Development

```sh
pnpm dev        # dev server at http://localhost:4321
pnpm build      # production build + pagefind index
pnpm preview    # serve the built output locally
```

## Checks

```sh
pnpm lint       # biome + prettier
pnpm check      # astro type check
pnpm test       # playwright e2e (starts dev server automatically)
```

All three must pass before opening a PR. CI enforces the same checks.

## Fonts

`/public/fonts/` holds the Fraunces variable font files.
WOFF2 format is required for production. To convert from TTF:

```sh
pip install fonttools brotli
python3 -c "
from fontTools.ttLib import TTFont
for n in ['Fraunces-Variable', 'Fraunces-Italic-Variable']:
    f = TTFont(f'public/fonts/{n}.ttf')
    f.flavor = 'woff2'
    f.save(f'public/fonts/{n}.woff2')
"
```

## Deploy

Production deploys run automatically via GitHub Actions on every push to
`main`. Manual deploys:

```sh
pnpm build
pnpm exec wrangler deploy
```

Requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the
environment (or `wrangler login`).

## Content

Blog posts live in `src/content/blog/`. Each file is MDX with frontmatter:

```yaml
---
title: Post title
description: One-sentence summary shown on the index and in og:description.
publishDate: 2025-01-01
tags: [tag-one, tag-two]
lang: en          # or ja
draft: false
---
```
