# 24 · Middleware — session hydration, admin guard, safe next redirect

## Done

- `context.locals.user` hydrated from the session cookie on every request.
- `/admin/*` and `/api/admin/*` blocked when absent.
- `?next=` validated as a same-origin relative path.
- Fail closed on any error during resolution.
- `no-store` + `noindex` on admin responses — **including the guard's own**.
- The cookie is re-sent when sliding expiry extends a session.

## Changed

| File                                 | Why                               |
| ------------------------------------ | --------------------------------- |
| `src/lib/redirect.ts`                | new — `safeNextPath`              |
| `src/lib/__tests__/redirect.test.ts` | new — every rejected shape        |
| `src/middleware.ts`                  | hydration, guard, header refactor |
| `src/__tests__/middleware.test.ts`   | rewritten around the new contract |

## Decisions

**A found bug: the guard's own responses skipped every security header.** The
guard returns before `next()`, and the header block sat after it — so a 302 to
the login page carried no `Cache-Control`. A heuristically cached redirect would
keep bouncing a visitor to the login page **after they had signed in**. Headers
now go through `applySecurityHeaders`, called on every return path. Neither the
existing tests nor the acceptance list would have caught this; the HTTP check
did, and there are now tests for it.

**`/api/admin/*` answers 401 JSON rather than redirecting.** #24 words the guard
as "redirect to `/admin/login?next=<path>`" for both. For an API that is wrong in
a way that matters: `fetch` follows a 302 transparently, so the caller receives
an HTML login page and a JSON parse error rather than "you are signed out", and
cannot act on it. A redirect is also meaningless to a non-browser client. **This
is a deliberate deviation from the issue's wording and wants ratifying** — it
still denies either way, so the security property is unchanged.

**`safeNextPath` is an allowlist of shapes, not a denylist of bad strings.** Each
rejection is a real bypass rather than a hypothetical:

- `//evil.test/x` carries no scheme, so a "starts with `/`" check accepts it and
  the browser treats it as another host. The most common open-redirect bug, and
  the acceptance criterion names it.
- `/\evil.test` — browsers normalise a backslash in the authority position, so
  `/\` behaves as `//`. Rejecting `//` alone is not enough.
- A control character can end a `Location` header and start another
  (response splitting).
- `/admin/login` as a target is a loop, not a redirect.

**The `next` we build ourselves still goes through the validator.** It comes from
our own `pathname`, so it is same-origin by construction — but it is about to be
reflected into a URL a browser will follow, and "it came from us" is the
assumption that stops being true the first time someone adds a rewrite.

**The cookie is re-sent when `validateSession` reports `refreshed`.** Without it
the row's expiry extends server-side while the cookie keeps its original
`Max-Age`, so the session dies in the browser while the database still believes
it is alive. #23's handoff flagged this as #24's job; it is done.

**Hydration is wrapped in try/catch even though `validateSession` never throws.**
The cookie read can, on a malformed header, and this must never be the line that
turns an error into access.

## Verified

Gate re-run after the last edit: `typecheck` 0 errors / 0 warnings / 0 hints ·
`lint` PASS · `test` **334** passed, 21 skipped · `build` PASS.

Against the built server over real HTTP:

| Request                     | Result                                          |
| --------------------------- | ----------------------------------------------- |
| `/admin`                    | 302 → `/admin/login?next=%2Fadmin`              |
| `/admin/projects`           | 302 → `/admin/login?next=%2Fadmin%2Fprojects`   |
| `/admin/projects?page=2`    | 302 → `…next=%2Fadmin%2Fprojects%3Fpage%3D2`    |
| `/api/admin/projects`       | **401** `{"ok":false,"error":"Not signed in."}` |
| `?next=https://evil.test`   | 302 → `/admin/login` — stripped                 |
| `?next=//evil.test`         | 302 → `/admin/login` — stripped                 |
| `?next=/\evil.test`         | 302 → `/admin/login` — stripped                 |
| `?next=javascript:alert(1)` | 302 → `/admin/login` — stripped                 |

The guard's 302 carries `cache-control: no-store`, `x-robots-tag: noindex,
nofollow`, HSTS and `x-frame-options: DENY`; so does the 401. A public page gets
HSTS and **no** `x-robots-tag`.

`?next=/admin/projects` (a safe value) passes through and 404s, because
`/admin/login` does not exist yet — that page is #25.

Mutation results:

| Mutation                                           | Tests failed |
| -------------------------------------------------- | ------------ |
| accept protocol-relative and backslash authorities | 6            |
| remove the admin guard entirely                    | 4            |
| stop stripping an unsafe `?next`                   | 4            |
| fail OPEN when hydration throws                    | 3            |
| guard by bare prefix (`/administrators` too)       | 2            |
| leak an extra field into `locals.user`             | 2            |
| skip headers on the guard's early returns          | **0 → 2**    |
| stop re-sending the cookie after sliding expiry    | 1            |
| redirect the admin API instead of 401              | 1            |

The `0 → 2` row is the found bug: it failed no tests before this issue added
them.

**Client bundle audit — now earned.** #23's was expected-clean because nothing
imported `auth.ts`. Middleware does, and the client bundle is still **0 files**
for `argon2`, `__Host-session`, `validateSession`, `passwordHash` and
`SESSION_SECRET`.

## Blocked

Nothing blocks this issue.

## Next

- **#25** builds `/admin/login`, which is why a safe `next` currently 404s. It
  owns the dummy-verify timing equalisation, the 5-failure lockout, and
  `consume("login", …)`; it should call `rotateSession` and use `clientIpFrom`
  (#22) for `Session.ipHash`.
- Middleware is **not** the only authorization check. SPEC §6 and AGENT §3
  require every admin handler and Astro Action to re-check the session
  server-side — #26 onward.
- Worth ratifying the 401-vs-redirect deviation for `/api/admin/*`.

## Content TODOs

None.
