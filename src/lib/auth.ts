import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { db } from "./db";
import { logger } from "./logger";

/**
 * Hand-rolled session auth (SPEC §8). No third-party auth service.
 *
 * SERVER ONLY. This module reads and writes password hashes and session rows and
 * must never be imported from a client script (AGENT §4).
 */

/**
 * OWASP's argon2id minimum (SPEC §8). These are not tuning knobs to lower when
 * a login feels slow — 19 MiB and two passes is already the floor, and dropping
 * below it makes an offline crack of a leaked hash cheaper by the same factor.
 *
 * `algorithm` is spelled out rather than left to the library default: argon2id
 * is the hybrid that resists both side-channel and GPU attacks, and a default
 * that silently became argon2i or argon2d would weaken one of those halves.
 *
 * The literal `2` rather than `Algorithm.Argon2id`: the library declares that as
 * an ambient `const enum`, which `verbatimModuleSyntax` refuses to import. The
 * value is read from `@node-rs/argon2/index.d.ts` (`Argon2id = 2`), not
 * remembered, and a test asserts a hash produced with it announces itself as
 * `$argon2id$` — so a future version renumbering the enum fails loudly.
 */
const ARGON2ID = 2;

export const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  algorithm: ARGON2ID,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/**
 * Constant-time comparison, via the library — never `===` on a digest.
 *
 * Fails closed on a throw. `verify` rejects on a malformed or truncated stored
 * hash, and an exception escaping here would become a 500 on the login route;
 * worse, a caller that caught it loosely could treat "the hash is corrupt" as
 * "the password is fine". A hash we cannot read is a password that does not
 * match (AGENT §1.5).
 */
export async function verifyPassword(
  storedHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(storedHash, password, ARGON2_OPTIONS);
  } catch {
    logger.error("password verify failed: unreadable hash");
    return false;
  }
}

/** SPEC §8 — 30 days. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** SPEC §8 — under 15 days remaining, extend back to 30. */
export const SESSION_SLIDING_THRESHOLD_MS = 15 * 24 * 60 * 60 * 1000;

/**
 * The `__Host-` prefix is a browser-enforced guarantee, not decoration: a cookie
 * carrying it is refused unless it is Secure, `Path=/`, and has NO `Domain`
 * attribute. That last part is the point — it cannot be set by a subdomain, so a
 * compromised sibling host cannot plant a session for us.
 */
export const SESSION_COOKIE = "__Host-session";

/**
 * `sameSite: "lax"` rather than `"strict"`: strict would drop the cookie on any
 * top-level navigation INTO the admin from an external link, including the
 * browser's own address bar in some flows, so a logged-in admin would appear
 * logged out at random. Lax still withholds it from cross-site POSTs, which is
 * the CSRF case that matters, and #22's explicit Origin check covers the rest.
 */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: SESSION_TTL_MS / 1000,
} as const;

/**
 * The session id stored in the database.
 *
 * SPEC §8: only `sha256(token)` is persisted, never the token. A leaked database
 * therefore yields no usable cookies — the digest cannot be replayed, and
 * reversing it means reversing sha256 over 32 bytes of CSPRNG output.
 *
 * No salt, deliberately, unlike `hashIp`. A salt defends against enumerating a
 * small input space; this input is 256 bits of randomness, so there is nothing
 * to enumerate, and an unsalted digest is what lets a lookup be a single indexed
 * read rather than a table scan.
 */
export function sessionIdFromToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 32 bytes of CSPRNG, base64url so it is cookie-safe without escaping. */
export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface SessionMeta {
  /** Already salted-hashed by the caller — never a raw address (SPEC §14.10). */
  ipHash?: string | null;
  userAgent?: string | null;
}

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

/** Creates a session row and returns the token, which is never stored. */
export async function createSession(
  userId: string,
  meta: SessionMeta = {},
  now: number = Date.now(),
): Promise<IssuedSession> {
  const token = createSessionToken();
  const expiresAt = new Date(now + SESSION_TTL_MS);

  await db.session.create({
    data: {
      id: sessionIdFromToken(token),
      userId,
      expiresAt,
      ipHash: meta.ipHash ?? null,
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
    },
  });

  return { token, expiresAt };
}

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: string;
}

export interface ValidatedSession {
  user: SessionUser;
  expiresAt: Date;
  /** True when sliding expiry extended it — the caller must re-set the cookie. */
  refreshed: boolean;
}

/**
 * Resolves a token to its user, or null.
 *
 * Null covers every failure — absent, unknown, expired, or an error reaching the
 * database. SPEC §8 says "fail closed on any error", and returning null rather
 * than throwing is what makes that the default: a caller that forgets a
 * try/catch still ends up with no user rather than a 500 that leaks a stack, and
 * there is no code path where a thrown error could be mistaken for a valid
 * session.
 *
 * Expired rows are deleted on access rather than left for the daily prune (§11),
 * so a stolen-but-expired token stops appearing in the table the moment it is
 * used.
 */
export async function validateSession(
  token: string | undefined | null,
  now: number = Date.now(),
): Promise<ValidatedSession | null> {
  if (!token) return null;

  try {
    const id = sessionIdFromToken(token);
    const session = await db.session.findUnique({
      where: { id },
      select: {
        expiresAt: true,
        user: {
          select: { id: true, username: true, displayName: true, role: true },
        },
      },
    });

    if (!session) return null;

    if (session.expiresAt.getTime() <= now) {
      await db.session.delete({ where: { id } }).catch(() => {
        // A concurrent request may have deleted it already. The session is
        // invalid either way, which is all the caller needs.
      });
      return null;
    }

    // Sliding expiry (SPEC §8).
    const remaining = session.expiresAt.getTime() - now;
    if (remaining < SESSION_SLIDING_THRESHOLD_MS) {
      const expiresAt = new Date(now + SESSION_TTL_MS);
      await db.session.update({ where: { id }, data: { expiresAt } });
      return { user: session.user, expiresAt, refreshed: true };
    }

    return {
      user: session.user,
      expiresAt: session.expiresAt,
      refreshed: false,
    };
  } catch (cause) {
    logger.error("session validation failed", {
      reason: cause instanceof Error ? cause.message : "unknown",
    });
    return null;
  }
}

/** Deletes one session. Safe to call with a token that no longer exists. */
export async function invalidateSession(
  token: string | undefined | null,
): Promise<void> {
  if (!token) return;
  await db.session
    .delete({ where: { id: sessionIdFromToken(token) } })
    .catch(() => {
      // Already gone. Logging out twice is not an error.
    });
}

/**
 * Issues a fresh session and destroys the one that was presented.
 *
 * SPEC §8's session-fixation defence. The order matters: the new row is created
 * BEFORE the old one is deleted, so a failure between the two leaves the user
 * with a working session rather than logged out mid-login. The old id stops
 * validating either way, which is the property that matters.
 *
 * Call this on every successful login, including when no prior session was
 * presented — passing `null` is the normal case and simply creates one.
 */
export async function rotateSession(
  previousToken: string | undefined | null,
  userId: string,
  meta: SessionMeta = {},
  now: number = Date.now(),
): Promise<IssuedSession> {
  const issued = await createSession(userId, meta, now);
  await invalidateSession(previousToken);
  return issued;
}
