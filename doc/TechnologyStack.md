## Tech Stack

This blog is built on Astro 6,with TypeScript in strict mode, MDX, and Content Collections (Content Layer API) for content management.
The runtime environment is Node.js 22.12+, and the package manager is pnpm, pinned via Corepack. 
It is deployed on Cloudflare Workers, uses `astro:assets` for image optimization, and adopts Pagefind for on-site search.
Formatting and static checks are handled with Prettier, `prettier-plugin-astro`, Biome, and `astro check`,
while Playwright is used for end-to-end testing. Code blocks in articles are powered by CodeMirror 6,
and Japanese typography is handled with `<ruby>`, `line-break`, and `text-wrap`.
