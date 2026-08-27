# #43 — CSP and security header verification sweep

SPEC §14.1–14.4 · AGENT §1.2, §3 · Follows #33

## Done

Swept the finished site against a **built production server** — `astro dev`
emits no CSP at all, so a dev-server sweep would have verified nothing (#33's
lesson, still true).

The sweep found **two real defects**. Both are fixed here, both with tests.

## Changed

| File                                          | What                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| `src/middleware.ts`                           | catch a throw from `next()`; `no-store` on error responses that set none |
| `src/__tests__/middleware.test.ts`            | 18 new tests for both                                                    |
| `src/__tests__/state-changing-routes.test.ts` | new — enumerates every state-changing entry point and asserts its guard  |

## Finding 1 — an uncaught throw produced a response with **no security headers**

A malformed JSON body to any Astro Action makes the framework's own
`request.json()` reject. `next()` threw, `applySecurityHeaders` never ran, and
the adapter answered:

```
HTTP/1.1 500 Internal Server Error
Date: ...
Connection: keep-alive
Transfer-Encoding: chunked
```

That is the whole response. No HSTS, no `nosniff`, no CSP, no `Referrer-Policy`,
no COOP, no `X-Frame-Options`. Reachable **anonymously and cross-origin**,
because the parse happens before the action's `requireAdmin` ever runs:

```
curl -X POST -H 'Content-Type: application/json' -H 'Origin: https://evil.test' \
     --data 'x=1' /_actions/getStats     ->  500, zero security headers
```

The body was empty, so nothing leaked that time. **The problem is the class**:
every uncaught throw anywhere in the app produced an unprotected response, and
the first 500 that renders anything would render it without a CSP. The headers
belong to the response, so the response has to be ours.

The stack also went to Astro's own console error path rather than through
`logger` — skipping redaction and carrying no correlation id, which is the
opposite of what SPEC §14.11 asks for:

```
22:43:19 [ERROR] SyntaxError: Unexpected token 'x', "x=1" is not valid JSON
    at JSON.parse (<anonymous>)
    at parseJSONFromBytes (node:internal/deps/undici/undici:4319:19)
    ...
```

Middleware now catches it. After — **six** security headers, not seven: CSP is
absent because `security.csp` decorates rendered documents and a JSON response
never gets one. `nosniff` plus `application/json` is the control that matters
there, and `middleware.test.ts` pins exactly these six, which is the correct set
for what middleware owns.

```
HTTP/1.1 500 Internal Server Error
cache-control: no-store
cross-origin-opener-policy: same-origin
permissions-policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
referrer-policy: strict-origin-when-cross-origin
strict-transport-security: max-age=63072000; includeSubDomains; preload
x-content-type-options: nosniff
x-frame-options: DENY

{"ok":false,"error":"Something went wrong on our end.","correlationId":"122581c2-…"}
```

and exactly one structured log line, carrying the same id and no stack:

```
ERROR unhandled error {"correlationId":"122581c2-…","path":"/_actions/getStats",
                       "reason":"Unexpected token 'x', \"x=1\" is not valid JSON"}
```

Raw stack traces in the log after the fix: **0**.

### The bound on that, stated exactly

This covers **anything that throws before the response resolves** — not every 500. Not "total": streaming is on (Astro's default), so a component that throws
after the first chunk has flushed is past the `try`, because `next()` has
already returned a 200 and the headers are already on the wire.

Measured against the same build, the difference being only _when_ the throw
happens:

| throw in              | status  | `Cache-Control` | body                                                                   | logged |
| --------------------- | ------- | --------------- | ---------------------------------------------------------------------- | ------ |
| frontmatter           | **500** | `no-store`      | generic + correlation id (110 bytes)                                   | yes    |
| a component, 30 ms in | **200** | **none**        | 9415 bytes, no `</body>`, no `</html>`, ending `Internal server error` | **no** |

The late case is exactly the cacheable error page that Finding 2 exists to
prevent, arriving with a status the `>= 400` rule cannot see. A shared cache is
free to hold a truncated error document and serve it to everyone.

It is not fixable where the other two were — once the first chunk is out, the
headers are gone, so middleware can neither change the status nor add
`no-store`. The fixes are upstream: fetch in frontmatter so throws land before
the response resolves, or turn streaming off and pay the TTFB (SPEC §15 cares
about that). Both are bigger decisions than a header sweep, so this is recorded
rather than made — see **Next**.

## Finding 2 — 404s were heuristically cacheable

Every 404 came back with no `Cache-Control` at all, which makes it heuristically
cacheable by a shared cache. The shape where that bites is `/work/<slug>`, which
**rewrites to `/404` for a DRAFT project** (#18): a visitor who loads a project
page the hour before it is published can keep being told "that card isn't in the
deck" after it goes live. Publishing something and having it stay invisible is
the kind of failure nobody reports as a bug.

Error responses that set no policy of their own now get `no-store`. The
condition reads before it writes, so a route that has thought about its own
caching still wins, and 200s are untouched — public caching is SPEC §5's call,
not middleware's.

| Route                | Before                                                          | After      |
| -------------------- | --------------------------------------------------------------- | ---------- |
| `/404`               | _(none)_                                                        | `no-store` |
| `/work/<draft-slug>` | _(none)_                                                        | `no-store` |
| `/work/<unknown>`    | _(none)_                                                        | `no-store` |
| `/`                  | `public, max-age=0, s-maxage=300, stale-while-revalidate=86400` | unchanged  |
| `/sitemap.xml`       | `public, max-age=0, s-maxage=300`                               | unchanged  |
| `/healthz`           | `no-store`                                                      | unchanged  |

**Known limit, same cause as the streaming case above.** This rule keys on the
status, and a mid-stream throw produces a truncated error document under a
**200** — heuristically cacheable, and invisible to a `>= 400` test. It is the
one shape of cacheable error page this finding does not close.
`middleware.test.ts` pins the boundary deliberately: a 200 that sets no policy
is left alone, because inventing one here would override SPEC §5.

## The sweep itself

### Headers — 18 route/auth combinations, clean

Every one carried HSTS `max-age=63072000; includeSubDomains; preload`,
`nosniff`, `strict-origin-when-cross-origin`, the full `Permissions-Policy`,
COOP `same-origin`, `X-Frame-Options: DENY`. `/admin/*` carried `no-store` and
`noindex, nofollow` **signed in or out**, including the login page and including
the guard's own 302. No `Access-Control-Allow-Origin` on anything — there is no
cross-origin API here, so the correct count is zero rather than "no wildcards".

`/robots.txt`, `/sitemap.xml` and `/healthz` carry no CSP. That is Astro hashing
HTML documents only, and it is fine: they are `text/plain`, XML and JSON served
under `nosniff`, so no browser will parse them as a document.

### CSP violations — 0 across 13 routes

Home, project detail, 404, login, and all seven admin routes plus the two
dynamic admin pages, with the listener installed via
`Page.addScriptToEvaluateOnNewDocument` so it is in place _before_ the document
parses — a listener added after navigation misses everything that fires during
parsing.

**Positive control**, because zero is also what a broken instrument reports:

| Injected                                            | Fired                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| remote script from `https://evil.test`              | `script-src-elem` ✓                                                                                     |
| `<object data="/x.swf">`                            | `object-src` ✓                                                                                          |
| unhashed inline `<script>` via `insertAdjacentHTML` | nothing — and correctly so: scripts inserted that way never execute, so there is no violation to report |

The contact form was also submitted for real — typed fields, clicked button,
full navigation — because a `form-action` violation only exists when a form
actually submits, and no static scan can find one. 0 violations, confirmation
rendered.

### CSRF — every state-changing route, one by one

18 entry points: 15 Actions, plus `POST /api/contact`, `POST /admin/login`,
`POST /admin/logout`.

|                      | cross-origin | absent `Origin` | same-origin               |
| -------------------- | ------------ | --------------- | ------------------------- |
| `POST /api/contact`  | **403**      | **403**         | 200                       |
| `POST /admin/login`  | **403**      | **403**         | 401 (bad password)        |
| `POST /admin/logout` | **403**      | **403**         | 303                       |
| all 15 Actions       | **403**      | **403**         | 200 authed / **401** anon |

An absent `Origin` is refused everywhere, which is the case a hand-rolled check
usually gets wrong.

**Two probe corrections worth recording**, because both first reported something
false:

- 14 of 15 Actions use `accept: "form"`, so a JSON probe stops at **415** —
  measuring the content-type gate, not the origin check. Re-run form-encoded.
- Zod input validation runs **before** the handler, so a probe with a junk body
  gets **400** whatever its credentials — measuring the schema gate, not the
  guard. Re-run with schema-valid bodies, and the anon column becomes 401.

That second one is a real (minor) observation and not just an instrument note:
an unauthenticated caller can distinguish a valid input shape from an invalid
one, because validation precedes authorization in Astro's Action pipeline. It is
not a fail-open — nothing runs — but the schema is discoverable. Not something
this repo can reorder without leaving the framework.

### CSP hashes — honestly, partly

`unsafe-inline` and `unsafe-eval` appear in **zero** response headers. (There are
two literal occurrences in `dist/server/chunks/sequence_*.mjs`; both are inside
Astro's own CSP library — a predicate that _tests whether_ a directive contains
`'unsafe-inline'`.) No `is:inline` script exists except `JsonLd.astro`, which is
`type="application/ld+json"` — a data block, outside `script-src` entirely — and
which escapes `<` to `<` so a value containing `</script>` cannot end the
element.

Every inline block actually served is hashed: across all 13 routes, **0**
unhashed scripts and **0** unhashed styles, computed by digesting each served
block and checking membership in that page's own header.

The reverse direction does **not** fully close. Astro offers one global list —
7 script hashes and 4 style hashes on every page — and only 2 script and 3 style
hashes are consumed by anything I could serve. I could not attribute the
remaining **5 script and 1 style hash** to any route, and they do not match the
built client modules or stylesheet either. This is not a hole (a hash permits one
exact script Astro generated; it cannot admit attacker content) but the
acceptance box says "accounted for", so: 5 and 1 are not.

### One correction from the review

The reviewer's own curl-level CSRF probes hit the confound this handoff already
documents — `name=a&message=hello` fails `min(2)`/`min(20)` and returns 400
before anything else runs — and they said so rather than reporting the numbers.
Worth recording that the trap catches everyone who reaches for curl here, which
is the argument for the browser-driven table being the sound measurement. The
one result they confirmed independently and consistently, on all three
non-Action entry points: **absent `Origin` → 403**, with Astro's own
`Cross-site POST form submissions are forbidden`.

## Blocked

Nothing.

## Next — found by the sweep, deliberately not fixed here

**`publishProject` / `unpublishProject` answer 500 for a project that does not
exist.** `src/lib/projects.ts:189` throws a bare `new Error("Project not
found.")`. Every sibling slice has a typed domain error that `toActionError`
maps to `BAD_REQUEST`; projects is the one that does not, so it falls through to
a 500 and Prisma's `P2025` text reaches the console:

```
{"type":"AstroActionError","code":"INTERNAL_SERVER_ERROR","status":500,
 "message":"Project not found."}
```

`toActionError`'s own docstring argues against exactly this: _"`BAD_REQUEST`
rather than a 500: these are all 'you asked for something the rules do not
allow'."_ The response body is clean — no stack, no SQL — so it is not a leak;
it is a wrong status and a slice-level inconsistency. It belongs to #27's lane
(a new exported error class, the mapping, and tests in the projects slice), not
to a header sweep, so it is reported rather than fixed.

**Streaming and error responses.** The limit above is worth its own issue: with
streaming on, any throw after the first chunk yields a truncated document under
a 200 with no `Cache-Control`, and nothing reaches `logger`. The two candidate
fixes — move data fetching into frontmatter so throws land before the response
resolves, or disable streaming — trade against SPEC §15's TTFB budget, which is
a judgement for a human rather than a sweep.

Also still open, unrelated to this change:

- CI runs a bare `pnpm test` with no Postgres service, so 109 integration tests
  are skipped on the green tick. Open since #19.
- axe reports one serious `color-contrast` on `/` — the decorative rank
  watermark (`.text-[96px]`, `opacity-10`, 1.22:1), presentational but not hidden
  from the accessibility tree. Noted in #36 too.

## Content TODOs

None.
