# #38 — Integration tests against disposable Postgres

SPEC §16 · AGENT §5, §7

## Done

The coverage #38 lists was **already green**. The acceptance box that was not
ticked — and has been open since #19 — is the second one: _the suite runs in CI
on every PR_. That is what this PR delivers.

## The audit first

Every bullet, checked against the code rather than against the issue text:

| Required                               | Where                                                                              | Verdict |
| -------------------------------------- | ---------------------------------------------------------------------------------- | ------- |
| contact happy path                     | `contact.integration.test.ts`                                                      | covered |
| validation failure → field-keyed 400   | same                                                                               | covered |
| **honeypot → success shape, no email** | same, and it asserts Mailpit received nothing                                      | covered |
| rate limit → 429 with `Retry-After`    | same                                                                               | covered |
| login success / wrong password         | `login.integration.test.ts`                                                        | covered |
| **lockout after 5 attempts**           | same, plus "does not lock at 4"                                                    | covered |
| **session fixation**                   | same — "rotates the session id and invalidates the prior one"                      | covered |
| publish gating: missing required field | `projects.integration.test.ts`, `it.each` over all five of `PUBLISH_REQUIRED_TEXT` | covered |
| publish gating: missing cover alt text | same                                                                               | covered |

So no new test was written for its own sake. What follows is the wiring, and the
evidence for the two acceptance boxes that were claims rather than facts.

## Changed

| File                           | What                                                                       |
| ------------------------------ | -------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`     | new `integration` job — Postgres, MinIO, Mailpit, migrations, suite        |
| `vitest.integration.config.ts` | new — glob, `fileParallelism: false`, the `*_IT` gates                     |
| `package.json`                 | `test:integration` is now one command instead of nine flags and nine paths |

## Decisions

### `docker compose`, not `services:`

The repo already defines this exact stack for development, including the
one-shot job that creates the bucket and pins it **private** (SPEC §9 — "no
public bucket policy"). Using it in CI means the two cannot drift, which is the
strongest reading of the issue's "the same service container CI uses".

`services:` would also have forced a second definition of MinIO and then failed
to express it: those images need `server /data`, and a service container cannot
take a command without an entrypoint override. `bitnami/minio`, the usual
workaround, no longer publishes tags — checked, the Docker Hub tag list is
empty — so that path is gone rather than merely awkward.

Two details in the steps are load-bearing:

- `--wait` blocks on the healthchecks. Without it `createbucket` races MinIO's
  startup — the exact failure the compose file already documents.
- `createbucket` is started **separately**, because `--wait` treats a container
  that exits as a failure even on exit 0, and that job is one-shot by design.

### Secrets are generated per run

`SESSION_SECRET`, `FORM_SECRET` and `IP_HASH_SALT` come from `openssl rand` into
`$GITHUB_ENV` rather than being written into the workflow. AGENT §3's ban on
hardcoded credentials does not get an exception for CI. The MinIO and Postgres
credentials are the compose defaults, already in the repo, belonging to
containers that live for one job and are reachable only from it.

### The suite's config, not the invocation

`test:integration` was one line carrying nine `*_IT=1` flags,
`--no-file-parallelism`, and nine explicit paths. Three problems, all now fixed
by `vitest.integration.config.ts`:

- **A new integration test was invisible** until someone remembered to add its
  path _and_ its flag. The file list is a glob now. Verified: dropping a new
  `*.integration.test.ts` into the tree takes the run from 115 to 116 with no
  other edit.
- **`--no-file-parallelism` looked like a preference and is correctness.** The
  suites share one database and each clears the tables it owns in `beforeEach`,
  so two files running concurrently clear each other's rows. As a CLI flag it was
  one careless edit from an afternoon of "flaky" tests; as `fileParallelism:
false` with the reason attached, it is a decision.
- **The flags belong to the environment.** CI and a developer's shell can no
  longer disagree about which suites ran.

The `*_IT` gates stay, so `pnpm test` is still runnable on a laptop with nothing
running — the files skip rather than fail.

## Verified

### The CI job, rehearsed step by step on this machine

Not "it looks right" — the same commands, in order, against a **throwaway
database created for the run**:

```
CREATE DATABASE ci38_1188682
prisma migrate deploy   ->  20260827062653_init applied
pnpm test:integration   ->  9 files, 115 passed
DROP DATABASE ci38_1188682
```

That is acceptance box 1: green against a real Postgres, from a clean schema,
built by the committed migrations — so the suite is testing the migrations too,
not a database someone shaped by hand.

And the two compose commands the workflow runs, from a fully stopped stack:

```
docker compose up -d --wait postgres minio mailpit     -> healthy in 6.0s, exit 0
docker compose up --exit-code-from createbucket ...    -> bucket created, set private, exit 0
minio ok · mailpit ok · postgres ok
```

### Order and leftover state — acceptance box 3

| Run                                                                 | Result                                     |
| ------------------------------------------------------------------- | ------------------------------------------ |
| each of the 9 files alone                                           | all pass (4, 17, 14, 15, 17, 12, 9, 9, 18) |
| declared order                                                      | 115/115                                    |
| reverse file order                                                  | 115/115                                    |
| `--sequence.shuffle`, twice                                         | 115/115 both times                         |
| three consecutive runs against the **same, already-dirty** database | 115/115 each                               |

That last row is the one that matters and the one CI can never check for itself:
CI always starts clean, so a leftover-state bug would only ever appear on a
developer's machine.

**File-parallel is the exception, and it is not order dependence.** Running the
files concurrently fails 8 of 9 files and 26 tests, because they share one
database. That is why `fileParallelism: false` is in the config rather than in a
command someone can drop.

### Mutations

| Mutation                          | Result                                |
| --------------------------------- | ------------------------------------- |
| `fileParallelism: false` → `true` | **26 tests fail**                     |
| remove the `CONTACT_IT` gate      | its 17 tests **skip** rather than run |
| add a new `*.integration.test.ts` | picked up: 115 → **116**              |

Gate: `typecheck` 0 errors / 0 warnings / 0 hints · `lint` PASS · `test` **530
passed, 115 skipped** · `test:integration` **115 passed** · `build` PASS.

Not run: `test:e2e` — #39 has not landed.

## Review round 2 — the silent-skip path is closed

The review found that the glob fixed only half the problem: `INTEGRATION_GATES`
was still a hand-maintained list of nine names, so a suite gated on a name
nobody registered would be **collected by the glob and then skipped by its own
`describe.skipIf`**. Reproduced before fixing:

```
a file gated on NEWTHING_IT (not in the list)
  Test Files  9 passed | 1 skipped (10)
  Tests     115 passed | 1 skipped (116)
  exit code 0
```

A test that exists, is collected, never runs, and reports success — this PR's own
thesis in miniature, and a narrower version of the mechanism that hid 115 tests
behind a green tick from #19 to #38. The reviewer offered two fixes; both are
here, because they close different halves.

### The gate list is derived, not maintained

`vitest.integration.config.ts` now reads the `*_IT` names out of the matched
files themselves. Adding a suite with a new gate needs no edit there and cannot
be quiet. The same file threw on an empty result before this shipped, because a
regex that silently matches nothing would turn _every_ suite off while still
reporting success — the failure this whole change is about.

Verified: with the unregistered-gate file present, the run goes from
`9 passed | 1 skipped (10)` to **`10 passed (10)`, 116 tests, none skipped.**

### CI fails on any skipped test

`pnpm test:integration:ci` runs the same suite and exits non-zero if anything
was skipped. Deriving the gates is a mechanism that is correct today; this
asserts the outcome, which is the distinction this repo keeps having to relearn.

Locally, skipping remains correct with nothing running — which is why it is a
separate command and `pnpm test:integration` still skips quietly. Both paths
checked:

| Command               | With Postgres                                   | Without             |
| --------------------- | ----------------------------------------------- | ------------------- |
| `test:integration`    | 115 passed                                      | 115 skipped, exit 0 |
| `test:integration:ci` | `All 115 integration tests ran — none skipped.` | exits **1**         |

**Control**, because a guard that never fires is indistinguishable from one that
works: a suite whose gate name is assembled at runtime is invisible to the
deriver, so it still skips — and the guard catches it and names it.

```
Integration run reported 1 skipped test(s).
In CI a skip means a gate went unset or DATABASE_URL is missing — either
way the test did not run, and a green tick would be a lie.

  src/lib/__tests__/zzhidden.integration.test.ts: a suite whose gate cannot be discovered …
```

That message took a correction of its own: the first version filtered on
`status === "pending"` and named nothing, because vitest's JSON reports these as
`"skipped"` while the summary counts them under `numPendingTests`. Checked
against a real run rather than assumed.

## Blocked

Nothing.

## Next

- **Make `integration` a required check.** The job runs on every PR now, but
  "red CI does not merge" (AGENT §5) is a branch-protection setting, not
  something this PR can commit. Worth doing at the same time as merging it.
- CI installs run without `pnpm config set ignore-scripts true`, because
  `postinstall` runs `prisma generate` and the client is gitignored. SPEC §14.12
  says "where feasible"; this is the case where it is not, and it is worth a note
  rather than a silent divergence.

## Content TODOs

None.
