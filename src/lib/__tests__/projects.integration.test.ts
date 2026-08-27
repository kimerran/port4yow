import { afterAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Project reordering and publish gating against real Postgres (#27).
 *
 * These need a real database because both criteria are about database
 * behaviour: `Project.sequence` is `@unique` and Postgres enforces that per
 * statement, so a naive swap raises a constraint violation that no mock would
 * reproduce. Opt-in, same shape as #19/#22/#25.
 */
const enabled =
  process.env.PROJECTS_IT === "1" && Boolean(process.env.DATABASE_URL);

const SECRET = "x".repeat(48);
Object.assign(process.env, {
  PUBLIC_SITE_URL: "http://localhost:4321",
  SESSION_SECRET: SECRET,
  FORM_SECRET: SECRET,
  IP_HASH_SALT: SECRET,
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "portfolio-media",
  S3_ACCESS_KEY_ID: "minioadmin",
  S3_SECRET_ACCESS_KEY: "minioadmin",
  CONTACT_TO_EMAIL: "inbox@mh.neri.ph",
});

describe.skipIf(!enabled)("project ordering and publishing", () => {
  let projects: typeof import("../projects");
  let db: typeof import("../db").db;

  const seed = async (count: number): Promise<string[]> => {
    const ids: string[] = [];
    for (let i = 1; i <= count; i++) {
      const row = await db.project.create({
        data: {
          slug: `it-project-${String(i)}`,
          sequence: i,
          title: `Project ${String(i)}`,
          suit: "DIAMONDS",
          summary: "s",
          role: "r",
          timeline: "t",
          problem: "p",
          body: "b",
          outcome: "o",
        },
        select: { id: true },
      });
      ids.push(row.id);
    }
    return ids;
  };

  beforeEach(async () => {
    projects = await import("../projects");
    ({ db } = await import("../db"));
    await db.projectImage.deleteMany({});
    await db.projectStack.deleteMany({});
    await db.project.deleteMany({});
    await db.mediaAsset.deleteMany({ where: { key: { startsWith: "it-" } } });
  });

  afterAll(async () => {
    await db.projectImage.deleteMany({});
    await db.projectStack.deleteMany({});
    await db.project.deleteMany({});
    await db.mediaAsset.deleteMany({ where: { key: { startsWith: "it-" } } });
    await db.$disconnect();
  });

  /**
   * The acceptance criterion. The interesting part is not that the order
   * changes — it is that `sequence` is `@unique` and Postgres checks it per
   * statement, so moving row A onto row B's number fails immediately. Hence two
   * passes inside one transaction.
   */
  it("reorders 5 projects, leaving sequences contiguous and unique", async () => {
    const ids = await seed(5);
    const reversed = [...ids].reverse();

    await projects.reorderProjects(reversed);

    const after = await db.project.findMany({
      orderBy: { sequence: "asc" },
      select: { id: true, sequence: true },
    });

    expect(after.map((p) => p.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(after.map((p) => p.id)).toEqual(reversed);
    expect(new Set(after.map((p) => p.sequence)).size).toBe(5);
  });

  it("survives a full reversal repeated, which is where a naive swap breaks", async () => {
    const ids = await seed(5);
    await projects.reorderProjects([...ids].reverse());
    await projects.reorderProjects(ids);

    const after = await db.project.findMany({
      orderBy: { sequence: "asc" },
      select: { id: true, sequence: true },
    });
    expect(after.map((p) => p.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(after.map((p) => p.id)).toEqual(ids);
  });

  it("moves one project to the front without gaps", async () => {
    const ids = await seed(5);
    const moved = [ids[4] ?? "", ...ids.slice(0, 4)];
    await projects.reorderProjects(moved);

    const after = await db.project.findMany({
      orderBy: { sequence: "asc" },
      select: { id: true, sequence: true },
    });
    expect(after.map((p) => p.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(after[0]?.id).toBe(ids[4]);
  });

  /**
   * A partial list would leave the omitted rows on their old sequences, which
   * are very likely inside the 1..n range the pass assigns — producing either a
   * violation or duplicate ordering. Refusing is the difference between a failed
   * reorder and a corrupted one.
   */
  it("refuses a list that omits a project", async () => {
    const ids = await seed(5);
    await expect(projects.reorderProjects(ids.slice(0, 4))).rejects.toThrow(
      projects.ReorderMismatchError,
    );

    const after = await db.project.findMany({
      orderBy: { sequence: "asc" },
      select: { sequence: true },
    });
    // Nothing changed.
    expect(after.map((p) => p.sequence)).toEqual([1, 2, 3, 4, 5]);
  });

  it("refuses a list with a duplicate id", async () => {
    const ids = await seed(3);
    await expect(
      projects.reorderProjects([ids[0] ?? "", ids[0] ?? "", ids[1] ?? ""]),
    ).rejects.toThrow(projects.ReorderMismatchError);
  });

  it("refuses a list naming a project that does not exist", async () => {
    const ids = await seed(3);
    await expect(
      projects.reorderProjects([...ids.slice(0, 2), "no-such-id"]),
    ).rejects.toThrow(projects.ReorderMismatchError);
  });

  describe("publish gating", () => {
    const withCover = async (altText: string): Promise<string> => {
      const asset = await db.mediaAsset.create({
        data: {
          key: `it-cover-${String(Date.now())}-${String(Math.round(performance.now()))}`,
          bucket: "portfolio-media",
          mimeType: "image/webp",
          byteSize: 10,
          altText,
          checksum: `c-${String(performance.now())}`,
        },
        select: { id: true },
      });
      const project = await db.project.create({
        data: {
          slug: "it-publishable",
          sequence: 100,
          title: "T",
          suit: "DIAMONDS",
          summary: "s",
          role: "r",
          timeline: "t",
          problem: "p",
          body: "b",
          outcome: "o",
          coverImageId: asset.id,
        },
        select: { id: true },
      });
      return project.id;
    };

    it("publishes a complete project", async () => {
      const id = await withCover("Alt text");
      await projects.publishProject(id);
      const after = await db.project.findUnique({ where: { id } });
      expect(after?.status).toBe("PUBLISHED");
      expect(after?.publishedAt).not.toBeNull();
    });

    it.each(["title", "summary", "problem", "body", "outcome"] as const)(
      "refuses to publish with a missing %s",
      async (fieldName) => {
        const id = await withCover("Alt text");
        await db.project.update({
          where: { id },
          data: { [fieldName]: "" },
        });

        await expect(projects.publishProject(id)).rejects.toThrow(
          projects.PublishBlockedError,
        );
        expect((await db.project.findUnique({ where: { id } }))?.status).toBe(
          "DRAFT",
        );
      },
    );

    it("refuses to publish without a cover", async () => {
      const project = await db.project.create({
        data: {
          slug: "it-no-cover",
          sequence: 101,
          title: "T",
          suit: "DIAMONDS",
          summary: "s",
          role: "r",
          timeline: "t",
          problem: "p",
          body: "b",
          outcome: "o",
        },
        select: { id: true },
      });
      await expect(projects.publishProject(project.id)).rejects.toThrow(
        /cover/,
      );
    });

    /** The criterion #27 calls out by name. */
    it("refuses to publish when the cover has no alt text", async () => {
      const id = await withCover("   ");
      await expect(projects.publishProject(id)).rejects.toThrow(/coverAltText/);
      expect((await db.project.findUnique({ where: { id } }))?.status).toBe(
        "DRAFT",
      );
    });

    it("unpublishing returns it to DRAFT and keeps publishedAt as a fact", async () => {
      const id = await withCover("Alt text");
      await projects.publishProject(id);
      await projects.unpublishProject(id);

      const after = await db.project.findUnique({ where: { id } });
      expect(after?.status).toBe("DRAFT");
      expect(after?.publishedAt).not.toBeNull();
    });
  });
});
