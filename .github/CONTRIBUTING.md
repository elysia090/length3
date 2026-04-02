# Contributing

## Recommended setup

Use the Nix development shell when possible. It provides the required runtime
and keeps Node, pnpm, Playwright browser downloads, and font tooling out of the
global environment.

```sh
XDG_CACHE_HOME=$PWD/.cache nix develop
pnpm install
pnpm exec playwright install chromium
```

The shell provides:

- Node 24.14 LTS
- `pnpm` via Corepack using the version pinned in `package.json`
- Python 3 with `fonttools` and `brotli`
- Noto CJK fonts so Playwright screenshots can render Japanese text deterministically

Project-local caches are written to `.cache/` and `.pnpm-store/`. The
`XDG_CACHE_HOME=$PWD/.cache` prefix also keeps Nix's eval/fetch cache out of
`~/.cache/nix`. The exact Node release is pinned in `.nvmrc` and enforced via
`package.json#engines`.

## Manual prerequisites

- Node 24.14+
- pnpm 9+
- Python 3 with `fonttools` and `brotli` if you need to regenerate fonts

```sh
pnpm install
```

If you do not use Nix, match the version in `.nvmrc` before installing
dependencies.

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
pnpm test:unit  # pure logic/unit tests
pnpm test:e2e   # playwright behavior tests
pnpm test       # unit + playwright behavior tests
```

Use `pnpm test` for the combined test pass, or run `pnpm test:unit` and
`pnpm test:e2e` separately while iterating. CI enforces the same bar.

## Test responsibilities

- `pnpm check`: Astro/TypeScript contracts and template diagnostics
- `pnpm test:unit`: pure logic and formatting behavior that do not need a browser
- `pnpm test:e2e`: user flows, keyboard behavior, accessible names/landmarks, and visible state changes
- `pnpm screenshots`: documentation captures only

Playwright specs live under `tests/e2e/`, while documentation capture flows and
their helpers live under `tests/docs/`.

Keep normal Playwright tests narrow. Do not add assertions for colors, spacing,
fonts, design tokens, performance scores, SEO checks, or other computed styles
there. Those belong in dedicated tooling such as Lighthouse, visual review, or
static analysis instead of browser E2E.

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
lang: en # or ja
draft: false
---
```
