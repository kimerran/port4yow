import { afterAll, beforeEach, describe, expect, it } from "vitest";

/**
 * robots.txt and sitemap.xml against real Postgres (#34).
 *
 * The acceptance criterion that matters most — "a DRAFT project appears in
 * neither the sitemap nor any OG/JSON-LD output" — is a database question. A
 * mocked query would be asserting my own `where` clause back at me.
 */
const enabled = process.env.SEO_IT === "1" && Boolean(process.env.DATABASE_URL);

const SECRET = "x".repeat(48);
const SITE = "https://mh.neri.ph";
Object.assign(process.env, {
  PUBLIC_SITE_URL: SITE,
  SESSION_SECRET: SECRET,
  FORM_SECRET: SECRET,
  IP_HASH_SALT: SECRET,
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "portfolio-media",
  S3_ACCESS_KEY_ID: "minioadmin",
  S3_SECRET_ACCESS_KEY: "minioadmin",
  CONTACT_TO_EMAIL: "inbox@mh.neri.ph",
});

describe.skipIf(!enabled)("robots.txt and sitemap.xml", () => {
  let db: typeof import("../../lib/db").db;
  let robots: typeof import("../robots.txt").GET;
  let sitemap: typeof import("../sitemap.xml").GET;

  const project = async (
    slug: string,
    sequence: number,
    status: "PUBLISHED" | "DRAFT" | "ARCHIVED",
  ): Promise<void> => {
    await db.project.create({
      data: {
        slug,
        sequence,
        title: slug,
        suit: "DIAMONDS",
        summary: "s",
        role: "r",
        timeline: "t",
        problem: "p",
        body: "b",
        outcome: "o",
        status,
        publishedAt: status === "PUBLISHED" ? new Date() : null,
      },
    });
  };

  const text = async (response: Response): Promise<string> => response.text();

  beforeEach(async () => {
    ({ db } = await import("../../lib/db"));
    ({ GET: robots } = await import("../robots.txt"));
    ({ GET: sitemap } = await import("../sitemap.xml"));

    await db.projectImage.deleteMany({});
    await db.projectStack.deleteMany({});
    await db.project.deleteMany({});
  });

  afterAll(async () => {
    await db.project.deleteMany({});
    await db.$disconnect();
  });

  const call = async (
    handler: typeof robots,
  ): Promise<{ status: number; body: string; contentType: string }> => {
    const response = await handler({
      request: new Request(`${SITE}/robots.txt`),
    } as Parameters<typeof handler>[0]);
    return {
      status: response.status,
      body: await text(response),
      contentType: response.headers.get("Content-Type") ?? "",
    };
  };

  describe("robots.txt", () => {
    it("disallows /admin and /api", async () => {
      const { body } = await call(robots);
      expect(body).toContain("Disallow: /admin");
      expect(body).toContain("Disallow: /api");
    });

    it("does not disallow the public site", async () => {
      const { body } = await call(robots);
      // A bare "Disallow: /" would hide everything — the failure mode that
      // looks identical to a working file until traffic disappears.
      expect(body).not.toMatch(/^Disallow: \/$/m);
      expect(body).toContain("User-agent: *");
    });

    it("points at the sitemap on the configured origin", async () => {
      const { body, contentType } = await call(robots);
      expect(body).toContain(`Sitemap: ${SITE}/sitemap.xml`);
      expect(contentType).toContain("text/plain");
    });
  });

  describe("sitemap.xml", () => {
    it("lists the home page and every published project", async () => {
      await project("alpha", 1, "PUBLISHED");
      await project("beta", 2, "PUBLISHED");

      const { body, contentType } = await call(sitemap);
      expect(contentType).toContain("application/xml");
      expect(body).toContain(`<loc>${SITE}/</loc>`);
      expect(body).toContain(`<loc>${SITE}/work/alpha</loc>`);
      expect(body).toContain(`<loc>${SITE}/work/beta</loc>`);
      expect(body.match(/<url>/g)).toHaveLength(3);
    });

    /** #34's first acceptance criterion. */
    it("omits a DRAFT project", async () => {
      await project("published-one", 1, "PUBLISHED");
      await project("secret-draft", 2, "DRAFT");

      const { body } = await call(sitemap);
      expect(body).toContain("published-one");
      expect(body).not.toContain("secret-draft");
      expect(body.match(/<url>/g)).toHaveLength(2);
    });

    it("omits an ARCHIVED project", async () => {
      await project("published-one", 1, "PUBLISHED");
      await project("old-one", 2, "ARCHIVED");

      const { body } = await call(sitemap);
      expect(body).not.toContain("old-one");
    });

    it("still lists the home page when there are no projects", async () => {
      const { body } = await call(sitemap);
      expect(body).toContain(`<loc>${SITE}/</loc>`);
      expect(body.match(/<url>/g)).toHaveLength(1);
      // No lastmod rather than a fabricated one: telling a crawler the page
      // changed on every request is worse than telling it nothing.
      expect(body).not.toContain("<lastmod>");
    });

    it("is well-formed XML with the sitemap namespace", async () => {
      await project("alpha", 1, "PUBLISHED");
      const { body } = await call(sitemap);
      expect(body.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(
        true,
      );
      expect(body).toContain(
        'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
      );
      expect(body.trimEnd().endsWith("</urlset>")).toBe(true);
    });

    it("emits lastmod as an ISO timestamp", async () => {
      await project("alpha", 1, "PUBLISHED");
      const { body } = await call(sitemap);
      expect(body).toMatch(
        /<lastmod>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z<\/lastmod>/,
      );
    });
  });
});
