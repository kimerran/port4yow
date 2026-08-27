# #5 — Prisma 7 schema, first migration, PrismaClient singleton

## Done

- `prisma/schema.prisma` — every model and enum in SPEC §4.
- `prisma.config.ts` — Prisma 7 config: datasource URL, shadow DB, migrations path, seed
  command (wired for #6).
- `src/lib/db.ts` — one `PrismaClient` behind `@prisma/adapter-pg`, cached on `globalThis`
  in development.
- `prisma/migrations/20260827062653_init/` committed; `postinstall: prisma generate`.

**Verified against a real database, not inferred:**

| Check                                    | Result                                                                                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `prisma validate`                        | schema valid                                                                                                                                                                               |
| `migrate deploy` on a **fresh empty DB** | applied clean; scratch DB created and dropped                                                                                                                                              |
| Tables                                   | all **10** present                                                                                                                                                                         |
| Indexes                                  | all **6** SPEC §4 requires: `Project_status_sequence`, `ContactMessage_status_createdAt`, `Session_userId`, `Session_expiresAt`, `ProjectImage_projectId_sortOrder`, `RateLimit_expiresAt` |
| Singleton through Astro                  | `HTTP 200`, `{"users":0,"projects":0,"ok":true}`                                                                                                                                           |
| Connection reuse                         | 3 requests → **2** connections, so HMR is not opening a pool per reload                                                                                                                    |
| `src/generated/` gitignored              | yes                                                                                                                                                                                        |

`pnpm typecheck` 0/0/0 · `pnpm lint` ✓ · `pnpm build` ✓.

## Decisions

- **Prisma pinned to 7.10.0, not `@latest`.** `prisma`'s `latest` dist-tag currently points
  at **8.0.0-rc.12** — a release candidate — while `@prisma/client`'s `latest` is 7.10.0.
  Following AGENT §1.1 literally would have installed a prerelease CLI against a stable
  client. SPEC §2's `^7.7` resolves it, and CLI and client stay in lockstep. **Third forced
  version divergence this sprint** (after TypeScript and ESLint); all three point at SPEC §2
  needing an amendment.
- **`url` removed from the `datasource` block — SPEC §4's schema is out of date.** Prisma 7
  rejects it outright: _"The datasource property `url` is no longer supported in schema
  files."_ It moved to `prisma.config.ts`. SPEC §4 shows the Prisma 6 form, so **SPEC §4's
  schema block needs updating** — this is not a stylistic choice, the documented schema does
  not parse.
- **`prisma.config.ts` bridges `.env` with `process.loadEnvFile()`.** Prisma 7 no longer
  loads `.env` automatically and its `env()` throws on a missing variable, so `pnpm db:migrate`
  failed before it started. Same fix and same reasoning as `astro.config.mjs` in #7. Both
  files sit outside `src/`, so AGENT §3's ban and #47's rule are satisfied without an
  exemption; `src/lib/env.ts` stays the boundary for application code.
- **`db.ts` takes `DATABASE_URL` from `src/lib/env.ts`**, never `process.env` — required by
  #47's rule and correct regardless: the URL is validated once at boot.
- **Imports are extensionless.** The Prisma 7 generator emits `.ts`, not `.js`, so a `.js`
  specifier fails to resolve. Extensionless matches TS bundler resolution and how Vite/Astro
  resolve at build time.
- **Shadow database must exist before `migrate dev`.** SPEC §10 declares
  `SHADOW_DATABASE_URL` but `docker-compose.yml` creates only `portfolio`, so the first
  `migrate dev` fails with `P1003: Database portfolio_shadow does not exist`. Created by hand
  here. **Worth a follow-up** — either compose should create it or the first-run docs should
  say to. Not folded in, because it edits #4's file and belongs in its own change.

## Blocked

Nothing.

## Next

**#6 — seed script.** `prisma.config.ts` already points `migrations.seed` at
`prisma/seed.ts`.

## Content TODOs

None.
