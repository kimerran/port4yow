# #33 — Security headers and CSP

## Done

Verified against a **built production server**, not the dev server — the two behave
differently here, which is the main lesson of this slice.

| Check                        | Result                                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| CSP header                   | present, with `default-src 'self'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, `object-src 'none'`, `font-src 'self'` |
| `unsafe-inline`              | **absent** — Astro hashed 5 inline scripts and 1 style automatically                                                                          |
| HSTS                         | `max-age=63072000; includeSubDomains; preload`                                                                                                |
| `X-Content-Type-Options`     | `nosniff`                                                                                                                                     |
| `Referrer-Policy`            | `strict-origin-when-cross-origin`                                                                                                             |
| `Permissions-Policy`         | `camera=(), microphone=(), geolocation=(), interest-cohort=()`                                                                                |
| `Cross-Origin-Opener-Policy` | `same-origin`                                                                                                                                 |
| `/admin/*`                   | `no-store` + `noindex, nofollow`; public pages get neither                                                                                    |
| CSRF                         | cross-origin POST → **403**, same-origin → **200**                                                                                            |

**61 tests** (up from 47). `typecheck` 0/0/0 · `lint` ✓ · `build` ✓ · `audit` ✓

## Two things the docs would have got wrong

- **Astro emits CSP as a response _header_, not a `<meta>` tag.** Its own docstring example
  shows `<meta http-equiv="content-security-policy">`. I wrote the config assuming meta, and
  noted that `frame-ancestors` is ignored in meta CSP by spec — so I planned to set it
  separately in middleware. Checking a built server showed a real header, which _does_ honour
  `frame-ancestors`, so it belongs in the Astro directives where the hashing lives. **Verify
  the mechanism before designing around its limitations.**
- **CSP is not emitted by `astro dev` at all.** Neither header nor meta. A dev-only check would
  have concluded the feature was broken. Everything here was confirmed against
  `node ./dist/server/entry.mjs`.

## A bug my own test caught immediately

`startsWith("/admin")` also matches **`/administrators`** and **`/admin-guide`** — a public
page with such a path would silently receive `no-store` and `noindex, nofollow`. It
over-applies rather than under-applies, so it is not a security hole, but de-indexing a real
page is a live consequence. Now `pathname === "/admin" || pathname.startsWith("/admin/")`,
with all three shapes in the test table. Reverting to the loose prefix fails 3 tests.

## Decisions

- **CSP stays in `astro.config.mjs`, not middleware.** Astro hashes the inline scripts and
  styles it emits; a hand-rolled header cannot, and would force `unsafe-inline` the moment
  #11's scroll rail or #21's form enhancement lands. AGENT §2 asks for the built-in API.
- **The other headers go in middleware** because Astro has no equivalent for them.
- **`src/middleware.ts` is created here, headers-only.** It is #24's file for session
  hydration and the `/admin` guard; #33 needs the file to exist first. The header block is
  independent of auth and will not need rewriting.
- **HSTS is sent unconditionally.** Browsers ignore it over plain HTTP, so protocol-sniffing
  buys nothing, and omitting it behind a TLS-terminating proxy is the commoner mistake.
- **`X-Frame-Options: DENY` alongside `frame-ancestors`** — redundant for modern browsers,
  free, and covers anything that predates CSP.
- **CSP is not unit-tested**; it is emitted by the build, so a unit test would assert against
  nothing. Verified against a built server instead, and the test file says so.

## Standing rule this establishes

**Every new inline script proves it complies with CSP before its issue closes.** #11 (scroll
rail) and #21 (contact form) each add their hash as part of their own work, not as cleanup
later. #43 is the final verification sweep once every route exists.

## Blocked

Nothing.

## Next

**#10 — BaseLayout**, once #54 (#9's tokens) merges.

## Content TODOs

None.
