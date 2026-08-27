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

  // Must stay last: turns off every rule Prettier owns.
  prettier,
);
