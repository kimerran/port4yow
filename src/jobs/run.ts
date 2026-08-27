#!/usr/bin/env node
import { JOBS, JOB_NAMES, type JobName } from "./index.ts";
import { db } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";

/**
 * The cron entry point: `pnpm job <name>` (SPEC §11, §13, #35).
 *
 * One runner rather than three scripts so every job gets the same exit-code
 * contract, the same disconnect, and the same "unknown job" behaviour. Railway
 * cron reports a non-zero exit as a failed run, which is the only signal a
 * schedule gives you.
 */
const name = process.argv[2];

const isJobName = (value: string | undefined): value is JobName =>
  typeof value === "string" && JOB_NAMES.includes(value as JobName);

if (!isJobName(name)) {
  // Not a logger call: this is a usage error for a human at a terminal, and it
  // belongs on stderr in plain words rather than in a JSON log line.
  process.stderr.write(
    `Unknown job ${JSON.stringify(name)}. Known jobs: ${JOB_NAMES.join(", ")}\n`,
  );
  process.exit(2);
}

try {
  const result = await JOBS[name]();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  await db.$disconnect();
  process.exit(0);
} catch (cause) {
  logger.error("job failed", {
    job: name,
    reason: cause instanceof Error ? cause.message : "unknown",
  });
  await db.$disconnect();
  // Non-zero so the schedule records a failure rather than a silent no-op.
  process.exit(1);
}
