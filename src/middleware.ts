import type { MiddlewareHandler } from "astro";
import {
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  validateSession,
} from "./lib/auth";
import { logger } from "./lib/logger";
import { safeNextPath } from "./lib/redirect";

/**
 * Session hydration, the admin guard, and security headers (SPEC §6, §8, §14).
 *
 * Runs on EVERY request, including public pages, so it stays thin and total
 * (AGENT §2). The only database work happens when a session cookie is actually
 * present — an anonymous visitor to the home page does no query at all.
 *
 * CSP is NOT set here: `security.csp` in astro.config.mjs owns it, because Astro
 * hashes the inline scripts and styles it emits and a hand-rolled header could
 * not.
 *
 * **This is not the only authorization check.** SPEC §6 and AGENT §3 both
 * require every admin handler and Astro Action to re-check the session
 * server-side. Middleware is a gate on the front door, not a substitute for
 * locking the rooms.
 */

/** Exactly `/admin` or a path beneath it — never `/administrators`. */
const isAdminPage = (pathname: string): boolean =>
  pathname === "/admin" || pathname.startsWith("/admin/");

/** Exactly `/api/admin` or a path beneath it. */
const isAdminApi = (pathname: string): boolean =>
  pathname === "/api/admin" || pathname.startsWith("/api/admin/");

const LOGIN_PATH = "/admin/login";

/**
 * Applied to EVERY response this middleware returns, including the guard's own
 * redirect and 401.
 *
 * Returning those early used to skip this block entirely, so an admin redirect
 * carried no `Cache-Control` — and a heuristically cached 302 would keep
 * bouncing a visitor to the login page after they had signed in. The headers
 * belong to the response, not to the happy path.
 */
function applySecurityHeaders(response: Response, pathname: string): Response {
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
   * SPEC §6 / §14.14 — admin is never cached and never indexed, signed in or
   * not. The login page is included: it is under /admin/ and a cached copy of it
   * is no more welcome than a cached dashboard.
   */
  if (isAdminPage(pathname) || isAdminApi(pathname)) {
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }

  return response;
}

export const onRequest: MiddlewareHandler = async (context, next) => {
  const { pathname } = context.url;

  /**
   * Hydration, failing closed.
   *
   * `validateSession` already returns null rather than throwing, but the cookie
   * read can throw on a malformed header and this must never be the line that
   * turns an error into access. On any failure `locals.user` is null, which the
   * guard below then treats exactly like "not signed in" (SPEC §8).
   */
  let refreshedExpiry: Date | null = null;
  try {
    const token = context.cookies.get(SESSION_COOKIE)?.value;
    const session = await validateSession(token);
    context.locals.user = session
      ? {
          id: session.user.id,
          username: session.user.username,
          displayName: session.user.displayName,
        }
      : null;
    if (session?.refreshed) refreshedExpiry = session.expiresAt;
  } catch (cause) {
    logger.error("session hydration failed", {
      reason: cause instanceof Error ? cause.message : "unknown",
    });
    context.locals.user = null;
  }

  const signedIn = context.locals.user !== null;

  /**
   * Strip an unsafe `?next=` before the login page ever sees it.
   *
   * #25 renders the login form and performs the post-login redirect, but the
   * rejection belongs here: this runs on every request, so there is no path
   * where a hand-built link reaches a consumer with a hostile `next` still
   * attached. `safeNextPath` explains each rejected shape.
   */
  if (pathname === LOGIN_PATH && context.url.searchParams.has("next")) {
    const requested = context.url.searchParams.get("next");
    if (safeNextPath(requested) === null) {
      logger.warn("rejected unsafe next redirect");
      const cleaned = new URL(context.url);
      cleaned.searchParams.delete("next");
      return applySecurityHeaders(
        context.redirect(`${cleaned.pathname}${cleaned.search}`, 302),
        pathname,
      );
    }
  }

  // The guard. Runs BEFORE next(), so a blocked admin page is never rendered.
  if (!signedIn && (isAdminPage(pathname) || isAdminApi(pathname))) {
    if (pathname !== LOGIN_PATH) {
      /**
       * An API route answers 401 JSON rather than redirecting.
       *
       * #24 words the guard as "redirect to /admin/login?next=<path>" for both,
       * but a `fetch` to /api/admin/... follows a 302 transparently and then
       * parses an HTML login page as JSON — the caller sees a parse error
       * instead of "you are signed out", and cannot act on it. A redirect is
       * also meaningless to a non-browser client. Worth ratifying, but the
       * status is the useful answer either way, and it still denies.
       */
      if (isAdminApi(pathname)) {
        return applySecurityHeaders(
          new Response(JSON.stringify({ ok: false, error: "Not signed in." }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }),
          pathname,
        );
      }

      /**
       * `next` is built from our own `pathname` and `search`, not from anything
       * the client sent, so it is same-origin by construction. It still goes
       * through `safeNextPath` — the value is about to be reflected into a URL
       * a browser will follow, and "it came from us" is the assumption that
       * stops being true the first time someone adds a rewrite.
       */
      const target = safeNextPath(`${pathname}${context.url.search}`);
      const location = target
        ? `${LOGIN_PATH}?next=${encodeURIComponent(target)}`
        : LOGIN_PATH;
      return applySecurityHeaders(context.redirect(location, 302), pathname);
    }
  }

  const response = await next();

  /**
   * Sliding expiry only reaches the browser if the cookie is re-sent. Without
   * this the row's expiry extends server-side while the cookie keeps its
   * original Max-Age, and the session dies in the browser while the database
   * still believes it is alive (SPEC §8, flagged in #23's handoff).
   */
  if (refreshedExpiry) {
    const token = context.cookies.get(SESSION_COOKIE)?.value;
    if (token)
      context.cookies.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
  }

  return applySecurityHeaders(response, pathname);
};
