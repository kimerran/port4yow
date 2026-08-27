# Scheduled jobs

SPEC §11's three jobs plus SPEC §14.10's retention prune, invoked by Railway
cron. Each runs through one entry
point so they share an exit-code contract: **0** on success, **1** on failure,
**2** for an unknown job name. Railway records a non-zero exit as a failed run,
which is the only signal a schedule gives you.

```
pnpm job session:prune
pnpm job ratelimit:prune
pnpm job media:orphans
pnpm job contact:prune
```

## Railway cron services

Each job is a **separate Railway cron service** pointed at this repo, sharing the
`web` service's `DATABASE_URL` over the private network. Railway's schema has no
`cron` key — `railway.json` configures the web service's build, start and health
check only — so these are set in the service's own settings.

| Service                | Schedule (UTC) | Start command              |
| ---------------------- | -------------- | -------------------------- |
| `cron-session-prune`   | `0 3 * * *`    | `pnpm job session:prune`   |
| `cron-ratelimit-prune` | `0 * * * *`    | `pnpm job ratelimit:prune` |
| `cron-media-orphans`   | `0 4 * * 1`    | `pnpm job media:orphans`   |
| `cron-contact-prune`   | `0 5 1 * *`    | `pnpm job contact:prune`   |

`media:orphans` runs weekly on Monday at 04:00, after the daily session prune, so
a week's reports land at a predictable time. `contact:prune` runs monthly on the
1st at 05:00 — monthly is what SPEC §14.10's window needs, and a message is at
most a month past 24 months when it goes.

## What each job does, and what it deliberately does not

**`session:prune`** deletes `Session` rows past `expiresAt`. It is _not_ what
makes an expired session invalid — #23 deletes one lazily the moment it is
presented, and `validateSession` refuses it regardless. This only stops the table
growing with sessions nobody will present again.

**`ratelimit:prune`** deletes expired `RateLimit` rows. Also not a correctness
mechanism: #19's counter resets an expired window in the same statement that
increments it, so a stale row is already harmless. Without this the table
accumulates a row per IP per hour forever.

**`media:orphans` reports and never deletes.** SPEC §11 says so, and the data
model shows why it must: #28 writes **one row per derivative** — eight for a
typical upload — while a project references exactly one of them as its cover. So
seven of eight rows belonging to a live, published image are unreferenced _by
design_. A job that deleted "unreferenced rows" would delete most of the site's
images. The report groups by key stem and flags a group only when **nothing** in
it is referenced, and even then it only prints: deciding an image is genuinely
unused is a judgement about intent, and the cost of being wrong is an image
nobody can get back.

**`contact:prune` is the only one of these that is a correctness mechanism.** The
other three are housekeeping — #23 and #19 already make a stale row harmless, and
the orphan report changes nothing at all. This one is different in kind: the
privacy note at `/privacy` states that contact messages are deleted after 24
months, and **nothing else in the system enforces that**. If this schedule stops
running, the promise quietly becomes false while every page still says otherwise.
Treat a failed run here as a broken commitment, not a missed cleanup.

Its window is whole calendar months, not 730 days, because that is what the note
says — and the cutoff clamps to the last day of the target month so a message
sent on 29 February is not deleted a day early. The job logs the count and the
cutoff and never the rows: a `ContactMessage` is a name, an email address and
free text a stranger typed, and logging those _because_ of a privacy policy would
copy them to a log shipper with no retention policy at all.

## Idempotence

Every job is a **predicate over current state** — "delete rows already past their
expiry", "list rows nothing references" — rather than a step in a sequence.
Running one twice re-evaluates the predicate and the second run finds nothing to
do. That is why none of them takes a cursor, a watermark or a last-run
timestamp: state like that is exactly what makes a re-run behave differently from
a first run.

## Verifying a schedule fired

`pnpm job <name>` prints one JSON line to stdout and Railway captures it:

```
{"job":"session:prune","deleted":4}
{"job":"media:orphans","found":1,"keys":["projects/abc/01ORPHAN"]}
{"job":"contact:prune","deleted":2}
```

A run that logs nothing did not happen.
