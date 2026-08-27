import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { join } from "node:path";
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
 *
 * ## The gate list is derived, not maintained
 *
 * It used to be nine names typed out here, which left half the original problem
 * in place: the glob would *collect* a new suite, and then that suite's own
 * `describe.skipIf` would skip it because nobody had added its gate. Measured —
 * a file gated on an unregistered `NEWTHING_IT` gave
 * `Test Files 9 passed | 1 skipped (10)` and **exit code 0**. A test that
 * exists, is collected, never runs, and reports success: this suite's own
 * thesis in miniature, and exactly the mechanism that hid 115 tests behind a
 * green tick from #19 to #38.
 *
 * So the names are read out of the files themselves. Adding a suite with a new
 * gate now needs no edit here, and cannot be quiet.
 */

const INTEGRATION_GLOB = "src/**/*.integration.test.ts";

/** Every `process.env.SOMETHING_IT` the matched files actually read. */
function discoverGates(): string[] {
  const files = globSync(INTEGRATION_GLOB, { cwd: import.meta.dirname });
  const gates = new Set<string>();
  for (const file of files) {
    const source = readFileSync(join(import.meta.dirname, file), "utf8");
    for (const match of source.matchAll(/process\.env\.([A-Z0-9_]+_IT)\b/g)) {
      gates.add(match[1] as string);
    }
  }
  if (gates.size === 0) {
    // A regex that silently matches nothing would turn every suite off while
    // still reporting success — the failure this whole file is about.
    throw new Error(
      `No *_IT gates found in ${INTEGRATION_GLOB}. The pattern is wrong, or the suites are.`,
    );
  }
  return [...gates].sort();
}

export default defineConfig({
  test: {
    include: [INTEGRATION_GLOB],
    /** See above — this is correctness, not tuning. */
    fileParallelism: false,
    env: Object.fromEntries(discoverGates().map((gate) => [gate, "1"])),
  },
});
