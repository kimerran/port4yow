# #3 — ESLint flat config + Prettier with codebase bans enforced

## Done

`pnpm lint` (`eslint . && prettier --check .`) passes repo-wide, and every AGENT ban is
proven to fire rather than assumed to.

**Mutation-checked — each banned pattern written to a probe file, linted, then removed:**

| Pattern             | Caught by                                           |
| ------------------- | --------------------------------------------------- |
| `const x: any = 1`  | `@typescript-eslint/no-explicit-any`                |
| `// @ts-ignore`     | `@typescript-eslint/ban-ts-comment`                 |
| `a!.length`         | `@typescript-eslint/no-non-null-assertion`          |
| `eval("1")`         | `no-eval`                                           |
| `new Function(...)` | `no-new-func`, `@typescript-eslint/no-implied-eval` |
| `console.log(...)`  | `no-console`                                        |
| `catch {}`          | `no-empty`                                          |
| unawaited promise   | `@typescript-eslint/no-floating-promises`           |
| unused variable     | `@typescript-eslint/no-unused-vars`                 |

A clean file passes (control). `.astro` files are linted too — `const a: any` inside a
frontmatter block is caught by `no-explicit-any`, so the rules are not silently
TypeScript-only.

`pnpm typecheck` **0 errors / 0 warnings / 0 hints** · `pnpm build` OK · built CSS still
4,849 B, so #2's source scoping is intact · `pnpm install --frozen-lockfile` clean.

## Changed

- `eslint.config.js` — new flat config. Each rule block cites the AGENT line it mechanises.
- `README.md`, `auto-dev.md` — formatted. These were the known-failing pair #2 deliberately
  deferred here; formatting them is what makes `pnpm lint` green. **Verified the reflow did
  not break `auto-dev.md`'s selection block** by extracting and running it verbatim
  afterwards — it still returns the right issue.
- Versions resolved with `pnpm view`: eslint **10.9.1**, @eslint/js **10.0.1**,
  typescript-eslint **8.68.0**, eslint-plugin-astro **3.1.0**, eslint-plugin-jsx-a11y
  **6.10.2**, eslint-config-prettier **10.1.8**, globals **17.11.0**.

## Decisions

- **ESLint 10, not 9 — and this one is forced, not preferred.** The issue title and SPEC §2's
  prose both say "ESLint 9 flat config", but that row's _version target column_ says
  **`latest`**, and `eslint-plugin-astro@3.1.0` — which SPEC §2 mandates by name — declares
  `"eslint": ">=10.0.0"`. ESLint 9 cannot satisfy the plugin the spec requires. Flat config is
  the default in both 9 and 10, so the "flat config" half of the requirement is unaffected.
  Reading "ESLint 9" as naming the config style rather than pinning the major.
- **`eslint-plugin-jsx-a11y` installed** solely as a declared peer of `eslint-plugin-astro`.
  No JSX in this codebase; it is not configured, only present to satisfy resolution.
- **Type-aware rules disabled for `**/*.{js,mjs,cjs}`.** `astro.config.mjs` and
  `eslint.config.js` are not in the TS project, so `recommendedTypeChecked` errors with
  "parser services not available". Preferred over widening `tsconfig.json` to include build
  config, which would drag it into `astro check`.
- **`.astro` files get `project: true`, not `projectService: true`.** `astro-eslint-parser`
  does not support `projectService` and warns that it will downgrade — setting it explicitly
  removes the warning without losing type-aware linting.
- **`defineConfig` from `eslint/config`, not `tseslint.config()`.** The latter is deprecated
  in typescript-eslint 8.68 and `astro check` surfaced it as a `ts(6387)` hint. Both support
  `extends` inside config blocks.
- **`no-console` is `error` repo-wide, off for config/scripts/prisma.** AGENT §4 makes
  `src/lib/logger.ts` the only sanctioned output path, but seed scripts must print (SPEC §4
  requires the seed to report the admin username).
- **`no-non-null-assertion` is repo-wide** though AGENT §2 scopes the ban to "anything derived
  from external input" — a linter cannot tell provenance, and the stricter reading is the safe
  one.

## Blocked

Nothing.

## Next

**#4 — Local dev services via docker-compose.**

## Content TODOs

None; this slice adds no user-facing copy.
