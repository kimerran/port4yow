import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The login pipeline against real Postgres and real argon2 (#25).
 *
 * Every acceptance criterion here is about behaviour that only exists when the
 * database and the hasher are real: lockout counters persist across calls, and
 * the timing-equalisation criterion is meaningless against a mocked verify that
 * returns instantly. CI has no database service, so this is opt-in and skips
 * rather than failing a machine without one — the same shape as #19 and #22.
 *
 * Run with `pnpm test:integration`.
 */
const enabled =
  process.env.LOGIN_IT === "1" && Boolean(process.env.DATABASE_URL);

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

/**
 * Generated per run, never written into the file. AGENT §3 forbids a hardcoded
 * credential "even in a test", and a fixture password committed to the repo is
 * exactly that — it would also be a real one the moment someone copied this
 * setup into a seed script.
 */
const PASSWORD = randomBytes(24).toString("base64url");
const USERNAME = `it-user-${randomBytes(6).toString("hex")}`;

describe.skipIf(!enabled)("login pipeline", () => {
  let login: typeof import("../login");
  let auth: typeof import("../auth");
  let db: typeof import("../db").db;
  let userId: string;

  beforeEach(async () => {
    login = await import("../login");
    auth = await import("../auth");
    ({ db } = await import("../db"));

    await db.user.deleteMany({
      where: { username: { startsWith: "it-user-" } },
    });
    const user = await db.user.create({
      data: {
        username: USERNAME,
        passwordHash: await auth.hashPassword(PASSWORD),
        displayName: "Integration User",
      },
      select: { id: true },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await db.user.deleteMany({
      where: { username: { startsWith: "it-user-" } },
    });
    await db.$disconnect();
  });

  it("accepts the correct password", async () => {
    const result = await login.attemptLogin(USERNAME, PASSWORD);
    expect(result.ok).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const result = await login.attemptLogin(USERNAME, `${PASSWORD}x`);
    expect(result).toEqual({ ok: false, reason: "bad-password" });
  });

  it("rejects an unknown username", async () => {
    const result = await login.attemptLogin("no-such-user", PASSWORD);
    expect(result).toEqual({ ok: false, reason: "unknown-user" });
  });

  it("resets the failure counter on success", async () => {
    await login.attemptLogin(USERNAME, "wrong");
    await login.attemptLogin(USERNAME, "wrong");
    expect(
      (await db.user.findUnique({ where: { id: userId } }))?.failedLogins,
    ).toBe(2);

    await login.attemptLogin(USERNAME, PASSWORD);
    const after = await db.user.findUnique({ where: { id: userId } });
    expect(after?.failedLogins).toBe(0);
    expect(after?.lockedUntil).toBeNull();
    expect(after?.lastLoginAt).not.toBeNull();
  });

  /**
   * The failure modes must be indistinguishable to the client — one message —
   * and the caller only ever renders GENERIC_LOGIN_ERROR. `reason` exists for
   * the log line, which is server-side.
   */
  it("gives one message for a wrong password and an unknown username", () => {
    expect(login.GENERIC_LOGIN_ERROR).toBe(
      "That username and password don't match.",
    );
  });

  /**
   * The account-existence oracle closed through the clock. Without the dummy
   * verify an unknown username returns in ~0 ms while a real one costs a full
   * argon2 verify, and the gap is trivially measurable.
   *
   * The bound is deliberately loose — this measures wall-clock on a shared
   * machine — but the failure it guards against is roughly 50x, not 2x.
   */
  it("takes comparable time for a wrong password and an unknown username", async () => {
    const time = async (fn: () => Promise<unknown>): Promise<number> => {
      const started = performance.now();
      await fn();
      return performance.now() - started;
    };

    // Warm up: the dummy hash is computed once, lazily.
    await login.attemptLogin("warm-up-user", PASSWORD);

    const runs = 5;
    let known = 0;
    let unknown = 0;
    for (let i = 0; i < runs; i++) {
      known += await time(() => login.attemptLogin(USERNAME, "wrong-password"));
      unknown += await time(() =>
        login.attemptLogin(`no-such-user-${String(i)}`, "wrong-password"),
      );
      // Keep the account out of lockout so every run does the same work.
      await db.user.update({
        where: { id: userId },
        data: { failedLogins: 0, lockedUntil: null },
      });
    }

    const ratio = Math.max(known, unknown) / Math.min(known, unknown);
    expect(ratio).toBeLessThan(3);
  });
});

describe.skipIf(!enabled)("lockout", () => {
  let login: typeof import("../login");
  let auth: typeof import("../auth");
  let db: typeof import("../db").db;
  let userId: string;

  beforeEach(async () => {
    login = await import("../login");
    auth = await import("../auth");
    ({ db } = await import("../db"));
    await db.user.deleteMany({
      where: { username: { startsWith: "it-lock-" } },
    });
    const user = await db.user.create({
      data: {
        username: "it-lock-user",
        passwordHash: await auth.hashPassword(PASSWORD),
        displayName: "Lock User",
      },
      select: { id: true },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await db.user.deleteMany({
      where: { username: { startsWith: "it-lock-" } },
    });
  });

  it("locks after 5 consecutive failures", async () => {
    for (let i = 0; i < login.LOCKOUT_THRESHOLD; i++) {
      await login.attemptLogin("it-lock-user", "wrong");
    }
    const user = await db.user.findUnique({ where: { id: userId } });
    expect(user?.failedLogins).toBe(5);
    expect(user?.lockedUntil).not.toBeNull();
  });

  /** The criterion that matters: the CORRECT password is refused while locked. */
  it("refuses the correct password while locked", async () => {
    for (let i = 0; i < login.LOCKOUT_THRESHOLD; i++) {
      await login.attemptLogin("it-lock-user", "wrong");
    }
    const result = await login.attemptLogin("it-lock-user", PASSWORD);
    expect(result).toEqual({ ok: false, reason: "locked" });
  });

  it("accepts the correct password once the lock has expired", async () => {
    for (let i = 0; i < login.LOCKOUT_THRESHOLD; i++) {
      await login.attemptLogin("it-lock-user", "wrong");
    }
    expect((await login.attemptLogin("it-lock-user", PASSWORD)).ok).toBe(false);

    // Move the clock past lockedUntil rather than sleeping 15 minutes.
    const later = Date.now() + login.LOCKOUT_MS + 1000;
    expect((await login.attemptLogin("it-lock-user", PASSWORD, later)).ok).toBe(
      true,
    );
  });

  /**
   * Lock state is an oracle too. The implementation verifies the password even
   * when the account is already locked, precisely so a locked account cannot be
   * distinguished from a merely wrong password by the clock. Returning early on
   * `locked` would be the obvious "optimisation" and would reopen it — and the
   * rest of this suite cannot see that, since every other assertion is about
   * the returned value rather than how long it took.
   */
  it("takes comparable time whether or not the account is locked", async () => {
    const time = async (fn: () => Promise<unknown>): Promise<number> => {
      const started = performance.now();
      await fn();
      return performance.now() - started;
    };

    let unlocked = 0;
    let locked = 0;
    const runs = 4;

    for (let i = 0; i < runs; i++) {
      await db.user.update({
        where: { id: userId },
        data: { failedLogins: 0, lockedUntil: null },
      });
      unlocked += await time(() => login.attemptLogin("it-lock-user", "wrong"));

      await db.user.update({
        where: { id: userId },
        data: { lockedUntil: new Date(Date.now() + login.LOCKOUT_MS) },
      });
      locked += await time(() => login.attemptLogin("it-lock-user", "wrong"));
    }

    const ratio = Math.max(unlocked, locked) / Math.min(unlocked, locked);
    expect(ratio).toBeLessThan(3);
  });

  it("does not lock at 4 failures", async () => {
    for (let i = 0; i < 4; i++)
      await login.attemptLogin("it-lock-user", "wrong");
    const user = await db.user.findUnique({ where: { id: userId } });
    expect(user?.lockedUntil).toBeNull();
    expect((await login.attemptLogin("it-lock-user", PASSWORD)).ok).toBe(true);
  });
});

describe.skipIf(!enabled)("session rotation and logout", () => {
  let auth: typeof import("../auth");
  let db: typeof import("../db").db;
  let userId: string;

  beforeEach(async () => {
    auth = await import("../auth");
    ({ db } = await import("../db"));
    await db.user.deleteMany({
      where: { username: { startsWith: "it-sess-" } },
    });
    const user = await db.user.create({
      data: {
        username: "it-sess-user",
        passwordHash: await auth.hashPassword(PASSWORD),
        displayName: "Session User",
      },
      select: { id: true },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await db.user.deleteMany({
      where: { username: { startsWith: "it-sess-" } },
    });
  });

  it("rotates the session id and invalidates the prior one", async () => {
    const first = await auth.createSession(userId);
    expect(await auth.validateSession(first.token)).not.toBeNull();

    const second = await auth.rotateSession(first.token, userId);
    expect(second.token).not.toBe(first.token);
    expect(await auth.validateSession(first.token)).toBeNull();
    expect((await auth.validateSession(second.token))?.user.id).toBe(userId);

    const rows = await db.session.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
  });

  it("logout deletes the row, so the old cookie no longer authenticates", async () => {
    const issued = await auth.createSession(userId);
    expect(await auth.validateSession(issued.token)).not.toBeNull();

    await auth.invalidateSession(issued.token);

    expect(await auth.validateSession(issued.token)).toBeNull();
    expect(await db.session.count({ where: { userId } })).toBe(0);
  });

  it("stores no raw token in the session table", async () => {
    const issued = await auth.createSession(userId);
    const rows = await db.session.findMany({ where: { userId } });
    expect(JSON.stringify(rows)).not.toContain(issued.token);
    expect(rows[0]?.id).toBe(auth.sessionIdFromToken(issued.token));
  });
});
