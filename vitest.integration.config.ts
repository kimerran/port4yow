import { defineConfig } from "vitest/config";

/**
 * The integration suite (#38, SPEC §16) — everything that needs a real
 * Postgres, MinIO and Mailpit rather than a mock.
 *
 * ## Why this is a separate config and not a longer command
 *
 * `test:integration` used to be one line in `package.json` carrying nine
 * `*_IT=1` flags, `--no-file-parallelism`, and nine explicit file paths. Three
 * things were wrong with that:
 *
 * - **A new integration test was invisible until someone remembered to add its
 *   path and its flag.** The file list here is a glob, so it cannot fall behind.
 * - **`--no-file-parallelism` is load-bearing and looked like a preference.**
 *   The suites share one database and each clears the tables it owns in
 *   `beforeEach`, so two files running concurrently clear each other's rows.
 *   Measured: sequential passes 115/115 in file order, reverse order, and two
 *   different shuffles; file-parallel fails **8 of 9 files, 25 tests**. As a CLI
 *   flag that is one careless edit from an afternoon of "flaky" tests. As
 *   `fileParallelism: false` in a config with this comment attached, it is a
 *   decision with its reason next to it.
 * - **The flags belong to the environment, not the invocation.** CI and a
 *   developer's shell should not be able to disagree about which suites ran.
 *
 * The `*_IT` gates stay: without a database these files must skip rather than
 * fail, so `pnpm test` remains runnable on a laptop with nothing running.
 */
const INTEGRATION_GATES = [
  "RATELIMIT_IT",
  "CONTACT_IT",
  "LOGIN_IT",
  "PROJECTS_IT",
  "STACK_IT",
  "UPLOAD_IT",
  "MESSAGES_IT",
  "SEO_IT",
  "JOBS_IT",
] as const;

export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    /** See above — this is correctness, not tuning. */
    fileParallelism: false,
    env: Object.fromEntries(INTEGRATION_GATES.map((gate) => [gate, "1"])),
  },
});
