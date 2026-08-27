# 28 · Media upload pipeline

## Done

- `processUpload` — size, alt text, content sniffing, checksum, sharp re-encode,
  `PutObject`, one `MediaAsset` row per derivative.
- `sniffImageType` — a four-format allowlist read from magic bytes.
- `GET /admin/media` — grid grouped by key stem, upload, edit alt text, delete.
- Three Actions, each re-checking session and origin; upload additionally rate
  limited.

## Changed

| File                          | Why                                                       |
| ----------------------------- | --------------------------------------------------------- |
| `src/lib/imagetype.ts`        | new — the sniffer                                         |
| `src/lib/upload.ts`           | new — the pipeline                                        |
| `src/lib/storage.ts`          | `putObject`, `deleteObject`                               |
| `src/actions/index.ts`        | upload / alt text / delete, plus origin in `requireAdmin` |
| `src/pages/admin/media.astro` | new — the library                                         |
| tests                         | 24 unit + 12 integration                                  |

Dependencies resolved with `pnpm view` and installed `@latest` (AGENT §1.1):
`sharp@0.35.4`, `ulid@3.0.2`.

## Decisions

**The sniffer is hand-rolled, not `file-type`.** The requirement is an
_allowlist of four formats_. A general sniffer answers "what is this?" across a
hundred types; we need "is this one of exactly four?", which is a different
question with a safer default. Anything not matching a signature is rejected —
including formats nobody has considered yet, and including SVG. Every offset is
documented against the format's own specification, so the check can be audited
without reading a dependency.

**SVG is named in its own error.** `sniffImageType` already returns null for it,
so the extra check changes no decision — but a person uploading a logo deserves
"SVG files are not accepted" rather than "unsupported image", and it marks the
rejection as deliberate rather than incidental.

**Checks run cheapest-and-most-certain first**: size, then alt text, then type,
then checksum, then any encoding work. A hostile file is refused before it costs
anything, and alt text is checked before bytes reach storage so a missing
description cannot be "fixed later" once the object exists.

**One `MediaAsset` row per derivative.** #42's route authorises by row lookup, so
a derivative without a row is unreachable — #17 measured that (a guessed sibling
key returned 404) and builds its srcset from the rows that exist. The admin grid
groups by key stem, because a person thinks in images, not in eight rows.

**Only widths the source can fill.** Upscaling a 600px screenshot to 1920 makes a
larger file that looks worse. The smallest width is always produced, so a tiny
source still yields one derivative rather than none.

**The widest WebP is the "primary" row.** #17 picks the fallback `<img src>` from
the non-AVIF rows, so pointing a cover at an AVIF row would make the fallback the
one thing that cannot display everywhere.

**A fresh sharp pipeline per derivative.** The pipeline is stateful; reusing one
instance means the second `toBuffer` operates on the first one's output.

**EXIF is stripped by omission.** sharp only copies metadata when asked with
`.withMetadata()`, which is never called. Verified rather than assumed — see
below.

**Delete checks both references.** A cover _and_ an inline gallery image.
Checking only the cover would delete an image still on a published page, and
`ProjectImage.assetId` is `onDelete: Restrict`, so the row delete would fail
halfway and leave objects with no rows — unreachable bytes nobody can find.
Objects are deleted before rows: a failure then leaves a row pointing at nothing,
which is visible and fixable; the reverse is not.

**The upload limit is keyed on the user id.** SPEC §14.9 says per _session_, and
an admin behind a changing IP should not earn a fresh budget by reconnecting.

## Verified

Gate re-run after the last edit: `typecheck` 0 errors / 0 warnings / 0 hints ·
`lint` PASS · `test` **381** passed, 47 skipped · `build` PASS. Integration
**47/47** across four suites.

| Acceptance criterion                                                  | Result                                                                                                                           |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `payload.svg` renamed `payload.png` is rejected by content sniffing   | **400** `SVG files are not accepted. Export a PNG or WebP instead.` — over real HTTP, with `Content-Type: image/png` on the part |
| An 8.1 MB upload is rejected                                          | rejected, nothing stored                                                                                                         |
| A JPEG with GPS EXIF has no EXIF in any stored derivative             | see below                                                                                                                        |
| Uploading the same file twice is blocked by checksum                  | **400** `That image is already in the library.`, no extra rows                                                                   |
| Deleting a referenced asset is blocked with a clear message           | `That image is still used by Upload Target.` — blocked for a cover _and_ for a gallery reference                                 |
| Nothing user-controlled reaches a path or an outbound URL unvalidated | keys are `projects/{projectId}/{ulid}-{width}.{ext}`; the filename is never read                                                 |

EXIF, end to end through the running server. A JPEG built with real GPS tags and
a `TestCam` maker string, uploaded through the Action, every derivative fetched
back through `/api/media`:

```
01M11N18Z9SM9P5TTCTPVT2KBM-480.avif    HTTP 200  exif=none  TestCam=0
01M11N18Z9SM9P5TTCTPVT2KBM-480.webp    HTTP 200  exif=none  TestCam=0
01M11N18Z9SM9P5TTCTPVT2KBM-960.avif    HTTP 200  exif=none  TestCam=0
01M11N18Z9SM9P5TTCTPVT2KBM-960.webp    HTTP 200  exif=none  TestCam=0
01M11N18Z9SM9P5TTCTPVT2KBM-1440.avif   HTTP 200  exif=none  TestCam=0
01M11N18Z9SM9P5TTCTPVT2KBM-1440.webp   HTTP 200  exif=none  TestCam=0
```

The source is asserted to _contain_ `TestCam` and an `Exif` header first —
without that the absence check proves nothing. The literal string `GPSLatitude`
is deliberately **not** asserted: EXIF stores numeric tag ids, so that string is
never in the bytes and asserting its absence would pass trivially.

Unauthenticated `POST /_actions/uploadMedia` → **401**. axe on `/admin/media`:
**0 violations**.

Mutation results:

| Mutation                                        | Integration | Unit |
| ----------------------------------------------- | ----------- | ---- |
| delete a referenced asset anyway                | 2           | —    |
| trust the client type instead of sniffing       | 1           | 0    |
| drop the 8 MB limit                             | 1           | —    |
| allow empty alt text                            | 1           | —    |
| drop the checksum duplicate check               | 1           | —    |
| only check the cover reference, not the gallery | 1           | —    |
| keep metadata on the AVIF derivatives           | **1**       | 0    |
| accept any RIFF container as WebP               | 0           | 1    |

**Client bundle:** 0 files for `sharp`, `prisma`, `argon2`, `S3_SECRET`,
`processUpload`, `ulid`.

## Two mutations that measured nothing

Worth recording, because both looked like coverage gaps and neither was.

The `withMetadata()` mutation first reported **0 failures**. The replacement
string did not match the file's actual indentation, so nothing was mutated —
applied correctly it fails 1 test. A mutation that does not reproduce the defect
proves nothing, and reporting its zero as "uncovered" would have been wrong.

Earlier in this sprint the same thing happened twice (#25's origin check, #27's
reorder guards). The pattern is always the same: assert the mutation applied
before trusting its result.

## Found while testing

**`AssetInUse` counted projects instead of naming them.** "Used by 1 project"
leaves the admin hunting for which one, and #28 asks for a _clear_ message. It
now names them: `That image is still used by Upload Target.` Caught because the
integration test asserted the project's title rather than a count.

## Blocked

Nothing blocks this issue.

## Next

- **#27** (open, PR #77) adds the cover picker and gallery editor that consume
  this. Both branches touch `src/actions/index.ts`, so expect a small append
  conflict — both add actions and both add an origin check to `requireAdmin`.
- The upload form takes one file at a time; SPEC does not ask for multi-select.
- CI still runs no integration suite. Open since #19.

## Content TODOs

None.

---

## Review round 2 — finding addressed

### The effective upload limit was 1 MB, not 8 MB (fixed)

The reviewer is right, and this is the most useful kind of finding: the
acceptance criterion **passed for the wrong reason**.

Astro refuses an Action body larger than `security.actionBodySizeLimit` _before
the handler runs_, and its default is **1 MiB**. So `MAX_UPLOAD_BYTES = 8 MB`
was never reached. "An 8.1 MB upload is rejected" was satisfied — by a framework
limit eight times stricter than the spec's — while **every upload between 1 MB
and 8 MB was rejected too**, which is most of the range SPEC §9 allows and
exactly where real screenshots live.

Reproduced before fixing, with a valid 5.43 MB JPEG:

```
-> 413 {"code":"CONTENT_TOO_LARGE","message":"Request body exceeds 1048576 bytes"}
   MediaAsset rows: 0
```

Two consequences the reviewer names, both correct:

- **The app's limit and its error copy were dead code.** `UploadRejected` for
  oversize could not fire, so an admin saw a raw framework string instead of the
  interface's own words.
- **The mutation result was hollow.** "Drop the 8 MB limit → 1 integration test
  fails" was true of a check production never reached.

`security.actionBodySizeLimit` is now **9 MiB** — above the app's 8 MB with room
for multipart overhead, and deliberately not wide open, so a wildly oversized
body is still refused cheaply at the framework layer.

### Verified after the fix

| Request                                              | Before                              | After                                                                      |
| ---------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------- |
| valid 5.43 MB JPEG                                   | **413** `CONTENT_TOO_LARGE`, 0 rows | **200**, 8 derivatives stored                                              |
| 8.40 MB file (over SPEC's limit, under the body cap) | never reached the app               | **400** `That file is larger than 8 MB.` — field-keyed, the app's own copy |

The oversized case now returns an `AstroActionInputError` with
`fields.file: ["That file is larger than 8 MB."]`, which the form can render
against the field, rather than a framework sentence about bytes.

### The regression test, and why it reads the config as text

`src/lib/__tests__/uploadlimits.test.ts` asserts the framework limit stays above
`MAX_UPLOAD_BYTES`, with headroom, and that neither drifts. It reads
`astro.config.mjs` as **text** rather than importing it — the config pulls in
integrations that cannot load under vitest.

Nothing else catches this class of bug: every other upload test calls
`processUpload` directly with a byte array and never crosses the HTTP boundary,
so the limit that actually applies in production is invisible to them.

Mutation: putting the limit back to 1 MiB fails **3** tests. Before this commit
it failed 0.

### On the no-op mutations

The reviewer's suggestion is right — it belongs in the conventions rather than in
one PR body. Two rules, both learned the same way this sprint:

1. **Assert the mutant applied** before trusting a zero. A replacement string
   that no longer matches reads exactly like "not covered".
2. **Assert the outcome, not the mechanism.** #17's images had a populated
   `currentSrc` while nothing painted; #27's form had a valid-looking `action`
   pointing at a route that did not exist; this had a size constant that was
   never consulted. In each case the mechanism was observable and the outcome
   was not.

## Gate

`typecheck` 0 errors / 0 warnings / 0 hints · `lint` PASS · `test` **429**
passed, 62 skipped · `build` PASS. Integration **62/62** across five suites.
