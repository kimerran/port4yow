import type { APIRoute } from "astro";
import { db } from "../lib/db";
import { env } from "../lib/env";

export const prerender = false;

/**
 * `/sitemap.xml` (SPEC §15, #34).
 *
 * Generated from the database, so a DRAFT can never appear. That is the whole
 * reason it is not a static file: a hand-maintained sitemap drifts, and the
 * direction it drifts is always "still lists something that is no longer
 * public".
 *
 * The `status: "PUBLISHED"` filter is in the WHERE clause rather than a
 * post-fetch filter, the same shape as `getPublishedProject` (#15) — a draft is
 * never loaded, so it cannot be leaked by a later mistake.
 */

/**
 * XML has five predefined entities and a URL can legitimately contain three of
 * them. A slug is `[a-z0-9-]` (#27) so today nothing needs escaping — but the
 * sitemap is generated from data, and "the data can't contain that" is the
 * assumption that stops being true when someone adds a query parameter.
 */
const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export const GET: APIRoute = async () => {
  const origin = new URL(env.PUBLIC_SITE_URL).origin;

  const projects = await db.project.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { sequence: "asc" },
    select: { slug: true, updatedAt: true, publishedAt: true },
  });

  /**
   * The home page's own freshness is the newest project change: it lists them,
   * so a new project changes it. Falling back to now() would tell a crawler the
   * page changed on every request, which is worse than telling it nothing.
   */
  const newest = projects.reduce<Date | null>(
    (latest, project) =>
      !latest || project.updatedAt > latest ? project.updatedAt : latest,
    null,
  );

  const entries = [
    { loc: `${origin}/`, lastmod: newest },
    ...projects.map((project) => ({
      loc: `${origin}/work/${project.slug}`,
      lastmod: project.updatedAt,
    })),
  ];

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map((entry) =>
      [
        "  <url>",
        `    <loc>${escapeXml(entry.loc)}</loc>`,
        ...(entry.lastmod
          ? [`    <lastmod>${entry.lastmod.toISOString()}</lastmod>`]
          : []),
        "  </url>",
      ].join("\n"),
    ),
    "</urlset>",
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Same window as the home page: both are driven by project mutations.
      "Cache-Control": "public, max-age=0, s-maxage=300",
    },
  });
};
