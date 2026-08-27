# #32 — Structured logger, correlation ids, audit log

## Done

`src/lib/logger.ts` — the only sanctioned output path (AGENT §4; `no-console` is an error
repo-wide). JSON in production, human-readable in development. **25 tests across two suites.**

| Check             | Result                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------- |
| Production output | one parseable JSON object per line, with `level`, `message`, `timestamp`, `correlationId`    |
| Secrets redacted  | password, hash, token, secret, salt, apikey, authorization, cookie, signature — 9 key shapes |
| Emails            | local part dropped, **domain kept** (`[redacted]@example.com`) so a line stays debuggable    |
| Raw IPs           | dropped — `ip`, `ipAddress`, `remote_ip`                                                     |
| Nested values     | redacted at depth, not just top level                                                        |
| Deep structures   | truncated at depth 4                                                                         |
| `Error`           | reduced to `name` + `message`; stack dropped                                                 |
| `LOG_LEVEL`       | honoured — `debug` suppressed at `info`                                                      |
| `audit()`         | exactly one line carrying actor, action, entity, entityId, outcome                           |

**Mutation-checked** — the redaction tests were verified to fail against broken code, in
three independent ways:

| Mutation                      | Tests failing |
| ----------------------------- | ------------- |
| secret-key redaction disabled | **12**        |
| email masking disabled        | **2**         |
| depth limit removed           | **1**         |

Restored → 25/25 green. A redaction test that passes against unredacted code proves nothing.

`typecheck` 0/0/0 · `lint` ✓ · `test` 25/25 · `build` ✓ · `audit` ✓

## Decisions

- **`--passWithNoTests` removed from `vitest.config.ts`.** Its comment said "remove when #37
  lands the first unit suite" — this _is_ the first unit suite, so the condition is met.
  `pnpm test` now fails if the suites disappear, which is the behaviour SPEC §12 always
  intended.
- **ESLint override: `no-restricted-properties` off in test files.** My own #47 rule caught
  these tests, correctly — but a suite must **construct** an environment rather than consume
  configuration, and `src/lib/env.ts` parses at import and throws without a fixture. Scoped to
  `**/__tests__/**` and `*.{test,spec}.ts` only; **verified that application code is still
  rejected** so the exception is narrow rather than a blanket hole.
- **Redaction is a backstop, not a licence.** AGENT §3 says secrets must never reach a log
  line in the first place. This exists because "never" holds exactly as long as the next
  person who forgets.
- **Email keeps its domain.** A bare `[redacted]` makes an error unactionable; the domain is
  almost always what you need and is not personally identifying on its own.
- **Depth-limited walk (4).** An unbounded recursion over a Prisma row is precisely how a
  table full of PII reaches a log line.
- **`audit()` emits at `info`**, not `debug`, so it survives a production `LOG_LEVEL` of
  `info` — an audit trail that vanishes under the default configuration is not an audit trail.

## CI follow-up — gitleaks caught my own test fixtures

The first CI run was **red on gitleaks**, not on the code:

```
Fingerprint: ...:src/lib/__tests__/logger.test.ts:generic-api-key:44
leaks found: 1
```

It flagged a vendor-prefixed fake API key in the redaction fixture table. The value was
invented, but AGENT §3 bans a hardcoded credential **"even in a test"**, and the rule exists
precisely so nobody has to adjudicate which fake strings are safe.

The real point: **redaction here is keyed on the field name, never on the value's shape**, so
realistic-looking secrets were never needed. Every fixture is now an obvious sentinel
(`SENTINEL-VALUE-1`…). The tests prove exactly what they proved before — confirmed by
re-running all three mutations.

Two genuine defects surfaced while fixing it, both **vacuous assertions**: a test supplied
`SENTINEL-EMIT` but asserted on `SENTINEL-VALUE-A`, and the audit test supplied
`SENTINEL-AUDIT` but asserted on `SENTINEL-EMIT`. Both passed for the wrong reason. Fixed, and
a scripted check now confirms **every asserted sentinel is one the test actually supplies** —
the same class of "the test refutes itself" error the #2 review caught, in a different shape.

This is also the gitleaks step earning its place: it caught something on its first real
opportunity.

## Blocked — two acceptance criteria cannot be met yet

#32 was moved from Sprint 6 to Sprint 1 because every later slice needs the logger, but two of
its three acceptance criteria are Sprint-6-shaped and are **not** satisfied here:

- _"Every admin mutation produces exactly one audit line"_ — there are no admin mutations yet.
  `audit()` exists and is proven to emit exactly one line; **wiring it into every Astro Action
  is #26–#31's work**, and their definition of done should carry that check.
- _"A triggered 500 returns the brand-voiced generic message and a correlation id"_ — needs
  `src/middleware.ts` (#24) to generate the id per request and an error boundary to surface it.
  `newCorrelationId()` is here and threads through; the request wiring is #24's.

Flagging rather than quietly ticking them. **Worth deciding whether #32 stays open pending
that wiring, or whether those two criteria move onto #24 and #26.**

## Next

Sprint 1's last issue. Sprint 2 (#9–#14, #33) needs `agent-ready` applied before auto-dev can
pick anything up.

## Content TODOs

None.
