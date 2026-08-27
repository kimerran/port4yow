# #8 — CI pipeline

## Done

`.github/workflows/ci.yml` runs everything AGENT §5 requires: typecheck, lint, test, audit,
gitleaks, production build. `.github/dependabot.yml` adds weekly npm and github-actions
updates (SPEC §14.12).

Every step was run locally before pushing, then the workflow itself was watched on the real
runner — a CI file that has never executed is unverified.

## Changed

- `.github/workflows/ci.yml` — new. Two jobs: `verify` (the gate) and `gitleaks` (separate,
  so a secret in history reads as its own red X).
- `.github/dependabot.yml` — new.
- `package.json` — `test` is now `vitest run --passWithNoTests`.
- `docs/features/4-docker-compose.md` — **formatted. See below.**

## Decisions

- **Fixed a regression I introduced in #48.** `docs/features/4-docker-compose.md` was not
  Prettier-formatted, so `develop` was **red** the moment #47's lint gate merged. I flagged in
  PR #48 that `pnpm lint` could not run on that branch — it merged before the gate existed,
  and the two crossed. Folded the fix in here rather than as a separate PR because #8's own
  acceptance criterion is "all steps green", and this was the only thing preventing that.
  **The general lesson: a PR that cannot run the gate is a PR that can break the branch it
  merges into.** Worth remembering while #49 is also in flight.
- **`vitest` installed here, with `--passWithNoTests`.** SPEC §12 defines `pnpm test` as
  `vitest run`, but the tool was never installed and there are no test files yet — bare
  `vitest run` exits 1 on "no test files found", which would make CI red by construction.
  The real suites are #37/#38; the flag comes out when the first one lands. Same shape as #2
  installing `prettier-plugin-astro`: a dependency this slice's own feature cannot work
  without.
- **`gitleaks` is its own job**, not a step in `verify`. A leaked secret and a failing type
  are different kinds of problem and should be separately legible in the checks list.
- **`fetch-depth: 0`** on both checkouts — gitleaks scans commit history, not just the tree,
  and a shallow clone silently narrows what it can see.
- **`concurrency` with `cancel-in-progress`** so a rapid second push supersedes the first
  instead of queueing.
- **Did not set `ignore-scripts`.** SPEC §14.12 suggests it "where feasible", but Prisma's
  client generation runs in `postinstall` (#5), so turning it off globally would break the
  build the moment #5 lands. Better addressed per-package when it matters.

## Review follow-up — round 1

**Dependabot would have opened every PR against `main`.** No `target-branch`, so both
ecosystems fall back to the repository default — and `main` is 15 commits behind `develop`
with **no `package.json` at all**, so npm bumps would have been computed against nothing and
landed on a branch nobody merges from. `target-branch: develop` on both. This is the
automated form of the mistake `auto-dev.md` already warns about for `--base develop`.

**`timeout-minutes` added** — 15 on `verify`, 10 on `gitleaks`. A wedged step otherwise runs
to GitHub's 6-hour default.

**`--passWithNoTests` moved out of `package.json`.** SPEC §12 specifies `"test": "vitest run"`
verbatim and the flag changed it. It now lives in `vitest.config.ts`, so the script is
byte-identical to the spec and the workaround sits where #37 will find it rather than being
inherited as a silently-green `pnpm test`. The caveat stands and is written into the config
comment: any slice that forgets tests still passes until #37 deletes the flag.

**Verification note for the next slice:** the gate went red on all four steps after these
edits, and none of it was the code — `node_modules` was stale from working on #49's branch
and switching back without reinstalling. `pnpm install --frozen-lockfile` after any branch
switch, before believing a failure.

## Blocked

Nothing.

## Next

**#5 — Prisma schema, migration, PrismaClient singleton**, once #49 merges: `db.ts` imports
`DATABASE_URL` from `src/lib/env.ts`.

## Content TODOs

None.
