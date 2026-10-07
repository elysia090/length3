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
┌────────────────────────────────────────────┐
│  Header, then Robot Tune — one screen      │
├──────────────────── #index ────────────────┤
│  Stage — every article a cube (2.39:1)     │
├─────────────────────────────┬──────────────┤
│     Article list (1fr)      │  Sidebar     │
│                             │  280px       │
└─────────────────────────────┴──────────────┘
```

**The opening.** `/` begins with the site header and, under it, the Robot Tune (`features/robot-tune`, `variant="opening"`) sized to fit the rest of one screen. The title is not a heading laid over it but `ROBOT TUNE` in the 5 × 7 pixel font at the picture's top-left — part of the picture. In the intro, silences freeze the picture and the motion jumps ahead when the sound returns. The loop does not freeze: it has six rests in 5.8 s, and stopping for each made it stutter, so in the loop a rest only drops the faces to a line drawing while the motion keeps going. The loop's shovel gesture is followed by a spring (solved ahead into a table) so it never jumps between frames, and the loop camera turns smoothly into its strong hits instead of snapping. The audio clock is smoothed against the frame clock, since the output timestamp advances in coarser steps than frames. No credit line, no "enter" link: the reader scrolls on into the index. Nothing plays until the reader presses play. Once a reader has scrolled past the opening, the rest of the session starts at the index: a tiny inline script marks the document before first paint, and the page jumps to `#index`. A URL with a hash and back/forward navigation are left to the browser.

**Now playing.** When the tune is playing and its figure is off screen, a 26 × 15 pixel chip appears fixed at the bottom-left: a cube hopping on the beat (wireframe in the silent beats) and a pause or play glyph. No title is written on it. It is a real button that pauses and resumes; it disappears when the figure is back in view or the tune stops.

**The stage.** Above both columns sits a small 1-bit picture drawn by the same rasterizer as the Robot Tune article (`src/shared/pixel/`): about 320 columns scaled by a whole number of device pixels, four colours (transparent so the paper shows through, paper, ink, amber), shading by 4 × 4 Bayer dots. Every article is a cube standing on a dotted plan, its edge the cube root of its reading time — the same L the list draws as each row's length rule. 2.39:1 on wide screens, 4:3 on narrow ones.

- One cube at a time has volume (dithered faces); the rest are hidden-line drawings, length only. Attention gives volume, the same grammar as the article, where silence leaves only edges.
- At rest the camera dollies slowly and cuts by 90° every 6 s, overshooting and settling; every fourth cut drops to a low angle. Each cut moves the light to the next article: it hops, squashes, flashes amber and cools, and a smaller hop ripples outward by distance.
- Touching a row lights its cube; touching a cube lights its row. Pressing either has the shovel throw the cube, then navigates (560 ms). With the stage off screen, a modified click, or reduced motion, navigation is immediate.
- No text is drawn into the stage: no counters, no timecode, no labels in the corners. The list beside it already carries every number; the picture only has to show which article is lit.
- **The shovel is a toy** (`yard.ts`). Grab it and carry it across the floor: it lifts, and leans back against the direction of travel on a spring, then drops and sticks when released. Pressing the floor sends it hopping there to dig: a dithered pit opens and amber clods fly. Pits refill over seven seconds. Digging the same pit three times unearths a small amber cube that pops out beside it; pressing that cube opens a random article. Pressing the shovel without moving it makes it spin. While it is being played with, the camera stops cutting for eight seconds so the pit stays where it was dug. Cubes and unearthed finds take precedence over the shovel for the pointer; the shovel's hit area is its shaft, not its bounding box. Cursors: pointer over a cube or find, grab over the shovel, crosshair on the floor.
- It stops when off screen or when the tab is hidden. Under reduced motion it draws one still frame and redraws only on touch. It is `aria-hidden`; the list carries everything.

Below the stage, two columns: the list, and a sidebar with the search field and the topic index. The sidebar is `position: sticky`, so search stays within reach however far down the list the reader has gone.

Below **840px** the layout is one column in this order: stage → search → list → topics. Search comes before the list — a reader who came to look something up should not have to scroll past every article to find the field. (The sidebar is `display: contents` there, and grid areas set the order.)

**Tag pages** reuse the stage with only that tag's articles.

**404.** The void: a hollow (edges-only, zero-volume) `404` built from voxels stands on a dotted floor; a shovel scoops one voxel every 1.4 s and throws it, and when the glyphs are dug out they fall back from above. Pressing digs one more. Nothing is written into the picture. The heading is "Nothing to dig here" with a link back to `/#index`.

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

**Reading reel.** Under the TOC. The TOC column is two stacked parts — the TOC, which alone scrolls when it is long, and the reel, always visible below it — so nothing overlaps and the reel needs no backing surface over the paper. In it a 3³ dashed frame fills with one cube per 1/27 of the article read; each drops, squashes and cools. The 27th fills the frame and the whole cube flashes amber and cools. No numbers or labels are drawn. Progress is measured exactly as the reading-progress bar measures it (page scroll), so the frame is full when the bar reads 100%. It draws only on scroll and is `aria-hidden` — the progress bar already reports progress.

**Previous / next.** After the prose, the previous and next articles (`rel="prev"`/`rel="next"`): a direction in small mono and the title, under a hairline. No sign-off, no heading. It is excluded from the search index.

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

**Amber** `#ea580c`
The single accent color. Used exclusively for interactive signals and semantic markers. Contrast against BG is **3.4:1** — a marker, not a text color. Anything amber that carries words uses **Amber-text** `#c2410c` (**4.9:1**) instead. Earlier revisions of this document credited the accent with 4.8:1 and AA; that number was wrong, and the implementation has always used the darker variant for type.

The accent was raised when the page was cooled. A background losing saturation takes the accent's apparent strength with it — against a neutral page an accent stops reading as a point of colour and starts reading as a slightly darker patch — so the amber goes to full saturation and its hue moves from 28° to **22°**, which sits almost exactly opposite the 212° everything else is drawn in. Red-weighted luminance is lower at the same chroma, so the crisper colour is also the higher-contrast one: Amber-text clears **4.9:1** on BG and **4.6:1** on BG-2, which is the first time the accent has cleared AA on both surfaces.

**One warm value on paper.** Amber-text is now every warm thing drawn on the page: type, the decorative rules, the reading-progress bar, search-match marks, the search lens. There used to be a third token — a deep `#9a4312` for rules and the progress bar — and on warm paper the difference read as considered. On a page with the colour taken out of it, three warm values at three lightnesses read as three attempts at the same colour. Two remain, and neither overlaps: **Amber** `#ea580c` is the lit state (hover), **Amber-lt** `#f0a626` exists because the code slab is dark and paper amber sinks into it.

_Where it appears:_ TOC active state (border + text). Hover text color on interactive elements. Ruby `<rt>` annotations. Keyword tokens in code. 1px left-border on lead paragraphs.

_Where it must not appear:_ Background fills of any kind. Decorative gradients. Borders thicker than 1px (except the 2px TOC active indicator and the 2px code-block left border). Publish button or any other action button.

### Temperature

**One cool hue for everything except the accent.** Type, rules, borders, panels, and the page itself all sit on **212°** at 6–18% saturation: far enough to name as blue, not far enough to leave grey. Amber is the only warm thing on the page, and it is warm because it is the only thing that is.

The reason is contrast, not mood. Two colors of equal lightness read as further apart across the wheel than along it, so cooling the marks buys separation from the paper without darkening anything. The luminance formula weights blue least of the three channels, so the shift lowers measured luminance as well: every foreground token gained contrast in the move, none lost any.

The surfaces took three revisions to settle. An early one cooled the panels but not the page, which left cold patches inside warm paper — worse than either consistent answer, and the note written at the time concluded that surfaces should stay warm. That conclusion was right about consistency and wrong about which side to be consistent on: on a phone the warm paper reads as paper; on a 27-inch display the same value is a wall of warm white. The page moved to the cool side and the panels went with it — **the paper and everything laid on it share one temperature; the accent is the exception**.

The revisions after that were all about **how far**, and both of them came back the same way: too much. The first cool paper opened 6 points between red and blue on BG and 12 on BG-2 — on a real screen that is not cool paper, it is a blue-grey board, a background that had become a colour the reader can name. Halving it to 3 and 6 still read cold across a whole page.

The amount that holds is the amount you cannot name: **1 point of red-to-blue on BG, 3 on BG-2**. The page reads as white. Set it beside the warm paper it replaced and the only thing you can say is that the other one is warmer. And the page is not only its background — rules, borders, and panel edges are drawn in the same family, so pulling the paper back without pulling them back leaves blue lines on white paper. Rule and the surface strokes came down with it; Ink-2 and Ink-3 lost a few points of saturation at the same lightness. Lightness never moved in any pass, so every documented ratio has held throughout: what changed is how much colour the eye is asked to accept across an area, not how much contrast the type has.

One deliberate inversion remains: **code foreground** stays warm on the cool slab. Inside a code block the page's relationship is turned over, and that inversion is what makes the block read as a different kind of object rather than a dark rectangle.

For anything new: a new accent joins Amber on the warm side. Everything else — text, rule, border, panel, field, page — joins the 212° family. Nothing sits at neutral: neutral is what makes a palette look unconsidered.

**Ink** `#15191e`
Primary text. A cool near-black, not pure `#000`. Pure black against the off-white background creates excessive contrast that induces fatigue over long reading sessions.

**Ink-2** `#393e43`
Secondary text: descriptions, dates, metadata.

**Ink-3** `#656b73`
Tertiary text: labels, placeholders, lowest-priority information. **5.2:1** against BG and **4.7:1** against BG-2, so it clears AA on both surfaces it appears over. The value it replaced, `#7a7670`, was documented at 4.6:1 but measured **4.25:1** — it cleared AA on neither. Avoid for text smaller than 12px.

**Rule** `#c8c9cc`
Rules and dividers only. The contrast against BG is deliberately subtle — a rule should separate without shouting. Its saturation sits a step below the type's: one rule is a hairline, but the article list draws one per entry, and ten hairlines at the type's saturation add up to an area of colour.

**BG** `#f9f9fa`
Page background. A cool off-white, not pure `#fff`. Reduces glare in extended reading sessions, gives the contour texture something to sit in, and — at 97.6% lightness with the hue pulled a short way toward the type's own 212° — stops the largest surface on the page from reading as bare white on a wide display without turning it blue.

**BG-2** `#f0f1f3`
Every surface laid over the page: table headers, the search modal's header bar, the search field, the sidebar search trigger, the selected result row. The same temperature as the page — the difference from BG is perceptible but minimal, enough to register as "a different surface" without creating a visual event. Fields are not exempt; what marks a field is its pill radius, its border, and its focus ring, none of which need a temperature change to do their job.

**Code surface** `#20272f`
The only dark surface on the page: the same cool, taken to slab scale. The warm tokens on it (amber keywords, terracotta constants, parchment function names) read as complementary rather than as more of the same, so the block gains contrast without gaining darkness. Contrast against BG: **14.2:1**. Used for block code only — never for inline code, buttons, or panels.

### Contrast Compliance

Measured, not estimated. Ratios are WCAG 2.x relative luminance, rounded to one decimal.

| Pairing          | Hex values            | Ratio  | WCAG Level    |
| ---------------- | --------------------- | ------ | ------------- |
| Ink on BG        | `#15191e` / `#f9f9fa` | 16.8:1 | AAA           |
| Ink on BG-2      | `#15191e` / `#f0f1f3` | 15.6:1 | AAA           |
| Ink-2 on BG      | `#393e43` / `#f9f9fa` | 10.3:1 | AAA           |
| Ink-3 on BG      | `#656b73` / `#f9f9fa` | 5.1:1  | AA            |
| Ink-3 on BG-2    | `#656b73` / `#f0f1f3` | 4.8:1  | AA            |
| Amber-text on BG | `#c2410c` / `#f9f9fa` | 4.9:1  | AA            |
| Amber on BG      | `#ea580c` / `#f9f9fa` | 3.4:1  | markers only  |
| Code fg on code  | `#d9d4cb` / `#20272f` | 10.2:1 | AAA           |
| Code dim on code | `#878f99` / `#20272f` | 4.6:1  | AA            |
| Rule on BG       | `#c8c9cc` / `#f9f9fa` | 1.6:1  | non-text, 1px |

Amber-text on BG-2 measures **4.6:1** and clears AA — the pairing that appears in table headers and selected search rows, and the one this palette had been failing since the accent was first written down. It clears by hue, not by darkening: the same lightness moved 6° toward red.

---

## 4. Component Specifications

### Navigation Bar

**Structure:** Logo left, nav links right. Single row.

**Logo:** `Length³` in JetBrains Mono, 0.88rem. The `³` is a `<sup>` element in amber. No icon, no graphic — the logotype is text.

**Nav links:** `(Articles)` `(About)` — parentheses-wrapped labels in JetBrains Mono, 0.75rem, Ink-2. The parentheses are a typographic convention that marks these as navigation controls, visually distinct from prose.

**Hover:** The text inside the parentheses transitions to Ink over 80ms ease. Parentheses remain. No underline. No background change.

**Scroll behavior:** The nav bar is `position: static`. It scrolls away with the page. A persistent navigation bar during reading is visual noise — the reader did not come here to navigate, they came to read. The nav is available at the top when they need it.

**Vertical padding:** 20px top, 20px bottom. A 1px Rule border on the bottom edge.

**Site icon.** The logotype is text on the page, but the tab needs a picture, and the picture is the old About page's stone standing on the contour paper with `L³` set in the corner. It ships as `favicon.ico` (16/32/48 PNGs in one container), a 192px PNG for Android home screens, and a 180px `apple-touch-icon` — that last one flooded with BG behind the artwork, since iOS masks its own corners and composites anything transparent onto black.

The mark it replaced drew a full-size `3` beside the `L` **and** an amber `3` above it, which at tab size read as `L33`. An exponent is one digit in one position; a second copy of it at body size is not emphasis, it is a different number.

### Article List Item

A catalogue, not a stack of cards: the list reads like the contents page of an exhibition catalogue. **Volume above, length below** — the stage shows each article as a volume (V = reading time); the list shows its length (L = ∛V).

**Grid:** an `88px` number column and the content column, `24px` apart. Below 640px the number sits above the title.

**Catalogue number:** `No. 008`. Fraunces italic, oldstyle figures, Ink-3, set level with the first line of the title. Counted from the oldest article, so adding an article never renumbers the others. `aria-hidden`.

**Title:** Fraunces 1.1875rem, weight 400, Ink. The newest article is the **lead**: its title is set large (up to 2.125rem, weight 300) and it alone carries its description (three lines at most). Everything else is two lines — title, then one line of metadata — so the list is scanned by title and by shape, not read paragraph by paragraph.

**Metadata line** (JetBrains Mono 0.6875rem): length · reading time · date · topics.

- **Length.** A rule whose length is the article's L, on a dotted track whose full width is the longest article's L. A tick stands at every whole unit and a small block marks the end. Down the list the rules differ, so the right side of the list has a rhythm, like a score — and every row is measured on the same scale.
- Reading time `24 min`, date `2026/08/05`, up to four topics and `+n`.

**Selected row.** Hovering or focusing a row, or touching its cube on the stage, raises an amber rule at the row's left edge and turns its title and its length rule amber — the same grammar as a selected search result. The stage answers by lighting that cube.

**Item separation:** a hairline between rows, 24px above and below. No hover background.

### Article List — Reveal Control

The list renders **5 items** and holds the rest. The fifth fades out under a mask and drops its rule, so the list ends in a dissolve rather than a cut.

Under it is one line set like the topic index's `+31 more`: `Show 4 more articles` in Fraunces italic with a plus at the right, on a hairline. Pressing it reveals four more. When nothing is left, the line is removed and the last item regains its full opacity and its rule.

The cap exists for distance on a phone (search and topics follow the list), not for tidiness. The visible text is also the button's accessible name.

**Behaviour without JavaScript.** The server renders every article and the control `hidden`. The collapse happens only once the script runs, so a reader without JavaScript — and any crawler or in-page find — gets the whole list. Collapsed items stay in the DOM (`hidden`), never removed.

**Accessibility.** The control is a real `<button>`, labelled with the count it will reveal (`Show 4 more articles`), and it names the list it controls with `aria-controls`. On press, focus moves to the first newly revealed item's link — necessary because the final press removes the button from under the reader's focus. A polite live region reports the outcome (`4 more articles shown. 5 remaining.`), which focus movement alone cannot convey.

### About — The Plate

About shows Michelangelo's _The Creation of Adam_ (c. 1512, public domain) printed like a two-colour risograph in the site's dots (`features/adam`). `scripts/adam/bake.ts` turns `data/creation-of-adam.jpg` into three plates in one lossless WebP — ink density, the share of ink dots that print amber instead, and an amber shadow on the plaster — and the browser only screens them with offset 4 × 4 Bayer matrices and films them.

- **Amber is placed, not derived.** It never fills an area and never follows a global tone rule. It replaces a fraction of the ink dots in a handful of authored places — the dark pocket of God's mantle the arm reaches out of, the dome of the mantle, the shadow mass under God, the earth under Adam's torso and knee — and lies as a thin shadow under the fingertips. About 1–2 % of the picture's dots. Nothing reaches Adam's head. No area prints solid: even the deepest ink leaves a tenth of the paper showing.
- **Handheld camera.** No animation in the picture itself. The frame drifts a few pixels and rolls by under half a degree, as if held on a shoulder; the dot grid stays fixed to the screen, so the dots regroup as it sways, like grain. 24 frames a second, stopped off screen, one still frame under reduced motion.
- **Touch.** Pressing the picture turns the dots around the point into sand: they let go one after another and spill straight down, out through the bottom of the frame — nothing piles up. Where they left, the paper shows and that patch sags slightly; after a moment it recovers over about three seconds (`sand.ts`). Not under reduced motion.
- **Frame.** 2.39 : 1 under the paragraph on wide screens. On narrow screens 2 : 1 — nearly the whole picture, not a crop of the hands — with dots no smaller than 1.75 CSS px, so it stays an abstraction rather than a shrunken photograph. The edges dissolve into the paper. No text in or around it; the figure is `role="img"` with a description.

### Topic List (Index Sidebar)

**Rows:** set like the index at the back of a book. Fraunces 1rem, topic name left, a dotted leader, the count right in oldstyle figures. No rules between rows — seven rules took up more area than the words. 44px tall where the pointer is a finger, 32px where it is fine. Sorted by count, descending.

**Disclosure:** only the **top 6** topics render as open rows. The remainder collapse into a native `<details>` whose `<summary>` is styled as one more row — `+N more` when closed, `Show less` when open, with a `+` glyph that rotates 45° into a `×`. The summary is 44px tall, matching the tap-target minimum.

The widget is `<details>`, not a JavaScript toggle, for three reasons: the hidden topics stay in the DOM, so crawlers and in-page find still reach them; the control is keyboard- and screen-reader-operable with no ARIA authoring; and nothing about it can fail to hydrate. The threshold is 6 because the tail of the list is single-article tags — at 24 topics, 18 of them had a count of 1, and an alphabetical run of one-article tags is a scroll obstacle between the reader and the footer, not a navigation aid.

### Table of Contents (Article Page)

Located in the left column. `position: sticky; top: 32px`.

**Section label:** "Contents" — JetBrains Mono, 0.75rem, Ink-3, `letter-spacing: 0.14em`, uppercase, `margin-bottom: 16px`.

**List items:** JetBrains Mono, 0.8rem, Ink-2, `padding: 6px 0`, `padding-left: 8px`, `border-left: 2px solid transparent`, `line-height: 1.5`.

**Active state:** `border-left-color` transitions to amber; text `color` transitions to amber. Both transitions: 80ms ease. The dual signal (color + border) ensures the active state is communicated even to users with color vision deficiencies.

**H3 sub-items:** `margin-left: 12px`, font-size reduced to 0.75rem.

**Scrollbar.** A long article's TOC outgrows the viewport and the column scrolls. The bar the platform draws for that is a solid vertical stripe a few pixels from the headings, darker than any rule on the page and permanently lit — on a real machine it was the most contrasted object in the left column. The gutter stays reserved (so headings do not jump sideways when the bar appears) and the bar itself is `thin` with a **transparent thumb**, taking the Rule colour only while the column is hovered or holds focus. Colour is the only thing that changes, so nothing reflows when it does.

**Disappearance:** When the TOC's sticky container reaches the bottom of the article body, it fades via `opacity: 0` (200ms ease) and simultaneously receives `pointer-events: none` + `visibility: hidden`. This prevents the TOC from lingering as a ghost after the content it references has scrolled past.

### Code Blocks

**Inline code:** `--code-inline-bg` (`#ebeced`) background, `border-radius: var(--radius-sm)`, `padding: 1px 5px`, JetBrains Mono 0.88em, Ink. No border — inline code sits inside a running line, and a drawn box on every occurrence turns a Japanese paragraph into a string of rectangles. The tint alone marks it, and a 1px inset shadow gives the tint an edge without a stroke.

**Block code:** `--code-bg` (`#20272f`) background — a dark gray carrying blue, not black. `border: 1px solid --code-edge`, `border-left: 2px solid #f0a626` (amber-lt), `border-radius: var(--radius-lg)`, `padding: 20px`. JetBrains Mono 0.8125rem, `--code-fg` (`#d9d4cb`) — kept warm so the text sits off the cool ground — `line-height: 1.65`.

**Block code is a dark surface; inline code is not.** The two are different objects. A block is a figure the reader stops on — set as a slab, it separates from the prose the way a plate separates from body text in print, and the sharp 1px edge is what makes it read as an object rather than a wash. Inline code is not an object; it belongs to the sentence, so it stays light. Earlier revisions of this document prohibited dark blocks on the grounds that they rupture reading flow; in practice the near-invisible BG-2 wash (a 1.06:1 step from the page) failed to mark the block at all.

**Syntax highlighting** is on, via Shiki with a project theme (`src/config/code-theme.ts`). The token palette is amber, sage, terracotta, parchment, and dusty lavender — muted, warm, and keyed to the page accent rather than a stock high-saturation theme. Every token colour clears 4.5:1 against `--code-bg`. The theme's surface values are duplicated in `--code-*` (tokens.css) because Shiki writes token colours inline while the surface comes from CSS; the two must be changed together.

**Horizontal overflow is signalled without JavaScript.** A block wider than its column shows a light edge on the side that has more content, built from four background layers — two covers attached `local`, two glows attached `scroll`. Scrolling to an end slides the cover over the glow and the signal disappears.

**Copy control.** Each block carries a **copy button in its top-right corner**, drawn as two overlapping squares — the duplication mark, which is what "copy" looks like everywhere else the reader uses a computer. No label; the glyph is the whole affordance. It is invisible until the pointer enters the block, and permanently visible on devices that cannot hover. On success it swaps to a check in amber for 1.5s and its accessible name changes to `Copied`; on failure, to `Failed`.

The button lives in a wrapper the script places around the `<pre>`, not inside it: a `<pre>` scrolls horizontally, and a button inside would scroll away with the code. The block reserves right padding for it so the first line never runs underneath.

**Language labels are not displayed.** The content of the code block identifies its language. A label stating `typescript` above TypeScript code provides zero additional information.

### Search (Pagefind)

Search is a back-of-book index, full screen. It is built on Pagefind's core API (`pagefind.js`); Pagefind's own UI is not used, because its layout — a field, a list, "load more" — was dictating the structure.

**Trigger.** The sidebar field (one rule with a half-written line on it: an amber lens, the placeholder in Fraunces italic at 1.25rem, the `/` key) or `/` anywhere outside a text field.

**The sheet.** No floating card and no dim: the dialog is the whole viewport, paper with the same contour texture as the page. Three bands:

1. **The query** — the input is the headline. Fraunces 300 at up to 4rem, no box; only the rule under it, which turns amber while the field has focus. Above it, at the top-left, `← Back` — the visible way out.
2. **The archive** — the index stage's cubes (`features/archive` `mountArchiveField`). With no query every cube has volume; as results arrive only the matching articles keep their faces, the rest become edges, and the selected result hops and flashes amber. Nothing matching: every cube is length only.
3. **The body** —
   - **No query:** the topic index, set like the index at the back of a book — initials (Latin capitals, `0–9`, and `和` for kana and kanji) in amber italic, each term with a dotted leader to its count. Pressing a term searches it.
   - **Results:** a list on the left and, from 60rem, a **preview** of the selected article on the right — `No. · date · minutes`, the title, its lead, and the sections that matched (each a link to its heading), then `Open ↵`. The reader can judge an article without opening it.
   - **Nothing:** “Nothing in the index for ‘…’.” and the nearest topics (partial matches first, then small misspellings, else the most used).

**A result** is a ledger row like the list's: number column, title in Fraunces, and the excerpt as a concordance line (`concordance.ts`): left context right-aligned, keyword in its own column, right context left-aligned, so every keyword falls on one vertical axis (KWIC). The selected row has the amber left rule and an amber title.

**Keyboard and pointer.** The query is a `combobox`, the results a `listbox` of `option`s, and the selection is carried by `aria-activedescendant` while focus stays in the field. `↑` / `↓` move the selection (and the preview and the stage follow); `↵` opens it, `⌘↵` / `Ctrl↵` in a new tab. Keys pressed during IME composition are ignored. Pointing at a row selects it; clicking opens it (a modifier or the middle button opens a tab). Three ways out, all equivalent: `← Back`, the browser's back (opening the sheet pushes a history entry, so the phone's back gesture closes it and leaves the page where it was), and `Esc`, which clears the query first and closes only when the query is empty. A polite live region reports the result count or the miss.

**GUNMAN.** Typing `gunman` opens a full-screen revolver range in the same 1-bit hand (`features/gunman/`, loaded only then). First person, one revolver, double action: the trigger raises the hammer and turns the cylinder one chamber, the hammer falls 70 ms later, and the chamber either fires (flash, recoil, synthesized report with range echo) or clicks dry. `R` swings the cylinder out and ejects six cases, then loads one round per press (hold to keep a cadence); a full cylinder or a shot flicks it shut, and it coasts, ticking past each chamber, before it latches. `S` spins the open cylinder. Paper target with persistent holes and ring scores, amber bottles that shatter, steel plates that ring and fall, a swinging plate, combo multiplier, a cylinder diagram that turns with the real one. Arrow keys aim and Space fires; Esc returns to the search with its query intact. A real Exit button, and a Reload button on touch screens. All sound is synthesized with Web Audio.

**Japanese.** The index is built with Japanese pre-segmented (`segmented-pagefind`), so queries are segmented the same way with `Intl.Segmenter`, and the segmentation spaces are removed from titles and excerpts before display.

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

No other transitions exist. This list is exhaustive. (A row's length rule turning amber on hover is a state switch with no duration, not a transition.)

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
- Search input carries `<label>` or `aria-label`, plus the `combobox` role that binds it to the results `listbox` while they are on screen.
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
- The paper texture extends **one viewport above and below** the visible area.
  iOS stretches the whole page past the end of the document on an overscroll,
  and a fixed layer stretches with it — sized to the viewport exactly, it pulled
  away and left a band of bare BG with a hard horizontal edge across the screen
  every time the reader flicked to the bottom. The overshoot is measured in `vh`,
  never `dvh`: a layer whose height changes when the browser toolbar collapses
  re-tiles its 768px grain mid-scroll

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

### Environment Overrides

Two settings come from outside the page and must beat every component that disagrees with them. They live in one unlayered stylesheet loaded last (`environment.css`) — layered rules lose to unlayered ones no matter how specific they are, which is exactly the property needed here. Nothing else may be written there; anything that is has no way left to be overridden but `!important`.

**`prefers-reduced-transparency: reduce`.** Every `backdrop-filter` in the interface — the prose panel and the reveal disc — becomes opaque. Blur does not remove what is behind a surface, it only makes it unreadable while leaving it visible; for a reader who has asked for less transparency, that is the worst of both.

**`print`.** Paper gets the writing and the rules that carry it, nothing else. The texture, header, footer, sidebar, TOC, article actions, reveal disc, and copy buttons are all removed — none of them can be operated on paper. Collapsed articles are printed in full, since the collapse exists to shorten a scroll and paper has none. Code blocks invert to black-on-white: a dark slab at print resolution is a solid rectangle of ink that costs a cartridge and reads worse than the page it came from. Headings avoid breaking away from what follows them; code blocks, quotes, tables, and list items avoid breaking across pages. Links in the prose print their URL after the text, because a link on paper is otherwise a dead end.

---

## 10. Decision Framework

When an implementation question arises that this specification does not explicitly address, apply these filters in order:

**Adding an element.** Ask: "If this element did not exist, would the reader fail at their task?" If the answer is no, do not add it.

**Applying a color.** Ask: "What information does this color carry?" If the answer is "none" or "it looks nice," do not apply it.

**Adding an animation.** Ask: "What state change does this animation communicate?" If the answer is "nothing — it just feels smoother," do not add it.

**Changing a font.** Consult the role table in §2. If the role already has an assigned typeface, do not change it. If the element does not fit any existing role, question whether the element should exist before assigning it a font.

**Reducing whitespace.** Verify against the 8px grid. The next permissible value is the nearest smaller multiple of 8 (or 4 as absolute minimum). The reason to reduce spacing is "these elements are semantically related and should appear grouped" — never "the whitespace feels wasteful."

**When uncertain.** Remove rather than add. The cost of a missing element is that it can be added later. The cost of a present-but-unnecessary element is that it will persist indefinitely, because removing things from a shipped interface requires a justification that adding them did not.
