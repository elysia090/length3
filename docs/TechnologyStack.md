## Tech Stack

This blog is built on Astro 6 with strict TypeScript, MDX, and Content Collections for content management. The runtime environment is Node.js 24.14+, the package manager is pnpm via Corepack, and deployment targets Cloudflare Workers through the official Astro adapter. Search is powered by Pagefind, while formatting and static checks are handled with Prettier, `prettier-plugin-astro`, Biome, and `astro check`. Playwright covers end-to-end testing, and Japanese typography relies on `<ruby>`, `line-break`, and `text-wrap`.

## UI Design

This UI is designed as a reading-first interface for a technical blog. Rather than feeling like a typical web app, it leans toward an editorial, print-like structure: restrained typography, generous whitespace, thin rules, and a very limited accent color create hierarchy without visual noise. The overall tone is quiet and deliberate, with the writing itself kept at the center.

The index page uses a two-column layout, with articles in the main column and supporting tools such as search, stats, and tags in the sidebar. Each entry is structured around date, tags, title, excerpt, and reading time, so readers can quickly scan both topic and depth. The article page widens the reading column and pairs it with a persistent table of contents and utility actions, making long-form technical writing easier to navigate. Large headings, careful line spacing, and clear separation between prose and code give the page the feel of a composed document rather than a feed.

The editor view extends the same idea into the writing experience. A dark MDX editor sits beside a light live preview, allowing the author to compare source and presentation at the same time. This creates a strong contrast between drafting and reading while keeping both in a single coherent interface. The search modal is similarly minimal, centered, and compact, behaving more like a quiet command palette than a separate page.

At its core, the UI is not just styled for a blog; it is designed as an interface for reading, writing, and exploring technical texts with care. Its character comes less from decoration than from spacing, typography, and the treatment of Japanese text.
