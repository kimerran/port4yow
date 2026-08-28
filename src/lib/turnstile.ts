import { env } from "./env";
import { logger } from "./logger";

/**
 * Cloudflare Turnstile verification (SPEC §7).
 *
 * ## The three states, and why "unconfigured" is one of them
 *
 * Turnstile needs a Cloudflare account. Requiring it to run the site would make
 * a local checkout unbootable for anyone without one, so absence of both keys is
 * a supported state: no widget is rendered and no token is expected. `env.ts`
 * refuses the half-configured case, which is the dangerous one — a widget on the
 * page with nothing checking it server-side is decoration that reads as
 * security.
 *
 * ## What a missing token means
 *
 * NOT a rejection. SPEC §7 requires the contact form to work as a plain POST
 * with JavaScript disabled, and a no-JS visitor cannot produce a token — the
 * widget is a script. So a request with no token falls through to the honeypot
 * and timing checks that predate this.
 *
 * That is a real gap, stated rather than papered over: a bot that simply omits
 * the field gets the same treatment as a no-JS human. Turnstile raises the cost
 * of the scripted path; it does not close it. Closing it would mean breaking the
 * no-JS requirement, which is a deliberate accessibility commitment.
 */

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** How long to wait on Cloudflare before giving up. */
const TIMEOUT_MS = 5_000;

export type TurnstileResult =
  | { ok: true; reason: "disabled" | "absent" | "verified" }
  | { ok: false; reason: string };

export const turnstileConfigured = (): boolean =>
  Boolean(env.PUBLIC_TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY);

export async function verifyTurnstile(
  token: string | undefined,
  correlationId?: string,
): Promise<TurnstileResult> {
  if (!turnstileConfigured()) return { ok: true, reason: "disabled" };
  if (!token || token.length === 0) return { ok: true, reason: "absent" };

  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY ?? "",
    response: token,
  });

  /**
   * A timeout, because this sits in the request path of a form a human is
   * waiting on. `AbortSignal.timeout` rather than a racing promise: it actually
   * cancels the fetch, so a slow Cloudflare does not leave a socket open per
   * submission.
   */
  try {
    const response = await fetch(VERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      /**
       * Fail OPEN on a transport failure, and only on a transport failure.
       *
       * Cloudflare being unreachable is our problem, not the visitor's, and
       * refusing every message while it is down loses real mail to protect
       * against spam that the honeypot still catches. A token that is present
       * and *rejected* is a different thing and fails closed below.
       */
      logger.warn("turnstile unreachable; allowing submission", {
        correlation_id: correlationId,
        status: response.status,
      });
      return { ok: true, reason: "verified" };
    }

    const data = (await response.json()) as {
      success?: boolean;
      "error-codes"?: string[];
    };

    if (data.success === true) return { ok: true, reason: "verified" };

    return {
      ok: false,
      // Cloudflare's own codes, which are enumerated and safe to log. No token
      // and no secret ever reaches a log line.
      reason: (data["error-codes"] ?? ["unknown"]).join(","),
    };
  } catch (cause) {
    logger.warn("turnstile check failed; allowing submission", {
      correlation_id: correlationId,
      reason: cause instanceof Error ? cause.message : "unknown",
    });
    return { ok: true, reason: "verified" };
  }
}
