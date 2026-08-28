import type { APIRoute } from "astro";

/**
 * `/robots.txt` (SPEC §15, #34).
 *
 * One Disallow rule now. `/admin` is gone — there is no admin, no login form and
 * no session to keep out of an index — so the only thing left worth excluding is
 * `/api`, which holds the single contact endpoint and has nothing to index.
 *
 * Prerendered, with the origin taken from astro.config's `site`. It used to be
 * a server route purely so the Sitemap line could read `PUBLIC_SITE_URL` at
 * runtime; at build time `site` is the same value from the same source.
 */
export const GET: APIRoute = ({ site }) => {
  if (!site) {
    throw new Error(
      "astro.config `site` is unset — robots.txt cannot emit an absolute Sitemap URL. Set PUBLIC_SITE_URL.",
    );
  }

  const body = [
    "User-agent: *",
    "Disallow: /api",
    "",
    `Sitemap: ${site.origin}/sitemap.xml`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
