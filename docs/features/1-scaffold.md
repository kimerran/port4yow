# #1 — Scaffold Astro 7 + TypeScript strict + Node 24 + pnpm

## Done

The application shell builds, typechecks, and serves. Verified by running, not by inference:

- `pnpm typecheck` (`astro check`) → **4 files, 0 errors, 0 warnings, 0 hints**.
- `pnpm build` → server built to `dist/server/entry.mjs`, the exact path SPEC §13's
  Railway start command expects.
- `pnpm install --frozen-lockfile` → clean, no lockfile drift.
- `pnpm dev` → `curl localhost:4321` returned **HTTP 200** and the placeholder page.
- No `tailwind.config.js`, no second lockfile, no UI framework in `package.json`.

## Changed

- `package.json` — name/private/type-module, `packageManager: pnpm@10.33.0`,
  `engines.node >=24 <25`, and the full SPEC §12 script set.
- `.nvmrc` — `24`.
- `astro.config.mjs` — `output: "server"`, `@astrojs/node` in `standalone` mode,
  `security.checkOrigin: true` (SPEC §14.4).
- `tsconfig.json` — extends `astro/tsconfigs/strict`, plus `noUncheckedIndexedAccess`
  and `exactOptionalPropertyTypes`; excludes `dist` and `src/generated`.
- `src/env.d.ts` — types `App.Locals.user`.
- `src/pages/index.astro` — placeholder only, no design work.
- `.gitignore` — `.env`, `dist/`, `.astro/`, `src/generated/`, uploads, dumps, logs.
- SPEC §3 directory layout created: `src/{components,layouts,pages,lib,actions,styles}`,
  `prisma/migrations`, `public`, `docs`.
- `SPEC.md`, `BRAND.md`, `AGENT.md` moved to `docs/` via `git mv` (history preserved).

## Review follow-up — `PORT` in dev (round 1)

`pnpm dev` ignored `PORT`, failing acceptance box 3 on #1. Fixed by wiring
`server: { port: Number(process.env.PORT ?? 4321) }` in `astro.config.mjs`. Production was
never affected — the standalone adapter reads `process.env.PORT` at runtime (SPEC §13).

**Trap worth knowing: Astro 7 daemonizes the dev server.** `astro dev` detaches, so killing
the `pnpm` wrapper leaves it listening — the next start prints *"Dev server already running
at http://localhost:4321"* and silently serves the **old** config on the **old** port. My
first verification of this fix was invalid for exactly that reason: it reported 4321 even
with a hardcoded `server.port`, which looked like the fix failing. Stop it explicitly with
`astro dev stop` between runs, or every port test after the first is meaningless.

Re-verified from a clean stop each time: `PORT=5055` → 200 on 5055; `PORT=6123` → 200 on
6123; `PORT` unset → 4321; `PORT=5056 node ./dist/server/entry.mjs` → 200 on 5056.

## Decisions

- **TypeScript pinned to 5.9.3, not 7.0.2.** AGENT §1.1 says install `@latest`; SPEC §2's
  stack table says `^5.9`. Registry latest is now **7.0.2** — the native Go rewrite — so
  the two instructions genuinely conflict. Took the spec's explicit target, because §2
  states a considered "Version target (Aug 2026)" and TS 7 against `@astrojs/check@0.9.10`
  is unvalidated. **This is a judgement call worth a human's confirmation**, and the
  upgrade is a one-line change if you want it.
  Verified with `pnpm view`, not recalled: astro **7.2.8**, @astrojs/node **11.1.4**,
  @astrojs/check **0.9.10**, typescript **5.9.3**.
- **SPEC §12 scripts committed verbatim, including ones that cannot pass yet.**
  `lint` needs #3, `test` needs #8/#37, `db:*` need #5. Stubbing them would have diverged
  from the spec; they fail loudly with "command not found" until their issues land.
- **`App.Locals.user` typed narrowly** (`id`, `username`, `displayName`) rather than as the
  Prisma `User`. `passwordHash` is deliberately absent — AGENT §2 forbids it reaching a
  template. #5/#23 replace this with a Prisma-derived type.
- **`README.md` left at the repository root** while the three specs moved to `docs/`, which
  is conventional. Its four links to `SPEC.md`/`BRAND.md`/`AGENT.md` are updated in this PR.

## Blocked

Nothing. #1 required no external credential or service.

## Next

**#2 — Configure Tailwind CSS v4 (CSS-first, no config file).** `astro.config.mjs` has a
comment marking where `@tailwindcss/vite` is registered.

## Content TODOs

- `src/pages/index.astro` is a placeholder with the literal string "Scaffold only — see the
  sprint backlog." It carries no BRAND voice and is replaced wholesale by #14.
