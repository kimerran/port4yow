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
