import { createHash } from "node:crypto";
import { env } from "./env";
import { logger } from "./logger";

/**
 * The fixed-window rate limiter for the one remaining dynamic route (SPEC §7.2,
 * §14.9).
 *
 * ## Why this is now in memory, and what that costs
 *
 * It was backed by a `RateLimit` table, with a single `INSERT … ON CONFLICT DO
 * UPDATE` chosen specifically because a read-then-write races under READ
 * COMMITTED. That reasoning was about *concurrent writers to shared storage*,
 * and it was correct. With the database gone there is no shared storage left to
 * race on, so the counter lives in this process.
 *
 * The honest limitations, stated rather than discovered later:
 *
 * - **Counters reset on deploy and restart.** A determined caller can clear
 *   their budget by waiting for a deploy. The window is an hour; deploys are
 *   rarer than that in practice, and the failure mode is a few extra emails.
 * - **They are per-instance.** Run two containers and the effective limit
 *   doubles. This site is one container (SPEC §13), and the flood brake below
 *   is what actually bounds the damage.
 *
 * Node is single-threaded per instance, so `Map` mutation here is atomic in the
 * way the SQL statement had to be made atomic — the increment and the read
 * cannot interleave.
 */

/**
 * SPEC §14.9 — contact 5/hr/IP. Login and upload are gone with the admin.
 *
 * `access` and `resume` are looser than contact on purpose: they are triggered
 * by looking at the site rather than by writing to someone, and a shared office
 * NAT would otherwise lock a whole floor out of the portfolio after five
 * visitors. They still need a limit — each one sends an email, so an unbounded
 * endpoint is an outbound mail amplifier pointed at the owner's inbox.
 */
export const RATE_LIMITS = {
  contact: { limit: 5, windowSeconds: 60 * 60 },
  access: { limit: 20, windowSeconds: 60 * 60 },
  resume: { limit: 20, windowSeconds: 60 * 60 },
} as const;

export type RateLimitAction = keyof typeof RATE_LIMITS;

/**
 * SPEC §7.2 — "a global cap of 50/hour across all IPs as a flood brake".
 *
 * One shared counter, so the 51st contact submission in an hour is refused no
 * matter how many distinct IPs produced the first 50. This matters more now
 * than it did: it is the bound that does not depend on per-IP bookkeeping
 * surviving anything.
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
 * small enough to enumerate in full against an unsalted sha256.
 *
 * AGENT §3 also forbids the raw IP in any log line, which is why nothing here
 * ever accepts an IP and a logger in the same breath — the caller hashes first.
 */
export function hashIp(ip: string): string {
  return createHash("sha256").update(`${ip}${env.IP_HASH_SALT}`).digest("hex");
}

/**
 * The address to key a per-IP limit on.
 *
 * Behind a proxy the socket address is the PROXY, so keying on it would give the
 * whole internet one shared bucket. `X-Forwarded-For` is a list; the FIRST entry
 * is the original client. It is caller-controlled and therefore spoofable, which
 * is exactly why the global flood brake exists as a backstop.
 */
export function clientIpFrom(request: Request, socketAddress: string): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : socketAddress;
}

export function rateLimitKey(action: RateLimitAction, subject: string): string {
  return `${action}:${subject}`;
}

interface Counter {
  count: number;
  expiresAt: number;
}

const counters = new Map<string, Counter>();

/**
 * Bounds the map so a stream of unique IPs cannot grow it without limit.
 *
 * A sweep on write is enough: entries are only ever added here, so there is no
 * path that grows the map without passing through this function. A timer would
 * keep the process awake for no benefit.
 */
const MAX_COUNTERS = 10_000;

function sweep(now: number): void {
  for (const [key, counter] of counters) {
    if (counter.expiresAt <= now) counters.delete(key);
  }
}

/** Increments one fixed-window counter and returns its new state. */
function bump(key: string, windowSeconds: number, now: number): Counter {
  const existing = counters.get(key);

  // Rolls the window over in the same step as the increment, so there is no
  // instant where an expired counter still reads as over-limit.
  if (!existing || existing.expiresAt <= now) {
    if (counters.size >= MAX_COUNTERS) sweep(now);
    const fresh = { count: 1, expiresAt: now + windowSeconds * 1000 };
    counters.set(key, fresh);
    return fresh;
  }

  existing.count += 1;
  return existing;
}

const toResult = (
  counter: Counter,
  limit: number,
  now: number,
): RateLimitResult => {
  const msLeft = Math.max(0, counter.expiresAt - now);
  return {
    allowed: counter.count <= limit,
    limit,
    remaining: Math.max(0, limit - counter.count),
    // Ceil, never floor: a floored 0 tells the caller to retry immediately and
    // be refused again.
    retryAfterSeconds: Math.ceil(msLeft / 1000),
    resetAt: new Date(counter.expiresAt),
  };
};

/**
 * Consumes one unit of budget for `action` against `subject`.
 *
 * `subject` must already be a hashed IP — this module never sees a raw address.
 * Pass `hashIp(ip)`.
 *
 * Contact additionally consumes the global flood brake, but ONLY once the per-IP
 * check has passed. Consuming it first would let a single abusive IP burn the
 * shared 50/hour budget and lock everyone else out — turning a per-IP limit into
 * a denial of service against the whole form.
 *
 * The brake stays contact-specific. `access` fires on every first visit, so
 * routing it through a 50/hour shared counter would mean a good day's traffic
 * silencing the contact form.
 */
export function consume(
  action: RateLimitAction,
  subject: string,
): RateLimitResult {
  const { limit, windowSeconds } = RATE_LIMITS[action];
  const now = Date.now();

  const own = toResult(
    bump(rateLimitKey(action, subject), windowSeconds, now),
    limit,
    now,
  );

  if (!own.allowed || action !== "contact") return own;

  const global = toResult(
    bump(CONTACT_GLOBAL_KEY, CONTACT_GLOBAL.windowSeconds, now),
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

/** Exported for tests, which must be able to start from a known state. */
export function __resetRateLimits(): void {
  counters.clear();
}
