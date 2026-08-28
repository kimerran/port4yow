# #82 — split `saveSetting` into four actions

SPEC §6 · Refs #81, #31

## Done

`saveSetting` returned `{ ok: false, key, message }` for a domain refusal
instead of throwing, which every other action in this codebase does. The
consequence #82 names: **a rejected setting answered HTTP 200**.

Replaced with `saveHeroThesis`, `saveAboutBody`, `saveGithubUrl` and
`saveLinkedinUrl`, sharing the validator already in `src/lib/settings.ts`.

## Why the old shape existed, and why splitting dissolves it

It was not carelessness. `/admin/settings` bound **four forms to one action**,
and `Astro.getActionResult` returns a single result per action with no record of
which input produced it — so a thrown error rendered under all four fields,
while #31 requires the message beside the field it is about. Returning the key
alongside the verdict was the only way to attribute it.

Four actions remove the constraint rather than working around it. Each form has
its own result, so **attribution is structural**: the message lands under the
right field because it cannot land anywhere else. No key threading, no `ok`
flag, and the throwing convention is restored.

The four handlers are one line each. There is still exactly one validator.

## The input cap is a ceiling, not the limit

`input: z.object({ value: z.string().max(5000) })` — deliberately not the
per-key maximum. `SETTING_DEFINITIONS` holds that, and `validateSetting` reports
it in brand voice:

```
That is 250 characters. Hero thesis holds 220.
```

Putting the real limit in Zod would replace that with Astro's generic 400 and
lose #31's message. So a 250-character hero thesis must pass the schema and fail
the validator, and `schemas.test.ts` asserts exactly that.

## Changed

| File                                                 | What                                                                 |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| `src/actions/index.ts`                               | four actions + shared `persistSetting`; `saveSetting` removed        |
| `src/pages/admin/settings.astro`                     | one action per form; per-form result; the hidden `key` input is gone |
| `src/actions/__tests__/settings.integration.test.ts` | new — 11 tests against real Postgres                                 |
| `src/actions/__tests__/schemas.test.ts`              | the four schemas, including the ceiling-vs-limit case                |
| `src/__tests__/state-changing-routes.test.ts`        | enumeration follows the rename                                       |

`ACTION_FOR` maps a setting key to its action **in the page**, not in
`SETTING_DEFINITIONS`: `src/lib/settings.ts` must not import `astro:actions`, a
virtual module only Astro's build resolves, because tests import that library
outside the build.

## Verified

Against a built server, signed in, same-origin — the four refusals #82 lists,
which it verified were 200 before:

| value                           | before | after                                                    |
| ------------------------------- | ------ | -------------------------------------------------------- |
| `javascript:alert(1)`           | 200    | **400** `Use a full https:// URL.`                       |
| `http://github.com/kimerran`    | 200    | **400** `Use a full https:// URL.`                       |
| `https://evil.example/kimerran` | 200    | **400** `GitHub URL should point at github.com.`         |
| `//github.com/kimerran`         | 200    | **400** `That does not look like a full URL.`            |
| 250-character hero thesis       | 200    | **400** `That is 250 characters. Hero thesis holds 220.` |

All four happy paths return 200 and write.

**#31's requirement still holds** — checked by driving the real page, because
that is the constraint the old shape existed to satisfy and the only thing that
could have regressed. Submitting `https://evil.example/kimerran` in the GitHub
form:

```
hero.thesis      aria-invalid=null   error=null                                    action=saveHeroThesis
about.body       aria-invalid=null   error=null                                    action=saveAboutBody
social.github    aria-invalid=true   error="GitHub URL should point at github.com." action=saveGithubUrl
social.linkedin  aria-invalid=null   error=null                                    action=saveLinkedinUrl
```

One field marked, one message, three untouched. The success path attributes the
same way — `Saved.` appears under `social.github` alone.

## Mutations, and the gap they found

The first pass ran against the unit suite and **two mutations survived** — the
two that matter most:

| Mutation                                                     | Unit suite only | With the integration tests |
| ------------------------------------------------------------ | --------------- | -------------------------- |
| `saveGithubUrl` writes the `social.linkedin` key             | **0 fail**      | **2 fail**                 |
| `persistSetting` returns `{ ok: false }` instead of throwing | **0 fail**      | **6 fail**                 |
| drop `saveLinkedinUrl` entirely                              | 5 fail          | 5 fail                     |
| `saveHeroThesis` drops `requireAdmin`                        | 1 fail          | 1 fail                     |
| `value` accepts a non-string                                 | 2 fail          | 2 fail                     |
| comment-only change (control)                                | **0**           | **0**                      |

The second row **is the defect this issue exists to fix**, and the schema tests
could not see it: an input schema says nothing about what the handler does with
the value. So `settings.integration.test.ts` asserts the handler and the row it
writes — each action writes its own key and only that key, a refusal throws
`BAD_REQUEST` and writes nothing, a refused write leaves the previous value
intact, and every action refuses a cross-origin caller.

One correction inside that file: the cross-origin loop first used a `WIRING`
table containing a typo'd action name, guarded by `if (!actions[name]) continue`
— so it quietly covered three actions instead of four. The guard is now an
assertion, and a name that does not resolve fails rather than skips.

## Gate

`typecheck` 0 errors / 0 warnings / 0 hints · `lint` PASS · `test` **785 passed,
126 skipped** · `test:integration:ci` **all 126 ran, none skipped** · `build`
PASS · `test:e2e` **101 passed, 10 skipped**.

The new integration file needed no registration — #38's derived gate list picked
up `SETTINGS_IT` from the file itself, which is the mechanism working as
intended.

## Blocked

Nothing.

## Next

Nothing outstanding. The `ok` field on the success return is now the only
remnant of the old shape; it is harmless and the page reads it, but a future
change could drop it for a bare `void` return like the other mutating actions.

## Content TODOs

None.
