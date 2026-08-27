# #16 — Server-side Markdown rendering with a `rehype-sanitize` allowlist

## Done

`src/lib/markdown.ts` renders `Project.body`; `MarkdownBody.astro` is its only consumer and the
only place `set:html` touches project content.

**Verified end to end** with a real payload in the database, rendered through the page:

```text
body: ## Real heading … <script>alert(1)</script> … <img src=x onerror="alert(2)">
      … [bad](javascript:alert(3)) … # Should not be h1
```

| Assertion              | Result            |
| ---------------------- | ----------------- |
| no `<script>`          | PASS              |
| no `on*=` handler      | PASS              |
| no `javascript:` href  | PASS              |
| no `alert(` anywhere   | PASS              |
| no `<img>`             | PASS              |
| no `<h1>` in the body  | PASS              |
| page-wide `<h1>` count | **1** — the title |

Legitimate Markdown survives: `h2`, `strong`, inline `code`, a safe link, list items — all
PASS. **115 tests.** `typecheck` 0/0/0 · `lint` PASS · `build` PASS.

## The allowlist is not what stops `<script>` — and my first comment said it was

I wrote `remarkRehype({ allowDangerousHtml: true })` with a comment claiming raw HTML is
"passed through to the sanitizer, and the allowlist is what removes it".

**That was wrong, and mutation testing caught it.** Adding `script` and `iframe` to `tagNames`
failed **zero** tests. Rendering directly with `script` explicitly allowlisted:

```text
<script>alert(1)</script>  ->  ""
<iframe src=x></iframe>    ->  ""
```

Without `rehype-raw` in the pipeline, `allowDangerousHtml` produces `raw` nodes that
`rehype-sanitize` drops **wholesale**, regardless of `tagNames`. The allowlist never saw them.
Had I relied on that comment while later adding `rehype-raw`, the real defence would have
vanished silently.

Now explicit: **`remarkRehype` without `allowDangerousHtml`** — raw HTML never becomes an
element — and the allowlist governs the elements remark itself produces.

## Mutation profile — measured, and one row is deliberately zero

| Mutation                     | Tests failing |
| ---------------------------- | ------------- |
| remove `rehypeSanitize`      | **6**         |
| allowlist `h1`               | **1**         |
| allow `javascript:` protocol | **1**         |
| allowlist `iframe`           | **0**         |

The last row is **correct, not a gap**: `iframe` cannot be produced by Markdown, and raw HTML
is already dropped upstream, so allowlisting it changes nothing. Recording the zero rather than
omitting it — a mutation table that only lists the rows that moved hides which defence is
actually load-bearing.

Same reason `allowDangerousHtml: true` alone fails 0 tests: the two layers are independent and
either suffices. **The uncovered edge is adding `allowDangerousHtml` AND `rehype-raw`**, which
collapses it to one defence. No test catches that; the comment in `markdown.ts` flags it.

## Decisions

- **`h1` is excluded from `tagNames`.** A body heading would otherwise outrank the page title
  (BRAND §9: one `h1` per page, levels never skipped). Verified page-wide: exactly one `h1`.
- **`href` protocols are `http`, `https`, `mailto`.** `javascript:`, `data:`, `vbscript:` and
  `file:` are absent by omission — an allowlist, so an unanticipated scheme fails closed.
- **The allowlist includes `figure`/`figcaption`** for #17's inline images, which the renderer
  will insert rather than an author typing raw HTML.
- **`MarkdownBody.astro` carries the `set:html` exception**, scoped in `eslint.config.js`
  alongside `JsonLd.astro`. Two files, both purpose-built; the rule stays on everywhere else.

## Next

**#17 — responsive images**, which needs #42's serving endpoint (PR #62), or **#18 — next card
and 404**.

## Content TODOs

Sample project bodies are placeholder prose in `prisma/seed.ts` and contain no Markdown
structure — the rendering above was verified with a payload injected for the test, then
reverted.

---

## Review round 2 — findings addressed

### Finding 1 · Markdown images rendered to nothing (fixed)

`img` was missing from `tagNames` while `figure`/`figcaption` were present, so
the wrapper survived and its content was dropped silently. #16's scope names
"inline `ProjectImage` screenshots resolved into the rendered body", so this was
in scope and is now fixed.

`img` is allowlisted with `src`, `alt`, `title`, `width`, `height`, `loading`,
`decoding`.

**Image sources are restricted to same-origin paths, not `http`/`https`.** The
reviewer raised this as a decision; the CSP settles it. `astro.config.mjs` sets
`img-src 'self' data:`, so an external `https://…` image is blocked by the
browser regardless — allowing it through the sanitizer would emit markup that
fails silently on the page. The sanitizer now agrees with the CSP.

That is enforced by `assertLocalImageSources`, a pass that runs **after** the
sanitizer, because `protocols.src` alone cannot do it: a protocol-relative
`//evil.example/x.png` carries no scheme, passes the protocol check, and still
loads cross-origin. An image that fails is dropped whole rather than left with a
missing `src` — a broken-image icon is worse than nothing.

### Finding 2 · Tables and `del` allowlisted but unreachable (fixed)

`table`, `thead`, `tbody`, `tr`, `th`, `td` and `del` need `remark-gfm`, which is
not in the pipeline. Removed the seven tags (and `th: ["scope"]`) rather than
adding the dependency: tables are not in #16's scope, and the smaller change is
the one that does not widen what this renderer accepts. A comment in
`markdown.ts` says to restore them in the same commit if `remark-gfm` is ever
added.

### Finding 3 · `clobber: []` disabled a default protection (fixed)

Removed, so `defaultSchema`'s `clobber` + `user-content-` prefixing is inherited
again. The comment that sat above it described the `h1` exclusion, which is a
`tagNames` concern — it has moved there.

## Mutation results for the new guards

Honest record, including the two that pin nothing:

| Mutation                                         | Tests failed |
| ------------------------------------------------ | ------------ |
| drop `assertLocalImageSources` from the pipeline | 6            |
| `isLocalPath` stops rejecting protocol-relative  | 2            |
| remove `img` from `tagNames` (the original bug)  | 3            |
| `protocols.src: []` → `["http", "https"]`        | **0**        |
| re-add the unreachable `table`/`del` tags        | **0**        |

The two zeros are recorded rather than hidden. `protocols.src: []` is redundant
depth — `assertLocalImageSources` already rejects every absolute URL — and is
commented as redundant so nobody later reads it as the thing doing the work. The
unreachable-tag zero is the point of finding 2: an allowlist entry the pipeline
cannot reach is undetectable by construction, so it can only be kept honest by
reading, which is why the tags went.

## Verified

Gate re-run after the last edit: `typecheck` 0 errors / 0 warnings / 0 hints ·
`lint` PASS · `test` **128** passed (6 files, up from 115) · `build` PASS.

Rendered output, measured through the real `renderMarkdown`:

| Input                                 | Output                                              |
| ------------------------------------- | --------------------------------------------------- |
| `![Ledger detail](/api/media/a.webp)` | `<img src="/api/media/a.webp" alt="Ledger detail">` |
| `![alt](/api/media/a.webp "cap")`     | `title="cap"` preserved                             |
| `![x](https://evil.example/a.png)`    | `<p></p>`                                           |
| `![x](//evil.example/a.png)`          | `<p></p>`                                           |
| `![x](javascript:alert(1))`           | `<p></p>`                                           |
| GFM table                             | literal text, no `<table>`                          |
| `~~struck~~`                          | literal text, no `<del>`                            |

End to end on a running server with a real project body: the same-origin image
renders as one `<img>`, both external forms vanish, and `evil.example` appears
**0** times in the page source.

## Merge-time note

Still targets `develop`, so `Closes #16` will not fire — close #16 by hand.
