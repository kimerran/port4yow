# 23 · Auth library — argon2id and sessions

## Done

- `hashPassword` / `verifyPassword` — argon2id at the OWASP minimum, constant-time
  comparison via the library, failing closed on an unreadable hash.
- `createSession` / `validateSession` / `invalidateSession` / `rotateSession`.
- Only `sha256(token)` is persisted; the token itself never reaches the database.
- Sliding expiry, lazy deletion of expired rows, session-fixation rotation.
- `__Host-session` cookie options.

## Changed

| File                             | Why                    |
| -------------------------------- | ---------------------- |
| `src/lib/auth.ts`                | new — the whole module |
| `src/lib/__tests__/auth.test.ts` | new — 30 tests         |

No new dependencies: `@node-rs/argon2@2.1.0` was already present and is current
(`pnpm view` agrees).

## Decisions

**`algorithm: 2` rather than `Algorithm.Argon2id`.** The library declares that as
an ambient `const enum`, and this project's `verbatimModuleSyntax` refuses to
import one — `ts(2748)`. The number was read out of
`node_modules/@node-rs/argon2/index.d.ts` (`Argon2id = 2`), not remembered. A
bare magic number on a security parameter is a bad trade on its own, so a test
asserts the produced hash announces itself as `$argon2id$…$m=19456,t=2,p=1$`:
if a future version renumbers the enum, the hash changes family and the test
fails loudly rather than silently downgrading to argon2i.

**`verifyPassword` fails closed on a throw.** `verify` rejects on a malformed or
truncated stored hash. An exception escaping here becomes a 500 on the login
route, and — worse — a caller catching it loosely could read "the hash is
corrupt" as "the password is fine". A hash we cannot read is a password that does
not match (AGENT §1.5).

**The session digest is unsalted, unlike `hashIp`.** A salt defends against
enumerating a small input space. This input is 256 bits of CSPRNG output, so
there is nothing to enumerate, and an unsalted digest is what allows the lookup
to be a single indexed read rather than a scan. Salting here would cost
performance and buy nothing.

**`sameSite: "lax"`, not `"strict"`.** Strict drops the cookie on top-level
navigations _into_ the admin from an external link, so a logged-in admin appears
logged out at random. Lax still withholds it from cross-site POSTs, which is the
CSRF case that matters, and #22's explicit Origin check covers what remains.

**`__Host-` is load-bearing, not cosmetic.** A browser refuses the cookie unless
it is `Secure`, `Path=/`, and carries **no** `Domain` — which is the point: a
compromised sibling subdomain cannot plant a session for us. A test asserts the
absence of `domain`.

**`rotateSession` creates before it deletes.** A failure between the two leaves
the user with a working session rather than logged out mid-login. The old id
stops validating either way, which is the property SPEC §8 actually asks for.

**`validateSession` returns null on every failure, including a thrown one.** SPEC
§8 says fail closed on any error; returning null rather than throwing makes that
the default, so a caller who forgets a try/catch still ends up with no user
rather than a leaked stack trace.

## Verified

Gate re-run after the last edit: `typecheck` 0 errors / 0 warnings / 0 hints ·
`lint` PASS · `test` **275** passed, 21 skipped · `build` PASS.

Argon2 is exercised for real — no mocked hashing. A produced hash:

```
$argon2id$v=19$m=19456,t=2,p=1$AAO2ZYoVkQzM6kHg0zV/dA$…
```

| Acceptance criterion                                         | Result                                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| hash/verify round-trip; wrong password fails                 | pass, including empty and case-changed inputs                                                          |
| `Session.id` is `sha256(token)`; raw token nowhere in the DB | id matches a freshly computed digest; the token appears in **no** key or value of the serialised store |
| Sliding expiry extends at 14 days remaining, not at 20       | extends to `now + 30d` at 14; unchanged at 20; unchanged at exactly 15                                 |
| Login rotates the id and the old id no longer validates      | new id differs, old returns null, one row remains                                                      |
| Any error inside validation fails closed                     | a throwing database yields `null`, not an exception                                                    |

Mutation results:

| Mutation                                            | Tests failed |
| --------------------------------------------------- | ------------ |
| store the raw token as the session id               | **11**       |
| fail OPEN when the stored hash is unreadable        | 4            |
| extend the expiry on every request                  | 3            |
| stop honouring expiry                               | 2            |
| lower `memoryCost` below the OWASP minimum          | 1            |
| argon2id → argon2i                                  | 1            |
| stop deleting the prior session on login (fixation) | 1            |
| throw instead of failing closed on a db error       | 1            |
| `SameSite=None` on the session cookie               | 1            |

**Bundle audit is expected-clean, not earned.** Nothing imports `auth.ts` yet, so
zero hits for `argon2`, `SESSION_SECRET`, `passwordHash` and `__Host-session` in
the client bundle proves little. #24 and #25 are the first consumers; the check
becomes meaningful there, exactly as it did for `mail.ts` between #20 and #22.

## Blocked

Nothing blocks this issue.

## Next

- **#24** hydrates `context.locals.user` from `validateSession` and guards
  `/admin/*` and `/api/admin/*`, failing closed. It must re-set the cookie when
  `refreshed` is true, or sliding expiry never reaches the browser.
- **#25** owns login: the dummy-verify timing equalisation, the 5-failure /
  15-minute lockout, and `consume("login", …)` for the IP limit — none of which
  are in this module. It calls `rotateSession` on success.
- `clientIpFrom` (#22) is how #25 should derive the IP for `Session.ipHash`;
  reading `X-Forwarded-For` again would re-open the bug that fixed.
- SPEC §11's daily `session:prune` job still has no issue of its own.

## Content TODOs

None.
