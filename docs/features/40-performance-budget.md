# #40 — Performance budget: Lighthouse, Core Web Vitals, 30KB JS ceiling

SPEC §15 · AGENT §4, §7

## Done

Measured everything SPEC §15 asks for against a **production build**, fixed two
real defects, and added a CI check so the JS ceiling cannot regress silently.

**Three of the four Lighthouse targets are met. Accessibility is 96, not 100**,
and the whole gap is one audit that conflicts with BRAND §2. That needs a
human's decision, not mine — see **The one target not met**.

## Numbers

| Target             | Result                          |
| ------------------ | ------------------------------- |
| Performance ≥95    | **100** desktop · **99** mobile |
| Accessibility 100  | **96** — one audit, see below   |
| Best Practices ≥95 | **100** (was 96)                |
| SEO 100            | **100**                         |

Core Web Vitals, Lighthouse mobile preset (Moto G Power, 4× CPU throttle, slow 4G):

| Metric      | Budget   | Measured                |
| ----------- | -------- | ----------------------- |
| LCP         | < 2.0 s  | **1.7 s**               |
| CLS         | < 0.05   | **0**                   |
| INP         | < 200 ms | **TBT 0 ms** — see note |
| FCP         | —        | 1.5 s                   |
| Speed Index | —        | 1.5 s                   |

**INP is not measurable in a lab run.** It needs real interactions from field
data; Lighthouse reports Total Blocking Time as the lab proxy, and 0 ms is as
good as that proxy gets. Stated rather than quietly reported as INP.

JavaScript per public page, ceiling 30 KB:

```
  /            inline   2230 B  imported      0 B  total   2.2 KB
  /privacy     inline    782 B  imported      0 B  total   0.8 KB
  /404         inline    782 B  imported      0 B  total   0.8 KB
```

7% of the ceiling. The scroll rail (782 B) is site-wide; the home page adds the
contact enhancement.

## Two defects fixed

### `label-content-name-mismatch` — the home link could not be voice-activated

The rail's home link had `aria-label="Home — Mark Hugh Neri"` over an
`aria-hidden` "MHN". WCAG 2.5.3 requires the accessible name to **contain** the
visible label, and it did not — so a voice-control user saying "click MHN" could
not activate it. The visible text is now the start of the name, with the rest in
an `sr-only` span and no `aria-label` at all, so the two cannot drift apart.

### No favicon — a 404 on every page load

`/favicon.ico` 404'd on every request, which Lighthouse counts under
`errors-in-console`. That alone was Best Practices 96. An SVG rather than an
`.ico`: one file, every size, no binary asset to regenerate. **Best Practices is
now 100.**

## The one target not met, and why I did not force it

Accessibility 96. One failing audit, `color-contrast`, four nodes:

| Element                                                    | Ratio | Needs |
| ---------------------------------------------------------- | ----- | ----- |
| hero monogram watermark, 96px at 10% opacity               | 1.22  | 3:1   |
| three tile indices `01/02/03`, 14px `#d4af37` on `#eef5f4` | 1.90  | 4.5:1 |

Both are decorative duplicates — the monogram repeats the `<h1>` above it, the
indices repeat the tile order — and both are already `aria-hidden`. axe and
Lighthouse still measure them, correctly: hiding something from a screen reader
does not help someone with low vision who can still see it.

But **BRAND §2 says gold is "a MARKER, never text"**, and `RankIndex.astro`
already records that it measures ~1.9:1 and would fail badly as text. Recolouring
is a brand change. Raising the watermark's opacity until it passes turns a
watermark into a headline. Neither is mine to decide, and #39's reviewer accepted
the same four nodes as a documented WCAG 1.4.3 exemption.

**I tried the third option and it does not work here.** Moving the decorative
text into CSS `content` would render identical pixels while leaving the DOM
alone — decoration where decoration belongs. It needs the value passed as an
inline custom property, and **this site's own CSP blocks inline style
attributes**: `style-src` carries hashes but no `'unsafe-hashes'`, so `--marker`
computed to empty and the markers vanished. `ResponsiveImage.astro` already
documents the same constraint from #11 ("CSP blocks static `style=""`
attributes"), which I should have read first. Reverted; the CSP is right and the
technique is simply unavailable.

So the options are a human's call:

1. **Accept 96** with the BRAND §2 rationale, as #39 did for axe.
2. **Recolour** the gold marker to reach 4.5:1 — a BRAND change.
3. **Generate a class per index** rather than an inline property, so CSS
   `content` becomes usable. More machinery than a decorative numeral warrants,
   but it is the option that reaches 100 without touching the palette.

## Verified

### The bundle carries no secret and no server module

Scanned `dist/client` in full **plus the rendered HTML of every public page** —
an inlined secret would never appear in `dist/client`, which is exactly the gap
"check the bundle" is about. Checked for: the literal values of `SESSION_SECRET`,
`FORM_SECRET`, `IP_HASH_SALT`, `RESEND_API_KEY`, both S3 credentials,
`DATABASE_URL`, `ADMIN_PASSWORD`, `SMTP_URL`, `CONTACT_TO_EMAIL`; those names as
strings; and the markers `PrismaClient`, `@prisma/adapter-pg`, `argon2`,
`nodemailer`, `@aws-sdk/client-s3`, `node:crypto`.

**0 findings — and the scanner was proved first.** Planting the real
`SESSION_SECRET` into a client script produced **9 findings**, so the clean
result means something. The first attempt at that control found nothing because
the planted constant was tree-shaken as dead code; it had to be _used_ to survive
the build.

### Fonts (SPEC §15)

Self-hosted — **no `fonts.googleapis.com` or `fonts.gstatic.com` anywhere in the
rendered page**. 4 woff2 files served from our own origin, `font-display: swap`
on all 6 `@font-face` rules, and exactly **one** `<link rel="preload">`, for the
display face that carries the LCP element.

### Images (SPEC §5, §15)

Verified against rendered markup rather than the component source, with a seeded
cover:

```html
<picture>
  <source
    type="image/avif"
    srcset="
      …-480.avif   480w,
      …-960.avif   960w,
      …-1440.avif 1440w,
      …-1920.avif 1920w
    "
    sizes="…"
  />
  <source type="image/webp" srcset="…" sizes="…" />
  <img
    src="…-1920.webp"
    alt="A dashboard screenshot"
    width="1920"
    height="1280"
    loading="eager"
    decoding="async"
    fetchpriority="high"
    …
  />
</picture>
```

AVIF first, WebP fallback, explicit `width`/`height` on both the LQIP and the
real image — which is why CLS is 0 rather than merely small.

## The CI budget check, and the two controls it needed

`pnpm budget:js` fetches each public page as a browser would and counts every
script. A new `budget` job runs it on every PR, sharing the `integration` job's
stack because rendering needs the database.

**It measures rendered pages, not `dist/`, and that is load-bearing.** Astro
inlines small module scripts and only emits a separate file once they grow — so
summing `dist/client/**/*.js` reports 1.6 KB where the home page ships 2.2 KB,
and the number would _fall_ as scripts got bigger. A budget that moves the wrong
way under load is not a budget.

Controls, because a check that never fails is indistinguishable from a passing
build:

| Control                                        | Result                               |
| ---------------------------------------------- | ------------------------------------ |
| lower the ceiling to 1 KB                      | **fails**, naming the heaviest page  |
| a public page imports an extra external module | counted: `imported 0 B` → **1525 B** |

That second one found a real hole in my first version. Astro does not emit
`<script src>` for a page script — it emits an inline module that _imports_ the
real file, so counting only what sits inside the tag measured the pointer and not
the payload. The check now follows imports transitively.

Two earlier attempts at that control failed for reasons worth recording, since
both looked like the checker was fine: **40 KB of filler was constant-folded
away** (only `FILLER.length` was used, which esbuild knows statically), and a
second attempt made `astro check` fail, so the measurement ran against a stale
`dist/`.

Gate: `typecheck` 0 errors / 0 warnings / 0 hints · `lint` PASS · `test` **770
passed, 115 skipped** · `test:integration:ci` all 115 ran, none skipped · `build`
PASS. Not run: `test:e2e` — Playwright arrives with #39, still open.

## Blocked

Nothing, but **the Accessibility 100 target needs a decision** — options above.

## Next

- Once #39 merges, the `budget` job and the `e2e` job could share one booted
  server rather than each starting their own.
- INP needs field data to be real. Worth a note in SPEC §15 that the lab number
  is TBT, or wiring `web-vitals` to a collector post-launch.

## Content TODOs

None.
