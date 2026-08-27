# mh.neri.ph

Personal portfolio of **Mark Hugh Neri**, full-stack developer / software engineer.

A public marketing site with a private admin CMS behind it. Astro SSR, Postgres, and a
private S3 bucket, deployed to Railway at [`mh.neri.ph`](https://mh.neri.ph).

> ### Status: early implementation — Sprint 1
>
> The scaffold is in place: `pnpm install`, `pnpm typecheck`, `pnpm build` and `pnpm dev`
> all work. The rest of the backlog is specified across
> [43 issues in 8 milestones](https://github.com/kimerran/port4yow/milestones).
>
> **Not everything in this README runs yet.** `pnpm lint` needs
> [#3](https://github.com/kimerran/port4yow/issues/3), `pnpm test` needs
> [#8](https://github.com/kimerran/port4yow/issues/8), and every `db:*` script needs
> [#5](https://github.com/kimerran/port4yow/issues/5).

---

## The documents

Three documents govern this project. They are the contract; where code and a document
disagree, the document wins.

| File | Authority | Covers |
|---|---|---|
| **[SPEC.md](docs/SPEC.md)** | What to build | Scope, data model, routes, auth, storage, security requirements, build order |
| **[BRAND.md](docs/BRAND.md)** | How it looks | "The Wild Card" visual system — tokens, type, geometry, components, voice, reject list |
| **[AGENT.md](docs/AGENT.md)** | How to work | Stack conventions, per-route security checklist, code style, definition of done |
| **[auto-dev.md](auto-dev.md)** | Autonomous loop | How an agent picks and ships the next issue |

Read all three before writing code.

---

## Scope

**Public** — home page, project detail pages, contact form that emails through Resend.
**Private** — a single seeded admin account managing projects, stack items, uploaded
images, and the contact inbox.

**Out of scope for v1:** public registration, comments, blog, i18n, dark mode, analytics
dashboards, password-reset flows. (The admin password rotates via the seed/CLI.)

---

## Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 24 LTS |
| Framework | Astro 7, `output: "server"`, `@astrojs/node` standalone |
| Language | TypeScript, `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` |
| Styling | Tailwind CSS v4 via `@tailwindcss/vite` — CSS-first, **no config file** |
| ORM | Prisma 7 (Rust-free client + `@prisma/adapter-pg`) |
| Database | PostgreSQL 17 |
| Object storage | S3-compatible — MinIO, private bucket |
| Validation | Zod |
| Passwords | `@node-rs/argon2` (argon2id) |
| Email | Resend (Mailpit in dev) |
| Images | `sharp` |
| Testing | Vitest + Playwright |
| Hosting | Railway (web + Postgres + MinIO) |

**No UI framework.** No React, Vue, or Svelte — pages are `.astro`, server-rendered.
Public pages ship under 30KB of JS, and the only two client scripts are the scroll rail
and the contact form's progressive enhancement.

Resolve every dependency with `pnpm add <pkg>@latest` at scaffold time. Never hand-write
a version number; commit the lockfile.

---

## Architecture

```
                 ┌──────────────────────────────────────────┐
   Visitor ────► │ Railway: web (Astro SSR, Node adapter)    │
                 │  ├─ /            static-ish SSR           │
                 │  ├─ /work/[slug] SSR                      │
                 │  ├─ /api/*       endpoints                │
                 │  └─ /admin/*     session-guarded          │
                 └───┬───────────────┬───────────────┬───────┘
                     │               │               │
        ┌────────────▼──┐   ┌────────▼────────┐   ┌──▼─────────────┐
        │ Railway       │   │ Railway MinIO   │   │ Resend API     │
        │ PostgreSQL 17 │   │ (S3 API, private│   │ (outbound only)│
        │ (private net) │   │  bucket)        │   │                │
        └───────────────┘   └─────────────────┘   └────────────────┘
```

One Astro app serves both frontend and backend — there is no separate API service. Data
flows one way at request time: page → Prisma → Postgres, with no client-side fetching on
public pages. Images are uploaded to MinIO and served through a signed-URL redirect
(`/api/media/[...key]`), so the bucket stays private and the storage host never reaches
the browser.

---

## Getting started

Requires Node 24, pnpm (via Corepack), and Docker.

```bash
pnpm install
cp .env.example .env      # then fill in the secrets
pnpm db:up                # Postgres, MinIO, Mailpit
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Generate the three required secrets with `openssl rand -base64 48`:
`SESSION_SECRET`, `FORM_SECRET`, `IP_HASH_SALT`.

`ADMIN_PASSWORD` must be **16+ characters**. The seed refuses to run on a blank, short, or
placeholder password (`admin`, `password`, `changeme`), and never prints the password it
sets.

With `RESEND_ENABLED=false` the mail layer writes to Mailpit ([localhost:8025](http://localhost:8025))
instead of calling Resend, so the full contact flow is testable offline and no real email
leaves the machine.

### Scripts

| Script | Does |
|---|---|
| `pnpm dev` | Astro dev server |
| `pnpm build` | `astro check && astro build` |
| `pnpm typecheck` | `astro check` |
| `pnpm lint` | `eslint . && prettier --check .` |
| `pnpm test` | Vitest (unit + integration) |
| `pnpm test:e2e` | Playwright |
| `pnpm db:up` | Start the dev containers |
| `pnpm db:migrate` | `prisma migrate dev` |
| `pnpm db:deploy` | `prisma migrate deploy` (CI/production) |
| `pnpm db:seed` | Seed admin, stack, settings |
| `pnpm db:reset` | Reset and reseed |
| `pnpm audit` | `pnpm audit --audit-level=moderate` |

---

## Roadmap

Sprints are **sequential** and follow SPEC §17's build order — ship each step working
before starting the next, rather than scaffolding every page and filling them in later.

| Milestone | Theme | Issues |
|---|---|---|
| [Sprint 1](https://github.com/kimerran/port4yow/milestone/1) | Foundation — scaffold, tooling, data layer, logging, env | 9 |
| [Sprint 2](https://github.com/kimerran/port4yow/milestone/2) | Design system & home page, security headers baseline | 7 |
| [Sprint 3](https://github.com/kimerran/port4yow/milestone/3) | Project detail, Markdown, images, media serving | 5 |
| [Sprint 4](https://github.com/kimerran/port4yow/milestone/4) | Contact form, Resend, rate limiting | 4 |
| [Sprint 5](https://github.com/kimerran/port4yow/milestone/5) | Authentication & sessions | 3 |
| [Sprint 6](https://github.com/kimerran/port4yow/milestone/6) | Admin CMS | 6 |
| [Sprint 7](https://github.com/kimerran/port4yow/milestone/7) | Security verification, SEO, ops | 4 |
| [Sprint 8](https://github.com/kimerran/port4yow/milestone/8) | Testing sweeps, perf budget, Railway launch | 5 |

Issues are also labelled by area (`area/infra`, `area/data`, `area/design-system`,
`area/public-site`, `area/admin`, `area/auth`, `area/media`, `area/email`, `area/testing`)
and flagged `security` or `accessibility` where they carry a merge-blocking requirement.

The critical path is only nine issues deep — everything else hangs off it:

```
#1 scaffold → #5 prisma → #23 auth lib → #24 middleware → #25 login
   → #26 admin shell → #27 project CRUD → #39 E2E → #41 deploy
```

---

## Working on this

Tests ship **with** each slice, not at the end. Sprint 8's test issues are the
consolidated sweep that catches what got skipped — not the first time anyone runs Vitest.

Before every commit:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

- **Conventional commits**: `feat:` `fix:` `chore:` `docs:` `refactor:` `test:` `sec:`.
  One logical change per commit; a schema change and its migration ship together.
- **Never commit**: `.env`, `dist/`, `src/generated/`, uploaded media, real data dumps.
- CI runs typecheck, lint, unit + integration tests, `pnpm audit`, gitleaks, and a
  production build. Red CI does not merge.
- A slice is done per **AGENT §7** — which includes exercising the feature manually,
  keyboard navigation with visible focus, `prefers-reduced-motion` honoured, zero critical
  axe violations, and no horizontal scroll at 375 / 768 / 1440px.

An autonomous agent can pick up the next issue by following [auto-dev.md](auto-dev.md),
which selects the lowest-numbered open issue in the earliest incomplete milestone.

---

## Security

Every item in SPEC §14 is a merge blocker, not a later pass. In brief:

- Argon2id password hashing; sessions store `sha256(token)`, never the token; `__Host-`
  prefixed cookies, `HttpOnly; Secure; SameSite=Lax`; session id rotates on login.
- CSP with no `unsafe-inline`, HSTS, `frame-ancestors 'none'`, and the full header set.
- Every external input parsed through Zod at the boundary. Origin verified on every
  state-changing route. Rate limits on contact, login, and upload.
- Uploads are content-sniffed against a MIME allowlist, size-capped, EXIF-stripped, and
  re-encoded. SVG is rejected outright.
- Only hashed IPs are stored, with a salt. Contact messages are pruned after 24 months.
- Secrets never live in the repo, in a `PUBLIC_*` variable, or in a log line. gitleaks
  runs in CI.

Found a security issue? Email the address on [mh.neri.ph](https://mh.neri.ph) rather than
opening a public issue.

---

## Deployment

Railway, three services in one project: `web` (this repo), `postgres` (PostgreSQL 17), and
`minio`, with the database and bucket reachable only over the private network.

Migrations run on deploy via `prisma migrate deploy` — never `migrate dev` or `db push`
against production. The seed runs once, manually, via `railway run pnpm db:seed`; it is not
part of the start command. Health checks hit `/healthz`.
