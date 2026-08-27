# 35 · /healthz and the scheduled jobs

## Done

- `GET /healthz` — 200 with `{status, uptime, db}` after `SELECT 1`, 503 when the
  database is unreachable, and nothing leaked either way.
- Three idempotent jobs behind one runner: `pnpm job <name>`.
- `railway.json` per SPEC §13, and `docs/ops-jobs.md` for the cron services.

## Changed

| File                                          | Why                                           |
| --------------------------------------------- | --------------------------------------------- |
| `src/pages/healthz.ts`                        | new — the health check                        |
| `src/jobs/index.ts`                           | new — the three jobs                          |
| `src/jobs/run.ts`                             | new — the cron entry point                    |
| `src/jobs/__tests__/jobs.integration.test.ts` | new — 12 tests                                |
| `railway.json`                                | new — exactly SPEC §13's shape                |
| `docs/ops-jobs.md`                            | new — schedules and what each job will not do |
| `src/lib/db.ts`, `src/lib/logger.ts`          | explicit `.ts` extensions — see below         |
| `package.json`                                | `job` script                                  |

## Decisions

**`SELECT 1`, not a real query.** It proves the pool can hand out a working
connection, which is the failure this endpoint exists to catch. Counting rows
would also exercise a table, and Railway restarts the container on a non-200 —
so a slow table would restart a service that is merely busy.

**Uptime is measured from module load, not `process.uptime()`.** The latter
measures the Node process, which under a dev server or a warm reload is older
than the app.

**The failure reason is logged and never returned.** A driver's `message`
routinely contains the host, the port and the database name — which is precisely
the connection string SPEC §5 says this endpoint must not leak. Confirmed by
running it: with Postgres stopped, the response body was
`{"status":"error","uptime":11,"db":"error"}` while the log line began
``Invalid `prisma.$queryRaw()` invocation`` — the split working exactly as
designed.

**Idempotence is structural, not incidental.** Each job is a _predicate over
current state_ — "delete rows already past their expiry", "list rows nothing
references" — rather than a step in a sequence. A second run re-evaluates the
predicate and finds nothing. That is why none of them takes a cursor, a watermark
or a last-run timestamp: state like that is exactly what makes a re-run behave
differently from a first run.

**Neither prune is a correctness mechanism, and the code says so.** #23 already
deletes an expired session the moment it is presented, and #19's counter resets
an expired window in the same statement that increments it. Both jobs exist to
stop tables growing, not to make anything safe — worth stating, because a future
reader could otherwise assume a missed cron run has security consequences.

**`media:orphans` cannot delete, and the data model is why.** #28 writes **one
row per derivative** — eight for a typical upload — while a project references
exactly one of them as its cover. So **seven of eight rows belonging to a live,
published image are unreferenced by design**. A job deleting "unreferenced rows"
would delete most of the site's images. The report groups by key stem and flags a
group only when _nothing_ in it is referenced — and even then only prints.

**One runner, not three scripts.** They share an exit-code contract: 0 success,
1 failure, 2 unknown job. Railway records a non-zero exit as a failed run, which
is the only signal a schedule gives you.

**Explicit `.ts` extensions on three imports in `db.ts` and `logger.ts`.** Node
executes `src/jobs/run.ts` directly for cron, and its ESM resolver does not guess
extensions — the whole import chain has to be explicit or the job cannot start.
Vite and Astro accept them either way, the repo already imports `.ts` from
`<script>` blocks, and `allowImportingTsExtensions` is on via
`astro/tsconfigs/base`. Verified by running each job.

## Verified

Gate re-run after the last edit: `typecheck` 0 errors / 0 warnings / 0 hints ·
`lint` PASS · `test` **465** passed, 100 skipped · `build` PASS. Integration
**100/100** across eight suites.

| Acceptance criterion                                    | Result                                                                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `/healthz` 200 with a live DB, non-200 when unreachable | **200** `{"status":"ok","uptime":0,"db":"ok"}`; Postgres stopped → **503** `{"status":"error","uptime":11,"db":"error"}`; back up → **200** |
| Each job is safe to run twice back to back              | second run deletes 0 in both prunes; `media:orphans` returns an identical object                                                            |
| `media:orphans` deletes nothing, ever                   | row count identical after two runs; every derivative of a referenced image excluded                                                         |
| Cron entries configured in Railway and verified to fire | **not done — see below**                                                                                                                    |

The leak check on the health response: keys are exactly `db`, `status`,
`uptime`, and no value names a driver, host, port, version or password.

Each job over the real runner:

```
session:prune    {"job":"session:prune","deleted":0}
ratelimit:prune  {"job":"ratelimit:prune","deleted":1}
media:orphans    {"job":"media:orphans","found":0,"keys":[]}
```

Mutation results — each asserted to have applied:

| Mutation                                    | Tests failed |
| ------------------------------------------- | ------------ |
| `orphans` groups by key instead of stem     | 3            |
| `session:prune` deletes live sessions too   | 2            |
| `ratelimit:prune` deletes live counters too | 1            |
| `orphans` ignores gallery references        | 1            |
| comment-only change (control)               | **0**        |

## The control that caught my own harness

I included a no-op mutation expecting 0 failures. It reported **12** — because
the replacement string contained a literal `\n` that python inserted verbatim,
corrupting the file rather than changing nothing. The feature was fine; the
harness was broken.

This is the fifth instrument error this sprint, and the first one a control
caught rather than a puzzled second look. Added to the conventions: **a mutation
run should include a change that must fail nothing**, because a harness that
corrupts files reports every mutation as load-bearing.

## Not done — cron entries in Railway

**I cannot configure Railway or verify a schedule fired.** That needs dashboard
access to the project, and claiming otherwise would be reporting a check I did
not perform.

What ships instead: `railway.json` in exactly SPEC §13's shape (with
`healthcheckPath: "/healthz"`, which this issue makes real), and
`docs/ops-jobs.md` giving each job its service name, cron expression and start
command:

| Service                | Schedule (UTC) | Command                    |
| ---------------------- | -------------- | -------------------------- |
| `cron-session-prune`   | `0 3 * * *`    | `pnpm job session:prune`   |
| `cron-ratelimit-prune` | `0 * * * *`    | `pnpm job ratelimit:prune` |
| `cron-media-orphans`   | `0 4 * * 1`    | `pnpm job media:orphans`   |

Railway's `railway.json` schema has no `cron` key — cron is a per-service
setting — so these are created as three cron services sharing the web service's
`DATABASE_URL` over the private network. Each prints one JSON line per run, so
"verified to fire once" is checkable from the service logs after deploy: **a run
that logs nothing did not happen.**

## Blocked

Nothing blocks this issue.

## Next

- Create the three cron services at deploy time and confirm one line in each log.
- #36's 24-month contact pruning is a fourth job and should join this runner
  rather than starting a second pattern.
- CI still runs no integration suite. Open since #19.

## Content TODOs

None.

---

## Review round 2 — both notes acted on

The review tagged `ready-to-merge` with two non-blocking observations. Both were
worth doing, and one of them was a real gap rather than a nicety.

### `/healthz` had no automated test (fixed)

The reviewer is right that this is the file where a regression is most
expensive: `railway.json` sets `restartPolicyType: ON_FAILURE` with 3 retries, so
an uncaught throw here does not degrade the site — it **crash-loops** it. Both of
us had confirmed 200/503/recovery by hand and got identical numbers, so the
behaviour was never in doubt; what was missing was the guard that keeps it true.

`src/pages/__tests__/healthz.test.ts` mocks the pool, which is the right seam:
the interesting case is a database that is _unreachable_, and a suite needing a
live database cannot exercise it. The failure fixture is the **real** Prisma
string, host and port included —

```
Raw query failed. Code: `N/A`. Message: `Can't reach database server at 127.0.0.1:55466`
```

— so "leaks nothing" is asserted against the actual thing that would leak, not
against a placeholder. It also pins the response to **exactly** three keys, so a
field added later cannot leak by accident.

### No query timeout (fixed)

`docker stop` gives a fast connection-refused; a black-holed network gives a
hang, and `$queryRaw` would then sit past `healthcheckTimeout: 30`. The
reviewer correctly called this an observation rather than a defect — Railway
declares the poll failed either way.

It is still worth bounding, for a reason the verdict hides: an unbounded probe
leaves the request open and the connection held while the platform waits out its
own timeout. With a 5-second bound the answer always comes from us, the
connection is released, and the reason reaches our log instead of nowhere.

`Promise.race`, not an abort: the driver's query is not cancellable here, so the
honest description is "we stopped waiting", not "we cancelled it". The timer is
cleared on the winning path so a hung probe cannot hold the process open.

### Re-verified

| Check                    | Result                                                         |
| ------------------------ | -------------------------------------------------------------- |
| healthy                  | `{"status":"ok","uptime":0,"db":"ok"}` **200**                 |
| Postgres stopped         | `{"status":"error","uptime":10,"db":"error"}` **503 in 11 ms** |
| reason stays server-side | 1 log line, 0 occurrences in the body                          |
| recovered                | **200**, no restart needed                                     |

Mutation results — each asserted to have applied, and with a control:

| Mutation                             | Tests failed |
| ------------------------------------ | ------------ |
| return the driver reason in the body | 2            |
| answer 500 instead of 503            | 2            |
| remove the probe timeout             | 1            |
| cache the failure response           | 1            |
| comment-only change (control)        | **0**        |

Gate: `typecheck` 0 errors / 0 warnings / 0 hints · `lint` PASS · `test` **474**
passed, 109 skipped · `build` PASS.

### On the orphan-grouping note

The reviewer went looking for a bare `projects/{id}/{ulid}.webp` original that
`stemOf`'s `-\d+\.ext` anchor would miss, and found that `upload.ts` never writes
one. That is worth having in writing here rather than only in a PR thread: the
job's grouping and the uploader's key format agree **by construction**, not by
coincidence — `upload.ts` writes every key as `${keyStem}-${width}.${ext}` and
the sibling queries use `startsWith: \`${keyStem}-\``. If a future change ever
stores an original alongside its derivatives, `stemOf` needs revisiting in the
same commit.

### On the CI gap

Recorded, not fixed here. `ci.yml` runs a bare `pnpm test` with no Postgres
service and none of the `*_IT` flags, so the green tick covers 1 of the 13 tests
in this PR. `test:integration` now wires every flag into one command, so the
remaining work is a Postgres (and Mailpit, and MinIO) service in the workflow.
Open since #19 and worth its own issue.
