import { db } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";

/**
 * The scheduled jobs from SPEC §11, invoked by Railway cron.
 *
 * ## Idempotence, and what it means here
 *
 * #35 requires each job to be safe to run twice back to back with no additional
 * effect. Every job below is a *predicate over current state* rather than a step
 * in a sequence: "delete rows already past their expiry", "list rows nothing
 * references". Running one twice re-evaluates the predicate, and the second run
 * finds nothing left to do.
 *
 * That is a stronger property than "does not crash on a second run", and it is
 * the reason none of these takes a cursor, a watermark or a last-run timestamp —
 * state like that is what makes a re-run behave differently from a first run.
 */

export interface JobResult {
  job: string;
  deleted?: number;
  found?: number;
  details?: unknown;
}

/**
 * SPEC §11 — delete `Session` rows past `expiresAt`, daily at 03:00 UTC.
 *
 * #23 already deletes an expired session lazily when it is presented, so this is
 * not what makes an expired session invalid — it is what stops the table growing
 * with sessions nobody will ever present again.
 */
export async function pruneSessions(
  now: Date = new Date(),
): Promise<JobResult> {
  const { count } = await db.session.deleteMany({
    where: { expiresAt: { lte: now } },
  });
  logger.info("job: session:prune", { deleted: count });
  return { job: "session:prune", deleted: count };
}

/**
 * SPEC §11 — delete expired `RateLimit` rows, hourly.
 *
 * Also not a correctness mechanism: #19's counter resets an expired window in
 * the same statement that increments it, so a stale row is already harmless.
 * This keeps the table from accumulating one row per IP per hour forever.
 */
export async function pruneRateLimits(
  now: Date = new Date(),
): Promise<JobResult> {
  const { count } = await db.rateLimit.deleteMany({
    where: { expiresAt: { lte: now } },
  });
  logger.info("job: ratelimit:prune", { deleted: count });
  return { job: "ratelimit:prune", deleted: count };
}

export interface OrphanReport extends JobResult {
  found: number;
  keys: string[];
}

/**
 * SPEC §11 — report `MediaAsset` rows with no reference. **Weekly, report only.**
 *
 * ## Why this never deletes, and why that is not timidity
 *
 * SPEC §11 says "report only, never auto-delete", and the reason is visible in
 * the data model. #28 writes **one row per derivative** — eight for a typical
 * upload — but a project references exactly one of them as its cover. So seven
 * of eight rows for a live, published image are unreferenced *by design*, and a
 * job that deleted "unreferenced" rows would delete most of the site's images.
 *
 * The report therefore groups by key stem, and counts a whole group as orphaned
 * only when **no** row in it is referenced. Even then it only prints: deciding
 * that an image is genuinely unused is a judgement about intent, and the cost of
 * being wrong is an image nobody can get back.
 */
export async function reportMediaOrphans(): Promise<OrphanReport> {
  const assets = await db.mediaAsset.findMany({
    select: {
      key: true,
      coverOf: { select: { id: true } },
      projectUses: { select: { projectId: true } },
    },
  });

  /** `projects/{id}/{ulid}-960.webp` → `projects/{id}/{ulid}`. */
  const stemOf = (key: string): string => {
    const match = /^(.*)-\d+\.[A-Za-z0-9]+$/.exec(key);
    return match?.[1] ?? key;
  };

  const groups = new Map<string, { referenced: boolean }>();
  for (const asset of assets) {
    const stem = stemOf(asset.key);
    const group = groups.get(stem) ?? { referenced: false };
    if (asset.coverOf || asset.projectUses.length > 0) group.referenced = true;
    groups.set(stem, group);
  }

  const keys = [...groups.entries()]
    .filter(([, group]) => !group.referenced)
    .map(([stem]) => stem)
    .sort();

  logger.info("job: media:orphans", {
    found: keys.length,
    // The keys are not secrets — they are bucket paths — and the whole point of
    // the job is that a human can act on the list.
    keys,
  });

  return { job: "media:orphans", found: keys.length, keys };
}

export const JOBS = {
  "session:prune": pruneSessions,
  "ratelimit:prune": pruneRateLimits,
  "media:orphans": reportMediaOrphans,
} as const;

export type JobName = keyof typeof JOBS;

export const JOB_NAMES = Object.keys(JOBS) as JobName[];
