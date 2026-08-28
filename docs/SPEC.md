# SPEC.md — mh.neri.ph

Full-stack specification for the personal portfolio of **Mark Hugh Neri**, full-stack developer /
software engineer. Written to be executed by a coding agent.

- **Production domain:** `mh.neri.ph`
- **Design authority:** `BRAND.md` (do not make visual decisions outside it)
- **Engineering authority:** `AGENT.md` (conventions, security, workflow)

> ## Amendment — the site is static; the database and the admin are removed
>
> This document specifies a server-rendered app with a Postgres data model, an
> authenticated admin CMS, an S3 media pipeline and a stored contact inbox. All of that was
> built, shipped, and then removed. **Where this document and the code disagree on the
> items below, the code is correct and this amendment is the specification.**
>
> **What changed**
>
> - **Projects are content files.** `src/content/projects/*.md`, validated by a Zod schema in
>   `src/content.config.ts`, with covers as `astro:assets` imports. §3's `Project`,
>   `ProjectStack`, `ProjectImage`, `MediaAsset`, `StackItem`, `SiteSetting`, `User`,
>   `Session` and `ContactMessage` models are gone, and with them Prisma, the adapter and
>   `DATABASE_URL`.
> - **`output: "static"`.** Every page is prerendered. `POST /api/contact` and `/healthz`
>   are the only routes that run per request, and the Node adapter stays for them.
> - **No admin, no auth.** §6's admin routes, §8's session model and the login rate limit no
>   longer exist. §14.4's origin check still guards the contact POST.
> - **No object storage.** §9's upload pipeline, derivative generation and signed-URL media
>   route are replaced by build-time `astro:assets`. The S3 variables are gone from §10.
> - **The contact form stores nothing.** §7's pipeline runs origin → rate limit → validate →
>   honeypot/timing → **send**, with the persist step removed. §7's indistinguishable-200 for
>   spam still holds. **The cost is real and is not hidden: if Resend fails, the message is
>   lost**, and there is no spam audit trail for tuning thresholds.
> - **The rate limiter is in-process.** §7.2's limits and the 50/hour global brake are
>   enforced, but counters reset on deploy and do not span instances. §11's Postgres backing
>   and the Redis upgrade path no longer apply.
> - **`/healthz` is a liveness check only.** §5's `SELECT 1` had no database to probe. It
>   deliberately does not probe Resend — a third-party blip must not restart a container that
>   is serving the whole site correctly.
> - **§14.10's retention job is gone** along with the stored messages it pruned. `/privacy`
>   was rewritten to say what is actually true rather than to describe the old architecture.
>
> **What is unchanged:** §14's security headers and CSP, §15's SEO and the 30KB JS ceiling,
> §5's public routes and their shapes, and every requirement in `BRAND.md`.
>
> ### Later amendment — the viewing gate
>
> Two more dynamic routes exist: `POST /api/access` and `POST /api/resume`. A visitor gives
> an email before the portfolio is readable, and downloading the resume is reported. Both
> email the owner; as with contact, **the email is the record** and a provider failure loses
> it.
>
> **The gate is a courtesy, not an access control.** It is a client-side overlay over
> prerendered HTML: view-source, curl, reader mode and JavaScript-off all bypass it. Nothing
> behind it may be anything that must not be public. Making it real would mean
> server-rendering every page behind a session — the architecture this site was moved off.
>
> Two consequences accepted on the owner's instruction:
>
> - **SEO.** An interstitial is a documented mobile-ranking penalty, and no crawler gets
>   past it. The §15 work still applies to what a crawler does index.
> - **A welcome email goes to the visitor**, with the resume attached and a Calendly link.
>   Worth naming as an exposure: anyone can type a third party's address into the gate and
>   cause mail to be sent to it from this domain. The bounds are the 20/hr/IP limit and a
>   fixed payload with no attacker-controlled text. The fix, if it ever matters, is a
>   confirmed opt-in rather than a send on first submission.
> - **Cloudflare Turnstile** guards the contact form when configured, and is the ONLY
>   third-party origin the browser talks to — allowed in the CSP by name, not by widening
>   it. A *missing* token is not a rejection: a no-JS visitor cannot produce one and §7
>   requires that path to work, so a bot that omits the field is still only caught by the
>   honeypot.
> - **Security headers are set by `server.mjs`, not middleware.** The adapter serves
>   prerendered HTML from its own file handler, which never calls middleware — so the whole
>   public site shipped with none. The adapter runs in `middleware` mode and `server.mjs`
>   wraps it; `e2e/headers.spec.ts` asserts against the served response, because a unit test
>   of the middleware passed throughout.
> - **Personal data returns.** Email, optional name, and an allowlisted set of browser facts
>   (page, referrer, user-agent, language, time zone, screen and viewport) plus a truncated
>   salted IP hash. `/privacy` enumerates exactly this set; the list there and `VisitorSchema`
>   in `src/lib/visitor.ts` must not drift.

---

## 1. Scope

A public marketing site with a private admin CMS behind it.

**Public:** home page, project detail pages, contact form that emails through Resend.
**Private:** single seeded admin account that manages projects, stack items, uploaded images, and
reads contact messages.

**Explicitly out of scope for v1:** public user registration, comments, blog, i18n, dark mode,
analytics dashboards, password reset flows (the admin password is rotated via the seed/CLI).

---

## 2. Tech stack

| Layer | Choice | Version target (Aug 2026) |
|---|---|---|
| Runtime | Node.js | 24 LTS (Astro 7 requires ≥22; pin exactly in `.nvmrc` and Dockerfile) |
| Framework | Astro, `output: "server"` | ^7.2 |
| Adapter | `@astrojs/node` (standalone) | latest for Astro 7 |
| Package manager | pnpm | ^10.30 (`packageManager` field + `corepack enable`) |
| Language | TypeScript, `strict: true` | ^5.9 |
| Styling | Tailwind CSS v4 via `@tailwindcss/vite` | ^4.3 |
| ORM | Prisma (Rust-free client + `@prisma/adapter-pg`) | ^7.7 |
| Database | PostgreSQL on Railway | 17 |
| Object storage | S3-compatible (MinIO service on Railway; MinIO in dev) | latest stable |
| S3 client | `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` | ^3 latest |
| Validation | Zod | ^4.4 |
| Password hashing | `@node-rs/argon2` (argon2id) | latest |
| Transactional email | Resend Node SDK | latest |
| Image processing | `sharp` | latest |
| Rate limiting | Postgres-backed counter (Redis optional, see §11) | — |
| Testing | Vitest + Playwright | latest |
| Lint/format | ESLint 9 flat config + Prettier + `eslint-plugin-astro` | latest |
| Hosting | Railway (web + Postgres + MinIO) | — |

Resolve every version with `pnpm add <pkg>@latest` at scaffold time. Do not copy version numbers
from memory. Commit the lockfile.

---

## 3. Architecture

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

- Single Astro app serves both frontend and backend. No separate API service.
- Data flows one way at request time: page → Prisma → Postgres. No client-side data fetching on
  public pages; the home page and detail pages ship zero JS beyond the scroll rail and the contact
  form's progressive enhancement.
- Images are uploaded to MinIO by the admin and served through a signed-URL redirect endpoint
  (`/api/media/[key]`), so the bucket stays private and the storage host is never exposed.

### Directory layout

```
.
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── prisma.config.ts
├── src/
│   ├── components/          # Card.astro, ProjectTile.astro, SuitGlyph.astro, ContactForm.astro …
│   ├── layouts/             # BaseLayout.astro, AdminLayout.astro
│   ├── pages/
│   │   ├── index.astro
│   │   ├── work/[slug].astro
│   │   ├── admin/…
│   │   ├── api/…
│   │   ├── 404.astro
│   │   ├── robots.txt.ts
│   │   └── sitemap.xml.ts
│   ├── lib/
│   │   ├── db.ts            # Prisma singleton
│   │   ├── auth.ts          # hashing, session create/validate/invalidate
│   │   ├── storage.ts       # S3 client, upload, presign
│   │   ├── mail.ts          # Resend wrapper
│   │   ├── ratelimit.ts
│   │   ├── schemas.ts       # all Zod schemas
│   │   └── logger.ts
│   ├── middleware.ts        # session hydration, admin guard, security headers
│   ├── actions/index.ts     # Astro Actions for admin mutations
│   └── styles/global.css    # Tailwind v4 @theme tokens (from BRAND.md)
├── public/
├── docker-compose.yml       # dev only
├── Dockerfile
├── railway.json
├── .env.example
└── docs/{SPEC.md,BRAND.md,AGENT.md}
```

---

## 4. Data model (Prisma)

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client"          // Prisma 7 TS client
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String    @id @default(cuid())
  username     String    @unique
  passwordHash String
  displayName  String
  role         Role      @default(ADMIN)
  lastLoginAt  DateTime?
  failedLogins Int       @default(0)
  lockedUntil  DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  sessions     Session[]
}

enum Role { ADMIN }

model Session {
  id        String   @id                 // SHA-256 of the token; the token itself is never stored
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt DateTime
  ipHash    String?                       // salted hash, for anomaly review only
  userAgent String?
  createdAt DateTime @default(now())

  @@index([userId])
  @@index([expiresAt])
}

model Project {
  id            String         @id @default(cuid())
  slug          String         @unique          // lowercase kebab, immutable once published
  sequence      Int            @unique          // drives the 01/02/03 index and "next card" order
  title         String
  suit          Suit
  status        ProjectStatus  @default(DRAFT)
  summary       String         @db.VarChar(180) // one-line outcome on the tile
  role          String                          // "Lead engineer"
  timeline      String                          // "Mar 2025 – Jan 2026"
  problem       String         @db.Text         // 2–3 sentences
  body          String         @db.Text         // Markdown, rendered server-side and sanitized
  outcome       String         @db.Text
  liveUrl       String?
  repoUrl       String?
  coverImageId  String?        @unique
  coverImage    MediaAsset?    @relation("Cover", fields: [coverImageId], references: [id])
  stack         ProjectStack[]
  images        ProjectImage[]
  publishedAt   DateTime?
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt

  @@index([status, sequence])
}

enum Suit { DIAMONDS SPADES HEARTS CLUBS }
enum ProjectStatus { DRAFT PUBLISHED ARCHIVED }

model StackItem {
  id        String         @id @default(cuid())
  name      String         @unique     // "PostgreSQL"
  suit      Suit                       // category, per BRAND.md §6
  sortOrder Int            @default(0)
  featured  Boolean        @default(false)
  projects  ProjectStack[]
}

model ProjectStack {
  projectId   String
  stackItemId String
  sortOrder   Int       @default(0)
  project     Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  stackItem   StackItem @relation(fields: [stackItemId], references: [id], onDelete: Cascade)

  @@id([projectId, stackItemId])
}

model MediaAsset {
  id           String         @id @default(cuid())
  key          String         @unique   // S3 object key
  bucket       String
  mimeType     String
  byteSize     Int
  width        Int?
  height       Int?
  blurDataUrl  String?                  // tiny base64 LQIP generated by sharp
  altText      String                   // required — never allow empty
  checksum     String                   // sha256, blocks duplicate uploads
  createdAt    DateTime       @default(now())
  coverOf      Project?       @relation("Cover")
  projectUses  ProjectImage[]
}

model ProjectImage {
  id        String     @id @default(cuid())
  projectId String
  assetId   String
  caption   String?
  sortOrder Int        @default(0)
  project   Project    @relation(fields: [projectId], references: [id], onDelete: Cascade)
  asset     MediaAsset @relation(fields: [assetId], references: [id], onDelete: Restrict)

  @@unique([projectId, assetId])
  @@index([projectId, sortOrder])
}

model ContactMessage {
  id         String        @id @default(cuid())
  name       String        @db.VarChar(120)
  email      String        @db.VarChar(255)
  message    String        @db.Text
  status     MessageStatus @default(NEW)
  ipHash     String                      // salted SHA-256, never the raw IP
  userAgent  String?
  resendId   String?                     // Resend message id, for delivery lookups
  deliveredAt DateTime?
  createdAt  DateTime      @default(now())

  @@index([status, createdAt])
}

enum MessageStatus { NEW READ REPLIED SPAM }

model RateLimit {
  key       String   @id            // "contact:<ipHash>" | "login:<ipHash>"
  count     Int      @default(0)
  expiresAt DateTime

  @@index([expiresAt])
}

model SiteSetting {
  key       String   @id            // "hero.thesis", "about.body", "social.github", …
  value     String   @db.Text
  updatedAt DateTime @updatedAt
}
```

### Seed script (`prisma/seed.ts`)

Idempotent — safe to re-run. Must:

1. Upsert the admin `User` from `ADMIN_USERNAME` and `ADMIN_PASSWORD`. **Refuse to run** if
   `ADMIN_PASSWORD` is unset, shorter than 16 characters, or equal to a known placeholder
   (`admin`, `password`, `changeme`). Hash with argon2id (`memoryCost: 19456, timeCost: 2,
   parallelism: 1` — OWASP minimum).
2. Seed `StackItem` rows grouped by suit.
3. Seed `SiteSetting` defaults (hero thesis, about body, social URLs) using copy that respects
   BRAND.md §8 — never lorem ipsum.
4. In non-production only, seed three sample `Project` rows in `DRAFT`.
5. Print the admin username and a reminder to rotate the password. **Never print the password.**

Run: `pnpm db:seed` → `prisma db seed` wired through `prisma.config.ts`.

---

## 5. Public pages

### `/` — Home (SSR, cached)

| Section | Rank | Content |
|---|---|---|
| Hero | — | Jack of Diamonds card (BRAND §5), name in `display-xl`, one-sentence thesis from `SiteSetting["hero.thesis"]`, two buttons: "View work" (anchor) and "Send a message" (anchor) |
| Selected work | `A` | 3–6 `PUBLISHED` projects by `sequence`, rendered as tiles linking to `/work/[slug]` |
| The stack | `2` | `StackItem` rows grouped by suit, mono lists, no logo images |
| Background | `3` | ~150 words from `SiteSetting["about.body"]`, capped at 66ch |
| Contact | `K` | The form (§7) plus GitHub and LinkedIn links |

Data: one Prisma query with `include` for cover image and stack. Response cached with
`Cache-Control: public, max-age=0, s-maxage=300, stale-while-revalidate=86400`; the cache is purged
on any project mutation.

### `/work/[slug]` — Project detail (SSR)

Order of blocks:

1. **Hero** — the same tile enlarged, keeping its `sequence` index and suit glyph so the card
   visually carries over from the grid. Title in `headline-lg`.
2. **Metadata strip** — mono: role · timeline · stack chips.
3. **The problem** — 2–3 sentences, `body-lg`.
4. **What I built** — Markdown body rendered server-side, with inline `ProjectImage` screenshots
   (responsive `<picture>`, AVIF/WebP, lazy below the fold, LQIP from `blurDataUrl`, required alt).
5. **Outcome** — numbers where they exist.
6. **Links** — live URL and repo URL, both `rel="noopener noreferrer"`.
7. **Next card** — footer linking to the project with the next `sequence` (wrapping to the first),
   rendered as a face-down card back that flips to reveal the next title on hover/focus.

Unknown or non-`PUBLISHED` slug → 404 (never 500, never a redirect that leaks existence).
Emits `article` JSON-LD and Open Graph tags with a per-project OG image.

### Supporting routes

- `/404` — brand-voiced: "That card isn't in the deck." with a link back to the work grid.
- `/robots.txt` — allows public paths, disallows `/admin` and `/api`.
- `/sitemap.xml` — published projects plus the home page, generated from the DB.
- `/healthz` — returns 200 with `{status, uptime, db: "ok"}` after a `SELECT 1`. Railway health check.

---

## 6. Admin

All routes under `/admin` require a valid session. Unauthenticated requests redirect to
`/admin/login?next=<path>` (validate `next` is a same-origin relative path — reject anything else).

| Route | Purpose |
|---|---|
| `GET /admin/login` | Username + password form. No "remember me", no signup link, no password reset. |
| `POST /admin/login` | See §8. |
| `POST /admin/logout` | Invalidates the session row and clears the cookie. |
| `GET /admin` | Dashboard: unread message count, project counts by status, last login. |
| `GET /admin/projects` | Table with status, sequence, suit; drag-to-reorder writes `sequence`. |
| `GET /admin/projects/new` · `GET /admin/projects/[id]` | Create / edit form. Markdown body with preview, cover picker, stack multi-select, image gallery with captions and alt text. |
| `POST /admin/projects/[id]/publish` | Sets `PUBLISHED` + `publishedAt`, purges cache. Blocked unless title, summary, problem, body, outcome, cover, and alt text are all present. |
| `GET /admin/media` | Grid of `MediaAsset`, upload, edit alt text, delete (blocked if referenced). |
| `GET /admin/stack` | CRUD for `StackItem`, suit assignment, ordering. |
| `GET /admin/messages` · `GET /admin/messages/[id]` | Inbox; mark read / replied / spam. |
| `GET /admin/settings` | Edit `SiteSetting` values. |

Admin mutations use **Astro Actions** (`src/actions/index.ts`) with Zod input schemas — one action
per operation, each re-checking the session server-side. Never trust a hidden form field for
identity or authorization.

Admin pages send `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store`.

---

## 7. Contact form

### Client

Fields: `name`, `email`, `message`, plus:
- `company` — honeypot, visually hidden via CSS (never `type="hidden"`), `tabindex="-1"`,
  `autocomplete="off"`. Any value present ⇒ silently accept and discard.
- `renderedAt` — signed timestamp (HMAC with `FORM_SECRET`). Submissions under 3 seconds or over
  30 minutes old are rejected.

Works without JavaScript as a native POST. With JS, it submits via `fetch`, keeps the entered
values, and renders inline errors. Button label: **Send message** → busy state **Sending…** →
success **Message sent**, matching BRAND.md §8.

### `POST /api/contact`

Accepts `application/json` or `application/x-www-form-urlencoded`.

```ts
const ContactSchema = z.object({
  name:    z.string().trim().min(2, "Tell me what to call you.").max(120),
  email:   z.email("That email address looks incomplete.").max(255),
  message: z.string().trim().min(20, "A couple more sentences would help.").max(5000),
  company: z.string().max(0).optional(),      // honeypot
  renderedAt: z.string(),
});
```

Pipeline:

1. Verify `Origin`/`Referer` is `https://mh.neri.ph` (Astro's `security.checkOrigin` plus an
   explicit check). Reject cross-origin with 403.
2. Rate limit on `sha256(ip + IP_HASH_SALT)`: **5 requests per hour**, and a global cap of 50/hour
   across all IPs as a flood brake. Over the limit → 429 with `Retry-After`.
3. Validate with Zod. Failure → 400 with a field-keyed error map, no stack traces.
4. Honeypot / timing check. Failure → return the **same 200 success shape** as a real submission,
   persist with `status: SPAM`, send no email. Never tell a bot it was caught.
5. Persist `ContactMessage` (`ipHash` only, never the raw IP).
6. Send via Resend server-side:
   - `from`: `Portfolio <hello@mh.neri.ph>` (verified domain)
   - `to`: `CONTACT_TO_EMAIL`
   - `reply_to`: the submitter's email
   - `subject`: `New message from {name}`
   - Both `text` and `html`; **escape every user-supplied value** before interpolating into the HTML
     body.
   - Idempotency key = message id, so a retry cannot double-send.
7. Store `resendId` and `deliveredAt`. If Resend fails, still return 200 — the message is safely in
   the database — log the failure at `error` and surface it in the admin inbox as undelivered.

Responses: `200 {ok:true}` · `400 {ok:false, errors:{field:string}}` · `429 {ok:false, error, retryAfter}` · `500 {ok:false, error:"Something went wrong on my end. Try again in a minute."}`

**`RESEND_API_KEY` is read only in server code and must never appear in a client bundle, a
`PUBLIC_*` variable, or a log line.**

---

## 8. Authentication

Hand-rolled session auth — no third-party auth service, per requirements.

- **Password hashing:** argon2id via `@node-rs/argon2`, `memoryCost: 19456, timeCost: 2,
  parallelism: 1`. Verify with the library's constant-time comparison.
- **Login:** on unknown username, still run a dummy argon2 verify against a fixed hash so response
  time does not leak account existence. Generic failure message for both bad username and bad
  password: "That username and password don't match."
- **Lockout:** 5 consecutive failures locks the account for 15 minutes (`failedLogins`,
  `lockedUntil`). Reset both on success. Login is additionally IP rate-limited to 10 attempts/15 min.
- **Sessions:** 32 bytes from `crypto.randomBytes`, base64url-encoded. Store **only**
  `sha256(token)` as `Session.id`. Cookie:
  ```
  Name: __Host-session
  HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000 (30 days)
  ```
  Sliding expiry: if under 15 days remain on validation, extend to 30 and reissue.
- **Session fixation:** issue a fresh session id on every successful login; delete the prior one.
- **Middleware:** `src/middleware.ts` resolves the session into `context.locals.user` for every
  request and blocks `/admin/*` and `/api/admin/*` when absent. Fail closed on any error.
- **Expired sessions:** deleted lazily on access and by a daily cleanup (§11).

---

## 9. File storage

- Private S3-compatible bucket on Railway MinIO. **No public bucket policy.**
- Upload path: admin → Astro action → server-side validation → `sharp` re-encode → `PutObject`.
- Validation: max 8 MB; MIME sniffed from **file content** (magic bytes), not the client-supplied
  `Content-Type` or extension; allowlist `image/jpeg`, `image/png`, `image/webp`, `image/avif`.
  Reject SVG entirely (script vector).
- `sharp` strips EXIF (including GPS), re-encodes to AVIF + WebP, and generates widths
  `[480, 960, 1440, 1920]` plus a 16px LQIP stored as `blurDataUrl`.
- Keys: `projects/{projectId}/{ulid}-{width}.{ext}`. Never use the client-supplied filename.
- Serving: `GET /api/media/[...key]` validates the key against `MediaAsset`, then 302s to a
  presigned URL with a 5-minute TTL and a long `Cache-Control` on the redirect. Storage host never
  reaches the browser.
- Delete: soft-block if the asset is referenced by any project; otherwise delete the row and the
  object.

---

## 10. Environment variables

`.env.example` (commit this; never commit `.env`):

```dotenv
# Core
NODE_ENV=development
PORT=4321
PUBLIC_SITE_URL=http://localhost:4321

# Database — Railway injects DATABASE_URL in production
DATABASE_URL=postgresql://portfolio:portfolio@localhost:5432/portfolio?schema=public
SHADOW_DATABASE_URL=postgresql://portfolio:portfolio@localhost:5432/portfolio_shadow

# Admin seed — 16+ chars, generated, rotated after first login
ADMIN_USERNAME=admin
ADMIN_PASSWORD=
ADMIN_DISPLAY_NAME=Mark Hugh Neri

# Secrets — generate with: openssl rand -base64 48
SESSION_SECRET=
FORM_SECRET=
IP_HASH_SALT=

# Object storage (MinIO in dev, Railway MinIO in prod)
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=portfolio-media
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_FORCE_PATH_STYLE=true

# Email
RESEND_API_KEY=
CONTACT_FROM_EMAIL=hello@mh.neri.ph
CONTACT_TO_EMAIL=
RESEND_ENABLED=false            # false in dev → log to console / Mailpit instead

# Optional
REDIS_URL=
LOG_LEVEL=debug
```

Validate the whole environment at boot with a Zod schema in `src/lib/env.ts`. **Crash on startup**
if anything required is missing or malformed — never fall back to a default secret. Only
`PUBLIC_*`-prefixed variables are exposed to the client; there must be zero secrets among them.

---

## 11. Background jobs

Implemented as idempotent scripts invoked by Railway cron:

| Job | Schedule | Action |
|---|---|---|
| `session:prune` | daily 03:00 UTC | Delete `Session` rows past `expiresAt` |
| `ratelimit:prune` | hourly | Delete expired `RateLimit` rows |
| `media:orphans` | weekly | Report `MediaAsset` rows with no reference (report only, never auto-delete) |

Redis is **optional**. Ship the Postgres-backed rate limiter first; introduce Redis only if the
counter write volume becomes a problem. If `REDIS_URL` is set, the limiter uses it transparently.

---

## 12. Local development

`docker-compose.yml` (dev only — production uses Railway managed services):

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: portfolio
      POSTGRES_PASSWORD: portfolio
      POSTGRES_DB: portfolio
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U portfolio"]
      interval: 5s
      retries: 10

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports: ["9000:9000", "9001:9001"]
    volumes: ["miniodata:/data"]

  createbucket:
    image: minio/mc:latest
    depends_on: [minio]
    entrypoint: >
      /bin/sh -c "
      mc alias set local http://minio:9000 minioadmin minioadmin &&
      mc mb --ignore-existing local/portfolio-media &&
      mc anonymous set none local/portfolio-media"

  mailpit:
    image: axllent/mailpit:latest
    ports: ["1025:1025", "8025:8025"]   # SMTP + web UI at :8025

  redis:                                 # optional
    image: redis:8-alpine
    ports: ["6379:6379"]

volumes: { pgdata: {}, miniodata: {} }
```

With `RESEND_ENABLED=false`, `src/lib/mail.ts` writes to Mailpit instead of calling Resend, so the
full contact flow is testable offline and no real emails leave the machine.

Scripts:

```json
{
  "dev": "astro dev",
  "build": "astro check && astro build",
  "preview": "astro preview",
  "db:up": "docker compose up -d",
  "db:migrate": "prisma migrate dev",
  "db:deploy": "prisma migrate deploy",
  "db:seed": "prisma db seed",
  "db:studio": "prisma studio",
  "db:reset": "prisma migrate reset --force && pnpm db:seed",
  "test": "vitest run",
  "test:e2e": "playwright test",
  "lint": "eslint . && prettier --check .",
  "typecheck": "astro check",
  "audit": "pnpm audit --audit-level=moderate"
}
```

First-run: `pnpm install` → `cp .env.example .env` → fill secrets → `pnpm db:up` →
`pnpm db:migrate` → `pnpm db:seed` → `pnpm dev`.

---

## 13. Deployment (Railway)

**Services in one Railway project:**

1. `web` — this repo. Build `pnpm install --frozen-lockfile && pnpm build`;
   start `pnpm db:deploy && node ./dist/server/entry.mjs`. Health check `/healthz`.
2. `postgres` — Railway PostgreSQL 17. Reference `${{Postgres.DATABASE_URL}}` from `web`; connect
   over the private network, never the public proxy.
3. `minio` — Railway MinIO template with an attached volume. Referenced privately by `web`.

`railway.json`:

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": { "builder": "NIXPACKS", "buildCommand": "pnpm install --frozen-lockfile && pnpm build" },
  "deploy": {
    "startCommand": "pnpm db:deploy && node ./dist/server/entry.mjs",
    "healthcheckPath": "/healthz",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

- Migrations run on deploy via `prisma migrate deploy`. **Never** `migrate dev` or `db push` in
  production.
- The seed runs once, manually: `railway run pnpm db:seed`. It is not part of the start command.
- Custom domain `mh.neri.ph` with Railway-managed TLS; force HTTPS and add HSTS (§14).
- Secrets live in Railway variables. Nothing sensitive in `railway.json` or the repo.
- Enable daily Postgres backups and verify a restore before launch.

---

## 14. Security requirements

Non-negotiable. Each is a merge blocker.

1. **HTTPS only** — HSTS `max-age=63072000; includeSubDomains; preload`.
2. **CSP** via Astro 6+'s Content Security Policy API: `default-src 'self'`; no `unsafe-inline`
   (hash or nonce every inline script/style); `frame-ancestors 'none'`; `base-uri 'self'`;
   `form-action 'self'`; `object-src 'none'`. Self-host fonts so no third-party origins are needed.
3. **Headers** — `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
   `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`,
   `Cross-Origin-Opener-Policy: same-origin`.
4. **CSRF** — Astro `security.checkOrigin: true`, plus explicit Origin validation on every
   state-changing route. Cookies are `SameSite=Lax`.
5. **Input validation** — every external input (body, query, params, headers used in logic) parsed
   through Zod at the boundary. No `any` crossing into business logic.
6. **Output encoding** — Astro escapes by default; `set:html` is permitted only on Markdown that has
   passed a sanitizer allowlist (`rehype-sanitize`). Never interpolate user input into raw HTML,
   email HTML, or SQL.
7. **SQL** — Prisma query builder only. `$queryRaw` requires tagged-template parameters; string
   concatenation into SQL is forbidden.
8. **Secrets** — never in the repo, never in `PUBLIC_*`, never logged. Add a secret-scanning step
   (gitleaks) to CI.
9. **Rate limiting** — contact 5/hr/IP, login 10/15min/IP, media upload 30/hr/session.
10. **PII** — store hashed IPs only, with a salt. Contact messages are retained 24 months, then
    pruned. State this in a short privacy note linked in the footer.
11. **Error handling** — user-facing errors are generic and in brand voice; details go to structured
    server logs with a correlation id. No stack traces, framework versions, or SQL in responses.
12. **Dependencies** — `pnpm audit` in CI; Dependabot or Renovate weekly; lockfile committed;
    `pnpm config set ignore-scripts true` for CI installs where feasible.
13. **Uploads** — content-sniffed MIME allowlist, size cap, EXIF stripped, re-encoded, SVG rejected,
    generated keys.
14. **Admin surface** — no public registration, no password-reset endpoint, `noindex` headers,
    session guard in middleware (fail closed), audit-log every mutation with user id and timestamp.

---

## 15. Performance and SEO

- Lighthouse targets on the home page: Performance ≥95, Accessibility 100, Best Practices ≥95,
  SEO 100. LCP <2.0s, CLS <0.05, INP <200ms on a mid-tier mobile connection.
- Ship <30KB JS on public pages. The scroll rail and contact enhancement are the only scripts.
- Self-hosted fonts, `font-display: swap`, subset to Latin, preloaded for the display face only.
- Every image responsive with explicit `width`/`height` to reserve space; AVIF first, WebP fallback.
- Per-page title/description, canonical URLs, Open Graph + Twitter cards, `Person` JSON-LD on the
  home page and `article` on project pages, `sitemap.xml`, `robots.txt`.

---

## 16. Testing

**Unit (Vitest):** Zod schemas including boundary cases; argon2 hash/verify; session token hashing
and expiry; rate-limit window rollover; slug generation; HMAC timestamp validation.

**Integration (Vitest + a disposable Postgres):** contact endpoint happy path, validation failure,
honeypot (must return success shape, must not email), rate-limit 429; login success, wrong password,
lockout after 5 attempts, session fixation check; project publish gating.

**E2E (Playwright):** home renders with published projects → tile click reaches the correct detail
page → "next card" cycles through the full set and wraps; contact form submits and shows "Message
sent"; contact form works with JavaScript disabled; admin login → create project → upload image →
publish → project appears publicly; logout invalidates the session; keyboard-only traversal of the
home page with visible focus at every stop; axe-core scan with zero critical violations.

**Definition of done:** typecheck clean, lint clean, all tests green, `pnpm audit` free of
moderate-plus advisories, Lighthouse targets met, and the page compared against BRAND.md section by
section.

---

## 17. Build order

1. Scaffold Astro 7 + TypeScript strict + Tailwind v4 + ESLint/Prettier; `.nvmrc`, `.env.example`.
2. `docker-compose.yml`; Prisma schema, first migration, seed script; `env.ts` boot validation.
3. `BRAND.md` tokens into `global.css`; build `BaseLayout`, `Card`, `SuitGlyph`, `ProjectTile`.
4. Home page against seeded data, static-first, no JS.
5. `/work/[slug]` including Markdown rendering, images, and the "next card" footer.
6. Contact form + `/api/contact` + Resend wrapper + rate limiter (Mailpit locally).
7. Auth: middleware, login/logout, lockout, session lifecycle.
8. Admin CRUD: projects, stack, media, messages, settings.
9. Security headers, CSP, sitemap, robots, JSON-LD, `/healthz`.
10. Tests, then Railway deploy, custom domain, Resend domain verification, backups.

Ship each step working before starting the next. Do not scaffold every page and fill them in later.
