# 21 · Contact form — honeypot, HMAC timestamp, no-JS fallback

## Done

- `ContactForm.astro` — a native `POST` to `/api/contact` that works with
  JavaScript disabled.
- `contact-form.ts` — progressive enhancement that keeps entered values and
  renders inline errors. The second and last client script on public pages.
- `formToken.ts` — `renderedAt` signed with `FORM_SECRET`, plus the verifier #22
  will call.
- Honeypot `company`: off-screen via CSS, `type="text"`, `tabindex="-1"`,
  `autocomplete="off"`, inside an `aria-hidden` wrapper.
- Wired into the home page's Contact (K) section.

## Changed

| File                                  | Why                                        |
| ------------------------------------- | ------------------------------------------ |
| `src/lib/formToken.ts`                | new — sign + verify the `renderedAt` token |
| `src/components/ContactForm.astro`    | new — the form                             |
| `src/scripts/contact-form.ts`         | new — progressive enhancement              |
| `src/lib/__tests__/formToken.test.ts` | new — signature and age rules              |
| `src/pages/index.astro`               | renders the form, loads the script         |

## Decisions

**The honeypot is `type="text"`, off-screen, never `display: none`.** A bot reads
the DOM, and `type="hidden"` is the one field it knows to skip — the field has to
look fillable to a script and be invisible to a person. `display: none` is nearly
as well-known a tell, so it is positioned off-screen instead. The wrapper is
`aria-hidden` and the input is `tabindex="-1"` so a keyboard or screen-reader
user is never asked to fill in the field that marks them as spam. Verified: Tab
never reaches it.

**`verifyFormToken` checks signature before age, and uses `timingSafeEqual`.**
An unsigned timestamp's age means nothing, and returning `too-fast` for a forged
token would leak that the signature was accepted. The comparison is constant-time
because a byte-by-byte early return tells an attacker how much of a candidate
signature was right, which is enough to forge one byte at a time. Lengths are
compared first, since `timingSafeEqual` throws on a mismatch.

A token from the _future_ is rejected too — its age is negative, which sails
straight past a naive `age > MIN` check.

**Signing and verifying ship together even though #22 owns verification.** A
signature scheme tested only from the signing side proves very little.

**One live region for the whole form, present from first render.** A region per
field interrupts itself when several fail at once, and a live region _added_ to
the page at the moment it gains text is frequently not announced at all.

**`FormData` over JSON in the fetch path.** The wire format is not identical to
the no-JS path — a native form POSTs `application/x-www-form-urlencoded` and
fetch with a `FormData` body POSTs `multipart/form-data`, both measured below.
What matters is that a single `await request.formData()` in #22 parses both, so
the handler has one code path. Sending JSON would have given it two, and the
no-JS path is the one nobody tests by hand.

## Verified

Gate re-run after the last edit: `typecheck` 0 errors / 0 warnings / 0 hints ·
`lint` PASS · `test` **210** passed, 4 skipped · `build` PASS.

In a real browser, with the `POST` intercepted at the network layer so nothing
depends on #22 existing yet:

| Acceptance criterion                                             | Result                                                                                                                                          |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Submits with JavaScript disabled                                 | **1** `POST /api/contact`, `application/x-www-form-urlencoded`, fields `company, email, message, name, renderedAt`, signature present           |
| A JS validation failure preserves values and announces the error | all three values intact; `aria-invalid="true"`; `aria-describedby` wired; `role="status" aria-live="polite"` reads "One field needs attention." |
| Focus visible on every field; tap targets ≥ 44×44                | see table below                                                                                                                                 |
| Public JS under 30 KB                                            | **2 230 B** (2.2 KB) raw, 1 099 B gzip                                                                                                          |

Script execution was genuinely disabled via
`Emulation.setScriptExecutionDisabled`, and the form driven with real mouse and
`Input.insertText` events — no page JavaScript involved in the no-JS run.

Keyboard focus, driven with real `Tab` key events:

| Field             | Height | `:focus-visible` | Outline                            |
| ----------------- | ------ | ---------------- | ---------------------------------- |
| `contact-name`    | 44     | true             | `2px solid rgb(0, 206, 209)` @ 2px |
| `contact-email`   | 44     | true             | `2px solid rgb(0, 206, 209)` @ 2px |
| `contact-message` | 172    | true             | `2px solid rgb(0, 206, 209)` @ 2px |
| submit            | 44     | true             | `2px solid rgb(0, 206, 209)` @ 2px |

`rgb(0, 206, 209)` is `luminous-cyan`. Tab never reaches the honeypot.

All four inputs compute to **16px** (BRAND §7 — never smaller; 16px is what stops
iOS zooming on focus). Public JS is exactly two inline module scripts —
`scroll-rail` 782 B and `contact-form` 1 448 B — matching "one of only two client
scripts on public pages". Both are Astro-processed, so CSP hashes them; the
enhancement demonstrably ran under the production CSP.

## Blocked

Nothing blocks this issue, but see below.

## Next

- **#22 is required before the form actually delivers anything.** `/api/contact`
  does not exist yet, so a real submission 404s today. The acceptance criterion
  "submits successfully with JavaScript disabled" is verified as far as this
  issue can verify it — the browser issues the correct request — and the
  round trip is #22's to close. Worth re-running the no-JS check there.
- #22 consumes `verifyFormToken`; `too-fast` and `expired` should both take the
  SPEC §7 step 4 path (same 200 shape, `status: SPAM`, no email), not a 400 —
  never tell a bot it was caught.
- The error copy the form renders on a 400 comes from #22's field map. The one
  string this component owns is the network-failure message.

## Found but out of scope

axe on the home page reports the same single pre-existing gold-contrast
violation (#65), now visible on the hero display text and the three project tile
ranks. Nothing in the form uses gold — checked: zero elements in the form
compute to `rgb(212, 175, 55)`.

## Content TODOs

None.
