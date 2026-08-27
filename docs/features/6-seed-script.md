# #6 — Idempotent seed script

## Done

`prisma/seed.ts`, run via `pnpm db:seed` through `prisma.config.ts`. Every write is an upsert
keyed on a unique column, so a second run produces identical state.

**Verified against a real database, every criterion exercised:**

| Check                                         | Result                                                                                             |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Idempotent                                    | run 1 and run 2 snapshots **identical** — counts and password hash unchanged                       |
| argon2id parameters                           | `$argon2id$v=19$m=19456,t=2,p=1` — the OWASP minimum SPEC §8 names, read back from the stored hash |
| Password never printed                        | absent from stdout; hash absent too                                                                |
| Re-run does **not** rotate a changed password | hash manually set to a sentinel survived a re-seed                                                 |
| `NODE_ENV=production` skips samples           | 0 projects, 13 stack items still seeded                                                            |
| `pnpm db:seed` wiring                         | works end to end through `prisma.config.ts`                                                        |

Refusals (SPEC §4.1), each with an accurate reason:

| `ADMIN_PASSWORD`                | Message                                                  |
| ------------------------------- | -------------------------------------------------------- |
| unset / empty                   | _is not set. Generate one with: openssl rand -base64 24_ |
| `short` (5)                     | _must be at least 16 characters (got 5)_                 |
| `admin`, `changeme`, `PASSWORD` | _is a known placeholder. Choose a generated value._      |
| 15 chars                        | rejected                                                 |
| 16 chars                        | accepted                                                 |

`typecheck` 0/0/0 · `lint` ✓ · `test` ✓ · `build` ✓ · `audit` ✓

## Decisions

- **Placeholder check runs before the length check.** SPEC §4.1 lists both, but every
  placeholder it names (`admin`, `password`, `changeme`) is shorter than 16 characters — so a
  length-first order makes the placeholder branch **unreachable** and tells someone who typed
  `changeme` that their password is too short. True, but not the useful reason. Reordering
  costs nothing and makes the rule mean what it says. Comparison is case-insensitive, so
  `PASSWORD` is caught too.
- **The seed does not import `src/lib/env.ts`.** That module validates the _whole_ server
  environment and refuses to boot without `SESSION_SECRET`, S3 credentials and the rest —
  none of which seeding needs. Importing it would mean you could not seed a database without
  a full production configuration. The seed reads the handful of variables it uses and
  applies SPEC §4's stricter password rules itself, which is where that check belongs. Being
  outside `src/`, AGENT §3's ban does not apply. This is the split #7 anticipated when it
  made `ADMIN_PASSWORD` optional in the env schema.
- **`update: {}` on the admin upsert.** Re-running must not rotate a password the operator has
  already changed, nor reset `failedLogins`/`lockedUntil`. Verified with a sentinel hash.
- **Stack items _do_ update on re-run**, unlike the user and settings: `suit`, `sortOrder` and
  `featured` are taxonomy the seed owns (BRAND §6), so a changed definition should propagate.
  `SiteSetting` uses `update: {}` because those values are edited through the admin UI (#31)
  and the seed must not stamp on them.
- **Sample projects are `DRAFT`** and non-production only, so nothing sample-shaped can reach
  the public site even if the guard were bypassed.

## Blocked

Nothing.

## Next

**#32 — structured logger, correlation ids, audit log.** Last open Sprint 1 issue.

## Review follow-up — ♥ Hearts contradicted BRAND §6

The seed put **Vitest and Playwright under ♥ Hearts**, which BRAND §6 defines as _Open source_.
They are test runners — ♣ Infrastructure & tooling by that table. Moved both.

The reasoning matters more than the two rows. ♥ is the only category in that table describing
**provenance** rather than a technology area: it is the slot for Mark's own open-source
contributions. Read as merely "this is open-source software", TypeScript, Node, Postgres,
Prisma, Astro, Tailwind, React, Docker and MinIO all qualify equally and the category carries
no information at all. Filling it with dependencies would have quietly redefined it before
anything real could occupy it — and it is **user-visible**: SPEC §5's `2 — The stack` section
renders these grouped by suit with a text label, so the public site would have read
_"Open source: Vitest, Playwright"_.

**♥ is now honestly empty** (verified: 0 rows). Seeded taxonomy:

| Suit       | Count | Items                                                      |
| ---------- | ----- | ---------------------------------------------------------- |
| ♠ Spades   | 4     | TypeScript, Node.js, PostgreSQL, Prisma                    |
| ◆ Diamonds | 3     | Astro, Tailwind CSS, React                                 |
| ♣ Clubs    | 6     | Docker, Railway, GitHub Actions, MinIO, Vitest, Playwright |
| ♥ Hearts   | **0** | — awaiting real content                                    |

Idempotency re-verified after the change; gate still green.

## Content TODOs

Every seeded string is placeholder copy awaiting Mark's real text, marked `TODO(content)`
in the file. Written in BRAND §8's voice — plain, specific, slightly dry — so it is not
embarrassing if it ships, and explicitly not the mock's rejected hero line:

- `hero.thesis`
- `about.body` (~70 words; SPEC §5 wants ~150)
- `social.github`, `social.linkedin` — **`social.linkedin` is a bare URL stub and needs a real
  profile path**
- All five sample-project text fields
- **♥ Hearts has no stack items.** Not an oversight — a question for Mark: does the stack
  section list actual open-source contributions, or does ♥ belong to _projects_ rather than
  stack items? An empty category is better than a wrongly-populated one, but the public
  "The stack" section will show three suits rather than four until this is answered.
