# 18 · "Next card" footer and brand-voiced 404 page

## Done

- `getNextProject` — next published project by `sequence`, wrapping to the first.
- `NextCard.astro` — a face-down card back that flips to reveal the next title on
  hover **or focus**, instant under `prefers-reduced-motion`.
- The project detail page renders the footer, and omits it when there is no
  second published project.
- A DRAFT slug now renders the real 404 page instead of an empty body.

## Changed

| File                                | Why                                      |
| ----------------------------------- | ---------------------------------------- |
| `src/lib/project.ts`                | new `getNextProject` + `NextProject`     |
| `src/components/NextCard.astro`     | new — the flip card                      |
| `src/lib/__tests__/project.test.ts` | new — deck-walking rules                 |
| `src/pages/work/[slug].astro`       | renders block 7; 404 via `Astro.rewrite` |

## Decisions

**A DRAFT slug was returning an empty 404 body.** The page had
`return new Response(null, { status: 404 })`, which is the right _status_ with no
_body_ — so an unknown slug (which never matches this route, and so falls through
to `404.astro`) got the brand-voiced page, while a DRAFT slug got a blank screen.
Two different 404s for what SPEC §5 requires to be indistinguishable. Now
`Astro.rewrite("/404")`, which renders `404.astro` itself and inherits its 404
status. Both paths verified at 404 with a ~10 KB body.

**The flip is CSS-only, expressed in markup.** Tailwind v4.3's `transform-3d`,
`backface-hidden`, `rotate-y-180` and `perspective-distant` cover it, with
`group-hover:` and `group-focus-visible:` driving the same rotation — so BRAND
§11 holds (no new `@apply` recipe) and no JavaScript ships for this component.
Verified the utilities actually compile by grepping the built CSS rather than
trusting that the version supports them.

**`group-focus-visible` is not decoration.** BRAND §9 forbids hover-only
affordances, so focus drives the identical transform. The `<a>` is both the
group and the focus target.

**The card back is `aria-hidden`; the front holds the text.** The link's
accessible name is built entirely from the face-up side, so the title and suit
are announced whether or not the card has visually flipped. Nobody depends on
the animation having run.

**`gt` rather than `gte`** means a project sharing the current `sequence` is
skipped instead of being linked to — otherwise the footer could point at a
sibling reachable only by chance of insertion order. Returning `null` when the
next card resolves to the current slug is what stops a single-project site
rendering a card that links to the page you are on.

## Verified

Gate re-run after the last edit: `typecheck` 0 errors / 0 warnings / 0 hints ·
`lint` PASS · `test` **110** passed (7 files) · `build` PASS.

Against a running server with three published projects and one DRAFT:

| Acceptance criterion                        | Result                                                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Tabbing reveals the title without a mouse   | focused after 7 real `Tab` key events, `:focus-visible` matched, transform `none` → `rotateY(180deg)` |
| Cycling reaches every project and wraps     | `sample-ledger → sample-intake → sample-pipeline → sample-ledger`                                     |
| `/does-not-exist` and a DRAFT slug both 404 | both **HTTP 404** with the brand-voiced body                                                          |

Reduced motion, measured by sampling the transform 60 ms after focus:

| Setting  | `transition-property`                 | transform at +60ms               |
| -------- | ------------------------------------- | -------------------------------- |
| normal   | `transform, translate, scale, rotate` | mid-flight (`-0.0002, 0, -1, …`) |
| `reduce` | `none`                                | already final (`-1, 0, 0, …`)    |

So the flip is instant rather than absent — the title still appears on hover and
focus, which is what #18 asks for.

Mutation results for the deck-walking rules:

| Mutation                                        | Tests failed |
| ----------------------------------------------- | ------------ |
| remove the wrap-to-first fallback query         | 2            |
| `gt` → `gte` (stop skipping a tied sibling)     | 5            |
| drop the self-link guard                        | 1            |
| drop the `PUBLISHED` filter from the next query | 5            |

axe on the 404 page: **0 violations**. axe on the project page: 1 serious
violation, pre-existing and unrelated — see below.

No JavaScript ships for this component.

## Blocked

Nothing blocks this issue.

## Next

Sprint 3 is complete once #16, #17 and #18 merge.

## Found but out of scope

axe still reports the gold index rank at 2.1:1 on white (`#65`). BRAND §9 names
this explicitly — "gold on white (1.9:1 ✗ — decorative only, never text)" — and
the rank is text, so the rule and the code disagree. Not fixed here: it is a
BRAND colour decision.

## Content TODOs

None.
