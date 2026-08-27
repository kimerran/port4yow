# #36 — PII retention: 24-month contact pruning and footer privacy note

SPEC §14.10 · BRAND §8

## Done

- `contact:prune` deletes `ContactMessage` rows older than 24 months, on #35's
  runner, monthly.
- `/privacy` — a short note in brand voice, linked from the footer of every
  public page, keyboard-reachable with a visible focus ring.
- Audited the codebase for raw IPs and full email addresses. Found one real leak
  path and closed it.

## Changed

| File                                          | What                                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/jobs/index.ts`                           | `RETENTION_MONTHS`, `monthsBefore()`, `pruneContactMessages()`, registered as `contact:prune` |
| `src/pages/privacy.astro`                     | new — the note                                                                                |
| `src/layouts/BaseLayout.astro`                | footer link; the `TODO(content)` for #36 is discharged                                        |
| `src/lib/logger.ts`                           | mask email addresses appearing _inside_ string values and `Error` messages                    |
| `src/jobs/__tests__/retention.test.ts`        | new — the window, as unit tests                                                               |
| `src/jobs/__tests__/jobs.integration.test.ts` | `contact:prune` against real Postgres; registry test now expects four jobs                    |
| `src/lib/__tests__/logger.test.ts`            | the audit finding, pinned                                                                     |
| `docs/ops-jobs.md`                            | fourth cron service, and why this one is different                                            |

## Decisions

### The retention number is imported into the page, not typed into it

`privacy.astro` renders `RETENTION_MONTHS` — the same constant the job deletes
by. A privacy note is a promise about what the database holds, and the cheapest
way for it to become a lie is for someone to change the job's window and not the
page. Importing makes the two unable to disagree. `src/jobs/index.ts` is a server
module; the page has no client script, and the built client bundle was checked
(3 files, none mentioning `prisma`, `contact:prune`, `DATABASE_URL` or
`IP_HASH_SALT`) rather than assumed.

### Whole calendar months, with a clamp

24 months is 730 or 731 days depending on which leap year it spans, and the note
says months — so the cutoff is computed by shifting `getUTCMonth()`, not by
subtracting milliseconds. The clamp to the target month's last day matters for
exactly one shape: without it `setUTCMonth` rolls a non-existent 2022-02-29 to
2022-03-01, moving the cutoff a day later and deleting a day of messages **early**.
Deleting someone's message before you promised to is the failure worth five lines.

The predicate is `createdAt < cutoff`, the literal reading of "older than 24
months" — unlike `session:prune`, where `expiresAt` is a deadline and the instant
itself counts as expired. A row exactly 24 months old goes on the next monthly run.

### This is the only prune that is a correctness mechanism

`session:prune` and `ratelimit:prune` are housekeeping — #23 and #19 already make
a stale row harmless. Nothing else in the system enforces the retention promise:
if `contact:prune` stops running, the promise quietly becomes false while
`/privacy` still states it. `docs/ops-jobs.md` says so where an operator will read
it, because a failed run here is a broken commitment, not a missed cleanup.

### The log carries the count and the cutoff, and nothing else

#36 asks for a count rather than the rows, and the reason is not brevity: a
`ContactMessage` is a name, an email address and free text a stranger typed.
Logging those _because_ of a privacy policy would copy them to a log shipper with
no retention policy at all. The cutoff is a month boundary, not a row — safe to
log, and the only way to tell a run that found nothing from a run that computed
the wrong window.

### Audit finding: an address can arrive under a key that does not name one

`src/lib/logger.ts` redacts by key, and key-based redaction cannot see what it
cannot name. `mail.ts` logs `reason: cause.message` on the SMTP path, and a mail
server routinely quotes the address it rejected — `550 5.1.1
<visitor@example.com>: recipient rejected`. That address is the visitor's
reply-to, and it reached the log under the key `reason`, which is not an email
key. `redact` now masks email-shaped substrings in any string value and in
`Error.message`, keeping the domain (the debuggable half) and dropping the local
part, exactly as the existing `maskEmail` does.

**Not** extended to IP-shaped substrings, deliberately. The only IP-shaped strings
that reach a log line here come from driver errors naming our own database host —
`Can't reach database server at 127.0.0.1:55466` — which is the useful half of the
message. A client address is hashed at the single place it is read and never
travels as a string. Masking both would cost real debugging information to fix a
leak that does not exist. There is a test asserting that line survives untouched.

### The rest of the audit came back clean

- `ContactMessage.ipHash` and `Session.ipHash` are the only IP columns, both
  salted SHA-256 (`hashIp`, `IP_HASH_SALT`). No raw-address column exists.
- `clientIpFrom()` is called at exactly two sites — `api/contact.ts` and
  `admin/login.astro` — and its result is passed straight into `hashIp()` on the
  same line. The raw address is never bound to a variable that outlives the call.
- `messages.ts` selects `ipHash` out of the admin list on purpose (already
  commented there).
- 38 `logger.*` call sites; none passes an email address or an IP under any key.

## Verified

Live, against the built server and real Postgres:

| Check                                  | Result                                                  |
| -------------------------------------- | ------------------------------------------------------- |
| `/privacy`                             | **200**, CSP and security headers intact                |
| footer link on `/`, `/privacy`, `/404` | present on each, exactly one                            |
| keyboard reach from `/`                | **15 Tab presses**, `outline: 2px solid rgb(0,206,209)` |
| keyboard reach from `/privacy`         | **8 Tab presses**, same ring                            |
| axe-core on `/privacy`                 | **0 violations**                                        |
| retention figure on the page           | "deleted after 24 months (2 years)" — from the constant |
| built client bundle                    | 3 files, no server module reachable                     |

The job, against seeded rows at 30 / 25 / 23 / 1 months:

```
{"job":"contact:prune","deleted":2}   # 30mo and 25mo
{"job":"contact:prune","deleted":0}   # second run, same instant
survivors: 23mo, 1mo
2026-08-27T14:32:57.047Z INFO  job: contact:prune {"deleted":2,"cutoff":"2024-08-27T14:32:56.964Z"}
```

Mutation results — each mutation asserted to have applied, with a control:

| Mutation                                   | Tests failed |
| ------------------------------------------ | ------------ |
| retention window 24 → 12                   | 5            |
| drop the 29-February clamp                 | 1            |
| prune deletes nothing                      | 4            |
| prune deletes the wrong side of the cutoff | 3            |
| unregister `contact:prune`                 | 2            |
| log the rows instead of the count          | 1            |
| add one extra field to the log line        | 1            |
| drop the log line entirely                 | 1            |
| drop email masking in free text            | 3            |
| drop email masking in `Error.message`      | 1            |
| comment-only change (control)              | **0**        |

"Log the rows instead of the count" **survived the first round**: the assertion
covered the job's return value, not what reached the stream. The test now spies on
`process.stdout` and pins the context to exactly `{deleted, cutoff}` — a substring
search cannot catch a field nobody thought of.

Gate, re-run after the last edit: `typecheck` 0 errors / 0 warnings / 0 hints ·
`lint` PASS · `test` **478 passed, 115 skipped** · `test:integration` **115
passed** (9 files, real Postgres/Mailpit/MinIO) · `build` PASS.

Not run: `test:e2e` — #39 has not landed.

## Blocked

Nothing.

## Next

- **`/privacy` is not in `sitemap.xml`.** It is a linked public page and belongs
  there. Left out because #34 owns the sitemap and its integration test pins the
  entry set; a one-line change plus a test update, in that PR's lane not this one.
- **Pre-existing, unrelated to this change:** axe reports one serious
  `color-contrast` violation on `/` — the decorative rank watermark
  (`.text-[96px]`, `opacity-10`, 1.22:1). It is presentational and
  `pointer-events-none`, but it is not hidden from the accessibility tree, which
  is why axe counts it. Belongs to #43's sweep or a fix on the component.
- **CI still runs a bare `pnpm test`** with no Postgres service, so the six
  `contact:prune` integration tests here are skipped on the green tick. Open since
  #19.

## Content TODOs

None. The privacy note is final copy, not placeholder — it makes factual claims
about this system, and every claim in it is true of the code as merged.
