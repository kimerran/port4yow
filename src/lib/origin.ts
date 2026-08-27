import { env } from "./env";

/**
 * The same-origin check every state-changing route runs (SPEC §14.4, AGENT §3).
 *
 * Shared rather than copied. It lived in `/api/contact` first, and by #25 the
 * login and logout routes had a subtly different version that ALLOWED a missing
 * `Origin` — so the repo had two answers to one threat, and the laxer one was on
 * the route that hands out sessions. One function means the three cannot drift
 * again.
 *
 * `security.checkOrigin` is on in astro.config.mjs and covers form content types
 * as a framework backstop. SPEC §14.4 still asks for this explicit per-route
 * check, precisely because the backstop is a config line someone could change —
 * and because it does not cover a JSON POST at all.
 */

/**
 * True when the request demonstrably came from our own origin.
 *
 * A request with NEITHER `Origin` nor `Referer` is refused, not allowed.
 * Browsers send `Origin` on every cross-origin POST, so its absence means a
 * non-browser client, which has no business posting these forms. Treating
 * "no evidence" as "must be fine" is the failure-open shape AGENT §1.5 rules
 * out.
 */
export function isSameOrigin(request: Request): boolean {
  const expected = new URL(env.PUBLIC_SITE_URL).origin;

  const origin = request.headers.get("origin");
  if (origin) return origin === expected;

  // Fall back to Referer: some legitimate same-origin navigations omit Origin.
  const referer = request.headers.get("referer");
  if (!referer) return false;

  try {
    return new URL(referer).origin === expected;
  } catch {
    // An unparseable Referer is not evidence of anything.
    return false;
  }
}
