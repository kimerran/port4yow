import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    /**
     * TEMPORARY — remove when #37 lands the first unit suite.
     *
     * `vitest run` exits 1 on "no test files found", which would make CI red by
     * construction while the repo has no tests. This lives here rather than in
     * the `test` script so SPEC §12's script stays byte-identical, and so the
     * next person to add a suite finds the workaround instead of inheriting a
     * silently-green `pnpm test`.
     *
     * It does mean any slice that forgets to write tests still passes. That is
     * the cost of the flag existing at all; deleting it is #37's job.
     */
    passWithNoTests: true,
  },
});
