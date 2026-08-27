import type { APIRoute } from "astro";
import { env } from "../lib/env";

export const prerender = false;

/**
 * `/robots.txt` (SPEC §15, #34).
 *
 * Two Disallow rules, and they are not decoration: `/admin` and `/api` are both
 * reachable, and a crawler that indexed them would put a login form and an
 * error-shaped JSON response into search results. Middleware already sends
 * `X-Robots-Tag: noindex` on `/admin/*` (#24), but that header is only seen once
 * a page has been FETCHED — robots.txt is what stops the fetch.
 *
 * `/api` covers `/api/contact` and `/api/media/…`. There is nothing to index
 * behind either, and crawling media through the app would pull every derivative
 * through our own origin for no benefit.
 *
 * Served dynamically rather than as a static file because the sitemap line has
 * to carry the real origin, and `PUBLIC_SITE_URL` is the only thing that knows
 * it (a hardcoded domain here is wrong in every environment but one).
 */
export const GET: APIRoute = () => {
  const origin = new URL(env.PUBLIC_SITE_URL).origin;

  const body = [
    "User-agent: *",
    "Disallow: /admin",
    "Disallow: /api",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // Rarely changes, and a stale copy costs nothing.
      "Cache-Control": "public, max-age=0, s-maxage=3600",
    },
  });
};
