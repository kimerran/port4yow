# AGENT.md — Working agreement for mh.neri.ph

Instructions for the coding agent building and maintaining this repository.
Read `SPEC.md` (what to build) and `BRAND.md` (how it looks) before writing code. This file governs
how you work.

---

## 1. Prime directives

1. **Verify versions; never recall them.** Your training data is stale. Before adding any dependency,
   run `pnpm view <pkg> version` and install with `@latest`. Never hand-write a version number into
   `package.json`.
2. **Security is not a later pass.** Every route that accepts input gets validation, authorization,
   and rate limiting in the same commit that creates it. A route without them is unfinished.
3. **Ship vertical slices.** One feature working end to end beats ten scaffolded stubs. Follow the
   build order in SPEC §17.
4. **Verify your own work.** After each slice: typecheck, lint, run tests, exercise the feature.
   Never report success on unrun code.
5. **Fail closed.** When auth, validation, or an env check errors, deny the request. Never default
   to allowing.
6. **The spec is the contract.** If something in SPEC.md or BRAND.md is wrong or impossible, stop and
   say so with a proposed alternative. Do not silently improvise a different design.

---

## 2. Stack conventions

### Astro 7

- `output: "server"` with `@astrojs/node` in `standalone` mode. Node 22+ required; target Node 24 LTS.
- Pages are `.astro` and server-rendered. **No UI framework** — no React, Vue, or Svelte. If you
  think you need one, you have overcomplicated a portfolio.
- Client JS only via `<script>` in the two places SPEC allows (scroll rail, contact enhancement).
  Public pages ship under 30KB of JS.
- Mutations go through **Astro Actions** with Zod input schemas. Public form posts use API routes so
  they work without JavaScript.
- `src/middleware.ts` owns session hydration and security headers. Keep it thin and total — it runs
  on every request.
- Use `Astro.locals` for the resolved user. Type it in `src/env.d.ts`.
- Enable the built-in CSP API rather than hand-rolling header strings.

### TypeScript

- `strict: true`, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- **`any` is banned.** Use `unknown` at boundaries and narrow with Zod. No `@ts-ignore`; if you must,
  `@ts-expect-error` with a comment explaining why.
- Types are inferred from Zod schemas (`z.infer`) — do not maintain a parallel interface.
- No non-null assertions (`!`) on anything derived from external input.

### Prisma 7

- Prisma 7's client is Rust-free and requires a driver adapter: use `@prisma/adapter-pg`.
- Config lives in `prisma.config.ts`. The generated client goes to `src/generated/prisma` and is
  gitignored; generation runs in `postinstall`.
- **One PrismaClient instance**, exported from `src/lib/db.ts`, cached on `globalThis` in dev to
  survive HMR.
- Migrations: `prisma migrate dev` locally, `prisma migrate deploy` in CI/production. **Never**
  `db push` against a database that holds real data. Every migration is committed and reviewed.
- `select` or narrow `include` on every query — never fetch the whole row by habit, and never return
  `passwordHash` from a function that feeds a template.
- Wrap multi-write operations in `$transaction`. Reordering projects updates every affected
  `sequence` in one transaction.
- Index anything you filter or sort on. Watch for N+1 when rendering tiles with stack chips.

### Tailwind v4

- CSS-first configuration: tokens in `@theme` inside `src/styles/global.css`. **There is no
  `tailwind.config.js`** — if you create one, you are working from outdated knowledge.
- Install `@tailwindcss/vite` and register it in `astro.config.mjs`. Never the CDN script.
- Only the tokens in BRAND.md §2–4 exist. No arbitrary values (`text-[#123456]`, `p-[13px]`) except
  for the facet-lattice SVG. If you need a value that isn't a token, that is a design decision — ask.
- `@apply` is limited to `.card-shadow`, `.card-hover`, `.animate-deal`. Everything else is utilities
  in markup.

### pnpm

- `pnpm` only. Never `npm install` or `yarn` — a second lockfile is a bug.
- Pin the version in `packageManager`; enable Corepack in CI and the Dockerfile.
- `pnpm install --frozen-lockfile` everywhere except deliberate upgrades.
- Commit `pnpm-lock.yaml` on every dependency change.

---

## 3. Security checklist (per route)

Before marking any endpoint done, confirm every line:

- [ ] Input parsed through a Zod schema at the top of the handler; no unparsed field used downstream.
- [ ] Authorization checked server-side, in the handler — not only in middleware, not in the UI.
- [ ] Origin verified on state-changing methods.
- [ ] Rate limited, with the limit chosen for this route's cost.
- [ ] Errors return generic brand-voiced copy; details go to structured logs with a correlation id.
- [ ] No secret, token, hash, raw IP, or full email address in any log line.
- [ ] Response headers correct (`no-store` for authed pages, cache headers for public ones).
- [ ] Nothing user-controlled reaches raw HTML, SQL, a shell, a filesystem path, or an outbound URL
      without validation.
- [ ] Redirect targets validated as same-origin relative paths.
- [ ] Timing-safe comparisons for anything secret-adjacent.

### Things that must never appear in this codebase

`eval` · `new Function` · `child_process` with interpolated input · string-concatenated SQL ·
`set:html` on unsanitized input · `dangerouslySetInnerHTML` · secrets in `PUBLIC_*` variables ·
a hardcoded credential, even in a test · `process.env.X` read without passing through `env.ts` ·
`outline: none` without a replacement focus style · `console.log` of a request body · disabled
TLS verification · `Access-Control-Allow-Origin: *` on anything authenticated.

### Password and session rules

Argon2id with the OWASP parameters in SPEC §8 — not bcrypt, not SHA-anything, not a homemade salt
scheme. Sessions store `sha256(token)`, never the token. Rotate the session id on login. Cookies are
`__Host-`prefixed, `HttpOnly`, `Secure`, `SameSite=Lax`. Login responses take the same time whether
or not the username exists.

---

## 4. Code style

- Small, single-purpose modules. If a file passes ~300 lines, split it.
- Named exports; default exports only where Astro requires them.
- `async/await` throughout. Every `await` that can fail is inside a `try` that does something
  meaningful — never an empty catch, never a swallowed error.
- Comments explain **why**, not what. Delete commented-out code rather than committing it.
- No dead code, no unused exports, no `TODO` without an issue reference.
- Server-only modules (`src/lib/*` touching secrets) must never be imported from a client script.
  Verify by checking the built client bundle, not by intention.
- Structured logging via `src/lib/logger.ts` (JSON in production): level, message, correlation id,
  and safe context. Never a raw object that might carry PII.

---

## 5. Git and change discipline

- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `sec:`.
- One logical change per commit. Schema change and its migration ship together.
- Never commit: `.env`, `pnpm-debug.log`, `dist/`, `src/generated/`, uploaded media, real data dumps.
- Before every commit: `pnpm typecheck && pnpm lint && pnpm test`.
- CI runs typecheck, lint, unit + integration tests, `pnpm audit --audit-level=moderate`, gitleaks,
  and a production build. Red CI does not merge.

---

## 6. When you are stuck

- **Two failed attempts at the same fix ⇒ stop.** Re-read the error, form a different hypothesis,
  and add a log or a failing test that isolates it. Do not try a third variation of the same idea.
- **Missing information ⇒ ask.** Never invent a credential, an API contract, a business rule, or a
  piece of Mark's biography. Placeholder copy is marked `TODO(content)` and listed in the handoff.
- **Astro/Prisma/Tailwind API uncertainty ⇒ read the current docs.** These three have all had major
  versions since your training data; assume your memory of their APIs is wrong until confirmed.
- **A requirement that conflicts with security ⇒ refuse and explain.** Do not quietly weaken a
  control to make a feature easier.

---

## 7. Definition of done

A slice is done when all of the following hold:

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` all pass.
- [ ] The feature was exercised manually — describe what you clicked and what happened.
- [ ] Every checkbox in §3 is satisfied for any route touched.
- [ ] The UI matches BRAND.md: tokens only, correct type roles, 5:7 cards, 8px radius, no rejected
      patterns.
- [ ] Keyboard-navigable with visible focus; axe reports zero critical violations.
- [ ] `prefers-reduced-motion` honored.
- [ ] Responsive at 375px, 768px, and 1440px with no horizontal scroll.
- [ ] No new `PUBLIC_*` variable holds anything sensitive.
- [ ] `.env.example` and the relevant docs updated if configuration changed.
- [ ] Migration committed if the schema changed, and it runs cleanly on an empty database.

---

## 8. Handoff format

At the end of each work session, report exactly this:

1. **Done** — what now works, and how you verified it.
2. **Changed** — files added or modified, one line each.
3. **Decisions** — anything you chose that the spec left open, and why.
4. **Blocked** — what you could not do and what you need to proceed.
5. **Next** — the next slice per SPEC §17.
6. **Content TODOs** — every placeholder string awaiting Mark's real copy.

Be accurate about what is untested or partial. An honest "auth works, upload is unverified" is worth
more than a confident summary that turns out to be wrong.
