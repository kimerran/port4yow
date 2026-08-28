import type { MiddlewareHandler } from "astro";
import { logger, newCorrelationId } from "./lib/logger";

/**
 * Security headers, and nothing else (SPEC §14).
 *
 * Session hydration and the admin guard used to live here and are gone with the
 * admin: there is no cookie to read, no session to slide, and no `/admin` to
 * protect. What is left runs on every request and does no I/O at all.
 *
 * CSP is NOT set here: `security.csp` in astro.config.mjs owns it, because Astro
 * hashes the inline scripts and styles it emits and a hand-rolled header could
 * not.
 */

/**
 * Applied to EVERY response this middleware returns, including its own 500.
 *
 * The headers belong to the response, not to the happy path — an early return
 * that skips this block is how a response ends up on the wire with none of them.
 */
function applySecurityHeaders(response: Response): Response {
  // SPEC §14.1 — HTTPS only. Sent unconditionally: a browser ignores HSTS over
  // plain HTTP, so there is no need to sniff the protocol, and omitting it
  // behind a proxy that terminates TLS is the more common mistake.
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload",
  );

  // SPEC §14.3
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  );
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");

  // Companion to CSP frame-ancestors, for anything that predates CSP support.
  response.headers.set("X-Frame-Options", "DENY");

  /**
   * `frame-ancestors` as a real HEADER, because the static build moved Astro's
   * CSP into a `<meta http-equiv>` tag — and browsers ignore `frame-ancestors`
   * in a meta tag by specification. The directive was still in the policy,
   * still looked right in view-source, and was doing nothing.
   *
   * A second CSP header does not weaken the meta policy: multiple policies are
   * INTERSECTED, so each must allow a resource. This one restricts framing and
   * says nothing about anything else, which is exactly the missing piece.
   *
   * `X-Frame-Options` above already covered the clickjacking case in practice;
   * this is the standards-track control that was supposed to be doing it.
   */
  response.headers.append("Content-Security-Policy", "frame-ancestors 'none'");

  /**
   * #43 — an error response with no `Cache-Control` is *heuristically*
   * cacheable, and a 404 is the shape where that bites.
   *
   * Only when nothing has been set: a route that has thought about its own
   * caching wins, which is why this reads before it writes.
   *
   * **Known limit:** this keys on the status, and a mid-stream throw produces a
   * truncated error document under a **200**. That response is heuristically
   * cacheable and this rule cannot see it. `middleware.test.ts` pins the
   * boundary — a 200 that sets no policy is deliberately left alone, because
   * inventing one here would override SPEC §5.
   */
  if (response.status >= 400 && !response.headers.has("Cache-Control")) {
    response.headers.set("Cache-Control", "no-store");
  }

  return response;
}

export const onRequest: MiddlewareHandler = async (context, next) => {
  /**
   * #43 — `next()` throwing used to skip `applySecurityHeaders` entirely, so an
   * uncaught throw produced a 500 with not one security header on it. The
   * headers belong to the response, so the response must always be ours.
   *
   * ## The bound on this, stated exactly
   *
   * This covers **anything that throws before the response resolves** — not
   * every 500. Streaming is on (Astro's default), so a component that throws
   * after the first chunk has flushed is past this `try`: `next()` has already
   * returned a **200** and the headers are already on the wire. Measured
   * against a built server, the same build, the difference being only *when*
   * the throw happens:
   *
   * | throw in | status | Cache-Control | body | logged |
   * | --- | --- | --- | --- | --- |
   * | frontmatter | 500 | `no-store` | generic + id | yes |
   * | a component, 30 ms in | **200** | **none** | truncated HTML | **no** |
   *
   * Far less reachable than it was: almost every page is prerendered now, so
   * there is no per-request frontmatter left to throw from on those routes.
   */
  let response: Response;
  try {
    response = await next();
  } catch (cause) {
    const correlationId = newCorrelationId();
    logger.error("unhandled error", {
      correlationId,
      path: context.url.pathname,
      reason: cause instanceof Error ? cause.message : "unknown",
    });
    // Generic, brand-voiced, and carrying the id from the log line so a report
    // can be traced (SPEC §14.11). No stack, no framework name.
    return applySecurityHeaders(
      new Response(
        JSON.stringify({
          ok: false,
          error: "Something went wrong on our end.",
          correlationId,
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        },
      ),
    );
  }

  return applySecurityHeaders(response);
};
