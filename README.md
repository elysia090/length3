# length3

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

- Node 22
- `pnpm` via Corepack using the version pinned in `package.json`
- Python 3 with `fonttools` and `brotli` for font conversion

If you also want to keep Nix's own eval/fetch cache out of `~/.cache/nix`, use
the `XDG_CACHE_HOME=$PWD/.cache` prefix shown above.

Playwright browsers, Corepack downloads, pnpm caches, and the optional Nix
cache are redirected into the repository under `.cache/` and `.pnpm-store/`.
