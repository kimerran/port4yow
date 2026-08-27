# 25 · Admin login and logout

## Done

- `GET /admin/login` — the form. No signup, no password reset, no "remember me".
- `POST /admin/login` — origin, IP rate limit, Zod, dummy verify, lockout,
  session rotation.
- `POST /admin/logout` — deletes the session row and clears the cookie.

## Changed

| File                                                  | Why                                                    |
| ----------------------------------------------------- | ------------------------------------------------------ |
| `src/lib/login.ts`                                    | new — `attemptLogin`, lockout, timing equalisation     |
| `src/pages/admin/login.astro`                         | new — GET renders, POST runs the pipeline              |
| `src/pages/admin/logout.ts`                           | new                                                    |
| `src/lib/__tests__/login.integration.test.ts`         | new — 14 tests                                         |
| `src/pages/api/__tests__/contact.integration.test.ts` | scoped its cleanup                                     |
| `package.json`                                        | `test:integration` runs all three suites, sequentially |

## Decisions

**The dummy hash is generated from `randomBytes`, never written into the
source.** AGENT §3 forbids a hardcoded credential "even in a test", and a fixed
hash in the repo is exactly that — a real one, since anyone reading the file
would know the plaintext that verifies against it. It is computed once, lazily.

**Every path runs exactly one argon2 verify — including the locked path.** The
unknown-username case is the obvious one: without a dummy verify it returns in
~0 ms while a real account costs ~50 ms, which reopens through the clock the
account-existence oracle the generic message closes. The locked case is the
non-obvious one: returning early on `locked` before verifying would make a
locked account distinguishable from a wrong password by timing. **The suite
could not see that** until a test was added for it — measured below.

**One message for every failure**, and `reason` exists only for the server-side
log line.

**The page handles both GET and POST.** That is what makes the form work with
JavaScript disabled — it is a native POST to its own URL, and there is no client
script on this page at all. The form carries no `action`, so `?next=` survives
the round trip without a hidden field.

**The password is never re-populated on failure.** A password echoed into a
`value` attribute lands in the page source, the bfcache, and any proxy that logs
bodies. The username is echoed, because retyping it is friction with no benefit.

**Logout is POST, never GET.** A GET logout can be triggered by any `<img src>`
on any page on the internet — nuisance CSRF that signs the admin out at will. It
deletes the session **row**, not just the cookie: clearing the cookie alone
leaves a live session id in the database, so whoever holds a copy of the token —
the reason to log out — is still signed in.

**`astro check` does not count an identifier used only inside a frontmatter
`return` expression.** It reported `safeNextPath` as an unused import
(`ts(6133)`) while it was plainly used in `return Astro.redirect(safeNextPath(…))`.
Assigning to a variable and returning after the branch keeps the gate at 0/0/0
without suppressing anything. Worth knowing before someone "fixes" the unused
import by deleting it.

## Verified

Gate re-run after the last edit: `typecheck` 0 errors / 0 warnings / 0 hints ·
`lint` PASS · `test` **334** passed, 35 skipped · `build` PASS. Integration:
**35/35** across all three suites.

Acceptance, against real Postgres, real argon2 and a running server:

| Criterion                                                           | Result                                                                                                                       |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Successful login sets the cookie and rotates the session id         | 303 → `/admin`, `__Host-session=…; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax`; old id invalid, one row remains |
| Wrong password and unknown username are identical                   | both **401**, both `That username and password don&#39;t match.`                                                             |
| …and comparable in time                                             | max/min ratio **< 3** over 5 paired runs (the failure it guards is ~50×)                                                     |
| 5 failures lock; the 6th is refused with the CORRECT password       | `lockedUntil` set at 5, correct password returns `locked`, succeeds once the lock expires; 4 failures do not lock            |
| Logout invalidates the row — the old cookie no longer authenticates | 303 → `/admin/login`, `Session` count **0**, old cookie → 302                                                                |
| Login page keyboard-operable with visible focus                     | 3 controls, all 44px, all `:focus-visible` with `2px solid rgb(0, 206, 209)` @ 2px                                           |

Full flow: anonymous `/admin` → 302; signed in → 404 (the page is #26, so _not_
being redirected is the signal). axe on the login page: **0 violations**. No
signup, reset or "remember me" text in the rendered page.

Mutation results:

| Mutation                                              | Tests failed |
| ----------------------------------------------------- | ------------ |
| never set `lockedUntil`                               | 3            |
| allow login while the account is locked               | 2            |
| drop the dummy verify for an unknown username         | 1            |
| raise the lockout threshold to 6                      | 1            |
| stop resetting the counters on success                | 1            |
| return on `locked` **before** verifying (timing leak) | **0 → 1**    |

That last row is the one worth reading: the obvious "optimisation" of returning
early for a locked account leaked lock state through timing and failed **no**
tests until this issue added one.

## Found and fixed: cross-suite interference

Adding a third integration suite exposed a latent race. The contact suite's
`beforeEach` did a bare `db.rateLimit.deleteMany({})`, wiping counters #19's
concurrency test was mid-way through — it saw **11 allowed against a limit of
10**. That is a test-isolation bug, not a product bug, and it would have looked
exactly like a broken limiter.

Two fixes: the cleanup is now scoped to `contact:` keys, and `test:integration`
runs with `--no-file-parallelism`, because these suites share one database. Three
consecutive runs: 35/35 each time.

**Client bundle:** 0 files for `argon2`, `attemptLogin`, `passwordHash`,
`__Host-session`, `LOCKOUT`.

## Blocked

Nothing blocks this issue. **Sprint 5 is complete once this merges.**

## Next

- `/admin` itself is #26 — signed-in requests currently reach a 404.
- Middleware is not the only authorization check: every admin handler and Action
  must re-check the session server-side (SPEC §6, AGENT §3).
- CI still cannot run any integration suite; `ci.yml` needs Postgres and Mailpit
  services. Flagged on #19, #22 and now here.
- SPEC §11's daily `session:prune` job still has no issue.

## Content TODOs

None.

---

## Review round 2 — finding addressed

### Login and logout allowed a missing `Origin`; `/api/contact` did not (fixed)

The reviewer is right, and the shape of the bug matters more than the line:

```ts
if (origin !== null && origin !== expected) return 403; // login, logout
```

A request with **no** `Origin` passed that. #22 had made the opposite call on the
same threat and written down why — a browser always sends `Origin` on a
cross-origin POST, so its absence means a non-browser client, and treating "no
evidence" as "must be fine" is failing open. The repo had two answers to one
question, and the laxer one was guarding the route that **issues sessions**.

Fixed at the class rather than per-file: `src/lib/origin.ts` exports one
`isSameOrigin(request)`, and `/api/contact`, `/admin/login` and `/admin/logout`
all call it. Copying the corrected condition into two more files would have left
the same drift available next time.

**Not exploitable today**, as the review says — Astro's `checkOrigin` refuses a
missing-`Origin` **form** POST before the route runs. But it does not cover JSON,
and it is a config line someone could change, which is exactly why SPEC §14.4
asks for the explicit per-route check.

### Verified

| Request                                   | Result                                               | Refused by                                    |
| ----------------------------------------- | ---------------------------------------------------- | --------------------------------------------- |
| `POST /api/contact` JSON, **no Origin**   | **403** `{"ok":false,"error":"Forbidden."}`          | our check — `checkOrigin` does not cover JSON |
| `POST /api/contact` JSON, matching Origin | 200 `{"ok":true}`                                    | —                                             |
| `POST /api/contact` JSON, evil Origin     | 403                                                  | our check                                     |
| `POST /admin/login` form, no Origin       | 403 `Cross-site POST form submissions are forbidden` | `checkOrigin`, first                          |
| `POST /admin/logout`, no Origin           | 403                                                  | —                                             |

The JSON row is the one that proves the fix: it is the path the framework
backstop never sees.

Mutation — restoring the exact shape login and logout had:

```ts
if (origin === null) return true; // absent Origin accepted
```

fails **3** tests. (A first attempt at this mutation failed **0**, because it
still fell through to the `Referer` check and so was not the bug at all — worth
recording, since a mutation that does not reproduce the defect proves nothing.)

### On `failedLogins` after a lockout expires — a decision, not an oversight

The reviewer's observation is accurate: once a lock expires, `failedLogins` is
still 5, so a single wrong password re-locks immediately, and only a **successful**
login resets the counter.

That is SPEC §8 read literally — it says reset on success, not on expiry — and it
is the safer reading: after a first lockout an attacker gets one guess per 15
minutes rather than five. The cost is that "5 consecutive failures" stops
describing the steady state, and an admin who typos once after a lockout waits
another 15 minutes. Nobody is locked out permanently, because the correct
password always works and always clears the counter.

Recording it here so it reads as chosen rather than missed.

### Gate

`typecheck` 0 errors / 0 warnings / 0 hints · `lint` PASS · `test` **345** passed,
35 skipped · `build` PASS. Integration **35/35**.
