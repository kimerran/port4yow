# #37 — Unit test suite: schemas, argon2, sessions, rate limits, slugs, HMAC

SPEC §16 · AGENT §7

## Done

#37 is the **consolidated sweep** — its job is to find what earlier issues
skipped, not to restate what they covered. So the first work was an audit of the
six bullets against what already existed, and the tests were written only where
that audit found a hole.

Four of the six were already covered, and covering them again would have been
noise:

| Bullet                               | Existing coverage                                                                                                                                          | Verdict |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| argon2 hash/verify, OWASP parameters | `auth.test.ts` asserts the stored hash contains `$m=19456,t=2,p=1$` **and** that `ARGON2_OPTIONS` matches — the encoded output, not just the config object | covered |
| session hashing, sliding expiry      | `auth.test.ts` (33 cases)                                                                                                                                  | covered |
| rate-limit window rollover           | `ratelimit.test.ts` (28) + integration against real Postgres                                                                                               | covered |
| HMAC timestamp validation            | `formToken.test.ts` — all four shapes #37 names: valid, tampered, under 3s, over 30min, plus signature-before-age ordering                                 | covered |

The two that were **not** covered are where the work went — and both turned up a
real defect.

## The two defects

### 1. `PUBLIC_SITE_URL` could pass validation with no usable origin — and that

### disabled the CSRF check

`PUBLIC_SITE_URL: z.url()` accepts `localhost:4321`. The WHATWG parser reads it
as **scheme `localhost:`, path `4321`** — a structurally valid URL. That is the
obvious typo, because it is how you say the address out loud.

`new URL("localhost:4321").origin` is the **string `"null"`**, and `isSameOrigin`
compares the request's `Origin` header against it. Browsers send `Origin: null`
from a sandboxed iframe and from some cross-origin redirects. Measured both ways
before fixing:

| `PUBLIC_SITE_URL`    | cross-origin POST with `Origin: null` |
| -------------------- | ------------------------------------- |
| `localhost:4321`     | **accepted**                          |
| `https://mh.neri.ph` | refused                               |

### How far that actually went — narrowed after review

The mechanism above is exact. The **impact** claim in the first version of this
handoff was not: it said the typo turned the CSRF control on every
state-changing route into a no-op. Measured against a build with
`PUBLIC_SITE_URL=localhost:4321`, that is too strong — and the real picture is
more interesting than either the original claim or the review's correction:

| request                           | `Origin`               | result on the misconfigured build                                                    |
| --------------------------------- | ---------------------- | ------------------------------------------------------------------------------------ |
| `POST /api/contact`, form-encoded | `null`                 | **403** — Astro's `Cross-site POST form submissions are forbidden`                   |
| `POST /api/contact`, **JSON**     | `null`                 | **200 `{"ok":true}`** — accepted                                                     |
| `POST /api/contact`, JSON         | `https://evil.example` | 403 `{"ok":false,"error":"Forbidden."}`                                              |
| `POST /_actions/getStats`, JSON   | `null`                 | **401**, not 403 — the origin gate _passed_ and it fell through to the session check |
| `POST /_actions/getStats`, JSON   | `https://evil.example` | 403 Forbidden                                                                        |

So `isSameOrigin` really did fail open on `Origin: null` — demonstrably, on both
a public route and an admin action. What stopped that being an exploitable CSRF
hole is **two controls that are not this one**:

- **Form POSTs never reached it.** `security.checkOrigin` refuses them first,
  which is exactly the defence in depth SPEC §14.4 asks for by requiring both.
- **JSON POSTs are not reachable from a browser cross-site.** A cross-origin
  `fetch` with `Content-Type: application/json` triggers a CORS preflight, and
  `OPTIONS /api/contact` answers **404 with no `Access-Control-Allow-Origin`**,
  so the browser never sends the real request. A non-browser client can send it —
  but a request with no victim's browser is not CSRF.
- Admin actions additionally need the session cookie, and `SameSite=Lax`
  withholds it from cross-site POSTs.

**The honest statement:** the typo disabled the application-level origin check,
leaving `checkOrigin` as the only remaining control on form POSTs and CORS as the
only thing in front of the JSON ones. A lost defence-in-depth layer, not an open
door. Still worth fixing at the boundary, still worth the test — but not the
severity originally claimed.

Same shape as #87's "total": the code was right and the sentence outran the
measurement. Twice now, which is worth noticing rather than filing away.

Fixed at the boundary: `PUBLIC_SITE_URL` and `S3_ENDPOINT` now require an
`http`/`https` scheme. `env.ts` is the one place that is supposed to make a bad
value impossible to hold (SPEC §10), so defending downstream would have been the
wrong shape. `origin.test.ts` records the consequence, so if anyone loosens the
schema later they find a test explaining what it was protecting.

### 2. `normalizeSlug` could emit a slug its own validator rejects

The 96-character cap ran **after** the edge-hyphen strip, so whenever character
97 fell inside a word the result ended in `-` — which `isValidSlug` refuses.
`"ab ".repeat(40)` reproduces it: 96 characters ending `b-ab-ab-`.

The consequence is an admin pasting a long title and being told the slug is
invalid, on a value they never typed and the system generated. Found by the
round-trip property — _anything `normalizeSlug` does not reduce to empty must
satisfy `isValidSlug`_ — not by an example, which is the point of writing it as
a property.

## Changed

| File                                             | What                                                                 |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `src/lib/env.ts`                                 | `httpUrl()` — scheme required on `PUBLIC_SITE_URL` and `S3_ENDPOINT` |
| `src/lib/projects.ts`                            | strip trailing hyphens **after** the 96-char cap                     |
| `src/pages/api/contact.ts`                       | export `ContactSchema` for boundary tests                            |
| `src/lib/__tests__/env.test.ts`                  | new — 76 cases; the file had **no test at all**                      |
| `src/actions/__tests__/schemas.test.ts`          | new — 64 cases across all 15 action schemas                          |
| `src/pages/api/__tests__/contact-schema.test.ts` | new — 25 cases                                                       |
| `src/lib/__tests__/slug.test.ts`                 | new — 56 cases, property-first                                       |
| `src/__tests__/no-hardcoded-credentials.test.ts` | new — the third acceptance criterion                                 |
| `src/lib/__tests__/origin.test.ts`               | the `Origin: null` consequence                                       |

## Decisions

### The issue names a file that does not exist

#37 says "every schema in `src/lib/schemas.ts`". There is no such file — schemas
live in `env.ts`, `actions/index.ts` and `contact.ts`. Read as intent ("every Zod
schema"), which is unambiguous, so this was not worth a `needs-clarification`
round trip. All three are now covered.

### `astro:actions` is why fifteen schemas were unmeasured

`src/actions/index.ts` imports a virtual module that only exists inside Astro's
build, so Vitest could not import the file at all — which is why the admin
boundary's fifteen input schemas had no unit test while the handlers had
integration coverage. Mocking `astro:actions` with a `defineAction` that returns
its own config makes `server.<name>.input` the **real** schema object. The suite
asserts the full action list, so an action added without an entry fails the
enumeration rather than going quietly uncovered.

### "No hardcoded credential" is not "no credential-shaped fixture"

24 suites use `const SECRET = "x".repeat(48)`. That is a constructed placeholder:
it authenticates nowhere, and rewriting two dozen files to generate it would
trade determinism for the appearance of rigour. What AGENT §3 is actually
preventing is someone pasting a **real** secret into a test to make it pass, so
the guard looks for the shapes only real credentials have — AWS key ids, private
key blocks, provider tokens, JWTs, argon2 digests.

Two things that guard had to survive:

- **It flagged its own samples.** Written as literals, a file banning
  credential-shaped strings contained credential-shaped strings. Every sample is
  now assembled from fragments at runtime, so the runtime string matches and the
  source has nothing for this scanner — or the repo's gitleaks step — to find.
- **It flagged `mail.test.ts`'s `re_super_secret_key`**, a placeholder whose
  whole purpose is to assert the key never reaches a log line. Flagging it would
  have been a false positive on a test enforcing this very rule, and the pressure
  would have been to loosen the scanner or exempt the file. The rules now
  discriminate on **entropy** — a token body must contain both an uppercase
  letter and a digit — because a real key looks generated and
  `super_secret_key` does not.

The suite self-tests in both directions: samples it must flag, fixtures it must
not, and a non-empty file list. A scanner that matches nothing is
indistinguishable from a clean codebase, which is a failure mode this repo has
already paid for.

### New tests generate their own secrets

Every new suite uses `randomBytes` rather than a repeated character. It makes the
length boundaries honest — the value under test is a real token of exactly the
right length — and it means nothing in the new files would still be a secret if
it escaped.

## Verified

`typecheck` 0 errors / 0 warnings / 0 hints · `lint` PASS · `test` **770 passed,
115 skipped** (up from 514) · `test:integration` **115 passed** (9 files, real
Postgres/Mailpit/MinIO) · `build` PASS.

Not run: `test:e2e` — #39 has not landed.

Mutations, each asserted to have applied, with a control:

| Mutation                                        | Tests failed |
| ----------------------------------------------- | ------------ |
| revert the URL-scheme fix (the fail-open)       | 7            |
| revert the `S3_ENDPOINT` scheme fix             | 3            |
| revert the slug trailing-hyphen fix             | 4            |
| secret minimum 32 → 8                           | 4            |
| env error echoes the rejected source            | 2            |
| env stops freezing the parsed object            | 1            |
| `RESEND_ENABLED` no longer requires a key       | 2            |
| contact name minimum 2 → 1                      | 3            |
| contact message stops trimming before measuring | 1            |
| `saveSetting` key cap 64 → 640                  | 1            |
| `updateAltText` allows empty alt text           | 1            |
| `uploadMedia` allows empty alt text             | 1            |
| `deleteStackItem` defaults `confirmed` to true  | 1            |
| comment-only change (control)                   | **0**        |

**Two mutations survived the first round, and both were my instrument:**

- _"env echoes the rejected value"_ appended `JSON.stringify(issue.input)`, but a
  zod 4 issue carries no `input` property — so it appended the literal
  `undefined` and leaked nothing. Re-run by echoing the parse source, it fails 2.
- _"updateAltText allows empty alt text"_ replaced the **first** of two identical
  `altText: z.string().min(1).max(500)` lines, which belongs to `uploadMedia`.
  That one failing nothing was a genuine gap, not a bad probe: the media block
  only covered `updateAltText`. `uploadMedia` now has five cases, and both
  occurrences fail a mutation independently.

## Blocked

Nothing.

## Next

- **`z.url()` is used nowhere else**, checked — but it is worth knowing that
  zod's URL validation accepts any parseable URL, scheme included. If a future
  variable holds a URL, it wants `httpUrl()` rather than `z.url()`.
- CI still runs a bare `pnpm test` with no Postgres service, so the 115
  integration tests are skipped on the green tick. Open since #19 — and now that
  #38 (integration tests against disposable Postgres) is `agent-ready`, that is
  the issue to close it in.

## Content TODOs

None.
