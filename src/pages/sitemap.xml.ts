import type { APIRoute } from "astro";
import { listProjects } from "../lib/content";

/**
 * `/sitemap.xml` (SPEC §15, #34).
 *
 * Prerendered now, and generated from the content collection rather than from a
 * `status: "PUBLISHED"` query. The guarantee is the same and slightly stronger:
 * a draft has no page built, so it cannot appear here or anywhere else.
 *
 * `<lastmod>` is gone. It came from `Project.updatedAt`, a column the database
 * maintained; a file has no equivalent that survives a fresh checkout, since git
 * does not preserve mtimes. Emitting the build time instead would tell a crawler
 * every page changed on every deploy, which is worse than telling it nothing —
 * `<lastmod>` is optional precisely so it can be omitted rather than guessed.
 */

/**
 * XML has five predefined entities and a URL can legitimately contain three of
 * them. A slug is `[a-z0-9-]` so today nothing needs escaping — but the sitemap
 * is generated from data, and "the data can't contain that" is the assumption
 * that stops being true when someone adds a query parameter.
 */
const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export const GET: APIRoute = async ({ site }) => {
  /* `site` comes from astro.config's `site`, which is set from PUBLIC_SITE_URL.
     Prerendered routes have no request to fall back on, so a missing `site`
     must fail the BUILD rather than silently emit relative URLs a crawler
     cannot follow. */
  if (!site) {
    throw new Error(
      "astro.config `site` is unset — the sitemap cannot emit absolute URLs. Set PUBLIC_SITE_URL.",
    );
  }
  const origin = site.origin;
  const projects = await listProjects();

  const locs = [
    `${origin}/`,
    `${origin}/privacy`,
    ...projects.map((project) => `${origin}/work/${project.id}`),
  ];

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...locs.map((loc) =>
      ["  <url>", `    <loc>${escapeXml(loc)}</loc>`, "  </url>"].join("\n"),
    ),
    "</urlset>",
    "",
  ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
