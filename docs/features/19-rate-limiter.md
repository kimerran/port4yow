# 19 · Postgres-backed rate limiter

## Done

- `src/lib/ratelimit.ts` — the shared fixed-window limiter for contact, login
  and media upload.
- Atomic increment: one `INSERT … ON CONFLICT DO UPDATE` statement, no
  read-then-write.
- SPEC §14.9 limits: contact 5/hr/IP, login 10/15min/IP, upload 30/hr/session.
- SPEC §7.2 global contact flood brake: 50/hour across all IPs.
- `hashIp` — salted sha256; no raw address reaches a column or a log line.
- Unit suite plus an opt-in integration suite that runs against real Postgres.

## Changed

| File                                              | Why                                    |
| ------------------------------------------------- | -------------------------------------- |
| `src/lib/ratelimit.ts`                            | new — the limiter                      |
| `src/lib/__tests__/ratelimit.test.ts`             | new — limits, rollover, brake ordering |
| `src/lib/__tests__/ratelimit.integration.test.ts` | new — atomicity against real Postgres  |
| `package.json`                                    | `test:integration` script              |

## Decisions

**One statement, no transaction.** A read-then-write races under READ
COMMITTED even inside a transaction: two concurrent requests both read 4, both
write 5, and the 6th is never refused. `ON CONFLICT DO UPDATE` takes a row lock
and evaluates `count + 1` against the committed row, so concurrent callers
serialise and no increment is lost. The `CASE` rolls the window over in the same
statement, so there is no instant where an expired row reads as over-limit and
no dependency on a sweeper having run first. Parameterised through Prisma's
tagged template — AGENT §3 bans string-concatenated SQL and the key is derived
from user input.

**The global brake is consumed only after the per-IP check passes.** This is
the one ordering decision in the module and it is a security property, not a
detail. Consuming the shared 50/hour budget first would let a single abusive IP
burn it alone and lock every other visitor out — turning a per-IP limit into a
denial of service against the whole form. There is a test for exactly that.

**`Retry-After` ceils.** A floored value can reach 0, which tells a refused
caller to retry immediately and be refused again.

**Fails closed.** If the counter write returns no row the limiter throws rather
than returning "allowed" (AGENT §1.5). A limiter that opens when its own storage
misbehaves is worse than none, because it still looks like a limiter.

**Redis is not wired up, and the module says so.** SPEC §11 is explicit — "Ship
the Postgres-backed rate limiter first; introduce Redis only if the counter write
volume becomes a problem" — so Postgres is the whole implementation today. But
SPEC §7.2 also says the limiter uses Redis "transparently" when `REDIS_URL` is
set, and an operator who sets that variable and gets silence would reasonably
conclude Redis is absorbing the writes. It logs one warning at startup instead
of pretending. **This is the one acceptance-adjacent scope call in this issue and
it is worth a second opinion.**

## Verified

Gate re-run after the last edit: `typecheck` 0 errors / 0 warnings / 0 hints ·
`lint` PASS · `test` **192 passed, 4 skipped** · `build` PASS.

The 4 skipped are the integration suite, which needs a database. CI has no
Postgres service, so it skips rather than failing a machine without one. Run it
with `pnpm test:integration` against a live database — **it passes 4/4 locally**:

| Acceptance criterion                                   | Where                       | Result |
| ------------------------------------------------------ | --------------------------- | ------ |
| 6th request in an hour is limited; after expiry is not | unit + integration          | pass   |
| Concurrent increments do not undercount                | integration (real Postgres) | pass   |
| Global brake trips at 51 requests across distinct IPs  | unit                        | pass   |
| No raw IP in any column or log line                    | unit + integration          | pass   |

**The concurrency test is load-bearing.** Replacing the atomic statement with a
read-then-write:

```
× does not undercount under concurrency      AssertionError: expected 40 to be 10
× hands out each unit of budget exactly once AssertionError: expected
                                             [9,9,9,9,9,9,9,9,9,9]
                                             to equal [0,1,2,3,4,5,6,7,8,9]
```

40 concurrent requests were all allowed against a limit of 10, and every caller
was told it had 9 left. That is the exact failure the statement exists to
prevent, and the unit suite cannot see it — a JS map has no concurrent writers,
so a naive implementation passes there. That is why the integration file exists.

## Blocked

Nothing blocks this issue.

## Next

- #22 (`POST /api/contact`) is the first caller: `consume("contact", hashIp(ip))`,
  and returns 429 with `Retry-After: result.retryAfterSeconds` when refused.
- SPEC §11's `ratelimit:prune` hourly job is not in this issue's scope. Nothing
  depends on it for correctness — the `CASE` resets an expired window in place —
  but without it the table grows.
- Wiring the integration suite into CI needs a Postgres service in `ci.yml`.

## Content TODOs

None.
