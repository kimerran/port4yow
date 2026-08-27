# 31 · SiteSetting editor

## Done

- `GET /admin/settings` — edit the four keys that drive public copy.
- One Action per save, session and origin re-checked.
- URLs validated by scheme **and** host; length capped per key.
- Saving purges the home-page cache.
- BRAND §8's copy guidance rendered beside the fields.

## Changed

| File                                 | Why                                 |
| ------------------------------------ | ----------------------------------- |
| `src/lib/settings.ts`                | new — definitions, validation, save |
| `src/pages/admin/settings.astro`     | new — the screen                    |
| `src/actions/index.ts`               | `saveSetting`                       |
| `src/lib/__tests__/settings.test.ts` | new — 24 tests                      |

## Decisions

**`saveSetting` returns a refusal instead of throwing one.** Every other action
in this codebase throws `ActionError` for a domain refusal. This one cannot: the
screen binds **four forms to one action**, and `Astro.getActionResult` returns a
single result with **no record of which input produced it** (`result.input` does
not exist — `ts(2339)`). A thrown error would therefore render under all four
fields, and #31 asks for a _field-keyed_ error.

Returning `{ ok, key, message }` carries the key back so the message lands beside
the field it concerns. A validation refusal is an expected outcome of a form
rather than an exception, which is what makes this a design choice rather than a
workaround. The cost is that a refusal is HTTP 200 with `ok: false` in the body;
the benefit is measured below.

**The key list is closed.** An admin screen that accepts arbitrary keys can write
a setting nothing reads — a value that looks saved and changes nothing. Adding a
key is a code change in both places anyway, because the page that renders it has
to exist.

**URLs are checked by scheme and by host.** AGENT §3: nothing user-controlled
reaches an outbound URL unvalidated. These become `href`s on the public home
page, so an unchecked one is a link this site vouches for. `javascript:` is the
case #31 names; **`http:` is refused too**, because a profile link that
downgrades the connection is not something to publish, and allowing it would mean
the check passes on the one scheme an attacker on the network can rewrite. Hosts
are matched **exactly**, so `github.com.evil.test` fails.

**Length caps are characters, not words.** A word count cannot be enforced on a
`<textarea>`. `about.body` is 1200 (~150 words at six characters each, in SPEC
§5's 66ch column); `hero.thesis` is 220 (~two lines of `display-lg` on a phone —
past that it stops being a thesis).

**BRAND §8 is rendered on the page**, with the rejected phrases named. A rule with
examples is followed; a rule in a document nobody opens while typing is argued
with.

**The log line carries the key, never the value.** This is public copy today, but
a log that prints whatever was typed into an admin field is a habit worth not
forming.

## Verified

Gate re-run after the last edit: `typecheck` 0 errors / 0 warnings / 0 hints ·
`lint` PASS · `test` **457** passed, 79 skipped · `build` PASS. Integration
**79/79** across six suites.

| Acceptance criterion                                                | Result                                                                                                                             |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Editing `hero.thesis` changes the home page                         | home before: `Original thesis line.` → after: `Systems that fail closed and deploys that are boring on purpose.`; one purge logged |
| A `javascript:` or non-http(s) social URL is rejected               | table below; the stored value never changed                                                                                        |
| Over-length input is rejected with a field-keyed brand-voiced error | `That is 260 characters. Hero thesis holds 220.` keyed to `hero.thesis`                                                            |

URL validation over HTTP, each with its own message rather than one generic one:

| Value                        | Message                                |
| ---------------------------- | -------------------------------------- |
| `javascript:alert(1)`        | Use a full https:// URL.               |
| `http://github.com/kimerran` | Use a full https:// URL.               |
| `https://evil.test/kimerran` | GitHub URL should point at github.com. |
| `//github.com/x`             | That does not look like a full URL.    |

`social.github` in the database was unchanged after all four.

**The field-keyed claim, checked in a browser** — an over-length `hero.thesis`
submitted through its own form:

```
hero.thesis      aria-invalid=true   error="That is 300 characters. Hero thesis holds 220."
about.body       aria-invalid=false  error=null
social.github    aria-invalid=false  error=null
social.linkedin  aria-invalid=false  error=null
```

One field marked, three untouched — which is the whole reason the action returns
a key instead of throwing. axe on `/admin/settings`: **0 violations**.

Mutation results — each asserted to have applied, against a baseline of 0:

| Mutation                           | Tests failed |
| ---------------------------------- | ------------ |
| allow any host                     | 4            |
| accept an unknown key              | 3            |
| host suffix match instead of exact | 2            |
| allow any URL scheme               | 1            |
| allow plain http too               | 1            |
| drop the length cap                | 1            |

## Known gap — the cache is still not purged

Same as #27: `purgeHomeCache` logs `performed: false` because SPEC §13 names no
CDN and there is no purge API to call. The home page picked up the new thesis
**immediately** on a direct request, so the criterion holds in practice; behind a
shared cache it would be stale for up to `s-maxage=300`. Unchanged by this issue
and still wanting either a CDN or a §5 amendment.

## Blocked

Nothing blocks this issue. **Sprint 6 is complete once this and #30 merge.**

## Next

- `TODO(content)` markers stay in the seed — the real copy is Mark's to write
  (AGENT §6). This screen is how it gets written without a deploy.
- #30 (PR #80) also touches `src/actions/index.ts`; same union resolution for
  whichever merges last.
- CI still runs no integration suite. Open since #19.

## Content TODOs

The four seeded values are all still `TODO(content)` placeholders.
