# Length³

Technical blog built with Astro 6, MDX, and Cloudflare Workers.

## Development Shell

Recommended local setup uses Nix so Node, pnpm, and font tooling do not leak
into the global environment.

```sh
XDG_CACHE_HOME=$PWD/.cache nix develop
pnpm install
pnpm exec playwright install chromium
```

The shell provides:

- Node 24.14 LTS
- `pnpm` via Corepack using the version pinned in `package.json`
- Python 3 with `fonttools` and `brotli` for font conversion
- Noto CJK fonts so Playwright screenshots can render Japanese text deterministically

If you also want to keep Nix's own eval/fetch cache out of `~/.cache/nix`, use
the `XDG_CACHE_HOME=$PWD/.cache` prefix shown above.

Playwright browsers, Corepack downloads, pnpm caches, and the optional Nix
cache are redirected into the repository under `.cache/` and `.pnpm-store/`.
The exact Node release is pinned in `.nvmrc` and enforced through
`package.json#engines`. The pinned pnpm release is `10.33.0` via the
top-level `packageManager` field.

## Project Layout

- `src/`: Astro pages, layouts, components, styles, and content collections
- `src/features/`: feature modules — each owns its `.astro` components, browser
  logic, and unit tests (`blog`, `article`, `search`)
- `src/components/`: shell components shared across every page (header, footer,
  breadcrumb) plus `RubyText`, which content files import
- `src/styles/`: `index.css` is the only entry point; it declares the cascade
  order of the token, base, layout, per-component, and prose stylesheets
- `src/assets/`: non-public source assets such as textures
- `src/config/`: source-of-truth configuration modules shared across app and tests
- `tests/e2e/`: Playwright smoke and behavior coverage for the site
- `tests/docs/`: documentation capture specs and screenshot helpers
- `docs/reference/`: supporting technical notes such as the stack summary
- `docs/specs/`: design and UI specifications
- `docs/assets/screenshots/`: generated screenshots used in project docs

## Deployment

Production delivery is handled by Cloudflare Workers Builds rather than an
in-repo deploy workflow. This repository keeps the Astro + Wrangler build
configuration, but GitHub Actions only validates and packages the site.

The generated Worker config remains available for local verification or an
emergency manual deploy:

```sh
pnpm build
pnpm exec wrangler deploy --config dist/server/wrangler.json
```
