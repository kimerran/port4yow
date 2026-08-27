import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/contact` end to end (#22's acceptance list).
 *
 * Real Postgres and real Mailpit. Every one of #22's five acceptance criteria is
 * about what the whole pipeline does — persisting, emailing, refusing — so a
 * mocked db and a mocked transport would be testing the mocks. CI has no
 * database service, so this is opt-in and skips rather than failing a machine
 * without one, the same shape as #19's limiter suite.
 *
 * Run with `pnpm test:integration`.
 */
const enabled =
  process.env.CONTACT_IT === "1" && Boolean(process.env.DATABASE_URL);

const SECRET = "x".repeat(48);
const SITE = "http://localhost:4321";
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
  RESEND_ENABLED: "false",
  SMTP_URL: "smtp://localhost:1025",
});

const MAILPIT = "http://localhost:8025/api/v1";
const inboxCount = async (): Promise<number> =>
  ((await (await fetch(`${MAILPIT}/messages`)).json()) as { total: number })
    .total;

interface ContactBody {
  ok: boolean;
  errors?: Record<string, string>;
  error?: string;
  retryAfter?: number;
}

describe.skipIf(!enabled)("POST /api/contact", () => {
  let POST: typeof import("../contact").POST;
  let db: typeof import("../../../lib/db").db;
  let createFormToken: typeof import("../../../lib/formToken").createFormToken;

  const post = async (
    fields: Record<string, string>,
    opts: {
      ip?: string;
      origin?: string | null;
      contentType?: "form" | "json";
      forwardedFor?: string;
    } = {},
  ): Promise<Response> => {
    const { ip = "203.0.113.10", origin = SITE, contentType = "form" } = opts;
    const headers: Record<string, string> = { "User-Agent": "vitest" };
    if (origin) headers["Origin"] = origin;
    if (opts.forwardedFor) headers["X-Forwarded-For"] = opts.forwardedFor;

    let body: BodyInit;
    if (contentType === "json") {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(fields);
    } else {
      const form = new URLSearchParams(fields);
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = form.toString();
    }

    const request = new Request(`${SITE}/api/contact`, {
      method: "POST",
      headers,
      body,
    });
    // Only `request` and `clientAddress` are read by the handler.
    return POST({ request, clientAddress: ip } as Parameters<typeof POST>[0]);
  };

  const validFields = (over: Record<string, string> = {}) => ({
    name: "Ada Lovelace",
    email: "ada@example.com",
    message: "This message is comfortably longer than twenty characters.",
    renderedAt: createFormToken(Date.now() - 10_000),
    ...over,
  });

  const reset = async (): Promise<void> => {
    await db.contactMessage.deleteMany({});
    /**
     * Scoped to this suite's own keys. A bare `deleteMany({})` wipes counters
     * another integration suite is mid-way through exercising — it made #19's
     * concurrency test see 11 allowed instead of 10 when both ran at once.
     */
    await db.rateLimit.deleteMany({
      where: { key: { startsWith: "contact:" } },
    });
    await fetch(`${MAILPIT}/messages`, { method: "DELETE" });
  };

  beforeEach(async () => {
    ({ POST } = await import("../contact"));
    ({ db } = await import("../../../lib/db"));
    ({ createFormToken } = await import("../../../lib/formToken"));
    await reset();
  });

  afterAll(async () => {
    await reset();
    await db.$disconnect();
  });

  it("happy path: persists and emails", async () => {
    const response = await post(validFields());
    expect(response.status).toBe(200);
    expect((await response.json()) as ContactBody).toEqual({ ok: true });

    const rows = await db.contactMessage.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("NEW");
    expect(rows[0]?.name).toBe("Ada Lovelace");
    // SPEC §14.10 — hashed only, and it must not be the address itself.
    expect(rows[0]?.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.ipHash).not.toContain("203.0.113.10");
    // #20's wrapper owns these; the route writes neither.
    expect(rows[0]?.resendId).not.toBeNull();
    expect(rows[0]?.deliveredAt).not.toBeNull();

    expect(await inboxCount()).toBe(1);
  });

  it("accepts application/json as well as urlencoded", async () => {
    const response = await post(validFields(), { contentType: "json" });
    expect(response.status).toBe(200);
    expect(await inboxCount()).toBe(1);
  });

  /**
   * SPEC §7 step 4 — the response must be indistinguishable from success. A bot
   * that can tell it was caught can iterate until it isn't.
   */
  it("honeypot: success shape, persists SPAM, sends no email", async () => {
    const real = await post(validFields());
    const realBody = (await real.json()) as ContactBody;
    await reset();

    const response = await post(validFields({ company: "Acme Corp" }));
    expect(response.status).toBe(200);
    expect((await response.json()) as ContactBody).toEqual(realBody);

    const rows = await db.contactMessage.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("SPAM");
    expect(await inboxCount()).toBe(0);
  });

  it.each([
    ["a forged token", "1800000000000.deadbeef"],
    ["no token at all", ""],
  ])(
    "timing: %s takes the spam path, not a 400",
    async (_label, renderedAt) => {
      const response = await post(validFields({ renderedAt }));
      expect(response.status).toBe(200);
      const rows = await db.contactMessage.findMany();
      expect(rows[0]?.status).toBe("SPAM");
      expect(await inboxCount()).toBe(0);
    },
  );

  it("timing: a submission faster than 3 seconds is spam", async () => {
    const response = await post(
      validFields({ renderedAt: createFormToken(Date.now()) }),
    );
    expect(response.status).toBe(200);
    expect((await db.contactMessage.findMany())[0]?.status).toBe("SPAM");
    expect(await inboxCount()).toBe(0);
  });

  it("timing: a token older than 30 minutes is spam", async () => {
    const response = await post(
      validFields({ renderedAt: createFormToken(Date.now() - 31 * 60_000) }),
    );
    expect(response.status).toBe(200);
    expect((await db.contactMessage.findMany())[0]?.status).toBe("SPAM");
    expect(await inboxCount()).toBe(0);
  });

  it("validation failure returns a field-keyed 400", async () => {
    const response = await post(
      validFields({ name: "A", email: "nope", message: "too short" }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as ContactBody;
    expect(body.ok).toBe(false);
    expect(body.errors).toEqual({
      name: "Tell me what to call you.",
      email: "That email address looks incomplete.",
      message: "A couple more sentences would help.",
    });
    // Nothing persisted, nothing sent, and no stack trace in the payload.
    expect(await db.contactMessage.count()).toBe(0);
    expect(await inboxCount()).toBe(0);
    expect(JSON.stringify(body)).not.toMatch(/at .*\.ts:/);
  });

  it("rejects a cross-origin post with 403", async () => {
    const response = await post(validFields(), {
      origin: "https://evil.example",
    });
    expect(response.status).toBe(403);
    expect(await db.contactMessage.count()).toBe(0);
  });

  it("rejects a post with neither Origin nor Referer", async () => {
    const response = await post(validFields(), { origin: null });
    expect(response.status).toBe(403);
    expect(await db.contactMessage.count()).toBe(0);
  });

  it("the 6th request in an hour returns 429 with Retry-After", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await post(validFields(), { ip: "203.0.113.50" })).status).toBe(
        200,
      );
    }
    const sixth = await post(validFields(), { ip: "203.0.113.50" });
    expect(sixth.status).toBe(429);

    const retryAfter = sixth.headers.get("Retry-After");
    expect(retryAfter).toMatch(/^\d+$/);
    expect(Number(retryAfter)).toBeGreaterThan(0);

    const body = (await sixth.json()) as ContactBody;
    expect(body.ok).toBe(false);
    expect(body.retryAfter).toBe(Number(retryAfter));

    // The refused request must not have persisted or emailed.
    expect(await db.contactMessage.count()).toBe(5);
    expect(await inboxCount()).toBe(5);
  });

  it("counts each IP separately", async () => {
    for (let i = 0; i < 5; i++) {
      await post(validFields(), { ip: "203.0.113.60" });
    }
    expect((await post(validFields(), { ip: "203.0.113.60" })).status).toBe(
      429,
    );
    expect((await post(validFields(), { ip: "203.0.113.61" })).status).toBe(
      200,
    );
  });

  /**
   * On Railway the socket address is the proxy, so without X-Forwarded-For every
   * visitor shares one bucket — #14.9's 5/hr/IP becomes 5/hr for everyone — and
   * every stored ipHash is identical, defeating SPEC §14.10's reason for keeping
   * one at all. Keyed on the socket address this test saw 1 distinct hash.
   */
  it("keys the limiter on the forwarded client, not the proxy socket", async () => {
    for (const ip of ["203.0.113.10", "198.51.100.20", "192.0.2.30"]) {
      const response = await post(validFields(), {
        ip: "10.0.0.1",
        forwardedFor: ip,
      });
      expect(response.status).toBe(200);
    }

    const rows = await db.contactMessage.findMany({ select: { ipHash: true } });
    expect(new Set(rows.map((r) => r.ipHash)).size).toBe(3);

    const buckets = await db.rateLimit.findMany({
      where: { key: { startsWith: "contact:" } },
      select: { key: true, count: true },
    });
    const perIp = buckets.filter((b) => b.key !== "contact:global");
    expect(perIp).toHaveLength(3);
    expect(perIp.every((b) => b.count === 1)).toBe(true);
    // The global flood brake still counts all three.
    expect(buckets.find((b) => b.key === "contact:global")?.count).toBe(3);
  });

  it("rate limits each forwarded client separately", async () => {
    for (let i = 0; i < 5; i++) {
      await post(validFields(), {
        ip: "10.0.0.1",
        forwardedFor: "203.0.113.70",
      });
    }
    expect(
      (
        await post(validFields(), {
          ip: "10.0.0.1",
          forwardedFor: "203.0.113.70",
        })
      ).status,
    ).toBe(429);
    expect(
      (
        await post(validFields(), {
          ip: "10.0.0.1",
          forwardedFor: "203.0.113.71",
        })
      ).status,
    ).toBe(200);
  });

  /**
   * A required renderedAt answered `400 {"renderedAt": "Invalid input: expected
   * string, received undefined"}` — naming a hidden field a human cannot act on,
   * confirming to a bot exactly what it forgot, in raw Zod wording. Absent is
   * just another invalid token.
   */
  it("a missing renderedAt is spam, not a 400 naming the hidden field", async () => {
    const fields: Record<string, string> = validFields();
    delete fields.renderedAt;
    const response = await post(fields);

    expect(response.status).toBe(200);
    const body = (await response.json()) as ContactBody;
    expect(body).toEqual({ ok: true });
    expect(JSON.stringify(body)).not.toContain("renderedAt");

    const rows = await db.contactMessage.findMany();
    expect(rows[0]?.status).toBe("SPAM");
    expect(await inboxCount()).toBe(0);
  });

  it("sets no-store on every response", async () => {
    const ok = await post(validFields());
    expect(ok.headers.get("Cache-Control")).toBe("no-store");
    const bad = await post(validFields({ email: "nope" }));
    expect(bad.headers.get("Cache-Control")).toBe("no-store");
  });
});

/**
 * #22 step 7 — "If Resend fails, still return 200". The message is already safe
 * in the database, and the visitor should not be told their message was lost
 * when it was not. It surfaces in the admin inbox as undelivered because
 * `deliveredAt` stays null.
 */
describe.skipIf(!enabled)("mail outage", () => {
  it("still returns 200 and leaves the message retrievable", async () => {
    const { db } = await import("../../../lib/db");
    await db.contactMessage.deleteMany({});
    /**
     * Scoped to this suite's own keys. A bare `deleteMany({})` wipes counters
     * another integration suite is mid-way through exercising — it made #19's
     * concurrency test see 11 allowed instead of 10 when both ran at once.
     */
    await db.rateLimit.deleteMany({
      where: { key: { startsWith: "contact:" } },
    });
    await fetch(`${MAILPIT}/messages`, { method: "DELETE" });

    // Point the transport at a port nothing is listening on, then re-import so
    // env.ts picks it up. This is a real connection failure, not a stub.
    process.env.SMTP_URL = "smtp://localhost:1";
    vi.resetModules();

    const { POST } = await import("../contact");
    const { createFormToken } = await import("../../../lib/formToken");
    const request = new Request(`${SITE}/api/contact`, {
      method: "POST",
      headers: {
        Origin: SITE,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        name: "Ada Lovelace",
        email: "ada@example.com",
        message: "This message is comfortably longer than twenty characters.",
        renderedAt: createFormToken(Date.now() - 10_000),
      }).toString(),
    });
    const response = await POST({
      request,
      clientAddress: "203.0.113.99",
    } as Parameters<typeof POST>[0]);

    expect(response.status).toBe(200);
    expect((await response.json()) as ContactBody).toEqual({ ok: true });

    const { db: db2 } = await import("../../../lib/db");
    const rows = await db2.contactMessage.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("NEW");
    // Undelivered, which is exactly how the admin inbox will find it.
    expect(rows[0]?.deliveredAt).toBeNull();
    expect(rows[0]?.resendId).toBeNull();

    process.env.SMTP_URL = "smtp://localhost:1025";
    vi.resetModules();
    await db2.$disconnect();
  });
});
