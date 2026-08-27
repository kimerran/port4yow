import type { APIRoute } from "astro";
import { SESSION_COOKIE, invalidateSession } from "../../lib/auth";
import { env } from "../../lib/env";
import { logger } from "../../lib/logger";

export const prerender = false;

/**
 * `POST /admin/logout` (SPEC §8, #25).
 *
 * POST, never GET: a GET logout can be triggered by any `<img src>` on any page
 * on the internet, which is a nuisance-CSRF that signs the admin out at will.
 *
 * Deletes the session ROW as well as clearing the cookie. Clearing the cookie
 * alone leaves a live session id in the database, so anyone holding a copy of
 * the token — the reason to log out in the first place — is still signed in.
 */
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const origin = request.headers.get("origin");
  const expected = new URL(env.PUBLIC_SITE_URL).origin;

  if (origin !== null && origin !== expected) {
    logger.warn("logout rejected: cross-origin");
    return new Response(null, { status: 403 });
  }

  await invalidateSession(cookies.get(SESSION_COOKIE)?.value);

  // `delete` must carry the same path the cookie was set with, or the browser
  // keeps the original and the user stays signed in with a dead session.
  cookies.delete(SESSION_COOKIE, { path: "/" });

  return redirect("/admin/login", 303);
};
