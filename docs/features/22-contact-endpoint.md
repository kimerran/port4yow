# 22 · POST /api/contact

## Done

- The full SPEC §7 pipeline: origin → rate limit → Zod → honeypot/timing →
  persist → send.
- Accepts `application/json`, `x-www-form-urlencoded` and `multipart/form-data`
  — the last two are #21's two client paths.
- Response shapes exactly as #22 lists them, with `no-store` on all of them.
- Opt-in integration suite: **18 tests** against real Postgres and real Mailpit.

## Changed

| File                                                  | Why                                                |
| ----------------------------------------------------- | -------------------------------------------------- |
| `src/pages/api/contact.ts`                            | new — the handler                                  |
| `src/pages/api/__tests__/contact.integration.test.ts` | new — #22's acceptance list                        |
| `package.json`                                        | `test:integration` now runs #19's and #22's suites |

## Decisions

**The honeypot is not a Zod error, and the spec contradicts itself here.** SPEC
§7's `ContactSchema` has `company: z.string().max(0)`, which makes a filled
honeypot a _validation failure_ — a field-keyed 400 naming `company`. Step 4 of
the same section says a caught bot gets "the same 200 success shape as a real
submission … Never tell a bot it was caught." A 400 naming `company` tells it
exactly what caught it.

So `company` is lenient in the schema and evaluated in step 4, where the spec
defines the behaviour. Every other field and every error string is verbatim from
§7. **Measured:** restoring the literal `max(0)` fails the honeypot acceptance
test. Worth resolving in the spec rather than leaving the two halves at odds.

**A forged, too-fast or stale token takes the spam path, not a 400.** Same
reasoning: telling a bot its token was rejected tells it what to fix. All four
`verifyFormToken` failure reasons are logged (for tuning the thresholds) and all
four answer 200.

**Origin is checked explicitly even though `checkOrigin` is on.** SPEC §14.4 asks
for both, and the framework setting is a backstop a future config change could
remove silently. A request with _neither_ `Origin` nor `Referer` is refused
rather than allowed — browsers send `Origin` on cross-origin POSTs, so absence
means a non-browser client (AGENT §1.5).

**The IP is hashed on the line it is first used.** `hashIp(clientAddress)` feeds
both the rate limiter and the persisted row, so no raw address exists past that
point, and nothing logs it.

**No delivery bookkeeping in the route.** #20's wrapper owns `resendId` and
`deliveredAt`; writing them in both places is how the two drift apart. Step 7 is
satisfied by the wrapper, and the route's job is to not undo it.

## Verified

Gate re-run after the last edit: `typecheck` 0 errors / 0 warnings / 0 hints ·
`lint` PASS · `test` **235** passed, 18 skipped · `build` PASS.

The 18 skipped are this suite plus #19's, which need a database. `pnpm
test:integration` runs both — **18/18 pass** locally.

#22's five acceptance criteria, all against real Postgres and real Mailpit:

| Criterion                                                         | Result                                                                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Happy path persists and emails                                    | 200 `{ok:true}`, row `NEW`, `ipHash` a 64-hex digest, Mailpit inbox 1                                        |
| Honeypot returns the success shape, persists SPAM, sends no email | byte-identical body to a real success, row `SPAM`, inbox **0**                                               |
| Validation failure returns the field-keyed 400                    | all three §7 strings, nothing persisted, no stack trace in the payload                                       |
| 6th request in an hour returns 429 with `Retry-After`             | 429, `Retry-After: 3600`, `retryAfter` matches the header, 5 rows and 5 emails — the refused one did neither |
| A Resend outage still returns 200                                 | real `ECONNREFUSED`, 200 `{ok:true}`, row `NEW` with `deliveredAt` null                                      |

End to end through the built server and a real browser:

| Path                    | Result                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| JavaScript enabled      | "Message sent. I'll reply soon.", button reads **Message sent**, form cleared, inbox 1, row `NEW` with `resendId` and `deliveredAt` set |
| **JavaScript disabled** | lands on `/api/contact` with `{"ok":true}`, inbox 1, row `NEW` — #21's fallback now completes, having 404'd until this issue            |
| Cross-origin            | 403, logged `contact rejected: cross-origin`, nothing persisted                                                                         |

The cross-origin result was observed accidentally first: serving on a port that
did not match `PUBLIC_SITE_URL` produced a real 403 from a real browser, which is
the control working.

Mutation results:

| Mutation                                              | Tests failed |
| ----------------------------------------------------- | ------------ |
| drop the explicit Origin check                        | 2            |
| ignore the rate limiter                               | 2            |
| honeypot as a Zod error (the spec's literal `max(0)`) | 1            |
| stop treating a bad/stale token as spam               | 4            |
| make the spam response distinguishable                | 1            |
| store the raw IP instead of the hash                  | 1            |
| 500 when the mail provider is down                    | 1            |

**Client bundle audit, now earned rather than assumed.** #20's review noted its
clean bundle was expected because nothing imported `mail.ts` yet. A server route
now does, and the client bundle is still **0 files** for `RESEND`, `resend`,
`nodemailer`, `SMTP_URL`, `api.resend.com`, `FORM_SECRET`, `IP_HASH_SALT`,
`CONTACT_TO_EMAIL` and `DATABASE_URL` across all 6 files.

### AGENT §3 route checklist

- [x] Zod at the top of the handler; no unparsed field used downstream
- [x] Origin verified on this state-changing method
- [x] Rate limited at a cost-appropriate limit
- [x] Generic brand-voiced errors; details to structured logs with a correlation id
- [x] No secret, token, hash, raw IP, or full email address in any log line —
      log lines carry `correlation_id`, `message_id`, `fields` (names only),
      `retry_after` and a spam `reason`; no user content at all
- [x] Correct response headers (`no-store` on every path, `Retry-After` on 429)
- [x] Nothing user-controlled reaches raw HTML, SQL, a shell, a path or an
      outbound URL unvalidated

## Blocked

Nothing blocks this issue.

## Next — one UX gap worth a decision

**A no-JS visitor lands on a page reading `{"ok":true}`.** #22's response table
specifies `200 {ok:true}`, and that is what ships; #21 says the no-JS path
"fully works". Both are satisfied literally, and the result is still a raw JSON
document as the visitor's confirmation page.

The fix is content negotiation — when `Accept` does not include
`application/json`, answer `303` to something like `/?sent=1` and render the
confirmation in the page. I did **not** do it here because it contradicts #22's
explicit response contract, and changing a documented response shape is a
decision rather than an inference. Recommend folding it into the same amendments
batch as SPEC §9, §7.2 and `SMTP_URL`.

Also outstanding:

- CI cannot run either integration suite until `ci.yml` gains a Postgres service
  (and a Mailpit service for this one). Flagged on #19 and still open.

## Content TODOs

None.
