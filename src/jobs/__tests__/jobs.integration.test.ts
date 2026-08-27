import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The scheduled jobs against real Postgres (#35).
 *
 * Idempotence is a property of what the database holds after two runs, and the
 * media:orphans guarantee is about a delete that must never happen — neither is
 * observable against a mock.
 */
const enabled =
  process.env.JOBS_IT === "1" && Boolean(process.env.DATABASE_URL);

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

describe.skipIf(!enabled)("scheduled jobs", () => {
  let jobs: typeof import("../index.ts");
  let db: typeof import("../../lib/db.ts").db;
  let userId: string;

  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  beforeEach(async () => {
    jobs = await import("../index.ts");
    ({ db } = await import("../../lib/db.ts"));

    await db.session.deleteMany({});
    await db.rateLimit.deleteMany({});
    await db.contactMessage.deleteMany({});
    await db.projectImage.deleteMany({});
    await db.project.updateMany({ data: { coverImageId: null } });
    await db.mediaAsset.deleteMany({});
    await db.projectStack.deleteMany({});
    await db.project.deleteMany({});
    await db.user.deleteMany({ where: { username: { startsWith: "job-" } } });

    const user = await db.user.create({
      data: {
        username: `job-${String(Math.round(performance.now() * 1000))}`,
        passwordHash: "x",
        displayName: "Job User",
      },
      select: { id: true },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await db.session.deleteMany({});
    await db.rateLimit.deleteMany({});
    await db.contactMessage.deleteMany({});
    await db.user.deleteMany({ where: { username: { startsWith: "job-" } } });
    await db.$disconnect();
  });

  describe("session:prune", () => {
    const session = async (id: string, expiresAt: Date): Promise<void> => {
      await db.session.create({ data: { id, userId, expiresAt } });
    };

    it("deletes expired sessions and keeps live ones", async () => {
      const now = new Date();
      await session("expired-1", new Date(now.getTime() - HOUR));
      await session("expired-2", new Date(now.getTime() - 1));
      await session("live-1", new Date(now.getTime() + HOUR));

      const result = await jobs.pruneSessions(now);
      expect(result.deleted).toBe(2);

      const left = await db.session.findMany({ select: { id: true } });
      expect(left.map((s) => s.id)).toEqual(["live-1"]);
    });

    /**
     * #35's second criterion. The job is a predicate over current state, not a
     * step in a sequence — so a second run re-evaluates it and finds nothing.
     */
    it("is safe to run twice back to back", async () => {
      const now = new Date();
      await session("expired-1", new Date(now.getTime() - HOUR));
      await session("live-1", new Date(now.getTime() + HOUR));

      expect((await jobs.pruneSessions(now)).deleted).toBe(1);
      expect((await jobs.pruneSessions(now)).deleted).toBe(0);
      expect(await db.session.count()).toBe(1);
    });

    it("does nothing on an empty table", async () => {
      expect((await jobs.pruneSessions()).deleted).toBe(0);
    });

    it("treats the expiry instant itself as expired", async () => {
      const now = new Date();
      await session("boundary", now);
      expect((await jobs.pruneSessions(now)).deleted).toBe(1);
    });
  });

  describe("ratelimit:prune", () => {
    const bucket = async (key: string, expiresAt: Date): Promise<void> => {
      await db.rateLimit.create({ data: { key, count: 1, expiresAt } });
    };

    it("deletes expired counters and keeps live ones", async () => {
      const now = new Date();
      await bucket("contact:old", new Date(now.getTime() - HOUR));
      await bucket("contact:live", new Date(now.getTime() + HOUR));

      expect((await jobs.pruneRateLimits(now)).deleted).toBe(1);
      const left = await db.rateLimit.findMany({ select: { key: true } });
      expect(left.map((r) => r.key)).toEqual(["contact:live"]);
    });

    it("is safe to run twice back to back", async () => {
      const now = new Date();
      await bucket("contact:old", new Date(now.getTime() - HOUR));

      expect((await jobs.pruneRateLimits(now)).deleted).toBe(1);
      expect((await jobs.pruneRateLimits(now)).deleted).toBe(0);
    });
  });

  describe("contact:prune", () => {
    const message = async (id: string, createdAt: Date): Promise<void> => {
      await db.contactMessage.create({
        data: {
          id,
          name: "Visitor",
          email: `${id}@example.com`,
          message: "hello",
          ipHash: "h",
          createdAt,
        },
      });
    };

    /** `now` shifted back whole calendar months — the job's own arithmetic. */
    const monthsAgo = (now: Date, months: number): Date =>
      jobs.monthsBefore(now, months);

    /**
     * #36's first acceptance criterion, stated as the boundary rather than as
     * "old rows go". 23 months is the case that catches an off-by-one in the
     * window, and it is the one a visitor would notice.
     */
    it("deletes at 25 months and keeps at 23", async () => {
      const now = new Date("2026-06-15T00:00:00.000Z");
      await message("old", monthsAgo(now, 25));
      await message("recent", monthsAgo(now, 23));

      expect((await jobs.pruneContactMessages(now)).deleted).toBe(1);

      const left = await db.contactMessage.findMany({ select: { id: true } });
      expect(left.map((m) => m.id)).toEqual(["recent"]);
    });

    it("keeps a message one day inside the window", async () => {
      const now = new Date("2026-06-15T00:00:00.000Z");
      const cutoff = monthsAgo(now, 24);
      await message("just-inside", new Date(cutoff.getTime() + DAY));
      await message("just-outside", new Date(cutoff.getTime() - DAY));

      expect((await jobs.pruneContactMessages(now)).deleted).toBe(1);
      const left = await db.contactMessage.findMany({ select: { id: true } });
      expect(left.map((m) => m.id)).toEqual(["just-inside"]);
    });

    it("is safe to run twice back to back", async () => {
      const now = new Date("2026-06-15T00:00:00.000Z");
      await message("old", monthsAgo(now, 30));
      await message("recent", monthsAgo(now, 1));

      expect((await jobs.pruneContactMessages(now)).deleted).toBe(1);
      expect((await jobs.pruneContactMessages(now)).deleted).toBe(0);
      expect(await db.contactMessage.count()).toBe(1);
    });

    it("does nothing on an empty table", async () => {
      expect((await jobs.pruneContactMessages()).deleted).toBe(0);
    });

    /**
     * #36: "logs a count, not the rows". A ContactMessage is a name, an email
     * address and free text a stranger typed — logging the rows being deleted
     * for privacy reasons would copy them to a log shipper with no retention
     * policy at all.
     */
    /**
     * #36: "logs a count, not the rows" — asserted against what reaches the
     * stream, not against the return value. An earlier version of this suite
     * checked the return value only, and a mutation that logged a name and an
     * email address alongside the count failed nothing.
     *
     * Pinned to the exact key set rather than a substring search: the failure
     * to catch is a *new* field, and you cannot grep for a string you have not
     * thought of.
     */
    it("logs the count and the cutoff, and nothing else", async () => {
      const now = new Date("2026-06-15T00:00:00.000Z");
      await message("old", monthsAgo(now, 30));

      let out = "";
      const write = (chunk: string | Uint8Array): boolean => {
        out +=
          typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
        return true;
      };
      const stdout = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(write);
      const stderr = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(write);
      try {
        await jobs.pruneContactMessages(now);
      } finally {
        stdout.mockRestore();
        stderr.mockRestore();
      }

      const line = out
        .split("\n")
        .find((l) => l.includes("job: contact:prune"));
      expect(line).toBeDefined();

      const context = JSON.parse(
        /(\{.*\})\s*$/.exec(line ?? "")?.[1] ?? "{}",
      ) as Record<string, unknown>;
      expect(Object.keys(context).sort()).toEqual(["cutoff", "deleted"]);
      expect(context["deleted"]).toBe(1);

      // And nothing from the row itself, whatever key it might arrive under.
      expect(out).not.toContain("Visitor");
      expect(out).not.toContain("example.com");
      expect(out).not.toContain("hello");
    });

    it("returns a count and never the rows", async () => {
      const now = new Date("2026-06-15T00:00:00.000Z");
      await message("old", monthsAgo(now, 30));

      const result = await jobs.pruneContactMessages(now);
      expect(result).toEqual({ job: "contact:prune", deleted: 1 });
      expect(JSON.stringify(result)).not.toContain("example.com");
      expect(JSON.stringify(result)).not.toContain("Visitor");
    });
  });

  describe("media:orphans", () => {
    const asset = async (key: string): Promise<string> => {
      const row = await db.mediaAsset.create({
        data: {
          key,
          bucket: "portfolio-media",
          mimeType: "image/webp",
          byteSize: 10,
          altText: "alt",
          checksum: `c-${key}`,
        },
        select: { id: true },
      });
      return row.id;
    };

    const project = async (slug: string, coverImageId?: string) => {
      return db.project.create({
        data: {
          slug,
          sequence: Math.round(performance.now() * 1000) % 100000,
          title: slug,
          suit: "DIAMONDS",
          summary: "s",
          role: "r",
          timeline: "t",
          problem: "p",
          body: "b",
          outcome: "o",
          ...(coverImageId ? { coverImageId } : {}),
        },
        select: { id: true },
      });
    };

    /**
     * The reason this groups by key stem rather than counting rows. #28 writes
     * one row per derivative — eight for a typical upload — and a project
     * references exactly one of them as its cover. Seven of eight rows for a
     * LIVE image are unreferenced by design, so a row-wise "orphan" check would
     * report most of the site's images as orphans.
     */
    it("does not report derivatives of a referenced image", async () => {
      const stem = "projects/p1/01ABC";
      const ids: string[] = [];
      for (const w of [480, 960, 1440, 1920]) {
        ids.push(await asset(`${stem}-${String(w)}.webp`));
        ids.push(await asset(`${stem}-${String(w)}.avif`));
      }
      await project("uses-cover", ids[6]);

      const report = await jobs.reportMediaOrphans();
      expect(report.found).toBe(0);
      expect(report.keys).toEqual([]);
    });

    it("reports a group where nothing in it is referenced", async () => {
      const used = "projects/p1/01USED";
      const orphan = "projects/p1/01ORPHAN";
      const usedId = await asset(`${used}-960.webp`);
      await asset(`${used}-480.webp`);
      await asset(`${orphan}-960.webp`);
      await asset(`${orphan}-480.webp`);
      await project("uses-cover", usedId);

      const report = await jobs.reportMediaOrphans();
      expect(report.keys).toEqual([orphan]);
      expect(report.found).toBe(1);
    });

    it("counts a gallery reference, not just a cover", async () => {
      const stem = "projects/p1/01GALLERY";
      const id = await asset(`${stem}-960.webp`);
      const p = await project("gallery-project");
      await db.projectImage.create({
        data: { projectId: p.id, assetId: id, sortOrder: 0 },
      });

      expect((await jobs.reportMediaOrphans()).found).toBe(0);
    });

    /** #35's third criterion, stated as an absolute. */
    it("never deletes anything, however many times it runs", async () => {
      await asset("projects/p1/01ORPHAN-960.webp");
      await asset("projects/p1/01ORPHAN-480.webp");
      const before = await db.mediaAsset.count();

      const first = await jobs.reportMediaOrphans();
      const second = await jobs.reportMediaOrphans();

      expect(first.found).toBe(1);
      // Identical output, and nothing removed — the job is a pure read.
      expect(second).toEqual(first);
      expect(await db.mediaAsset.count()).toBe(before);
    });

    it("reports nothing on an empty library", async () => {
      const report = await jobs.reportMediaOrphans();
      expect(report).toEqual({ job: "media:orphans", found: 0, keys: [] });
    });
  });

  describe("the job registry", () => {
    /**
     * Exact rather than `toContain`: the registry is what `pnpm job` will
     * accept, and a job added without a Railway service to invoke it is a job
     * that never runs. #36 adds the fourth — SPEC §11's three plus SPEC
     * §14.10's retention prune.
     */
    it("exposes exactly the jobs with a schedule behind them", () => {
      expect([...jobs.JOB_NAMES].sort()).toEqual([
        "contact:prune",
        "media:orphans",
        "ratelimit:prune",
        "session:prune",
      ]);
    });
  });
});
