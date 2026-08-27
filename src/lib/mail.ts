import { createTransport } from "nodemailer";
import { Resend } from "resend";
import { db } from "./db";
import { env } from "./env";
import { logger } from "./logger";

/**
 * Outbound mail (SPEC §7, §12, §14.6, §14.8). One wrapper, two backends:
 * Resend in production, Mailpit over SMTP in development.
 *
 * SERVER ONLY. This module reads `RESEND_API_KEY` and must never be imported
 * from a client script (AGENT §4). The proof is not intention — it is a grep of
 * the built client bundle, recorded in the handoff.
 */

export interface ContactEmail {
  /** `ContactMessage.id`. Doubles as the idempotency key. */
  messageId: string;
  name: string;
  email: string;
  message: string;
}

export type SendResult =
  | {
      ok: true;
      providerId: string;
      backend: "resend" | "smtp";
      /** True when a prior send was found and nothing was dispatched. */
      deduped?: boolean;
    }
  | { ok: false; error: string };

/**
 * SPEC §14.6 — every user-supplied value is escaped before it reaches the HTML
 * body. The plain-text part needs no escaping; the HTML part is the whole
 * reason this exists.
 *
 * `&` first, or the escapes produced by the later replacements get re-escaped.
 * `"` and `'` are included even though nothing here interpolates into an
 * attribute today: an allowlist of contexts is a promise about the template,
 * and templates change.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * `\r` and `\n` in a header value let a caller inject additional headers — the
 * classic SMTP header-injection hole, which would turn `subject` into a Bcc.
 * Neither Resend nor nodemailer should let this through, but the boundary is
 * ours to hold (AGENT §3).
 */
const headerSafe = (value: string): string =>
  value.replace(/[\r\n]+/g, " ").trim();

interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function renderContactEmail(input: ContactEmail): RenderedEmail {
  const name = escapeHtml(input.name);
  const email = escapeHtml(input.email);
  const message = escapeHtml(input.message);

  return {
    subject: headerSafe(`New message from ${input.name}`),
    // Plain text is the raw values by design: there is no markup to escape into.
    text: [`From: ${input.name} <${input.email}>`, "", input.message].join(
      "\n",
    ),
    html: [
      "<!doctype html>",
      '<html lang="en"><body>',
      `<p><strong>From:</strong> ${name} &lt;${email}&gt;</p>`,
      // Newlines are the only formatting a submitter gets, and they are applied
      // to the ALREADY-escaped string so <br> is the only tag that can appear.
      `<p>${message.replace(/\r?\n/g, "<br>")}</p>`,
      "</body></html>",
    ].join("\n"),
  };
}

let resendClient: Resend | null = null;
const getResend = (): Resend => {
  // The env schema already refuses to boot with RESEND_ENABLED and no key, so
  // this cannot be reached without one — but assert rather than assume.
  if (!env.RESEND_API_KEY) {
    throw new Error("mail: RESEND_ENABLED is true but RESEND_API_KEY is unset");
  }
  resendClient ??= new Resend(env.RESEND_API_KEY);
  return resendClient;
};

/**
 * Records the send where the guard above reads it.
 *
 * This is the other half of the idempotency invariant, and it has to live here.
 * With only the READ in this module, a caller that forgot to persist `resendId`
 * broke the guarantee completely — two sends of one id delivered two emails,
 * and the Resend `idempotencyKey` masked it on the Resend path so the failure
 * showed up only on SMTP, the path the acceptance criterion is measured on.
 *
 * Never throws. The email has already gone out by the time this runs, so a
 * failure here must not turn a delivered message into a request-path error —
 * but it IS logged at `error`, because the consequence is that a retry will
 * double-send, and that deserves to be visible.
 */
async function recordSent(
  messageId: string,
  providerId: string,
  correlationId?: string,
): Promise<void> {
  try {
    await db.contactMessage.update({
      where: { id: messageId },
      data: { resendId: providerId, deliveredAt: new Date() },
    });
  } catch (cause) {
    logger.error("contact email sent but not recorded", {
      correlation_id: correlationId,
      message_id: messageId,
      reason: cause instanceof Error ? cause.message : "unknown",
    });
  }
}

/**
 * Sends the contact notification.
 *
 * NEVER THROWS. A provider failure is logged at `error` with the correlation id
 * and returned as `{ ok: false }`, so the request path can persist the message
 * as undelivered and still answer the submitter (SPEC §7). A contact form that
 * 500s because the mail provider is down has lost the message twice.
 *
 * Idempotency is the `ContactMessage` id, and this module owns BOTH halves of
 * it: it reads `resendId` before dispatch and writes it after, so a caller that
 * never persists anything still cannot produce two emails. Resend's
 * `idempotencyKey` sits underneath as a third line on the production path,
 * covering the crash window between dispatch and the write — the one gap the
 * durable check genuinely cannot see.
 */
export async function sendContactEmail(
  input: ContactEmail,
  correlationId?: string,
): Promise<SendResult> {
  /**
   * Durable idempotency, and it has to be durable to be worth anything.
   *
   * Resend's `idempotencyKey` collapses a retry provider-side, but ONLY on the
   * Resend path — SMTP has no such concept, so a retried send would put a second
   * copy in the inbox. `ContactMessage.resendId` is the record that a send
   * already happened, and it survives a process restart, which an in-memory set
   * would not.
   *
   * The read is deliberately here rather than left to the caller: "sending twice
   * with the same id results in one email" is a property of this module, and a
   * caller that forgets the check should not be able to break it.
   */
  const existing = await db.contactMessage.findUnique({
    where: { id: input.messageId },
    select: { resendId: true },
  });

  if (existing?.resendId) {
    return {
      ok: true,
      providerId: existing.resendId,
      backend: env.RESEND_ENABLED ? "resend" : "smtp",
      deduped: true,
    };
  }

  const rendered = renderContactEmail(input);
  const from = `Portfolio <${env.CONTACT_FROM_EMAIL}>`;
  const replyTo = headerSafe(input.email);

  try {
    if (env.RESEND_ENABLED) {
      const { data, error } = await getResend().emails.send(
        {
          from,
          to: env.CONTACT_TO_EMAIL,
          replyTo,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
        },
        { idempotencyKey: input.messageId },
      );

      if (error || !data) {
        /**
         * `error.message` only. The Resend error object can carry the request
         * that produced it, and that request contains the API key — SPEC §14.8
         * says the key never reaches a log line.
         */
        logger.error("contact email failed", {
          correlation_id: correlationId,
          message_id: input.messageId,
          backend: "resend",
          reason: error?.message ?? "resend returned no data",
        });
        return { ok: false, error: error?.message ?? "no data" };
      }

      await recordSent(input.messageId, data.id, correlationId);
      return { ok: true, providerId: data.id, backend: "resend" };
    }

    /**
     * SPEC §12 — with Resend disabled, mail goes to Mailpit and NOTHING leaves
     * the machine. `SMTP_URL` defaults to the compose file's Mailpit.
     */
    const info = await createTransport(env.SMTP_URL).sendMail({
      from,
      to: env.CONTACT_TO_EMAIL,
      replyTo,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      messageId: `<${input.messageId}@mh.neri.ph>`,
    });

    await recordSent(input.messageId, info.messageId, correlationId);
    return { ok: true, providerId: info.messageId, backend: "smtp" };
  } catch (cause) {
    logger.error("contact email failed", {
      correlation_id: correlationId,
      message_id: input.messageId,
      backend: env.RESEND_ENABLED ? "resend" : "smtp",
      reason: cause instanceof Error ? cause.message : "unknown",
    });
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : "unknown",
    };
  }
}
