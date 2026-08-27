# #12 — Core components: SuitGlyph, Card, ProjectTile, Buttons, rank indices

## Done

The shared vocabulary every card surface is built from. All measured in headless Chrome.

| Criterion                                             | Result                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------- |
| Tiles exactly 5:7                                     | **0.714** at 375 / 768 / 1440 — `5/7 = 0.714`                        |
| Category announced as **text**                        | `"Category: Systems & backend"`, `"Category: Product & client work"` |
| `prefers-reduced-motion` removes lift and image scale | `transition-property: none` (from `transform`)                       |
| axe-core, zero **critical** violations                | **critical = 0**                                                     |

`typecheck` 0/0/0 · `lint` PASS · **72 tests** · `build` PASS · `audit` PASS

## The reduced-motion check I nearly got wrong

My first measurement read `transitionDuration` and saw **0.7s under reduced motion** — which
looked like a straight failure, and I was about to change working code. Tailwind's
`motion-reduce:transition-none` emits `transition-property: none`, **not** a zero duration: the
duration stays, and nothing transitions. Measuring `transitionProperty` shows
`transform → none`, which is correct.

Same lesson as `text-display-xl` in #9, inverted: there I measured the right thing and found a
real bug; here I measured the wrong thing and nearly invented one. **Check what the CSS rule
actually sets before concluding it does not work.**

## axe: one serious finding, sanctioned by BRAND

```
critical=0  serious=1  moderate=0
color-contrast: #d4af37 on #eef5f4 — ratio 1.9
```

That is the **gold sequence index** (`01`, `02`). BRAND §2 permits `metallic-gold` on rank
indices explicitly, **names the 1.9:1 figure itself**, and requires it be decorative-only. Both
gold elements carry `aria-hidden="true"` — verified in the served HTML. axe rates visual
contrast regardless of AT exposure, so it reports what BRAND already decided to accept. Not a
defect; recording it so the next reviewer does not re-litigate it.

`heading-order` and `region` also appeared at first and were **probe artifacts**: my scratch
page had `h1 → h3` with no section heading, and an `#axeout` div outside any landmark. Both
vanish with a real `h2` and the scan scoped to `<main>`.

**Contract for #14: `ProjectTile` renders its title as `h3`, so the "Selected work" section
must be an `h2`.** Otherwise heading order breaks on the real page.

## Decisions

- **The taxonomy moved to `src/lib/suits.ts`.** Astro forbids exporting values from components
  (`astro/no-exports-from-components`, caught by lint), and the taxonomy is data the schema,
  the seed and the admin UI all share — not a property of one component. `suitFromEnum()` maps
  Prisma's uppercase enum onto the component key and **throws on an unknown suit rather than
  guessing**. 11 tests, mutation-checked: rewording a category fails.
- **The whole tile is one `<a>`**, per BRAND §7 — one link target, not a nest.
- **Tile titles are Karla 700/18px, not the display face.** BRAND §3 calls the mock's
  `font-headline-md text-body-lg` on tile titles a defect: Bodoni's hairlines vanish below 32px
  and read as a rendering bug.
- **`RankIndex` renders at `headline-md` (32px)** — Bodoni's floor — and is `aria-hidden`, with
  the adjacent heading carrying the meaning.
- **Buttons use `min-h-11`** so they clear the 44px tap target, which is the bug measurement
  caught in #10's nav.
- **Classes only, never a `style` attribute** — #11 established that CSP blocks inline style
  attributes outright.

## Blocked

Nothing.

## Next

**#13 — hero card**, which uses `Card` and the `animate-deal` recipe, or **#14 — home page**,
which composes tiles under `h2` section headings.

## Content TODOs

None — all copy in the probe was scratch and is not committed.
