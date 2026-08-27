import { createHash } from "node:crypto";
import { db } from "./db";
import { env } from "./env";
import { logger } from "./logger";

/**
 * The shared fixed-window rate limiter (SPEC §7.2, §11, §14.9).
 *
 * Every costly route goes through this: contact, login, media upload. It is
 * backed by the `RateLimit` table, and it is deliberately the only place that
 * decides whether a caller is over its budget.
 */

/** SPEC §14.9 — contact 5/hr/IP, login 10/15min/IP, media upload 30/hr/session. */
export const RATE_LIMITS = {
  contact: { limit: 5, windowSeconds: 60 * 60 },
  login: { limit: 10, windowSeconds: 15 * 60 },
  upload: { limit: 30, windowSeconds: 60 * 60 },
} as const;

export type RateLimitAction = keyof typeof RATE_LIMITS;

/**
 * SPEC §7.2 — "a global cap of 50/hour across all IPs as a flood brake".
 *
 * One shared counter, so the 51st contact submission in an hour is refused no
 * matter how many distinct IPs produced the first 50.
 */
export const CONTACT_GLOBAL = { limit: 50, windowSeconds: 60 * 60 } as const;

/** The key the global brake counts under. Not derived from any user input. */
const CONTACT_GLOBAL_KEY = "contact:global";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  /** Requests left in the current window; 0 once the limit is reached. */
  remaining: number;
  /** Whole seconds until the window resets — the `Retry-After` value. */
  retryAfterSeconds: number;
  resetAt: Date;
}

/**
 * SPEC §14.10 — hashed IPs only, never the raw address, anywhere.
 *
 * The salt makes the hash useless as a rainbow-table lookup: the IPv4 space is
 * small enough to enumerate in full against an unsalted sha256. This value ends
 * up in a primary key column, so it must not be reversible.
 *
 * AGENT §3 also forbids the raw IP in any log line, which is why nothing here
 * ever accepts an IP and a logger in the same breath — the caller hashes first.
 */
export function hashIp(ip: string): string {
  return createHash("sha256").update(`${ip}${env.IP_HASH_SALT}`).digest("hex");
}

/** `"contact:<ipHash>"` / `"login:<ipHash>"` / `"upload:<sessionId>"` (SPEC §7.2). */
export function rateLimitKey(action: RateLimitAction, subject: string): string {
  return `${action}:${subject}`;
}

interface CounterRow {
  count: number;
  expiresAt: Date;
}

/**
 * Increments one fixed-window counter and returns its new state.
 *
 * ONE statement, no transaction, and deliberately so. A read-then-write — even
 * inside a transaction — races under READ COMMITTED: two concurrent requests
 * both read 4, both write 5, and the 6th request is never refused. `ON CONFLICT
 * DO UPDATE` takes a row lock and evaluates `count + 1` against the committed
 * row, so concurrent callers serialise on that row and no increment is lost.
 *
 * The `CASE` is what makes the window roll over atomically: if the stored window
 * has already expired the row is reset to 1 with a fresh expiry, rather than
 * being deleted by a sweeper first and re-inserted. Doing it in the same
 * statement means there is no instant where an expired row reads as over-limit.
 *
 * Parameterised via Prisma's tagged template — AGENT §3 bans string-concatenated
 * SQL, and `key` is derived from user input.
 */
async function bump(key: string, windowSeconds: number): Promise<CounterRow> {
  const rows = await db.$queryRaw<CounterRow[]>`
    INSERT INTO "RateLimit" ("key", "count", "expiresAt")
    VALUES (${key}, 1, now() + make_interval(secs => ${windowSeconds}))
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimit"."expiresAt" <= now() THEN 1
        ELSE "RateLimit"."count" + 1
      END,
      "expiresAt" = CASE
        WHEN "RateLimit"."expiresAt" <= now()
        THEN now() + make_interval(secs => ${windowSeconds})
        ELSE "RateLimit"."expiresAt"
      END
    RETURNING "count", "expiresAt"
  `;

  const row = rows[0];

  /**
   * AGENT §1.5 — fail closed. A limiter that returns "allowed" when its own
   * storage misbehaves is worse than no limiter, because it looks like one.
   */
  if (!row) {
    throw new Error("rate limiter: counter write returned no row");
  }

  return row;
}

const toResult = (
  row: CounterRow,
  limit: number,
  now: number,
): RateLimitResult => {
  const resetAt = new Date(row.expiresAt);
  const msLeft = Math.max(0, resetAt.getTime() - now);
  return {
    allowed: row.count <= limit,
    limit,
    remaining: Math.max(0, limit - row.count),
    // Ceil, never floor: a floored 0 tells the caller to retry immediately and
    // be refused again.
    retryAfterSeconds: Math.ceil(msLeft / 1000),
    resetAt,
  };
};

/**
 * Consumes one unit of budget for `action` against `subject`.
 *
 * `subject` must already be a hashed IP for the IP-keyed actions — this module
 * never sees a raw address. Pass `hashIp(ip)`.
 *
 * Contact additionally consumes the global flood brake, but ONLY once the
 * per-IP check has passed. Consuming it first would let a single abusive IP
 * burn the shared 50/hour budget and lock everyone else out — turning a
 * per-IP limit into a denial of service against the whole form.
 */
export async function consume(
  action: RateLimitAction,
  subject: string,
): Promise<RateLimitResult> {
  const { limit, windowSeconds } = RATE_LIMITS[action];
  const now = Date.now();

  const own = toResult(
    await bump(rateLimitKey(action, subject), windowSeconds),
    limit,
    now,
  );

  if (!own.allowed || action !== "contact") return own;

  const global = toResult(
    await bump(CONTACT_GLOBAL_KEY, CONTACT_GLOBAL.windowSeconds),
    CONTACT_GLOBAL.limit,
    now,
  );

  if (!global.allowed) {
    /**
     * Worth a log line: the per-IP limits are routine, but the global brake
     * tripping means the whole form is refusing traffic and somebody should
     * know. No IP, hashed or otherwise — this counter is not per-IP, and there
     * is nothing here that identifies a person.
     */
    logger.warn("contact flood brake engaged", {
      limit: CONTACT_GLOBAL.limit,
      window_seconds: CONTACT_GLOBAL.windowSeconds,
    });
    return global;
  }

  return own;
}

/**
 * Redis is NOT wired up, and this says so rather than pretending.
 *
 * SPEC §11: "Ship the Postgres-backed rate limiter first; introduce Redis only
 * if the counter write volume becomes a problem." So the Postgres backend is
 * the whole implementation today. But SPEC §7.2 also says the limiter uses
 * Redis "transparently" when `REDIS_URL` is set — and an operator who sets that
 * variable and gets silence would reasonably conclude Redis is absorbing the
 * writes. It is not. One warning at startup, not per request.
 */
if (env.REDIS_URL) {
  logger.warn(
    "REDIS_URL is set but the rate limiter is Postgres-backed; Redis is not in use",
    { backend: "postgres" },
  );
}
