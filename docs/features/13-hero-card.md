# #13 — Hero card (Jack of Diamonds) with one-time deal animation

## Done

The site's one signature element (BRAND §5). Everything measured in headless Chrome.

| Criterion                | Result                                                              |
| ------------------------ | ------------------------------------------------------------------- |
| Card width               | **280px** below `md`, **380px** above — exactly BRAND §5            |
| Deal runs **once**       | `animation-name: deal-card`, `iteration-count: 1`, `duration: 0.8s` |
| `prefers-reduced-motion` | `animation-name: none`, `duration: 0s` — renders in final state     |
| No horizontal scroll     | `false` at 375 / 768 / 1440                                         |
| Radial gold wash renders | `radial-gradient` present in the computed background                |
| axe-core on `<main>`     | **critical 0 · serious 0 · total 0**                                |
| Public-page JS           | **782 B** (SPEC §15 budget 30 KB)                                   |

`typecheck` 0/0/0 · `lint` PASS · **82 tests** · `build` PASS · `audit` PASS

## BRAND §5's "only" claims, checked against the built CSS

BRAND calls the deal _"the only rotation, the only radial wash, and the only entrance
animation on the site"_. Verified rather than asserted:

```text
@keyframes defined:      ['deal-card']      — one entrance animation
gradient rules:          the hero wash only — emitted twice, as the color-mix
                         form plus its #d4af3714 fallback, i.e. one gradient
rotate() literals:       ['-15deg']         — from deal-card
```

The 180°-rotated bottom-right index is BRAND §5's own requirement ("the same block rotated
180°, exactly as a real court card repeats itself") and compiles through Tailwind's
`--tw-rotate` custom property rather than a literal, which is why it does not appear above.

## A measurement that looked like a failure and was not

`getBoundingClientRect().width` reported the card at **409px** on mobile and **555px** on
desktop — apparently way over BRAND's 280/380. It is not: `--virtual-time-budget` freezes
animations the same way it freezes `requestAnimationFrame` (#11), so the deal was stuck at its
`from` state — `rotate(-15deg) scale(1.1)` — and a rotated element's axis-aligned bounding box
is much larger than its layout box.

`offsetWidth`, which ignores transforms, reports **280 / 380** exactly. Under reduced motion
the rect agrees, because no transform is applied.

**Measure layout with `offsetWidth` when anything on the element is transformed.** Third
variant of the same lesson this sprint: #9 measured the right property and found a real bug,
#12 measured the wrong property and nearly invented one, and here the right property was
measured under conditions that changed its meaning.

## Decisions

- **The radial wash is an `@utility` in `global.css`, not a `style` attribute.** BRAND §2
  allows exactly one gradient and this is it; CSP blocks static `style` attributes outright
  (#11), so it could not be inline even if that were tidier.
- **`color-mix(in srgb, var(--color-metallic-gold) 8%, transparent)`** keeps the 8% expressed
  against the token rather than hard-coding a fourth gold value.
- **The monogram and both indices are `aria-hidden`.** The card is a picture of a playing card;
  the page's `<h1>` carries the name. A screen reader announcing "J J MHN" would be noise.
- **No cardology anywhere** (BRAND §1). This reads as a playing card and nothing else — no
  tarot, no star maps, no zodiac glyphs, no mystic type.
- **`index.astro` places the hero but is still a placeholder.** #14 builds the five real
  sections around it.

## Blocked

Nothing.

## Next

**#14 — home page.** Two contracts carry into it:

- `ProjectTile` titles are `h3`, so "Selected work" must be an `h2` (#12).
- The hero thesis and about copy come from `SiteSetting`, seeded in #6 and still `TODO(content)`.

## Content TODOs

- The hero card's stack list is hard-coded in `index.astro` as a placeholder. #14 should read
  featured `StackItem` rows from the database instead.
