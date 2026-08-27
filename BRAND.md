# BRAND.md — "The Wild Card"

Visual system for **mh.neri.ph**, the portfolio of Mark Hugh Neri, full-stack engineer.
Derived from the approved mock. This file is the single source of truth for design decisions.
If code and this document disagree, this document wins — fix the code.

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
  --color-card-face: #FFFFFF;    /* cards, panels, inputs — lifted off the ground */
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
- **No gradients** except one: the radial `metallic-gold` wash at 8% opacity behind the hero card.
  The mock's `bg-gradient-to-br from-white/40` sheen on the card face is approved as the single
  exception, since it reads as light on stock rather than as decoration. Delete every other one.
- **Shadow is the only elevation device.** One recipe, sitewide:
  ```css
  --shadow-card: 0 1px 2px rgba(10,25,26,.08), 0 8px 24px rgba(10,25,26,.08);
  --shadow-card-hover: 0 4px 8px rgba(10,25,26,.12), 0 16px 32px rgba(10,25,26,.12);
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

- **Card ratio governs.** `aspect-ratio: 5 / 7` on the hero card and every project tile. Nothing on
  this site is a circle or a perfect square.
- **Radius:** `--radius-DEFAULT: 4px` for inline chips and inputs, `--radius-lg: 8px` for cards and
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

**The hero card.** One Jack of Diamonds, face up, 380px wide on desktop / 280px on mobile, in
`card-face` with a 1px `deep-teal`/15% border and `--shadow-card`.

- Top-left index: Bodoni `J` over a diamond pip in `luminous-cyan`. Bottom-right index: the same
  block rotated 180°, exactly as a real court card repeats itself.
- Center: an inset well in `surface-sunken` holding the monogram at 10% opacity, with the stack list
  set in IBM Plex Mono at 10px along the lower half.
- Behind it: a single radial `metallic-gold` wash at 8%, falling off fast into `cool-stock`.

**Deal animation, on load, once:**

```css
@keyframes deal-card {
  from { opacity: 0; transform: translate(-50px, -50px) rotate(-15deg) scale(1.1); }
  to   { opacity: 1; transform: none; }
}
.animate-deal { animation: deal-card .8s cubic-bezier(.2,.8,.2,1) both; }
@media (prefers-reduced-motion: reduce) { .animate-deal { animation: none; } }
```

This is the only rotation, the only radial wash, and the only entrance animation on the site. Every
other element is still until the visitor touches it.

---

## 6. Structural devices

**Rank indices, not numbers.** Sections are marked with card ranks in `metallic-gold` Bodoni:

`A` Selected work · `2` The stack · `3` Background · `K` Contact

A spread genuinely is an ordered deal, so the rank encodes position. Project tiles use sequence
numbers (`01`, `02`) in mono because that is a real ordering of the work.

**Suits are taxonomy, not ornament.** Every project and stack item carries exactly one suit:

| Suit | Category |
|---|---|
| ◆ Diamonds | Product & client work |
| ♠ Spades | Systems & backend |
| ♥ Hearts | Open source |
| ♣ Clubs | Infrastructure & tooling |

Render suits as inline SVG or the Unicode glyph with `aria-hidden="true"`, always paired with a
visible or screen-reader text label. Never rely on the glyph alone to convey category. Icon usage
beyond suits is limited to a small set for social links and form states — **remove the Material
Symbols dependency from the mock**; inline SVG only, no icon font.

---

## 7. Components

**Project tile** — `aspect-card`, `card-face`, 1px `deep-teal`/15%. Mono sequence number top-left in
gold; suit glyph bottom-right rotated 180°. Image well in `surface-sunken`. Title Karla 700/18px,
one-line outcome in `ink-muted`, up to three mono stack chips. The whole tile is a single `<a>` to
`/work/[slug]`. Hover: `translateY(-4px)` and `--shadow-card-hover` over 300ms; image scales to
1.05 over 700ms. No flip, no rotation.

**Buttons** — Primary: `luminous-cyan` fill, `ink-navy` text, `radius-lg`, mono uppercase 12px,
+0.1em. Secondary: `card-face` fill with 1px `deep-teal`/20% border. Hover lifts 4px. Disabled drops
to `outline-variant` fill with `ink-muted` text and no lift. Buttons never become pills.

**Form fields** — `card-face` fill, 1px `outline-variant`, `radius-DEFAULT`, Karla 16px (never
smaller — 16px prevents iOS zoom-on-focus). Label above in mono `label-sm`. Focus:
2px `luminous-cyan` ring at 2px offset. Error: 1px `error` border, message below in Karla 14px
`error`, tied via `aria-describedby`.

**Metadata strip** (project detail) — mono `label-sm`, `ink-muted`, items separated by a gold
middot, wrapping to two lines on mobile.

**Code / stack lists** — `surface-sunken` ground, 1px `outline-variant`, IBM Plex Mono 14px.
Syntax: `deep-teal` keywords, `secondary` (#735C00) strings, `outline` comments.

**Navigation** — one nav, not two. The mock defines both a top bar and an 80px left rail, both
`hidden md:flex fixed` — they collide. Ship the **left rail on desktop** (80px, `card-face`, 1px
`outline-variant` right border, suit-glyph links, scroll-progress rail at the bottom) and a **sticky
top bar on mobile** (56px, name left, menu right).

**Scroll rail (the dragon)** — 2px `deep-teal` line at the base of the left rail that fills with
scroll progress, with one slight sine curve. On mobile it becomes a 2px top progress bar. It reads
as a progress indicator first and a dragon second. Disabled under `prefers-reduced-motion`.

---

## 8. Voice

Plain, specific, slightly dry. Precision is the personality; the cleverness of the Jack shows up as
accuracy, never as jokes.

- No "passionate about", no "crafting digital experiences", no "let's build something amazing".
- Headings are nouns in sentence case: "Selected work", "The stack", "Background".
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
  `outline` on `card-face` (4.6:1 ✓), gold on white (1.9:1 ✗ — decorative only, never text).
- Visible focus on every interactive element: 2px `luminous-cyan`, 2px offset. Never `outline: none`.
- `prefers-reduced-motion: reduce` disables the deal, the rail fill, tile lifts, and image scale.
  Everything renders in final state.
- Semantic landmarks, one `<h1>` per page, heading levels never skipped.
- Suit glyphs `aria-hidden` with adjacent text; form errors announced via `aria-live="polite"`.
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
  `.card-shadow`, `.card-hover`, `.animate-deal`.
