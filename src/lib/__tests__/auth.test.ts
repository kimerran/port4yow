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

/**
 * The session store is a Map keyed exactly as the real table is — by
 * `Session.id`, which is `sha256(token)`. Keeping the mock's shape identical to
 * the schema is what lets the "raw token is nowhere in the DB" test mean
 * anything: it inspects every key and every stored value.
 *
 * Password hashing is NOT mocked. argon2 is the thing under test there, and a
 * mocked hash would verify nothing.
 */
interface SessionRow {
  id: string;
  userId: string;
  expiresAt: Date;
  ipHash: string | null;
  userAgent: string | null;
}

const sessions = new Map<string, SessionRow>();
let dbThrows = false;

const USER = {
  id: "user_1",
  username: "mark",
  displayName: "Mark",
  role: "ADMIN",
};

vi.mock("../db", () => ({
  db: {
    session: {
      create: ({ data }: { data: SessionRow }) => {
        sessions.set(data.id, { ...data });
        return Promise.resolve(data);
      },
      findUnique: ({ where }: { where: { id: string } }) => {
        if (dbThrows) return Promise.reject(new Error("connection lost"));
        const row = sessions.get(where.id);
        if (!row) return Promise.resolve(null);
        return Promise.resolve({ expiresAt: row.expiresAt, user: USER });
      },
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: { expiresAt: Date };
      }) => {
        const row = sessions.get(where.id);
        if (!row) return Promise.reject(new Error("not found"));
        row.expiresAt = data.expiresAt;
        return Promise.resolve(row);
      },
      delete: ({ where }: { where: { id: string } }) => {
        if (!sessions.delete(where.id)) {
          return Promise.reject(new Error("not found"));
        }
        return Promise.resolve({});
      },
    },
  },
}));

vi.mock("../logger", () => ({
  logger: { error: (): void => undefined, warn: (): void => undefined },
}));

const auth = await import("../auth");

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_800_000_000_000;

beforeEach(() => {
  sessions.clear();
  dbThrows = false;
});

describe("password hashing — SPEC §8", () => {
  it("round-trips", async () => {
    const stored = await auth.hashPassword("correct horse battery staple");
    expect(
      await auth.verifyPassword(stored, "correct horse battery staple"),
    ).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const stored = await auth.hashPassword("correct horse battery staple");
    expect(
      await auth.verifyPassword(stored, "Correct horse battery staple"),
    ).toBe(false);
    expect(await auth.verifyPassword(stored, "")).toBe(false);
  });

  /**
   * The parameters are the OWASP minimum and the encoded hash announces them, so
   * this fails loudly if anyone lowers a cost or if the library's algorithm enum
   * is renumbered — the code passes the literal 2 because `verbatimModuleSyntax`
   * cannot import an ambient const enum.
   */
  it("is argon2id at the OWASP minimum, and says so", async () => {
    const stored = await auth.hashPassword("whatever");
    expect(stored.startsWith("$argon2id$")).toBe(true);
    expect(stored).toContain("$m=19456,t=2,p=1$");
    expect(auth.ARGON2_OPTIONS).toMatchObject({
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  });

  it("never stores the password itself", async () => {
    const password = "correct horse battery staple";
    expect(await auth.hashPassword(password)).not.toContain(password);
  });

  it("salts: the same password hashes differently twice", async () => {
    const a = await auth.hashPassword("same password");
    const b = await auth.hashPassword("same password");
    expect(a).not.toBe(b);
    expect(await auth.verifyPassword(a, "same password")).toBe(true);
    expect(await auth.verifyPassword(b, "same password")).toBe(true);
  });

  /** AGENT §1.5 — a hash we cannot read is a password that does not match. */
  it.each([
    ["an empty hash", ""],
    ["a truncated hash", "$argon2id$v=19$m=19456"],
    ["a bcrypt hash", "$2b$12$abcdefghijklmnopqrstuv"],
    ["plain text", "hunter2"],
  ])("fails closed on %s rather than throwing", async (_label, stored) => {
    await expect(auth.verifyPassword(stored, "hunter2")).resolves.toBe(false);
  });
});

describe("session tokens — SPEC §8", () => {
  it("is 32 bytes, base64url", () => {
    const token = auth.createSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("does not repeat", () => {
    const tokens = new Set(
      Array.from({ length: 200 }, () => auth.createSessionToken()),
    );
    expect(tokens.size).toBe(200);
  });

  it("the stored id is sha256(token)", async () => {
    const { token } = await auth.createSession(USER.id, {}, T0);
    const { createHash } = await import("node:crypto");
    const expected = createHash("sha256").update(token).digest("hex");
    expect(auth.sessionIdFromToken(token)).toBe(expected);
    expect([...sessions.keys()]).toEqual([expected]);
  });

  /**
   * The acceptance criterion, checked against everything the row holds rather
   * than just the id: a leaked database must yield no replayable cookie.
   */
  it("the raw token appears nowhere in the stored row", async () => {
    const { token } = await auth.createSession(
      USER.id,
      { ipHash: "abc123", userAgent: "vitest" },
      T0,
    );
    const serialised = JSON.stringify([...sessions.entries()]);
    expect(serialised).not.toContain(token);
    expect(sessions.size).toBe(1);
  });

  it("stores the hashed ip and a truncated user agent, never a raw address", async () => {
    await auth.createSession(
      USER.id,
      { ipHash: "deadbeef", userAgent: "u".repeat(900) },
      T0,
    );
    const row = [...sessions.values()][0];
    expect(row?.ipHash).toBe("deadbeef");
    expect(row?.userAgent).toHaveLength(512);
  });
});

describe("session cookie — SPEC §8", () => {
  it("is __Host- prefixed with the attributes that prefix requires", () => {
    expect(auth.SESSION_COOKIE).toBe("__Host-session");
    expect(auth.SESSION_COOKIE_OPTIONS).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 2592000,
    });
  });

  it("has no Domain attribute — the __Host- prefix forbids it", () => {
    expect("domain" in auth.SESSION_COOKIE_OPTIONS).toBe(false);
  });
});

describe("validateSession", () => {
  it("resolves a live session to its user", async () => {
    const { token } = await auth.createSession(USER.id, {}, T0);
    const result = await auth.validateSession(token, T0 + DAY);
    expect(result?.user.username).toBe("mark");
    expect(result?.refreshed).toBe(false);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty string", ""],
    ["a token that was never issued", "not-a-real-token"],
  ])("returns null for %s", async (_label, token) => {
    expect(await auth.validateSession(token, T0)).toBeNull();
  });

  it("deletes an expired session on access rather than leaving it", async () => {
    const { token } = await auth.createSession(USER.id, {}, T0);
    expect(sessions.size).toBe(1);
    expect(await auth.validateSession(token, T0 + 31 * DAY)).toBeNull();
    expect(sessions.size).toBe(0);
  });

  it("treats the expiry instant itself as expired", async () => {
    const { token, expiresAt } = await auth.createSession(USER.id, {}, T0);
    expect(await auth.validateSession(token, expiresAt.getTime())).toBeNull();
  });

  /** SPEC §8 — "fail closed on any error". */
  it("returns null when the database throws", async () => {
    const { token } = await auth.createSession(USER.id, {}, T0);
    dbThrows = true;
    await expect(auth.validateSession(token, T0 + DAY)).resolves.toBeNull();
  });
});

/**
 * The acceptance criterion names both sides: extend at 14 days remaining, do not
 * extend at 20. Testing only the extension would pass against an implementation
 * that extends on every single request, which would defeat the point of an
 * expiry.
 */
describe("sliding expiry — SPEC §8", () => {
  it("extends when 14 days remain", async () => {
    const { token, expiresAt } = await auth.createSession(USER.id, {}, T0);
    const at = T0 + 16 * DAY; // 14 days left
    const result = await auth.validateSession(token, at);
    expect(result?.refreshed).toBe(true);
    expect(result?.expiresAt.getTime()).toBe(at + 30 * DAY);
    expect(result?.expiresAt.getTime()).toBeGreaterThan(expiresAt.getTime());
    expect(
      sessions.get(auth.sessionIdFromToken(token))?.expiresAt.getTime(),
    ).toBe(at + 30 * DAY);
  });

  it("does NOT extend when 20 days remain", async () => {
    const { token, expiresAt } = await auth.createSession(USER.id, {}, T0);
    const result = await auth.validateSession(token, T0 + 10 * DAY);
    expect(result?.refreshed).toBe(false);
    expect(result?.expiresAt.getTime()).toBe(expiresAt.getTime());
  });

  it("does not extend at exactly 15 days remaining", async () => {
    const { token } = await auth.createSession(USER.id, {}, T0);
    const result = await auth.validateSession(token, T0 + 15 * DAY);
    expect(result?.refreshed).toBe(false);
  });
});

describe("invalidateSession", () => {
  it("removes the row", async () => {
    const { token } = await auth.createSession(USER.id, {}, T0);
    await auth.invalidateSession(token);
    expect(sessions.size).toBe(0);
    expect(await auth.validateSession(token, T0 + DAY)).toBeNull();
  });

  it.each([
    ["a token that was never issued", "nope"],
    ["undefined", undefined],
  ])(
    "does not throw for %s — logging out twice is not an error",
    async (_l, t) => {
      await expect(auth.invalidateSession(t)).resolves.toBeUndefined();
    },
  );
});

/** SPEC §8's session-fixation defence, and the acceptance criterion for it. */
describe("rotateSession", () => {
  it("issues a new id and the old one no longer validates", async () => {
    const first = await auth.createSession(USER.id, {}, T0);
    const second = await auth.rotateSession(first.token, USER.id, {}, T0 + DAY);

    expect(second.token).not.toBe(first.token);
    expect(auth.sessionIdFromToken(second.token)).not.toBe(
      auth.sessionIdFromToken(first.token),
    );

    expect(await auth.validateSession(first.token, T0 + DAY)).toBeNull();
    expect((await auth.validateSession(second.token, T0 + DAY))?.user.id).toBe(
      USER.id,
    );
    expect(sessions.size).toBe(1);
  });

  it("works when no prior session was presented", async () => {
    const issued = await auth.rotateSession(null, USER.id, {}, T0);
    expect((await auth.validateSession(issued.token, T0 + DAY))?.user.id).toBe(
      USER.id,
    );
    expect(sessions.size).toBe(1);
  });

  it("leaves a working session if the old token is already gone", async () => {
    const issued = await auth.rotateSession("stale-token", USER.id, {}, T0);
    expect(await auth.validateSession(issued.token, T0 + DAY)).not.toBeNull();
  });
});
