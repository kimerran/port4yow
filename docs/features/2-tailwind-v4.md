# #2 — Configure Tailwind CSS v4 (CSS-first, no config file)

## Done

Plumbing only — tokens are #9. Verified by running, not inferred:

- `@tailwindcss/vite` registered in `astro.config.mjs` under `vite.plugins`.
- `src/styles/global.css` with `@import "tailwindcss";` and an empty `@theme {}` awaiting #9.
- `pnpm typecheck` → **0 errors / 0 warnings / 0 hints**.
- `pnpm build` → utilities used in markup are present in the emitted CSS
  (`.mx-auto`, `.max-w-2xl`, `.p-8`, `.text-3xl`, `.font-bold`); an unused `.rotate-45` is
  **absent**, which proves the scanner is working rather than dumping the whole framework.
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

## Decisions

- **`prettier-plugin-astro` installed here, though it reads as #3's dependency.**
  `prettier-plugin-tailwindcss` imports it to parse `.astro`, and without it Prettier fails
  with `ERR_MODULE_NOT_FOUND` on every `.astro` file — so class sorting, which *is* #2's
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
