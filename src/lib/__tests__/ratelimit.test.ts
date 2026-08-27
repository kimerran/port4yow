import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "x".repeat(48);
Object.assign(process.env, {
  PUBLIC_SITE_URL: "http://localhost:4321",
  DATABASE_URL: "postgresql://a:b@localhost:5432/c",
  SESSION_SECRET: SECRET,
  FORM_SECRET: SECRET,
  IP_HASH_SALT: SECRET,
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "portfolio-media",
  S3_ACCESS_KEY_ID: "k",
  S3_SECRET_ACCESS_KEY: "s",
  CONTACT_TO_EMAIL: "a@b.com",
});

/**
 * The mock reimplements the ONE statement in `bump` — including its `CASE`
 * rollover — against an in-memory map, so the limit arithmetic, the window
 * rollover and the global-brake ordering are all testable without Postgres.
 *
 * What it deliberately cannot prove is atomicity: a JS map has no concurrent
 * writers. That claim is tested for real against Postgres in
 * `ratelimit.integration.test.ts`, which is the only place it can be tested.
 */
const store = new Map<string, { count: number; expiresAt: Date }>();

/** Set for one call to simulate the counter write returning no row. */
let returnNoRow = false;

vi.mock("../db", () => ({
  db: {
    $queryRaw: vi.fn((_strings: TemplateStringsArray, ...values: unknown[]) => {
      if (returnNoRow) {
        returnNoRow = false;
        return Promise.resolve([]);
      }
      const key = values[0] as string;
      const windowSeconds = values[1] as number;
      const now = new Date();
      const existing = store.get(key);
      const fresh = {
        count: 1,
        expiresAt: new Date(now.getTime() + windowSeconds * 1000),
      };
      const row =
        !existing || existing.expiresAt.getTime() <= now.getTime()
          ? fresh
          : { count: existing.count + 1, expiresAt: existing.expiresAt };
      store.set(key, row);
      return Promise.resolve([{ ...row }]);
    }),
  },
}));

const warn = vi.fn<(message: string, context?: unknown) => void>();
vi.mock("../logger", () => ({
  logger: {
    warn: (message: string, context?: unknown): void => {
      warn(message, context);
    },
  },
}));

const { consume, hashIp, rateLimitKey, RATE_LIMITS, CONTACT_GLOBAL } =
  await import("../ratelimit");

beforeEach(() => {
  store.clear();
  returnNoRow = false;
  warn.mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const ip = (n: number) => hashIp(`203.0.113.${n}`);

describe("hashIp — SPEC §14.10, hashed IPs only", () => {
  it("is a salted sha256, not the address", () => {
    const h = hashIp("203.0.113.1");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("203.0.113.1");
  });

  it("differs from an unsalted sha256 of the same address", async () => {
    const { createHash } = await import("node:crypto");
    const unsalted = createHash("sha256").update("203.0.113.1").digest("hex");
    expect(hashIp("203.0.113.1")).not.toBe(unsalted);
  });

  it("is stable, so the same address keys the same row", () => {
    expect(hashIp("203.0.113.1")).toBe(hashIp("203.0.113.1"));
  });

  it("separates distinct addresses", () => {
    expect(hashIp("203.0.113.1")).not.toBe(hashIp("203.0.113.2"));
  });
});

describe("keys never carry a raw address", () => {
  it("builds contact:<ipHash>", () => {
    const key = rateLimitKey("contact", hashIp("203.0.113.1"));
    expect(key).toMatch(/^contact:[0-9a-f]{64}$/);
    expect(key).not.toContain("203.0.113.1");
  });
});

describe("fixed window — the 6th contact request in an hour is refused", () => {
  it("allows exactly the limit, then refuses", async () => {
    const subject = ip(1);
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await consume("contact", subject));

    expect(results.slice(0, 5).map((r) => r.allowed)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(results[5]?.allowed).toBe(false);
    expect(results[4]?.remaining).toBe(0);
    expect(results[5]?.limit).toBe(RATE_LIMITS.contact.limit);
  });

  it("allows again once the window has expired", async () => {
    const subject = ip(2);
    for (let i = 0; i < 6; i++) await consume("contact", subject);
    expect((await consume("contact", subject)).allowed).toBe(false);

    vi.setSystemTime(new Date("2026-01-01T01:00:01Z"));
    const after = await consume("contact", subject);
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(RATE_LIMITS.contact.limit - 1);
  });

  it("does not reset one second early", async () => {
    const subject = ip(3);
    for (let i = 0; i < 6; i++) await consume("contact", subject);
    vi.setSystemTime(new Date("2026-01-01T00:59:59Z"));
    expect((await consume("contact", subject)).allowed).toBe(false);
  });

  it("keeps a refused caller from extending its own window", async () => {
    const subject = ip(4);
    for (let i = 0; i < 6; i++) await consume("contact", subject);
    const first = await consume("contact", subject);
    vi.setSystemTime(new Date("2026-01-01T00:30:00Z"));
    const later = await consume("contact", subject);
    expect(later.resetAt.getTime()).toBe(first.resetAt.getTime());
  });
});

describe("per-action limits come from SPEC §14.9", () => {
  it.each([
    ["contact", 5],
    ["login", 10],
    ["upload", 30],
  ] as const)("%s allows %i then refuses", async (action, limit) => {
    const subject = action === "upload" ? "session-abc" : ip(9);
    for (let i = 0; i < limit; i++) {
      expect((await consume(action, subject)).allowed).toBe(true);
    }
    expect((await consume(action, subject)).allowed).toBe(false);
  });

  it("uses a 15-minute window for login, not an hour", async () => {
    const subject = ip(10);
    for (let i = 0; i <= RATE_LIMITS.login.limit; i++) {
      await consume("login", subject);
    }
    vi.setSystemTime(new Date("2026-01-01T00:15:01Z"));
    expect((await consume("login", subject)).allowed).toBe(true);
  });

  it("counts each action separately", async () => {
    const subject = ip(11);
    for (let i = 0; i < 6; i++) await consume("contact", subject);
    expect((await consume("contact", subject)).allowed).toBe(false);
    expect((await consume("login", subject)).allowed).toBe(true);
  });
});

describe("Retry-After", () => {
  it("reports whole seconds until the window resets", async () => {
    const subject = ip(12);
    for (let i = 0; i < 6; i++) await consume("contact", subject);
    vi.setSystemTime(new Date("2026-01-01T00:59:30Z"));
    const r = await consume("contact", subject);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBe(30);
  });

  it("never tells a refused caller to retry immediately", async () => {
    const subject = ip(13);
    for (let i = 0; i < 6; i++) await consume("contact", subject);
    vi.setSystemTime(new Date("2026-01-01T00:59:59.500Z"));
    const r = await consume("contact", subject);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe("global contact flood brake — SPEC §7.2", () => {
  it("trips at 51 requests across distinct IPs", async () => {
    // 50 distinct IPs, each well under its own 5/hr limit.
    for (let i = 0; i < CONTACT_GLOBAL.limit; i++) {
      const r = await consume("contact", ip(100 + i));
      expect(r.allowed).toBe(true);
    }
    const fiftyFirst = await consume("contact", ip(9000));
    expect(fiftyFirst.allowed).toBe(false);
    expect(fiftyFirst.limit).toBe(CONTACT_GLOBAL.limit);
  });

  it("logs when the brake engages, without any IP", async () => {
    for (let i = 0; i < CONTACT_GLOBAL.limit; i++)
      await consume("contact", ip(200 + i));
    await consume("contact", ip(9001));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls[0])).not.toMatch(/203\.0\.113/);
  });

  /**
   * The ordering matters more than it looks. If the global counter were
   * consumed BEFORE the per-IP check, one abusive IP could burn the shared
   * 50/hour budget by itself and lock every other visitor out — a per-IP limit
   * turned into a denial of service against the whole form.
   */
  it("does not let one refused IP burn the shared budget", async () => {
    const abusive = ip(300);
    for (let i = 0; i < 40; i++) await consume("contact", abusive);

    // 5 allowed + 35 refused. Only the 5 allowed may have touched the brake.
    for (let i = 0; i < 45; i++) {
      expect((await consume("contact", ip(400 + i))).allowed).toBe(true);
    }
    expect((await consume("contact", ip(9002))).allowed).toBe(false);
  });

  it("applies only to contact, not to login or upload", async () => {
    for (let i = 0; i < CONTACT_GLOBAL.limit + 1; i++) {
      await consume("contact", ip(500 + i));
    }
    expect((await consume("contact", ip(9003))).allowed).toBe(false);
    expect((await consume("login", ip(9003))).allowed).toBe(true);
    expect((await consume("upload", "session-z")).allowed).toBe(true);
  });
});

describe("fails closed", () => {
  it("throws rather than allowing when the counter write returns nothing", async () => {
    returnNoRow = true;
    await expect(consume("contact", ip(600))).rejects.toThrow(
      /returned no row/,
    );
  });
});
