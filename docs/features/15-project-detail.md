# #15 — `/work/[slug]` project detail page

## Done

| Criterion                          | Result                                                          |
| ---------------------------------- | --------------------------------------------------------------- |
| Published slug                     | **HTTP 200**                                                    |
| `DRAFT` slug                       | **HTTP 404** — identical to unknown                             |
| Unknown slug                       | **HTTP 404**                                                    |
| Metadata strip at a **true 375px** | **2 lines**, no overflow                                        |
| `h1` in `headline-lg`              | **48px**                                                        |
| `article` JSON-LD                  | present, valid, `@type: Article`                                |
| Canonical + OG + Twitter           | present                                                         |
| Cache header                       | `public, max-age=0, s-maxage=300, stale-while-revalidate=86400` |
| axe (reduced motion)               | 1 — the accepted gold sequence index                            |

`typecheck` 0/0/0 · `lint` PASS · **82 tests** · `build` PASS · `audit` PASS

## Review follow-up — 320px overflow

The acceptance sweep stopped at 375. At **320px** the document overflowed:

```text
clientW=320  scrollW=333  overflow=true
h1: box=288  scrollWidth=317  overflow-wrap: normal
```

The word **"reconciliation"** needs 317px at 48px Bodoni; the content column offers 288. It
cannot break, so it pushes the document to 333 and the fixed facet lattice stretches to match.

**Same failure class as the 768px bug in #14** — a fixed large type size meeting a narrow
viewport. BRAND §3 gives `display-xl` explicit steps (96/56/44) _because_ it "must never
overflow the viewport"; `headline-lg` has no such step, and this page uses it for an arbitrary
admin-entered title. Fixed with `break-words`; `overflow-wrap` only engages when a word
genuinely cannot fit, so nothing wider changes:

| Width    | 320   | 360   | 375   | 768   | 1440  |
| -------- | ----- | ----- | ----- | ----- | ----- |
| overflow | false | false | false | false | false |

A responsive step for `headline-lg` would also work, but that is a BRAND §3 amendment;
`break-words` keeps the decision inside this slice.

## Viewport measurement — use CDP, not an iframe, and not `--window-size`

Three corrections to what I wrote first.

**1. `--window-size` clamps at 500, and my "485" was wrong.** Measured directly:

```text
--window-size=320/375/400/485/500  ->  clientWidth 500
--window-size=640                  ->  clientWidth 640
```

The floor is **500**. My earlier 485 readings were 500 minus a 15px scrollbar on pages that
scrolled — the two numbers were consistent; my explanation of them was not.

**2. Use `Emulation.setDeviceMetricsOverride` over CDP, not the iframe I proposed.** It gives a
true _top-level_ viewport, and the 320px overflow above was found with it. An iframe changes
`position: fixed` containment, viewport units and scroll-container behaviour — precisely what a
responsive-image slice needs to measure honestly. Node 24 has a built-in `WebSocket`, so the
driver is about thirty lines against `--remote-debugging-port`.

**3. Gotcha for #17/#39:** `mobile: true` on a page _without_ `<meta name="viewport">` falls
back to a 980px layout width. Every page here inherits the meta from `BaseLayout`, so it does
not bite this project — but it would silently invalidate a measurement on a page that lacked it.

## Superseded — the original iframe note

Chrome's `--window-size=375` yields a **485px** viewport — its minimum window width. So every
"375px" figure in #10–#14 was actually measured at 485px, and the acceptance criterion here
("wraps cleanly to two lines at 375px") could not have been tested that way at all.

Fixed by rendering the page in a **375px `<iframe>`**, which gives the inner document a true
375px viewport:

```text
innerW=375  overflow=false  stripH=36  stripLines=2  h1Size=48px
```

The strip does wrap to two lines, and it only demonstrably does so at a real 375px. **#17 and
#39 should use the iframe technique rather than `--window-size` for narrow-viewport checks.**

## A silent file-write failure

`cat > src/pages/work/[slug].astro` wrote **nothing**: zsh glob-expanded `[slug]`, found no
match, and the redirect never created the file. The page 404'd for every slug — including
published ones — and the cause looked like a data or query bug for several rounds. The build
was clean, because there was no page to fail.

Quote any path containing `[` or `]`. **A missing file and a broken query look identical from
the outside; `find src/pages -type f` settled it in one command.**

## `set:html` — required, and confined to one component

`astro/no-set-html-directive` (added in #47) fired on the JSON-LD, correctly. Working through
it produced a better answer than an inline disable:

1. `JSON.stringify` escapes quotes but **not** `<`, so a title containing `</script>` would
   terminate the script element early — a genuine XSS vector.
2. The obvious alternative, `<script>{expr}</script>`, **does not work**: Astro emits the
   literal text `{escapeForScript(jsonLd)}` — expressions are not evaluated inside a raw-text
   `<script>`. Verified against a built server.

So `set:html` is unavoidable. It now lives in **`src/components/JsonLd.astro`**, which escapes
`<` to `<`, and the ESLint exception is scoped to **that one file**. `set:html` appears
nowhere else in `src/`, and #16 can use the same shape for sanitised Markdown.

**Verified with a title of `Ledger </script><img src=x> test`:**

```text
raw JSON-LD      {"headline":"Ledger </script><img src=x> test", …}
'</script>' raw  False
parses as JSON   YES  ->  round-trips to `Ledger </script><img src=x> test`
```

## An XSS scare that wasn't

The same probe showed `<img src=x>` **unescaped** in `og:title` and `twitter:title`. Astro
escapes `<`/`>` in text nodes but not inside attribute values.

That is not a vulnerability, and I confirmed it rather than assuming either way: a second probe
with a title of `Quote" onmouseover=alert(1) x` renders as `Quote&quot; onmouseover=…`. **The
quote is escaped, so the attribute cannot be broken out of, and `<`/`>` are inert inside a
quoted attribute value.** No breakout, in any of `<title>`, `<h1>`, the meta tags, or the
JSON-LD.

## Two `astro-eslint-parser` gaps

Both crash or misfire where `astro check` reports zero errors:

- **`no-misused-promises` CRASHES** on an early `return` in frontmatter —
  _"Non-null Assertion Failed: Expected node to have a parent."_ Reproduced in six lines. That
  return is the idiomatic Astro SSR 404 and SPEC §5 requires it. Disabled for `.astro` only; a
  crashing rule reports nothing anyway, and `.ts` keeps it (verified).
- ESLint disable comments **do not work in Astro templates** — neither `{/* … */}` nor
  `<!-- … -->` suppressed the rule. Scoping in `eslint.config.js` is the mechanism that works.

## Decisions

- **The status filter is in the `WHERE` clause**, not a post-fetch check, so a `DRAFT` row is
  indistinguishable from one that never existed — same query, same response, same timing
  (SPEC §5: "never a redirect that leaks existence").
- **`404.astro` is minimal here.** #18 owns it; it exists because SPEC §5 requires an unknown
  slug to reach a real 404 page.
- **The Markdown body renders as plain text** with `whitespace-pre-line`. #16 brings
  `rehype-sanitize`; until then the body never reaches `set:html` and Astro escapes it.

## Next

**#16 — Markdown rendering**, which replaces the plain-text body and can reuse `JsonLd.astro`'s
pattern for its own sanitised `set:html`.

## Content TODOs

All project copy is seeded placeholder (`prisma/seed.ts`), and `liveUrl`/`repoUrl` are null on
every sample, so the Links block does not render.
