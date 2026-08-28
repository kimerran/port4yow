import type { APIRoute } from "astro";
import { logger, newCorrelationId } from "../../lib/logger";
import { sendVisitAlert } from "../../lib/mail";
import { isSameOrigin } from "../../lib/origin";
import { clientIpFrom, consume, hashIp } from "../../lib/ratelimit";
import { factsFrom, VisitorSchema } from "../../lib/visitor";

export const prerender = false;

/**
 * `POST /api/resume` — records a resume download and alerts the owner.
 *
 * ## Why this is a POST beside the link, and not the link itself
 *
 * The obvious design is `<a href="/api/resume">`, with the route sending the
 * alert and redirecting to the file. It is wrong in a specific way: a GET that
 * sends email fires for every link prefetcher, every corporate mail scanner
 * that unfurls URLs, and every crawler that ignores `nofollow`. The owner's
 * inbox fills with downloads that never happened.
 *
 * So the anchor points straight at the static PDF — it works with JavaScript
 * off, which is the behaviour that matters — and a click handler posts here
 * first. The trade is that a no-JS download is not reported. A missing
 * notification is a smaller failure than a fabricated one.
 */

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const correlationId = newCorrelationId();

  try {
    if (!isSameOrigin(request)) {
      logger.warn("resume alert rejected: cross-origin", {
        correlation_id: correlationId,
      });
      return json(403, { ok: false });
    }

    const ipHash = hashIp(clientIpFrom(request, clientAddress));
    const limit = consume("resume", ipHash);
    if (!limit.allowed) {
      // No `Retry-After` and no error copy: nothing is shown to the visitor,
      // whose download proceeds regardless. This response is only for the
      // fetch that reports it.
      return json(429, { ok: false });
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return json(400, { ok: false });
    }

    const parsed = VisitorSchema.safeParse(raw);
    if (!parsed.success) {
      logger.info("resume alert validation failed", {
        correlation_id: correlationId,
        fields: parsed.error.issues
          .map((i) => i.path[0])
          .filter((f): f is string => typeof f === "string"),
      });
      return json(400, { ok: false });
    }

    const data = parsed.data;
    if ((data.company ?? "").length > 0) {
      logger.info("resume alert classified as spam", {
        correlation_id: correlationId,
        reason: "honeypot",
      });
      return json(200, { ok: true });
    }

    await sendVisitAlert(
      {
        messageId: correlationId,
        kind: "resume",
        email: data.email,
        name: data.name,
        facts: factsFrom(data, { ipHash, at: new Date().toISOString() }),
      },
      correlationId,
    );

    return json(200, { ok: true });
  } catch (cause) {
    logger.error("resume alert failed", {
      correlation_id: correlationId,
      reason: cause instanceof Error ? cause.message : "unknown",
    });
    // Still 200-shaped to the caller: the download is already happening, and a
    // 500 here would surface as a console error on a page that is working.
    return json(200, { ok: false });
  }
};
