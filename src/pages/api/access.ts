import type { APIRoute } from "astro";
import { logger, newCorrelationId } from "../../lib/logger";
import { sendVisitAlert } from "../../lib/mail";
import { isSameOrigin } from "../../lib/origin";
import { clientIpFrom, consume, hashIp } from "../../lib/ratelimit";
import { factsFrom, VisitorSchema } from "../../lib/visitor";

export const prerender = false;

/**
 * `POST /api/access` — the viewing gate.
 *
 * A visitor gives an email before the portfolio is readable; this records it by
 * emailing it to the owner, and that email IS the record. There is no database
 * to write to, which is the same trade the contact route makes and carries the
 * same consequence: **if the mail provider fails, the lead is lost.** It is
 * logged with a correlation id, which is the only remaining trace.
 *
 * ## What this gate is and is not
 *
 * It is a client-side overlay. The page HTML is prerendered and complete before
 * the gate renders over it, so this is a **courtesy gate, not an access
 * control**: view-source, curl, a reader-mode button, or JavaScript being off
 * all bypass it. Making it real would mean server-rendering every page behind a
 * session, which is the architecture this site was deliberately moved off.
 *
 * That is worth being plain about rather than discovering later — nothing behind
 * the gate should be anything that must not be public.
 */

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
      "Cache-Control": "no-store",
      ...headers,
    },
  });

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const correlationId = newCorrelationId();

  try {
    // 1 · Origin. Same check the contact route uses, so the two cannot drift.
    if (!isSameOrigin(request)) {
      logger.warn("access rejected: cross-origin", {
        correlation_id: correlationId,
      });
      return json(403, { ok: false, error: "Forbidden." });
    }

    // 2 · Rate limit. The IP is hashed immediately; no raw address exists past
    // this line (SPEC §14.10).
    const ipHash = hashIp(clientIpFrom(request, clientAddress));
    const limit = consume("access", ipHash);

    if (!limit.allowed) {
      logger.warn("access rate limited", {
        correlation_id: correlationId,
        retry_after: limit.retryAfterSeconds,
      });
      return json(
        429,
        { ok: false, error: "Too many attempts. Try again a bit later." },
        { "Retry-After": String(limit.retryAfterSeconds) },
      );
    }

    // 3 · Validate.
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return json(400, { ok: false, errors: {} });
    }

    const parsed = VisitorSchema.safeParse(raw);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === "string" && !(field in errors)) {
          errors[field] = issue.message;
        }
      }
      logger.info("access validation failed", {
        correlation_id: correlationId,
        // Field NAMES only. The values are what the visitor typed.
        fields: Object.keys(errors),
      });
      return json(400, { ok: false, errors });
    }

    const data = parsed.data;

    /**
     * 4 · Honeypot. A filled `company` is answered with the SAME 200 as a real
     * submission and nothing is sent — the visitor is let through either way,
     * because refusing would tell a bot it was caught and would punish anyone
     * whose password manager filled a hidden field.
     */
    if ((data.company ?? "").length > 0) {
      logger.info("access classified as spam", {
        correlation_id: correlationId,
        reason: "honeypot",
      });
      return json(200, { ok: true });
    }

    // 5 · Report.
    const sent = await sendVisitAlert(
      {
        messageId: correlationId,
        kind: "visit",
        email: data.email,
        name: data.name,
        facts: factsFrom(data, {
          ipHash,
          at: new Date().toISOString(),
        }),
      },
      correlationId,
    );

    if (!sent.ok) {
      logger.error("access lead not delivered and not stored", {
        correlation_id: correlationId,
      });
    }

    /**
     * 200 regardless. The visitor gave their email to read a portfolio; holding
     * the page hostage to a mail provider they cannot see or influence would
     * punish them for our outage.
     */
    return json(200, { ok: true });
  } catch (cause) {
    logger.error("access failed", {
      correlation_id: correlationId,
      reason: cause instanceof Error ? cause.message : "unknown",
    });
    return json(500, { ok: false, error: GENERIC_500 });
  }
};
