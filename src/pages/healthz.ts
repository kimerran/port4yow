import type { APIRoute } from "astro";
import { db } from "../lib/db";
import { logger } from "../lib/logger";

export const prerender = false;

/**
 * `GET /healthz` (SPEC §5, §13, #35).
 *
 * Railway polls this with a 30-second timeout and will restart the container on
 * a non-200, so the check has to mean something and has to be cheap.
 *
 * `SELECT 1` rather than a real query: it proves the pool can hand out a working
 * connection, which is the failure this endpoint exists to catch. Counting rows
 * would also exercise a table, and a slow table would then restart a service
 * that is merely busy.
 */

/**
 * Process start, captured at module load.
 *
 * `process.uptime()` would be the obvious choice and is subtly wrong here: it
 * measures the Node process, which under a dev server or a warm reload is older
 * than the app. Measuring from this module's own load is what the caller
 * actually wants to know.
 */
const startedAt = Date.now();

/**
 * How long the probe may take before it is treated as a failure.
 *
 * `docker stop` gives a fast connection-refused, but a black-holed network gives
 * a HANG — and `$queryRaw` would then sit there past Railway's
 * `healthcheckTimeout: 30`. Railway declares the poll failed either way, so this
 * does not change the verdict; what it changes is that the request returns,
 * releasing the connection and putting the reason in our log rather than leaving
 * an open socket for the platform to time out.
 *
 * Comfortably under 30 so the answer always comes from us.
 */
const PROBE_TIMEOUT_MS = 5_000;

/**
 * Rejects if the probe has not settled in time.
 *
 * `Promise.race` rather than an abort: the driver's query is not cancellable
 * here, so the honest description is "we stopped waiting", not "we cancelled
 * it". The timer is cleared on the winning path so a hung probe cannot keep the
 * process alive.
 */
async function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error("health probe timed out"));
        }, PROBE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Nothing here names a driver, a version or a host.
 *
 * A health endpoint is unauthenticated by construction — Railway has to reach it
 * before a session exists — so everything it returns is public. SPEC §5 says it
 * must not leak framework versions, connection strings or environment details,
 * and the way to guarantee that is to build the body from a fixed shape rather
 * than from anything the environment supplies.
 */
export const GET: APIRoute = async () => {
  const uptime = Math.floor((Date.now() - startedAt) / 1000);

  try {
    await withTimeout(db.$queryRaw`SELECT 1`);
  } catch (cause) {
    /**
     * The reason is logged, never returned. `cause.message` from a driver
     * routinely contains the host, the port and the database name — which is
     * exactly the connection string this endpoint must not leak.
     */
    logger.error("healthz: database unreachable", {
      reason: cause instanceof Error ? cause.message : "unknown",
    });

    return new Response(
      JSON.stringify({ status: "error", uptime, db: "error" }),
      {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          // A cached health check is not a health check.
          "Cache-Control": "no-store",
        },
      },
    );
  }

  return new Response(JSON.stringify({ status: "ok", uptime, db: "ok" }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
};
