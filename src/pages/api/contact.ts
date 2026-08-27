import type { APIRoute } from "astro";
import { z } from "zod";
import { db } from "../../lib/db";
import { verifyFormToken } from "../../lib/formToken";
import { logger, newCorrelationId } from "../../lib/logger";
import { isSameOrigin } from "../../lib/origin";
import { sendContactEmail } from "../../lib/mail";
import { clientIpFrom, consume, hashIp } from "../../lib/ratelimit";

export const prerender = false;

/**
 * `POST /api/contact` — the full server pipeline (SPEC §7, AGENT §3).
 *
 * Runs in SPEC §7's order: origin, rate limit, validate, honeypot/timing,
 * persist, send. Every step that can refuse does so before the next one runs,
 * so an unparsed field never reaches anything downstream.
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
    const limit = await consume("contact", ipHash);

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
    const isSpam = honeypotFilled || !token.valid;
    const spamReason = honeypotFilled
      ? "honeypot"
      : token.valid
        ? null
        : token.reason;

    // 5 · Persist. `ipHash` only — the raw address was never stored anywhere.
    const message = await db.contactMessage.create({
      data: {
        name: data.name,
        email: data.email,
        message: data.message,
        status: isSpam ? "SPAM" : "NEW",
        ipHash,
        userAgent: request.headers.get("user-agent")?.slice(0, 512) ?? null,
      },
      select: { id: true },
    });

    if (isSpam) {
      logger.info("contact classified as spam", {
        correlation_id: correlationId,
        message_id: message.id,
        // Why, for tuning the thresholds later. No user content.
        reason: spamReason,
      });
      return json(200, { ok: true });
    }

    /**
     * 6 · Send. `sendContactEmail` never throws and owns writing `resendId` and
     * `deliveredAt` (#20), so there is no delivery bookkeeping here — doing it
     * in both places is how the two drift apart.
     *
     * 7 · A failure still returns 200. The message is already in the database,
     * which is the part that matters to the visitor; it surfaces in the admin
     * inbox as undelivered because `deliveredAt` stays null.
     */
    await sendContactEmail(
      {
        messageId: message.id,
        name: data.name,
        email: data.email,
        message: data.message,
      },
      correlationId,
    );

    return json(200, { ok: true });
  } catch (cause) {
    logger.error("contact failed", {
      correlation_id: correlationId,
      reason: cause instanceof Error ? cause.message : "unknown",
    });
    return json(500, { ok: false, error: GENERIC_500 });
  }
};
