# syntax=docker/dockerfile:1

# Production image for the `web` service (#41, SPEC §13).
#
# ## Why a multi-stage build
#
# The build needs devDependencies — astro, vite, the Tailwind compiler, and
# `astro check` — none of which the running server has any use for. Building in
# one stage and copying only `dist/`, the production `node_modules` and the
# generated Prisma client into another keeps that toolchain out of the image
# that faces the internet, which is a smaller attack surface as well as a
# smaller pull.
#
# ## Node 24, pinned by digest-free tag
#
# `.nvmrc` says 24 and `package.json` says `>=24 <25`; this is the third place
# that has to agree, so it names the same major rather than `latest`. Bookworm
# slim rather than Alpine: `@node-rs/argon2` ships prebuilt glibc binaries, and
# musl would either fall back to a slower build or need a compiler in the image.

# ---------------------------------------------------------------- build stage
FROM node:24-bookworm-slim AS build

# Corepack pins pnpm to the exact version in package.json's `packageManager`,
# so the image cannot silently build with a different resolver than CI did.
RUN corepack enable

WORKDIR /app

# Copy the manifests first: this layer only changes when dependencies do, so
# the install is cached across ordinary source edits.
COPY package.json pnpm-lock.yaml .npmrc* ./
COPY prisma ./prisma
COPY prisma.config.ts ./

# `postinstall` runs `prisma generate`, which needs the schema (copied above)
# but no database — `prisma.config.ts` omits the datasource when DATABASE_URL is
# absent precisely so this works.
RUN pnpm install --frozen-lockfile

COPY . .

# `astro check` runs here as part of `pnpm build`, so a type error fails the
# image rather than the deploy.
RUN pnpm build

# ------------------------------------------------------ production deps stage
#
# A separate install rather than `pnpm prune --prod` on the build tree: prune
# re-runs `postinstall`, which is `prisma generate`, and the `prisma` CLI is a
# devDependency it is in the middle of removing — so it fails with
# `sh: 1: prisma: not found`. `--ignore-scripts` sidesteps that, and the
# generated client is copied from the build stage where it was made properly.
FROM node:24-bookworm-slim AS deps

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml .npmrc* ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# ----------------------------------------------------------------- run stage
FROM node:24-bookworm-slim AS runtime

# `tini` reaps zombies and forwards signals, so Railway's SIGTERM reaches Node
# and the server shuts down rather than being killed after a grace period.
RUN apt-get update \
  && apt-get install --no-install-recommends -y tini \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
# The adapter reads PORT at runtime; Railway overrides it.
ENV PORT=4321
# Without this the standalone adapter binds 127.0.0.1 — reachable only from
# inside the container. Measured: the image built, migrated, and logged
# "Server listening on http://localhost:4321" while every request from the host
# got nothing. On Railway that is a health check that never passes, and with
# `restartPolicyType: ON_FAILURE` and 3 retries it is a crash loop rather than a
# visible error.
ENV HOST=0.0.0.0

WORKDIR /app

# `node` is a non-root user the base image already provides. Running as root
# would let a code-execution bug write anywhere in the container.
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/src/generated ./src/generated
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=node:node /app/package.json ./package.json

USER node

EXPOSE 4321

# Railway health-checks `/healthz` itself (railway.json), but this makes the
# image self-describing for anything that runs it outside Railway.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4321)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]

# Migrations then serve, matching railway.json's start command. `migrate deploy`
# only ever applies committed migrations — never `migrate dev` or `db push`
# (SPEC §13, AGENT §2).
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node ./dist/server/entry.mjs"]
