import type { APIRoute } from "astro";

export const prerender = false;

/**
 * `GET /healthz` (SPEC §5, §13, #35).
 *
 * Railway polls this with a 30-second timeout and will restart the container on
 * a non-200.
 *
 * It used to run `SELECT 1` against Postgres, because the database was the
 * dependency most likely to be up-but-unreachable and taking the container down
 * was the right response. There is no database now: every page is prerendered
 * HTML and the one dynamic route talks to Resend over HTTPS. A liveness check is
 * all that is left to report, and reporting only what it can actually prove is
 * the point — a health endpoint that claims to check a dependency it no longer
 * has is worse than one that admits it is just a heartbeat.
 *
 * Resend is deliberately NOT probed. It is a third party: a blip there would
 * restart a container that is serving the whole site correctly, and the contact
 * route already fails closed on its own.
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
 * Nothing here names a framework, a version or a host.
 *
 * A health endpoint is unauthenticated by construction, so everything it returns
 * is public. SPEC §5 says it must not leak framework versions or environment
 * details, and the way to guarantee that is to build the body from a fixed shape
 * rather than from anything the environment supplies.
 */
export const GET: APIRoute = () => {
  const uptime = Math.floor((Date.now() - startedAt) / 1000);

  return new Response(JSON.stringify({ status: "ok", uptime }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // A cached health check is not a health check.
      "Cache-Control": "no-store",
    },
  });
};
