# 27 · Admin project CRUD, reordering, publish gating

## Done

- `GET /admin/projects` — the deck in order, with publish blockers shown inline.
- `GET /admin/projects/new` and `/admin/projects/[id]` — create and edit forms.
- Reordering, keyboard-first, writing contiguous `sequence` values.
- Publish and unpublish, gated server-side.
- Five Actions, each re-checking session **and** origin.

## Changed

| File                                  | Why                                                 |
| ------------------------------------- | --------------------------------------------------- |
| `src/lib/projects.ts`                 | new — slug rules, publish gate, reorder transaction |
| `src/lib/cache.ts`                    | new — the home-cache purge seam                     |
| `src/actions/index.ts`                | five project actions                                |
| `src/pages/admin/projects/*`          | list, create, edit                                  |
| `src/scripts/project-reorder.ts`      | new — drag/keyboard enhancement                     |
| `src/lib/__tests__/projects*.test.ts` | new — 34 unit + 15 integration                      |

## Decisions

**Reordering takes two passes inside one transaction.** `Project.sequence` is
`@unique`, and the index Prisma creates is not `DEFERRABLE`, so Postgres checks
it **per statement** — moving project A onto project B's number raises a
violation immediately, transaction or not. The first pass parks every row at a
negative sequence (a range no real row occupies), the second writes the final
1..n. Measured: removing the parking pass fails **3** integration tests with a
unique-constraint violation, which is exactly the failure the design avoids.

**A reorder must name every project.** The final pass assigns 1..n; any project
left out keeps a sequence very likely inside that range, so a partial reorder
either collides or silently produces duplicate ordering. Refusing is the
difference between a failed reorder and a corrupted one.

**Whitespace is not content in the publish gate.** A body of `"   "` passes a
`!== ""` check and publishes an empty page. `publishBlockers` trims.

**`cover` and `coverAltText` are never both reported.** "Add a cover, and also
fill in its alt text" is nonsense when there is no cover to fill anything in on.

**Every mutation is a form-accepting Action.** `accept: "form"` means Astro
handles the POST with **no JavaScript at all** — the forms work without the
enhancement script, which is what keeps the keyboard path whole. Repeated
`orderedIds` inputs map onto `z.array()` via `getAll`, preserving document order,
so the DOM order _is_ the submitted order with no parser in between for an
ordering bug to hide in.

**`requireAdmin` does origin and session together.** #27 requires both on every
mutation. Two helpers means an action can call one and miss the other, and the
miss is invisible until someone posts cross-site. Origin is checked first, so a
cross-site request cannot learn whether a session exists.

**Optional fields are `.nullable()` with a default, never `.optional()`.** This
project runs `exactOptionalPropertyTypes`, where an `undefined` spread into a
Prisma `create`/`update` is a type error — and always-present values remove the
"clear, or leave alone?" ambiguity, which for an edit form is always "clear".

**`z.url()`, not `z.string().url()`** — deprecated in zod 4.

## Verified

Gate re-run after the last edit: `typecheck` 0 errors / 0 warnings / 0 hints ·
`lint` PASS · `test` **399** passed, 50 skipped · `build` PASS. Integration
**50/50** across four suites.

| Acceptance criterion                                                             | Result                                                                                                                         |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Publish refused when a required field or cover alt text is missing               | `POST publishProject` → **400** `Not ready to publish: cover`, status stays `DRAFT`; every field covered, plus whitespace-only |
| Reordering 5 projects leaves sequences contiguous and unique, in one transaction | 1,2,3,4,5 after a full reversal, a repeated reversal, and a move-to-front                                                      |
| Reordering fully operable from the keyboard                                      | see below                                                                                                                      |
| Publishing purges the home cache and the project appears publicly                | `/work/proj-1` **200**, home lists it, `/work/proj-2` (draft) **404** — cache caveat below                                     |
| Editing a published project cannot change its slug                               | **400** `A published project keeps its slug.`, slug unchanged in the database                                                  |

Keyboard reorder, driven entirely by real key events in a browser:

```
order before: Project 1 | Project 2 | Project 3 | Project 4 | Project 5
focused: "Move Project 5 up" (row 5) after 21 Tab presses
3 × Enter
order after : Project 1 | Project 5 | Project 2 | Project 3 | Project 4
announced   : "Project 5 moved to position 2."
focus stayed on the moved item: true
after save  : same order, persisted
database    : 1 Project 1 | 2 Project 5 | 3 Project 2 | 4 Project 3 | 5 Project 4
```

No pointer was used at any point. Focus follows the _item_, not the position —
without that, a second press moves whichever project has slid under the cursor,
and a keyboard user has no way to notice.

axe: **0 violations** on the list, the edit form and the create form.

Mutation results:

| Mutation                                        | Integration | Unit  |
| ----------------------------------------------- | ----------- | ----- |
| publish without consulting the gate             | 7           | —     |
| remove all reorder completeness guards          | 3           | 0     |
| drop the parking pass (naive single-pass swap)  | 3           | 0     |
| treat whitespace as content in the publish gate | 0           | **5** |
| stop requiring cover alt text                   | 1           | —     |
| allow a published slug to change                | 0           | **1** |

**Client bundle:** 0 files for `prisma`, `argon2`, `passwordHash`,
`publishProject`, `reorderProjects`, `DATABASE_URL`.

## A bug found by testing, not by reading

The reorder form posted to `/admin/projects/reorder` — **an endpoint that does
not exist**. An earlier edit meant to point it at the Action had silently not
applied: Prettier had reformatted the form across several lines, so the string I
was replacing no longer matched, and the replace was a no-op. Every gate stayed
green, because nothing typechecks a form's `action` attribute.

It surfaced only when the browser test's "save" step produced the wrong order —
the submit button was never found, so Enter re-triggered the still-focused move
button. Worth recording twice over: a green build proves nothing about a form
target, and a test that checks the _end state_ rather than the click is what
caught it.

## Known gap — the cache is not actually purged

SPEC §5 says the home cache "is purged on any project mutation". **Nothing in
the stack can do that.** SPEC §13 deploys `web`, `postgres` and `minio` on
Railway and names no CDN, so there is no purge API to call. The home page is
served `s-maxage=300, stale-while-revalidate=86400`, so a shared cache in front
of the app may serve a pre-publish copy for **up to 5 minutes** after publishing.

`purgeHomeCache()` is the seam where a real purge goes, and it logs
`performed: false` with the reason rather than pretending:

```
home cache purge requested {"reason":"project published","performed":false,
  "note":"no CDN purge API in the stack (SPEC §13); s-maxage=300 applies"}
```

The acceptance criterion "publishing purges the home cache" is therefore **not
met as written** — the project does appear publicly, immediately, on a direct
request. Resolving it needs either a CDN with a purge API or an amendment to §5.

## Blocked

Nothing blocks this issue.

## Next

- **#28** is the upload pipeline. Until it lands, the cover picker only lists
  `MediaAsset` rows that already exist, so publishing needs a seeded cover.
- The Markdown body has no live preview — #27 lists one under scope. It is a
  client-side nicety on a page that currently ships no script; worth deciding
  whether it earns one, or whether the public page is the preview.
- The image gallery editor (captions, alt text per image) is also unbuilt for
  the same reason: it needs #28's uploads to have anything to attach.
- CI still runs no integration suite. Open since #19.

## Content TODOs

None.
