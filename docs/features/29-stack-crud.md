# 29 · Admin StackItem CRUD

## Done

- `GET /admin/stack` — create, rename, re-suit, feature, reorder, delete.
- Ordering within a suit, keyboard-first, in one `$transaction`.
- Duplicate names refused in the interface's voice, never a Prisma error.
- Deleting an in-use item names the projects and states the consequence.

## Changed

| File                                          | Why                                                 |
| --------------------------------------------- | --------------------------------------------------- |
| `src/lib/stack.ts`                            | new — the operations                                |
| `src/scripts/list-reorder.ts`                 | new — shared reorder, replaces `project-reorder.ts` |
| `src/pages/admin/stack.astro`                 | new — the screen                                    |
| `src/pages/admin/projects/index.astro`        | adopts the shared reorder contract                  |
| `src/lib/suits.ts`                            | `SUIT_ENUM_VALUES`, derived from `SUITS`            |
| `src/actions/index.ts`                        | four stack actions                                  |
| `src/lib/__tests__/stack.integration.test.ts` | new — 17 tests                                      |

## Decisions

**The reorder script is now one module, not two.** #29 needed #27's behaviour
with a different selector. Copying the file would have left two implementations
of one rule, and the copy that drifts is always the one nobody is looking at —
the exact failure this codebase already hit with the origin check (#25) and the
`toActionError` mapper (#28). `project-reorder.ts` is deleted;
`list-reorder.ts` drives both lists from a `data-reorder-list` contract.

Refactoring a working feature inside another issue is a real cost, so the
projects list was re-verified in a browser afterwards — see below.

**No parking pass in this reorder.** Unlike #27's projects, `StackItem.sortOrder`
is **not** `@unique`, so intermediate duplicates are legal and one pass is safe.
Still a `$transaction`, so a failure leaves the previous order intact rather than
half-applied. Worth stating explicitly, because the two reorders look alike and
the reason they differ is a schema detail.

**`SUIT_ENUM_VALUES` is derived from `SUITS`.** A second hand-written list of the
same four values drifts, and the one that drifts is the one nobody renders.

**Changing suit moves the item to the end of its new one.** Carrying the old
`sortOrder` across drops it into an arbitrary position mid-list, which reads as a
bug rather than a move.

**Duplicate names are caught by code, not by message.** `name` is `@unique`, so a
collision arrives as Prisma `P2002` — a sentence about a constraint on a column,
which tells the admin nothing they can act on. It becomes `"Postgres" is already
in the stack.` A test asserts the response contains no `P2002`, `Unique
constraint` or `prisma` anywhere.

**Delete: the impact is in the button, and the server still refuses.**
`ProjectStack` cascades on `stackItemId`, so deleting silently strips the item
from every project listing it. #29 asks for the count surfaced before confirming.
The button says `Delete — also removes it from 2 projects`, which is a better
confirmation than a dialog nobody reads; `confirmed` rides along because the
admin has been told. The **server independently refuses an unconfirmed delete of
an in-use item**, which is what protects a caller posting without that label in
front of them — the case a UI-only confirmation misses.

## Verified

Gate re-run after the last edit: `typecheck` 0 errors / 0 warnings / 0 hints ·
`lint` PASS · `test` **399** passed, 67 skipped · `build` PASS. Integration
**67/67** across five suites.

| Acceptance criterion                                             | Result                                                                                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Create / rename / reorder / delete persist                       | all four exercised over HTTP against the database                                                                    |
| Duplicate name returns a brand-voiced error, never a stack trace | **400** `"Astro" is already in the stack.` — `0` occurrences of `P2002`/`Unique constraint`/`prisma` in the response |
| Public "The stack" reflects changes                              | after the admin edits: `Astro 7, Fly.io, Docker` — the renamed item, in the new order                                |
| Keyboard-accessible ordering                                     | below                                                                                                                |

Keyboard reorder on the CLUBS list, real key events only:

```
list CLUBS before: Docker | Fly.io
focused "Move Fly.io up" after 28 Tab presses
after move: Fly.io | Docker
announced (this list's region): "Fly.io moved to position 1."
after save: Fly.io | Docker            ← persisted
```

Rename plus suit change, over HTTP: `Astro` → `Astro 7`, `CLUBS` → `SPADES`, and
it lands at `sortOrder 0` in its new suit rather than keeping position 3.

In-use delete: unconfirmed → **400** `That item is listed by Project 1. Deleting
it removes it from that project too — submit again to confirm.` Confirmed → 200,
`StackItem` gone, its `ProjectStack` row gone with it, the project untouched.

**The projects list still reorders after the refactor**, driven by the shared
script:

```
list projects before: Project 1 | Project 2 | Project 3
after move: Project 1 | Project 3 | Project 2   ← persisted, sequences 1,2,3
```

axe: **0 violations** on `/admin/stack` and on `/admin/projects`.

Mutation results — each one asserted to have applied before its result was read:

| Mutation                                       | Tests failed |
| ---------------------------------------------- | ------------ |
| drop the reorder completeness guards           | 2            |
| let a raw Prisma P2002 escape on create        | 1            |
| delete an in-use item without confirming       | 1            |
| keep the old `sortOrder` when the suit changes | 1            |
| reorder across all suits, not just one         | 1            |

## A test that lied, and why

The first keyboard run reported the order unchanged after saving, an empty
announcement, and three hidden inputs for a two-item list. All three were the
**test's** fault: the stack screen renders one list _per suit_, and my selectors
spanned every list on the page — so I moved an item in CLUBS, then submitted
SPADES' form and read SPADES' live region.

Scoping the harness to one `data-reorder-list` showed the feature had been
correct all along. This is the fourth instrument error this sprint (#25, #27,
#28, now here); the pattern is that a measurement across the wrong scope reads
exactly like a broken feature.

## Blocked

Nothing blocks this issue.

## Next

- **#28** (PR #78) also touches `src/actions/index.ts`. This branch adds four
  more actions and one more `toActionError` clause, so expect the same small
  append conflict — resolvable as a union, as #28's own merge was.
- #30 and #31 complete Sprint 6.
- CI still runs no integration suite. Open since #19.

## Content TODOs

None.
