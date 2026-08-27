# 20 · Mail wrapper — Resend in production, Mailpit in dev

## Done

- `src/lib/mail.ts` — one wrapper, two backends.
- Every user-supplied value escaped before it reaches the HTML body (SPEC §14.6).
- Idempotency keyed on `ContactMessage.id`, enforced on both backends.
- Never throws into the request path; failures log at `error` with a correlation id.
- `RESEND_ENABLED=false` delivers to Mailpit and nothing leaves the machine.

## Changed

| File                             | Why                                                            |
| -------------------------------- | -------------------------------------------------------------- |
| `src/lib/mail.ts`                | new — the wrapper                                              |
| `src/lib/__tests__/mail.test.ts` | new — escaping, headers, idempotency, failure                  |
| `src/lib/env.ts`                 | `SMTP_URL`                                                     |
| `.env.example`                   | documents `SMTP_URL`                                           |
| `package.json`                   | `resend@6.24.0`, `nodemailer@9.0.5`, `@types/nodemailer@8.0.1` |

Versions resolved with `pnpm view` and installed with `@latest` (AGENT §1.1);
none hand-written.

## Decisions

**`SMTP_URL` is a new environment variable, and it is not in SPEC §10.** §10 says
"false in dev → log to console / Mailpit instead" without naming a host, and #20
requires the Mailpit path to work. It defaults to the compose file's
`smtp://localhost:1025` so `cp .env.example .env` still boots, and it is a
variable rather than a constant so a CI container or a non-default compose file
can point at its own sink. **Wants adding to SPEC §10.**

**Idempotency is enforced on two levels, because one is not enough.** Resend's
`idempotencyKey` collapses a retry provider-side — but only on the Resend path.
SMTP has no such concept, so a retried send would simply put a second copy in
the inbox, and the acceptance criterion says "one email". So the module also
reads `ContactMessage.resendId` before dispatch and returns the existing id when
one is present. That check is durable across a process restart, which an
in-memory set would not be. The Resend key still earns its place: it covers the
crash window between sending and persisting, which the durable check cannot see.

The check lives in this module rather than in the caller on purpose — "sending
twice with the same id results in one email" is a property of the mail wrapper,
and a caller that forgets the check should not be able to break it.

**Headers are CRLF-stripped.** A `\r\n` in a header value injects additional
headers — the classic hole that turns a subject into a Bcc. Neither Resend nor
nodemailer should let it through, but the boundary is ours (AGENT §3).

**Only `error.message` is logged from a Resend failure.** The SDK's error object
can carry the request that produced it, and that request carries the
`Authorization: Bearer <key>` header. SPEC §14.8 says the key never reaches a log
line. See the mutation table — this had no test until the mutation run found it.

**Plain text is deliberately unescaped.** There is no markup for it to escape
into, and escaping it would show `&lt;` to a human reading the text part.

## Verified

Gate re-run after the last edit: `typecheck` 0 errors / 0 warnings / 0 hints ·
`lint` PASS · `test` **192** passed (10 files) · `build` PASS.

Against a live Mailpit and a real `ContactMessage` row:

| Acceptance criterion                                            | Result                                                                                                                       |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `<script>alert(1)</script>` as a name arrives escaped           | delivered HTML contains `&lt;script&gt;alert(1)&lt;/script&gt;`, no raw `<script>`                                           |
| `RESEND_ENABLED=false` delivers to Mailpit, zero outbound calls | delivered; the Resend client is never constructed on this path                                                               |
| Built client bundle has no `RESEND` / key reference             | **0 files** for `RESEND`, `resend`, `nodemailer`, `CONTACT_TO_EMAIL`, `SMTP_URL`, `api.resend.com` across all 6 client files |
| Sending twice with the same id → one email                      | Mailpit inbox total: **1**                                                                                                   |

Delivered HTML, straight out of Mailpit:

```html
<p>
  <strong>From:</strong> &lt;script&gt;alert(1)&lt;/script&gt;
  &lt;ada@example.com&gt;
</p>
<p>Line one<br />Line &lt;b&gt;two&lt;/b&gt;</p>
```

`Reply-To: ada@example.com`, `Message-Id: cm_e2e@mh.neri.ph`, from
`hello@mh.neri.ph`, to `inbox@mh.neri.ph`.

Mutation results:

| Mutation                              | Tests failed |
| ------------------------------------- | ------------ |
| stop escaping the message body        | 5            |
| stop escaping the name                | 1            |
| drop the `&` escape (double-escaping) | 1            |
| stop stripping CRLF from headers      | 2            |
| drop the durable idempotency guard    | 2            |
| drop Resend's `idempotencyKey`        | 1            |
| log the whole Resend error object     | **0 → 1**    |

The last row is the useful one. Logging the entire Resend error object — which
can carry the API key — failed **no** tests, because the only "no secret in
logs" test exercised the SMTP failure path. Added a test that drives the Resend
error path with a key-bearing error object; the mutation now fails 1.

**Honest scope note on the bundle audit:** nothing imports `mail.ts` yet, so a
clean client bundle is expected rather than earned. The check becomes meaningful
when #22 wires the route, and it should be repeated there.

## Blocked

Nothing blocks this issue.

## Next

- #22 (`POST /api/contact`) is the first caller: persist the `ContactMessage`,
  call `sendContactEmail`, then write `resendId` / `deliveredAt` from the result.
  A `{ ok: false }` persists as undelivered and still answers the submitter.
- Re-run the client-bundle grep once #22 imports this module.
- Add `SMTP_URL` to SPEC §10.

## Content TODOs

None.
