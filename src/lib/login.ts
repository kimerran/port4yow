import { randomBytes } from "node:crypto";
import { hashPassword, verifyPassword } from "./auth";
import { db } from "./db";
import { logger } from "./logger";

/**
 * The login pipeline (SPEC §8, #25). Kept out of the route so it can be tested
 * directly and so the route stays a thin adapter.
 *
 * SERVER ONLY (AGENT §4).
 */

/** SPEC §8 — 5 consecutive failures locks the account for 15 minutes. */
export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

/**
 * SPEC §8 — the same message for a bad username and a bad password.
 *
 * Distinguishing them turns the login form into an account-existence oracle,
 * which is how an attacker builds the username list before they start guessing
 * passwords. A locked account gets this message too, for the same reason.
 */
export const GENERIC_LOGIN_ERROR = "That username and password don't match.";

/**
 * A hash to verify against when the username does not exist.
 *
 * Without it, an unknown username returns in ~0 ms while a known one costs a
 * full argon2 verify (~50 ms at these parameters), and the difference is
 * trivially measurable over a few requests — the account-existence oracle the
 * generic message was meant to close, reopened through the clock.
 *
 * Generated from `randomBytes` at first use rather than written into the source.
 * A fixed literal here would be a hardcoded credential, which AGENT §3 forbids
 * outright — and a real one, since anyone reading the repo would know the
 * plaintext that verifies against it.
 */
let dummyHash: Promise<string> | null = null;
const getDummyHash = (): Promise<string> => {
  dummyHash ??= hashPassword(randomBytes(32).toString("base64url"));
  return dummyHash;
};

export type LoginResult =
  | { ok: true; userId: string }
  /** `reason` is for the log line only — the caller shows one message. */
  | { ok: false; reason: "unknown-user" | "bad-password" | "locked" };

/**
 * Verifies credentials, maintaining the lockout counters.
 *
 * Every path runs exactly one argon2 verify, including the unknown-username and
 * locked-account paths. That is the whole point: the response time must not
 * depend on whether the account exists or on its lock state.
 *
 * This does NOT create a session — #25's route calls `rotateSession` on success
 * so that session handling stays in one place (#23).
 */
export async function attemptLogin(
  username: string,
  password: string,
  now: number = Date.now(),
): Promise<LoginResult> {
  const user = await db.user.findUnique({
    where: { username },
    select: {
      id: true,
      passwordHash: true,
      failedLogins: true,
      lockedUntil: true,
    },
  });

  // Unknown username: burn the same work, then fail.
  if (!user) {
    await verifyPassword(await getDummyHash(), password);
    logger.warn("login failed", { reason: "unknown-user" });
    return { ok: false, reason: "unknown-user" };
  }

  const locked = user.lockedUntil !== null && user.lockedUntil.getTime() > now;

  // Verify even when locked, so a locked account is not distinguishable by
  // timing from a merely wrong password.
  const passwordOk = await verifyPassword(user.passwordHash, password);

  if (locked) {
    logger.warn("login failed", { reason: "locked", username });
    return { ok: false, reason: "locked" };
  }

  if (!passwordOk) {
    const failedLogins = user.failedLogins + 1;
    const reachedThreshold = failedLogins >= LOCKOUT_THRESHOLD;

    await db.user.update({
      where: { id: user.id },
      data: {
        failedLogins,
        lockedUntil: reachedThreshold ? new Date(now + LOCKOUT_MS) : null,
      },
    });

    logger.warn("login failed", {
      reason: "bad-password",
      username,
      failed_logins: failedLogins,
      locked: reachedThreshold,
    });
    return { ok: false, reason: "bad-password" };
  }

  // Success: clear the counters so a later run of bad guesses starts from zero.
  await db.user.update({
    where: { id: user.id },
    data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date(now) },
  });

  return { ok: true, userId: user.id };
}
