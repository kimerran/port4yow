#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The integration suite for CI: run it, then **fail on any skipped test**.
 *
 * `vitest.integration.config.ts` derives the `*_IT` gates from the files
 * themselves, so a suite can no longer be skipped because someone forgot to
 * register it. This is the second half — asserting the outcome rather than the
 * wiring, because a mechanism that is correct today is not the same as a run
 * that actually executed everything.
 *
 * In CI a skip can only mean a gate went unset or `DATABASE_URL` is missing,
 * and both are conditions you want loud. Locally, skipping is the correct
 * behaviour with nothing running — which is why this is a separate command and
 * `pnpm test:integration` still skips quietly.
 *
 * This exists because a green tick covered zero integration tests from #19 to
 * #38, and a narrower version of the same thing survived that fix: a file gated
 * on an unregistered name reported `9 passed | 1 skipped` and **exit 0**.
 */

const report = join(tmpdir(), `integration-${String(process.pid)}.json`);

const result = spawnSync(
  "pnpm",
  [
    "exec",
    "vitest",
    "run",
    "--config",
    "vitest.integration.config.ts",
    "--reporter=default",
    "--reporter=json",
    `--outputFile=${report}`,
  ],
  { stdio: "inherit" },
);

let summary;
try {
  summary = JSON.parse(readFileSync(report, "utf8"));
} finally {
  rmSync(report, { force: true });
}

if (result.status !== 0) process.exit(result.status ?? 1);

const skipped = summary.numPendingTests ?? 0;
const todo = summary.numTodoTests ?? 0;

if (skipped > 0 || todo > 0) {
  const names = (summary.testResults ?? [])
    .flatMap((file) =>
      (file.assertionResults ?? [])
        // vitest reports these as "skipped" in its JSON, while the summary
        // counts them under `numPendingTests` — checked against a real run
        // rather than assumed, because the first version filtered on "pending"
        // and named nothing.
        .filter((t) => t.status === "skipped" || t.status === "todo")
        .map((t) => `  ${file.name}: ${t.fullName}`),
    )
    .slice(0, 20);

  process.stderr.write(
    `\nIntegration run reported ${String(skipped + todo)} skipped test(s).\n` +
      `In CI a skip means a gate went unset or DATABASE_URL is missing — either\n` +
      `way the test did not run, and a green tick would be a lie.\n\n` +
      `${names.join("\n")}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `\nAll ${String(summary.numTotalTests ?? 0)} integration tests ran — none skipped.\n`,
);
