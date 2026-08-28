# BRAND.md — "The Wild Card"

Visual system for **mh.neri.ph**, the portfolio of Mark Hugh Neri, full-stack engineer.
Derived from the approved mock. This file is the single source of truth for design decisions.
If code and this document disagree, this document wins — fix the code.

> ## Amendment — the playing-card metaphor is removed
>
> The literal playing card is **gone from the rendered site**: no suit pips, no 5:7 card
> faces, no corner indices repeated at 180°, no deal-in entrance, no flip-to-reveal.
> Sections 4, 5, 6, 7, 9 and 11 are amended below and the amended text governs.
>
> **What survives**, because none of it depended on the card being literal:
>
> - The palette, the type scale, the spacing scale, and the facet lattice.
> - The single radial `metallic-gold` wash, now behind the hero panel.
> - The scroll rail — it was always the dragon's line, not a card.
> - Rank indices (`A`, `2`, `3`, `K`) as section markers, and `01`, `02` as project
>   ordering. These read as ordinals, not as cards, to anyone who was not told.
> - **The suit taxonomy as data.** Every project and stack item still carries one of four
>   suits, because that is the schema and the four categories are real. What changed is
>   that the suit is now purely a storage key: `SUIT_CATEGORY` is the only form a visitor
>   sees. See §6.
>
> §1's identity line no longer describes the site. The metaphor that remains is
> **precision**, not cards — the same restraint, minus the costume.

---

## 1. Identity in one line

A playing card is already a card UI. This site makes that literal: every surface carries the
proportions, corner indices, and suit logic of a real card, executed with engineering precision.

Symbol sources — used as **material vocabulary only, never as subject matter**:

| Source | What it contributes | Where it shows up |
|---|---|---|
| Jack of Diamonds (birth card) | The wild card; diamonds as value and the cut facet | Hero card, rank indices, suit taxonomy, facet lattice |
| Leo | Warm metal, light from a single source | `metallic-gold`, the radial wash behind the hero |
| Dragon | One continuous line, cool depth | `deep-teal`, the scroll rail |

**Hard rule:** a visitor must never need to know what cardology is. No tarot, no star maps, no
constellations, no zodiac glyph rows, no nebulae, no mystic typefaces. If the page reads as an
astrology product, the brand has failed.

---

## 2. Color tokens

Light theme only. There is no dark mode in v1 — do not add one.

```css
/* src/styles/global.css */
@import "tailwindcss";

@theme {
  /* Grounds */
  --color-cool-stock: #F2F7F7;   /* page ground — cool paper, never pure white, never cream */
  --color-surface-raised: #FFFFFF; /* panels, tiles, inputs — lifted off the ground */
  --color-surface-sunken: #EEF5F4;/* inset wells: image frames, code blocks */

  /* Ink */
  --color-ink-navy: #0A191A;     /* all primary text and headlines */
  --color-ink-muted: #3B4949;    /* body copy at secondary emphasis, captions */
  --color-outline: #6B7A7A;      /* borders at full strength, placeholder text */
  --color-outline-variant: #BAC9C9; /* hairlines, dividers, disabled */

  /* Accents — three, and only three */
  --color-luminous-cyan: #00CED1;/* primary action, live/active state, focus */
  --color-deep-teal: #004B4D;    /* the rail, link underlines, dense accent type */
  --color-metallic-gold: #D4AF37;/* rank indices and suit pips only */

  /* Status */
  --color-error: #BA1A1A;
  --color-error-container: #FFDAD6;
  --color-success: #005354;
}
```

### Rules of use

- **Gold is a marker, not a color.** `metallic-gold` is permitted on rank indices (`A`, `2`, `3`,
  `K`, `01`), suit pips, and one hairline rule per section. It is **never** used for body text,
  links, button fills, or anything below 14px — at `#D4AF37` on white it measures ~1.9:1 and fails
  WCAG badly. Where a gold-toned label must be readable, use `--color-secondary: #735C00` instead.
- **Cyan is the action color.** Primary buttons use `luminous-cyan` fill with `ink-navy` text
  (12.4:1 — passes). Never cyan text on white; it fails at ~2.2:1.
- **Deep teal is the rarest ink.** Maximum two appearances per viewport: the scroll rail and prose
  link underlines.
- **No gradients** except one: the radial `metallic-gold` wash at 8% opacity behind the hero panel.
  The mock's `bg-gradient-to-br from-white/40` sheen on the card face is approved as the single
  exception, since it reads as light on stock rather than as decoration. Delete every other one.
- **Shadow is the only elevation device.** One recipe, sitewide:
  ```css
  --shadow-panel: 0 1px 2px rgba(10,25,26,.08), 0 8px 24px rgba(10,25,26,.08);
  --shadow-panel-hover: 0 4px 8px rgba(10,25,26,.12), 0 16px 32px rgba(10,25,26,.12);
  ```
  No glassmorphism, no colored glows, no inner shadows.

---

## 3. Typography

Three families, three jobs, no overlap. Self-host via Astro's built-in Fonts API
(`experimental.fonts` / `astro:assets` fonts) — **do not** use the Google Fonts CDN links from the
mock. They cost a third-party connection and leak visitor IPs.

| Role | Family | Weight | Use |
|---|---|---|---|
| Display | **Bodoni Moda** | 600–700 | Headlines ≥32px only. The didone contrast of a real card index. |
| Body | **Karla** | 400 / 700 | All prose and UI text. |
| Mono | **IBM Plex Mono** | 500 / 600 | Rank indices, eyebrows, stack tags, metadata strips, code. |

```css
@theme {
  --font-display: "Bodoni Moda", Georgia, serif;
  --font-body: "Karla", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;

  --text-display-xl: 96px;   /* line-height 100px, tracking -0.02em, 700 — hero only */
  --text-headline-lg: 48px;  /* 56px, 600 — project detail titles */
  --text-headline-md: 32px;  /* 40px, 500 — section headings */
  --text-body-lg: 18px;      /* 1.6, 400 — hero thesis, lead paragraphs */
  --text-body-md: 16px;      /* 1.6, 400 — default */
  --text-label-sm: 12px;     /* 16px, +0.1em, 500, uppercase — mono labels */
  --text-index-rank: 14px;   /* 14px, +0.05em, 600 — corner indices */
}
```

**Never set Bodoni below 32px.** At small sizes the hairlines disappear and it reads as a rendering
bug. The mock does this on project-tile titles (`font-headline-md text-body-lg`) — that is a defect;
tile titles are **Karla 700 at 18px**.

**Mobile display size:** `display-xl` drops to 56px below `md`, 44px below `sm`. It must never
overflow the viewport.

Restraint rule: the display face appears in exactly four kinds of place — the hero name, section
headings, project detail titles, and the closing line. Nowhere else.

---

## 4. Geometry

- ~~**Card ratio governs.** `aspect-ratio: 5 / 7` on the hero card and every project tile.~~
  **Amended:** the 5:7 ratio is removed with the metaphor — it *was* the metaphor, more than
  the pips were. Panels are sized by their content. Where a fixed ratio is still wanted so a
  grid stays even, the element asks for one directly: the project tile's image well is
  `16/10` and the hero's inset well is `4/3`. Nothing on
  this site is a circle or a perfect square.
- **Radius:** `--radius-DEFAULT: 4px` for inline chips and inputs, `--radius-lg: 8px` for panels and
  buttons. **No other values. No `rounded-full`.** The `rounded-full` on the mock's avatar-style
  elements must be removed.
- **Spacing scale** (Tailwind `--spacing-*`): `4 / 8 / 16 / 24 / 40 / 64 / 96`, named
  `xs / sm / md / lg / xl / 2xl / 3xl`. Nothing between these values.
- **Facet lattice:** the page background carries a 60°/120° rhombus lattice derived from the diamond
  pip — `ink-navy` hairlines at 3% opacity, rendered as a fixed inline SVG pattern, dropping to 2%
  on mobile. Section boundaries snap to its vertices.
- **Rules and dividers:** 1px, `deep-teal` at 10% or `metallic-gold` at 35%, always inset to the
  content column, never full-bleed.
- **Content width:** 1280px max shell; prose capped at 66ch; the metadata strip and tile grid use
  the full column.

---

## 5. Signature element

**The hero panel.** 380px wide on desktop / 280px on mobile, in `surface-raised` with a 1px
`deep-teal`/15% border and `--shadow-panel`.

- An inset well in `surface-sunken` holding the monogram at 10% opacity, with the stack list set in
  IBM Plex Mono at 10px along the lower half. The well carries a `4/3` ratio of its own now that the
  panel no longer has a fixed height to divide.
- Behind it: a single radial `metallic-gold` wash at 8%, falling off fast into `cool-stock`.

~~Top-left index: Bodoni `J` over a diamond pip. Bottom-right index: the same block rotated 180°.~~
**Removed** — that pair of indices *was* the Jack of Diamonds.

~~**Deal animation, on load, once.**~~ **Removed.** The deal was a card being dealt onto a table;
with nothing being dealt it had no subject. Its keyframes, the `.animate-deal` utility and the
`--aspect-card` token are all deleted from `global.css`.

~~There is now no entrance animation on the site at all.~~ **Superseded.** That was true for as
long as the site had nothing to animate. It now has:

- **Scroll reveal** — sections and grids fade up 16px as they enter the viewport, once, never
  re-hiding on scroll-up. Staggered by 60ms across grid children, capped at 180ms.
- **The hero slideshow** — a 700ms crossfade every 5s, paused on hover, on focus, and while the
  tab is hidden.
- **A nav underline** that grows from the left on hover and focus.
- **The tile hover** — a 4px lift plus a 2px `deep-teal` inset border.

Two rules govern all of it. First, `prefers-reduced-motion: reduce` disables every one: no reveal
(the blocks are simply visible), no auto-advance, no lift. **The tile border highlight is the one
exception and stays** — it is a state change rather than motion, and it is what carries the
affordance; removing it would leave a reduced-motion visitor with no hover feedback at all.

Second, **the reveal opts IN to hiding.** The stylesheet hides a `.reveal` block only under
`[data-reveal-ready]`, which the script sets at startup. Script blocked, failed or still loading ⇒
nothing is hidden. The inverse (hide in CSS, reveal in JS) turns any script failure into a blank
page, and it is a failure that never appears in development because the script always loads there.

The radial wash is still the only gradient on the site outside the slideshow caption scrim.

`e2e/home.spec.ts` still guards the card geometry — nothing anywhere has a `5/7` aspect ratio,
`preserve-3d`, or `backface-hidden` — with motion **enabled**, because `motion.spec.ts` runs only
under `prefers-reduced-motion` where a regression would be suppressed and pass unnoticed.

---

## 6. Structural devices

**Rank indices, not numbers.** Sections are marked with card ranks in `metallic-gold` Bodoni:

~~`A` Selected work · `2` The stack · `3` Background · `K` Contact~~ — the rank markers
were removed, and the first heading is now **Projects**.

A spread genuinely is an ordered deal, so the rank encodes position. Project tiles use sequence
numbers (`01`, `02`) in mono because that is a real ordering of the work.

**These stay.** `A`/`2`/`3`/`K` and `01`/`02` are ordinals; they read as section markers to a
visitor who was never told about cards, which is exactly the test §1's hard rule sets.

**Suits are taxonomy, not ornament.** Every project and stack item carries exactly one suit:

| Suit | Category |
|---|---|
| ◆ Diamonds | Product & client work |
| ♠ Spades | Systems & backend |
| ♥ Hearts | Open source |
| ♣ Clubs | Infrastructure & tooling |

~~Render suits as inline SVG or the Unicode glyph with `aria-hidden="true"`, always paired with a
visible or screen-reader text label.~~

**Amended: nothing renders a suit.** The four-way taxonomy is real and stays in the schema, the
seed and the admin UI — but the **category name is the only form that reaches a visitor**. The pip
is gone (`SuitGlyph.astro` is deleted), and so is the bare suit word: a tile that once showed a gold
pip now shows "Product & client work", and the next-project link shows the category rather than the
word "hearts", which meant nothing without a pip beside it.

This makes the old rule unnecessary rather than violated. "Never rely on the glyph alone to convey
category" was guarding a glyph that no longer exists; the category is now always the text itself.

Icon usage is limited to a small set for social links and form states — **remove the Material
Symbols dependency from the mock**; inline SVG only, no icon font.

---

## 7. Components

**Project tile** — `surface-raised`, 1px `deep-teal`/15%, sized by its content. Mono sequence number
top-left in gold. ~~`aspect-card`; suit glyph bottom-right rotated 180°.~~ Both removed with the
metaphor; the category now appears as text in the body. Image well in `surface-sunken` at `16/10`
so the grid stays even across tiles whose summaries differ in length. Title Karla 700/18px,
one-line outcome in `ink-muted`, up to three mono stack chips. The whole tile is a single `<a>` to
`/work/[slug]`. Hover: `translateY(-4px)` and `--shadow-panel-hover` over 300ms; image scales to
1.05 over 700ms. No flip, no rotation — and now there is no flip or rotation anywhere on the site
to make an exception of.

**Buttons** — Primary: `luminous-cyan` fill, `ink-navy` text, `radius-lg`, mono uppercase 12px,
+0.1em. Secondary: `surface-raised` fill with 1px `deep-teal`/20% border. Hover lifts 4px. Disabled drops
to `outline-variant` fill with `ink-muted` text and no lift. Buttons never become pills.

**Form fields** — `surface-raised` fill, 1px `outline-variant`, `radius-DEFAULT`, Karla 16px (never
smaller — 16px prevents iOS zoom-on-focus). Label above in mono `label-sm`. Focus:
2px `luminous-cyan` ring at 2px offset. Error: 1px `error` border, message below in Karla 14px
`error`, tied via `aria-describedby`.

**Metadata strip** (project detail) — mono `label-sm`, `ink-muted`, items separated by a gold
middot, wrapping to two lines on mobile.

**Code / stack lists** — `surface-sunken` ground, 1px `outline-variant`, IBM Plex Mono 14px.
Syntax: `deep-teal` keywords, `secondary` (#735C00) strings, `outline` comments.

**Navigation** — one nav, not two. The mock defines both a top bar and an 80px left rail, both
`hidden md:flex fixed` — they collide. Ship the **sticky top bar at every width** (56px,
`surface-raised`, 1px `outline-variant` bottom border, name left, links right). This supersedes the
earlier resolution, which kept the left rail on desktop and the bar on mobile only; one bar at all
widths means the accessible tree has a single navigation landmark by construction rather than by
breakpoint, and it removes the shell's 80px left padding.

Links are **visible text labels at every width**. They briefly carried a suit glyph with the label
`sr-only` below `sm`, which fit because the glyph was doing the work on a phone; with the suits
removed a hidden label would leave the bar visually empty at 375px. The horizontal padding tightens
below `sm` (`px-xs` on links, `px-sm` on the bar) to buy the room the visible labels cost — measured
at 375px, not assumed.

The label is the accessible name, so WCAG 2.5.3 holds without an `aria-label`. Labels are shortened
from their section headings ("Projects" → "Work"); the heading stays long, the link stays
short. Every link is at least 44×44 including the name, which needs `min-w-11` at 375px where
"MHN" alone measures 35px.

**Scroll rail (the dragon)** — 2px `deep-teal` line that fills with scroll progress, with one
slight sine curve. It sits directly under the nav bar as a horizontal strip at every width (the
vertical `rail` variant went unused when the left rail did). It reads as a progress indicator first
and a dragon second. Disabled under `prefers-reduced-motion`.

---

## 8. Voice

Plain, specific, slightly dry. Precision is the personality; the cleverness of the Jack shows up as
accuracy, never as jokes.

- No "passionate about", no "crafting digital experiences", no "let's build something amazing".
- Headings are nouns in sentence case: "Projects", "The stack", "Background".
- Buttons name their action and keep the verb through the flow: **Send message** → **Message sent**.
- Errors say what happened and what to do, in the interface's voice: "That email address looks
  incomplete." Not "Oops! Something went wrong."
- Empty states are invitations: "No messages yet." Not an apology.
- Project copy states the problem and the outcome, with numbers where numbers exist.

The mock's hero copy ("deal winning hands in the digital space") is **placeholder and must be
replaced** — it is exactly the register this brand rejects.

---

## 9. Accessibility floor

Non-negotiable, verified before merge:

- All text meets WCAG 2.2 AA. Specifically check: `ink-muted` on `cool-stock` (7.9:1 ✓),
  `outline` on `surface-raised` (4.6:1 ✓), gold on white (1.9:1 ✗ — decorative only, never text).
- Visible focus on every interactive element: 2px `luminous-cyan`, 2px offset. Never `outline: none`.
- `prefers-reduced-motion: reduce` disables the rail fill, tile lifts, and image scale. (It used to
  disable the deal too; there is no entrance animation left to disable — see §5.)
  Everything renders in final state.
- Semantic landmarks, one `<h1>` per page, heading levels never skipped.
- Every inline SVG is `aria-hidden` with adjacent text — the scroll rail is the remaining one, the
  suit pips having been removed. Form errors announced via `aria-live="polite"`.
- Keyboard-operable throughout; no hover-only affordances.
- Tap targets ≥44×44px on mobile.

---

## 10. Reject list

Glassmorphism · blurred translucent nav bars · gradient buttons · pill shapes · shadows on every
element · emoji as icons · icon fonts · technology logo walls · scroll-jacking · cursor followers ·
marquee tickers · parallax · auto-playing anything · Inter, Playfair Display, Space Grotesk,
Montserrat · cream `#F4F1EA` with terracotta `#D97757` · dark mode · any literal astrology imagery.

---

## 11. Implementation notes for Tailwind v4

The mock uses the Tailwind v3 CDN with a JS `tailwind.config`. **Both are wrong for production.**

- Tailwind v4 is CSS-first: tokens live in `@theme` in `src/styles/global.css`. There is no
  `tailwind.config.js`. Token names above map directly to utilities — `--color-ink-navy` gives you
  `text-ink-navy`, `bg-ink-navy`, `border-ink-navy`.
- Install `@tailwindcss/vite` and register it in `astro.config.mjs`. Never ship the CDN script; it
  blocks render and defeats the CSP.
- The mock's Material Design token names (`on-surface-variant`, `surface-container-highest`, and so
  on) are noise carried in from a generator. Use only the tokens named in §2.
- Keep utility classes in the markup. Reach for `@apply` only for the three repeated recipes:
  `.panel-shadow`, `.panel-hover`. (`.animate-deal` was the third; it is deleted — see §5.)
