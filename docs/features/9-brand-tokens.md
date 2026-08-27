# #9 — BRAND tokens in Tailwind `@theme` + self-hosted fonts

## Done

Every token in BRAND §2–4 resolves as a utility, and all three families are served from our
own origin.

| Check                 | Result                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tokens → utilities    | **30/30** present in the built CSS — colours, shadows, type scale, radius, spacing, `aspect-card`, the three `@apply` recipes, and `font-display`/`font-body`/`font-mono` |
| Fonts self-hosted     | **6 `@font-face`** rules (3 families × 2 weights), files under `/_astro/fonts/`                                                                                           |
| Font actually serves  | `GET /_astro/fonts/font-bodoni-moda-600-normal-latin-….woff2` → **HTTP 200**, 25,804 bytes                                                                                |
| No third-party origin | **zero** `fonts.googleapis.com` / `fonts.gstatic.com` in `dist/` or the served HTML                                                                                       |
| Preload               | **display face only** — two Bodoni weights preloaded, Karla and Plex Mono not (SPEC §15)                                                                                  |
| Emitted CSS           | 5,363 B                                                                                                                                                                   |

`typecheck` 0/0/0 · `lint` ✓ · `test` 47/47 · `build` ✓ · `audit` ✓

## Decisions

- **SPEC §3's font wording is stale.** It says "Astro's built-in Fonts API
  (`experimental.fonts` / `astro:assets` fonts)". In Astro 7 `fonts` is a **top-level config
  key**, not experimental — confirmed against the installed type definitions rather than
  assumed. **SPEC §3 wants updating.**
- **`fontProviders.google()` does not contradict BRAND §3.** BRAND forbids "the Google Fonts
  CDN links from the mock" because they cost a third-party connection and leak visitor IPs.
  Astro's provider is a **build-time source**: it downloads the files and serves them from our
  origin. Verified rather than argued — zero Google references in `dist/` or the served
  document, and the `@font-face` `src` points at `/_astro/fonts/`.
- **Astro's `cssVariable` names are deliberately _not_ `--font-display` etc.** They are
  `--font-bodoni-moda`, `--font-karla`, `--font-plex-mono`, mapped into `@theme` as
  `--font-display: var(--font-bodoni-moda), Georgia, serif`. Astro emits its variables outside
  `@theme`, so Tailwind generated **no `font-display`/`font-body` utilities at all** until this
  indirection existed — caught by the utility check, not by reading the config. The mapping is
  also where BRAND §3's fallback stacks live.
- **`text-display-xl` is a `@utility`, not a plain token.** BRAND §3 requires 96 / 56 / 44px
  across breakpoints and says it "must never overflow the viewport"; a single token cannot
  express that. The `@theme` entry remains for the base scale.
- **`--radius-DEFAULT` and `--radius-lg` only.** No other radius values, and no
  `rounded-full` — BRAND §4.
- **`:focus-visible` is in `@layer base`**, so every interactive element gets the 2px
  `luminous-cyan` ring at 2px offset by default rather than per-component (BRAND §9).
- **`optimizedFallbacks: false`.** Astro can synthesise metric-adjusted fallback faces; BRAND
  §3 names the exact fallback stacks, and the document wins over a generator.

## Review follow-up — `text-display-xl` was 96px at every viewport

`--text-display-xl` was declared **both** as a `@theme` token and as a `@utility`. Tailwind
emitted four competing `.text-display-xl` rules in the same layer at identical specificity,
and the token-derived one is unconditional and **last** — so it won everywhere and both media
queries were dead code.

Measured in headless Chrome against the built CSS, not inferred from the cascade:

| Window | Before   | After    | BRAND §3 |
| ------ | -------- | -------- | -------- |
| 375px  | **96px** | **44px** | 44px     |
| 700px  | **96px** | **56px** | 56px     |
| 1200px | 96px     | 96px     | 96px     |

Mutation-checked by re-adding the token and re-measuring: 96px returns at all three widths.

96px display type at 375px is roughly four characters per line — the requirement this
`@utility` existed to satisfy ("must never overflow the viewport") was the exact thing it
failed. Fixed by dropping the four `--text-display-xl*` lines from `@theme`; the responsive
steps now live in the `@utility` only. No other type token has a `@utility` counterpart, so
`text-display-xl` was the only colliding name.

**This is the same failure shape as the missing `font-display` utility earlier in this slice,
one level deeper:** the config reads correctly, the utility exists, the build is green, and
the rendered result is still wrong. The check has to be _what size renders at 375px_, not
_does the class exist_. Carrying that into #10/#13/#14, which actually render the hero.

## Blocked

Nothing, but one hand-off detail matters.

**The `<Font>` component must be rendered in `<head>` or no `@font-face` is emitted.** The
`fonts` config alone is not enough — I verified this the wrong way round first, seeing the
variables resolve while no face loaded. **#10's `BaseLayout` must include:**

```astro
import {Font} from "astro:assets";
<Font cssVariable="--font-bodoni-moda" preload />
<Font cssVariable="--font-karla" />
<Font cssVariable="--font-plex-mono" />
```

`preload` on the display face only — that is what SPEC §15 asks for, and it is the LCP element.

## Next

**#10 — BaseLayout**, which consumes these tokens and carries the `<Font>` tags above.

## Content TODOs

None.
