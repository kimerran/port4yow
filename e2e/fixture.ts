import { readFileSync } from "node:fs";
import { FIXTURE_PATH, type E2EFixture } from "./global-setup.ts";

/** What `global-setup.ts` seeded, read once per spec file. */
export const fixture = (): E2EFixture =>
  JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as E2EFixture;

/**
 * A distinct forwarded client per test, per project, per run.
 *
 * SPEC §7 rate-limits contact to 5/hr/IP and login to 10/15min/IP. This suite
 * exceeds both on its own, and every time it bit, the failure named something
 * else — "the success button never appeared", "sign in did not navigate". It
 * took three attempts to get this right, and each attempt failed for a
 * different reason worth recording:
 *
 * 1. **A module-level counter.** Restarts every time Playwright loads the file,
 *    so `desktop-1440` and `mobile-375` both began at `.1` and shared a bucket.
 * 2. **A hash of `testInfo.titlePath`.** Stable across that, but `titlePath`
 *    does not include the project — so the same test in three projects still
 *    shared one address, three logins deep.
 * 3. **No per-run entropy.** Three logins per run is well under the limit, but
 *    four runs inside fifteen minutes is not, so the suite broke for whoever
 *    ran it repeatedly — which is exactly what you do while writing it.
 *
 * Project name plus title plus a salt generated once per `global-setup` fixes
 * all three: unique within a run, and never reused across runs.
 *
 * Varying the header beats clearing the `RateLimit` table: no shared mutable
 * state, no ordering assumption, and it exercises `clientIpFrom` — which reads
 * the *first* entry — on the way through. Both blocks below are RFC 5737
 * documentation ranges, so these can never route anywhere real.
 */
export const forwardedFor = (testInfo: {
  project: { name: string };
  titlePath: string[];
}): string => {
  const identity = `${fixture().salt}|${testInfo.project.name}|${testInfo.titlePath.join(">")}`;

  // FNV-1a: small, stable, dependency-free.
  let hash = 2166136261;
  for (let i = 0; i < identity.length; i++) {
    hash ^= identity.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const value = Math.abs(hash);
  const block = value % 2 === 0 ? "203.0.113" : "198.51.100";
  return `${block}.${String(((value >>> 1) % 254) + 1)}`;
};
