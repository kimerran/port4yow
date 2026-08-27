import { afterAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Atomicity against REAL Postgres.
 *
 * The unit suite reimplements `bump`'s statement over a JS map, which can prove
 * the arithmetic but never the concurrency: a map has no concurrent writers, so
 * a read-then-write implementation would pass there just as happily. This file
 * is the only place the "concurrent increments do not undercount" acceptance
 * criterion can actually be checked.
 *
 * CI has no database service, so this is opt-in: it runs only when
 * RATELIMIT_IT=1 and a real DATABASE_URL are both present, and skips otherwise
 * rather than failing a machine that has no Postgres.
 */
const enabled =
  process.env.RATELIMIT_IT === "1" && Boolean(process.env.DATABASE_URL);

const SECRET = "x".repeat(48);
Object.assign(process.env, {
  PUBLIC_SITE_URL: "http://localhost:4321",
  SESSION_SECRET: SECRET,
  FORM_SECRET: SECRET,
  IP_HASH_SALT: SECRET,
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "portfolio-media",
  S3_ACCESS_KEY_ID: "k",
  S3_SECRET_ACCESS_KEY: "s",
  CONTACT_TO_EMAIL: "a@b.com",
});

describe.skipIf(!enabled)("rate limiter against real Postgres", () => {
  let consume: typeof import("../ratelimit").consume;
  let rateLimitKey: typeof import("../ratelimit").rateLimitKey;
  let db: typeof import("../db").db;

  beforeEach(async () => {
    ({ consume, rateLimitKey } = await import("../ratelimit"));
    ({ db } = await import("../db"));
    await db.rateLimit.deleteMany({
      where: { key: { startsWith: "login:it-" } },
    });
    await db.rateLimit.deleteMany({ where: { key: "contact:global" } });
    await db.rateLimit.deleteMany({
      where: { key: { startsWith: "contact:it-" } },
    });
  });

  afterAll(async () => {
    await db.rateLimit.deleteMany({
      where: { key: { startsWith: "login:it-" } },
    });
    await db.rateLimit.deleteMany({
      where: { key: { startsWith: "contact:it-" } },
    });
    await db.rateLimit.deleteMany({ where: { key: "contact:global" } });
  });

  /**
   * The regression this exists for: a read-then-write limiter lets two
   * concurrent requests both read 4 and both write 5, so the 6th request is
   * never refused and the stored count drifts below the number of requests
   * actually served.
   */
  it("does not undercount under concurrency", async () => {
    const subject = "it-concurrent";
    const attempts = 40;

    const results = await Promise.all(
      Array.from({ length: attempts }, () => consume("login", subject)),
    );

    const allowed = results.filter((r) => r.allowed).length;
    expect(allowed).toBe(10); // SPEC §14.9 — login 10/15min
    expect(results.length - allowed).toBe(attempts - 10);

    const row = await db.rateLimit.findUnique({
      where: { key: rateLimitKey("login", subject) },
    });
    // Every single request is accounted for; nothing was lost to a lost update.
    expect(row?.count).toBe(attempts);
  });

  it("hands out each unit of budget exactly once", async () => {
    const subject = "it-exactly-once";
    const results = await Promise.all(
      Array.from({ length: 10 }, () => consume("login", subject)),
    );
    const remaining = results.map((r) => r.remaining).sort((a, b) => a - b);
    expect(remaining).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("rolls the window over in the same statement", async () => {
    const subject = "it-rollover";
    const key = rateLimitKey("login", subject);
    for (let i = 0; i < 11; i++) await consume("login", subject);
    expect((await consume("login", subject)).allowed).toBe(false);

    // Expire the window in place rather than deleting the row: the point is
    // that an expired row resets rather than reading as permanently over-limit.
    await db.rateLimit.update({
      where: { key },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const after = await consume("login", subject);
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(9);
    const row = await db.rateLimit.findUnique({ where: { key } });
    expect(row?.count).toBe(1);
    expect(row?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("stores no raw IP in any column", async () => {
    const { hashIp } = await import("../ratelimit");
    const raw = "203.0.113.77";
    await consume("contact", `it-${hashIp(raw)}`);
    const rows = await db.rateLimit.findMany();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.key).not.toContain(raw);
  });
});
