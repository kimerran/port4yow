# #39 — E2E Playwright suite + axe-core accessibility scan

SPEC §16 · BRAND §9 · AGENT §7

## Done

**82 end-to-end tests** across four Playwright projects, against a **production
build** — `astro dev` emits no CSP at all (#33), so a dev-server run would have
passed every check while telling us nothing about the page a visitor gets.

The suite found **two real product defects** and one accessibility miss. All
three are fixed here.

## What it found

### 1. Creating a project through the admin form was broken

Filling in the new-project form and leaving the two optional URL boxes blank —
the ordinary case, not an edge one — failed validation on **`liveUrl`,
`repoUrl` and `coverImageId`**:

```
Failed to validate: [ { "code": "invalid_union", "path": ["liveUrl"],
  "message": "Invalid input: expected string, received null" }, … ]
```

Astro's form parser does not hand a blank optional field to the schema as `""`.
It sees a field with a default and delivers **`null`**. The union accepted
`z.literal("")` and a URL, so every real submission was rejected.

It survived because every existing test calls the action handler with a
**constructed object**, where `""` is what the caller writes. Only a real
browser posting real `FormData` produces the value the framework actually sends.
That gap is the reason #39 exists, and it is the single best argument for the
suite.

### 2. Three tap targets were unhittable on a phone

At 375px: `GitHub` 52×19, `LinkedIn` 63×19, and the footer `Privacy` link 57×16
— against BRAND §9's 44×44 floor. The privacy link was one I added in #36, and
neither its own verification (200, axe clean, keyboard-reachable) could see it.
All three now carry `min-h-11` with `inline-flex`, matching the pattern already
used on nav and form controls.

### 3. The axe contrast finding, resolved rather than deferred

The `serious` `color-contrast` violation flagged in #36 and #43 turns out to be
four **already-`aria-hidden`** decorative elements: the hero monogram watermark
at 10% opacity and the gold `01/02/03` tile indices. axe checks contrast on
visible text regardless of `aria-hidden`, and it is right to — hiding something
from a screen reader does not help someone with low vision who can still see it.

But WCAG 1.4.3 exempts _incidental_ text, and BRAND §2 makes this an explicit
decision: "gold is a MARKER, never text". `RankIndex.astro` already records that
it measures ~1.9:1 and would fail badly as text. Restyling is a brand change,
not a test change, and BRAND is the source of truth.

So the rule is narrowed rather than disabled — and the narrowing has **its own
guard**: every exempted node must be `aria-hidden`, none may be interactive, and
there may be at most eight. A blanket `disableRules(["color-contrast"])` would
have hidden the real finding this suite exists to catch.

## Changed

| File                                                               | What                                                       |
| ------------------------------------------------------------------ | ---------------------------------------------------------- |
| `playwright.config.ts`                                             | new — four projects, `webServer` on a real build           |
| `e2e/global-setup.ts`                                              | new — seeds three published projects and a generated admin |
| `e2e/fixture.ts`, `e2e/db.ts`                                      | new — shared helpers                                       |
| `e2e/{home,contact,admin,a11y,keyboard,motion,responsive}.spec.ts` | new — 82 tests                                             |
| `src/actions/index.ts`                                             | accept `null` for a blank optional form field              |
| `src/pages/index.astro`, `src/layouts/BaseLayout.astro`            | 44px tap targets                                           |
| `.github/workflows/ci.yml`                                         | new `e2e` job                                              |
| `package.json`, `.gitignore`                                       | Playwright, axe, and generated artefacts                   |

## Decisions

### Nothing is hardcoded, and the admin password does not exist in the repo

`global-setup` creates the account with `randomBytes`, hashes it with the app's
own argon2 settings, and passes it to the specs through a gitignored file.
AGENT §3 bans a hardcoded credential "even in a test"; there is no password in
any spec.

### The no-JS path is proved by navigation, not by a claim

`page.evaluate` still works under `javaScriptEnabled: false` — Playwright runs it
in an isolated world — so "can I evaluate?" tells you nothing. I used exactly
that as the probe first and it reported the context had JS.

What distinguishes the two paths is the **navigation**. `initContactForm` calls
`preventDefault` and posts with `fetch`, so the enhanced path never leaves the
page; a real form submit does. Landing on `/api/contact` is only possible if the
page's script never ran — and there is a control test asserting the JS path stays
put, because otherwise "we navigated" proves nothing about JS at all.

The no-JS test also **waits out the 3-second HMAC gate** and checks the stored
row is `NEW`. Without that it passed while the server logged `classified as
spam: too-fast` — asserting that the endpoint answers rather than that the
submission was accepted. SPEC §7's indistinguishable 200 means a status code
cannot tell those apart; only the row can.

### Rate limits, and three wrong answers before the right one

SPEC §7 limits contact to 5/hr/IP and login to 10/15min/IP. This suite exceeds
both, and **every time it bit, the failure named something else** — "the success
button never appeared", "sign in did not navigate". Each fix failed differently:

1. **A module-level counter** restarts whenever Playwright reloads the file, so
   `desktop-1440` and `mobile-375` both began at `.1`.
2. **A hash of `testInfo.titlePath`** is stable across that — but `titlePath`
   does not include the project, so the same test in three projects still shared
   one address.
3. **No per-run entropy.** Three logins per run is well under the limit; four
   runs inside fifteen minutes is not — which is exactly what you do while
   writing the thing.

The address is now a hash of project + title + a salt generated once per
`global-setup`. Varying `X-Forwarded-For` beats clearing the `RateLimit` table:
no shared mutable state, no ordering assumption, and it exercises `clientIpFrom`
— which reads the _first_ entry — on the way through. Verified with **three
consecutive full runs, 82/82 each**, which is the case that used to break.

### Chromium only

The suite asserts computed styles, focus rings and axe results. None differs
usefully across engines, and pulling three browsers triples the slowest step in
CI for no extra signal.

## Verified

| Check                                                   | Result                                                                |
| ------------------------------------------------------- | --------------------------------------------------------------------- |
| full suite                                              | **82 passed, 2 skipped** across 4 projects                            |
| three consecutive runs                                  | 82/82 each                                                            |
| tap targets at 375px                                    | 0 under 44×44 (was 4)                                                 |
| axe on `/`, `/privacy`, `/404`, a detail page, `/admin` | 0 serious, 0 critical                                                 |
| next-card chain                                         | visits every published project once, then wraps                       |
| reduced motion                                          | deal, tile lift, card flip, image scale and rail fill all final-state |

The two skips are the 44px tap-target check at 768 and 1440 — deliberate, since
the floor is a touch requirement.

Mutations against the two product fixes:

| Mutation                            | Result           |
| ----------------------------------- | ---------------- |
| revert the blank-optional-field fix | **2 tests fail** |
| revert the 44px footer tap target   | **1 test fails** |

Gate: `typecheck` 0 errors / 0 warnings / 0 hints · `lint` PASS · `test` **530
passed, 115 skipped** · `test:integration` **115 passed** · `build` PASS.

## Review round 2 — the exemption was over-applying, and its guard could not see it

The review found that `isDecorativeContrast` tested `/aria-hidden="true"/` on
`node.html`, and `node.html` is the element's markup **including its children**.
So real text was exempted whenever it happened to contain a decorative child:

```
<p class="lede">Low-contrast body copy <span aria-hidden="true">*</span> continues</p>
```

Correct, and the sharper half of the point is that **the guard could not catch
it**: "the contrast exemption cannot grow" asserted the same string the filter
had just tested, so it agreed by construction. A guard that shares its subject's
predicate is not a guard.

Not observed on the current pages — the exemption today is still the four
decorative nodes — so this was latent, exactly as the review said.

### Resolved against the DOM, not the markup string

`el.closest('[aria-hidden="true"]')` fixes all four of the review's rows and the
one it noted in the other direction: an element inheriting `aria-hidden` from an
ancestor really is hidden, and the string test missed those.

### The deeper problem: my fix had the same flaw

Both exemptions had a case-table test that **inlined a copy of the rule** rather
than calling it. Mutating the real implementation left both green:

| Mutation                                         | Before restructuring |
| ------------------------------------------------ | -------------------- |
| revert `isDecorative` to a string match          | **0 tests fail**     |
| widen `isInlineProseLink` to every link in prose | **0 tests fail**     |

The tables asserted the _concept_ while the _implementation_ went unmeasured —
the review's criticism, one level up, in my own fix for it.

So `e2e/a11y-rules.ts` now holds the decisions as pure functions. The browser
only collects facts; the specs and the case tables both call the same rules.
One constraint shaped it: sharing a collector by shipping its source into the
page needs `new Function`, which is on AGENT §3's never-list and lint enforces
that — so it is one `locator.evaluate` per element instead. A page has a few
dozen controls; that costs nothing worth a banned construct.

### Tap targets now visit every page

Also from the review: the check only visited `/`. It now covers `/`, `/privacy`,
`/404`, a project detail page and the admin dashboard — and immediately found one
the home-page-only version could not: **`/privacy` has a 93×19 "contact form"
link**, inline in a sentence.

That one is a genuine WCAG 2.5.8 exemption — a link in running prose cannot take
a 44px box without breaking the line. But after a review about an exemption that
over-applied, it does not get added on my say-so: `isInlineProseLink` requires
the enclosing text to be **substantially longer** than the link's own, so
`<li><a>GitHub</a></li>` is not exempted, and the three real home-page findings
still fail without their `min-h-11`.

### Mutations, after the restructuring

| Mutation                                                             | Tests failed |
| -------------------------------------------------------------------- | ------------ |
| `isDecorative`: string match instead of the DOM                      | 2            |
| `isDecorative`: drop the 24-character length cap                     | 2            |
| `isDecorative`: `closest()` instead of `matches()` for interactivity | 2            |
| `isInlineProseLink`: exempt every link in prose                      | 4            |
| `isTouchTarget`: stop skipping `sr-only`                             | 7            |
| `isTouchTarget`: stop skipping `aria-hidden`                         | 2            |
| `isTouchTarget`: drop the inline-prose exemption                     | 1            |
| comment-only change (control)                                        | **0**        |

Two of those needed a second pass of their own. `!facts.ariaHidden` survived
first time — not because the clause is wrong, but because no aria-hidden
focusable element under 44px exists on these pages. An untested clause and a
redundant one look identical from outside, so every clause of `isTouchTarget`
now has a case rather than a guess.

Full suite after: **101 passed, 10 skipped** (the skips are the 44px checks at
768 and 1440, which is a touch requirement).

## Blocked

Nothing.

## Next

- **`ci.yml` will conflict with #38.** That PR adds an `integration` job at the
  same anchor — immediately before the `gitleaks` job — and this one adds `e2e`.
  Whichever merges second needs a one-hunk resolution: keep both jobs. Flagged
  rather than worked around, because guessing the merge order would be worse.
- **The no-JS confirmation is raw `{"ok":true}`.** A visitor without JavaScript
  submits successfully and lands on a page of JSON. The suite now proves the
  submission works; making the landing a real page is a separate change and
  wants a decision about what it should say.
- **Make `e2e` a required check**, alongside `integration`. Branch protection,
  not something a PR can commit.

## Content TODOs

None.
