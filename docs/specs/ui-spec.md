# Length³ v3 — Design Specification

---

## Design Philosophy

**The writing is the interface.**

Length³ is a personal technical blog. Readers arrive for one reason: to read. Every element on the page must justify its presence against that single purpose. When a UI element cannot answer "what does the reader lose if this disappears?", it is removed.

Completion is not reached by addition. It is reached by subtraction. What remains must earn its place.

This specification defines the complete visual and behavioral contract for the blog. Implementations that contradict this document are bugs, not interpretations.

---

## 1. Spatial System

### Base Unit

All dimensions derive from an **8px grid**. The minimum subdivision is 4px, used only where 8px produces excessive spacing (e.g., inline code padding). Intermediate values such as 13px, 17px, or 23px are prohibited. The eye perceives alignment when proportional relationships hold; arbitrary values undermine that perception.

### Maximum Widths

The outer content boundary is **1200px**. Within that boundary, the prose column is capped at **680px**. This constraint is not aesthetic preference — it is a reading-performance decision. Japanese prose reads best at 35–40 characters per line; English at 65–75. Beyond those thresholds, the eye loses its anchor when returning to the start of the next line.

### Index Page Layout

```
┌─────────────────────────────┬──────────────┐
│     Article list (1fr)      │  Sidebar     │
│                             │  280px       │
│                             │  Search only │
└─────────────────────────────┴──────────────┘
```

Two columns. No left gutter — the content area's own left padding provides the margin. The sidebar is separated from the main column by a single 1px rule (`var(--rule)`). The sidebar contains **search and nothing else**. Tags, statistics, and category listings each live on their own dedicated page. Placing them in the sidebar would create a secondary reading surface that competes with the article list.

Below **840px** viewport width, the sidebar disappears and the layout collapses to a single column. Search relocates to a nav-bar icon, accessible via the `/` keyboard shortcut.

### Article Page Layout

```
┌───────────┬───────────────────────────┬──────────────┐
│  TOC      │     Prose column          │  Empty       │
│  200px    │     680px max             │  Intentional │
│  sticky   │                           │  whitespace  │
└───────────┴───────────────────────────┴──────────────┘
```

Table of contents on the left. Prose in the center. The right column is **deliberately empty** — no widgets, no actions, no metadata. Nothing is placed there. The purpose of this emptiness is structural: it gives the text block a directional asymmetry that makes the prose feel like it breathes toward the open margin rather than sitting caged between two sidebars.

All utility functions — Edit, Share, Copy Link, reading progress — are relocated away from the article body. They do not appear alongside the text. The reader's peripheral vision should encounter only the quiet presence of the TOC and open space.

**TOC behavior.** `position: sticky; top: 32px`. The TOC tracks the reader's scroll position, highlighting the current section.

**Responsive collapse.** At 720–960px, the TOC remains but the right empty column disappears. At 640–720px, the TOC moves to the top of the article, collapsed inside a `<details>` element. Below 640px, the same `<details>` treatment, fully single-column.

---

## 2. Typography System

### Font Roles

Each typeface has exactly one job. If a new element needs a font, it consults this table — it does not introduce a fifth typeface.

| Typeface           | Role                                                               | Rationale                                                                                                                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fraunces**       | Display headings and titles only                                   | Its optical size axis and expressive italic create a tonal contrast against Japanese body text. It signals "this is a heading" without needing weight or size alone.                                                                                                              |
| **JetBrains Mono** | Code, UI labels, dates, navigation, tags, metadata                 | Monospace serves as a semantic marker: anything in this font is _operational_ — a tag, a date, a command, a label — rather than _prose_. By unifying all non-prose elements under one monospace face, the boundary between "text to read" and "interface to use" becomes visible. |
| **Noto Serif JP**  | Ruby annotations (`<rt>`) and Japanese serif fallback for headings | System-ui Japanese rendering is inconsistent, particularly for ruby text. Noto Serif JP sits in the serif fallback stack to guarantee legible Japanese glyphs when platform mincho faces are absent. It is **not** the Japanese body font.                                        |
| **system-ui**      | Body prose                                                         | Long-form reading fatigue correlates inversely with font familiarity. system-ui delivers the typeface the reader's eyes already know. Choosing an expressive body font prioritizes the designer's taste over the reader's comfort.                                                |

### Type Scale

The scale follows a **1.25 ratio (Major Third)** from a base of `1rem = 16px`.

Previous iterations used `0.9rem` (≈14.4px) for body text. This is revised upward to **`1rem` (16px)** for two reasons: (1) the spec's own responsive section prohibits font sizes below 16px on mobile to avoid iOS auto-zoom, and (2) 14.4px body text contradicts the philosophy of minimizing reader fatigue. The entire scale has been recalculated from this corrected base.

| Role                          | Size             | Typeface        | Weight     | Line-height |
| ----------------------------- | ---------------- | --------------- | ---------- | ----------- |
| Display H1 (Index page title) | 2.0rem (32px)    | Fraunces        | 300 italic | 1.2         |
| Article H1                    | 1.75rem (28px)   | Fraunces        | 300        | 1.25        |
| H2                            | 1.25rem (20px)   | Fraunces        | 400        | 1.3         |
| H3                            | 1.1rem (17.6px)  | Fraunces        | 400 italic | 1.3         |
| Body prose                    | 1rem (16px)      | system-ui       | 400        | 1.95        |
| Lead / Lede                   | 1.05rem (16.8px) | Fraunces italic | 300        | 1.9         |
| UI label                      | 0.75rem (12px)   | JetBrains Mono  | 400        | —           |
| Code inline                   | 0.88em           | JetBrains Mono  | 400        | —           |
| Date / Meta                   | 0.75rem (12px)   | JetBrains Mono  | 400        | 1.4         |
| Tag                           | 0.75rem (12px)   | JetBrains Mono  | 400        | —           |

### Line-Length Control

The 680px column cap provides automatic line-length control, but the following CSS properties refine behavior within that column:

- `text-wrap: pretty` on body paragraphs. Prevents orphaned single-word final lines (widows). Falls back gracefully in non-Chromium browsers — the text simply wraps without the optimization, which is acceptable.
- `text-wrap: balance` on headings. When a heading breaks to two lines, this distributes characters evenly between them. Fallback: normal wrapping, which is tolerable but less elegant.
- `line-break: strict` on Japanese body text. Enforces kinsoku rules — prohibiting line-initial punctuation and brackets.
- `word-break: auto-phrase` on Japanese text. Chrome 119+ only; enables phrase-level wrapping via BudouX. Non-Chromium browsers ignore this property entirely, falling back to standard character-level breaks.

**Fallback policy.** All four properties degrade silently. The spec does not require polyfills or JavaScript-based alternatives. The enhanced behavior is a progressive improvement, not a baseline requirement.

### Ruby Rendering

Ruby annotations (`<ruby>` / `<rt>`) receive special treatment because system defaults produce collisions with adjacent lines.

- Font: JetBrains Mono (monospace signals "this is annotation, not prose")
- Size: 0.52em relative to the parent (slightly more than half the body size)
- Color: `var(--amber)` — visually separates the annotation layer from the text layer
- Position: `ruby-position: over` (explicit top placement)
- Alignment: `ruby-align: center` (centered above the base character)

**Line-height adjustment.** Any line containing a `<ruby>` element increases its `line-height` to **2.4**. Without this, the ruby text collides with the descenders of the line above. This adjustment applies per-line, not globally — lines without ruby retain the standard 1.95 line-height.

### Letter-Spacing

| Context           | Value         | Reason                                                               |
| ----------------- | ------------- | -------------------------------------------------------------------- |
| Japanese body     | `0.02em`      | Minimal breathing room between full-width characters                 |
| English body      | `0`           | Latin text becomes harder to read when letter-spaced                 |
| Mono UI labels    | `0.08–0.12em` | Uppercase monospace labels need air to remain legible at small sizes |
| Fraunces headings | `-0.02em`     | Large display text tightens to feel intentional rather than loose    |

---

## 3. Color System

### Principle

Color carries information. It is never applied for warmth, mood, or atmosphere. Every color token has documented conditions for use and conditions for non-use. If a color cannot state what information it conveys, it is not applied.

### Token Definitions

**Amber** `#d4820a`
The single accent color. Contrast ratio against BG: **4.8:1** (WCAG AA). Used exclusively for interactive signals and semantic markers.

_Where it appears:_ Tag text. TOC active state (border + text). Hover text color on interactive elements. Ruby `<rt>` annotations. CodeMirror cursor. 1px left-border on lead paragraphs.

_Where it must not appear:_ Background fills of any kind. Decorative gradients. Borders thicker than 1px (except the 2px TOC active indicator and the 2px code-block left border). Editor status bar. Publish button or any other action button.

**Ink** `#1c1a18`
Primary text. A warm near-black, not pure `#000`. Pure black against the warm off-white background creates excessive contrast that induces fatigue over long reading sessions.

**Ink-2** `#44413c`
Secondary text: descriptions, dates, metadata. Shares the warm hue of the Ink/Amber family, keeping the entire page within a unified color temperature.

**Ink-3** `#7a7670`
Tertiary text: labels, placeholders, lowest-priority information. Contrast ratio against BG: **4.6:1**, which satisfies WCAG AA. Avoid for text smaller than 12px.

**Rule** `#dedad5`
Rules and dividers only. The contrast against BG is deliberately subtle — a rule should separate without shouting.

**BG** `#f9f8f5`
Page background. Warm off-white, not pure `#fff`. Reduces glare in extended reading sessions.

**BG-2** `#f0ede8`
Secondary surface: inline code backgrounds, code blocks, sidebar. The difference from BG is perceptible but minimal — enough to register as "this is a different surface" without creating a visual event.

### Contrast Compliance

| Pairing     | Hex values            | Ratio  | WCAG Level |
| ----------- | --------------------- | ------ | ---------- |
| Ink on BG   | `#1c1a18` / `#f9f8f5` | 14.2:1 | AAA        |
| Ink-2 on BG | `#44413c` / `#f9f8f5` | 8.6:1  | AA         |
| Amber on BG | `#d4820a` / `#f9f8f5` | 4.8:1  | AA         |
| Ink-3 on BG | `#7a7670` / `#f9f8f5` | 4.6:1  | AA         |
| Ink on BG-2 | `#1c1a18` / `#f0ede8` | 11.5:1 | AAA        |

---

## 4. Component Specifications

### Navigation Bar

**Structure:** Logo left, nav links right. Single row.

**Logo:** `Length³` in JetBrains Mono, 0.88rem. The `³` is a `<sup>` element in amber. No icon, no graphic — the logotype is text.

**Nav links:** `(Articles)` `(About)` — parentheses-wrapped labels in JetBrains Mono, 0.75rem, Ink-2. The parentheses are a typographic convention that marks these as navigation controls, visually distinct from prose.

**Hover:** The text inside the parentheses transitions to Ink over 80ms ease. Parentheses remain. No underline. No background change.

**Scroll behavior:** The nav bar is `position: static`. It scrolls away with the page. A persistent navigation bar during reading is visual noise — the reader did not come here to navigate, they came to read. The nav is available at the top when they need it.

**Vertical padding:** 20px top, 20px bottom. A 1px Rule border on the bottom edge.

### Article List Item

**Grid:** `80px` date column + `1fr` content column, with a `24px` gap.

**Date column:**

- Year: JetBrains Mono, 0.75rem, Ink-3, `letter-spacing: 0.06em`
- Month.Day: JetBrains Mono, 0.8rem, Ink-2, `letter-spacing: 0.04em`
- Format: `03.20` (dot-separated, zero-padded)
- The two lines stack vertically with no explicit gap between them

**Content column — vertical stack:**

1. **Tags:** `#astro #mdx` format. JetBrains Mono, 0.75rem, amber. Multiple tags separated by whitespace. Zero top margin; 6px bottom margin before the title.

2. **Title:** Fraunces, 1.25rem, weight 400, Ink, `line-height: 1.4`. Italic is reserved for semantic emphasis within the title (proper nouns, technical terms), not as a default style for all titles.

3. **Description:** system-ui, 0.88rem, Ink-2, `line-height: 1.75`. Maximum two lines of visible text. If a description exceeds two lines, the description itself is too long — the solution is editing the description, not truncating with an ellipsis.

4. **Reading time:** JetBrains Mono, 0.75rem, Ink-3. Format: `5 min`. No article count. No comment count. Comment counts broadcast weakness during low-activity periods and provide no value to the reader deciding whether to read.

**Item separation:** `border-bottom: 1px solid var(--rule)`. Padding: 24px top, 24px bottom. First item: `padding-top: 0`. Last item: no bottom border.

**Hover:** Title color transitions to amber, 80ms ease. No background change. No cursor change (`cursor: default`). The color shift alone communicates interactivity.

### Table of Contents (Article Page)

Located in the left column. `position: sticky; top: 32px`.

**Section label:** "Contents" — JetBrains Mono, 0.75rem, Ink-3, `letter-spacing: 0.14em`, uppercase, `margin-bottom: 16px`.

**List items:** JetBrains Mono, 0.8rem, Ink-2, `padding: 6px 0`, `padding-left: 8px`, `border-left: 2px solid transparent`, `line-height: 1.5`.

**Active state:** `border-left-color` transitions to amber; text `color` transitions to amber. Both transitions: 80ms ease. The dual signal (color + border) ensures the active state is communicated even to users with color vision deficiencies.

**H3 sub-items:** `margin-left: 12px`, font-size reduced to 0.75rem.

**Disappearance:** When the TOC's sticky container reaches the bottom of the article body, it fades via `opacity: 0` (200ms ease) and simultaneously receives `pointer-events: none` + `visibility: hidden`. This prevents the TOC from lingering as a ghost after the content it references has scrolled past.

### Code Blocks

**Inline code:** BG-2 background, `border: 1px solid var(--rule)`, `border-radius: 3px`, `padding: 1px 5px`, JetBrains Mono 0.88em, Ink.

**Block code:** BG-2 background. `border-left: 2px solid #e8a030` (amber-lt). `border-radius: 0 4px 4px 0`. `padding: 16px 20px`. JetBrains Mono 0.84rem, Ink-2, `line-height: 1.75`.

**Code blocks do not use dark backgrounds.** A dark code block on a light page creates a visual hole that ruptures the reading flow. The reader's eye must recalibrate brightness when entering and leaving the block. The left amber border is sufficient to signal "this is code" without breaking the page's tonal continuity.

**Language labels are not displayed.** The content of the code block identifies its language. A label stating `typescript` above TypeScript code provides zero additional information.

### Search Modal (Pagefind)

**Trigger:** `/` keyboard shortcut (when no input is focused), or a search icon in the nav bar (mobile).

**Overlay:** `rgba(28, 26, 24, 0.6)`. Solid dim, no `backdrop-filter: blur()`. Blur is a visual effect that serves the interface's aesthetics, not the reader's task. The overlay's purpose is to suppress the page beneath the modal, and a solid dim achieves that directly.

**Modal body:** BG background, `border: 1px solid var(--rule)`, `border-radius: 6px`, width 560px (max 90vw), `box-shadow: 0 8px 32px rgba(0,0,0,0.15)`.

**Input row:** `padding: 12px 16px`. Search icon in amber, 16px. Text input in Fraunces 1rem — the search field uses the heading typeface so that typing a query feels like composing a thought, not operating a form field. `border-bottom: 1px solid var(--rule)` separates input from results.

**Results list:**

- No section headers (no "Articles — 3 results" banners)
- Each result: `padding: 10px 16px`, `border-left: 2px solid transparent`
- Selected/focused result: `border-left-color` → amber, `background` → BG-2
- Tag line: amber, JetBrains Mono, 0.75rem
- Title: Fraunces 0.95rem, Ink. Matched substring: amber italic via styled `<mark>`
- Date: JetBrains Mono, 0.75rem, Ink-3

**Footer:** Keyboard guide only. `↑↓ navigate` `↵ open` `esc close` — JetBrains Mono 0.7rem, Ink-3. Right-aligned: `Pagefind`.

**Focus trap:** While the modal is open, Tab cycles only within modal elements. Escape closes the modal and returns focus to the trigger element.

**Pagefind integration.** The spec defines the visual contract; Pagefind's default UI elements are fully overridden with a custom wrapper. Pagefind is used as a search engine only — its DOM output is consumed as data and rendered through custom markup matching this specification.

---

## 5. Interaction Design

### Animation Principles

Animation exists only to communicate state change or to guide the eye. If an animation cannot answer "what does this tell the reader?", it does not ship.

`prefers-reduced-motion: reduce` disables all transitions and animations. No exceptions. This is not a "best effort" accommodation — it is a hard requirement.

### Transition Inventory

| Target             | Property            | Duration | Easing   |
| ------------------ | ------------------- | -------- | -------- |
| List item hover    | color               | 80ms     | ease     |
| TOC active state   | color, border-color | 80ms     | ease     |
| Search modal open  | opacity, transform  | 140ms    | ease-out |
| Search modal close | opacity             | 100ms    | ease-in  |
| Button hover       | color               | 80ms     | ease     |

No other transitions exist. This list is exhaustive.

### Scroll Behavior

- TOC link click on article pages: `scroll-behavior: smooth`. Target elements receive `scroll-margin-top: 32px` to prevent content from hiding behind sticky elements.
- URL hash navigation on page load: **instant jump**, no smooth scroll. Smooth scrolling on initial load disorients the reader — they requested a destination, not a journey.

---

## 6. Accessibility

### Keyboard Navigation

Tab order follows DOM order. The DOM is written in logical reading order so that `tabindex` manipulation is unnecessary.

**Focus outline:** `outline: 2px solid var(--amber); outline-offset: 3px`. Browser default outlines are replaced, never removed. The replacement must provide equal or greater visibility.

**Search modal focus trap:** When open, Tab cycles through modal-internal elements only. Escape closes the modal and returns focus to the element that triggered it.

### Semantics

- Each page has exactly one `<h1>`. No exceptions.
- Heading levels are never skipped. H1 → H3 without an intervening H2 is a violation.
- `<nav>` elements carry `aria-label="primary"`.
- Search input carries `<label>` or `aria-label`.
- TOC `<ul>` carries `aria-label="Table of Contents"`.
- Code blocks with language metadata use `aria-label` to expose the language to assistive technology.

### Not Color Alone

Tags are amber, but they also carry the `#` prefix — the prefix communicates "this is a tag" independently of color. TOC active state changes both border-color and text color — a user who cannot distinguish amber from the default color still perceives the border change. Every color-encoded state has a redundant non-color signal.

---

## 7. Gaze Flow

### Index Page

```
Logo → Nav links (scanned, not read)
↓
First article:
  Date (peripheral) → Tags (context) → Title (gravitational center) → Description → Read time
↓
Second article (same rhythm repeats)
↓
Silence at the bottom of the page
```

The title is the largest, heaviest element (Fraunces 1.25rem) and acts as the gravitational anchor for each list item. The date sits quietly to the left. Tags appear directly above the title, establishing context before the title is read. The description follows the title as a secondary confirmation of interest. Reading time is the final, lowest-priority signal.

### Article Page

```
← TOC (present but passive, waiting in the periphery)

                    Title (the page's center of gravity)
                    ─── (amber rule)
                    Lead (italic, an invitation forward)
                    ──────────────────────────
                    Body prose (the reason the page exists)
                                                          → open margin (breathing room)
```

The TOC occupies peripheral vision: visible enough to orient, quiet enough to ignore. The right margin is empty, which creates a directional asymmetry — the text does not sit in a centered cage but extends toward open space. This is the typographic equivalent of a room with a window.

---

## 8. Responsive Strategy

### Breakpoints

| Viewport width | Layout behavior                                                                           |
| -------------- | ----------------------------------------------------------------------------------------- |
| ≥ 1200px       | Full layout: TOC + prose + right whitespace (article); list + sidebar (index)             |
| 960–1199px     | Sidebar narrows to 240px; right whitespace column shrinks but remains present at ≥ 80px   |
| 720–959px      | Sidebar hidden; index is single-column. Article retains TOC + prose (no right whitespace) |
| 640–719px      | Single column everywhere. TOC collapses to a `<details>` summary at article top           |
| < 640px        | Full single column. TOC inside `<details>`.                                               |

### Right-Margin Minimum (Article Page)

The "breathing" right margin in the article layout is not infinitely compressible. Below **80px** of remaining right-side space, the right column is removed entirely rather than compressed to a meaningless sliver. This threshold occurs at roughly 960px viewport width.

### Mobile Requirements

- No font size below 16px (prevents iOS Safari auto-zoom on input focus)
- All tap targets ≥ 44 × 44px
- Line length self-regulates (viewport width naturally constrains it)

---

## 9. Exclusion List

What the interface deliberately does not do is as important as what it does.

**No scroll-triggered entrance animations.** Elements do not fade or slide into view as the reader scrolls. Content is present from the moment the page renders. Scroll-linked animation is a magazine convention; it assumes the reader is there to be impressed. The reader is here to read.

**No dark mode for the blog.** The editor is dark. The blog is light. There is no toggle. A dark-mode toggle introduces a second visual identity that must be maintained in parallel, doubling the surface area for inconsistency.

**No "like" button.** Feedback arrives through channels outside the blog interface. A like button on a personal blog is a metric without an audience.

**No social share buttons inside the article body.** A share prompt while reading is a disruption. If the article earns sharing, a single line at the article's end is sufficient.

**No numbered pagination.** Navigation between article sets uses only "← Older" and "Newer →". "Page 3 of 17" serves no reader need.

**No loading spinners.** The Astro + Cloudflare Workers architecture eliminates the conditions that produce loading states. If a spinner becomes necessary, the response is architectural correction, not UI design.

**No comment system.** Previous iterations included a "2 comments" indicator. It is removed. A comment system demands its own considered design — threading, moderation, identity, notification. Bolting one onto a blog as an afterthought degrades both the blog and the comments.

**No statistics display on the index page.** Article count, tag count, and publication duration are not shown in the sidebar or anywhere on the index page. These numbers serve the author's vanity, not the reader's needs. They live on a dedicated stats page, if anywhere.

**No vertical section labels.** A rotated "articles" label in the page margin provides no information the reader does not already possess. It is decorative, and decoration that cannot justify itself is clutter.

---

## 10. Decision Framework

When an implementation question arises that this specification does not explicitly address, apply these filters in order:

**Adding an element.** Ask: "If this element did not exist, would the reader fail at their task?" If the answer is no, do not add it.

**Applying a color.** Ask: "What information does this color carry?" If the answer is "none" or "it looks nice," do not apply it.

**Adding an animation.** Ask: "What state change does this animation communicate?" If the answer is "nothing — it just feels smoother," do not add it.

**Changing a font.** Consult the role table in §2. If the role already has an assigned typeface, do not change it. If the element does not fit any existing role, question whether the element should exist before assigning it a font.

**Reducing whitespace.** Verify against the 8px grid. The next permissible value is the nearest smaller multiple of 8 (or 4 as absolute minimum). The reason to reduce spacing is "these elements are semantically related and should appear grouped" — never "the whitespace feels wasteful."

**When uncertain.** Remove rather than add. The cost of a missing element is that it can be added later. The cost of a present-but-unnecessary element is that it will persist indefinitely, because removing things from a shipped interface requires a justification that adding them did not.
