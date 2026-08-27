# #41 — Railway deployment

SPEC §13, §17.10 · AGENT §2, §5

## Done — and what could not be

**None of #41's five acceptance criteria can be met from this repository.** Every
one of them requires a Railway account, DNS control of `neri.ph`, or a Resend
account:

- [ ] `https://mh.neri.ph` over TLS with HSTS
- [ ] `/healthz` passing Railway's check, with a deploy rolling back on failure
- [ ] a real contact submission arriving via Resend
- [ ] a backup **restore** performed and verified
- [ ] `ADMIN_PASSWORD` rotated after first login

So this PR delivers the part that is in the repository's power — the `Dockerfile`
#41 asks for, verified by building and running it — and `docs/ops-deploy.md`, a
runbook for the rest. The issue should stay open until a human with the accounts
works through that checklist.

Building the image was not a formality: **it found two defects that would each
have broken the first deploy.**

## Two defects the image build found

### 1. The server bound to `localhost`, so nothing outside the container could reach it

The image built, migrated a fresh database, and logged

```
[@astrojs/node] Server listening on http://localhost:4321
```

while every request from the host got nothing. `@astrojs/node`'s standalone
entry reads `process.env.HOST` and otherwise binds `127.0.0.1`.

On Railway that is a health check that never passes — and with
`restartPolicyType: ON_FAILURE` and `restartPolicyMaxRetries: 3`, a **crash
loop** rather than a legible error. `ENV HOST=0.0.0.0` fixes it, and the reason
is in the Dockerfile next to the line.

### 2. `prisma migrate deploy` could not run in a production image

`prisma` was a devDependency, so the pruned tree had no CLI and the container
exited 127 with `sh: 1: ./node_modules/.bin/prisma: not found`.

SPEC §13 runs `prisma migrate deploy` **on every deploy**, which makes the CLI a
production dependency by any honest reading — a tool you run in production is
not a development tool. Moved to `dependencies`. Nixpacks installs devDeps too,
so this changes nothing about the current deploy path; it makes the container
path work at all.

(A first attempt used `pnpm prune --prod`, which fails differently and
instructively: prune re-runs `postinstall`, which is `prisma generate`, using the
CLI it is halfway through removing. A separate `--prod --ignore-scripts` install
stage sidesteps it, and the generated client is copied from the build stage where
it was made properly.)

## The Dockerfile

Multi-stage: build with devDependencies, then copy `dist/`, the production
`node_modules` and the generated Prisma client into a clean `node:24-bookworm-slim`.

- **Node 24** named explicitly, matching `.nvmrc` and `engines`; `corepack enable`
  pins pnpm to `packageManager`, so the image cannot resolve differently than CI.
- **Bookworm slim, not Alpine** — `@node-rs/argon2` ships prebuilt glibc binaries,
  and musl would mean a slower fallback or a compiler in the image.
- **Non-root** (`USER node`).
- **tini** as PID 1, so SIGTERM reaches Node.
- `.dockerignore` keeps `.env`, `dist/`, `src/generated/` and the test artefacts
  out of the build context. `.env` is the one that matters: a secret baked into a
  layer survives every later `rm`.

## Verified against the running image

| Check                                           | Result                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| build                                           | succeeds; `astro check` runs inside it, so a type error fails the image |
| migrations on an empty database                 | `20260827062653_init` applied                                           |
| `/healthz`                                      | `{"status":"ok","uptime":0,"db":"ok"}` **200**                          |
| `/`                                             | **200**                                                                 |
| user                                            | `uid=1000(node)` — not root                                             |
| `.env` in the image                             | **absent**                                                              |
| `vitest` / `playwright` / `eslint` / `prettier` | **absent**                                                              |
| security headers from the container             | **7 of 7**                                                              |
| `SIGTERM`                                       | stops in **0s**                                                         |
| image size                                      | 966 MB                                                                  |

966 MB is large. It is dominated by `sharp`'s platform binaries, the Prisma
client and `@aws-sdk/client-s3`, all of which are genuinely used at runtime.
Worth revisiting if pull time becomes a problem; not worth trading correctness
for now, and not something to shave blind.

## A conflict to resolve before the first deploy

`railway.json` says `"builder": "NIXPACKS"`, exactly as SPEC §13 prints it. This
repository now also has a `Dockerfile`, because #41's scope asks for one.

**Railway honours the explicit builder, so as committed the Dockerfile will not
be used.** Both halves are written down in a contract document, so I have not
picked one:

- keep Nixpacks and treat the Dockerfile as a local-container path (Node is still
  pinned, by `.nvmrc`); or
- set `"builder": "DOCKERFILE"` and accept that `railway.json` no longer matches
  SPEC §13 verbatim, which wants a SPEC edit rather than a silent divergence.

`docs/ops-deploy.md` states both. It needs a decision, not a guess.

## Blocked

**The five acceptance criteria**, on Railway, DNS and Resend access. The runbook
is written so that work is mechanical rather than exploratory, including the
restore procedure — #41 asks for a restore _performed_, not for the backup
toggle to be on, and the difference is the whole point of the requirement.

## Next

- Decide the builder question above.
- After the first deploy: rotate `ADMIN_PASSWORD`, then record the date of the
  verified restore somewhere durable.
- HSTS preload submission is deliberately _not_ in the runbook as a step to take
  immediately — it is hard to undo, and the domain should serve HTTPS correctly
  for a while first.

## Content TODOs

None.
