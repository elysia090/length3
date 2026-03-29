# Benchmark Critical Path Analysis

Measured: 2026-03-29
Report: `.cache/bench/latest.json`

---

## 1. Build Critical Path

Total wall time: **8348 ms**

| Phase                       | Reported (ms) | Wall (ms) | Notes                                      |
| --------------------------- | ------------- | --------- | ------------------------------------------ |
| Types generation            | 2790          | —         | `astro check` triggered by build           |
| Collecting build info       | 2820          | 0         | Overlaps with types; ~instant actual work  |
| Building server entrypoints | 2326          | 2403      | Vite bundle (3 passes: 1420 + 852 + 54 ms) |
| Prerendering routes         | 76            | 62        | 15 static pages                            |
| Rearranging server assets   | —             | 2         | Near-instant                               |
| Post-build tail             | 131           | 131       | segmented-pagefind + process exit          |

**Bottleneck**: Types generation (2790 ms) and Vite server entrypoint bundling (2403 ms) each account for ~29% of total build time. These two phases dominate.

Astro-reported total is 5470 ms; the remaining ~2878 ms is Node/pnpm startup and the post-build tail.

---

## 2. Page Load Critical Path

### LCP by page

| Page               | Requests | Total bytes | FCP/LCP    | Long tasks |
| ------------------ | -------- | ----------- | ---------- | ---------- |
| `/about`           | 3        | 221.7 KB    | **36 ms**  | 0          |
| `/tags/astro`      | 3        | 222.9 KB    | **84 ms**  | 0          |
| `/getting-started` | 6        | 253.3 KB    | **132 ms** | 1 × 60 ms  |
| `/`                | 10       | 408.7 KB    | **132 ms** | 0          |

Pages without JS (`/about`, `/tags/astro`) render in 36–84 ms.
Pages with JS (`/`, `/getting-started`) pay a +96 ms FCP penalty.

### What causes the 132 ms FCP on JS pages

`/` loads a 10.9 KB script (sidebar / search bootstrap) at initial parse.
`/getting-started` loads a 7.6 KB script (TOC + article actions).
These scripts are the direct cause of the FCP gap relative to pure-HTML pages.

### Article page long task (60 ms)

`/getting-started` is the only page with a long task during render:

- DOM: 1161 nodes, 469 elements, 25 headings, 13 code blocks
- `layoutDurationMs`: 51 ms (highest across all pages)
- `taskDurationMs`: 154.6 ms (highest across all pages)
- `recalcStyleCount`: 23

The 26.7 KB HTML (largest page) with complex DOM triggers a 60 ms long task during initial style + layout. JS init itself is fast (toc.init: 0.9 ms, articleActions.init: 0.3 ms).

### LCP element

| Page               | LCP element                          | Size     |
| ------------------ | ------------------------------------ | -------- |
| `/`                | `<p class="card-excerpt">`           | 832 × 48 |
| `/about`           | `<p>` (intro text)                   | 632 × 58 |
| `/getting-started` | `<span class="crumb crumb-current">` | 470 × 14 |
| `/tags/astro`      | `<p class="card-excerpt">`           | 632 × 48 |

All LCP elements are text nodes, not images. The texture image does not gate LCP.

---

## 3. Asset Critical Path

### Client bundle (1.71 MiB total)

| File                               | Size    | Notes                                                       |
| ---------------------------------- | ------- | ----------------------------------------------------------- |
| `length3-texture-transparent.webp` | 677 KB  | **Largest single file; loaded as image but AVIF is served** |
| `Fraunces-Italic-Variable.woff2`   | 230 KB  | Italic variable font                                        |
| `length3-texture-transparent.avif` | 193 KB  | **Loaded on every page (background texture)**               |
| `Fraunces-Variable.woff2`          | 190 KB  | Upright variable font                                       |
| `pagefind/pagefind-ui.js`          | 82 KB   | Lazy-loaded on search open                                  |
| `pagefind/wasm.en.pagefind`        | 54 KB   | Lazy-loaded on search open                                  |
| `pagefind/wasm.unknown.pagefind`   | 51 KB   | Lazy-loaded on search open                                  |
| `Footer.css` (main CSS bundle)     | 26.6 KB | Loaded on every page                                        |

The WebP texture (677 KB) is in `dist/client` but the AVIF (193 KB) is what the browser fetches. Both format variants are emitted to the bundle; only AVIF is measured in page loads.

The two font files total 420 KB and are loaded on pages that use the Fraunces typeface.

### Pagefind index (334 KB in `dist/client/pagefind`)

Breakdown not itemized per file in the report; the 84 KB `pagefind-ui.js` and ~105 KB of WASM are the dominant lazy-load payloads triggered by search open.

---

## 4. Search Critical Path

Open-to-ready: **63 ms** (1 initial network request)

| Phase                             | Duration    |
| --------------------------------- | ----------- |
| `search.bootstrap.importPagefind` | 8.3–8.6 ms  |
| `search.bootstrap.constructUi`    | 2.0–2.1 ms  |
| `search.bootstrap.nextFrame`      | 6.8 ms      |
| `search.syncUiState`              | 0.2 ms      |
| **`search.bootstrap.total`**      | **17.8 ms** |
| **`search.open` (user-visible)**  | **24.3 ms** |

The 63 ms open-to-ready includes background WASM loading (~105 KB across `wasm.en.pagefind` + `wasm.unknown.pagefind`) that overlaps with UI render. `search.open` reports 24.3 ms because the WASM is fetched in parallel; the remaining ~39 ms is network + WASM parse before the index is fully ready.

INP for the search interaction: **24 ms** (well within budget).

---

## 5. Summary of Critical Paths

### Build

```
[Node/pnpm startup ~2.5 s]
  → [Types generation 2790 ms]  ← slowest named phase
  → [Vite server bundle 2403 ms wall]  ← 3 sequential Vite passes
  → [Prerender 62 ms]
  → [Post-build tail 131 ms]
Total: 8348 ms
```

### Page render (JS pages)

```
[HTML parse + CSS download 27 KB]
  → [Script parse + execute (sidebar/article JS)]  ← +96 ms vs no-JS pages
  → [FCP 132 ms]
  → [Article: layout 51 ms + long task 60 ms]  ← /getting-started only
```

### Search open

```
[User click]
  → [importPagefind dynamic import 8.6 ms]  ← first async hop
  → [constructUi 2 ms]
  → [nextFrame 6.8 ms]  ← rAF wait
  → [UI visible / search.open 24.3 ms]
  (background) → [WASM download + init ~39 ms]
  → [index ready / openToReady 63 ms]
```

### Key numbers to watch

| Metric                         | Value    | Signal                       |
| ------------------------------ | -------- | ---------------------------- |
| Build total                    | 8348 ms  | Baseline                     |
| Types phase                    | 2790 ms  | ~33% of build                |
| Vite server bundle             | 2403 ms  | ~29% of build                |
| FCP delta (JS vs no-JS)        | +96 ms   | Script render-blocking cost  |
| Article long task              | 60 ms    | DOM complexity at 1161 nodes |
| Search open-to-ready           | 63 ms    | WASM lazy-load overhead      |
| Client bundle (excl. pagefind) | 1.38 MiB | Texture images dominant      |
| CSS bundle per page            | 27.3 KB  | Single shared chunk          |
