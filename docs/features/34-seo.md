# 34 · SEO — robots, sitemap, JSON-LD, cards

## Done

- `/robots.txt` — disallows `/admin` and `/api`, points at the sitemap.
- `/sitemap.xml` — home plus published projects, generated from the database.
- `Person` JSON-LD on the home page; `Article` JSON-LD enriched on project pages.
- Per-project OG image, with alt text, and a correct `og:type`.

## Changed

| File                                          | Why                                         |
| --------------------------------------------- | ------------------------------------------- |
| `src/pages/robots.txt.ts`                     | new                                         |
| `src/pages/sitemap.xml.ts`                    | new                                         |
| `src/pages/index.astro`                       | `Person` JSON-LD                            |
| `src/pages/work/[slug].astro`                 | OG image, `og:type`, `dateModified`         |
| `src/layouts/BaseLayout.astro`                | `ogType`, `ogImageAlt`                      |
| `src/lib/project.ts`                          | exposes `coverKey`, `coverAlt`, `updatedAt` |
| `src/pages/__tests__/seo.integration.test.ts` | new — 9 tests                               |

## Decisions

**Both files are dynamic routes, not static assets.** The sitemap has to be, or a
DRAFT can appear in it — a hand-maintained sitemap drifts, and the direction it
drifts is always "still lists something that is no longer public". `robots.txt`
follows because its `Sitemap:` line needs the real origin, and a hardcoded domain
is wrong in every environment but one.

**`robots.txt` is not redundant with `X-Robots-Tag`.** #24 already sends
`noindex` on every `/admin/*` response, but that header is only seen once a page
has been **fetched**. `robots.txt` is what stops the fetch. `/api` is disallowed
for the same reason plus a second one: crawling `/api/media/…` would pull every
derivative through our own origin for no benefit.

**The sitemap's `status: "PUBLISHED"` filter is in the WHERE clause**, the same
shape as `getPublishedProject` (#15) — a draft is never loaded, so it cannot be
leaked by a later mistake.

**The home page's `lastmod` is the newest project's, not `now()`.** Falling back
to the current time tells a crawler the page changed on every request, which is
worse than telling it nothing. With no projects at all, `lastmod` is omitted
entirely.

**XML escaping, even though nothing needs it today.** A slug is `[a-z0-9-]`
(#27), so no current value contains a predefined entity. But the sitemap is
generated from data, and "the data can't contain that" is the assumption that
stops being true when someone adds a query parameter.

**The OG image is the widest WebP.** #17 picks its fallback `<img src>` from the
non-AVIF rows precisely because that is the format everything decodes; an OG
image is scraped by clients with far worse format support than a browser, so an
AVIF row would be exactly the wrong choice.

## Found while verifying

**`og:type` was `website` on project pages.** Hardcoded in `BaseLayout` since
#10. So every project page told scrapers it was a _site_, while the `Article`
JSON-LD on the same page said otherwise — two answers to one question, which is
worse than either answer alone. Now `ogType`, defaulting to `website`, set to
`article` on `/work/[slug]`.

**The OG image had no alt.** A scraper renders `og:image:alt` as the image's
description; without it the card is an unlabelled picture for anyone using a
screen reader on it. `coverAlt` is now carried through — and it costs nothing,
because #28 already makes alt text mandatory at upload.

**`Article` had no `dateModified`.** A crawler uses it to decide whether to
re-fetch, and an Article without one reads as never having changed since it was
first seen.

## Verified

Gate re-run after the last edit: `typecheck` 0 errors / 0 warnings / 0 hints ·
`lint` PASS · `test` **465** passed, 97 skipped · `build` PASS. Integration
**97/97** across eight suites.

| Acceptance criterion                                             | Result                                                                                   |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| A DRAFT appears in neither the sitemap nor any OG/JSON-LD output | sitemap: 0 hits; home page: absent; project page: absent; `/work/secret-draft` → **404** |
| `robots.txt` disallows `/admin` and `/api`                       | both present, and no blanket `Disallow: /`                                               |
| JSON-LD validates on both page types                             | structurally validated — see the caveat below                                            |
| Lighthouse SEO = 100 on the home page and a project page         | **100 and 100**, zero failing audits on either                                           |

Served live:

```
User-agent: *
Disallow: /admin
Disallow: /api

Sitemap: http://localhost:5760/sitemap.xml
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>…/</loc><lastmod>2026-08-27T13:57:44.781Z</lastmod></url>
  <url><loc>…/work/live-project</loc><lastmod>…</lastmod></url>
</urlset>
```

The seeded DRAFT (`secret-draft`) is in none of it.

Open Graph, after the fixes:

| Page    | `og:type`     | `og:image`                                  | `og:image:alt` |
| ------- | ------------- | ------------------------------------------- | -------------- |
| home    | `website`     | —                                           | —              |
| project | **`article`** | `…/api/media/projects/demo/cover-1920.webp` | `A cover`      |

Mutation results — each asserted to have applied:

| Mutation                   | Tests failed |
| -------------------------- | ------------ |
| list drafts in the sitemap | 2            |
| disallow the whole site    | 2            |
| stop disallowing `/admin`  | 1            |
| stop disallowing `/api`    | 1            |
| drop the sitemap namespace | 1            |

## Honest caveat on the Rich Results criterion

**I could not run Google's Rich Results test.** It requires a publicly reachable
URL and Google's own service; this ran against `localhost`. Saying "validates in
the Rich Results test" would be reporting a check I did not perform.

What I did instead, against the served HTML: both blocks parse as JSON, carry
`@context: https://schema.org` and a recognised `@type`, and hold every property
Google's Article documentation lists as required — `headline`, `image`,
`datePublished`, `dateModified`, and an `author` with its own `@type` and `name`
— with both dates ISO-8601 and the image absolute. `Person` carries `name`, and
its `sameAs` drops empty entries rather than emitting a blank string (#31 stores
`""` for "no link").

That is a strong structural check, not the criterion as written. **Worth running
the real test once the site is on its domain.**

## Blocked

Nothing blocks this issue.

## Next

- Re-run the Rich Results test against `https://mh.neri.ph` after deploy.
- #43's header sweep will re-check `robots.txt` and the admin `noindex` together.
- CI still runs no integration suite. Open since #19.

## Content TODOs

None.
