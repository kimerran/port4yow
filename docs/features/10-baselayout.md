# #10 — BaseLayout: facet lattice, single navigation, content shell

## Done

Every acceptance criterion **measured in headless Chrome** at 375 / 768 / 1440px, not inferred
from classes — the lesson #9's review drove home.

| Criterion                       | 375px | 768px | 1440px |
| ------------------------------- | ----- | ----- | ------ |
| No horizontal scroll            | ✓     | ✓     | ✓      |
| Navigation regions **rendered** | **1** | **1** | **1**  |
| `<h1>` count                    | 1     | 1     | 1      |
| Tap targets under 44×44         | **0** | **0** | **0**  |
| `display-xl` computed size      | 44px  | 96px  | 96px   |

`typecheck` 0/0/0 · `lint` ✓ · `test` 61/61 · `build` ✓ · `audit` ✓

## A bug the measurement caught

The brand/home link was **30px tall** in both navs — `128×30` on mobile, `43×30` on desktop —
while the four suit links were correctly 44×44. Padding alone does not make a tap target;
`py-sm` on a 14px mono line gives 30px. Now `flex h-11 items-center` on both. **Reading the
classes would not have caught this**: `px-sm py-sm` looks like a deliberate touch target until
something measures it.

## Decisions

- **Two `<nav>` elements in the DOM, exactly one rendered.** BRAND §7 says one nav, not two,
  and the mock's collision is the thing to avoid. Rather than a JS-swapped single element, the
  two presentations are mutually exclusive at `md` via `hidden`/`md:hidden`. `display: none`
  removes a node from the accessibility tree, so exactly one navigation region exists at every
  breakpoint — **verified by measuring `getComputedStyle().display`, not assumed from the
  class names**, since "2 navs in the DOM" is exactly the shape of the defect BRAND warns about.
- **`SuitGlyph.astro` created here, minimally.** #12 owns the full component; BRAND §7
  specifies suit-glyph links for the rail, so the layout cannot render without it. Inline SVG,
  never an icon font (BRAND §6/§10), `aria-hidden` with `sr-only` text alongside. Same call as
  #2 installing `prettier-plugin-astro`: a dependency this slice's own feature needs.
- **The facet lattice is `aria-hidden` and `pointer-events-none`.** It is texture, never
  content, and must not intercept a click. 2% opacity on mobile, 3% above (BRAND §4).
- **`<Font>` tags are in `<head>`** — #9's handoff flagged that the `fonts` config emits no
  `@font-face` without them. Confirmed: 1 `@font-face` block in the served HTML.
- **The shell clears the rail with `md:pl-20`** rather than overlapping it, so content never
  sits under the fixed nav.
- **Footer rule is inset to the content column** (`border-deep-teal/10` inside the max-width
  container), never full-bleed (BRAND §4).

## Tooling — `no-unsafe-return` disabled for `.astro` only

`typescript-eslint` cannot type markup returned from a template expression through
`astro-eslint-parser`: a `.map()` rendering elements reports *"Unsafe return of a value of
type error"*. **TypeScript itself is fine** — `astro check` reports 0 errors on the same file,
so this is a parser gap rather than an `any` leaking in. Reproduced in four lines:

```astro
const xs = [{ h: "/a" }];
<ul>{xs.map((x) => <li><a href={x.h}>x</a></li>)}</ul>
```

Scoped to `.astro` and to that one rule. Verified the exception stays narrow: `no-explicit-any`
and `astro/no-set-html-directive` still fire in `.astro`, and `.ts` files still get
`no-unsafe-return`. Every AGENT §2/§3 ban is unaffected.

## Blocked — a CSP finding that lands on #11 and #21

**Astro's CSP header is identical on every route and contains only Astro's own 5 runtime
script hashes. Page-level inline scripts are never hashed, and the browser blocks them:**

```
Executing inline script violates the following Content Security Policy directive
'script-src 'self' 'sha256-BF02…' …'. Either the 'unsafe-inline' keyword, a hash
('sha256-e0KLlFPkO4W4EVKFmglE24U7sdq0idaE9Y3RsHNkRSY='), or a nonce is required.
The action has been blocked.
```

Confirmed both with `is:inline` and without, and by diffing the header across two routes — the
hash the page needs is absent from its own CSP.

This matters because **#33 established the standing rule that every new inline script proves
CSP compliance**, and #11 (scroll rail) and #21 (contact form enhancement) are the two scripts
SPEC §15 allows. Neither can be written as an inline `<script>` in a page or layout.

The path that should work is an **external module** — `script-src 'self'` already permits it —
i.e. a `src/scripts/*.ts` imported so Astro bundles it to a file. **#11 should verify that
before writing the rail**, rather than discovering it at review. I did not solve it here: it is
#11's scope and guessing at the mechanism without a script to test is how the wrong pattern
gets baked in.

## Next

**#11 — scroll rail**, which needs the CSP finding above, or **#12 — core components**, which
extends the minimal `SuitGlyph`.

## Content TODOs

- Footer carries only a copyright line. **The privacy-note link is #36's**, and BRAND §4's
  footer is otherwise unspecified.
- `src/pages/index.astro` is still a placeholder; #14 builds the real home page on this shell.
