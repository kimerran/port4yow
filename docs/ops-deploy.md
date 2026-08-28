# Deploying to Railway

> **Partly superseded.** The service topology changed: there is no Postgres, no
> MinIO and no migration step. Provision **one web service**, set the variables in
> `.env.example` (there are seven, not twenty), and skip every section below that
> attaches a database or a bucket. `PUBLIC_SITE_URL` must be present at BUILD
> time, not just at runtime — absolute URLs are baked into the sitemap,
> canonicals and OG tags. The domain, TLS and Resend sections still apply.

SPEC §13 · #41

Everything here that can be verified from this repository has been. Everything
that needs a Railway account, DNS for `neri.ph`, or a Resend account is written
as a procedure and is **not done** — see the checklist at the end.

## Services (one Railway project)

| Service    | What                            | Notes                                             |
| ---------- | ------------------------------- | ------------------------------------------------- |
| `web`      | this repo                       | health check `/healthz`                           |
| `postgres` | Railway PostgreSQL 17           | reference `${{Postgres.DATABASE_URL}}` from `web` |
| `minio`    | Railway MinIO template + volume | referenced privately by `web`                     |

**Private network only.** Reference the database as
`${{Postgres.DATABASE_URL}}`, which resolves to the internal
`postgres.railway.internal` host. The public proxy URL works and is the wrong
answer: it leaves the private network, adds latency, and exposes the database to
the internet. The same applies to MinIO — `web` talks to it over the internal
hostname, and only `/api/media/[...key]` is reachable publicly (#42).

## The builder: a conflict to resolve before the first deploy

`railway.json` says `"builder": "NIXPACKS"`, exactly as SPEC §13 prints it. This
repository now also has a `Dockerfile`, which #41 asks for.

**Railway honours the explicit `builder`, so as committed the Dockerfile will not
be used.** That is not a state to leave ambiguous, and it is not mine to decide,
because SPEC §13 is the contract:

- **Keep Nixpacks** — then the Dockerfile is documentation and a way to run the
  app in a container locally. Node is pinned by `.nvmrc` (`24`) and pnpm by
  `packageManager`, so the version pinning #41 asks for still holds.
- **Switch to the Dockerfile** — change `"builder"` to `"DOCKERFILE"`. The build
  becomes reproducible and identical to what was tested here, at the cost of
  `railway.json` no longer matching SPEC §13 verbatim, which wants a SPEC edit
  rather than a silent divergence.

## Variables

Set as Railway variables on the `web` service. **Names only — no value belongs in
this repository** (SPEC §14.8).

Required: `DATABASE_URL` (as a reference), `PUBLIC_SITE_URL`, `SESSION_SECRET`,
`FORM_SECRET`, `IP_HASH_SALT`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `CONTACT_TO_EMAIL`.

Set for production: `NODE_ENV=production`, `RESEND_ENABLED=true`,
`RESEND_API_KEY`, `CONTACT_FROM_EMAIL=hello@mh.neri.ph`.

Generate each secret with `openssl rand -base64 48`. `env.ts` refuses anything
under 32 characters and the process dies at boot rather than serving traffic
without one.

`HOST=0.0.0.0` is set in the Dockerfile and is **not optional in a container** —
see the note in that file. Nixpacks sets it for you.

## Domain and TLS

1. Add `mh.neri.ph` as a custom domain on the `web` service.
2. Point the CNAME Railway gives you at it, from the `neri.ph` DNS zone.
3. Railway issues and renews the certificate; leave "force HTTPS" on.
4. HSTS is already sent by `src/middleware.ts` on every response —
   `max-age=63072000; includeSubDomains; preload`, unconditionally, because a
   browser ignores it over plain HTTP and forgetting it behind a TLS-terminating
   proxy is the more common mistake.

Do not submit to the HSTS preload list until the domain has served HTTPS
correctly for a while: preloading is difficult to undo.

## Resend

1. Add `mh.neri.ph` in Resend and publish the DKIM, SPF and DMARC records it
   gives you in the `neri.ph` zone.
2. Wait for verification.
3. Set `RESEND_API_KEY` and `RESEND_ENABLED=true` on `web`.

Until `RESEND_ENABLED` is true, `mail.ts` sends through `SMTP_URL` instead — in
production that means mail goes nowhere, so this flip is what makes the contact
form real. `env.ts` refuses `RESEND_ENABLED=true` with no key (a `.refine`), so
the half-configured state cannot boot.

## Migrations and the seed

Migrations run on every deploy through the start command
(`pnpm db:deploy` → `prisma migrate deploy`), which only ever applies committed
migrations. **Never `migrate dev` or `db push` against production** (SPEC §13,
AGENT §2): both can drop data to reconcile a drifted schema.

The seed runs **once, by hand**, and is deliberately not part of the start
command:

```
railway run pnpm db:seed
```

Then sign in and **rotate `ADMIN_PASSWORD`**. The seeded value is known to
whoever set it and to the deploy logs' environment; it is a bootstrap
credential, not a password.

## Backups, and the restore that proves them

Enable daily backups on the Postgres service. **Enabling a backup is not the
same as having one**, and #41 asks for a restore to be verified before launch,
not for the toggle to be on. The procedure:

1. Take a backup, or wait for the daily one.
2. Restore it into a **new, empty** database — never over the live one.
3. Point a throwaway `web` deploy at the restored database, or run
   `psql` against it, and check: the `User` row exists, `Project` rows and their
   `MediaAsset` relations survived, and `_prisma_migrations` lists
   `20260827062653_init` as applied.
4. `prisma migrate deploy` against the restored database must report
   "No pending migrations", which is what tells you the restore is at the schema
   version the code expects.
5. Drop the throwaway database.

Record the date of the verified restore. An unverified backup is a plan, not a
recovery.

## What was verified here, and what was not

Verified locally, against the built image:

- The image builds, applies `20260827062653_init` to an empty database, and
  serves `/healthz` `{"status":"ok","uptime":0,"db":"ok"}` and `/` 200.
- It runs as **non-root** (`uid=1000(node)`), contains **no `.env`**, and no
  `vitest`, `playwright`, `eslint` or `prettier`.
- All **7** security headers are present on a response from the container.
- `SIGTERM` stops it in **0s**, so Railway's shutdown is graceful rather than a
  kill after the grace period.

Not done, because each needs an account or DNS this repository does not have:

- [ ] `https://mh.neri.ph` serving over TLS with HSTS
- [ ] `/healthz` passing Railway's own check, and a failed deploy rolling back
- [ ] a real contact submission arriving via Resend
- [ ] a backup **restore** performed and verified
- [ ] `ADMIN_PASSWORD` rotated after first login
