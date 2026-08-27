import { beforeEach, describe, expect, it, vi } from "vitest";

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

const counts: { messages: number; undelivered: number } = {
  messages: 0,
  undelivered: 0,
};
let grouped: { status: string; _count: { _all: number } }[] = [];
let lastLoginAt: Date | null = null;
const contactWhere: unknown[] = [];

vi.mock("../db", () => ({
  db: {
    contactMessage: {
      count: ({ where }: { where: Record<string, unknown> }) => {
        contactWhere.push(where);
        return Promise.resolve(
          "deliveredAt" in where ? counts.undelivered : counts.messages,
        );
      },
    },
    project: { groupBy: () => Promise.resolve(grouped) },
    user: { findUnique: () => Promise.resolve({ lastLoginAt }) },
  },
}));

const warn = vi.fn();
vi.mock("../logger", () => ({
  logger: {
    warn: (message: string): void => {
      warn(message);
    },
  },
}));

const { assertAdmin, AdminAuthError, getDashboardStats } =
  await import("../admin");

const USER = { id: "user_1", username: "mark", displayName: "Mark" };

beforeEach(() => {
  counts.messages = 0;
  counts.undelivered = 0;
  grouped = [];
  lastLoginAt = null;
  contactWhere.length = 0;
  warn.mockClear();
});

/**
 * The single most important rule in the admin. #24's middleware guards
 * `/admin/*` and `/api/admin/*`; Actions are served from `/_actions/*`, which
 * that guard never sees — so for an action this is not a second check, it is the
 * only one.
 */
describe("assertAdmin", () => {
  it("returns the signed-in user", () => {
    expect(assertAdmin({ user: USER })).toEqual(USER);
  });

  it("throws when there is no session", () => {
    expect(() => assertAdmin({ user: null })).toThrow(AdminAuthError);
  });

  it("throws rather than returning null, so a caller cannot forget to check", () => {
    expect(() => assertAdmin({ user: null })).toThrow("Sign in to continue.");
  });

  it("logs the rejection", () => {
    expect(() => assertAdmin({ user: null })).toThrow();
    expect(warn).toHaveBeenCalledWith("admin action rejected: no session");
  });

  /**
   * SPEC §6 — "Never trust a hidden form field for identity or authorization."
   * Identity comes from locals, which middleware hydrated from the cookie. If
   * this ever took a caller-supplied id, any caller could act as anyone.
   */
  it("takes identity from locals only — there is no other parameter", () => {
    expect(assertAdmin.length).toBe(1);
  });
});

describe("getDashboardStats", () => {
  it("reports zero counts on an empty database", async () => {
    const stats = await getDashboardStats(USER.id);
    expect(stats).toEqual({
      unreadMessages: 0,
      undeliveredMessages: 0,
      projectsByStatus: { draft: 0, published: 0, archived: 0 },
      lastLoginAt: null,
    });
  });

  it("maps grouped project statuses onto the three buckets", async () => {
    grouped = [
      { status: "DRAFT", _count: { _all: 2 } },
      { status: "PUBLISHED", _count: { _all: 5 } },
      { status: "ARCHIVED", _count: { _all: 1 } },
    ];
    const stats = await getDashboardStats(USER.id);
    expect(stats.projectsByStatus).toEqual({
      draft: 2,
      published: 5,
      archived: 1,
    });
  });

  it("defaults a status that has no rows to 0, not undefined", async () => {
    grouped = [{ status: "PUBLISHED", _count: { _all: 3 } }];
    const stats = await getDashboardStats(USER.id);
    expect(stats.projectsByStatus.draft).toBe(0);
    expect(stats.projectsByStatus.archived).toBe(0);
  });

  it("counts only NEW messages as unread", async () => {
    counts.messages = 4;
    await getDashboardStats(USER.id);
    expect(contactWhere[0]).toEqual({ status: "NEW" });
  });

  /**
   * Undelivered is where a failed send becomes visible: #20 leaves
   * `deliveredAt` null on failure and #22 still answers 200, so nothing else
   * surfaces it. SPAM is excluded because no mail was ever attempted for it —
   * counting it would report a delivery failure that never happened.
   */
  it("excludes SPAM from the undelivered count", async () => {
    counts.undelivered = 2;
    const stats = await getDashboardStats(USER.id);
    expect(stats.undeliveredMessages).toBe(2);
    expect(contactWhere[1]).toEqual({
      deliveredAt: null,
      status: { not: "SPAM" },
    });
  });

  it("passes through lastLoginAt", async () => {
    lastLoginAt = new Date("2026-01-01T00:00:00Z");
    expect((await getDashboardStats(USER.id)).lastLoginAt).toEqual(lastLoginAt);
  });
});
