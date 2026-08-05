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

### Corners

Radius scales with the surface: **4 / 6 / 8 / 12 / 16px**, plus a pill. The previous 2–10px scale gave every surface the same near-right-angle, which read as deliberate on a 20px chip and as an unfinished box on a 600px code block. A corner should look like the same decision at every size, which means it cannot be the same number at every size.

The **shape** is a superellipse (`corner-shape: squircle`), not a circular arc. An arc meets the straight edge with a jump in curvature — the eye reads that discontinuity as a corner that was _cut_. A superellipse varies its curvature continuously, so the same radius reads softer and the shape reads as one contour rather than four arcs bridged by four lines. Chromium-only; everywhere else `border-radius` alone applies and the corner is simply a normal round.

Pills are exempt: a pill's semicircular end _is_ the shape, and a superellipse would flatten it.

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
| Article H1 (< 720px)          | 1.5rem (24px)    | Fraunces        | 300        | 1.3         |
| H2                            | 1.25rem (20px)   | Fraunces        | 400        | 1.3         |
| H3                            | 1.1rem (17.6px)  | Fraunces        | 400 italic | 1.3         |
| Body prose                    | 1rem (16px)      | system-ui       | 400        | 1.8         |
| Body prose (< 720px)          | fluid 15–16px    | system-ui       | 400        | 1.75        |
| Lead / Lede                   | 1.05rem (16.8px) | Fraunces italic | 300        | 1.9         |
| UI label                      | 0.75rem (12px)   | JetBrains Mono  | 400        | —           |
| Code inline                   | 0.88em           | JetBrains Mono  | 400        | —           |
| Date / Meta                   | 0.75rem (12px)   | JetBrains Mono  | 400        | 1.4         |
| Tag                           | 0.75rem (12px)   | JetBrains Mono  | 400        | —           |

**Mobile heading scale.** Below 720px the display sizes step down one notch (Article H1 and `.page-title` from 28px to 24px) and the article H1 drops its `max-width: 18ch` cap. At 390px the cap left the title only 252px of the available 350px, so a long Japanese title wrapped to five lines and the header block alone filled a third of the first screen. Body sizes do not move: 16px is the floor (see §8, Mobile Requirements), and the fix for "the text looks large on a phone" is the display scale and the wrapping, not the body size.

### Line-Length Control

The 680px column cap provides automatic line-length control, but the following CSS properties refine behavior within that column:

- `text-wrap: pretty` on body paragraphs. Prevents orphaned single-word final lines (widows). Falls back gracefully in non-Chromium browsers — the text simply wraps without the optimization, which is acceptable.
- `text-wrap: balance` on headings. When a heading breaks to two lines, this distributes characters evenly between them. Fallback: normal wrapping, which is tolerable but less elegant.
- `line-break: strict` on Japanese body text. Enforces kinsoku rules — prohibiting line-initial punctuation and brackets.
- `word-break: auto-phrase` on Japanese text, **at 720px and above only**. Chrome 119+ only; enables phrase-level wrapping via BudouX. Non-Chromium browsers ignore this property entirely, falling back to standard character-level breaks. Phrase wrapping keeps a whole 文節 together, so it leaves a phrase-sized gap at the end of a line. That is invisible in a 630px column and expensive in a 350px one: measured over the first twelve paragraphs of a Japanese article at a 390px viewport, phrase wrapping fills 83.4% of the column and needs 91 lines, while character wrapping fills 93.1% and needs 80 — the same text, 9% shorter, with no change in font size.

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
The single accent color. Used exclusively for interactive signals and semantic markers. Contrast against BG is **2.8:1** — a marker, not a text color. Anything amber that carries words uses **Amber-text** `#b45309` (**4.7:1**) instead. Earlier revisions of this document credited `#d4820a` with 4.8:1 and AA; that number was wrong, and the implementation has always used the darker variant for type.

_Where it appears:_ TOC active state (border + text). Hover text color on interactive elements. Ruby `<rt>` annotations. Keyword tokens in code. 1px left-border on lead paragraphs.

_Where it must not appear:_ Background fills of any kind. Decorative gradients. Borders thicker than 1px (except the 2px TOC active indicator and the 2px code-block left border). Publish button or any other action button.

### Temperature

**Marks are cool. Surfaces are warm.** Everything drawn _onto_ the page — type, rules, borders, icons — sits on a single cool hue, **212°** at 8–18% saturation: far enough to name as blue, not far enough to leave grey. Everything the reader looks _through_ to read — the page, the panels laid on it, the tint behind inline code — stays on the warm paper side.

The reason is contrast, not mood. Two colors of equal lightness read as further apart across the wheel than along it, so cooling the marks buys separation from the paper without darkening anything. The luminance formula weights blue least of the three channels, so the shift lowers measured luminance as well: every foreground token gained contrast in the move, none lost any.

The surface half of that rule was learned by breaking it, twice. One revision cooled the panels — the search modal's header and footer bars along with everything else — and the modal stopped being restful to read in. The next kept the cool on the search field alone, on the argument that a field is operated rather than read; that left one cold patch inside a paper card, which was worse than either consistent answer. A mark is looked at for an instant; a surface is held in view for as long as the reading lasts, and a surface that is not the colour of paper gives the eye nowhere to settle. **Cool the thing being read, not the thing being read on** — including the things it is read _inside_.

One deliberate exception: **code foreground** stays warm on the cool slab — the page's relationship inverted inside the block. That inversion is what makes a code block read as a different kind of object rather than a dark rectangle.

For anything new: a new accent joins Amber on the warm side. A new text, rule, or border colour joins Ink at 212°. A new surface — panel, field, or otherwise — joins BG-2 on the paper side. Nothing sits at neutral: neutral is what makes a palette look unconsidered.

**Ink** `#15191e`
Primary text. A cool near-black, not pure `#000`. Pure black against the off-white background creates excessive contrast that induces fatigue over long reading sessions.

**Ink-2** `#363e47`
Secondary text: descriptions, dates, metadata.

**Ink-3** `#5f6a77`
Tertiary text: labels, placeholders, lowest-priority information. **5.2:1** against BG and **4.7:1** against BG-2, so it clears AA on both surfaces it appears over. The value it replaced, `#7a7670`, was documented at 4.6:1 but measured **4.25:1** — it cleared AA on neither. Avoid for text smaller than 12px.

**Rule** `#c0c6ce`
Rules and dividers only. The contrast against BG is deliberately subtle — a rule should separate without shouting.

**BG** `#f9f8f5`
Page background. Warm off-white, not pure `#fff`. Reduces glare in extended reading sessions, and gives the contour texture something to sit in.

**BG-2** `#f0ede8`
Every surface laid over the page: table headers, the search modal's header and footer bars, the search field, the sidebar search trigger, the selected result row. Warm, like the page — the difference from BG is perceptible but minimal, enough to register as "a different surface" without creating a visual event. Fields are not exempt; what marks a field is its pill radius, its border, and its focus ring, none of which need a temperature change to do their job.

**Code surface** `#20272f`
The only dark surface on the page: the same cool, taken to slab scale. The warm tokens on it (amber keywords, terracotta constants, parchment function names) read as complementary rather than as more of the same, so the block gains contrast without gaining darkness. Contrast against BG: **14.2:1**. Used for block code only — never for inline code, buttons, or panels.

### Contrast Compliance

Measured, not estimated. Ratios are WCAG 2.x relative luminance, rounded to one decimal.

| Pairing          | Hex values            | Ratio  | WCAG Level    |
| ---------------- | --------------------- | ------ | ------------- |
| Ink on BG        | `#15191e` / `#f9f8f5` | 16.6:1 | AAA           |
| Ink on BG-2      | `#15191e` / `#f0ede8` | 15.1:1 | AAA           |
| Ink-2 on BG      | `#363e47` / `#f9f8f5` | 10.2:1 | AAA           |
| Ink-3 on BG      | `#5f6a77` / `#f9f8f5` | 5.1:1  | AA            |
| Ink-3 on BG-2    | `#5f6a77` / `#f0ede8` | 4.7:1  | AA            |
| Amber-text on BG | `#b45309` / `#f9f8f5` | 4.7:1  | AA            |
| Amber on BG      | `#d4820a` / `#f9f8f5` | 2.8:1  | markers only  |
| Code fg on code  | `#d9d4cb` / `#20272f` | 10.2:1 | AAA           |
| Code dim on code | `#878f99` / `#20272f` | 4.6:1  | AA            |
| Rule on BG       | `#c0c6ce` / `#f9f8f5` | 1.6:1  | non-text, 1px |

Amber-text on BG-2 measures **4.3:1** and does not clear AA. Links inside table headers and selected search rows are the only place that pairing occurs; if either surface grows, the pairing needs a darker amber rather than a lighter panel.

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

### Article List — Reveal Control

The list renders **5 items** and holds the rest. The fifth is not there to be read: its foot fades out under a mask and its rule is dropped, so the list ends in a dissolve rather than a cut. Four items read normally; the fifth says "this continues."

Sitting on that dissolve, centred, is a **44px glass disc carrying three dots**. Pressing it reveals **four more** items and moves the disc down to the new dissolve. When nothing is left, the disc is removed and the last item regains its full opacity and its missing rule.

The reason is distance, not tidiness. Search and the topic list live below the article list, so on a phone every article added pushes them further out of reach. Capping the list keeps the distance from the top of the page to the search field constant no matter how many articles exist.

**Why a disc and not "Older →".** There are no pages here to move between, so there is no page to name. Three dots say "there is more of this, in this direction" without claiming a structure the content does not have. Numbers would be worse: `Page 3 of 17` is a fact about the archive, not about what the reader is looking for.

**Glass.** The disc is the one Liquid-Glass-style surface in the interface: a translucent tint over a `backdrop-filter` blur, a specular rim (strong white inset on the top edge, a softer return on the bottom), a faint inner shading for thickness, and a soft drop shadow. It reads as a lens laid on the page — the paper texture stays visible through it, distorted. On press the rim inverts to a recess.

This does not contradict the search overlay's ban on `backdrop-filter` (below). That ban is about a **surface the reader reads through**; the disc is a **control the reader looks at**. Blur that dims a page of text serves the interface; blur that gives a 44px control physical depth serves the reader's understanding of what it is.

**Behaviour without JavaScript.** The server renders every article and the disc `hidden`. The collapse happens only once the script runs, so a reader without JavaScript — and any crawler or in-page find — gets the whole list. Collapsed items stay in the DOM (`hidden`), never removed.

**Accessibility.** The disc is a real `<button>`, labelled with the count it will reveal (`Show 4 more articles`), and it names the list it controls with `aria-controls`. On press, focus moves to the first newly revealed item's link — necessary because the final press removes the button from under the reader's focus. A polite live region reports the outcome (`4 more articles shown. 5 remaining.`), which focus movement alone cannot convey.

### Topic List (Index Sidebar)

**Rows:** JetBrains Mono, 0.75rem, `letter-spacing: 0.06em`. Topic name left, article count right, `padding: 14px 0`, `border-bottom: 1px solid var(--rule)`. Sorted by count, descending.

**Disclosure:** only the **top 6** topics render as open rows. The remainder collapse into a native `<details>` whose `<summary>` is styled as one more row — `+N more` when closed, `Show less` when open, with a `+` glyph that rotates 45° into a `×`. The summary is 44px tall, matching the tap-target minimum.

The widget is `<details>`, not a JavaScript toggle, for three reasons: the hidden topics stay in the DOM, so crawlers and in-page find still reach them; the control is keyboard- and screen-reader-operable with no ARIA authoring; and nothing about it can fail to hydrate. The threshold is 6 because the tail of the list is single-article tags — at 24 topics, 18 of them had a count of 1, and an alphabetical run of one-article tags is a scroll obstacle between the reader and the footer, not a navigation aid.

### Table of Contents (Article Page)

Located in the left column. `position: sticky; top: 32px`.

**Section label:** "Contents" — JetBrains Mono, 0.75rem, Ink-3, `letter-spacing: 0.14em`, uppercase, `margin-bottom: 16px`.

**List items:** JetBrains Mono, 0.8rem, Ink-2, `padding: 6px 0`, `padding-left: 8px`, `border-left: 2px solid transparent`, `line-height: 1.5`.

**Active state:** `border-left-color` transitions to amber; text `color` transitions to amber. Both transitions: 80ms ease. The dual signal (color + border) ensures the active state is communicated even to users with color vision deficiencies.

**H3 sub-items:** `margin-left: 12px`, font-size reduced to 0.75rem.

**Disappearance:** When the TOC's sticky container reaches the bottom of the article body, it fades via `opacity: 0` (200ms ease) and simultaneously receives `pointer-events: none` + `visibility: hidden`. This prevents the TOC from lingering as a ghost after the content it references has scrolled past.

### Code Blocks

**Inline code:** `--code-inline-bg` (`#edeae4`) background, `border-radius: var(--radius-sm)`, `padding: 1px 5px`, JetBrains Mono 0.88em, Ink. No border — inline code sits inside a running line, and a drawn box on every occurrence turns a Japanese paragraph into a string of rectangles. The tint alone marks it, and a 1px inset shadow gives the tint an edge without a stroke.

**Block code:** `--code-bg` (`#20272f`) background — a dark gray carrying blue, not black. `border: 1px solid --code-edge`, `border-left: 2px solid #e8a030` (amber-lt), `border-radius: var(--radius-lg)`, `padding: 20px`. JetBrains Mono 0.8125rem, `--code-fg` (`#d9d4cb`) — kept warm so the text sits off the cool ground — `line-height: 1.65`.

**Block code is a dark surface; inline code is not.** The two are different objects. A block is a figure the reader stops on — set as a slab, it separates from the prose the way a plate separates from body text in print, and the sharp 1px edge is what makes it read as an object rather than a wash. Inline code is not an object; it belongs to the sentence, so it stays light. Earlier revisions of this document prohibited dark blocks on the grounds that they rupture reading flow; in practice the near-invisible BG-2 wash (a 1.06:1 step from the page) failed to mark the block at all.

**Syntax highlighting** is on, via Shiki with a project theme (`src/config/code-theme.ts`). The token palette is amber, sage, terracotta, parchment, and dusty lavender — muted, warm, and keyed to the page accent rather than a stock high-saturation theme. Every token colour clears 4.5:1 against `--code-bg`. The theme's surface values are duplicated in `--code-*` (tokens.css) because Shiki writes token colours inline while the surface comes from CSS; the two must be changed together.

**Horizontal overflow is signalled without JavaScript.** A block wider than its column shows a light edge on the side that has more content, built from four background layers — two covers attached `local`, two glows attached `scroll`. Scrolling to an end slides the cover over the glow and the signal disappears.

**Copy control.** Each block carries a **copy button in its top-right corner**, drawn as two overlapping squares — the duplication mark, which is what "copy" looks like everywhere else the reader uses a computer. No label; the glyph is the whole affordance. It is invisible until the pointer enters the block, and permanently visible on devices that cannot hover. On success it swaps to a check in amber for 1.5s and its accessible name changes to `Copied`; on failure, to `Failed`.

The button lives in a wrapper the script places around the `<pre>`, not inside it: a `<pre>` scrolls horizontally, and a button inside would scroll away with the code. The block reserves right padding for it so the first line never runs underneath.

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

**Focus outline:** `outline: 2px solid var(--amber-text); outline-offset: 3px`, plus a soft `--focus-halo` ring outside it. Browser default outlines are replaced, never removed. The replacement must provide equal or greater visibility.

The ring is drawn with **`outline`, never with `box-shadow` alone**. Forced-colours mode strips box-shadows entirely, so a shadow-only ring vanishes for exactly the users who need it most. `box-shadow` may add a second, softer halo outside the outline — it may not be the ring itself. A focused control changes **one** thing chromatically: the outline. Recolouring the border as well produces two concentric amber rings and reads as an error state.

(Two rules previously passed `--focus-halo` — a bare colour — straight to `box-shadow`. A box-shadow with no lengths is invalid, so those declarations were dropped and the halo never rendered at all.)

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

- No **form control** below 16px — Safari on iOS zooms the viewport when a field
  smaller than that takes focus. The search input is therefore pinned at 1rem
- Body prose is fluid between 15px and 16px below 480px:
  `clamp(0.9375rem, calc((100vw - 2.5rem) / 23.5), 1rem)`. The divisor targets a
  23-character Japanese line; at 390px that is 22.9 characters against 21.4 at a
  flat 16px. 15px is the floor — prose never goes below it
- All tap targets ≥ 44 × 44px
- Line length self-regulates (viewport width naturally constrains it)

---

## 9. Exclusion List

What the interface deliberately does not do is as important as what it does.

**No scroll-triggered entrance animations.** Elements do not fade or slide into view as the reader scrolls. Content is present from the moment the page renders. Scroll-linked animation is a magazine convention; it assumes the reader is there to be impressed. The reader is here to read.

**No dark mode for the blog.** The editor is dark. The blog is light. There is no toggle. A dark-mode toggle introduces a second visual identity that must be maintained in parallel, doubling the surface area for inconsistency.

**No "like" button.** Feedback arrives through channels outside the blog interface. A like button on a personal blog is a metric without an audience.

**No social share buttons inside the article body.** A share prompt while reading is a disruption. If the article earns sharing, a single line at the article's end is sufficient.

**No numbered pagination.** The article list grows in place, four at a time, behind the reveal disc (§4). There are no page numbers and no page URLs. "Page 3 of 17" is a fact about the archive's size, not about anything the reader came to find.

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
