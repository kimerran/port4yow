# #14 — Home page: hero, Selected work (A), The stack (2), Background (3), Contact (K)

## Done

All five SPEC §5 sections against seeded data, measured on a built production server.

| Check                | Result                                                           |
| -------------------- | ---------------------------------------------------------------- |
| Sections + ranks     | `A` Selected work · `2` The stack · `3` Background · `K` Contact |
| Heading structure    | **1 × `h1`**, **4 × `h2`**, `h3` for tiles and stack groups      |
| Cache header         | `public, max-age=0, s-maxage=300, stale-while-revalidate=86400`  |
| Project tiles        | 3 rendered from `PUBLISHED` rows, ordered by `sequence`          |
| Logo images          | **0 `<img>`** — SPEC §5 says mono lists, no logos                |
| Prose cap            | `max-width: 705.083px` = **66ch** (BRAND §4)                     |
| Horizontal scroll    | **none** at 320 / 375 / 640 / 768 / 900 / 1024 / 1280 / 1440     |
| axe (reduced motion) | **4, all accepted exceptions** — see below                       |

`typecheck` 0/0/0 · `lint` PASS · **82 tests** · `build` PASS · `audit` PASS

## A real overflow bug at exactly 768px

`scrollWidth 774` against `clientWidth 753` — a horizontal scrollbar on tablets. The hero card
was the culprit:

```text
vw=753 scrollW=774   div[w-[280px]] w=380 r=774
```

**Two things change at the same breakpoint and collide.** BRAND §3 makes `display-xl` jump to
96px at `md`, and my hero switched to `md:flex-row` at the same width — so a 96px "Mark Hugh
Neri" and a 380px card were asked to share 768px. BRAND §3's own warning is that display-xl
"must never overflow the viewport"; this is that failure, one layer up.

Fixed by moving the row to `lg` and adding `min-w-0` so the text column can shrink. Below
1024px the card now stacks under the name, which reads better on a tablet anyway. Verified
across **eight** widths, not the usual three — the bug lived between 768 and 1024, which a
375/768/1440 sweep would have straddled without landing on.

**Test the breakpoints themselves, not just the canonical three.**

## Two probe artifacts I nearly reported as bugs

Worth recording, because both looked exactly like real findings:

- An earlier run reported `overflow=true` **and** an axe `region` violation. Both were caused
  by **my own probe `<div>`**, appended to `<body>` containing a long unwrapped JSON string.
  Moving the result into `document.title` removed both.
- The same run reported the prose at "78ch". That was my arithmetic (`width / fontSize × 2`),
  not the CSS. The computed `max-width` is **705.083px**, which _is_ 66ch for this face.

The instrument has to stay out of the measurement.

## axe — four findings, all previously accepted

Scanned with `--force-prefers-reduced-motion`, per #13: without it the frozen deal animation
leaves the hero at `opacity: 0` and axe silently skips the whole card.

| Node                          | Ratio | Sanctioned by                            |
| ----------------------------- | ----- | ---------------------------------------- |
| Hero monogram `.text-[96px]`  | 1.22  | BRAND §5 — "the monogram at 10% opacity" |
| Gold sequence index × 3 tiles | 1.9   | BRAND §2 — names the ratio itself        |

All `aria-hidden`. **Zero new violations** — the count scales with the number of tiles, not
with defects, which is what #43's sweep needs to know.

## Data layer

`src/lib/home.ts`. SPEC §5 asks for "one Prisma query with `include`"; projects, stack and
settings are three unrelated tables, so they cannot be one round trip — they are issued
concurrently instead. **The property that matters is no N+1**, and it holds: counted at the
database with `log_statement='all'`, one render with **3 projects** issues

```text
1 × Project · 1 × ProjectStack · 1 × StackItem (include) · 1 × StackItem (stack section) · 1 × SiteSetting
```

One `ProjectStack` query for three tiles, not three.

## Decisions

- **Empty state**: "The first cards are still being dealt." — an invitation, not an apology
  (BRAND §8). Exercised: the seed ships projects as `DRAFT`, so this is the default state.
- **♥ Open source renders no group.** Suits with no items are dropped rather than shown empty;
  #6 left ♥ deliberately unpopulated pending Mark's decision.
- **The contact form is #21.** SPEC §5's GitHub and LinkedIn links are here now; the form
  lands with its endpoint.

## Content TODOs

Everything user-facing is still seeded placeholder marked `TODO(content)` in `prisma/seed.ts`:
`hero.thesis`, `about.body` (~70 words against SPEC §5's ~150), `social.linkedin` (a bare
stub), and all sample-project copy.
