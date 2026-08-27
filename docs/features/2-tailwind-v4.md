# #2 — Configure Tailwind CSS v4 (CSS-first, no config file)

## Done

Plumbing only — tokens are #9. Verified by running, not inferred:

- `@tailwindcss/vite` registered in `astro.config.mjs` under `vite.plugins`.
- `src/styles/global.css` with `@import "tailwindcss";` and an empty `@theme {}` awaiting #9.
- `pnpm typecheck` → **0 errors / 0 warnings / 0 hints**.
- `pnpm build` → the six utilities used in `src/` markup are emitted; a token appearing
  **nowhere in the repo** (`skew-y-12`) is absent, and adding it to `index.astro` makes it
  appear, then removing it makes it vanish again — mutation-checked in both directions.
- Emitted CSS is **4,849 B** (was 10,437 B before scoping the scan — see below).
- Dev server on `PORT=5080` → HTTP 200, classes render, served CSS contains `max-w-2xl`.
- Prettier sorts Tailwind classes: `p-8 mx-auto text-3xl max-w-2xl font-bold` →
  `mx-auto max-w-2xl p-8 text-3xl font-bold`.
- No `tailwind.config.*` file anywhere; no `cdn.tailwindcss.com` anywhere.
- `pnpm install --frozen-lockfile` clean.

## Changed

- `astro.config.mjs` — import `@tailwindcss/vite`, add `vite: { plugins: [tailwindcss()] }`.
- `src/styles/global.css` — new; `@import "tailwindcss"` + empty `@theme` block.
- `.prettierrc.json` — new; `prettier-plugin-astro` + `prettier-plugin-tailwindcss`,
  `tailwindStylesheet` pointed at `global.css` (v4 has no config file for the plugin to read).
- `.prettierignore` — new.
- `src/pages/index.astro` — imports `global.css`, carries a few utilities purely as proof of
  the pipeline. Not design work; #9/#14 replace it.
- Versions resolved with `pnpm view`: tailwindcss **4.3.3**, @tailwindcss/vite **4.3.3**,
  prettier **3.9.6**, prettier-plugin-tailwindcss **0.8.1**, prettier-plugin-astro **0.14.1**.

## Review follow-up — round 1

**Tailwind was scanning the entire repository, and my verification claimed the opposite.**

The original handoff asserted that `.rotate-45` being absent from the built CSS proved the
scanner was working. It did not: `.rotate-45` **was** in the CSS, emitted because _this very
document_ named it while claiming it was absent. The check refuted itself. Ordinary prose in
`README.md`, `auto-dev.md` and `docs/` was generating production utilities — `.inline`,
`.grid`, `.fixed`, `.border`, `.table` were all emitted despite appearing nowhere in `src/`,
and the stylesheet grew with the specs rather than the markup.

Cause: Tailwind v4's automatic source detection walks the project root and extracts candidate
strings from every non-ignored text file. Fixed by scoping it in `global.css`:

```css
@import "tailwindcss" source("../");
```

`source("../")` is relative to the stylesheet, so from `src/styles/` it points the scanner at
`src/`. Anything outside `src/` that ever needs scanning gets an explicit `@source` line
rather than arriving by accident.

|                                                            | before   | after             |
| ---------------------------------------------------------- | -------- | ----------------- |
| CSS size                                                   | 10,437 B | **4,849 B**       |
| `.rotate-45` `.inline` `.grid` `.fixed` `.border` `.table` | present  | **absent**        |
| the six utilities `src/` actually uses                     | present  | **still present** |

**Lesson: a negative test whose token appears in the test's own description proves nothing.**
The replacement uses a token verified absent from the whole repo first, then mutation-checks
it in both directions — absent, added to markup → present, removed → absent.

**Files this PR adds now satisfy the formatter this PR ships.** `.prettierrc.json` and
`docs/features/*.md` were failing `prettier --check` on the config they introduce.
`README.md` and `auto-dev.md` remain the only known-failing pair, deliberately, for #3.

## Decisions

- **`prettier-plugin-astro` installed here, though it reads as #3's dependency.**
  `prettier-plugin-tailwindcss` imports it to parse `.astro`, and without it Prettier fails
  with `ERR_MODULE_NOT_FOUND` on every `.astro` file — so class sorting, which _is_ #2's
  deliverable, cannot work at all. Installing it in #3 instead would have meant shipping #2
  with its one feature broken.
- **`tailwindStylesheet` rather than the plugin's old `tailwindConfig` option.** v4 is
  CSS-first; there is no config file to point at, so the plugin is pointed at the stylesheet
  that holds `@theme`.
- **The three contract documents are in `.prettierignore`.** `docs/{SPEC,BRAND,AGENT}.md` are
  authored outside this repo's formatting rules and BRAND.md's own preamble says they win over
  code — rewriting them to satisfy a formatter would be backwards.
- **`README.md` and `auto-dev.md` still fail `prettier --check`** and are deliberately left
  alone. Reformatting them is unrelated churn in a Tailwind PR; `pnpm lint` is #3's
  deliverable and that is where the repo-wide formatting pass belongs.

## Blocked

Nothing.

## Next

**#3 — ESLint 9 flat config + Prettier with codebase bans enforced.** It inherits the
Prettier setup here and owns making `pnpm lint` green repo-wide.

## Content TODOs

- `src/pages/index.astro` still carries the placeholder string "Scaffold only — see the
  sprint backlog." Replaced wholesale by #14.
