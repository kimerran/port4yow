import type { MiddlewareHandler } from "astro";

/**
 * Security headers (SPEC §14.1, §14.3). Runs on every request, so it stays thin
 * and total — AGENT §2.
 *
 * CSP itself is NOT set here: `security.csp` in astro.config.mjs owns it, because
 * Astro hashes the inline scripts and styles it emits and a hand-rolled header
 * could not (AGENT §2). These are the directives Astro has no equivalent for.
 *
 * Session hydration and the /admin guard land in #24; this file is deliberately
 * headers-only until then.
 */
export const onRequest: MiddlewareHandler = async (context, next) => {
  const response = await next();

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

  // Companion to CSP's frame-ancestors, for anything that predates CSP support.
  response.headers.set("X-Frame-Options", "DENY");

  // SPEC §6 / §14.14 — admin is never cached and never indexed. The session
  // guard itself is #24; these headers are correct regardless of who is signed in.
  // Exactly /admin or a path beneath it. A bare startsWith("/admin") also matches
  // /administrators and /admin-guide, which would silently de-index a legitimate
  // public page — over-applying rather than under-applying, but still wrong.
  const { pathname } = context.url;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }

  return response;
};
