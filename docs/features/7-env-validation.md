# #7 — Boot-time environment validation (`src/lib/env.ts` + `.env.example`)

## Done

- `src/lib/env.ts` — a Zod schema over all **23** SPEC §10 variables, parsed once at module
  load. Exports a **frozen** typed object; `Env` is inferred with `z.infer`, so there is no
  parallel interface (AGENT §2).
- **Crashes at boot** on a missing or malformed value, naming every offending key. No secret
  has a default — falling back to one would be worse than failing to start.
- `.env.example` committed with every key present and every secret blank.

**Verified — 12 cases, negative and positive:**

| Rejected                                     | Accepted                                  |
| -------------------------------------------- | ----------------------------------------- |
| `SESSION_SECRET` missing                     | minimal valid set                         |
| `SESSION_SECRET` under 32 chars              | `RESEND_ENABLED=true` **with** an API key |
| `DATABASE_URL` not `postgresql://`           | `ADMIN_PASSWORD` absent (seed-only)       |
| `PUBLIC_SITE_URL` not a URL                  | `PORT` unset → defaults to 4321           |
| `CONTACT_TO_EMAIL` malformed                 |                                           |
| `PORT` out of range                          |                                           |
| `RESEND_ENABLED=true` **without** an API key |                                           |
| `LOG_LEVEL` unknown                          |                                           |

Empty environment → process dies with a named list. `.env.example` and the schema match
**key for key, 23 = 23**, checked by enumerating both rather than by eye. `env` is frozen.
`grep -rn "process\.env" src/` returns **only `src/lib/env.ts`** — the AGENT §3 acceptance
criterion.

`pnpm typecheck` 0/0/0 · `pnpm build` OK · `.env` confirmed gitignored.

## Decisions

- **`ADMIN_PASSWORD` is optional in the schema.** SPEC §10 lists it, but it is consumed by
  `prisma/seed.ts` (#6), never by the running server — requiring it would stop production
  booting over a value production does not use. The seed applies SPEC §4's stricter rules
  (16+ chars, refuse known placeholders) at its own boundary, which is where that check
  belongs.
- **`RESEND_ENABLED=true` without `RESEND_API_KEY` is a hard failure.** Not in SPEC as such,
  but the alternative is silently dropping every contact email (SPEC §7) — fail closed
  (AGENT §1.5).
- **Secret floor is 32 characters**, not a length SPEC names. `openssl rand -base64 48`
  produces 64, so the floor rejects hand-typed values without rejecting the documented
  generator.
- **Booleans accept `true|false|1|0`** and normalise. `.env` files carry strings, and
  `Boolean("false")` is `true` — a trap worth closing at the boundary.
- **`EnvSchema` and `loadEnv` are exported** so unit tests (#37) can parse fixtures. The
  eager `env` export still runs at import and still crashes — the export is additive, not an
  escape hatch. Note the consequence: **importing this module requires a valid environment**,
  so tests must set one before importing.
- **Errors never echo a value**, only the key and the reason — a validation error must not be
  the thing that leaks a secret into a log (AGENT §3, §4).

## Blocked

Nothing. Note `pnpm lint` **could not be run on this branch**: `eslint.config.js` is in
unmerged PR #47. `pnpm typecheck` and `pnpm build` both pass.

## Next

**#5 — Prisma schema, migration, PrismaClient singleton.** It was skipped earlier this run
and commented as blocked; `src/lib/db.ts` imports `DATABASE_URL` from this module rather than
reading `process.env`, which #47's lint rule forbids. #5 also still needs #48 merged and
port 5432 free.

## Content TODOs

None.
