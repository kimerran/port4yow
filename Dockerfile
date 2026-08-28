# syntax=docker/dockerfile:1

# Production image for the `web` service (#41, SPEC §13).
#
# ## Why a multi-stage build
#
# The build needs devDependencies — astro, vite, the Tailwind compiler, and
# `astro check` — none of which the running server has any use for. Building in
# one stage and copying only `dist/` and the production `node_modules` into
# another keeps that toolchain out of the image that faces the internet, which
# is a smaller attack surface as well as a smaller pull.
#
# The image now serves prerendered HTML plus one dynamic route. There is no
# Prisma client to generate, no migration to run at boot, and no schema to copy
# in — all of which this file used to carry.
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

RUN pnpm install --frozen-lockfile

COPY . .

# `site` is baked into the sitemap, canonicals and OG tags at BUILD time, so the
# origin has to be known here rather than at boot. astro.config.mjs throws on a
# production build without it, which is deliberate: the alternative is an image
# that builds clean and serves localhost URLs to crawlers.
ARG PUBLIC_SITE_URL
ENV PUBLIC_SITE_URL=${PUBLIC_SITE_URL}

# `astro check` runs here as part of `pnpm build`, so a type error fails the
# image rather than the deploy.
RUN pnpm build

# ------------------------------------------------------ production deps stage
#
# A separate install rather than `pnpm prune --prod` on the build tree. The
# original reason was that prune re-ran `postinstall` (`prisma generate`) using
# the CLI it was removing; there is no postinstall now, but a clean production
# install is still the clearer way to get a `node_modules` with no build
# toolchain in it. `--ignore-scripts` stays as a belt-and-braces.
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
COPY --from=build --chown=node:node /app/server.mjs ./server.mjs
COPY --from=build --chown=node:node /app/package.json ./package.json

USER node

EXPOSE 4321

# Railway health-checks `/healthz` itself (railway.json), but this makes the
# image self-describing for anything that runs it outside Railway.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4321)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]

# Just serve. This used to be `prisma migrate deploy && node …`; with no
# database there is nothing to migrate, which also removes the failure mode
# where a bad migration took the container down on boot.
CMD ["node", "./server.mjs"]
