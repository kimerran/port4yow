# #11 — Scroll rail progress indicator

## Done

2px `deep-teal` line with one sine curve: vertical at the base of the desktop rail, a 2px top
bar on mobile (BRAND §7).

| Criterion                         | Result                                                                     |
| --------------------------------- | -------------------------------------------------------------------------- |
| Public-page JS                    | **714 B** — SPEC §15 allows 30 KB                                          |
| `prefers-reduced-motion: reduce`  | `dasharray: none`, `offset: 0px` — final state, no listeners attached      |
| Normal motion, top of a tall page | `offset: 240.32px` of `dasharray: 240.32px` — 0% drawn, correct            |
| Scroll-position maths             | **10 unit tests** — 0/50/100%, clamping above and below, unscrollable page |

`typecheck` 0/0/0 · `lint` PASS · **71 tests** · `build` PASS · `audit` PASS

## Correcting my own claim from #10

**#10's handoff said page-level inline scripts are "never hashed and get blocked". That was
too strong**, and I wrote it into #56's PR body where it could have misdirected this slice and
#21. The real distinction, tested directly:

| Form                         | Result                                        |
| ---------------------------- | --------------------------------------------- |
| `<script>` (Astro-processed) | **runs** — CSP header grew from 5 to 6 hashes |
| `<script is:inline>`         | **blocked**                                   |

So the rule is simply: **use a plain `<script>`; never `is:inline`.** The rail's logic still
lives in `src/scripts/scroll-rail.ts` and the layout imports it, which is better structure and
testable — but it was not forced by CSP the way I claimed.

## Two CSP findings that affect #12, #13 and #14

Both measured, not inferred:

- **Static inline `style="…"` attributes are BLOCKED.** Chrome logs _"Applying inline style
  violates the following Content Security Policy directive 'style-src …'"_. A `<div
style="height:4000px">` in my own probe silently collapsed to zero height, which is what sent
  me chasing a rail bug that did not exist. **Use classes, never a `style` attribute.**
- **Scripted style writes are FINE.** `element.style.strokeDashoffset = …` applies normally —
  confirmed via `getComputedStyle`, which returns the written value rather than an inert
  attribute. CSSOM writes are not covered by `style-src`.

The second matters because the rail depends on it; the first is a trap the next three slices
will hit if nobody writes it down.

## Decisions

- **The module does not self-execute.** `initScrollRail()` is exported and called from the
  layout's `<script>`. A self-executing module cannot be imported by a test — importing it
  threw `ReferenceError: document is not defined` — and the wiring belongs with the layout.
- **`scrollProgress()` and `dashOffset()` are pure and exported**, so the maths is testable
  without a browser.
- **The unfilled track is drawn at 10% opacity** so the rail reads as a progress indicator
  rather than a line that appears from nowhere (BRAND §7: "a progress indicator first and a
  dragon second").
- **`aria-hidden`** — it duplicates what the scrollbar already conveys.
- **rAF-throttled, `passive: true` listeners.** Only reads scroll position: no scroll-jacking,
  no parallax (BRAND §10).

## Not verified here — needs #39

**The rAF-driven DOM update is not exercised.** `requestAnimationFrame` never fires in headless
Chrome under `--virtual-time-budget` — measured directly: `raf:0 scrollEvents:1`, in both the
old and new headless modes, with and without `--run-all-compositor-stages-before-draw`.

So "progress tracks document scroll accurately at all three breakpoints" is verified at the
**computation** level (10 unit tests) and by confirming the initial paint is correct at each
breakpoint — but the scroll→rAF→write path has no harness until **#39** adds Playwright. The
test file says so rather than implying coverage it does not have.

## Next

**#12 — core components.** It extends the minimal `SuitGlyph` from #10, and must use classes
rather than `style` attributes per the CSP finding above.

## Content TODOs

None.
