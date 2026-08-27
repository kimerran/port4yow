# 26 · AdminLayout, dashboard, and the Astro Actions foundation

## Done

- `src/layouts/AdminLayout.astro` — the admin shell, same tokens as the public
  site, no second design language, no dark mode.
- `GET /admin` — unread messages, undelivered messages, project counts by
  status, last sign-in.
- `src/actions/index.ts` — the Actions foundation the CRUD issues extend.
- `src/lib/admin.ts` — `assertAdmin` and `getDashboardStats`, testable.

## Changed

| File                              | Why                                                  |
| --------------------------------- | ---------------------------------------------------- |
| `src/lib/admin.ts`                | new — the authorization rule and the dashboard query |
| `src/actions/index.ts`            | new — Actions foundation, a thin adapter             |
| `src/layouts/AdminLayout.astro`   | new — the shell                                      |
| `src/pages/admin/index.astro`     | new — the dashboard                                  |
| `src/lib/__tests__/admin.test.ts` | new — 12 tests                                       |

## Decisions

**Middleware is not authorization for Actions, and this is the reason the guard
exists.** #24 guards `/admin/*` and `/api/admin/*`. Actions are served from
`/_actions/*` — a path space that guard never sees. An action relying on the
middleware would be reachable, unauthenticated, by anyone who knows the endpoint
name. **Measured, not argued:** `POST /_actions/getStats` with no cookie returns
`401 UNAUTHORIZED`, and it is the action's own `requireAdmin` that refuses it,
because middleware never ran a guard on that path.

So every action starts with `requireAdmin(context)`, and no action reads identity
from its input. SPEC §6: "Never trust a hidden form field for identity or
authorization" — an action taking a `userId` argument would let any caller act as
anyone. A test asserts `assertAdmin` has exactly one parameter, so growing a
second one is a visible change.

**The logic lives in `src/lib/admin.ts`, not in the actions module.**
`astro:actions` is a virtual module only Astro's build resolves, so anything in
`src/actions/index.ts` is untestable under vitest. The single most important rule
in the admin needed to be testable, so it moved; the action file is a thin
adapter that maps `AdminAuthError` to `ActionError`.

**`astro/zod`, not `astro:schema`.** The `astro:schema` re-export is deprecated
as of Astro 7 and removed in Astro 8. Using the supported path keeps the gate at
0/0/0 today rather than at the next major.

**`AdminLayout` is not `BaseLayout`.** BaseLayout carries the facet lattice, the
scroll rail and the public navigation — none of which belong behind a login — and
its client script would be the only JavaScript on an admin page. Sharing it would
mean adding conditionals to a public file for the benefit of a private one.

**`noindex` / `no-store` are not repeated in the layout.** #24's middleware sets
them for every `/admin/*` response, including the guard's own redirect and 401.
One place to change them. (A `<meta name="robots">` is in the head as belt and
braces; it costs nothing and covers a hand-saved page.)

**Sign out is a form, not a link.** #25 made logout POST-only precisely so an
`<img src>` anywhere on the internet cannot sign the admin out; a `<a href>` here
would have quietly undone that.

**Undelivered excludes SPAM.** #20's wrapper leaves `deliveredAt` null when a
send fails and #22 still answers 200, so this count is the only place a failed
send becomes visible to a human. Counting SPAM would report a delivery failure
that never happened — no mail is attempted for it.

## Verified

Gate re-run after the last edit: `typecheck` 0 errors / 0 warnings / 0 hints ·
`lint` PASS · `test` **356** passed, 35 skipped · `build` PASS. Integration
**35/35**.

Against a running server with real data:

| Check                                 | Result                                                            |
| ------------------------------------- | ----------------------------------------------------------------- |
| Unauthenticated `/admin`              | 302 → `/admin/login?next=%2Fadmin`, with `no-store` and `noindex` |
| `POST /_actions/getStats`, no session | **401** `AstroActionError` `UNAUTHORIZED`                         |
| Authenticated `/admin`                | 200, 6 412 bytes, `no-store` + `noindex`                          |
| `POST /_actions/getStats`, signed in  | 200 with the stats payload                                        |

Counts rendered against the database, which held 2 `NEW` (both undelivered),
1 `READ` (delivered), 3 `PUBLISHED` and 1 `DRAFT` project:

| Card               | Rendered |
| ------------------ | -------- |
| Unread messages    | **2**    |
| Undelivered        | **2**    |
| Published projects | **3**    |
| Drafts             | **1**    |
| Archived (list)    | **0**    |

Last sign-in rendered as `27 Aug 2026, 12:21 UTC`.

Keyboard: 10 focusable elements reached by real `Tab` presses, every one with a
`2px solid` ring; the six nav links and the sign-out button are all 44px. axe on
the dashboard: **0 violations**. axe on the login page: **0**.

Mutation results:

| Mutation                                              | Tests failed |
| ----------------------------------------------------- | ------------ |
| `assertAdmin` returns instead of throwing (fail open) | 3            |
| let a missing status be `undefined` instead of 0      | 2            |
| count SPAM as undelivered                             | 1            |
| count every message as unread                         | 1            |

**Client bundle:** 0 files for `argon2`, `assertAdmin`, `passwordHash`,
`getDashboardStats`, `prisma`.

## Found but not fixed

**The skip link is 26px tall when focused, below BRAND §9's 44px.** Measured on
both layouts: the admin copy is byte-identical to the public one shipped in #10,
so this is not a regression from this issue. It is keyboard-only and invisible to
touch, so it is arguably not a "tap target" at all — but the rule does not carve
that out. Fixing it properly means changing `BaseLayout` too, which is outside
this issue. Worth its own issue if you want the rule read strictly.

## Blocked

Nothing blocks this issue.

## Next

- #27–#31 add one action per operation to `src/actions/index.ts`, each starting
  with `requireAdmin` and each with a Zod input schema. `getStats` is the
  reference shape: guard first, schema second, work third.
- The nav links to `/admin/projects`, `/admin/stack`, `/admin/messages` and
  `/admin/settings` currently 404 — those are #27, #29, #30 and #31.
- CI still runs no integration suite; `ci.yml` needs Postgres and Mailpit
  services. Open since #19.

## Content TODOs

None.
