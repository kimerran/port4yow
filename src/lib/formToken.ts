import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Signed form timestamps (SPEC §7 step 4, #21).
 *
 * The contact form carries a `renderedAt` value saying when the page was built.
 * It is HMAC-signed with `FORM_SECRET` so a bot cannot mint one, and it powers
 * the timing half of the honeypot check: a form submitted three seconds after it
 * rendered was not filled in by a person.
 *
 * Signing is #21's half; `verifyFormToken` is what #22 calls on the way in.
 * They live together because a signature scheme tested only from the signing
 * side proves very little.
 */

/**
 * A human needs longer than this to read three fields and write a message. Bots
 * post immediately. Deliberately conservative — the cost of a false positive is
 * a real message silently marked SPAM.
 */
export const MIN_AGE_MS = 3_000;

/**
 * A form left open longer than this is stale; re-render to get a new one.
 *
 * SPEC §7: "Submissions under 3 seconds or over 30 minutes old are rejected",
 * and #22 step 4 repeats the same pair. This was 60 minutes on the first pass —
 * a number I chose rather than read, which is exactly what AGENT §1.1 warns
 * about for versions and applies just as well to a spec constant.
 */
export const MAX_AGE_MS = 30 * 60 * 1000;

const sign = (payload: string): string =>
  createHmac("sha256", env.FORM_SECRET).update(payload).digest("hex");

/** `<issuedAtMs>.<hmac>` — the value of the hidden `renderedAt` field. */
export function createFormToken(now: number = Date.now()): string {
  const issuedAt = String(now);
  return `${issuedAt}.${sign(issuedAt)}`;
}

export type FormTokenVerdict =
  | { valid: true; ageMs: number }
  | {
      valid: false;
      reason: "malformed" | "bad-signature" | "too-fast" | "expired";
    };

/**
 * Verifies shape, signature, then age — in that order, because an unsigned
 * timestamp's age means nothing.
 *
 * The comparison is `timingSafeEqual`, not `===`. A byte-by-byte early return
 * leaks how much of a candidate signature was correct, which is enough to forge
 * one a byte at a time. Lengths are checked first because `timingSafeEqual`
 * throws on a length mismatch.
 */
export function verifyFormToken(
  token: unknown,
  now: number = Date.now(),
): FormTokenVerdict {
  if (typeof token !== "string") return { valid: false, reason: "malformed" };

  const separator = token.indexOf(".");
  if (separator <= 0) return { valid: false, reason: "malformed" };

  const issuedAt = token.slice(0, separator);
  const candidate = token.slice(separator + 1);
  if (!/^\d+$/.test(issuedAt)) return { valid: false, reason: "malformed" };

  const expected = sign(issuedAt);
  if (candidate.length !== expected.length) {
    return { valid: false, reason: "bad-signature" };
  }
  if (
    !timingSafeEqual(
      Buffer.from(candidate, "utf8"),
      Buffer.from(expected, "utf8"),
    )
  ) {
    return { valid: false, reason: "bad-signature" };
  }

  const ageMs = now - Number(issuedAt);
  // A token from the future is as wrong as an expired one, and negative ages
  // would otherwise sail through the MIN_AGE check.
  if (ageMs < MIN_AGE_MS) return { valid: false, reason: "too-fast" };
  if (ageMs > MAX_AGE_MS) return { valid: false, reason: "expired" };

  return { valid: true, ageMs };
}
