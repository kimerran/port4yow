# 30 · Contact message inbox

## Done

- `GET /admin/messages` — inbox, newest first, filterable by status.
- `GET /admin/messages/[id]` — the message, its delivery state, triage.
- Undelivered messages surfaced at the top of the inbox and on the message.
- `setMessageStatus` action, session and origin re-checked.

## Changed

| File                                   | Why                                            |
| -------------------------------------- | ---------------------------------------------- |
| `src/lib/messages.ts`                  | new — queries, counts, `isUndelivered`, triage |
| `src/pages/admin/messages/index.astro` | new — the inbox                                |
| `src/pages/admin/messages/[id].astro`  | new — the message                              |
| `src/actions/index.ts`                 | `setMessageStatus`                             |
| tests                                  | 8 unit + 9 integration                         |

## Decisions

**`isUndelivered` is derived, never stored.** #22 answers 200 even when the send
fails — the message is safely in the database and the visitor should not be told
otherwise — so a failed send leaves **no status behind**. The only evidence is a
null `deliveredAt` on a message that was supposed to be emailed, which makes this
the single place a lost notification becomes visible to a human.

**SPAM is excluded from it.** No mail is attempted for spam, so a null
`deliveredAt` there is the expected state rather than a failure. Counting it
would report a delivery problem that never happened, and an inbox that cries wolf
gets ignored — which would hide the real failure among the noise.

**`ipHash` is not selected by anything this screen reads.** SPEC §14.10 keeps a
salted hash so it can be _compared_ for anomaly review, not displayed. A value on
a screen is a value in a screenshot, so the narrow select simply omits it and a
test asserts it is absent from both the list and the detail shapes.

**Filtering is a link, not a form.** A filtered inbox is a place you can be, so
it deserves a URL you can bookmark, share and go back to. It also means the whole
screen needs no client script.

**No edit, no delete.** A stored submission is a record of something a person
sent. Triage changes how _we_ file it; it does not rewrite what they wrote.

**Nothing is logged from the message.** Not the body, not the sender's name, not
their address — AGENT §3 bans a full email address outright, and the body is
private correspondence. The log line carries an id and the new status.

## Verified

Gate re-run after the last edit: `typecheck` 0 errors / 0 warnings / 0 hints ·
`lint` PASS · `test` **407** passed, 59 skipped · `build` PASS. Integration
**59/59** across five suites.

All four acceptance criteria driven through the **real public pipeline** —
`POST /api/contact`, not hand-inserted rows, so the inbox is tested against what
#22 actually writes rather than against my idea of it:

| Criterion                                                  | Result                                                                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| A submitted message appears with the correct status        | `NEW`, delivered, filters read `All (2) New (1) Spam (1)`                                                                            |
| A honeypot submission appears as `SPAM` with no email sent | `SPAM`, Mailpit total **0**, and _not_ flagged undelivered                                                                           |
| A failed send is visibly marked undelivered                | banner `One message was saved but never emailed. It is marked below.` + one `undelivered` badge; detail reads `Delivery: never sent` |
| An HTML body renders as text, not markup                   | below                                                                                                                                |

The escaping criterion, checked as an **outcome** in a real browser rather than
by grepping the source — a body of
`<script>alert(1)</script> and <b>bold</b> …`:

```
scriptElements in the message paragraph: 0
boldElements   in the message paragraph: 0
textContent: "<script>alert(1)</script> and <b>bold</b> — twenty plus characters her…"
```

Zero elements created, the characters present as text. Astro escapes an
expression by default and neither page uses `set:html`.

Triage moved a message `NEW → READ` over HTTP and the row changed. `mailto:` is
present on the detail page; `ipHash` is not. axe: **0 violations** on both pages.

Mutation results — each asserted to have applied before its result was read:

| Mutation                            | Integration | Unit |
| ----------------------------------- | ----------- | ---- |
| never flag anything undelivered     | 2           | 3    |
| flag SPAM as undelivered            | 1           | 1    |
| select `ipHash` into the inbox view | 1           | 0    |
| order oldest first                  | 1           | 0    |
| drop the unknown-id guard           | 1           | 0    |

## A failing suite that read as a passing one

The first mutation run reported `unit:1` for **every** mutation, including ones
that could not possibly affect a unit test. That uniformity was the tell:
`messages.test.ts` was failing to **load**, not failing an assertion.
`messages.ts` imports `db` and therefore `env`, and the file had no environment
stub — so vitest reported a failed _suite_, which a harness counting "N failed"
cannot distinguish from a failed _test_.

Two things follow, and both are now in the conventions:

- a mutation harness must read a **clean baseline** before it reads a mutant;
- an identical result across unrelated mutations is evidence about the harness,
  not about the code.

With the stub added the same run separates cleanly: 3, 1, 0, 0, 0.

## Also fixed

The undelivered banner said _"1 message was saved but never emailed. **They** are
marked below."_ — plural pronoun on a singular count. Now two whole sentences
rather than an interpolated fragment, because that is how the mismatch got in.

## Blocked

Nothing blocks this issue.

## Next

- **#31** is the last of Sprint 6.
- #28 (PR #78) and #29 (PR #79) both touch `src/actions/index.ts`, as does this.
  Expect the same union resolution on whichever merges last.
- CI still runs no integration suite. Open since #19.

## Content TODOs

None.
