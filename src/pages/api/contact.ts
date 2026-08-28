import type { APIRoute } from "astro";
import { z } from "zod";
import { verifyFormToken } from "../../lib/formToken";
import { logger, newCorrelationId } from "../../lib/logger";
import { isSameOrigin } from "../../lib/origin";
import { sendContactEmail } from "../../lib/mail";
import { clientIpFrom, consume, hashIp } from "../../lib/ratelimit";
import { verifyTurnstile } from "../../lib/turnstile";

export const prerender = false;

/**
 * `POST /api/contact` — the only dynamic route on the site (SPEC §7, AGENT §3).
 *
 * Runs in SPEC §7's order minus one step: origin, rate limit, validate,
 * honeypot/timing, send. Every step that can refuse does so before the next one
 * runs, so an unparsed field never reaches anything downstream.
 *
 * **Persist is gone.** SPEC §7 has the message written to `ContactMessage`
 * before dispatch, so a provider outage still kept it and the admin inbox showed
 * it as undelivered. With no database the email IS the record, and the
 * consequence is worth stating plainly rather than burying: if the provider
 * fails, the message is lost. The spam audit trail goes the same way — a caught
 * submission is no longer stored as `status: SPAM` for later threshold tuning,
 * it is logged and dropped.
 */

/**
 * SPEC §7's `ContactSchema`, with ONE deliberate difference: `company` is
 * lenient here rather than `z.string().max(0)`.
 *
 * The spec's own schema and its own step 4 contradict each other. `max(0)` makes
 * a filled honeypot a Zod failure, which returns a field-keyed 400 — and step 4
 * says a caught bot must get "the same 200 success shape as a real submission …
 * Never tell a bot it was caught." A 400 naming `company` tells it exactly what
 * it was caught by.
 *
 * So the honeypot never produces a validation error; it is evaluated in step 4
 * where the spec's behaviour is defined. The error copy is verbatim from §7.
 *
 * `renderedAt` is optional for the same reason, one field over. Required, a
 * missing token answered `400 {"renderedAt": "Invalid input: expected string,
 * received undefined"}` — which names a hidden field a human cannot act on,
 * confirms to a bot that the token is what it forgot, and leaks raw Zod
 * internals where every other string here is verbatim §7 copy. Absent is just
 * another invalid token, and `verifyFormToken` already returns `malformed` for
 * `undefined`.
 */
/**
 * Exported for #37's boundary tests. The integration suite exercises the route
 * end to end, but a route test cannot reach a value the schema rejects before
 * the handler runs — min-1 and max+1 on each field are only observable here.
 */
export const ContactSchema = z.object({
  name: z.string().trim().min(2, "Tell me what to call you.").max(120),
  email: z.email("That email address looks incomplete.").max(255),
  message: z
    .string()
    .trim()
    .min(20, "A couple more sentences would help.")
    .max(5000),
  company: z.string().optional(),
  renderedAt: z.string().optional(),
});

const GENERIC_500 = "Something went wrong on my end. Try again in a minute.";

const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      // Nothing here is cacheable, and a cached 429 or 400 would be actively
      // wrong for the next visitor behind the same proxy.
      "Cache-Control": "no-store",
      ...headers,
    },
  });

/** Accepts JSON, urlencoded and multipart — #21's two paths send the latter two. */
async function readBody(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [
        k,
        typeof v === "string" ? v : "",
      ]),
    );
  }

  const form = await request.formData();
  return Object.fromEntries(
    [...form.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]),
  );
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const correlationId = newCorrelationId();

  try {
    // 1 · Origin — shared with login and logout so the three cannot drift.
    if (!isSameOrigin(request)) {
      logger.warn("contact rejected: cross-origin", {
        correlation_id: correlationId,
      });
      return json(403, { ok: false, error: "Forbidden." });
    }

    // 2 · Rate limit. `clientIpFrom` unwraps X-Forwarded-For — behind a proxy
    // the socket address is the PROXY, so keying on it gives the whole internet
    // one shared bucket. The IP is hashed immediately, so no raw address exists
    // past this line (SPEC §14.10).
    const ipHash = hashIp(clientIpFrom(request, clientAddress));
    const limit = consume("contact", ipHash);

    if (!limit.allowed) {
      logger.warn("contact rate limited", {
        correlation_id: correlationId,
        retry_after: limit.retryAfterSeconds,
      });
      return json(
        429,
        {
          ok: false,
          error: "That's a few too many messages. Try again a bit later.",
          retryAfter: limit.retryAfterSeconds,
        },
        { "Retry-After": String(limit.retryAfterSeconds) },
      );
    }

    // 3 · Validate.
    let raw: Record<string, string>;
    try {
      raw = await readBody(request);
    } catch {
      // A body we cannot parse is not a field-level problem, so it gets the
      // generic shape rather than a map naming fields we never saw.
      return json(400, { ok: false, errors: {} });
    }

    const parsed = ContactSchema.safeParse(raw);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        // First message per field: a second one for the same input is noise.
        if (typeof field === "string" && !(field in errors)) {
          errors[field] = issue.message;
        }
      }
      logger.info("contact validation failed", {
        correlation_id: correlationId,
        // Field NAMES only. The values are what the visitor typed.
        fields: Object.keys(errors),
      });
      return json(400, { ok: false, errors });
    }

    const data = parsed.data;

    /**
     * 4 · Honeypot and timing.
     *
     * A filled `company`, or a token that is forged, too fast or stale, all mean
     * the same thing: this did not come from a person using our form. All of
     * them take the SPAM path, which is indistinguishable from success — SPEC §7
     * is explicit that a bot is never told it was caught, and that includes not
     * being told its token was rejected.
     */
    const token = verifyFormToken(data.renderedAt);
    const honeypotFilled = (data.company ?? "").length > 0;

    /**
     * Turnstile, when configured. A token that is PRESENT and rejected takes
     * the spam path; an absent token does not, because a no-JS visitor cannot
     * produce one and SPEC §7 requires that path to work. `turnstile.ts`
     * documents the gap that leaves.
     */
    const turnstile = await verifyTurnstile(
      raw["cf-turnstile-response"],
      correlationId,
    );

    /**
     * A stale Turnstile token is answered, not swallowed.
     *
     * Tokens expire after 300 seconds. Someone who opens the page and takes six
     * minutes over their message has a genuinely expired token, and SPEC §7's
     * silent 200 would drop that message without telling anyone — the exact
     * failure the build-time form token was just fixed for. This is the one
     * place the indistinguishable-200 rule is deliberately not applied, because
     * the visitor can act on the answer: the widget refreshes and they resubmit.
     *
     * A bot learns only that its token was rejected, which it could infer from
     * being unable to solve the challenge in the first place.
     */
    if (!turnstile.ok && turnstile.retryable) {
      logger.info("contact turnstile token stale", {
        correlation_id: correlationId,
        reason: turnstile.reason,
      });
      return json(400, {
        ok: false,
        errors: {
          turnstile: "That verification expired. Try sending again.",
        },
      });
    }

    const isSpam = honeypotFilled || !token.valid || !turnstile.ok;
    const spamReason = honeypotFilled
      ? "honeypot"
      : !token.valid
        ? token.reason
        : turnstile.ok
          ? null
          : `turnstile:${turnstile.reason}`;

    if (isSpam) {
      /**
       * Dropped, not delivered — and answered with the SAME 200 as a real
       * submission. SPEC §7 is explicit that a bot is never told it was caught,
       * which is why this returns before the send rather than refusing.
       */
      logger.info("contact classified as spam", {
        correlation_id: correlationId,
        // Why, for tuning the thresholds later. No user content.
        reason: spamReason,
      });
      return json(200, { ok: true });
    }

    /**
     * 5 · Send. `sendContactEmail` never throws, so a provider outage returns
     * `{ ok: false }` rather than reaching the catch below.
     *
     * The correlation id is the idempotency key, standing in for the message row
     * id that used to fill that role — see `sendContactEmail` for what the
     * guarantee is now worth.
     *
     * A failure still returns 200. There is no longer a stored copy to point at,
     * but the submitter cannot act on the difference: retrying reaches the same
     * broken provider, and the honest alternative — "your message was lost" —
     * costs them the same and reads worse. The log line is the only trace.
     */
    const sent = await sendContactEmail(
      {
        messageId: correlationId,
        name: data.name,
        email: data.email,
        message: data.message,
      },
      correlationId,
    );

    if (!sent.ok) {
      logger.error("contact message not delivered and not stored", {
        correlation_id: correlationId,
      });
    }

    return json(200, { ok: true });
  } catch (cause) {
    logger.error("contact failed", {
      correlation_id: correlationId,
      reason: cause instanceof Error ? cause.message : "unknown",
    });
    return json(500, { ok: false, error: GENERIC_500 });
  }
};
