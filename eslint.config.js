// ESLint flat config. AGENT §2/§3 are the source of truth for these rules —
// each block below cites the line it mechanises.
import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import astro from "eslint-plugin-astro";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default defineConfig(
  {
    ignores: [
      "dist/**",
      ".astro/**",
      "node_modules/**",
      "src/generated/**", // Prisma output, regenerated in postinstall (AGENT §2)
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...astro.configs.recommended,

  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
  },

  {
    // astro-eslint-parser does not support `projectService` and warns if given it,
    // so .astro files get `project` instead. Type-aware rules still apply.
    files: ["**/*.astro"],
    languageOptions: {
      parserOptions: { project: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node },
    },
  },

  {
    rules: {
      // AGENT §2 — "`any` is banned. Use `unknown` at boundaries and narrow with Zod."
      "@typescript-eslint/no-explicit-any": "error",

      // AGENT §2 — "No `@ts-ignore`; if you must, `@ts-expect-error` with a comment."
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-check": false,
          "ts-expect-error": "allow-with-description",
          minimumDescriptionLength: 10,
        },
      ],

      // AGENT §2 — "No non-null assertions (`!`) on anything derived from external input."
      // Enforced repo-wide: the linter cannot tell which values came from outside.
      "@typescript-eslint/no-non-null-assertion": "error",

      // AGENT §3 — "Things that must never appear in this codebase": eval, new Function.
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",

      // AGENT §4 — "Every `await` that can fail is inside a `try` that does something
      // meaningful — never an empty catch, never a swallowed error."
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "no-empty": ["error", { allowEmptyCatch: false }],

      // AGENT §4 — structured logging via src/lib/logger.ts is the only sanctioned
      // output path. AGENT §3 also bans `console.log` of a request body outright.
      "no-console": "error",

      // AGENT §4 — "No dead code, no unused exports."
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "all",
        },
      ],
    },
  },

  {
    // Build-time config and scripts run in Node before the app boots and legitimately
    // read process.env; src/lib/env.ts is the runtime boundary (SPEC §10), not this.
    files: [
      "*.config.{js,mjs,ts}",
      "scripts/**/*.{js,mjs,ts}",
      "prisma/**/*.ts",
    ],
    languageOptions: { globals: { ...globals.node } },
    rules: { "no-console": "off" },
  },

  {
    // Plain JS/MJS (astro.config.mjs, eslint.config.js) is not in the TS project,
    // so type-aware rules have no parser services and error out. Turn them off
    // for these files rather than widening tsconfig to include build config.
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },

  {
    // AGENT §3 — "`set:html` on unsanitised input" is on the must-never-appear
    // list. The rule ships with eslint-plugin-astro but is NOT in its
    // `recommended` set, so it has to be switched on explicitly. SPEC §14.6
    // permits set:html only on Markdown that has passed rehype-sanitize; the
    // slice that does that (#16) disables this rule on that one line with a
    // justification, rather than leaving the whole codebase unguarded.
    files: ["**/*.astro"],
    rules: { "astro/no-set-html-directive": "error" },
  },

  {
    // AGENT §3 — "`child_process` with interpolated input" and "`process.env.X`
    // read without passing through `env.ts`".
    //
    // Scoped to src/ so build-time config (astro.config.mjs, eslint.config.js)
    // stays free to read process.env — it legitimately does, for the PORT
    // wiring from #1. src/lib/env.ts is exempt because it IS the sanctioned
    // boundary that #7 creates; every other module goes through it (SPEC §10).
    files: ["src/**/*.{ts,astro}"],
    ignores: ["src/lib/env.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "node:child_process",
              message: "AGENT §3 — child_process is banned.",
            },
            {
              name: "child_process",
              message: "AGENT §3 — child_process is banned.",
            },
          ],
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "AGENT §3 — read configuration through src/lib/env.ts, never process.env.",
        },
      ],
    },
  },

  {
    // Test files CONSTRUCT an environment rather than consuming configuration:
    // src/lib/env.ts parses at import and throws without a valid fixture, so a
    // suite must populate process.env before importing anything that reads it.
    // Narrow, deliberate exception to the AGENT §3 ban — application code has no
    // such need and stays covered.
    files: ["**/__tests__/**/*.ts", "**/*.{test,spec}.ts"],
    rules: { "no-restricted-properties": "off" },
  },

  {
    /**
     * `typescript-eslint` cannot type the markup returned from a template
     * expression through `astro-eslint-parser` — a `.map()` rendering elements
     * reports "Unsafe return of a value of type error". TypeScript itself is
     * happy: `astro check` reports 0 errors on the same file, so this is a
     * parser gap, not a real `any` leaking in.
     *
     * Reproduced minimally:
     *   const xs = [{ h: "/a" }];
     *   <ul>{xs.map((x) => <li><a href={x.h}>x</a></li>)}</ul>
     *
     * Scoped to .astro files and to this one rule. Every AGENT §2/§3 ban —
     * no-explicit-any, ban-ts-comment, no-non-null-assertion, no-eval,
     * no-console, set:html, child_process, process.env — stays on everywhere,
     * and `astro check` still type-checks these files properly.
     */
    files: ["**/*.astro"],
    rules: { "@typescript-eslint/no-unsafe-return": "off" },
  },

  // Must stay last: turns off every rule Prettier owns.
  prettier,
);
